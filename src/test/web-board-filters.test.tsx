import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import type { Task } from "../types/index.ts";
import BoardPage from "../web/components/BoardPage.tsx";
import { apiClient } from "../web/lib/api.ts";
import {
	clickOption,
	filterSummary,
	filterTrigger,
	findButton,
	openFilter,
	optionLabels,
} from "./filter-menu-helpers.ts";
import { pinTimeZone } from "./pin-timezone.ts";

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
	createTask({
		id: "task-101",
		title: "Fix login bug",
		assignee: ["alice"],
		labels: ["bug"],
		milestone: "m-1",
		priority: "high",
		type: "bug",
	}),
	createTask({
		id: "task-102",
		title: "Write docs",
		assignee: ["bob"],
		labels: ["docs"],
		milestone: "m-2",
		priority: "medium",
		type: "docs",
	}),
	createTask({
		id: "task-103",
		title: "Improve board",
		status: "In Progress",
		assignee: ["alice"],
		labels: ["enhancement"],
		milestone: "m-1",
		priority: "low",
		type: "enhancement",
	}),
	createTask({
		id: "task-104",
		title: "Triage unassigned issue",
		labels: ["bug"],
		priority: "medium",
	}),
];

let activeRoot: Root | null = null;

const setupDom = (url = "http://localhost/board") => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
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

