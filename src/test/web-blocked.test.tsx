import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { Task } from "../types/index.ts";
import BoardPage from "../web/components/BoardPage.tsx";
import TaskList from "../web/components/TaskList.tsx";
import { WebUserProvider } from "../web/contexts/WebUserContext";

const STATUSES = ["To Do", "Approved", "In Progress", "Waiting on you", "Done"];

const createTask = (overrides: Partial<Task>): Task => ({
	id: "TASK-1",
	title: "Task",
	status: "In Progress",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-09-26 10:00",
	...overrides,
});

const tasks: Task[] = [
	createTask({
		id: "TASK-42",
		title: "Upload the improved build",
		labels: ["blocked", "sugar-bounce"],
		comments: [
			{
				index: 1,
				author: "sugar-bounce",
				createdDate: "2026-09-27 03:10",
				body: "Blocked: waiting on the user's call on the math (TASK-93). -- sugar-bounce",
			},
			{ index: 2, author: "sugar-bounce", createdDate: "2026-09-27 03:20", body: "Meanwhile on TASK-89." },
		],
	}),
	createTask({
		id: "TASK-61",
		title: "Remake the art",
		comments: [
			{ index: 1, author: "sugar-bounce", createdDate: "2026-09-27 03:40", body: "Blocked: an art allowance on the Desk" },
		],
	}),
	createTask({ id: "TASK-40", title: "Pick a display face", status: "To Do" }),
	createTask({ id: "TASK-41", title: "Swap the fonts", status: "To Do", dependencies: ["TASK-40"] }),
	createTask({
		id: "TASK-5",
		title: "Resumed work",
		comments: [
			{ index: 1, author: "the-house", createdDate: "2026-09-26 11:00", body: "Blocked: waiting on the brand" },
			{ index: 2, author: "the-house", createdDate: "2026-09-26 12:00", body: "Picked up again." },
		],
	}),
	createTask({ id: "TASK-6", title: "Finished despite the label", status: "Done", labels: ["blocked"] }),
];

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

const setupDom = (url = "http://localhost/") => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
	activeDom = dom;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as unknown as Document;
	globalThis.navigator = dom.window.navigator as unknown as Navigator;
	globalThis.localStorage = dom.window.localStorage as unknown as Storage;
	globalThis.Element = dom.window.Element;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLInputElement = dom.window.HTMLInputElement;
	globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
	globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
	globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
	globalThis.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle);
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
	const htmlElementPrototype = window.HTMLElement.prototype as unknown as {
		attachEvent?: () => void;
		detachEvent?: () => void;
	};
	htmlElementPrototype.attachEvent = () => {};
	htmlElementPrototype.detachEvent = () => {};
	return document.getElementById("root") as HTMLElement;
};

afterEach(() => {
	act(() => {
		activeRoot?.unmount();
	});
	activeRoot = null;
	activeDom?.window.close();
	activeDom = null;
});

const LocationSearch = () => <output data-testid="location-search">{useLocation().search}</output>;

const click = async (element: Element | null | undefined) => {
	expect(element).toBeTruthy();
	await act(async () => {
		element?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
		await Promise.resolve();
	});
};

const renderBoard = (search = "") => {
	const container = setupDom();
	activeRoot = createRoot(container);
	act(() => {
		activeRoot?.render(
			<MemoryRouter initialEntries={[`/board${search}`]}>
				<WebUserProvider value="user">
					<BoardPage
						tasks={tasks}
						statuses={STATUSES}
						milestones={[]}
						availableLabels={[]}
						milestoneEntities={[]}
						archivedMilestones={[]}
						isLoading={false}
						onEditTask={() => {}}
						onNewTask={() => {}}
					/>
					<LocationSearch />
				</WebUserProvider>
			</MemoryRouter>,
		);
	});
	return container;
};

const card = (container: HTMLElement, id: string) =>
	Array.from(container.querySelectorAll<HTMLElement>("[role='button'][aria-label]")).find((element) =>
		element.getAttribute("aria-label")?.startsWith(`Open ${id}:`),
	);

const cardTitles = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("[role='button'] h4"))
		.map((title) => title.textContent)
		.sort();

