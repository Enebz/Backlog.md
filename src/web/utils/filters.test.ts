import { describe, expect, it } from "bun:test";
import type { Task } from "../../types";
import {
	applyFilters,
	BLOCKED_VALUE,
	canonicalizeFilters,
	countFilterOptions,
	cycleOption,
	type FilterContext,
	type FilterSelection,
	type FilterState,
	filterValueKey,
	NONE_VALUE,
	optionState,
	readFilters,
	setOptionState,
	toggleExcluded,
	updateSearch,
	valuesPassSelection,
	writeFilters,
} from "./filters";

const task = (overrides: Partial<Task>): Task => ({
	id: "TASK-1",
	title: "Task",
	status: "To Do",
	assignee: [],
	createdDate: "2026-09-27 10:00",
	labels: [],
	dependencies: [],
	...overrides,
});

const TASKS: Task[] = [
	task({ id: "TASK-1", type: "bug", labels: ["sound", "from:depot-worker"], assignee: ["@user"], priority: "high" }),
	task({ id: "TASK-2", type: "feature", labels: ["art"], assignee: ["@sugar-bounce"], priority: "medium" }),
	task({ id: "TASK-3", type: "chore", labels: ["sound", "Tooling"], priority: "low", milestone: "m-1" }),
	task({ id: "TASK-4", labels: [], assignee: ["@sugar-bounce"], milestone: "m-2", status: "Done" }),
	task({ id: "TASK-5", type: "Bug", labels: ["art", "from:the-house"], milestone: "m-1" }),
];

const ids = (tasks: Task[]) => tasks.map((entry) => entry.id);
const only = (include: string[], exclude: string[] = []): FilterSelection => ({ include, exclude });
const same = (value: string) => value;

