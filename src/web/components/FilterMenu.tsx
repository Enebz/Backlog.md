import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	cycleOption,
	type FilterSelection,
	type OptionState,
	optionState,
	toggleExcluded,
} from "../utils/filters";

export interface FilterOption {
	/** The value the address holds. */
	value: string;
	label: string;
	/** How many cards or tasks choosing it would show, under the other filters. */
	count?: number;
	/** Drawn before the label, such as a person's avatar. */
	icon?: React.ReactNode;
	/** How it reads when excluded, in place of "not <label>": "Any type" for "No type". */
	excludedLabel?: string;
	/** Its chip shows that text alone, without the filter's name: "Blocked", "Not blocked". */
	bareChip?: boolean;
}

const CONTROL_CLASS =
	"h-10 rounded-lg border text-sm transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 dark:focus-visible:ring-stone-400";
const IDLE_CLASS =
	"border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700";
const ACTIVE_CLASS =
	"border-blue-400 bg-blue-50 text-blue-950 hover:bg-blue-100 dark:border-blue-500/70 dark:bg-blue-950/50 dark:text-blue-50 dark:hover:bg-blue-900/50";

/** A search box shows above the options when there are more than this many. */
const SEARCH_THRESHOLD = 8;

/** How a chosen value reads in a trigger or a chip: "bug", or when excluded "not chore" ("Any type"). */
export function describeChoice(option: Pick<FilterOption, "label" | "excludedLabel">, excluded: boolean): string {
	return excluded ? (option.excludedLabel ?? `not ${option.label}`) : option.label;
}

/** A value's option; a value the options lack reads as itself. */
export function optionLookup(options: FilterOption[], normalize: (value: string) => string) {
	const byKey = new Map(options.map((option) => [normalize(option.value), option]));
	return (value: string): FilterOption => byKey.get(normalize(value)) ?? { value, label: value };
}

/** The chosen values of a filter as text, included ones first. */
function describeSelection(
	selection: FilterSelection | undefined,
	optionOf: (value: string) => FilterOption,
): string[] {
	if (!selection) return [];
	return [
		...selection.include.map((value) => describeChoice(optionOf(value), false)),
		...selection.exclude.map((value) => describeChoice(optionOf(value), true)),
	];
}

const CheckMark = () => (
	<svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
		<path d="M2.5 6.5l2.2 2.2 4.8-5.2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

const MinusMark = () => (
	<svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true">
		<path d="M2.5 6h7" strokeWidth={2} strokeLinecap="round" />
	</svg>
);

export const ExcludeIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
	<svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
		<circle cx="10" cy="10" r="6.5" strokeWidth={1.8} />
		<path d="M5.5 14.5l9-9" strokeWidth={1.8} strokeLinecap="round" />
	</svg>
);

const BOX_CLASS: Record<OptionState, string> = {
	off: "border-gray-300 bg-white dark:border-gray-500 dark:bg-gray-900",
	include: "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500",
	exclude: "border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-500",
};

interface OptionControlsProps {
	option: FilterOption;
	state: OptionState;
	onCycle: () => void;
	onToggleExcluded: () => void;
	/** What the count counts, for screen readers: "cards", "tasks". */
	countNoun: string;
	/** In a menu: roving focus (only the active row's main control is in the tab order). */
	tabIndex?: number;
	mainRef?: (element: HTMLButtonElement | null) => void;
	excludeRef?: (element: HTMLButtonElement | null) => void;
	onFocus?: () => void;
	variant: "row" | "inline";
}

/**
 * One option: the main control includes it (a second press excludes it, a third clears it), and
 * the ⊘ control excludes it directly. Used as a row in a menu and inline for a one-value filter.
 */
