import type { BacklogConfig } from "../types/index.ts";

/** The name web UI comments are signed with when `web_user_name` is not configured. Matches the `@user` assignee. */
export const DEFAULT_WEB_USER_NAME = "user";

/** The name the person at the web UI signs comments with. */
export function resolveWebUserName(config: Pick<BacklogConfig, "webUserName"> | null | undefined): string {
	const configured = config?.webUserName?.trim();
	return configured ? configured : DEFAULT_WEB_USER_NAME;
}

/** Why a name cannot sign comments, or null when it can. Comment metadata is one line per field. */
export function validateWebUserName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	if (/[\r\n]/.test(trimmed)) return "web user name must be a single line";
	if (/^-{3,}$/.test(trimmed) || trimmed.includes("<!--") || trimmed.includes("-->")) {
		return "web user name cannot be a '---' delimiter or contain comment markers";
	}
	return null;
}

/** People are written with or without a leading "@" and in any case; this is the form they compare in. */
export function normalizePersonName(name: string | null | undefined): string {
	return (name ?? "").trim().replace(/^@+/, "").toLowerCase();
}

export function isSamePerson(first: string | null | undefined, second: string | null | undefined): boolean {
	const normalized = normalizePersonName(first);
	return normalized.length > 0 && normalized === normalizePersonName(second);
}
