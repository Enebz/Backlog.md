import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Task } from "../types/index.ts";
import TaskList from "../web/components/TaskList.tsx";
import {
	clickOption,
	excludeOption,
	filterSummary,
	findButton,
	openFilter,
	optionLabels,
} from "./filter-menu-helpers.ts";

const createTask = (overrides: Partial<Task>): Task => ({
	id: "task-1",
	title: "Task",
	status: "To Do",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-01-01",
	...overrides,
});

const tasks: Task[] = [
	createTask({ id: "task-101", title: "Fix labels dropdown", labels: ["bug"] }),
	createTask({ id: "task-102", title: "Ship docs", labels: ["docs"] }),
];

let activeRoot: Root | null = null;
const originalFetch = globalThis.fetch;

const setupDom = () => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as unknown as Document;
	globalThis.navigator = dom.window.navigator as unknown as Navigator;
	globalThis.localStorage = dom.window.localStorage as unknown as Storage;

	if (!window.matchMedia) {
		window.matchMedia = () =>
			({
				matches: false,
				media: "",
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false,
			}) as MediaQueryList;
	}

	const htmlElementPrototype = window.HTMLElement.prototype as unknown as {
		attachEvent?: () => void;
		detachEvent?: () => void;
	};
	if (typeof htmlElementPrototype.attachEvent !== "function") {
		htmlElementPrototype.attachEvent = () => {};
	}
	if (typeof htmlElementPrototype.detachEvent !== "function") {
		htmlElementPrototype.detachEvent = () => {};
	}
};

const LocationSearch = () => {
	const location = useLocation();
	return <output data-testid="location-search">{location.search}</output>;
};

const renderTaskList = (
	initialEntries?: string[],
	options: {
		tasks?: Task[];
		availableStatuses?: string[];
		availableLabels?: string[];
		availablePriorities?: string[];
		availableTypes?: string[];
	} = {},
): HTMLElement => {
	setupDom();
	const container = document.getElementById("root");
	expect(container).toBeTruthy();
	const renderedTasks = options.tasks ?? tasks;
	const renderedStatuses = options.availableStatuses ?? ["To Do", "In Progress", "Done"];
	const renderedLabels = options.availableLabels ?? ["bug", "docs"];
	activeRoot = createRoot(container as HTMLElement);
	act(() => {
		activeRoot?.render(
			<MemoryRouter initialEntries={initialEntries}>
				<TaskList
					tasks={renderedTasks}
					availableStatuses={renderedStatuses}
					availableLabels={renderedLabels}
					availableMilestones={[]}
					availablePriorities={options.availablePriorities}
					availableTypes={options.availableTypes}
					milestoneEntities={[]}
					archivedMilestones={[]}
					onEditTask={() => {}}
					onNewTask={() => {}}
				/>
				<LocationSearch />
			</MemoryRouter>,
		);
	});
	return container as HTMLElement;
};

const clickElement = async (element: Element) => {
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
	});
};

const waitFor = async (predicate: () => boolean) => {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		if (predicate()) {
			return;
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

const STATUS = "task-list-filter-status";
const LABELS = "task-list-filter-label";

const getLabelsButton = (container: HTMLElement): HTMLButtonElement => {
	const button = container.querySelector(`button[aria-controls='${LABELS}-menu']`);
	expect(button).toBeTruthy();
	return button as HTMLButtonElement;
};

/** Filtering is done in the browser: any request the list makes is recorded, so a test can say there was none. */
const recordFetches = (): string[] => {
	const calls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		calls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
		return { ok: true, status: 200, statusText: "OK", json: async () => [] } as Response;
	}) as typeof fetch;
	return calls;
};

const getZIndexClass = (element: Element): number | null => {
	const match = element.className.match(/\bz-(\d+)\b/);
	const value = match?.[1];
	return value ? Number.parseInt(value, 10) : null;
};

const getRenderedTaskIds = (container: HTMLElement): string[] =>
	Array.from(container.querySelectorAll("tbody tr td:first-child")).map((cell) => cell.textContent?.trim() ?? "");

const getLocationSearch = (container: HTMLElement): string =>
	container.querySelector("[data-testid='location-search']")?.textContent ?? "";

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (activeRoot) {
		act(() => {
			activeRoot?.unmount();
		});
		activeRoot = null;
	}
});

