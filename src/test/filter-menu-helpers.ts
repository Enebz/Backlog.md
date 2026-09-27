import { expect } from "bun:test";
import { act } from "react";

/**
 * Driving the web UI's filter controls (FilterMenu, FilterBar) in DOM tests. A menu is named by its
 * trigger's id, such as "board-filter-type" or "task-list-filter-status".
 */

export async function clickElement(element: Element | null | undefined): Promise<void> {
	expect(element).toBeTruthy();
	await act(async () => {
		element?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
	});
}

export async function pressKey(element: Element | null | undefined, key: string): Promise<void> {
	expect(element).toBeTruthy();
	await act(async () => {
		element?.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
		await Promise.resolve();
	});
}

export function filterTrigger(container: HTMLElement, id: string): HTMLButtonElement {
	const trigger = container.querySelector(`#${id}`);
	expect(trigger, `filter ${id}`).toBeTruthy();
	return trigger as HTMLButtonElement;
}

export function filterMenu(container: HTMLElement, id: string): HTMLElement | null {
	return container.querySelector(`#${id}-menu`);
}

/** What the trigger says is chosen: "All", "bug", "not chore", "bug +1". */
export function filterSummary(container: HTMLElement, id: string): string {
	return filterTrigger(container, id).querySelector("[data-filter-summary]")?.textContent ?? "";
}

export async function openFilter(container: HTMLElement, id: string): Promise<HTMLElement> {
	if (!filterMenu(container, id)) await clickElement(filterTrigger(container, id));
	const menu = filterMenu(container, id);
	expect(menu, `menu of ${id}`).toBeTruthy();
	return menu as HTMLElement;
}

export function optionRow(container: HTMLElement, id: string, label: string): HTMLElement {
	const row = Array.from(filterMenu(container, id)?.querySelectorAll<HTMLElement>("[data-filter-option]") ?? []).find(
		(element) => element.dataset.label === label,
	);
	expect(row, `option ${label} of ${id}`).toBeTruthy();
	return row as HTMLElement;
}

/** The option's main control: a click includes it, a second excludes it, a third clears it. */
export async function clickOption(container: HTMLElement, id: string, label: string): Promise<void> {
	await openFilter(container, id);
	await clickElement(optionRow(container, id, label).querySelector("[role='checkbox']"));
}

/** The option's ⊘ control. */
export async function excludeOption(container: HTMLElement, id: string, label: string): Promise<void> {
	await openFilter(container, id);
	await clickElement(optionRow(container, id, label).querySelector("button[aria-pressed]"));
}

export function optionLabels(container: HTMLElement, id: string): string[] {
	return Array.from(filterMenu(container, id)?.querySelectorAll<HTMLElement>("[data-filter-option]") ?? []).map(
		(row) => row.dataset.label ?? "",
	);
}

/** Each option's count, by label. */
export function optionCounts(container: HTMLElement, id: string): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const row of Array.from(
		filterMenu(container, id)?.querySelectorAll<HTMLElement>("[data-filter-option]") ?? [],
	)) {
		const text = row.querySelector("[role='checkbox']")?.lastElementChild?.textContent ?? "";
		counts[row.dataset.label ?? ""] = Number.parseInt(text, 10);
	}
	return counts;
}

export function optionState(container: HTMLElement, id: string, label: string): string {
	return optionRow(container, id, label).dataset.state ?? "";
}

export function chipTexts(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("[data-filter-chip]")).map((chip) => chip.textContent ?? "");
}

export function findChip(container: HTMLElement, text: string): HTMLButtonElement {
	const chip = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-filter-chip]")).find(
		(element) => element.textContent === text,
	);
	expect(chip, `chip ${text}`).toBeTruthy();
	return chip as HTMLButtonElement;
}

export function findButton(container: HTMLElement, text: string): HTMLButtonElement {
	const button = Array.from(container.querySelectorAll("button")).find(
		(element) => element.textContent?.trim() === text,
	);
	expect(button, `button ${text}`).toBeTruthy();
	return button as HTMLButtonElement;
}
