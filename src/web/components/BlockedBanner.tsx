import React from "react";
import type { Task } from "../../types";
import { type BlockedState, unblockCommands } from "../utils/blocked";
import { createUrlPath } from "../utils/urlHelpers";
import { displayPerson } from "../utils/workflow";
import MermaidMarkdown from "./MermaidMarkdown";
import PersonAvatar from "./PersonAvatar";
import StoredDate from "./StoredDate";

interface BlockedBannerProps {
	taskId: string;
	state: BlockedState;
	/** The status that finishes a card, for the command that finishes a dependency. */
	doneStatus: string | null;
	webUserName: string;
	theme: string;
	dateFormat?: string;
	/** Opens a blocking card in place; without it the links load the card's page. */
	onOpenTask?: (task: Task) => void;
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
	const [copied, setCopied] = React.useState(false);
	React.useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);
	if (typeof navigator === "undefined" || !navigator.clipboard) return null;
	return (
		<button
			type="button"
			onClick={() => {
				void navigator.clipboard.writeText(text).then(
					() => setCopied(true),
					() => setCopied(false),
				);
			}}
			className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-0.5 text-xs font-medium text-red-800 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/60"
			aria-label={`Copy: ${text}`}
		>
			{copied ? "Copied" : "Copy"}
		</button>
	);
};

/**
 * The top of a blocked card's task view: why it is blocked, who said so and when, the cards it
 * waits on, and the commands that clear it.
 */
const BlockedBanner: React.FC<BlockedBannerProps> = ({
	taskId,
	state,
	doneStatus,
	webUserName,
	theme,
	dateFormat,
	onOpenTask,
}) => {
	const { reason } = state;
	const commands = unblockCommands(taskId, state, doneStatus);

	return (
		<section
			aria-label="Blocked"
			data-blocked-banner
			className="mb-4 rounded-lg border border-red-200 border-l-4 border-l-red-500 bg-red-50 px-4 py-3 text-sm text-red-950 dark:border-red-900 dark:border-l-red-500 dark:bg-red-950/30 dark:text-red-100"
		>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<svg className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="9" strokeWidth={2} />
					<path strokeLinecap="round" strokeWidth={2} d="M8 12h8" />
				</svg>
				<h3 className="font-semibold text-red-800 dark:text-red-200">Blocked</h3>
				{reason?.author && (
					<span className="inline-flex min-w-0 items-center gap-1 text-red-900 dark:text-red-100" data-blocked-author={reason.author}>
						<PersonAvatar name={reason.author} webUserName={webUserName} size="xs" />
						<span className="truncate font-medium">{displayPerson(reason.author, webUserName)}</span>
					</span>
				)}
				{reason?.createdDate && (
					<StoredDate value={reason.createdDate} dateFormat={dateFormat} age className="text-xs text-red-800/80 dark:text-red-200/80" />
				)}
			</div>

			{reason ? (
				reason.text ? (
					<div className="prose prose-sm !max-w-none wmde-markdown comment-body mt-1.5" data-color-mode={theme} data-blocked-reason>
						<MermaidMarkdown source={reason.text} />
					</div>
				) : null
			) : state.byLabel ? (
				<p className="mt-1.5 text-red-900 dark:text-red-100" data-blocked-reason>
					Labelled <code className="font-mono text-xs">blocked</code>, with no "Blocked:" comment saying why.
				</p>
			) : null}

			{state.waitingOn.length > 0 && (
				<ul className="mt-2 space-y-1" aria-label="Waiting on">
					{state.waitingOn.map((dependency) => {
						const href = createUrlPath("/tasks", dependency.id, dependency.title);
						return (
							<li key={dependency.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-waiting-on={dependency.id}>
								<span className="text-red-800 dark:text-red-200">Waiting on</span>
								<a
									href={href}
									onClick={(event) => {
										if (!onOpenTask || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
										event.preventDefault();
										onOpenTask(dependency);
									}}
									className="min-w-0 break-words font-medium text-red-950 underline decoration-red-300 underline-offset-2 hover:decoration-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-50 dark:decoration-red-700 dark:hover:decoration-red-300"
								>
									<span className="font-mono text-xs">{dependency.id}</span> {dependency.title}
								</a>
								<span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950/60 dark:text-red-200">
									{dependency.status}
								</span>
							</li>
						);
					})}
				</ul>
			)}

			{commands.length > 0 && (
				<div className="mt-3 border-t border-red-200 pt-2 dark:border-red-900/70">
					<p className="text-xs font-medium text-red-800 dark:text-red-200">To unblock</p>
					<ul className="mt-1 space-y-1">
						{commands.map((command) => (
							<li key={command} className="flex items-start gap-2">
								<code
									className="min-w-0 flex-1 select-all break-words rounded-md bg-white/80 px-2 py-1 font-mono text-xs text-gray-900 dark:bg-gray-900/70 dark:text-gray-100"
									data-unblock-command
								>
									{command}
								</code>
								<CopyButton text={command} />
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
};

export default BlockedBanner;
