import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import type { Task } from "../types/index.ts";
import BoardPage from "../web/components/BoardPage.tsx";
import { WebUserProvider } from "../web/contexts/WebUserContext";
import { chipTexts, clickOption, excludeOption, filterSummary } from "./filter-menu-helpers.ts";

const STATUSES = ["To Do", "Approved", "In Progress", "Waiting on you", "Done"];

const createTask = (overrides: Partial<Task>): Task => ({
	id: "TASK-1",
	title: "Task",
	status: "To Do",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-09-26 10:00",
	...overrides,
});

const tasks: Task[] = [
	createTask({ id: "TASK-1", title: "Proposal from depot", labels: ["from:depot-worker", "depot"], ordinal: 1000 }),
	createTask({
		id: "TASK-2",
		title: "Proposal asked back",
		labels: ["from:the-house"],
		ordinal: 2000,
		comments: [{ index: 1, author: "user", createdDate: "2026-09-26 10:05", body: "Which screens?" }],
	}),
	createTask({
		id: "TASK-3",
		title: "Question for the user",
		status: "Waiting on you",
		assignee: ["@user"],
		labels: ["from:the-house"],
		comments: [{ index: 1, author: "the-house", createdDate: "2026-09-26 10:05", body: "Context" }],
	}),
	createTask({ id: "TASK-4", title: "Work in progress", status: "In Progress", assignee: ["@sugar-bounce"] }),
];

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;

const renderBoard = (url = "http://localhost/board") => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
	activeDom = dom;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as unknown as Document;
	globalThis.navigator = dom.window.navigator as unknown as Navigator;
	globalThis.localStorage = dom.window.localStorage as unknown as Storage;
	const container = document.getElementById("root") as HTMLElement;
	const opened: string[] = [];
	activeRoot = createRoot(container);
	act(() => {
		activeRoot?.render(
			<BrowserRouter>
				<WebUserProvider value="user">
					<BoardPage
						tasks={tasks}
						statuses={STATUSES}
						milestones={[]}
						availableLabels={[]}
						milestoneEntities={[]}
						archivedMilestones={[]}
						isLoading={false}
						onEditTask={(task) => opened.push(task.id)}
						onNewTask={() => {}}
					/>
				</WebUserProvider>
			</BrowserRouter>,
		);
	});
	return { container, opened };
};

const column = (container: HTMLElement, status: string): HTMLElement => {
	const heading = Array.from(container.querySelectorAll("h3")).find((element) => element.textContent === status);
	expect(heading, status).toBeTruthy();
	return heading?.closest("[data-decision-column], .rounded-lg") as HTMLElement;
};

afterEach(() => {
	act(() => {
		activeRoot?.unmount();
	});
	activeRoot = null;
	activeDom?.window.close();
	activeDom = null;
});

describe("board decisions", () => {
	it("counts what needs the person and opens the first undecided card of each queue", () => {
		const { container, opened } = renderBoard();
		const strip = container.querySelector("[aria-label='Decisions waiting']") as HTMLElement;
		expect(strip).toBeTruthy();
		const [answer, review] = Array.from(strip.querySelectorAll("button"));
		// TASK-2's latest comment is the user's, so it waits on its session, not on the user.
		expect(answer?.textContent).toContain("1Waiting on you");
		expect(review?.textContent).toContain("1To Do");

		act(() => {
			answer?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			review?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		});
		expect(opened).toEqual(["TASK-3", "TASK-1"]);
	});

	it("marks the question column and shows who asked, who replied, and You on the cards", () => {
		const { container } = renderBoard();
		expect(column(container, "Waiting on you").getAttribute("data-decision-column")).toBe("question");
		expect(column(container, "To Do").getAttribute("data-decision-column")).toBe("proposal");
		expect(column(container, "In Progress").getAttribute("data-decision-column")).toBeNull();

		const cardText = (title: string) =>
			Array.from(container.querySelectorAll("[role='button']")).find((card) => card.textContent?.includes(title))
				?.textContent ?? "";
		// from: labels are who asked, not topic chips.
		expect(cardText("Proposal from depot")).toContain("depot-worker");
		expect(cardText("Proposal from depot")).not.toContain("from:depot-worker");
		expect(cardText("Proposal asked back")).toContain("You replied");
		expect(cardText("Question for the user")).toContain("You");
		expect(cardText("Work in progress")).toContain("@sugar-bounce");
	});

	it("filters by who asked, and keeps the filter in the address", async () => {
		const { container } = renderBoard("http://localhost/board?from=the-house");
		expect(filterSummary(container, "board-filter-askedBy")).toBe("the-house");
		const titles = () => Array.from(container.querySelectorAll("[role='button'] h4")).map((title) => title.textContent);
		expect(titles().sort()).toEqual(["Proposal asked back", "Question for the user"]);

		// Several people, and who asked nothing (the person's own cards) left out.
		await clickOption(container, "board-filter-askedBy", "depot-worker");
		await excludeOption(container, "board-filter-askedBy", "No one");
		expect(window.location.search).toBe("?from=the-house,depot-worker,-__none");
		expect(titles().sort()).toEqual(["Proposal asked back", "Proposal from depot", "Question for the user"]);
		expect(chipTexts(container)).toEqual(["Asked by: the-house", "Asked by: depot-worker", "Asked by: Someone"]);
	});
});
