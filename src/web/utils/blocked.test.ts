import { describe, expect, it } from "bun:test";
import type { Task, TaskComment } from "../../types";
import { type BlockedState, describeBlocked, getBlockedState, getBlockedStates, unblockCommands } from "./blocked";
import { buildTaskIdIndex } from "./task-id-links";

const STATUSES = ["To Do", "Approved", "In Progress", "Waiting on you", "Done"];

const task = (overrides: Partial<Task>): Task => ({
	id: "TASK-1",
	title: "Task",
	status: "In Progress",
	assignee: [],
	createdDate: "2026-09-26 10:00",
	labels: [],
	dependencies: [],
	...overrides,
});

const comment = (index: number, body: string, author?: string): TaskComment => ({
	index,
	body,
	author,
	createdDate: `2026-09-27 0${index}:00`,
});

const stateOf = (subject: Task, board: Task[] = [subject]) =>
	getBlockedState(subject, buildTaskIdIndex(board), STATUSES);

/** The state of a card the test expects to be blocked. */
const blockedOf = (subject: Task, board: Task[] = [subject]): BlockedState => {
	const state = stateOf(subject, board);
	if (!state) throw new Error(`${subject.id} is not blocked`);
	return state;
};

describe("getBlockedState", () => {
	it("is null for a card with no label, no Blocked: comment and no open dependency", () => {
		expect(stateOf(task({ comments: [comment(1, "Started.", "depot-worker")] }))).toBeNull();
	});

	it("blocks on the blocked label, with the latest Blocked: comment as the reason", () => {
		const state = stateOf(
			task({
				labels: ["from:sugar-bounce", "Blocked"],
				comments: [
					comment(1, "Blocked: the old reason", "sugar-bounce"),
					comment(2, "Blocked: waiting on the user's call -- sugar-bounce", "sugar-bounce"),
					comment(3, "Meanwhile working on the game.", "sugar-bounce"),
				],
			}),
		);
		expect(state?.byLabel).toBe(true);
		// A later comment clears the comment rule, but the label lasts while it is there.
		expect(state?.byComment).toBe(false);
		expect(state?.reason).toEqual({
			text: "waiting on the user's call",
			author: "sugar-bounce",
			createdDate: "2026-09-27 02:00",
		});
	});

	it("blocks on the label alone, saying no reason was given", () => {
		const state = blockedOf(task({ labels: ["blocked"] }));
		expect(state?.reason).toBeNull();
		expect(describeBlocked(state)).toEqual(["Blocked: labelled blocked, no reason given"]);
	});

	it("blocks when the latest comment starts with Blocked:, without the label", () => {
		const state = stateOf(
			task({
				comments: [
					comment(1, "Started.", "the-house"),
					comment(2, "  blocked: art allowance on the Desk", "the-house"),
				],
			}),
		);
		expect(state?.byLabel).toBe(false);
		expect(state?.byComment).toBe(true);
		expect(state?.reason?.text).toBe("art allowance on the Desk");
	});

	it("is cleared by any later comment when there is no label", () => {
		const blocked = task({ comments: [comment(1, "Blocked: waiting on TASK-42", "sugar-bounce")] });
		expect(stateOf(blocked)).not.toBeNull();
		const resumed = {
			...blocked,
			comments: [...(blocked.comments ?? []), comment(2, "Picked up again.", "sugar-bounce")],
		};
		expect(stateOf(resumed)).toBeNull();
		// A later comment that is itself a Blocked: comment keeps it blocked, with the new reason.
		const reblocked = {
			...blocked,
			comments: [...(blocked.comments ?? []), comment(2, "Blocked: now on TASK-93", "user")],
		};
		expect(stateOf(reblocked)?.reason?.text).toBe("now on TASK-93");
	});

	it("does not count a comment that only mentions being blocked", () => {
		expect(stateOf(task({ comments: [comment(1, "Blocked on an outside date.", "sugar-bounce")] }))).toBeNull();
	});

	it("keeps a signature that is not the comment's own author", () => {
		const state = stateOf(task({ comments: [comment(1, "Blocked: asked by -- depot-worker", "the-house")] }));
		expect(state?.reason?.text).toBe("asked by -- depot-worker");
	});

	it("blocks on a dependency that is not Done, and not on one that is", () => {
		const open = task({ id: "TASK-40", title: "Display face", status: "In Progress" });
		const done = task({ id: "TASK-39", title: "Old fonts", status: "Done" });
		const dependent = task({ id: "TASK-41", dependencies: ["task-40", "TASK-39"] });
		const state = blockedOf(dependent, [open, done, dependent]);
		expect(state.byLabel).toBe(false);
		expect(state.byComment).toBe(false);
		expect(state.reason).toBeNull();
		expect(state.waitingOn.map((dependency) => dependency.id)).toEqual(["TASK-40"]);
		expect(describeBlocked(state)).toEqual(["Waiting on TASK-40 Display face"]);

		expect(stateOf(dependent, [{ ...open, status: "Done" }, done, dependent])).toBeNull();
	});

	it("does not count a dependency the board cannot see, or one moved to the completed folder", () => {
		const completed = task({ id: "TASK-40", status: "In Progress", source: "completed" });
		const dependent = task({ id: "TASK-41", dependencies: ["TASK-40", "TASK-999"] });
		expect(stateOf(dependent, [completed, dependent])).toBeNull();
	});

	it("never blocks a finished card, whatever it carries", () => {
		const open = task({ id: "TASK-40" });
		const finished = task({
			id: "TASK-41",
			status: "Done",
			labels: ["blocked"],
			dependencies: ["TASK-40"],
			comments: [comment(1, "Blocked: forgot the label", "sugar-bounce")],
		});
		expect(stateOf(finished, [open, finished])).toBeNull();
	});

	it("combines every cause, and describes each on its own line", () => {
		const open = task({ id: "TASK-40", title: "Display face" });
		const state = blockedOf(
			task({
				id: "TASK-41",
				labels: ["blocked"],
				dependencies: ["TASK-40"],
				comments: [comment(1, "Blocked: the user's pick", "sugar-bounce")],
			}),
			[open],
		);
		expect(describeBlocked(state)).toEqual([
			"Blocked: the user's pick (sugar-bounce)",
			"Waiting on TASK-40 Display face",
		]);
	});
});

