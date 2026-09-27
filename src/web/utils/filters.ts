import type { Task } from "../../types";
import { normalizePriorityValue } from "../../utils/priority-config.ts";
import { normalizePersonName } from "../../utils/web-user.ts";
import { askedBy } from "./workflow";

/**
 * The filters of the board and the task list. Each filter holds values to include and values to
 * exclude. A task passes a filter when it has one of the included values (any, when none are
 * included) and none of the excluded ones: values are ORed within a filter, and the filters are
 * ANDed. `NONE_VALUE` stands for "has no value" (no labels, unassigned, no milestone).
 *
 * In the address each filter is one parameter holding a comma list, with "-" before an excluded
 * value: `?type=bug,feature&label=-sound`. Older addresses keep working: repeated parameters,
 * `labels=a,b`, `excludeStatus=Done`, `excludeStatuses=a,b`, `assignee=__unassigned__`,
 * `blocked=1`. A value cannot hold a comma, and one written with a leading "-" reads as excluded.
 */
export type FilterKey =
	| "status"
	| "assignee"
	| "askedBy"
	| "label"
	| "type"
	| "project"
	| "priority"
	| "milestone"
	| "blocked";

export interface FilterSelection {
	include: string[];
	exclude: string[];
}

export type FilterState = Partial<Record<FilterKey, FilterSelection>>;

export type OptionState = "include" | "exclude" | "off";

export interface FilterContext {
	/** A milestone value's comparison key: its canonical ID, lowercased, or "" for none. */
	milestoneKey?: (value: string | null | undefined) => string;
	/** Whether a task is blocked (see ./blocked). */
	isBlocked?: (task: Task) => boolean;
}

export const NONE_VALUE = "__none";
/** The one value of the Blocked filter. */
export const BLOCKED_VALUE = "blocked";

const FILTER_KEYS: readonly FilterKey[] = [
	"status",
	"assignee",
	"askedBy",
	"label",
	"type",
	"project",
	"priority",
	"milestone",
	"blocked",
];

const FILTER_PARAMS: Record<FilterKey, string> = {
	status: "status",
	assignee: "assignee",
	askedBy: "from",
	label: "label",
	type: "type",
	project: "project",
	priority: "priority",
	milestone: "milestone",
	blocked: "blocked",
};

/** Older parameters read into a filter, and dropped from the address when the filter is written. */
const LEGACY_INCLUDE_PARAMS: Partial<Record<FilterKey, string[]>> = { label: ["labels"] };
const LEGACY_EXCLUDE_PARAMS: Partial<Record<FilterKey, string[]>> = { status: ["excludeStatus", "excludeStatuses"] };
const LEGACY_NONE_VALUES = new Set(["__unassigned__"]);
const BLOCKED_ON = new Set(["1", "true", "yes", "on", BLOCKED_VALUE]);
const BLOCKED_OFF = new Set(["0", "false", "no", "off"]);

export function isSelectionEmpty(selection: FilterSelection | undefined): boolean {
	return !selection || (selection.include.length === 0 && selection.exclude.length === 0);
}

/** Whether any of the filters (all of them when `keys` is left out) holds a value. */
export function hasActiveFilters(state: FilterState, keys: readonly FilterKey[] = FILTER_KEYS): boolean {
	return keys.some((key) => !isSelectionEmpty(state[key]));
}

/** How many values the filters hold, included and excluded. */
export function countActiveValues(state: FilterState, keys: readonly FilterKey[] = FILTER_KEYS): number {
	return keys.reduce((total, key) => total + (state[key]?.include.length ?? 0) + (state[key]?.exclude.length ?? 0), 0);
}

/** The form two values of a filter compare in. */
export function filterValueKey(key: FilterKey, value: string | null | undefined, context: FilterContext = {}): string {
	const raw = String(value ?? "");
	if (raw === NONE_VALUE) return NONE_VALUE;
	switch (key) {
		case "assignee":
		case "askedBy":
			return normalizePersonName(raw);
		case "priority":
			return normalizePriorityValue(raw) ?? "";
		case "milestone":
			return context.milestoneKey ? context.milestoneKey(raw) : raw.trim().toLowerCase();
		default:
			return raw.trim().toLowerCase();
	}
}

