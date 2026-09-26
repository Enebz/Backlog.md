import { describe, expect, it } from "bun:test";
import type { Task } from "../../types";
import {
	askedBy,
	decisionKindFor,
	displayPerson,
	formatOptionAnswer,
	getWorkflow,
	hasUserReplied,
	nextInQueue,
	parseDecisionOptions,
	plainOptionText,
	statusQueue,
	topicLabels,
} from "./workflow";

const STUDIO_STATUSES = ["To Do", "Approved", "In Progress", "Waiting on you", "Done"];

const task = (overrides: Partial<Task>): Task => ({
	id: "TASK-1",
	title: "Task",
	status: "To Do",
	assignee: [],
	createdDate: "2026-09-26 10:00",
	labels: [],
	dependencies: [],
	...overrides,
});

describe("getWorkflow", () => {
	it("reads proposals, approvals, questions and the terminal status from the status names", () => {
		expect(getWorkflow(STUDIO_STATUSES)).toEqual({
			proposalStatus: "To Do",
			approvedStatus: "Approved",
			waitingStatus: "Waiting on you",
			doneStatus: "Done",
		});
	});

	it("gives a default board no decisions", () => {
		const workflow = getWorkflow(["To Do", "In Progress", "Done"]);
		expect(workflow.proposalStatus).toBeNull();
		expect(workflow.waitingStatus).toBeNull();
		expect(decisionKindFor("To Do", workflow)).toBeNull();
	});

	it("tells proposals from questions, ignoring case", () => {
		const workflow = getWorkflow(STUDIO_STATUSES);
		expect(decisionKindFor("to do", workflow)).toBe("proposal");
		expect(decisionKindFor("Waiting on you", workflow)).toBe("question");
		expect(decisionKindFor("In Progress", workflow)).toBeNull();
		expect(decisionKindFor("Approved", workflow)).toBeNull();
	});

	it("does not treat the last column as a question column even when it says waiting", () => {
		expect(getWorkflow(["To Do", "Waiting"]).waitingStatus).toBeNull();
	});
});

describe("parseDecisionOptions", () => {
	it("reads the numbered list under an Options: line", () => {
		const description = [
			"Depot's dev view drops extra URL parameters. Your call.",
			"",
			"Options:",
			"1. Pass the parameters through (recommended)",
			"2. Keep opening the game's own URL",
			"3) Drop the idea",
		].join("\n");
		expect(parseDecisionOptions(description)).toEqual([
			{ number: 1, text: "Pass the parameters through (recommended)" },
			{ number: 2, text: "Keep opening the game's own URL" },
			{ number: 3, text: "Drop the idea" },
		]);
	});

	it("accepts a bold or heading Options line, blank lines between items, and continuation lines", () => {
		const description = [
			"**Options:**",
			"",
			"1. Move both games",
			"   to the rail HUD now",
			"",
			"2. Only Down the Drain",
			"",
			"Anything after the list is not an option.",
			"4. Not an option either",
		].join("\r\n");
		expect(parseDecisionOptions(description)).toEqual([
			{ number: 1, text: "Move both games to the rail HUD now" },
			{ number: 2, text: "Only Down the Drain" },
		]);
		expect(parseDecisionOptions("## Options\n1. A\n2. B").map((option) => option.text)).toEqual(["A", "B"]);
	});

	it("finds nothing without an Options line", () => {
		expect(parseDecisionOptions("1. A numbered list\n2. that is not a question")).toEqual([]);
		expect(parseDecisionOptions(undefined)).toEqual([]);
		expect(parseDecisionOptions("These options: are prose, not a heading\n1. A")).toEqual([]);
	});
});

describe("option answers", () => {
	it("writes the option, then the note as its own paragraph", () => {
		const option = { number: 2, text: "Only **Down the Drain**" };
		expect(formatOptionAnswer(option, "")).toBe("Option 2: Only **Down the Drain**");
		expect(formatOptionAnswer(option, "  and do it this week ")).toBe(
			"Option 2: Only **Down the Drain**\n\nand do it this week",
		);
		expect(plainOptionText(option.text)).toBe("Only Down the Drain");
	});
});

describe("people", () => {
	it("reads who asked from from: labels and keeps the rest as topics", () => {
		const labels = ["from:depot-worker", "depot", "From: the-house", "proposal"];
		expect(askedBy(labels)).toEqual(["depot-worker", "the-house"]);
		expect(topicLabels(labels)).toEqual(["depot", "proposal"]);
	});

	it("shows the person at the board as You, with or without the @", () => {
		expect(displayPerson("@user", "user")).toBe("You");
		expect(displayPerson("User", "user")).toBe("You");
		expect(displayPerson("@sugar-bounce", "user")).toBe("@sugar-bounce");
		expect(displayPerson("depot-worker", "user")).toBe("depot-worker");
	});

	it("knows when the latest comment is the user's", () => {
		const comments = [
			{ index: 1, author: "depot-worker", createdDate: "2026-09-26 10:00", body: "Question" },
			{ index: 2, author: "user", createdDate: "2026-09-26 10:05", body: "Answer" },
		];
		expect(hasUserReplied(task({ comments }), "user")).toBe(true);
		expect(hasUserReplied(task({ comments: comments.slice(0, 1) }), "user")).toBe(false);
		expect(
			hasUserReplied(task({ comments: [{ index: 1, createdDate: "2026-09-26 10:00", body: "Unsigned" }] }), "user"),
		).toBe(false);
		expect(hasUserReplied(task({}), "user")).toBe(false);
	});
});

describe("queues", () => {
	const tasks = [
		task({ id: "TASK-3", ordinal: 3000 }),
		task({ id: "TASK-1", ordinal: 1000 }),
		task({
			id: "TASK-2",
			ordinal: 2000,
			comments: [{ index: 1, author: "user", createdDate: "2026-09-26 10:00", body: "done" }],
		}),
		task({ id: "TASK-4", status: "Done" }),
		task({ id: "TASK-5", ordinal: 500, branch: "feature/x" }),
	];

	it("orders a status's cards as the board does, without other statuses or read-only cards", () => {
		expect(statusQueue(tasks, "To Do").map((entry) => entry.id)).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
	});

	it("moves to the next card still needing a decision, wrapping around", () => {
		const queue = statusQueue(tasks, "To Do");
		const unanswered = (entry: Task) => !hasUserReplied(entry, "user");
		expect(nextInQueue(queue, "TASK-1", unanswered)?.id).toBe("TASK-3");
		expect(nextInQueue(queue, "TASK-3", unanswered)?.id).toBe("TASK-1");
		expect(nextInQueue(queue, "TASK-1")?.id).toBe("TASK-2");
		expect(nextInQueue([queue[0] as Task], "TASK-1")).toBeNull();
	});
});