describe("blocked cards on the board", () => {
	it("marks cards blocked by the label, the latest comment, or an open dependency, and no others", () => {
		const container = renderBoard();
		for (const id of ["TASK-42", "TASK-61", "TASK-41"]) {
			const element = card(container, id);
			expect(element?.getAttribute("data-blocked"), id).toBe("true");
			expect(element?.querySelector("[data-blocked-pill]")?.textContent, id).toBe("Blocked");
		}
		// A later comment cleared TASK-5; TASK-40 blocks others but not itself; a Done card never shows it.
		for (const id of ["TASK-5", "TASK-40", "TASK-6"]) {
			expect(card(container, id)?.getAttribute("data-blocked"), id).toBeNull();
			expect(card(container, id)?.querySelector("[data-blocked-pill]"), id).toBeNull();
		}
	});

	it("gives the reason on hover and to keyboard and screen reader users", () => {
		const container = renderBoard();
		const labelled = card(container, "TASK-42");
		// The signature is dropped: the author is named after the reason.
		expect(labelled?.getAttribute("title")).toBe(
			"Blocked: waiting on the user's call on the math (TASK-93). (sugar-bounce)",
		);
		expect(labelled?.getAttribute("aria-label")).toContain("Blocked: waiting on the user's call on the math");
		const reason = labelled?.querySelector("[data-blocked-reason]");
		expect(reason?.textContent).toContain("waiting on the user's call");
		expect(reason?.className).toContain("group-focus-visible/card:block");

		expect(card(container, "TASK-41")?.getAttribute("title")).toBe("Waiting on TASK-40 Pick a display face");
	});

	it("filters to the blocked cards from the quick filter, and keeps it in the address", async () => {
		const container = renderBoard();
		const toggle = Array.from(container.querySelectorAll("button[aria-pressed]")).find((button) =>
			button.textContent?.includes("Blocked"),
		);
		expect(toggle?.textContent).toContain("3Blocked");
		expect(toggle?.getAttribute("aria-pressed")).toBe("false");

		await click(toggle);
		expect(cardTitles(container)).toEqual(["Remake the art", "Swap the fonts", "Upload the improved build"]);
		expect(container.querySelector("[data-testid='location-search']")?.textContent).toBe("?blocked=1");
		expect(toggle?.getAttribute("aria-pressed")).toBe("true");
		expect(toggle?.textContent).toContain("Show all");

		await click(toggle);
		expect(cardTitles(container)).toHaveLength(tasks.length);
		expect(container.querySelector("[data-testid='location-search']")?.textContent).toBe("");
	});

	it("opens filtered from the address, and Clear filters shows everything again", async () => {
		const container = renderBoard("?blocked=1");
		expect(cardTitles(container)).toHaveLength(3);
		const clear = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Clear filters");
		await click(clear);
		expect(cardTitles(container)).toHaveLength(tasks.length);
	});
});

describe("blocked rows in the task list", () => {
	it("carries the same pill, with the reason on hover", () => {
		const container = setupDom();
		activeRoot = createRoot(container);
		act(() => {
			activeRoot?.render(
				<MemoryRouter>
					<TaskList
						tasks={tasks}
						availableStatuses={STATUSES}
						availableLabels={[]}
						availableMilestones={[]}
						milestoneEntities={[]}
						archivedMilestones={[]}
						onEditTask={() => {}}
						onNewTask={() => {}}
					/>
				</MemoryRouter>,
			);
		});
		const row = (id: string) =>
			Array.from(container.querySelectorAll("tbody tr")).find((element) => element.textContent?.includes(id));
		expect(row("TASK-61")?.querySelector("[data-blocked-pill]")?.getAttribute("title")).toBe(
			"Blocked: an art allowance on the Desk (sugar-bounce)",
		);
		expect(row("TASK-41")?.querySelector("[data-blocked-pill]")?.getAttribute("title")).toBe(
			"Waiting on TASK-40 Pick a display face",
		);
		expect(row("TASK-41")?.querySelector("button")?.getAttribute("aria-label")).toBe(
			"Open TASK-41: Swap the fonts. Waiting on TASK-40 Pick a display face",
		);
		expect(row("TASK-5")?.querySelector("[data-blocked-pill]")).toBeNull();
	});
});