describe("TaskList filters", () => {
	it("does not render a duplicate local task search input", () => {
		const container = renderTaskList(["/?query=docs"]);

		expect(container.querySelector("input[placeholder='Search tasks']")).toBeNull();
	});

	it("renders label filter options alphabetically", async () => {
		const container = renderTaskList(undefined, {
			availableLabels: ["zeta", "Alpha"],
			tasks: [
				createTask({ id: "task-101", labels: ["beta"] }),
				createTask({ id: "task-102", labels: ["delta"] }),
			],
		});

		await openFilter(container, LABELS);

		expect(optionLabels(container, LABELS)).toEqual(["Alpha", "beta", "delta", "zeta"]);
	});

	it("sorts dotted subtask IDs under their parent when sorting by ID", async () => {
		const container = renderTaskList(undefined, {
			tasks: [
				createTask({ id: "task-1", title: "First task" }),
				createTask({ id: "task-2", title: "Second task" }),
				createTask({ id: "task-3", title: "Parent task" }),
				createTask({ id: "task-3.01", title: "First subtask" }),
				createTask({ id: "task-3.02", title: "Second subtask" }),
			],
		});

		const idButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("ID"));
		expect(idButton).toBeTruthy();

		await clickElement(idButton as HTMLButtonElement);
		await waitFor(() => getRenderedTaskIds(container)[0] === "task-1");

		expect(getRenderedTaskIds(container)).toEqual(["task-1", "task-2", "task-3", "task-3.01", "task-3.02"]);
	});

	it("keeps parent tasks before subtasks in the default ID descending sort", () => {
		const container = renderTaskList(undefined, {
			tasks: [
				createTask({ id: "task-1", title: "First task" }),
				createTask({ id: "task-2", title: "Second task" }),
				createTask({ id: "task-3.01", title: "First subtask" }),
				createTask({ id: "task-3.02", title: "Second subtask" }),
				createTask({ id: "task-3", title: "Parent task" }),
			],
		});

		expect(getRenderedTaskIds(container)).toEqual(["task-3", "task-3.02", "task-3.01", "task-2", "task-1"]);
	});

	it("sorts distinct nonnumeric task IDs deterministically when sorting by ID", async () => {
		const container = renderTaskList(undefined, {
			tasks: [
				createTask({ id: "task-beta", title: "Beta task" }),
				createTask({ id: "task-alpha", title: "Alpha task" }),
			],
		});

		const idButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("ID"));
		expect(idButton).toBeTruthy();

		await clickElement(idButton as HTMLButtonElement);
		await waitFor(() => getRenderedTaskIds(container)[0] === "task-alpha");

		expect(getRenderedTaskIds(container)).toEqual(["task-alpha", "task-beta"]);
	});

	it("renders and sorts by ordinal with task ID as the tie-breaker", async () => {
		const container = renderTaskList(undefined, {
			tasks: [
				createTask({ id: "task-1", title: "No ordinal" }),
				createTask({ id: "task-2", title: "Tied ordinal A", ordinal: 20 }),
				createTask({ id: "task-3", title: "First ordinal", ordinal: 10 }),
				createTask({ id: "task-4", title: "Tied ordinal B", ordinal: 20 }),
			],
		});

		const ordinalButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Ordinal"),
		);
		expect(ordinalButton).toBeTruthy();

		await clickElement(ordinalButton as HTMLButtonElement);
		await waitFor(() => getRenderedTaskIds(container)[0] === "task-3");

		expect(getRenderedTaskIds(container)).toEqual(["task-3", "task-2", "task-4", "task-1"]);
		expect(container.querySelector("th[aria-sort='ascending']")?.textContent).toContain("Ordinal");

		await clickElement(ordinalButton as HTMLButtonElement);
		await waitFor(() => getRenderedTaskIds(container)[0] === "task-2");

		expect(getRenderedTaskIds(container)).toEqual(["task-2", "task-4", "task-3", "task-1"]);
		expect(container.querySelector("th[aria-sort='descending']")?.textContent).toContain("Ordinal");
	});

	it("renders the labels menu above the sticky table header", async () => {
		const container = renderTaskList();
		const labelsButton = getLabelsButton(container);

		await clickElement(labelsButton);

		const labelsMenu = container.querySelector(`#${LABELS}-menu`);
		const stickyHeader = container.querySelector("div.sticky");

		expect(labelsMenu).toBeTruthy();
		expect(stickyHeader).toBeTruthy();
		expect(labelsMenu?.textContent).toContain("bug");
		expect(labelsButton.getAttribute("aria-haspopup")).toBeNull();
		expect(labelsMenu?.getAttribute("role")).toBeNull();
		expect(getZIndexClass(labelsMenu as Element)).toBeGreaterThan(getZIndexClass(stickyHeader as Element) ?? 0);
	});

	it("allows selecting and clearing a label filter", async () => {
		const fetchCalls = recordFetches();
		const container = renderTaskList(["/?label=bug"]);

		expect(filterSummary(container, LABELS)).toBe("bug");
		expect(getRenderedTaskIds(container)).toEqual(["task-101"]);

		await openFilter(container, LABELS);
		await clickElement(findButton(container, "Clear"));

		expect(filterSummary(container, LABELS)).toBe("All");
		expect(container.querySelector(`#${LABELS}-menu`)).toBeNull();
		expect(getRenderedTaskIds(container)).toEqual(["task-102", "task-101"]);
		expect(fetchCalls).toEqual([]);
	});

	it("keeps legacy single-status URLs working, filtering in the browser", async () => {
		const fetchCalls = recordFetches();
		const progressTask = createTask({ id: "task-201", title: "Progress task", status: "In Progress" });
		const container = renderTaskList(["/?status=In%20Progress"], {
			tasks: [progressTask, createTask({ id: "task-202", title: "Todo task", status: "To Do" })],
			availableStatuses: ["To Do", "In Progress", "Done"],
		});

		expect(getRenderedTaskIds(container)).toEqual(["task-201"]);
		expect(new URLSearchParams(getLocationSearch(container)).get("status")).toBe("In Progress");
		expect(filterSummary(container, STATUS)).toBe("In Progress");
		expect(fetchCalls).toEqual([]);
	});

	it("selects multiple statuses and keeps them in the URL as one list", async () => {
		const filteredTasks = [
			createTask({ id: "task-101", title: "Todo visible", status: "To Do" }),
			createTask({ id: "task-102", title: "Progress visible", status: "In Progress" }),
			createTask({ id: "task-103", title: "Done hidden", status: "Done" }),
		];
		const container = renderTaskList(undefined, {
			tasks: filteredTasks,
			availableStatuses: ["To Do", "In Progress", "Done"],
		});

		await clickOption(container, STATUS, "To Do");
		await clickOption(container, STATUS, "In Progress");

		expect(getRenderedTaskIds(container)).toEqual(["task-102", "task-101"]);
		expect(getLocationSearch(container)).toBe("?status=To%20Do,In%20Progress");
		expect(filterSummary(container, STATUS)).toBe("To Do +1");
		expect(container.textContent).not.toContain("Done hidden");
	});

	it("canonicalizes case-insensitive status deep links, then excludes and clears on further clicks", async () => {
		const doneTask = createTask({ id: "task-101", title: "Done task", status: "Done" });
		const todoTask = createTask({ id: "task-102", title: "Todo task", status: "To Do" });
		const container = renderTaskList(["/?status=done&status=DONE"], {
			tasks: [doneTask, todoTask],
			availableStatuses: ["To Do", "In Progress", "Done"],
		});
		await waitFor(() => getLocationSearch(container) === "?status=Done");

		expect(getLocationSearch(container)).toBe("?status=Done");
		expect(filterSummary(container, STATUS)).toBe("Done");
		expect(getRenderedTaskIds(container)).toEqual(["task-101"]);

		await clickOption(container, STATUS, "Done");
		expect(getLocationSearch(container)).toBe("?status=-Done");
		expect(filterSummary(container, STATUS)).toBe("not Done");
		expect(getRenderedTaskIds(container)).toEqual(["task-102"]);

		await clickOption(container, STATUS, "Done");
		expect(filterSummary(container, STATUS)).toBe("All");
		expect(getLocationSearch(container)).toBe("");
		expect(getRenderedTaskIds(container)).toEqual(["task-102", "task-101"]);
	});

	it("clears all selected statuses and restores the unfiltered task list", async () => {
		const filteredTasks = [
			createTask({ id: "task-101", title: "Todo task", status: "To Do" }),
			createTask({ id: "task-102", title: "Progress task", status: "In Progress" }),
			createTask({ id: "task-103", title: "Done task", status: "Done" }),
		];
		const container = renderTaskList(["/?status=To%20Do&status=In%20Progress"], {
			tasks: filteredTasks,
			availableStatuses: ["To Do", "In Progress", "Done"],
		});
		expect(getRenderedTaskIds(container)).toEqual(["task-102", "task-101"]);

		await clickElement(findButton(container, "Clear filters"));

		expect(new URLSearchParams(getLocationSearch(container)).get("status")).toBeNull();
		expect(filterSummary(container, STATUS)).toBe("All");
		expect(getRenderedTaskIds(container)).toEqual(["task-103", "task-102", "task-101"]);
	});

	it("excludes statuses, and reads the old excludeStatus addresses as exclusions", async () => {
		const filteredTasks = [
			createTask({ id: "task-101", title: "Todo visible", status: "To Do" }),
			createTask({ id: "task-102", title: "Progress visible", status: "In Progress" }),
			createTask({ id: "task-103", title: "Done hidden", status: "Done" }),
		];
		const container = renderTaskList(undefined, {
			tasks: filteredTasks,
			availableStatuses: ["To Do", "In Progress", "Done"],
		});

		await excludeOption(container, STATUS, "Done");

		expect(filterSummary(container, STATUS)).toBe("not Done");
		expect(getLocationSearch(container)).toBe("?status=-Done");
		expect(getRenderedTaskIds(container)).toEqual(["task-102", "task-101"]);
		expect(container.textContent).not.toContain("Done hidden");

		act(() => {
			activeRoot?.unmount();
		});
		const legacy = renderTaskList(["/?excludeStatus=Done&excludeStatuses=In%20Progress"], {
			tasks: filteredTasks,
			availableStatuses: ["To Do", "In Progress", "Done"],
		});
		await waitFor(() => getLocationSearch(legacy) === "?status=-Done,-In%20Progress");
		expect(getLocationSearch(legacy)).toBe("?status=-Done,-In%20Progress");
		expect(getRenderedTaskIds(legacy)).toEqual(["task-101"]);
	});

	it("uses default statuses for the status menu when no statuses are provided", async () => {
		const container = renderTaskList(undefined, { availableStatuses: [] });

		await openFilter(container, STATUS);

		expect(optionLabels(container, STATUS)).toEqual(["To Do", "In Progress", "Done"]);
		expect(container.querySelector(`#${STATUS}-menu`)?.textContent).not.toContain("No statuses");
	});

	it("canonicalizes mixed-case configured priority URL values", async () => {
		const customTask = createTask({ id: "task-301", title: "Escalate incident", priority: "very high" });
		const container = renderTaskList(["/?priority=VeRy%20HiGh"], {
			tasks: [customTask, createTask({ id: "task-302", title: "Routine chore", priority: "low" })],
			availablePriorities: ["Very High", "High", "Medium", "Low"],
		});
		await waitFor(() => new URLSearchParams(getLocationSearch(container)).get("priority") === "very high");

		expect(new URLSearchParams(getLocationSearch(container)).get("priority")).toBe("very high");
		expect(filterSummary(container, "task-list-filter-priority")).toBe("Very High");
		expect(getRenderedTaskIds(container)).toEqual(["task-301"]);
	});

	it("clears unsupported priority URL values", async () => {
		const fetchCalls = recordFetches();
		const container = renderTaskList(["/?priority=urgent"]);
		await waitFor(() => new URLSearchParams(getLocationSearch(container)).get("priority") === null);

		expect(fetchCalls).toEqual([]);
		expect(filterSummary(container, "task-list-filter-priority")).toBe("All");
		expect(getRenderedTaskIds(container)).toEqual(["task-102", "task-101"]);
	});

	it("filters by type, who asked and blocked, as the board does", async () => {
		const container = renderTaskList(undefined, {
			tasks: [
				createTask({ id: "task-1", type: "bug", labels: ["from:the-house"] }),
				createTask({ id: "task-2", type: "feature", labels: ["from:depot-worker", "blocked"] }),
				createTask({ id: "task-3", type: "chore" }),
			],
			availableTypes: ["bug", "feature", "chore"],
		});

		await clickOption(container, "task-list-filter-type", "bug");
		await clickOption(container, "task-list-filter-type", "feature");
		expect(getRenderedTaskIds(container)).toEqual(["task-2", "task-1"]);

		await excludeOption(container, "task-list-filter-askedBy", "the-house");
		expect(getRenderedTaskIds(container)).toEqual(["task-2"]);

		const hideBlocked = container.querySelector("[data-filter-option='blocked'] button[aria-pressed]");
		await clickElement(hideBlocked as HTMLButtonElement);
		expect(getRenderedTaskIds(container)).toEqual([]);
		expect(getLocationSearch(container)).toBe("?type=bug,feature&from=-the-house&blocked=0");
		expect(container.textContent).toContain("No tasks match the current filters");
	});

	it("shows cleanup when filtering by the final configured status", async () => {
		const closedTask = createTask({ id: "task-201", title: "Closed task", status: "Closed" });
		const container = renderTaskList(undefined, {
			tasks: [closedTask],
			availableStatuses: ["To Do", "Review", "Closed"],
		});
		await clickOption(container, STATUS, "Closed");

		expect(container.textContent).toContain("Clean Up");
	});

	it("does not show cleanup when filtering by a non-terminal status", async () => {
		const reviewTask = createTask({ id: "task-202", title: "Review task", status: "Review" });
		const container = renderTaskList(undefined, {
			tasks: [reviewTask],
			availableStatuses: ["To Do", "Review", "Closed"],
		});
		await clickOption(container, STATUS, "Review");

		expect(container.textContent).toContain("Review task");
		expect(container.textContent).not.toContain("Clean Up");
	});
});