describe("applyFilters", () => {
	it("returns the same array when no filter holds a value", () => {
		expect(applyFilters(TASKS, {})).toBe(TASKS);
		expect(applyFilters(TASKS, { type: only([]) })).toBe(TASKS);
	});

	it("ORs the values of one filter", () => {
		expect(ids(applyFilters(TASKS, { type: only(["bug", "feature"]) }))).toEqual(["TASK-1", "TASK-2", "TASK-5"]);
	});

	it("ANDs the filters", () => {
		const state: FilterState = { type: only(["bug", "feature"]), assignee: only(["@sugar-bounce"]) };
		expect(ids(applyFilters(TASKS, state))).toEqual(["TASK-2"]);
	});

	it("excludes, keeping tasks that have no value at all", () => {
		expect(ids(applyFilters(TASKS, { type: only([], ["chore"]) }))).toEqual(["TASK-1", "TASK-2", "TASK-4", "TASK-5"]);
		expect(ids(applyFilters(TASKS, { label: only([], ["sound"]) }))).toEqual(["TASK-2", "TASK-4", "TASK-5"]);
	});

	it("includes and excludes in one filter", () => {
		// Art or sound, but nothing that is sound.
		expect(ids(applyFilters(TASKS, { label: only(["art", "sound"], ["sound"]) }))).toEqual(["TASK-2", "TASK-5"]);
		// Excluding one of a task's several labels removes the task.
		expect(ids(applyFilters(TASKS, { label: only(["sound"], ["tooling"]) }))).toEqual(["TASK-1"]);
	});

	it("mixes include and exclude across filters", () => {
		const state: FilterState = {
			type: only(["bug", "chore"]),
			label: only([], ["sound"]),
			milestone: only(["m-1"]),
		};
		expect(ids(applyFilters(TASKS, state))).toEqual(["TASK-5"]);
	});

	it("matches a task with no value to the none option, included or excluded", () => {
		expect(ids(applyFilters(TASKS, { assignee: only([NONE_VALUE]) }))).toEqual(["TASK-3", "TASK-5"]);
		expect(ids(applyFilters(TASKS, { assignee: only([], [NONE_VALUE]) }))).toEqual(["TASK-1", "TASK-2", "TASK-4"]);
		expect(ids(applyFilters(TASKS, { type: only(["feature", NONE_VALUE]) }))).toEqual(["TASK-2", "TASK-4"]);
		expect(ids(applyFilters(TASKS, { label: only([NONE_VALUE]) }))).toEqual(["TASK-4"]);
	});

	it("compares labels, types and statuses without case, and people with or without @", () => {
		expect(ids(applyFilters(TASKS, { label: only(["tooling"]) }))).toEqual(["TASK-3"]);
		expect(ids(applyFilters(TASKS, { type: only(["BUG"]) }))).toEqual(["TASK-1", "TASK-5"]);
		expect(ids(applyFilters(TASKS, { status: only(["done"]) }))).toEqual(["TASK-4"]);
		expect(ids(applyFilters(TASKS, { assignee: only(["user"]) }))).toEqual(["TASK-1"]);
		expect(ids(applyFilters(TASKS, { askedBy: only(["@The-House"]) }))).toEqual(["TASK-5"]);
		expect(ids(applyFilters(TASKS, { priority: only(["High"]) }))).toEqual(["TASK-1"]);
	});

	it("reads who asked from the from: labels, and label filters see them too", () => {
		expect(ids(applyFilters(TASKS, { askedBy: only(["depot-worker", "the-house"]) }))).toEqual(["TASK-1", "TASK-5"]);
		expect(ids(applyFilters(TASKS, { askedBy: only([], [NONE_VALUE]) }))).toEqual(["TASK-1", "TASK-5"]);
		expect(ids(applyFilters(TASKS, { label: only(["from:the-house"]) }))).toEqual(["TASK-5"]);
	});

	it("canonicalizes milestones through the context, and an archived one matches nothing", () => {
		const context: FilterContext = {
			milestoneKey: (value) => {
				const key = (value ?? "").trim().toLowerCase();
				if (key === "release 1") return "m-1";
				return key === "m-2" ? "" : key; // m-2 is archived
			},
		};
		expect(ids(applyFilters(TASKS, { milestone: only(["Release 1"]) }, context))).toEqual(["TASK-3", "TASK-5"]);
		expect(ids(applyFilters(TASKS, { milestone: only(["m-2"]) }, context))).toEqual([]);
		expect(ids(applyFilters(TASKS, { milestone: only([NONE_VALUE]) }, context))).toEqual([
			"TASK-1",
			"TASK-2",
			"TASK-4",
		]);
	});

	it("filters to the blocked tasks, or away from them", () => {
		const context: FilterContext = { isBlocked: (entry) => entry.id === "TASK-2" || entry.id === "TASK-3" };
		expect(ids(applyFilters(TASKS, { blocked: only([BLOCKED_VALUE]) }, context))).toEqual(["TASK-2", "TASK-3"]);
		expect(ids(applyFilters(TASKS, { blocked: only([], [BLOCKED_VALUE]) }, context))).toEqual([
			"TASK-1",
			"TASK-4",
			"TASK-5",
		]);
	});

	it("tells whether a lane's milestone passes the milestone filter", () => {
		expect(valuesPassSelection("milestone", ["m-1"], only(["m-1", "m-3"]))).toBe(true);
		expect(valuesPassSelection("milestone", ["m-2"], only([], ["m-2"]))).toBe(false);
		expect(valuesPassSelection("milestone", [undefined], only([NONE_VALUE]))).toBe(true);
		expect(valuesPassSelection("milestone", ["m-2"], undefined)).toBe(true);
	});
});

