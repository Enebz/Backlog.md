import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import type { Task } from "../types/index.ts";
import BoardPage from "../web/components/BoardPage.tsx";
import { WebUserProvider } from "../web/contexts/WebUserContext";
import {
	chipTexts,
	clickElement,
	clickOption,
	excludeOption,
	filterMenu,
	filterSummary,
	filterTrigger,
	findButton,
	findChip,
	openFilter,
	optionCounts,
	optionLabels,
	optionState,
	pressKey,
} from "./filter-menu-helpers.ts";
import { setNativeInputValue } from "./react-dom-input.ts";

const createTask = (overrides: Partial<Task>): Task => ({
	id: "TASK-1",
	title: "Task",
	status: "To Do",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-09-27 10:00",
	...overrides,
});

const TASKS: Task[] = [
	createTask({
		id: "TASK-1",
		title: "Fix login bug",
		type: "bug",
		labels: ["bug", "ui"],
		assignee: ["@alice"],
		priority: "high",
		milestone: "m-1",
	}),
	createTask({
		id: "TASK-2",
		title: "Write docs",
		type: "docs",
		labels: ["docs"],
		assignee: ["@bob"],
		priority: "medium",
		milestone: "m-2",
	}),
	createTask({
		id: "TASK-3",
		title: "Improve board",
		status: "In Progress",
		type: "enhancement",
		labels: ["ui", "sound"],
		assignee: ["@alice"],
		priority: "low",
	}),
	createTask({ id: "TASK-4", title: "Triage issue", labels: ["bug", "from:the-house"], priority: "medium" }),
	createTask({ id: "TASK-5", title: "Mix the sounds", type: "chore", labels: ["sound", "blocked"], assignee: ["@carol"] }),
];

const TYPES = ["bug", "docs", "enhancement", "chore", "feature"];

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

const renderBoard = (path = "/board", availableLabels: string[] = []): HTMLElement => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
		url: `http://localhost${path}`,
	});
	activeDom = dom;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as unknown as Document;
	globalThis.navigator = dom.window.navigator as unknown as Navigator;
	globalThis.localStorage = dom.window.localStorage as unknown as Storage;
	const htmlElementPrototype = window.HTMLElement.prototype as unknown as {
		attachEvent?: () => void;
		detachEvent?: () => void;
	};
	htmlElementPrototype.attachEvent ??= () => {};
	htmlElementPrototype.detachEvent ??= () => {};
	const container = document.getElementById("root") as HTMLElement;
	activeRoot = createRoot(container);
	act(() => {
		activeRoot?.render(
			<BrowserRouter>
				<WebUserProvider value="alice">
					<BoardPage
						tasks={TASKS}
						statuses={["To Do", "In Progress", "Done"]}
						milestones={[]}
						availableLabels={availableLabels}
						availableTypes={TYPES}
						milestoneEntities={[
							{ id: "m-1", title: "Release 1", description: "", rawContent: "" },
							{ id: "m-2", title: "Release 2", description: "", rawContent: "" },
						]}
						archivedMilestones={[]}
						isLoading={false}
						onEditTask={() => {}}
						onNewTask={() => {}}
					/>
				</WebUserProvider>
			</BrowserRouter>,
		);
	});
	return container;
};

const cardTitles = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("[role='button'] h4"))
		.map((title) => title.textContent ?? "")
		.sort();

const search = () => window.location.search;

const waitFor = async (predicate: () => boolean, what: string) => {
	const deadline = Date.now() + 4000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
};

afterEach(() => {
	act(() => {
		activeRoot?.unmount();
	});
	activeRoot = null;
	activeDom?.window.close();
	activeDom = null;
});

