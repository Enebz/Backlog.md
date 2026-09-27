import type React from "react";
import { useState } from "react";
import {
	countActiveValues,
	type FilterKey,
	type FilterSelection,
	type FilterState,
	hasActiveFilters,
	setOptionState,
} from "../utils/filters";
import FilterMenu, { describeChoice, type FilterOption, FilterToggle, optionLookup } from "./FilterMenu";

export interface FilterDefinition {
	key: FilterKey;
	label: string;
	options: FilterOption[];
	/** The form two values of this filter compare in. */
	normalize: (value: string) => string;
	/**
	 * "menu" (the default) is a dropdown; "toggle" one inline control, for a filter with one value;
	 * "chips" shows only its chips here, for a filter set somewhere else on the page.
	 */
	control?: "menu" | "toggle" | "chips";
}

interface FilterBarProps {
	/** Prefix of the controls' ids: `${id}-${key}`. */
	id: string;
	/** The accessible name of the group of controls, such as "Board filters". */
	label: string;
	definitions: FilterDefinition[];
	filters: FilterState;
	onChange: (next: FilterState) => void;
	/** What the counts count: "cards", "tasks". */
	countNoun: string;
	/** Shown at the end of the chips' line, which is there even when no filter is set. */
	trailing?: React.ReactNode;
}

interface Chip {
	key: FilterKey;
	value: string;
	text: string;
	excluded: boolean;
}

/**
 * A page's filters: one control each, the chosen values as chips that remove themselves, and Clear
 * filters. On a phone the controls fold behind a Filters button; the chips stay in view.
 * Renders into its parent, which is a wrapping flex row.
 */
export default function FilterBar({ id, label, definitions, filters, onChange, countNoun, trailing }: FilterBarProps) {
	const [shownOnPhone, setShownOnPhone] = useState(false);
	const keys = definitions.map((definition) => definition.key);
	const activeCount = countActiveValues(filters, keys);
	const change = (key: FilterKey, selection: FilterSelection) => onChange({ ...filters, [key]: selection });

	const chips: Chip[] = definitions.flatMap((definition) => {
		const selection = filters[definition.key];
		if (!selection) return [];
		const optionOf = optionLookup(definition.options, definition.normalize);
		return [
			...selection.include.map((value) => ({ value, excluded: false })),
			...selection.exclude.map((value) => ({ value, excluded: true })),
		].map(({ value, excluded }) => {
			const option = optionOf(value);
			const text = describeChoice(option, excluded);
			return { key: definition.key, value, excluded, text: option.bareChip ? text : `${definition.label}: ${text}` };
		});
	});

	const removeChip = (chip: Chip) => {
		const definition = definitions.find((entry) => entry.key === chip.key);
		if (!definition) return;
		change(chip.key, setOptionState(filters[chip.key], chip.value, "off", definition.normalize));
	};

	const clearAll = () => {
		const next: FilterState = { ...filters };
		for (const key of keys) delete next[key];
		onChange(next);
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setShownOnPhone((shown) => !shown)}
				aria-expanded={shownOnPhone}
				aria-controls={`${id}-controls`}
				className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 transition-colors duration-200 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 sm:hidden"
			>
				{shownOnPhone ? "Hide filters" : "Filters"}
				{activeCount > 0 && (
					<span className="rounded-circle bg-blue-600 px-1.5 text-xs font-semibold tabular-nums text-white">
						{activeCount}
					</span>
				)}
			</button>
			<div
				id={`${id}-controls`}
				role="group"
				aria-label={label}
				className={`${shownOnPhone ? "grid" : "hidden"} w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3`}
			>
				{definitions.map((definition) => {
					if (definition.control === "chips") return null;
					const [only] = definition.options;
					if (definition.control === "toggle" && only) {
						return (
							<FilterToggle
								key={definition.key}
								option={only}
								selection={filters[definition.key]}
								onChange={(selection) => change(definition.key, selection)}
								normalize={definition.normalize}
								countNoun={countNoun}
							/>
						);
					}
					return (
						<FilterMenu
							key={definition.key}
							id={`${id}-${definition.key}`}
							label={definition.label}
							options={definition.options}
							selection={filters[definition.key]}
							onChange={(selection) => change(definition.key, selection)}
							normalize={definition.normalize}
							countNoun={countNoun}
						/>
					);
				})}
			</div>
			{(trailing || hasActiveFilters(filters, keys)) && (
				<div className="flex w-full flex-wrap items-center gap-2">
					{hasActiveFilters(filters, keys) && (
						<div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Chosen filters">
							{chips.map((chip) => (
								<button
									key={`${chip.key}:${chip.excluded ? "-" : ""}${chip.value}`}
									type="button"
									onClick={() => removeChip(chip)}
									aria-label={`Remove ${chip.text}`}
									data-filter-chip={chip.key}
									className={`group inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-circle py-1 pl-3 pr-1.5 text-xs font-medium ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 ${
										chip.excluded
											? "bg-red-50 text-red-800 ring-red-200 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900 dark:hover:bg-red-950"
											: "bg-blue-50 text-blue-900 ring-blue-200 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-100 dark:ring-blue-900 dark:hover:bg-blue-950"
									}`}
								>
									<span className="truncate">{chip.text}</span>
									<svg
										className="h-4 w-4 shrink-0 opacity-60 group-hover:opacity-100"
										viewBox="0 0 20 20"
										fill="none"
										stroke="currentColor"
										aria-hidden="true"
									>
										<path d="M6 6l8 8M14 6l-8 8" strokeWidth={1.8} strokeLinecap="round" />
									</svg>
								</button>
							))}
							<button
								type="button"
								onClick={clearAll}
								className="inline-flex min-h-8 items-center rounded-circle px-2.5 text-xs font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 dark:text-gray-300 dark:hover:text-white"
							>
								Clear filters
							</button>
						</div>
					)}
					{trailing && <div className="ml-auto">{trailing}</div>}
				</div>
			)}
		</>
	);
}