function rawTaskValues(task: Task, key: FilterKey, context: FilterContext): Array<string | null | undefined> {
	switch (key) {
		case "status":
			return [task.status];
		case "assignee":
			return task.assignee ?? [];
		case "askedBy":
			return askedBy(task.labels);
		case "label":
			return task.labels ?? [];
		case "type":
			return [task.type];
		case "project":
			return [task.project];
		case "priority":
			return [task.priority];
		case "milestone":
			return [task.milestone];
		case "blocked":
			return context.isBlocked?.(task) ? [BLOCKED_VALUE] : [];
	}
}

/** A task's values for one filter, in comparison form; empty when it has none. */
export function taskFilterValues(task: Task, key: FilterKey, context: FilterContext = {}): string[] {
	const keys = new Set<string>();
	for (const value of rawTaskValues(task, key, context)) {
		const valueKey = filterValueKey(key, value, context);
		if (valueKey && valueKey !== NONE_VALUE) keys.add(valueKey);
	}
	return [...keys];
}

interface CompiledSelection {
	key: FilterKey;
	include: Set<string>;
	exclude: Set<string>;
}

/** Stands for a chosen value no task can have (an archived milestone): included, it matches nothing. */
const UNMATCHABLE = "\u0000";

function compileSelection(key: FilterKey, selection: FilterSelection, context: FilterContext): CompiledSelection {
	const toKeys = (values: string[]) =>
		new Set(values.map((value) => filterValueKey(key, value, context) || UNMATCHABLE));
	return { key, include: toKeys(selection.include), exclude: toKeys(selection.exclude) };
}

function passes(values: string[], compiled: CompiledSelection): boolean {
	const has = (value: string) => (value === NONE_VALUE ? values.length === 0 : values.includes(value));
	if (compiled.include.size > 0 && ![...compiled.include].some(has)) return false;
	return ![...compiled.exclude].some(has);
}

function compileState(state: FilterState, context: FilterContext, skip?: FilterKey): CompiledSelection[] {
	const compiled: CompiledSelection[] = [];
	for (const key of FILTER_KEYS) {
		const selection = state[key];
		if (key === skip || !selection || isSelectionEmpty(selection)) continue;
		compiled.push(compileSelection(key, selection, context));
	}
	return compiled;
}

/** Whether a set of values (a task's, or a lane's milestone) passes one filter. */
export function valuesPassSelection(
	key: FilterKey,
	values: Array<string | null | undefined>,
	selection: FilterSelection | undefined,
	context: FilterContext = {},
): boolean {
	if (!selection || isSelectionEmpty(selection)) return true;
	const keys = values
		.map((value) => filterValueKey(key, value, context))
		.filter((value) => value && value !== NONE_VALUE);
	return passes(keys, compileSelection(key, selection, context));
}

/**
 * The tasks every filter lets through, in their order; the same array when no filter is set.
 * `skip` leaves one filter out, which is what that filter's own option counts are read against.
 */
export function applyFilters(tasks: Task[], state: FilterState, context: FilterContext = {}, skip?: FilterKey): Task[] {
	const compiled = compileState(state, context, skip);
	if (compiled.length === 0) return tasks;
	return tasks.filter((task) => compiled.every((entry) => passes(taskFilterValues(task, entry.key, context), entry)));
}

/**
 * For one filter, how many tasks carry each value (by comparison key, `NONE_VALUE` for none), among
 * the tasks the other filters let through: what choosing that value would show.
 */
export function countFilterOptions(
	tasks: Task[],
	state: FilterState,
	key: FilterKey,
	context: FilterContext = {},
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const task of applyFilters(tasks, state, context, key)) {
		const values = taskFilterValues(task, key, context);
		if (values.length === 0) counts.set(NONE_VALUE, (counts.get(NONE_VALUE) ?? 0) + 1);
		for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
}