const renderBoardPage = (
	url?: string,
	options: {
		tasks?: Task[];
		statuses?: string[];
		availableLabels?: string[];
		availablePriorities?: string[];
		availableTypes?: string[];
		dateFormat?: string;
		onRefreshData?: () => Promise<void>;
		onTasksUpdated?: (tasks: Task[], requestTask: Task) => void;
	} = {},
): HTMLElement => {
	setupDom(url);
	const container = document.getElementById("root");
	expect(container).toBeTruthy();
	const renderedTasks = options.tasks ?? tasks;
	const renderedStatuses = options.statuses ?? ["To Do", "In Progress", "Done"];
	activeRoot = createRoot(container as HTMLElement);
	act(() => {
		activeRoot?.render(
			<BrowserRouter>
				<BoardPage
					tasks={renderedTasks}
					statuses={renderedStatuses}
					milestones={[]}
					availableLabels={options.availableLabels ?? ["bug", "docs", "enhancement"]}
					availablePriorities={options.availablePriorities}
					availableTypes={options.availableTypes}
					milestoneEntities={[]}
					archivedMilestones={[]}
					isLoading={false}
					onEditTask={() => {}}
					onNewTask={() => {}}
					dateFormat={options.dateFormat}
					onRefreshData={options.onRefreshData}
					onTasksUpdated={options.onTasksUpdated}
				/>
			</BrowserRouter>,
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

// A fixed number of event-loop turns is a budget of milliseconds on a fast machine and the
// same milliseconds on a slow one, so the wait is bounded by wall clock instead, and reports
// what it was waiting for rather than `expected true, received false`.
const WAIT_FOR_TIMEOUT_MS = 4000;

const waitFor = async (predicate: () => boolean) => {
	const deadline = Date.now() + WAIT_FOR_TIMEOUT_MS;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out after ${WAIT_FOR_TIMEOUT_MS}ms waiting for ${predicate}`);
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
};

const expectVisibleTasks = (container: HTMLElement, expected: string[]) => {
	const text = container.textContent ?? "";
	for (const title of expected) {
		expect(text).toContain(title);
	}
	for (const task of tasks) {
		if (!expected.includes(task.title)) {
			expect(text).not.toContain(task.title);
		}
	}
};

const searchParams = () => new URLSearchParams(window.location.search);

const expectBoardFiltersInHeader = (container: HTMLElement) => {
	const toolbar = container.querySelector("[aria-label='Board view controls']");
	expect(toolbar).toBeTruthy();
	expect(toolbar?.textContent).toContain("All Tasks");
	expect(toolbar?.textContent).toContain("Milestone");
	const heading = Array.from(container.querySelectorAll("h2")).find(
		(element) => element.textContent?.trim() === "Kanban Board",
	);
	const newTaskButton = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent?.trim() === "+ New Task",
	);
	const header = heading?.parentElement?.parentElement;
	expect(heading).toBeTruthy();
	expect(newTaskButton).toBeTruthy();
	expect(heading?.parentElement?.contains(newTaskButton as HTMLButtonElement)).toBe(true);
	expect(heading?.parentElement?.className).toContain("flex-wrap");
	expect(header?.className).toContain("space-y-3");
	expect(toolbar?.parentElement).toBe(header);
	expect(heading?.parentElement?.contains(toolbar as HTMLElement)).toBe(false);

	const boardFilters = toolbar?.querySelector("[aria-label='Board filters']");
	expect(boardFilters).toBeTruthy();
	expect(container.querySelector("select")).toBeNull();

	for (const [key, label] of [
		["assignee", "Assignee"],
		["label", "Labels"],
		["type", "Type"],
		["priority", "Priority"],
	] as const) {
		const trigger = filterTrigger(container, `board-filter-${key}`);
		expect(boardFilters?.contains(trigger)).toBe(true);
		expect(trigger.textContent).toContain(label);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(trigger.getAttribute("aria-controls")).toBe(`board-filter-${key}-menu`);
		expect(trigger.className).toContain("h-10");
		expect(trigger.className).toContain("rounded-lg");
		expect(trigger.className).toContain("border-gray-300");
		expect(trigger.className).toContain("focus-visible:ring-stone-500");
	}
};

afterEach(() => {
	if (activeRoot) {
		act(() => {
			activeRoot?.unmount();
		});
		activeRoot = null;
	}
});

describe("Web board filters", () => {
	// The cleanup preview renders stored timestamps in the viewer's timezone, so pin one.
	pinTimeZone("Asia/Tokyo");

	it("publishes every returned reorder task without a foreground refresh", async () => {
		const originalReorderTask = apiClient.reorderTask.bind(apiClient);
		const sourceTask = tasks[0];
		const siblingTask = tasks[1];
		if (!sourceTask || !siblingTask) throw new Error("Expected source and sibling tasks");
		const movedTask: Task = { ...sourceTask, status: "In Progress", ordinal: 2000 };
		const rebalancedSibling: Task = { ...siblingTask, ordinal: 3000 };
		let refreshes = 0;
		const publishedTasks: Task[] = [];
		apiClient.reorderTask = async () => ({
			success: true,
			task: movedTask,
			changedTasks: [rebalancedSibling, movedTask],
		});

		try {
			const container = renderBoardPage(undefined, {
				onRefreshData: async () => {
					refreshes += 1;
				},
				onTasksUpdated: (changedTasks) => publishedTasks.push(...changedTasks),
			});
			const targetHeading = Array.from(container.querySelectorAll("h3")).find(
				(heading) => heading.textContent === "In Progress",
			);
			const targetColumn = targetHeading?.closest(".rounded-lg");
			const dropEvent = new window.Event("drop", { bubbles: true, cancelable: true });
			Object.defineProperty(dropEvent, "dataTransfer", {
				value: {
					getData: (type: string) => (type === "text/plain" ? movedTask.id : type === "text/status" ? "To Do" : ""),
				},
			});

			await act(async () => {
				targetColumn?.dispatchEvent(dropEvent);
				await Promise.resolve();
			});
			await waitFor(() => publishedTasks.length === 2);

			expect(publishedTasks).toEqual([rebalancedSibling, movedTask]);
			expect(refreshes).toBe(0);
		} finally {
			apiClient.reorderTask = originalReorderTask;
		}
	});

	it("filters board cards by assignee, label, type, and priority while updating URL params", async () => {
		const container = renderBoardPage(undefined, {
			availableTypes: ["Bug", "Docs", "Enhancement"],
		});

		expectBoardFiltersInHeader(container);
		expectVisibleTasks(container, ["Fix login bug", "Write docs", "Improve board", "Triage unassigned issue"]);

		await clickOption(container, "board-filter-assignee", "alice");
		expect(searchParams().get("assignee")).toBe("alice");
		expect(filterSummary(container, "board-filter-assignee")).toBe("alice");
		expectVisibleTasks(container, ["Fix login bug", "Improve board"]);

		await clickOption(container, "board-filter-label", "bug");
		expect(searchParams().get("label")).toBe("bug");
		expectVisibleTasks(container, ["Fix login bug"]);

		await clickOption(container, "board-filter-label", "enhancement");
		expect(searchParams().get("label")).toBe("bug,enhancement");
		expect(window.location.search).toContain("label=bug,enhancement");
		expect(filterSummary(container, "board-filter-label")).toBe("bug +1");
		expectVisibleTasks(container, ["Fix login bug", "Improve board"]);

		await clickOption(container, "board-filter-type", "Bug");
		expect(searchParams().get("type")).toBe("Bug");
		expectVisibleTasks(container, ["Fix login bug"]);

		await clickOption(container, "board-filter-priority", "High");
		expect(searchParams().get("priority")).toBe("high");
		expectVisibleTasks(container, ["Fix login bug"]);
	});

	it("renders and filters configured custom priorities", async () => {
		const customTasks = [
			...tasks,
			createTask({
				id: "task-105",
				title: "Escalate production incident",
				priority: "very high",
			}),
		];
		const container = renderBoardPage(undefined, {
			tasks: customTasks,
			availablePriorities: ["Very High", "High", "Medium", "Low", "Very Low"],
		});

		await openFilter(container, "board-filter-priority");
		expect(optionLabels(container, "board-filter-priority")).toEqual(["Very High", "High", "Medium", "Low", "Very Low"]);

		await clickOption(container, "board-filter-priority", "Very High");
		const text = container.textContent ?? "";
		expect(searchParams().get("priority")).toBe("very high");
		expect(text).toContain("Escalate production incident");
		expect(text).toContain("Very High");
		expect(text).not.toContain("Fix login bug");
	});

	it("renders configured task types and canonicalizes type filters from the URL", async () => {
		const customTasks = [
			createTask({ id: "task-201", title: "Fix checkout", type: "Bug" }),
			createTask({ id: "task-202", title: "Interview customers", type: "Customer Request" }),
			createTask({ id: "task-203", title: "Unclassified follow-up" }),
		];
		const container = renderBoardPage("http://localhost/board?type=customer%20request", {
			tasks: customTasks,
			availableTypes: ["Bug", "Customer Request"],
		});

		await waitFor(() => searchParams().get("type") === "Customer Request");

		await openFilter(container, "board-filter-type");
		expect(optionLabels(container, "board-filter-type")).toEqual(["No type", "Bug", "Customer Request"]);
		expect(filterSummary(container, "board-filter-type")).toBe("Customer Request");
		expect(container.textContent).toContain("Interview customers");
		expect(container.textContent).not.toContain("Fix checkout");
		expect(container.textContent).not.toContain("Unclassified follow-up");
	});

	it("clears unsupported task type URL values", async () => {
		const container = renderBoardPage("http://localhost/board?type=unsupported", {
			availableTypes: ["Bug", "Feature"],
		});

		await waitFor(() => searchParams().get("type") === null);

		expect(filterSummary(container, "board-filter-type")).toBe("All");
		expectVisibleTasks(container, ["Fix login bug", "Write docs", "Improve board", "Triage unassigned issue"]);
	});

	it("keeps the supported values of a type list and drops the rest", async () => {
		const container = renderBoardPage("http://localhost/board?type=bug,unsupported,-DOCS", {
			availableTypes: ["Bug", "Docs", "Enhancement"],
		});

		await waitFor(() => searchParams().get("type") === "Bug,-Docs");

		expect(filterSummary(container, "board-filter-type")).toBe("Bug +1");
		expectVisibleTasks(container, ["Fix login bug"]);
	});

	it("canonicalizes mixed-case configured priority URL values", async () => {
		const customTasks = [
			...tasks,
			createTask({
				id: "task-105",
				title: "Escalate production incident",
				priority: "very high",
			}),
		];
		const container = renderBoardPage("http://localhost/board?priority=VeRy%20HiGh", {
			tasks: customTasks,
			availablePriorities: ["Very High", "High", "Medium", "Low"],
		});

		await waitFor(() => searchParams().get("priority") === "very high");

		expect(filterSummary(container, "board-filter-priority")).toBe("Very High");
		expect(container.textContent).toContain("Escalate production incident");
		expect(container.textContent).not.toContain("Fix login bug");
	});

	it("clears unsupported priority URL values", async () => {
		const container = renderBoardPage("http://localhost/board?priority=urgent");

		await waitFor(() => searchParams().get("priority") === null);

		expect(filterSummary(container, "board-filter-priority")).toBe("All");
		expectVisibleTasks(container, ["Fix login bug", "Write docs", "Improve board", "Triage unassigned issue"]);
	});

	it("matches configured label casing against task labels", async () => {
		const container = renderBoardPage(undefined, {
			availableLabels: ["Bug", "Docs", "enhancement"],
		});

		await clickOption(container, "board-filter-label", "Bug");

		expect(searchParams().get("label")).toBe("Bug");
		expect(filterSummary(container, "board-filter-label")).toBe("Bug");
		expectVisibleTasks(container, ["Fix login bug", "Triage unassigned issue"]);
	});

	it("reads filters from URL params and clears them without removing unrelated params", async () => {
		const container = renderBoardPage(
			"http://localhost/board?assignee=alice&label=bug&priority=high&type=bug&view=compact",
			{ availableTypes: ["Bug", "Feature"] },
		);
		await waitFor(() => searchParams().get("type") === "Bug");

		expect(filterSummary(container, "board-filter-assignee")).toBe("alice");
		expect(filterSummary(container, "board-filter-label")).toBe("bug");
		expect(filterSummary(container, "board-filter-priority")).toBe("High");
		expect(filterSummary(container, "board-filter-type")).toBe("Bug");
		expectVisibleTasks(container, ["Fix login bug"]);

		await clickElement(findButton(container, "Clear filters"));

		const params = searchParams();
		expect(params.get("assignee")).toBeNull();
		expect(params.get("label")).toBeNull();
		expect(params.get("priority")).toBeNull();
		expect(params.get("type")).toBeNull();
		expect(params.get("view")).toBe("compact");
		expectVisibleTasks(container, ["Fix login bug", "Write docs", "Improve board", "Triage unassigned issue"]);
	});

	it("uses active board filters for milestone lane metadata", async () => {
		const container = renderBoardPage("http://localhost/board?lane=milestone");

		expect(container.textContent).toContain("m-1");
		expect(container.textContent).toContain("m-2");

		await clickOption(container, "board-filter-assignee", "alice");

		const text = container.textContent ?? "";
		expect(text).toContain("Fix login bug");
		expect(text).toContain("Improve board");
		expect(text).not.toContain("m-2");
		expect(text).not.toContain("Write docs");
	});

	it("shows cleanup on the final configured status column when it is not named Done", () => {
		const container = renderBoardPage(undefined, {
			statuses: ["To Do", "Review", "Closed"],
			tasks: [createTask({ id: "task-200", title: "Closed task", status: "Closed" })],
		});

		const cleanupButtons = Array.from(container.querySelectorAll("button")).filter((button) =>
			button.textContent?.includes("Clean Up Old Tasks"),
		);
		expect(cleanupButtons).toHaveLength(1);
	});

	it("uses the configured date format in the board cleanup preview", async () => {
		const originalGetCleanupPreview = apiClient.getCleanupPreview.bind(apiClient);
		apiClient.getCleanupPreview = async (age) => {
			expect(age).toBe(1);
			return {
				count: 1,
				tasks: [
					{
						id: "task-200",
						title: "Closed task",
						createdDate: "2026-02-09 06:01",
					},
				],
			};
		};

		try {
			const container = renderBoardPage(undefined, {
				statuses: ["To Do", "Review", "Closed"],
				tasks: [createTask({ id: "task-200", title: "Closed task", status: "Closed" })],
				dateFormat: "dd/mm/yyyy",
			});

			const cleanupButton = Array.from(container.querySelectorAll("button")).find((button) =>
				button.textContent?.includes("Clean Up Old Tasks"),
			);
			expect(cleanupButton).toBeTruthy();
			await clickElement(cleanupButton as Element);

			const oneDayButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "1 day");
			expect(oneDayButton).toBeTruthy();
			await clickElement(oneDayButton as Element);

			await waitFor(() => (container.textContent ?? "").includes("09/02/2026 15:01"));
			expect(container.textContent).not.toContain("2026-02-09 06:01");
			const renderedDate = Array.from(container.querySelectorAll("span[title]")).find(
				(element) => element.textContent === "09/02/2026 15:01",
			);
			expect(renderedDate?.getAttribute("title")).toBe("09/02/2026 06:01 (UTC)");
		} finally {
			apiClient.getCleanupPreview = originalGetCleanupPreview;
		}
	});
});
