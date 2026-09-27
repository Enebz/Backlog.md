import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Board, { BOARD_FILTER_KEYS } from './Board';
import { type Milestone, type Task } from '../../types';
import { resolvePriorityValue } from '../../utils/priority-config';
import { resolveProjectValue } from '../../utils/project-config';
import { resolveTaskTypeValue } from '../../utils/task-type-config';
import { type LaneMode } from '../lib/lanes';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { updateSearch } from '../utils/filters';

interface BoardPageProps {
	onEditTask: (task: Task) => void;
	onNewTask: () => void;
	tasks: Task[];
	onRefreshData?: () => Promise<void>;
	onTasksUpdated?: (tasks: Task[], requestTask: Task) => void;
	statuses: string[];
	milestones: string[];
	availableLabels: string[];
	milestoneEntities: Milestone[];
	archivedMilestones: Milestone[];
	isLoading: boolean;
	loadingMessage?: string | null;
	loadError?: Error | null;
	hideEmptyColumns?: boolean;
	dateFormat?: string;
	availablePriorities?: string[];
	availableTypes?: string[];
	availableProjects?: string[];
}

export default function BoardPage({
	onEditTask,
	onNewTask,
	tasks,
	onRefreshData,
	onTasksUpdated,
	statuses,
	milestones,
	availableLabels,
	milestoneEntities,
	archivedMilestones,
	isLoading,
	loadingMessage,
	loadError,
	hideEmptyColumns,
	dateFormat,
	availablePriorities,
	availableTypes,
	availableProjects,
}: BoardPageProps) {
	const location = useLocation();
	const navigate = useNavigate();
	const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
	const [laneMode, setLaneMode] = useState<LaneMode>('none');
	const laneStorageKey = 'backlog.board.lane';
	const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

	// Values are canonical once the configuration is loaded; one it does not know is dropped.
	const canonicalFilterValues = useMemo(
		() => ({
			type: (value: string) => resolveTaskTypeValue(value, availableTypes),
			priority: (value: string) => resolvePriorityValue(value, availablePriorities),
			project: (value: string) => resolveProjectValue(value, availableProjects),
		}),
		[availableTypes, availablePriorities, availableProjects],
	);
	const { filters, setFilters } = useUrlFilters(BOARD_FILTER_KEYS, canonicalFilterValues, !isLoading);

	useEffect(() => {
		const storedLane = typeof window !== 'undefined' ? window.localStorage.getItem(laneStorageKey) : null;
		const paramLane = searchParams.get('lane');
		const parseLane = (value: string | null): LaneMode | null => {
			if (value === 'milestone') return 'milestone';
			if (value === 'none') return 'none';
			return null;
		};
		const nextLane = parseLane(paramLane) ?? parseLane(storedLane) ?? 'none';
		setLaneMode((current) => (current === nextLane ? current : nextLane));
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(laneStorageKey, nextLane);
		}
	}, [searchParams]);

	useEffect(() => {
		const highlight = searchParams.get('highlight');
		if (highlight) {
			setHighlightTaskId(highlight);
			// Clear the highlight parameter after setting it
			navigate({ search: updateSearch(location.search, { highlight: null }) }, { replace: true, state: location.state });
		}
	}, [searchParams, navigate, location.search, location.state]);

	// Clear highlight after it's been used
	const handleEditTask = (task: Task) => {
		setHighlightTaskId(null); // Clear highlight so popup doesn't reopen
		onEditTask(task);
	};

	const handleLaneChange = (mode: LaneMode) => {
		setLaneMode(mode);
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(laneStorageKey, mode);
		}
		navigate({ search: updateSearch(location.search, { lane: mode === 'none' ? null : mode }) }, { replace: true });
	};

	return (
		<div className="page-shell transition-colors duration-200">
			<Board
				onEditTask={handleEditTask}
				onNewTask={onNewTask}
				highlightTaskId={highlightTaskId}
				tasks={tasks}
				onRefreshData={onRefreshData}
				onTasksUpdated={onTasksUpdated}
				statuses={statuses}
				milestones={milestones}
				milestoneEntities={milestoneEntities}
				archivedMilestones={archivedMilestones}
				isLoading={isLoading}
				loadingMessage={loadingMessage}
				loadError={loadError}
				availableLabels={availableLabels}
				laneMode={laneMode}
				onLaneChange={handleLaneChange}
				availablePriorities={availablePriorities}
				availableTypes={availableTypes}
				availableProjects={availableProjects}
				filters={filters}
				onFiltersChange={setFilters}
				hideEmptyColumns={hideEmptyColumns}
				dateFormat={dateFormat}
			/>
		</div>
	);
}
