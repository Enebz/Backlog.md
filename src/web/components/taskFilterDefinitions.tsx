import { useMemo } from "react";
import type { Milestone, Task } from "../../types";
import { collectAvailableLabels } from "../../utils/label-filter.ts";
import { getPriorityOptions } from "../../utils/priority-config.ts";
import { isSamePerson, normalizePersonName } from "../../utils/web-user.ts";
import {
	BLOCKED_VALUE,
	countFilterOptions,
	type FilterContext,
	type FilterKey,
	type FilterState,
	filterValueKey,
	NONE_VALUE,
	taskFilterValues,
} from "../utils/filters";
import { askedBy, displayPerson, isFromLabel } from "../utils/workflow";
import type { FilterDefinition } from "./FilterBar";
import type { FilterOption } from "./FilterMenu";
import PersonAvatar from "./PersonAvatar";

interface FilterDefinitionsInput {
	/** The filters to offer, in order. */
	keys: readonly FilterKey[];
	tasks: Task[];
	filters: FilterState;
	context: FilterContext;
	webUserName: string;
	availableLabels: string[];
	availablePriorities?: string[];
	statusOptions?: string[];
	typeOptions: string[];
	projectOptions: string[];
	milestoneEntities: Milestone[];
	/** Milestone IDs to offer besides the entities' (the app's list of milestones). */
	milestoneIds?: string[];
	/** How the Blocked filter is set: its own inline control, or elsewhere on the page ("chips"). */
	blockedControl: "toggle" | "chips";
}

const LABELS: Record<FilterKey, string> = {
	status: "Status",
	assignee: "Assignee",
	askedBy: "Asked by",
	label: "Labels",
	type: "Type",
	project: "Project",
	priority: "Priority",
	milestone: "Milestone",
	blocked: "Blocked",
};

/** The "no value" option of each filter, and how it reads excluded; a filter without one has none. */
const NONE_OPTIONS: Partial<Record<FilterKey, { label: string; excludedLabel: string }>> = {
	assignee: { label: "Unassigned", excludedLabel: "Assigned" },
	askedBy: { label: "No one", excludedLabel: "Someone" },
	label: { label: "No labels", excludedLabel: "Any label" },
	type: { label: "No type", excludedLabel: "Any type" },
	project: { label: "No project", excludedLabel: "Any project" },
	priority: { label: "No priority", excludedLabel: "Any priority" },
	milestone: { label: "No milestone", excludedLabel: "Any milestone" },
};

/** People once each (however they are written), the person at the board first, then by name. */
function people(names: Iterable<string>, webUserName: string): string[] {
	const byKey = new Map<string, string>();
	for (const name of names) {
		const trimmed = name.trim();
		const key = normalizePersonName(trimmed);
		if (key && !byKey.has(key)) byKey.set(key, trimmed);
	}
	return [...byKey.values()].sort((a, b) => {
		const aYou = isSamePerson(a, webUserName);
		const bYou = isSamePerson(b, webUserName);
		if (aYou !== bYou) return aYou ? -1 : 1;
		return normalizePersonName(a).localeCompare(normalizePersonName(b));
	});
}

function personOption(name: string, webUserName: string): FilterOption {
	return {
		value: name,
		label: displayPerson(name, webUserName) === "You" ? `You (${name})` : name,
		icon: <PersonAvatar name={name} webUserName={webUserName} size="xs" />,
	};
}

