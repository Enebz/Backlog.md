import type React from "react";
import { isSamePerson, normalizePersonName } from "../../utils/web-user.ts";

// Full class strings, so Tailwind sees every one of them.
const PALETTE = [
	"bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200",
	"bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
	"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200",
	"bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-200",
	"bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200",
	"bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/60 dark:text-fuchsia-200",
	"bg-lime-100 text-lime-800 dark:bg-lime-900/60 dark:text-lime-200",
	"bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200",
];
const YOU = "bg-blue-600 text-white dark:bg-blue-500";
const NOBODY = "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300";

const SIZES = {
	xs: "h-4 w-4 text-[8px]",
	sm: "h-6 w-6 text-[10px]",
	md: "h-8 w-8 text-xs",
} as const;

export function personInitials(name: string): string {
	const words = normalizePersonName(name)
		.split(/[\s\-_.]+/)
		.filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
	return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

function paletteFor(name: string): string {
	let hash = 0;
	for (const char of normalizePersonName(name)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return PALETTE[hash % PALETTE.length] ?? PALETTE[0] ?? "";
}

/** A person's initials in a colour of their own; the person at the board is always blue. */
const PersonAvatar: React.FC<{ name?: string; webUserName: string; size?: keyof typeof SIZES; className?: string }> = ({
	name,
	webUserName,
	size = "sm",
	className = "",
}) => {
	const tone = !name?.trim() ? NOBODY : isSamePerson(name, webUserName) ? YOU : paletteFor(name);
	return (
		<span
			aria-hidden="true"
			className={`inline-flex shrink-0 select-none items-center justify-center rounded-circle font-semibold leading-none ${SIZES[size]} ${tone} ${className}`}
		>
			{name?.trim() ? personInitials(name) : "?"}
		</span>
	);
};

export default PersonAvatar;
