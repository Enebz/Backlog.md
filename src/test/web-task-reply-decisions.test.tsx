import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Task } from "../types/index.ts";
import { TaskDetailsModal } from "../web/components/TaskDetailsModal";
import { ThemeProvider } from "../web/contexts/ThemeContext";
import { WebUserProvider } from "../web/contexts/WebUserContext";
import { apiClient } from "../web/lib/api.ts";
import { setNativeInputValue } from "./react-dom-input.ts";

const STATUSES = ["To Do", "Approved", "In Progress", "Waiting on you", "Done"];

let activeRoot: Root | null = null;
let activeDom: JSDOM | null = null;
const originalUpdateTask = apiClient.updateTask.bind(apiClient);
let updates: Array<{ id: string; updates: Record<string, unknown> }> = [];

const setupDom = () => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
	activeDom = dom;
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as Document;
	globalThis.navigator = dom.window.navigator as Navigator;
	globalThis.localStorage = dom.window.localStorage;
	globalThis.Element = dom.window.Element;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.HTMLInputElement = dom.window.HTMLInputElement;
	globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
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
	return dom.window.document.getElementById("root") as HTMLElement;
};

const task = (overrides: Partial<Task>): Task => ({
	id: "TASK-1",
	title: "A task",
	status: "To Do",
	assignee: ["@user"],
	createdDate: "2026-09-26 10:00",
	labels: [],
	dependencies: [],
	...overrides,
});

interface MountOptions {
	current: Task;
	tasks: Task[];
	webUserName?: string;
}

const mount = async ({ current, tasks, webUserName = "user" }: MountOptions) => {
	const container = setupDom();
	const navigated: string[] = [];
	let closed = 0;
	activeRoot = createRoot(container);
	await act(async () => {
		activeRoot?.render(
			<ThemeProvider>
				<WebUserProvider value={webUserName}>
					<TaskDetailsModal
						task={current}
						isOpen
						onClose={() => {
							closed += 1;
						}}
						onNavigateToTask={(next) => navigated.push(next.id)}
						availableStatuses={STATUSES}
						availableTasks={tasks}
					/>
				</WebUserProvider>
			</ThemeProvider>,
		);
		await Promise.resolve();
	});
	return { container, navigated, closedCount: () => closed };
};

const flush = async () => {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

const typeReply = async (container: HTMLElement, text: string) => {
	const textarea = container.querySelector("#task-reply") as HTMLTextAreaElement | null;
	expect(textarea).toBeTruthy();
	await act(async () => {
		setNativeInputValue(textarea as HTMLTextAreaElement, text);
		await Promise.resolve();
	});
	return textarea as HTMLTextAreaElement;
};

const clickButton = async (container: HTMLElement, text: string) => {
	const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === text);
	expect(button, `button ${text}`).toBeTruthy();
	await act(async () => {
		button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
	});
	await flush();
};

const press = async (target: Element, key: string, init: KeyboardEventInit = {}) => {
	await act(async () => {
		target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
		await Promise.resolve();
	});
	await flush();
};

beforeEach(() => {
	updates = [];
	apiClient.updateTask = async (id, payload) => {
		updates.push({ id, updates: payload as Record<string, unknown> });
		const status = typeof payload.status === "string" ? payload.status : "To Do";
		return task({ id, status });
	};
});

afterEach(() => {
	apiClient.updateTask = originalUpdateTask;
	if (activeRoot) {
		act(() => {
			activeRoot?.unmount();
		});
		activeRoot = null;
	}
	activeDom?.window.close();
	activeDom = null;
});

describe("proposals", () => {
	const proposals = [
		task({ id: "TASK-1", ordinal: 1000, title: "First proposal" }),
		task({
			id: "TASK-2",
			ordinal: 2000,
			title: "Asked back",
			comments: [{ index: 1, author: "user", createdDate: "2026-09-26 10:05", body: "Which screens?" }],
		}),
		task({ id: "TASK-3", ordinal: 3000, title: "Third proposal" }),
	];

	it("approves with direction in one update, then opens the next proposal needing a decision", async () => {
		const { container, navigated } = await mount({ current: proposals[0] as Task, tasks: proposals });

		await typeReply(container, "Go ahead, phones first.");
		await clickButton(container, "Approve");

		expect(updates).toEqual([
			{ id: "TASK-1", updates: { commentsAppend: ["Go ahead, phones first."], status: "Approved" } },
		]);
		// TASK-2 waits on its session (the user's comment is the latest), so the review skips it.
		expect(navigated).toEqual(["TASK-3"]);
	});

	it("declines to the last status without a comment when none is typed", async () => {
		const { container, navigated } = await mount({ current: proposals[2] as Task, tasks: proposals });

		await clickButton(container, "Decline");

		expect(updates).toEqual([{ id: "TASK-3", updates: { status: "Done" } }]);
		expect(navigated).toEqual(["TASK-1"]);
	});

	it("comments without deciding, and stays on the card", async () => {
		const { container, navigated } = await mount({ current: proposals[0] as Task, tasks: proposals });

		await typeReply(container, "What does it cost?");
		await clickButton(container, "Comment");

		expect(updates).toEqual([{ id: "TASK-1", updates: { commentsAppend: ["What does it cost?"] } }]);
		expect(navigated).toEqual([]);
	});
});

