import type { Task, TaskComment } from "../../types";
import { getTerminalStatus } from "../../utils/terminal-status.ts";
import { isSamePerson } from "../../utils/web-user.ts";
import { sortTasksForStatus } from "../lib/lanes";

/**
 * The decisions a board's own statuses make possible, read from the configured status names:
 *
 * - a status named "Approved" makes the first column a column of proposals, which the person at the
 *   board approves (moves to Approved) or declines (moves to the last status);
 * - a status with "waiting" in its name holds questions for that person, answered with a comment.
 *
 * A board without those statuses gets neither, and everything else behaves as before.
 */
export interface Workflow {
	proposalStatus: string | null;
	approvedStatus: string | null;
	waitingStatus: string | null;
	doneStatus: string | null;
}

export type DecisionKind = "proposal" | "question";

const sameStatus = (first: string | null | undefined, second: string | null | undefined): boolean =>
	(first ?? "").trim().toLowerCase() === (second ?? "").trim().toLowerCase() && (first ?? "").trim() !== "";

export function getWorkflow(statuses: readonly string[]): Workflow {
	const approvedStatus = statuses.find((status) => /^approved$/i.test(status.trim())) ?? null;
	const firstStatus = statuses[0] ?? null;
	const doneStatus = getTerminalStatus(statuses);
	const waitingStatus = statuses.find((status) => /\bwaiting\b/i.test(status)) ?? null;
	return {
		proposalStatus: approvedStatus && firstStatus && !sameStatus(firstStatus, approvedStatus) ? firstStatus : null,
		approvedStatus,
		waitingStatus: waitingStatus && !sameStatus(waitingStatus, doneStatus) ? waitingStatus : null,
		doneStatus,
	};
}

export function decisionKindFor(status: string | null | undefined, workflow: Workflow): DecisionKind | null {
	if (sameStatus(status, workflow.proposalStatus) && workflow.approvedStatus && workflow.doneStatus) return "proposal";
	if (sameStatus(status, workflow.waitingStatus)) return "question";
	return null;
}

export function isWaitingStatus(status: string | null | undefined, workflow: Workflow): boolean {
	return sameStatus(status, workflow.waitingStatus);
}

export interface DecisionOption {
	number: number;
	text: string;
}

const OPTIONS_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*options\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
const NUMBERED_ITEM = /^\s*(\d{1,2})[.)]\s+(.+?)\s*$/;

/**
 * The numbered list under an "Options:" line in a task description, in order. A session writes
 * its own pick first. Continuation lines indented under an item belong to it; the list ends at the
 * first line that is neither an item, a continuation, nor blank.
 */
export function parseDecisionOptions(description: string | null | undefined): DecisionOption[] {
	const lines = (description ?? "").replace(/\r\n/g, "\n").split("\n");
	const headingIndex = lines.findIndex((line) => OPTIONS_HEADING.test(line));
	if (headingIndex === -1) return [];
	const options: DecisionOption[] = [];
	for (const line of lines.slice(headingIndex + 1)) {
		const item = line.match(NUMBERED_ITEM);
		if (item?.[1] && item[2]) {
			options.push({ number: Number.parseInt(item[1], 10), text: item[2] });
			continue;
		}
		if (!line.trim()) continue;
		const last = options.at(-1);
		if (last && /^\s+\S/.test(line)) {
			last.text = `${last.text} ${line.trim()}`;
			continue;
		}
		if (options.length > 0) break;
		// Text between the heading and the first item (an intro sentence) is skipped.
	}
	return options;
}

/** Option text as a button shows it: markdown emphasis and code markers dropped. */
export function plainOptionText(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/__(.+?)__/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.trim();
}

/** The comment an option answer writes: the option, then the optional note as its own paragraph. */
export function formatOptionAnswer(option: DecisionOption, note: string): string {
	const trimmedNote = note.trim();
	const answer = `Option ${option.number}: ${option.text}`;
	return trimmedNote ? `${answer}\n\n${trimmedNote}` : answer;
}

const FROM_LABEL = /^from:\s*(.+)$/i;

/** Who asked for a task: the names in its `from:<name>` labels. */
export function askedBy(labels: readonly string[] | undefined): string[] {
	return (labels ?? []).map((label) => label.match(FROM_LABEL)?.[1]?.trim() ?? "").filter((name) => name.length > 0);
}

export function isFromLabel(label: string): boolean {
	return FROM_LABEL.test(label);
}

/** The labels that are topics, without the `from:` labels shown as who asked. */
export function topicLabels(labels: readonly string[] | undefined): string[] {
	return (labels ?? []).filter((label) => !isFromLabel(label));
}

export function lastComment(task: Pick<Task, "comments">): TaskComment | undefined {
	return task.comments?.at(-1);
}

/** The person at the board wrote the latest comment, so the task waits on someone else now. */
export function hasUserReplied(task: Pick<Task, "comments">, webUserName: string): boolean {
	return isSamePerson(lastComment(task)?.author, webUserName);
}

export function isAssignedTo(task: Pick<Task, "assignee">, name: string): boolean {
	return (task.assignee ?? []).some((assignee) => isSamePerson(assignee, name));
}

/** A person's name as the web UI shows it: "You" for the person at the board, anyone else as written. */
export function displayPerson(name: string, webUserName: string): string {
	return isSamePerson(name, webUserName) ? "You" : name;
}

/**
 * The cards of one status in board order, which is the order the person works through them.
 * Cross-branch tasks are read-only, so they are not part of the queue.
 */
export function statusQueue(tasks: readonly Task[], status: string): Task[] {
	return sortTasksForStatus(
		tasks.filter((task) => sameStatus(task.status, status) && !task.branch && task.source !== "completed"),
		status,
	);
}

/**
 * The card to show after deciding on `currentId`: the next one in the queue that still needs a
 * decision, wrapping to the start, or null when none is left.
 */
export function nextInQueue(
	queue: readonly Task[],
	currentId: string,
	needsDecision: (task: Task) => boolean = () => true,
): Task | null {
	const index = queue.findIndex((task) => task.id === currentId);
	const ordered = index === -1 ? queue : [...queue.slice(index + 1), ...queue.slice(0, index)];
	return ordered.find((task) => task.id !== currentId && needsDecision(task)) ?? null;
}