describe("getBlockedStates", () => {
	it("maps only the blocked cards of a board", () => {
		const board = [
			task({ id: "TASK-1", labels: ["blocked"] }),
			task({ id: "TASK-2" }),
			task({ id: "TASK-3", dependencies: ["TASK-1"] }),
		];
		expect([...getBlockedStates(board, STATUSES).keys()]).toEqual(["TASK-1", "TASK-3"]);
	});
});

describe("unblockCommands", () => {
	it("removes the label and answers the Blocked: comment in one edit, and finishes each dependency", () => {
		const open = task({ id: "TASK-40" });
		const state = blockedOf(
			task({
				id: "TASK-41",
				labels: ["blocked"],
				dependencies: ["TASK-40"],
				comments: [comment(1, "Blocked: why", "sugar-bounce")],
			}),
			[open],
		);
		expect(unblockCommands("TASK-41", state, "Done")).toEqual([
			'backlog task edit TASK-41 --remove-label blocked --comment "Unblocked: <what changed>"',
			"backlog task edit TASK-40 -s Done",
		]);
	});

	it("asks only for what applies, and quotes a status with spaces", () => {
		const labelled = blockedOf(task({ labels: ["blocked"] }));
		expect(unblockCommands("TASK-1", labelled, "Done")).toEqual(["backlog task edit TASK-1 --remove-label blocked"]);
		const commented = blockedOf(task({ comments: [comment(1, "Blocked: why")] }));
		expect(unblockCommands("TASK-1", commented, "Done")).toEqual([
			'backlog task edit TASK-1 --comment "Unblocked: <what changed>"',
		]);
		const open = task({ id: "TASK-40" });
		const waiting = blockedOf(task({ id: "TASK-41", dependencies: ["TASK-40"] }), [open]);
		expect(unblockCommands("TASK-41", waiting, "Shipped to prod")).toEqual([
			'backlog task edit TASK-40 -s "Shipped to prod"',
		]);
	});
});