describe("countFilterOptions", () => {
	it("counts each value among the tasks the other filters let through", () => {
		const state: FilterState = { type: only(["bug"]), assignee: only([], ["@sugar-bounce"]) };
		// The type filter's own values are not narrowed by it, only by the assignee filter.
		const types = countFilterOptions(TASKS, state, "type");
		expect(Object.fromEntries(types)).toEqual({ bug: 2, chore: 1 });
		// The label counts follow both filters: TASK-1 and TASK-5.
		const labels = countFilterOptions(TASKS, state, "label");
		expect(labels.get("sound")).toBe(1);
		expect(labels.get("art")).toBe(1);
		expect(labels.get("tooling")).toBeUndefined();
	});

	it("counts the tasks with no value as the none option", () => {
		const counts = countFilterOptions(TASKS, {}, "assignee");
		expect(counts.get(NONE_VALUE)).toBe(2);
		expect(counts.get("sugar-bounce")).toBe(2);
		expect(counts.get("user")).toBe(1);
	});
});

describe("option states", () => {
	const key = (value: string) => filterValueKey("label", value);

	it("cycles a click through include, exclude and off", () => {
		let selection = only([]);
		selection = cycleOption(selection, "Art", key);
		expect(selection).toEqual(only(["Art"]));
		expect(optionState(selection, "art", key)).toBe("include");
		selection = cycleOption(selection, "art", key);
		expect(selection).toEqual(only([], ["art"]));
		expect(optionState(selection, "ART", key)).toBe("exclude");
		selection = cycleOption(selection, "art", key);
		expect(selection).toEqual(only([]));
	});

	it("excludes directly, and the exclude control clears an exclusion", () => {
		let selection = toggleExcluded(only(["art", "sound"]), "art", key);
		expect(selection).toEqual(only(["sound"], ["art"]));
		selection = toggleExcluded(selection, "art", key);
		expect(selection).toEqual(only(["sound"]));
	});

	it("sets a state without touching the other values", () => {
		expect(setOptionState(only(["a"], ["b"]), "b", "off", same)).toEqual(only(["a"]));
		expect(setOptionState(undefined, "a", "exclude", same)).toEqual(only([], ["a"]));
	});
});