/** Where a value stands in a filter. `normalize` gives the form values compare in. */
export function optionState(
	selection: FilterSelection | undefined,
	value: string,
	normalize: (value: string) => string,
): OptionState {
	if (!selection) return "off";
	const target = normalize(value);
	if (selection.exclude.some((item) => normalize(item) === target)) return "exclude";
	if (selection.include.some((item) => normalize(item) === target)) return "include";
	return "off";
}

export function setOptionState(
	selection: FilterSelection | undefined,
	value: string,
	next: OptionState,
	normalize: (value: string) => string,
): FilterSelection {
	const target = normalize(value);
	const keep = (item: string) => normalize(item) !== target;
	const include = (selection?.include ?? []).filter(keep);
	const exclude = (selection?.exclude ?? []).filter(keep);
	if (next === "include") include.push(value);
	if (next === "exclude") exclude.push(value);
	return { include, exclude };
}

/** A click on an option: off, then included, then excluded, then off again. */
export function cycleOption(
	selection: FilterSelection | undefined,
	value: string,
	normalize: (value: string) => string,
): FilterSelection {
	const current = optionState(selection, value, normalize);
	const next: OptionState = current === "off" ? "include" : current === "include" ? "exclude" : "off";
	return setOptionState(selection, value, next, normalize);
}

/** The exclude control of an option: excluded, or off when it already is. */
export function toggleExcluded(
	selection: FilterSelection | undefined,
	value: string,
	normalize: (value: string) => string,
): FilterSelection {
	const next: OptionState = optionState(selection, value, normalize) === "exclude" ? "off" : "exclude";
	return setOptionState(selection, value, next, normalize);
}

/** Adds one value to a selection read from the address; a later mention of the same value wins. */
function addParsed(selection: FilterSelection, value: string, excluded: boolean) {
	const target = value.toLowerCase();
	selection.include = selection.include.filter((item) => item.toLowerCase() !== target);
	selection.exclude = selection.exclude.filter((item) => item.toLowerCase() !== target);
	(excluded ? selection.exclude : selection.include).push(value);
}

function parseListInto(selection: FilterSelection, raw: string, forceExclude = false) {
	for (const part of raw.split(",")) {
		let value = part.trim();
		let excluded = forceExclude;
		if (value.startsWith("-")) {
			excluded = true;
			value = value.slice(1).trim();
		}
		if (!value) continue;
		addParsed(selection, LEGACY_NONE_VALUES.has(value) ? NONE_VALUE : value, excluded);
	}
}

function parseBlocked(values: string[]): FilterSelection {
	const selection: FilterSelection = { include: [], exclude: [] };
	for (const raw of values) {
		const value = raw.trim().toLowerCase();
		const excluded = value.startsWith("-");
		const flag = excluded ? value.slice(1) : value;
		if (BLOCKED_ON.has(flag)) addParsed(selection, BLOCKED_VALUE, excluded);
		else if (BLOCKED_OFF.has(flag)) addParsed(selection, BLOCKED_VALUE, !excluded);
	}
	return selection;
}

function toParams(search: string | URLSearchParams): URLSearchParams {
	return typeof search === "string" ? new URLSearchParams(search) : search;
}

/** One filter as the address holds it, old forms included. */
function readFilter(search: string | URLSearchParams, key: FilterKey): FilterSelection {
	const params = toParams(search);
	if (key === "blocked") return parseBlocked(params.getAll(FILTER_PARAMS.blocked));
	const selection: FilterSelection = { include: [], exclude: [] };
	for (const param of [FILTER_PARAMS[key], ...(LEGACY_INCLUDE_PARAMS[key] ?? [])]) {
		for (const raw of params.getAll(param)) parseListInto(selection, raw);
	}
	for (const param of LEGACY_EXCLUDE_PARAMS[key] ?? []) {
		for (const raw of params.getAll(param)) parseListInto(selection, raw, true);
	}
	return selection;
}

