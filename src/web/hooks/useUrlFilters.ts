import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { canonicalizeFilters, type FilterKey, type FilterState, readFilters, writeFilters } from "../utils/filters";

type Canonicalizers = Partial<Record<FilterKey, (value: string) => string | undefined>>;

/**
 * A page's filters, read from the address and written back to it. Each change is a new history
 * entry, so Back undoes it and a filtered page can be shared as a link. Values are shown in their
 * canonical form (`canonical`); once `ready` (the configuration that canonicalizes them has loaded),
 * an address in an older or non-canonical form is rewritten in place.
 */
export function useUrlFilters(keys: readonly FilterKey[], canonical: Canonicalizers, ready: boolean) {
	const location = useLocation();
	const navigate = useNavigate();
	const { search, hash, state } = location;

	const filters = useMemo(() => canonicalizeFilters(readFilters(search, keys), canonical), [search, keys, canonical]);

	useEffect(() => {
		if (!ready) return;
		const next = writeFilters(search, filters, keys);
		// An open task's route state (how it was reached) survives the rewrite.
		if (next !== search) navigate({ search: next, hash }, { replace: true, state });
	}, [ready, search, hash, state, filters, keys, navigate]);

	const setFilters = useCallback(
		(next: FilterState) => {
			const nextSearch = writeFilters(search, next, keys);
			if (nextSearch !== search) navigate({ search: nextSearch });
		},
		[search, keys, navigate],
	);

	return { filters, setFilters };
}