describe("questions", () => {
	const description = ["Should the dev view pass flags through?", "", "Options:", "1. Yes, pass them", "2. No, keep the URL"].join(
		"\n",
	);
	const questions = [
		task({ id: "TASK-10", status: "Waiting on you", ordinal: 1000, description, labels: ["from:the-house"] }),
		task({
			id: "TASK-11",
			status: "Waiting on you",
			ordinal: 2000,
			comments: [{ index: 1, author: "user", createdDate: "2026-09-26 10:05", body: "Answered" }],
		}),
		task({ id: "TASK-12", status: "Waiting on you", ordinal: 3000 }),
	];

	it("shows the options as buttons, suggested first, and answers with the option and the note", async () => {
		const { container, navigated } = await mount({ current: questions[0] as Task, tasks: questions });

		const options = Array.from(container.querySelectorAll("[data-option-number]"));
		expect(options.map((option) => option.getAttribute("data-option-number"))).toEqual(["1", "2"]);
		expect(options[0]?.textContent).toContain("Suggested");
		expect(container.textContent).toContain("Asked by");
		expect(container.textContent).toContain("the-house");

		await typeReply(container, "Revisit after the HUD decision.");
		await act(async () => {
			options[1]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});
		await flush();

		expect(updates).toEqual([
			{
				id: "TASK-10",
				updates: { commentsAppend: ["Option 2: No, keep the URL\n\nRevisit after the HUD decision."] },
			},
		]);
		// The status stays: the asking session moves the card once it has the answer.
		expect(updates[0]?.updates.status).toBeUndefined();
		expect(navigated).toEqual(["TASK-12"]);
	});

	it("takes a free-text answer with Ctrl+Enter, and closes when no question is left", async () => {
		const { container, navigated, closedCount } = await mount({
			current: questions[2] as Task,
			tasks: [questions[1] as Task, questions[2] as Task],
		});

		const textarea = await typeReply(container, "Neither: ask depot-worker.");
		await press(textarea, "Enter", { ctrlKey: true });

		expect(updates).toEqual([{ id: "TASK-12", updates: { commentsAppend: ["Neither: ask depot-worker."] } }]);
		expect(navigated).toEqual([]);
		expect(closedCount()).toBe(1);
	});
});

describe("the conversation", () => {
	it("shows the person at the board as You, signs as their configured name, and marks unsigned comments", async () => {
		const current = task({
			id: "TASK-20",
			status: "In Progress",
			comments: [
				{ index: 1, author: "depot-worker", createdDate: "2026-09-26 10:00", body: "Started." },
				{ index: 2, author: "magnus", createdDate: "2026-09-26 10:01", body: "Thanks." },
				{ index: 3, createdDate: "2026-09-26 10:02", body: "An old web comment." },
			],
		});
		const { container } = await mount({ current, tasks: [current], webUserName: "magnus" });

		const authors = Array.from(container.querySelectorAll("[data-comment-author-name]")).map(
			(element) => element.textContent,
		);
		expect(authors).toEqual(["depot-worker", "You", "Unsigned"]);
		expect(container.querySelector("[data-reply-box]")?.textContent).toContain("Signed as magnus");
		// Neither a proposal nor a question: a plain comment box.
		expect(container.querySelector("[data-reply-box]")?.getAttribute("data-reply-box")).toBe("comment");
	});

	it("posts a plain comment with Ctrl+Enter and keeps the card open", async () => {
		const current = task({ id: "TASK-21", status: "In Progress" });
		const { container, navigated, closedCount } = await mount({ current, tasks: [current] });

		const textarea = await typeReply(container, "**Looks** right");
		await press(textarea, "Enter", { ctrlKey: true });

		expect(updates).toEqual([{ id: "TASK-21", updates: { commentsAppend: ["**Looks** right"] } }]);
		expect(navigated).toEqual([]);
		expect(closedCount()).toBe(0);
		expect(textarea.value).toBe("");
	});

	it("asks before closing over an unsent comment", async () => {
		const current = task({ id: "TASK-22", status: "In Progress" });
		const { container, closedCount } = await mount({ current, tasks: [current] });
		await typeReply(container, "Half a thought");

		const prompts: string[] = [];
		window.confirm = (message?: string) => {
			prompts.push(String(message));
			return false;
		};
		const closeButton = container.querySelector("button[aria-label='Close modal']");
		await act(async () => {
			closeButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});

		expect(prompts).toEqual(["Discard your unsent comment?"]);
		expect(closedCount()).toBe(0);
	});

	it("walks the card's column with j and k", async () => {
		const column = [
			task({ id: "TASK-30", status: "In Progress", ordinal: 1000 }),
			task({ id: "TASK-31", status: "In Progress", ordinal: 2000 }),
		];
		const { container, navigated } = await mount({ current: column[0] as Task, tasks: column });

		expect(container.querySelector("[aria-label='In Progress: card 1 of 2']")).toBeTruthy();
		const dialog = container.querySelector("[role='dialog']") as Element;
		await press(dialog, "j");
		await press(dialog, "k");

		expect(navigated).toEqual(["TASK-31", "TASK-31"]);
	});
});
