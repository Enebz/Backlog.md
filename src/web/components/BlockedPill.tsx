import type React from "react";

interface BlockedPillProps {
	/** The reason, shown on hover. */
	title?: string;
	className?: string;
}

/** The red "Blocked" pill a blocked card carries on the board and in the task list. */
const BlockedPill: React.FC<BlockedPillProps> = ({ title, className = "" }) => (
	<span
		data-blocked-pill
		title={title}
		className={`inline-flex shrink-0 items-center gap-1 rounded-circle bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-800/80 ${className}`}
	>
		<svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="9" strokeWidth={2} />
			<path strokeLinecap="round" strokeWidth={2} d="M8 12h8" />
		</svg>
		Blocked
	</span>
);

export default BlockedPill;
