import React, { useState } from "react";
import { type DecisionKind, type DecisionOption, formatOptionAnswer, plainOptionText } from "../utils/workflow";

/** What a reply does: the comment to write (may be empty), the status to move to, and whether it settles the card. */
export interface ReplyAction {
	body: string;
	status?: string;
	/** A decision or an answer: the card is settled, so the next one needing a decision can be shown. */
	settles: boolean;
}

interface ReplyBoxProps {
	kind: DecisionKind | null;
	options: DecisionOption[];
	approvedStatus: string | null;
	declineStatus: string | null;
	value: string;
	onChange: (value: string) => void;
	onSubmit: (action: ReplyAction) => Promise<void> | void;
	busy: boolean;
	webUserName: string;
	textareaRef?: React.Ref<HTMLTextAreaElement>;
}

const BUTTON_BASE =
	"inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
	"border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";
const PRIMARY = "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500";

const CheckIcon = () => (
	<svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
	</svg>
);
const CrossIcon = () => (
	<svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
	</svg>
);

/**
 * The one place to answer a task: a comment box that is always there, with the decisions the card's
 * status allows beside it. A decision and its comment are written together in one update.
 */
const ReplyBox: React.FC<ReplyBoxProps> = ({
	kind,
	options,
	approvedStatus,
	declineStatus,
	value,
	onChange,
	onSubmit,
	busy,
	webUserName,
	textareaRef,
}) => {
	const [pending, setPending] = useState<string | null>(null);
	const hasText = value.trim().length > 0;
	const isQuestion = kind === "question";
	const isProposal = kind === "proposal" && Boolean(approvedStatus) && Boolean(declineStatus);

	const run = async (key: string, action: ReplyAction) => {
		if (busy) return;
		setPending(key);
		try {
			await onSubmit(action);
		} finally {
			setPending(null);
		}
	};

	const sendText = () => {
		if (!hasText) return;
		void run("comment", { body: value, settles: isQuestion });
	};

	const label = (key: string, idle: string, working: string) => (pending === key ? working : idle);

	const placeholder = isQuestion
		? options.length > 0
			? "Add a note to your choice, or write your own answer..."
			: "Write your answer..."
		: isProposal
			? "Add direction or a question (optional)..."
			: "Add a comment...";

	return (
		<div
			className={`rounded-xl border p-3 transition-colors duration-200 ${
				isQuestion
					? "border-amber-300 bg-amber-50/70 dark:border-amber-700/70 dark:bg-amber-950/20"
					: isProposal
						? "border-blue-200 bg-blue-50/50 dark:border-blue-800/70 dark:bg-blue-950/20"
						: "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
			}`}
			data-reply-box={kind ?? "comment"}
		>
			{isQuestion && options.length > 0 && (
				<fieldset className="mb-3">
					<legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
						Choose an option
					</legend>
					<div className="grid gap-2">
						{options.map((option, index) => (
							<button
								key={`${option.number}-${option.text}`}
								type="button"
								disabled={busy}
								onClick={() =>
									void run(`option-${option.number}`, { body: formatOptionAnswer(option, value), settles: true })
								}
								className="group flex w-full items-start gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm text-gray-900 transition-colors duration-150 hover:border-amber-400 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800/60 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-amber-600 dark:hover:bg-gray-700"
								data-option-number={option.number}
							>
								<span className="mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-circle bg-amber-100 text-xs font-bold text-amber-800 dark:bg-amber-900/70 dark:text-amber-200">
									{option.number}
								</span>
								<span className="min-w-0 flex-1 break-words leading-6">
									{pending === `option-${option.number}` ? "Sending..." : plainOptionText(option.text)}
								</span>
								{index === 0 && (
									<span className="mt-1 shrink-0 rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-800/60 dark:text-amber-100">
										Suggested
									</span>
								)}
							</button>
						))}
					</div>
				</fieldset>
			)}

			<label className="sr-only" htmlFor="task-reply">
				{isQuestion ? "Your answer" : "Comment"}
			</label>
			<textarea
				id="task-reply"
				ref={textareaRef}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
						event.preventDefault();
						sendText();
					}
				}}
				rows={hasText ? Math.min(12, Math.max(3, value.split("\n").length + 1)) : 3}
				placeholder={placeholder}
				disabled={busy}
				className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
			/>

			<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-gray-500 dark:text-gray-400">
					Signed as <span className="font-medium text-gray-700 dark:text-gray-200">{webUserName}</span>
					<span className="hidden sm:inline"> · Ctrl+Enter to send</span>
				</p>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<button
						type="button"
						onClick={sendText}
						disabled={busy || !hasText}
						className={`${BUTTON_BASE} ${isProposal ? SECONDARY : PRIMARY}`}
					>
						{label("comment", isQuestion ? "Send answer" : "Comment", "Sending...")}
					</button>
					{isProposal && declineStatus && approvedStatus && (
						<>
							<button
								type="button"
								disabled={busy}
								onClick={() => void run("decline", { body: value, status: declineStatus, settles: true })}
								title={`Decline: move to ${declineStatus}${hasText ? ", with your comment" : ""}`}
								className={`${BUTTON_BASE} border border-red-300 bg-white text-red-700 hover:bg-red-50 focus:ring-red-500 dark:border-red-800 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-950/40`}
							>
								<CrossIcon />
								{label("decline", "Decline", "Declining...")}
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => void run("approve", { body: value, status: approvedStatus, settles: true })}
								title={`Approve: move to ${approvedStatus}${hasText ? ", with your direction" : ""}`}
								className={`${BUTTON_BASE} bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500`}
							>
								<CheckIcon />
								{label("approve", "Approve", "Approving...")}
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
};

export default ReplyBox;