describe("board filters with several values", () => {
	it("ORs the values of one filter and ANDs the filters, in a shareable address", async () => {
		const container = renderBoard();

		await clickOption(container, "board-filter-type", "bug");
		await clickOption(container, "board-filter-type", "docs");
		expect(search()).toBe("?type=bug,docs");
		expect(filterSummary(container, "board-filter-type")).toBe("bug +1");
		expect(cardTitles(container)).toEqual(["Fix login bug", "Write docs"]);

		await clickOption(container, "board-filter-assignee", "You (@alice)");
		expect(search()).toBe("?type=bug,docs&assignee=@alice");
		expect(cardTitles(container)).toEqual(["Fix login bug"]);
		expect(chipTexts(container)).toEqual(["Assignee: You (@alice)", "Type: bug", "Type: docs"]);
	});

	it("excludes with the ⊘ control or a second click, and a chip takes its value away", async () => {
		const container = renderBoard();

		await excludeOption(container, "board-filter-type", "chore");
		expect(search()).toBe("?type=-chore");
		expect(optionState(container, "board-filter-type", "chore")).toBe("exclude");
		expect(filterSummary(container, "board-filter-type")).toBe("not chore");
		// A task without a type is not a chore, so it stays.
		expect(cardTitles(container)).toEqual(["Fix login bug", "Improve board", "Triage issue", "Write docs"]);

		await clickOption(container, "board-filter-label", "sound");
		await clickOption(container, "board-filter-label", "sound");
		expect(search()).toBe("?type=-chore&label=-sound");
		expect(chipTexts(container)).toEqual(["Labels: not sound", "Type: not chore"]);
		expect(cardTitles(container)).toEqual(["Fix login bug", "Triage issue", "Write docs"]);

		// A third click clears the value.
		await clickOption(container, "board-filter-label", "sound");
		expect(search()).toBe("?type=-chore");

		await clickElement(findChip(container, "Type: not chore"));
		expect(search()).toBe("");
		expect(chipTexts(container)).toEqual([]);
		expect(cardTitles(container)).toHaveLength(TASKS.length);
	});

	it("includes and excludes in the same filter", async () => {
		const container = renderBoard("/board?label=ui,bug,-sound");
		// ui or bug, but nothing with sound: Improve board has ui and sound.
		expect(cardTitles(container)).toEqual(["Fix login bug", "Triage issue"]);
		expect(filterSummary(container, "board-filter-label")).toBe("ui +2");
		await openFilter(container, "board-filter-label");
		expect(optionState(container, "board-filter-label", "ui")).toBe("include");
		expect(optionState(container, "board-filter-label", "sound")).toBe("exclude");
		expect(optionState(container, "board-filter-label", "docs")).toBe("off");
	});

	it("counts each option under the other filters, and offers no-value options that have tasks", async () => {
		const container = renderBoard("/board?assignee=@alice");

		await openFilter(container, "board-filter-type");
		expect(optionLabels(container, "board-filter-type")).toEqual(["No type", ...TYPES]);
		// Alice's cards: one bug, one enhancement. The type filter itself does not narrow its own counts.
		expect(optionCounts(container, "board-filter-type")).toEqual({
			"No type": 0,
			bug: 1,
			docs: 0,
			enhancement: 1,
			chore: 0,
			feature: 0,
		});

		await openFilter(container, "board-filter-assignee");
		expect(optionCounts(container, "board-filter-assignee")).toEqual({
			Unassigned: 1,
			"You (@alice)": 2,
			"@bob": 1,
			"@carol": 1,
		});
		// The labels offered are topics: from: labels have the Asked by filter.
		await openFilter(container, "board-filter-label");
		expect(optionLabels(container, "board-filter-label")).not.toContain("from:the-house");
		await openFilter(container, "board-filter-askedBy");
		expect(optionLabels(container, "board-filter-askedBy")).toEqual(["No one", "the-house"]);
	});

	it("searches a long list, and Enter in the search includes the first match", async () => {
		const many = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"];
		const container = renderBoard("/board", many);

		const menu = await openFilter(container, "board-filter-label");
		const input = menu.querySelector("input[type='search']") as HTMLInputElement;
		expect(input).toBeTruthy();
		expect(document.activeElement).toBe(input);

		await act(async () => {
			setNativeInputValue(input, "SOU");
			await Promise.resolve();
		});
		expect(optionLabels(container, "board-filter-label")).toEqual(["sound"]);

		await pressKey(input, "Enter");
		expect(search()).toBe("?label=sound");
		expect(cardTitles(container)).toEqual(["Improve board", "Mix the sounds"]);

		await act(async () => {
			setNativeInputValue(input, "nothing like it");
			await Promise.resolve();
		});
		expect(filterMenu(container, "board-filter-label")?.textContent).toContain("No matches");
	});

	it("works from the keyboard: arrows move, - excludes, Escape closes back to the trigger", async () => {
		const container = renderBoard();
		const trigger = filterTrigger(container, "board-filter-type");
		trigger.focus();

		await pressKey(trigger, "ArrowDown");
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		const focusedOption = () => document.activeElement?.closest("[data-filter-option]")?.getAttribute("data-label");
		expect(focusedOption()).toBe("No type");

		await pressKey(document.activeElement, "ArrowDown");
		expect(focusedOption()).toBe("bug");
		expect(document.activeElement?.getAttribute("tabindex")).toBe("0");

		await pressKey(document.activeElement, "-");
		expect(search()).toBe("?type=-bug");

		await pressKey(document.activeElement, "ArrowRight");
		expect(document.activeElement?.getAttribute("aria-label")).toBe("Exclude bug");
		expect(document.activeElement?.getAttribute("aria-pressed")).toBe("true");
		await pressKey(document.activeElement, "ArrowLeft");
		expect(document.activeElement?.getAttribute("role")).toBe("checkbox");

		await pressKey(document.activeElement, "End");
		expect(focusedOption()).toBe("feature");

		await pressKey(document.activeElement, "Escape");
		expect(filterMenu(container, "board-filter-type")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("clears one filter from its menu, and all of them with Clear filters", async () => {
		const container = renderBoard("/board?type=bug,docs&priority=high");

		await openFilter(container, "board-filter-type");
		await clickElement(findButton(container, "Clear"));
		expect(search()).toBe("?priority=high");
		expect(filterMenu(container, "board-filter-type")).toBeNull();

		await clickElement(findButton(container, "Clear filters"));
		expect(search()).toBe("");
	});

	it("filters by milestone, and by having none", async () => {
		const container = renderBoard();
		await openFilter(container, "board-filter-milestone");
		expect(optionLabels(container, "board-filter-milestone")).toEqual(["No milestone", "Release 1", "Release 2"]);

		await clickOption(container, "board-filter-milestone", "Release 1");
		await clickOption(container, "board-filter-milestone", "No milestone");
		expect(search()).toBe("?milestone=m-1,__none");
		expect(cardTitles(container)).toEqual(["Fix login bug", "Improve board", "Mix the sounds", "Triage issue"]);
		expect(chipTexts(container)).toEqual(["Milestone: Release 1", "Milestone: No milestone"]);

		await excludeOption(container, "board-filter-milestone", "No milestone");
		expect(chipTexts(container)).toEqual(["Milestone: Release 1", "Milestone: Any milestone"]);
		expect(cardTitles(container)).toEqual(["Fix login bug"]);
	});

	it("hides the blocked cards from the strip's ⊘, or shows only them", async () => {
		const container = renderBoard();
		const strip = container.querySelector("[aria-label='Blocked cards']") as HTMLElement;
		const hide = strip.querySelector("button[aria-label='Hide blocked cards']") as HTMLButtonElement;
		const only = Array.from(strip.querySelectorAll("button")).find((button) => button.textContent?.includes("Blocked"));

		await clickElement(hide);
		expect(search()).toBe("?blocked=0");
		expect(hide.getAttribute("aria-pressed")).toBe("true");
		expect(strip.textContent).toContain("hidden from the board");
		expect(cardTitles(container)).not.toContain("Mix the sounds");
		expect(chipTexts(container)).toEqual(["Not blocked"]);

		await clickElement(only);
		expect(search()).toBe("?blocked=1");
		expect(cardTitles(container)).toEqual(["Mix the sounds"]);
		expect(chipTexts(container)).toEqual(["Blocked"]);

		await clickElement(findChip(container, "Blocked"));
		expect(search()).toBe("");
	});

	it("keeps the old single-value addresses working, and rewrites them as lists", async () => {
		const container = renderBoard(
			"/board?from=the-house&assignee=__unassigned__&label=bug&label=from:the-house&labels=ui&view=compact",
		);
		await waitFor(() => search() === "?from=the-house&assignee=__none&label=bug,from:the-house,ui&view=compact", "a rewritten address");
		expect(cardTitles(container)).toEqual(["Triage issue"]);
		expect(filterSummary(container, "board-filter-askedBy")).toBe("the-house");
		expect(filterSummary(container, "board-filter-assignee")).toBe("Unassigned");

		act(() => {
			activeRoot?.unmount();
		});
		const blocked = renderBoard("/board?blocked=true");
		await waitFor(() => search() === "?blocked=1", "blocked=1");
		expect(cardTitles(blocked)).toEqual(["Mix the sounds"]);
	});

	it("puts each change in the history, so Back undoes it", async () => {
		const container = renderBoard();
		await clickOption(container, "board-filter-type", "bug");
		await clickOption(container, "board-filter-type", "docs");
		expect(search()).toBe("?type=bug,docs");

		await act(async () => {
			window.history.back();
		});
		await waitFor(() => search() === "?type=bug", "the previous filter");
		expect(cardTitles(container)).toEqual(["Fix login bug"]);
		expect(filterSummary(container, "board-filter-type")).toBe("bug");

		await act(async () => {
			window.history.back();
		});
		await waitFor(() => search() === "", "no filter");
		expect(cardTitles(container)).toHaveLength(TASKS.length);
	});

	it("folds the filters behind a button that counts the chosen values, with the chips still in view", async () => {
		const container = renderBoard("/board?type=bug,-chore&priority=high");
		const toggle = container.querySelector("button[aria-controls='board-filter-controls']") as HTMLButtonElement;
		const controls = container.querySelector("#board-filter-controls") as HTMLElement;
		expect(toggle.className).toContain("sm:hidden");
		expect(toggle.textContent).toBe("Filters3");
		expect(controls.className.split(" ")).toContain("hidden");
		expect(chipTexts(container)).toHaveLength(3);

		await clickElement(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(toggle.textContent).toBe("Hide filters3");
		expect(controls.className.split(" ")).toContain("grid");
	});
});