describe("filters in the address", () => {
	it("reads comma lists with - before an excluded value", () => {
		expect(readFilters("?type=bug,feature&label=-sound")).toEqual({
			type: only(["bug", "feature"]),
			label: only([], ["sound"]),
		});
		expect(readFilters("?label=art,-sound,%20tooling%20")).toEqual({ label: only(["art", "tooling"], ["sound"]) });
	});

	it("reads a list whose commas were encoded", () => {
		expect(readFilters("?type=bug%2Cfeature&label=-sound%2C-art")).toEqual({
			type: only(["bug", "feature"]),
			label: only([], ["sound", "art"]),
		});
	});

	it("keeps the old single-value addresses working", () => {
		expect(readFilters("?from=the-house")).toEqual({ askedBy: only(["the-house"]) });
		expect(readFilters("?blocked=1")).toEqual({ blocked: only([BLOCKED_VALUE]) });
		expect(readFilters("?blocked=true")).toEqual({ blocked: only([BLOCKED_VALUE]) });
		expect(readFilters("?assignee=@user&priority=high&type=bug&project=Web&milestone=m-1")).toEqual({
			assignee: only(["@user"]),
			priority: only(["high"]),
			type: only(["bug"]),
			project: only(["Web"]),
			milestone: only(["m-1"]),
		});
		expect(readFilters("?status=Waiting%20on%20you")).toEqual({ status: only(["Waiting on you"]) });
		expect(readFilters("?status=In+Progress")).toEqual({ status: only(["In Progress"]) });
	});

	it("reads the old repeated and plural parameters", () => {
		expect(readFilters("?label=bug&label=docs&labels=ui,infra")).toEqual({
			label: only(["bug", "docs", "ui", "infra"]),
		});
		expect(readFilters("?status=To%20Do&status=In%20Progress")).toEqual({ status: only(["To Do", "In Progress"]) });
		expect(readFilters("?excludeStatus=Done&excludeStatuses=Review,Archived")).toEqual({
			status: only([], ["Done", "Review", "Archived"]),
		});
	});

	it("reads the old no-value markers and not-blocked", () => {
		expect(readFilters("?assignee=__unassigned__")).toEqual({ assignee: only([NONE_VALUE]) });
		expect(readFilters("?milestone=__none")).toEqual({ milestone: only([NONE_VALUE]) });
		expect(readFilters("?blocked=0")).toEqual({ blocked: only([], [BLOCKED_VALUE]) });
		expect(readFilters("?blocked=-1")).toEqual({ blocked: only([], [BLOCKED_VALUE]) });
		expect(readFilters("?blocked=maybe")).toEqual({});
	});

	it("lets a later mention of a value win", () => {
		expect(readFilters("?label=art,-art")).toEqual({ label: only([], ["art"]) });
		expect(readFilters("?label=-Art&label=art")).toEqual({ label: only(["art"]) });
	});

	it("reads only the filters asked for", () => {
		expect(readFilters("?status=Done&type=bug", ["type"])).toEqual({ type: only(["bug"]) });
	});

	it("writes each filter as one readable parameter and keeps the rest of the address", () => {
		const search = writeFilters("?lane=milestone&type=chore&view=compact", {
			type: only(["bug", "feature"]),
			label: only(["from:the-house"], ["sound"]),
			assignee: only(["@user"]),
			blocked: only([BLOCKED_VALUE]),
		});
		expect(search).toBe(
			"?lane=milestone&type=bug,feature&view=compact&assignee=@user&label=from:the-house,-sound&blocked=1",
		);
		expect(writeFilters("", { blocked: only([], [BLOCKED_VALUE]) })).toBe("?blocked=0");
		expect(writeFilters("", { status: only(["In Progress", "Waiting on you"]) })).toBe(
			"?status=In%20Progress,Waiting%20on%20you",
		);
	});

	it("drops emptied filters and the old parameters it replaces", () => {
		expect(writeFilters("?label=bug&label=docs&labels=ui&excludeStatus=Done&view=x", { label: only(["art"]) })).toBe(
			"?label=art&view=x",
		);
		expect(writeFilters("?type=bug&blocked=1", {})).toBe("");
		expect(writeFilters("?type=bug&blocked=1", { type: only(["bug"]) }, ["blocked"])).toBe("?type=bug");
	});

	it("reads back what it writes", () => {
		const state: FilterState = {
			status: only(["To Do"], ["Done"]),
			assignee: only([NONE_VALUE, "@user"]),
			askedBy: only([], ["depot-worker"]),
			label: only(["art", "a/b"], ["sound"]),
			type: only(["bug"]),
			priority: only(["very high"]),
			milestone: only(["m-1"], [NONE_VALUE]),
			blocked: only([], [BLOCKED_VALUE]),
		};
		expect(readFilters(writeFilters("", state))).toEqual(state);
	});

	it("updates single parameters in place", () => {
		expect(updateSearch("?a=1&lane=milestone&b=2&lane=x", { lane: null })).toBe("?a=1&b=2");
		expect(updateSearch("?a=1&lane=none&b=2", { lane: "milestone" })).toBe("?a=1&lane=milestone&b=2");
		expect(updateSearch("", { lane: "milestone" })).toBe("?lane=milestone");
		expect(updateSearch("?highlight=TASK-1", { highlight: null })).toBe("");
	});
});

describe("canonicalizeFilters", () => {
	const types = (value: string) =>
		["Bug", "Customer Request"].find((type) => type.toLowerCase() === value.trim().toLowerCase());

	it("gives values their configured form and drops the unknown ones", () => {
		expect(canonicalizeFilters({ type: only(["bug", "customer request", "nope"], ["BUG"]) }, { type: types })).toEqual({
			type: only(["Customer Request"], ["Bug"]),
		});
		expect(canonicalizeFilters({ type: only(["nope"]) }, { type: types })).toEqual({});
	});

	it("keeps the none marker and the filters it has no mapping for", () => {
		expect(canonicalizeFilters({ type: only([NONE_VALUE]), label: only(["x", "x"]) }, { type: types })).toEqual({
			type: only([NONE_VALUE]),
			label: only(["x"]),
		});
	});
});
