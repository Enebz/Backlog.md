import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import SideNavigation from './SideNavigation';
import Navigation from './Navigation';
import { HealthIndicator, HealthSuccessToast } from './HealthIndicator';
import { DuplicateIdWarning } from './DuplicateIdWarning';
import type { DuplicateRepairPlan } from '../../core/duplicate-task-repair';
import { type Task, type Document, type Decision } from '../../types';
import { useWebUserName } from '../contexts/WebUserContext';
import { getWorkflow, hasUserReplied, statusQueue } from '../utils/workflow';

const NARROW_QUERY = '(max-width: 767px)';

/** True below the md breakpoint, following the viewport as it changes. */
function useIsNarrow(): boolean {
	const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
	const [isNarrow, setIsNarrow] = useState(query);
	useEffect(() => {
		if (typeof window.matchMedia !== 'function') return;
		const media = window.matchMedia(NARROW_QUERY);
		const update = () => setIsNarrow(media.matches);
		update();
		media.addEventListener?.('change', update);
		return () => media.removeEventListener?.('change', update);
	}, []);
	return isNarrow;
}

interface LayoutProps {
	projectName: string;
	showSuccessToast: boolean;
	onDismissToast: () => void;
	tasks: Task[];
	docs: Document[];
	decisions: Decision[];
	isLoading: boolean;
	loadingMessage?: string | null;
	error?: Error | null;
	onRefreshData: () => Promise<void>;
	duplicateRepairPlan?: DuplicateRepairPlan | null;
	statuses?: string[];
}

export default function Layout({
	projectName,
	showSuccessToast,
	onDismissToast,
	tasks,
	docs,
	decisions,
	isLoading,
	loadingMessage,
	error,
	onRefreshData,
	duplicateRepairPlan = null,
	statuses = [],
}: LayoutProps) {
	const isNarrow = useIsNarrow();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const location = useLocation();
	const webUserName = useWebUserName();
	const waitingStatus = useMemo(() => getWorkflow(statuses).waitingStatus, [statuses]);
	const waitingCount = useMemo(
		() => (waitingStatus ? statusQueue(tasks, waitingStatus).filter((task) => !hasUserReplied(task, webUserName)).length : 0),
		[tasks, waitingStatus, webUserName],
	);

	// Following a link closes the drawer.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the location is the trigger, not an input.
	useEffect(() => {
		setDrawerOpen(false);
	}, [location.pathname, location.search]);

	useEffect(() => {
		if (!drawerOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setDrawerOpen(false);
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [drawerOpen]);

	const navigationProps = {
		taskCount: tasks.length,
		docs,
		decisions,
		isLoading,
		error,
		onRetry: onRefreshData,
		onRefreshData,
		waitingStatus,
		waitingCount,
	};

	return (
		<div className="h-screen bg-gray-50 dark:bg-gray-900 flex overflow-hidden transition-colors duration-200">
			<HealthIndicator />
			{!isNarrow && <SideNavigation {...navigationProps} />}
			{isNarrow && drawerOpen && (
				<div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Navigation">
					<SideNavigation {...navigationProps} inDrawer />
					<button
						type="button"
						className="flex-1 bg-black/40"
						aria-label="Close navigation"
						onClick={() => setDrawerOpen(false)}
					/>
				</div>
			)}
			<div className="flex-1 flex flex-col min-h-0 min-w-0">
				<Navigation
					projectName={projectName}
					loadingMessage={loadingMessage}
					onOpenNavigation={isNarrow ? () => setDrawerOpen(true) : undefined}
					waitingCount={isNarrow ? waitingCount : 0}
				/>
				<DuplicateIdWarning plan={duplicateRepairPlan} onRepaired={onRefreshData} />
				<main className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
					<Outlet context={{ tasks, docs, decisions, isLoading, onRefreshData }} />
				</main>
			</div>
			{showSuccessToast && (
				<HealthSuccessToast onDismiss={onDismissToast} />
			)}
		</div>
	);
}