function OptionControls({
	option,
	state,
	onCycle,
	onToggleExcluded,
	countNoun,
	tabIndex,
	mainRef,
	excludeRef,
	onFocus,
	variant,
}: OptionControlsProps) {
	const count = option.count;
	const name = [
		option.label,
		state === "exclude" ? "excluded" : null,
		count === undefined ? null : `${count} ${countNoun}`,
	]
		.filter(Boolean)
		.join(", ");
	const dimmed = count === 0 && state === "off";
	const inline = variant === "inline";
	return (
		<div
			className={inline ? "inline-flex items-stretch" : "flex items-stretch gap-1 px-1"}
			data-filter-option={option.value}
			data-label={option.label}
			data-state={state}
		>
			<button
				type="button"
				role="checkbox"
				aria-checked={state === "include"}
				aria-label={name}
				ref={mainRef}
				tabIndex={tabIndex}
				onFocus={onFocus}
				onClick={onCycle}
				className={
					inline
						? "flex items-center gap-2 pl-3 pr-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-500"
						: "flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 dark:hover:bg-gray-700/70 sm:min-h-9"
				}
			>
				<span
					className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${BOX_CLASS[state]}`}
					aria-hidden="true"
				>
					{state === "include" ? <CheckMark /> : state === "exclude" ? <MinusMark /> : null}
				</span>
				{option.icon}
				<span
					className={`min-w-0 truncate ${
						state === "exclude"
							? "text-red-700 dark:text-red-300"
							: dimmed
								? "text-gray-400 dark:text-gray-500"
								: "text-gray-900 dark:text-gray-100"
					} ${inline ? "" : "flex-1"}`}
				>
					{inline ? describeChoice(option, state === "exclude") : option.label}
				</span>
				{count !== undefined && (
					<span
						className={`shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400 ${state === "exclude" ? "line-through" : ""}`}
						aria-hidden="true"
					>
						{count}
					</span>
				)}
			</button>
			<button
				type="button"
				aria-pressed={state === "exclude"}
				aria-label={`Exclude ${option.label}`}
				title={`Exclude ${option.label}`}
				ref={excludeRef}
				tabIndex={inline ? undefined : -1}
				onFocus={onFocus}
				onClick={onToggleExcluded}
				className={`flex shrink-0 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-500 ${
					inline ? "w-9 border-l border-inherit" : "w-10 rounded-md"
				} ${
					state === "exclude"
						? "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400"
						: "text-gray-400 hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
				}`}
			>
				<ExcludeIcon />
			</button>
		</div>
	);
}

interface FilterToggleProps {
	option: FilterOption;
	selection: FilterSelection | undefined;
	onChange: (selection: FilterSelection) => void;
	normalize: (value: string) => string;
	countNoun: string;
}

/** A filter with a single value, such as Blocked, as one inline control. */
export function FilterToggle({ option, selection, onChange, normalize, countNoun }: FilterToggleProps) {
	const state = optionState(selection, option.value, normalize);
	return (
		<div
			className={`${CONTROL_CLASS} ${state === "off" ? IDLE_CLASS : state === "include" ? ACTIVE_CLASS : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"} inline-flex overflow-hidden`}
		>
			<OptionControls
				option={option}
				state={state}
				variant="inline"
				countNoun={countNoun}
				onCycle={() => onChange(cycleOption(selection, option.value, normalize))}
				onToggleExcluded={() => onChange(toggleExcluded(selection, option.value, normalize))}
			/>
		</div>
	);
}

interface FilterMenuProps {
	/** The trigger's id; the menu's is `${id}-menu`. */
	id: string;
	label: string;
	options: FilterOption[];
	selection: FilterSelection | undefined;
	onChange: (selection: FilterSelection) => void;
	normalize: (value: string) => string;
	countNoun: string;
	noOptionsLabel?: string;
}

/**
 * A filter as a dropdown: a trigger naming what is chosen, and a menu of options, each included or
 * excluded, with counts, a search box for long lists, and Clear. Works with a mouse, the keyboard
 * (arrows move, Space or Enter includes, "-" or ArrowRight then Space excludes, Escape closes) and
 * touch (a sheet at the bottom of a phone's screen).
 */
export default function FilterMenu({
	id,
	label,
	options,
	selection,
	onChange,
	normalize,
	countNoun,
	noOptionsLabel = "Nothing to filter by",
}: FilterMenuProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [alignRight, setAlignRight] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const mainRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const excludeRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const menuId = `${id}-menu`;
	const searchable = options.length > SEARCH_THRESHOLD;

	const optionOf = useMemo(() => optionLookup(options, normalize), [options, normalize]);
	const chosen = describeSelection(selection, optionOf);
	const active = chosen.length > 0;
	const summary = chosen.length === 0 ? "All" : chosen.length === 1 ? chosen[0] : `${chosen[0]} +${chosen.length - 1}`;

	const visible = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return options;
		return options.filter(
			(option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
		);
	}, [options, query]);

	const close = (returnFocus: boolean) => {
		setOpen(false);
		setQuery("");
		if (returnFocus) triggerRef.current?.focus();
	};

	const openMenu = () => {
		const rect = triggerRef.current?.getBoundingClientRect();
		// A menu that would run off the right edge opens leftwards from the trigger's right edge instead.
		setAlignRight(Boolean(rect && typeof window !== "undefined" && window.innerWidth - rect.left < 300));
		const firstChosen = options.findIndex((option) => optionState(selection, option.value, normalize) !== "off");
		setActiveIndex(Math.max(firstChosen, 0));
		setOpen(true);
	};

	// Focus goes into the menu when it opens: the search box, or the first chosen option. On a touch
	// screen the search box waits for a tap, so the keyboard does not cover the options.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on opening.
	useEffect(() => {
		if (!open) return;
		const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
		if (searchable && !touch) searchRef.current?.focus();
		else mainRefs.current[activeIndex]?.focus();
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const handlePointer = (event: Event) => {
			const target = event.target as Node;
			if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
			setOpen(false);
			setQuery("");
		};
		document.addEventListener("mousedown", handlePointer);
		document.addEventListener("touchstart", handlePointer);
		return () => {
			document.removeEventListener("mousedown", handlePointer);
			document.removeEventListener("touchstart", handlePointer);
		};
	}, [open]);

	const focusRow = (index: number) => {
		if (visible.length === 0) return;
		const next = Math.min(Math.max(index, 0), visible.length - 1);
		setActiveIndex(next);
		mainRefs.current[next]?.focus();
	};

	const change = (value: string, how: "cycle" | "exclude") =>
		onChange(how === "cycle" ? cycleOption(selection, value, normalize) : toggleExcluded(selection, value, normalize));

	const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement;
		const rowIndex = mainRefs.current.indexOf(target as HTMLButtonElement);
		const excludeIndex = excludeRefs.current.indexOf(target as HTMLButtonElement);
		const inRow = rowIndex >= 0 ? rowIndex : excludeIndex;
		switch (event.key) {
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				close(true);
				return;
			case "ArrowDown":
				event.preventDefault();
				focusRow(target === searchRef.current ? activeIndex : inRow + 1);
				return;
			case "ArrowUp":
				event.preventDefault();
				if (inRow <= 0 && searchable) searchRef.current?.focus();
				else focusRow(inRow - 1);
				return;
			case "Home":
			case "End":
				if (inRow < 0) return;
				event.preventDefault();
				focusRow(event.key === "Home" ? 0 : visible.length - 1);
				return;
			case "ArrowRight":
				if (rowIndex < 0) return;
				event.preventDefault();
				excludeRefs.current[rowIndex]?.focus();
				return;
			case "ArrowLeft":
				if (excludeIndex < 0) return;
				event.preventDefault();
				mainRefs.current[excludeIndex]?.focus();
				return;
			case "-": {
				const option = inRow >= 0 ? visible[inRow] : undefined;
				if (!option) return;
				event.preventDefault();
				change(option.value, "exclude");
				return;
			}
			case "Enter": {
				if (target !== searchRef.current) return;
				const option = visible[0];
				if (!option) return;
				event.preventDefault();
				change(option.value, "cycle");
				return;
			}
		}
	};

	// Keyboard focus that leaves the menu (Tab past its end) closes it; a click inside does not.
	const handlePanelBlur = (event: React.FocusEvent<HTMLDivElement>) => {
		const next = event.relatedTarget as Node | null;
		if (!next || panelRef.current?.contains(next) || triggerRef.current?.contains(next)) return;
		close(false);
	};

	return (
		<div className="relative min-w-0">
			<button
				type="button"
				id={id}
				ref={triggerRef}
				aria-expanded={open}
				aria-controls={menuId}
				onClick={() => (open ? close(false) : openMenu())}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown" && !open) {
						event.preventDefault();
						openMenu();
					}
				}}
				className={`${CONTROL_CLASS} ${active ? ACTIVE_CLASS : IDLE_CLASS} inline-flex w-full items-center gap-2 px-3 text-left sm:w-auto`}
			>
				<span className="shrink-0 font-medium">{label}</span>
				<span
					className={`min-w-0 truncate sm:max-w-[11rem] ${active ? "" : "text-gray-500 dark:text-gray-400"}`}
					data-filter-summary
				>
					{summary}
				</span>
				<svg
					className={`ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
					viewBox="0 0 20 20"
					fill="none"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path d="M5.5 8l4.5 4.5L14.5 8" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>
			{open && (
				<>
					<div className="fixed inset-0 z-40 bg-gray-950/30 sm:hidden" aria-hidden="true" />
					<div
						id={menuId}
						ref={panelRef}
						onKeyDown={handlePanelKeyDown}
						onBlur={handlePanelBlur}
						className={`fixed inset-x-3 bottom-3 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:max-h-[26rem] sm:w-72 sm:rounded-lg ${
							alignRight ? "sm:right-0" : "sm:left-0"
						}`}
					>
						<div className="px-4 pb-1 pt-3 text-sm font-semibold text-gray-900 dark:text-gray-100 sm:hidden">{label}</div>
						{searchable && (
							<div className="border-b border-gray-200 p-2 dark:border-gray-700">
								<input
									ref={searchRef}
									type="search"
									value={query}
									onChange={(event) => {
										setQuery(event.target.value);
										setActiveIndex(0);
									}}
									placeholder={`Search ${label.toLowerCase()}`}
									aria-label={`Search ${label.toLowerCase()}`}
									className="h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-stone-400"
								/>
							</div>
						)}
						<div role="group" aria-label={label} className="min-h-0 flex-1 overflow-y-auto py-1">
							{visible.length === 0 ? (
								<div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
									{options.length === 0 ? noOptionsLabel : "No matches"}
								</div>
							) : (
								visible.map((option, index) => (
									<OptionControls
										key={option.value}
										option={option}
										state={optionState(selection, option.value, normalize)}
										variant="row"
										countNoun={countNoun}
										tabIndex={index === Math.min(activeIndex, visible.length - 1) ? 0 : -1}
										mainRef={(element) => {
											mainRefs.current[index] = element;
										}}
										excludeRef={(element) => {
											excludeRefs.current[index] = element;
										}}
										onFocus={() => setActiveIndex(index)}
										onCycle={() => change(option.value, "cycle")}
										onToggleExcluded={() => change(option.value, "exclude")}
									/>
								))
							)}
						</div>
						<div className="flex items-center justify-between gap-2 border-t border-gray-200 px-2 py-2 dark:border-gray-700">
							<button
								type="button"
								disabled={!active}
								onClick={() => {
									onChange({ include: [], exclude: [] });
									close(true);
								}}
								className="rounded-md px-2.5 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 disabled:cursor-default disabled:text-gray-400 disabled:hover:bg-transparent dark:text-blue-300 dark:hover:bg-blue-950/40 dark:disabled:text-gray-500"
							>
								Clear
							</button>
							<button
								type="button"
								onClick={() => close(true)}
								className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 dark:bg-gray-100 dark:text-gray-900 sm:hidden"
							>
								Done
							</button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