function baseOptions(key: FilterKey, input: FilterDefinitionsInput): FilterOption[] {
	const { tasks, webUserName } = input;
	switch (key) {
		case "status":
			return (input.statusOptions ?? []).map((status) => ({ value: status, label: status }));
		case "assignee":
			return people(
				tasks.flatMap((task) => task.assignee ?? []),
				webUserName,
			).map((name) => personOption(name, webUserName));
		case "askedBy":
			return people(
				tasks.flatMap((task) => askedBy(task.labels)),
				webUserName,
			).map((name) => personOption(name, webUserName));
		case "label":
			// The from: labels are who asked, which has a filter of its own.
			return collectAvailableLabels(tasks, input.availableLabels)
				.filter((label) => !isFromLabel(label))
				.map((label) => ({ value: label, label }));
		case "type":
			return input.typeOptions.map((type) => ({ value: type, label: type }));
		case "project":
			return input.projectOptions.map((project) => ({ value: project, label: project }));
		case "priority":
			return getPriorityOptions(input.availablePriorities).map((option) => ({
				value: option.value,
				label: option.label,
			}));
		case "milestone": {
			const options: FilterOption[] = input.milestoneEntities.map((milestone) => ({
				value: milestone.id,
				label: milestone.title || milestone.id,
			}));
			// Milestones listed without an entity, or named by tasks but not (or no longer) configured, get one too.
			const known = new Set(options.map((option) => filterValueKey("milestone", option.value, input.context)));
			for (const name of [...(input.milestoneIds ?? []), ...tasks.map((task) => task.milestone)]) {
				const milestone = name?.trim();
				const milestoneKey = milestone ? filterValueKey("milestone", milestone, input.context) : "";
				if (!milestone || !milestoneKey || known.has(milestoneKey)) continue;
				known.add(milestoneKey);
				options.push({ value: milestone, label: milestone });
			}
			return options;
		}
		case "blocked":
			return [{ value: BLOCKED_VALUE, label: "Blocked", excludedLabel: "Not blocked", bareChip: true }];
	}
}

/** Whether a filter is worth offering: it has something to choose, or something is chosen. */
function isOffered(key: FilterKey, options: FilterOption[], chosen: boolean): boolean {
	if (chosen) return true;
	switch (key) {
		case "askedBy":
		case "project":
		case "milestone":
			return options.length > 0;
		default:
			return true;
	}
}

/**
 * The filter controls of the board or the task list: each filter's options with the number of
 * tasks each would show under the other filters, a "no value" option where one makes sense, and any
 * chosen value the options lack.
 */
export function buildFilterDefinitions(input: FilterDefinitionsInput): FilterDefinition[] {
	const { filters, context, tasks } = input;
	const definitions: FilterDefinition[] = [];
	for (const key of input.keys) {
		const normalize = (value: string) => filterValueKey(key, value, context);
		const selection = filters[key];
		const chosen = Boolean(selection && (selection.include.length > 0 || selection.exclude.length > 0));
		const options = baseOptions(key, input);
		if (!isOffered(key, options, chosen)) continue;

		const counts = countFilterOptions(tasks, filters, key, context);
		const chosenKeys = new Set([...(selection?.include ?? []), ...(selection?.exclude ?? [])].map(normalize));
		const none = NONE_OPTIONS[key];
		// Offered while some task has no value (whatever the other filters show), or it is chosen.
		if (none && (chosenKeys.has(NONE_VALUE) || tasks.some((task) => taskFilterValues(task, key, context).length === 0))) {
			options.unshift({ value: NONE_VALUE, ...none });
		}
		const offered = new Set(options.map((option) => normalize(option.value)));
		for (const value of [...(selection?.include ?? []), ...(selection?.exclude ?? [])]) {
			const valueKey = normalize(value);
			if (offered.has(valueKey)) continue;
			offered.add(valueKey);
			options.push({ value, label: value });
		}

		definitions.push({
			key,
			label: LABELS[key],
			normalize,
			control: key === "blocked" ? input.blockedControl : "menu",
			options: options.map((option) => ({ ...option, count: counts.get(normalize(option.value)) ?? 0 })),
		});
	}
	return definitions;
}

export function useTaskFilterDefinitions(input: FilterDefinitionsInput): FilterDefinition[] {
	const {
		keys,
		tasks,
		filters,
		context,
		webUserName,
		availableLabels,
		availablePriorities,
		statusOptions,
		typeOptions,
		projectOptions,
		milestoneEntities,
		milestoneIds,
		blockedControl,
	} = input;
	return useMemo(
		() =>
			buildFilterDefinitions({
				keys,
				tasks,
				filters,
				context,
				webUserName,
				availableLabels,
				availablePriorities,
				statusOptions,
				typeOptions,
				projectOptions,
				milestoneEntities,
				milestoneIds,
				blockedControl,
			}),
		[
			keys,
			tasks,
			filters,
			context,
			webUserName,
			availableLabels,
			availablePriorities,
			statusOptions,
			typeOptions,
			projectOptions,
			milestoneEntities,
			milestoneIds,
			blockedControl,
		],
	);
}