export function readFilters(search: string | URLSearchParams, keys: readonly FilterKey[] = FILTER_KEYS): FilterState {
	const params = toParams(search);
	const state: FilterState = {};
	for (const key of keys) {
		const selection = readFilter(params, key);
		if (!isSelectionEmpty(selection)) state[key] = selection;
	}
	return state;
}

/** One filter's parameter value, or null when it is empty. */
function formatFilter(key: FilterKey, selection: FilterSelection | undefined): string | null {
	if (!selection || isSelectionEmpty(selection)) return null;
	if (key === "blocked") return selection.include.length > 0 ? "1" : "0";
	return [...selection.include, ...selection.exclude.map((value) => `-${value}`)].join(",");
}

/**
 * A query string ("" or "?…") with commas, colons, slashes and "@" left readable, so a filtered
 * address reads as `?type=bug,feature&assignee=@user`.
 */
function serializeSearch(params: URLSearchParams): string {
	const encode = (text: string) =>
		encodeURIComponent(text).replace(/%(2C|3A|2F|40)/gi, (match) => decodeURIComponent(match));
	const pairs: string[] = [];
	params.forEach((value, name) => {
		pairs.push(`${encode(name)}=${encode(value)}`);
	});
	return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

/**
 * The query string with some parameters set (in place of their first occurrence, the others dropped),
 * appended when new, or removed (null). Every other parameter stays.
 */
export function updateSearch(search: string | URLSearchParams, updates: Record<string, string | null>): string {
	const current = toParams(search);
	const next = new URLSearchParams();
	const written = new Set<string>();
	current.forEach((value, name) => {
		if (!(name in updates)) {
			next.append(name, value);
			return;
		}
		const replacement = updates[name];
		if (replacement === null || replacement === undefined || written.has(name)) return;
		next.append(name, replacement);
		written.add(name);
	});
	for (const [name, value] of Object.entries(updates)) {
		if (value !== null && value !== undefined && !written.has(name)) next.append(name, value);
	}
	return serializeSearch(next);
}

/** The query string with the given filters written in the current form, their older forms dropped. */
export function writeFilters(
	search: string | URLSearchParams,
	state: FilterState,
	keys: readonly FilterKey[] = FILTER_KEYS,
): string {
	const updates: Record<string, string | null> = {};
	for (const key of keys) {
		for (const legacy of [...(LEGACY_INCLUDE_PARAMS[key] ?? []), ...(LEGACY_EXCLUDE_PARAMS[key] ?? [])]) {
			updates[legacy] = null;
		}
		updates[FILTER_PARAMS[key]] = formatFilter(key, state[key]);
	}
	return updateSearch(search, updates);
}

/**
 * Filters with each value in its canonical form: `canonical` maps a value to it, or to undefined for a
 * value the filter does not know (dropped). Filters without a mapping keep their values. `NONE_VALUE`
 * is kept, and a value that is there twice is kept once.
 */
export function canonicalizeFilters(
	state: FilterState,
	canonical: Partial<Record<FilterKey, (value: string) => string | undefined>>,
): FilterState {
	const next: FilterState = {};
	for (const key of FILTER_KEYS) {
		const selection = state[key];
		if (!selection || isSelectionEmpty(selection)) continue;
		const map = canonical[key];
		const seen = new Set<string>();
		const convert = (values: string[]) =>
			values.flatMap((value) => {
				const mapped = value === NONE_VALUE || !map ? value : map(value);
				if (!mapped || seen.has(mapped.toLowerCase())) return [];
				seen.add(mapped.toLowerCase());
				return [mapped];
			});
		// Exclusions first, so a value both included and excluded stays excluded.
		const exclude = convert(selection.exclude);
		const include = convert(selection.include);
		if (include.length > 0 || exclude.length > 0) next[key] = { include, exclude };
	}
	return next;
}
