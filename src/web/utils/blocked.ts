import type { Task, TaskComment } from "../../types";
import { isTerminalStatus } from "../../utils/terminal-status.ts";
import { normalizePersonName } from "../../utils/web-user.ts";
import { buildTaskIdIndex, resolveTaskReference, type TaskIdIndex } from "./task-id-links";
import { lastComment } from "./workflow";

/**
 * Whether a card is blocked, and why, read from what the card already records. A card is blocked
 * while any of these holds:
 *
 * 1. it has the label `blocked`, which lasts until the label is removed;
 * 2. its latest comment starts with "Blocked:", which any later comment clears;
 * 3. a dependency the board can see is not finished (not in the last status).
 *
 * A finished card is never blocked. A dependency the board cannot see is not counted: finished cards
 * leave the board for the completed folder, so a missing one is most often done.
 */
export interface BlockedState {
	/** The card has the `blocked` label. */
	byLabel: boolean;
	/** The card's latest comment starts with "Blocked:". */
	byComment: boolean;
	/** Why, from the latest comment starting with "Blocked:"; only when the label or that comment blocks. */
	reason: BlockedReason | null;
	/** The unfinished cards it depends on, in the order the card lists them. */
	waitingOn: Task[];
}

export interface BlockedReason {
	/** The comment's text after "Blocked:", without a trailing signature of its own author. */
	text: string;
	author?: string;
	createdDate: string;
}

export const BLOCKED_LABEL = "blocked";

const BLOCKED_PREFIX = /^\s*blocked:\s*/i;

export function isBlockedLabel(label: string): boolean {
	return label.trim().toLowerCase() === BLOCKED_LABEL;
}

export function hasBlockedLabel(labels: readonly string[] | undefined): boolean {
	return (labels ?? []).some(isBlockedLabel);
}

export function isBlockedComment(comment: Pick<TaskComment, "body"> | undefined): boolean {
	return Boolean(comment && BLOCKED_PREFIX.test(comment.body));
}

/** A comment's reason: the text after "Blocked:", with "-- <author>" at its end dropped (the author is shown). */
function toReason(comment: TaskComment): BlockedReason {
	let text = comment.body.replace(BLOCKED_PREFIX, "").trim();
	const signature = text.match(/\s*(?:--|—)\s*@?([^\s-][^\s]*)\s*$/);
	if (signature?.[1] && comment.author && normalizePersonName(signature[1]) === normalizePersonName(comment.author)) {
		text = text.slice(0, signature.index).trim();
	}
	return { text, author: comment.author?.trim() || undefined, createdDate: comment.createdDate };
}

function isFinished(task: Pick<Task, "status" | "source">, statuses: readonly string[]): boolean {
	return task.source === "completed" || isTerminalStatus(task.status, statuses);
}

/**
 * The blocked state of one card, or null when it is not blocked. Dependencies resolve through the
 * same canonical index the task links use, so an ID two files claim is not guessed at.
 */
export function getBlockedState(
	task: Pick<Task, "id" | "status" | "labels" | "comments" | "dependencies" | "source">,
	index: TaskIdIndex,
	statuses: readonly string[],
): BlockedState | null {
	if (isFinished(task, statuses)) return null;

	const byLabel = hasBlockedLabel(task.labels);
	const byComment = isBlockedComment(lastComment(task));
	const waitingOn: Task[] = [];
	for (const dependencyId of task.dependencies ?? []) {
		const dependency = resolveTaskReference(index, dependencyId);
		if (
			dependency &&
			dependency.id !== task.id &&
			!isFinished(dependency, statuses) &&
			!waitingOn.includes(dependency)
		) {
			waitingOn.push(dependency);
		}
	}
	if (!byLabel && !byComment && waitingOn.length === 0) return null;

	const reasonComment = byLabel || byComment ? [...(task.comments ?? [])].reverse().find(isBlockedComment) : undefined;
	return { byLabel, byComment, reason: reasonComment ? toReason(reasonComment) : null, waitingOn };
}

/** Every blocked card on a board, by ID, resolved against the whole board. */
export function getBlockedStates(tasks: readonly Task[], statuses: readonly string[]): Map<string, BlockedState> {
	const index = buildTaskIdIndex([...tasks]);
	const states = new Map<string, BlockedState>();
	for (const task of tasks) {
		const state = getBlockedState(task, index, statuses);
		if (state) states.set(task.id, state);
	}
	return states;
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** "Waiting on TASK-40 Its title", for one unfinished dependency. */
export function waitingOnText(dependency: Pick<Task, "id" | "title">): string {
	return collapse(`Waiting on ${dependency.id} ${dependency.title}`);
}

/**
 * Why a card is blocked, one reason per line, as a tooltip or a screen reader says it:
 * "Blocked: <why> (<author>)", then "Waiting on TASK-n <title>" for each unfinished dependency.
 */
export function describeBlocked(state: BlockedState): string[] {
	const lines: string[] = [];
	if (state.reason) {
		const why = collapse(state.reason.text) || "no reason given";
		lines.push(`Blocked: ${why}${state.reason.author ? ` (${state.reason.author})` : ""}`);
	} else if (state.byLabel) {
		lines.push("Blocked: labelled blocked, no reason given");
	}
	for (const dependency of state.waitingOn) lines.push(waitingOnText(dependency));
	return lines;
}

const quoteArgument = (value: string): string => (/^[\w.:@/-]+$/.test(value) ? value : `"${value}"`);

/**
 * The commands that clear each cause: for the label and the comment, one edit of the card itself
 * (removing the label, and a comment after the "Blocked:" one); for a dependency, finishing it.
 */
export function unblockCommands(taskId: string, state: BlockedState, doneStatus: string | null): string[] {
	const commands: string[] = [];
	if (state.byLabel || state.byComment) {
		const flags = [
			state.byLabel ? `--remove-label ${BLOCKED_LABEL}` : null,
			state.byComment ? `--comment "Unblocked: <what changed>"` : null,
		].filter(Boolean);
		commands.push(`backlog task edit ${taskId} ${flags.join(" ")}`);
	}
	if (doneStatus) {
		for (const dependency of state.waitingOn) {
			commands.push(`backlog task edit ${dependency.id} -s ${quoteArgument(doneStatus)}`);
		}
	}
	return commands;
}
