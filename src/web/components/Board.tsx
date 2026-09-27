import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Milestone, type Task } from '../../types';
import { apiClient, type ReorderTaskPayload } from '../lib/api';
import { buildLanes, DEFAULT_LANE_KEY, groupTasksByLaneAndStatus, type LaneMode, sortTasksForStatus } from '../lib/lanes';
import { collectArchivedMilestoneKeys, milestoneKey } from '../utils/milestones';
import { getTerminalStatus } from '../../utils/terminal-status';
import { getProjectValues } from '../../utils/project-config';
import { getTaskTypeValues } from '../../utils/task-type-config';
import { resolveTaskById } from '../../utils/task-id';
import TaskColumn from './TaskColumn';
import { BoardLoadingSkeleton } from './BoardLoadingSkeleton';
import CleanupModal from './CleanupModal';
import FilterBar from './FilterBar';
import { ExcludeIcon } from './FilterMenu';
import { SuccessToast } from './SuccessToast';
import { useWebUserName } from '../contexts/WebUserContext';
import { decisionKindFor, getWorkflow, hasUserReplied, statusQueue } from '../utils/workflow';
import { getBlockedStates } from '../utils/blocked';
import {
  applyFilters,
  BLOCKED_VALUE,
  type FilterContext,
  type FilterKey,
  type FilterState,
  isSelectionEmpty,
  optionState,
  setOptionState,
  valuesPassSelection,
} from '../utils/filters';
import { useTaskFilterDefinitions } from './taskFilterDefinitions';

interface BoardProps {
  onEditTask: (task: Task) => void;
  onNewTask: () => void;
  highlightTaskId?: string | null;
  tasks: Task[];
  onRefreshData?: () => Promise<void>;
  onTasksUpdated?: (tasks: Task[], requestTask: Task) => void;
  statuses: string[];
  isLoading: boolean;
  loadingMessage?: string | null;
  loadError?: Error | null;
  milestones: string[];
  availableLabels: string[];
  milestoneEntities: Milestone[];
  archivedMilestones: Milestone[];
  laneMode: LaneMode;
  onLaneChange: (mode: LaneMode) => void;
  availablePriorities?: string[];
  availableTypes?: string[];
  availableProjects?: string[];
  /** The board's filters, as the address holds them (see ../utils/filters). */
  filters?: FilterState;
  onFiltersChange?: (filters: FilterState) => void;
  hideEmptyColumns?: boolean;
  dateFormat?: string;
}

/** The filters the board offers, in the order it shows them. Blocked is set from the strip above the board. */
export const BOARD_FILTER_KEYS: readonly FilterKey[] = [
  'assignee',
  'askedBy',
  'label',
  'type',
  'project',
  'priority',
  'milestone',
  'blocked',
];

const NO_FILTERS: FilterState = {};

const BOARD_FILTER_SELECT_CLASS =
  'min-w-[140px] h-10 py-2 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 transition-colors duration-200';

const BOARD_FILTER_BUTTON_CLASS =
  'h-10 py-2 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg whitespace-nowrap transition-colors duration-200 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700';

const Board: React.FC<BoardProps> = ({
  onEditTask,
  onNewTask,
  highlightTaskId,
  tasks,
  onRefreshData,
  onTasksUpdated,
  statuses,
  isLoading,
  loadingMessage,
  loadError,
  milestones,
  availableLabels,
  milestoneEntities,
  archivedMilestones,
  laneMode,
  onLaneChange,
  availablePriorities,
  availableTypes,
  availableProjects,
  filters = NO_FILTERS,
  onFiltersChange,
  hideEmptyColumns = false,
  dateFormat,
}) => {
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  // True while a drag that moves the whole selection is in flight, so every selected card can
  // carry the same dragging treatment as the grabbed one.
  const [isSelectionDragging, setIsSelectionDragging] = useState(false);
  const [batchMoveStatus, setBatchMoveStatus] = useState<string>('');
  const [dragSourceStatus, setDragSourceStatus] = useState<string | null>(null);
  const [dragSourceLane, setDragSourceLane] = useState<string | null>(null);
  // Set one task after dragstart, never inside it: see handleColumnDragStart.
  const [hiddenColumnsRevealed, setHiddenColumnsRevealed] = useState(false);
  const revealHiddenColumnsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupSuccessMessage, setCleanupSuccessMessage] = useState<string | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>({});
  const terminalStatus = getTerminalStatus(statuses);
  const webUserName = useWebUserName();
  const workflow = useMemo(() => getWorkflow(statuses), [statuses]);
  const typeOptions = useMemo(() => getTaskTypeValues(availableTypes), [availableTypes]);
  const projectOptions = useMemo(() => getProjectValues(availableProjects), [availableProjects]);
  const archivedMilestoneIds = useMemo(
    () => collectArchivedMilestoneKeys(archivedMilestones, milestoneEntities),
    [archivedMilestones, milestoneEntities]
  );
  const milestoneAliasToCanonical = useMemo(() => {
    const aliasMap = new Map<string, string>();
    const activeTitleCounts = new Map<string, number>();
    const collectIdAliasKeys = (value: string): string[] => {
      const normalized = value.trim();
      const normalizedKey = normalized.toLowerCase();
      if (!normalizedKey) return [];
      const keys = new Set<string>([normalizedKey]);
      if (/^\d+$/.test(normalized)) {
        const numericAlias = String(Number.parseInt(normalized, 10));
        keys.add(numericAlias);
        keys.add(`m-${numericAlias}`);
        return Array.from(keys);
      }
      const idMatch = normalized.match(/^m-(\d+)$/i);
      if (idMatch?.[1]) {
        const numericAlias = String(Number.parseInt(idMatch[1], 10));
        keys.add(`m-${numericAlias}`);
        keys.add(numericAlias);
      }
      return Array.from(keys);
    };
    const reservedIdKeys = new Set<string>();
    for (const milestone of [...milestoneEntities, ...archivedMilestones]) {
      for (const key of collectIdAliasKeys(milestone.id)) {
        reservedIdKeys.add(key);
      }
    }
    const setAlias = (aliasKey: string, id: string, allowOverwrite: boolean) => {
      const existing = aliasMap.get(aliasKey);
      if (!existing) {
        aliasMap.set(aliasKey, id);
        return;
      }
      if (!allowOverwrite) {
        return;
      }
      const existingKey = existing.toLowerCase();
      const nextKey = id.toLowerCase();
      const preferredRawId = /^\d+$/.test(aliasKey) ? `m-${aliasKey}` : /^m-\d+$/.test(aliasKey) ? aliasKey : null;
      if (preferredRawId) {
        const existingIsPreferred = existingKey === preferredRawId;
        const nextIsPreferred = nextKey === preferredRawId;
        if (existingIsPreferred && !nextIsPreferred) {
          return;
        }
        if (nextIsPreferred && !existingIsPreferred) {
          aliasMap.set(aliasKey, id);
        }
        return;
      }
      aliasMap.set(aliasKey, id);
    };
    const addIdAliases = (id: string, options?: { allowOverwrite?: boolean }) => {
      const allowOverwrite = options?.allowOverwrite ?? true;
      const idKey = id.toLowerCase();
      setAlias(idKey, id, allowOverwrite);
      const idMatch = id.match(/^m-(\d+)$/i);
      if (!idMatch?.[1]) return;
      const numericAlias = String(Number.parseInt(idMatch[1], 10));
      const canonicalId = `m-${numericAlias}`;
      setAlias(canonicalId, id, allowOverwrite);
      setAlias(numericAlias, id, allowOverwrite);
    };
    for (const milestone of milestoneEntities) {
      const title = milestone.title.trim();
      if (!title) continue;
      const titleKey = title.toLowerCase();
      activeTitleCounts.set(titleKey, (activeTitleCounts.get(titleKey) ?? 0) + 1);
    }
    const activeTitleKeys = new Set(activeTitleCounts.keys());
    for (const milestone of milestoneEntities) {
      const id = milestone.id.trim();
      const title = milestone.title.trim();
      if (!id) continue;
      addIdAliases(id);
      if (title) {
        const titleKey = title.toLowerCase();
        if (!reservedIdKeys.has(titleKey) && activeTitleCounts.get(titleKey) === 1) {
          if (!aliasMap.has(titleKey)) {
            aliasMap.set(titleKey, id);
          }
        }
      }
    }
    const archivedTitleCounts = new Map<string, number>();
    for (const milestone of archivedMilestones) {
      const title = milestone.title.trim();
      if (!title) continue;
      const titleKey = title.toLowerCase();
      if (activeTitleKeys.has(titleKey)) {
        continue;
      }
      archivedTitleCounts.set(titleKey, (archivedTitleCounts.get(titleKey) ?? 0) + 1);
    }
    for (const milestone of archivedMilestones) {
      const id = milestone.id.trim();
      const title = milestone.title.trim();
      if (!id) continue;
      addIdAliases(id, { allowOverwrite: false });
      if (title) {
        const titleKey = title.toLowerCase();
        if (!activeTitleKeys.has(titleKey) && !reservedIdKeys.has(titleKey) && archivedTitleCounts.get(titleKey) === 1) {
          if (!aliasMap.has(titleKey)) {
            aliasMap.set(titleKey, id);
          }
        }
      }
    }
    return aliasMap;
  }, [milestoneEntities, archivedMilestones]);
  const canonicalizeMilestone = (value?: string | null): string => {
    const normalized = (value ?? "").trim();
    if (!normalized) return "";
    const key = normalized.toLowerCase();
    const direct = milestoneAliasToCanonical.get(key);
    if (direct) {
      return direct;
    }
    const idMatch = normalized.match(/^m-(\d+)$/i);
    if (idMatch?.[1]) {
      const numericAlias = String(Number.parseInt(idMatch[1], 10));
      return milestoneAliasToCanonical.get(`m-${numericAlias}`) ?? milestoneAliasToCanonical.get(numericAlias) ?? normalized;
    }
    if (/^\d+$/.test(normalized)) {
      const numericAlias = String(Number.parseInt(normalized, 10));
      return milestoneAliasToCanonical.get(`m-${numericAlias}`) ?? milestoneAliasToCanonical.get(numericAlias) ?? normalized;
    }
    return normalized;
  };

  // The person's two queues, over the whole board: proposals to approve and questions to answer.
  const decisionQueues = useMemo(() => {
    const undecided = (status: string | null) =>
      status ? statusQueue(tasks, status).filter((task) => !hasUserReplied(task, webUserName)) : [];
    return {
      questions: undecided(workflow.waitingStatus),
      proposals: workflow.proposalStatus && workflow.approvedStatus ? undecided(workflow.proposalStatus) : [],
    };
  }, [tasks, workflow, webUserName]);

  // Blocked is read against the whole board, so a filter never hides the dependency that blocks a card.
  const blockedStates = useMemo(() => getBlockedStates(tasks, statuses), [tasks, statuses]);

  const filterContext = useMemo<FilterContext>(
    () => ({
      milestoneKey: (value) => milestoneKey(canonicalizeMilestone(value)),
      isBlocked: (task) => blockedStates.has(task.id),
    }),
    // canonicalizeMilestone reads only the alias map.
    [milestoneAliasToCanonical, blockedStates]
  );

  const filteredTasks = useMemo(() => applyFilters(tasks, filters, filterContext), [tasks, filters, filterContext]);
  // Lane counts and progress follow every filter but the milestone one, which picks the lanes to open.
  const laneMetadataTasks = useMemo(
    () => applyFilters(tasks, filters, filterContext, 'milestone'),
    [tasks, filters, filterContext]
  );
  // The quick filter counts what it would show under the other filters.
  const blockedTasks = useMemo(
    () => applyFilters(tasks, filters, filterContext, 'blocked').filter(task => blockedStates.has(task.id)),
    [tasks, filters, filterContext, blockedStates]
  );
  const blockedFilter = optionState(filters.blocked, BLOCKED_VALUE, (value) => value);
  const setBlockedFilter = (next: 'include' | 'exclude' | 'off') =>
    onFiltersChange?.({ ...filters, blocked: setOptionState(filters.blocked, BLOCKED_VALUE, next, (value) => value) });

  const filterDefinitions = useTaskFilterDefinitions({
    keys: BOARD_FILTER_KEYS,
    tasks,
    filters,
    context: filterContext,
    webUserName,
    availableLabels,
    availablePriorities,
    typeOptions,
    projectOptions,
    milestoneEntities,
    milestoneIds: milestones,
    // Set from the strip above the board, so only its chip shows with the other filters.
    blockedControl: 'chips',
  });

  // Handle highlighting a task (opening its edit popup)
  useEffect(() => {
    if (highlightTaskId && tasks.length > 0) {
      const resolution = resolveTaskById(tasks, highlightTaskId);
      if (resolution.status === 'found') {
        const timer = setTimeout(() => {
          onEditTask(resolution.task);
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [highlightTaskId, tasks, onEditTask]);

  const clearSelection = React.useCallback(() => {
    setSelectedTaskIds([]);
    setSelectionAnchorId(null);
    // A completed batch drop can unmount the grabbed card before its dragend fires, so the
    // selection-drag state resets here rather than trusting that event.
    setIsSelectionDragging(false);
  }, []);

  const toggleTaskSelection = React.useCallback((taskId: string) => {
    setSelectedTaskIds((previous) =>
      previous.includes(taskId) ? previous.filter((id) => id !== taskId) : [...previous, taskId]
    );
    setSelectionAnchorId(taskId);
  }, []);

  // A range only adds to the selection, so leaving the anchor on the first clicked card reaches the
  // same union a moved anchor would. The anchor moves on ctrl-click, where it does change the range.
  const selectTaskRange = React.useCallback((taskIds: string[]) => {
    setSelectedTaskIds((previous) => {
      const next = [...previous];
      for (const taskId of taskIds) {
        if (!next.includes(taskId)) next.push(taskId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (selectedTaskIds.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedTaskIds.length, clearSelection]);


  // targetMilestone is only supplied by a drop into a milestone lane; the toolbar moves the
  // selection between columns and leaves every task's milestone alone.
  const handleBatchMove = async (targetStatus: string, targetMilestone?: string | null) => {
    if (selectedTaskIds.length === 0 || !targetStatus) return;
    const resolutions = selectedTaskIds.map((taskId) => {
      const resolution = resolveTaskById(tasks, taskId);
      return { taskId, task: resolution.status === 'found' ? resolution.task : undefined };
    });
    const selectedTasks = resolutions
      .map((resolution) => resolution.task)
      .filter((task): task is Task => task !== undefined);

    // The batch lands in the target column in the order it reads on the board, not in the order
    // the cards happened to be clicked. Unresolvable IDs stay in the request so the server can
    // report them per task.
    const orderedTasks = statuses.flatMap((status) =>
      sortTasksForStatus(selectedTasks.filter((task) => task.status === status), status)
    );
    const orderedIds = new Set(orderedTasks.map((task) => task.id));
    const taskIds = [
      ...orderedTasks.map((task) => task.id),
      ...resolutions.filter(({ task }) => !task || !orderedIds.has(task.id)).map(({ taskId }) => taskId),
    ];

    // Dropping the selection back where it already sits changes nothing, so it stays a pure no-op:
    // no request, no refresh, and the selection survives so the drag can be retried.
    const landsWhereItAlreadyIs =
      selectedTasks.length === taskIds.length &&
      selectedTasks.every(
        (task) =>
          task.status === targetStatus &&
          (targetMilestone === undefined ||
            canonicalizeMilestone(task.milestone) === canonicalizeMilestone(targetMilestone))
      );
    if (landsWhereItAlreadyIs) return;

    const requestTask = selectedTasks[0];
    clearSelection();
    setBatchMoveStatus('');
    try {
      const result = await apiClient.moveTasks({
        taskIds,
        targetStatus,
        ...(targetMilestone !== undefined ? { targetMilestone } : {}),
      });
      setUpdateError(
        result.failures.length > 0
          ? `Could not move ${result.failures.length} of ${taskIds.length} tasks. ${result.failures
              .map((failure) => `${failure.taskId}: ${failure.reason}`)
              .join(' ')}`
          : null
      );
      // Feed the moved tasks back through the board's own store update, exactly as a single-card
      // reorder does. Reloading every board resource instead remounts the whole view.
      const movedTasks = result.changedTasks ?? result.tasks;
      if (requestTask && onTasksUpdated && movedTasks.length > 0) {
        onTasksUpdated(movedTasks, requestTask);
      } else if (onRefreshData) await onRefreshData();
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to move tasks');
    }
  };

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    try {
      await apiClient.updateTask(taskId, updates);
      // Refresh data to reflect the changes
      if (onRefreshData) {
        await onRefreshData();
      }
      setUpdateError(null);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to update task');
    }
  };

  const handleTaskReorder = async (payload: ReorderTaskPayload) => {
    try {
      const requestResolution = resolveTaskById(tasks, payload.taskId);
      const requestTask = requestResolution.status === 'found' ? requestResolution.task : undefined;
      const result = await apiClient.reorderTask(payload);
      if (requestTask && onTasksUpdated) {
        onTasksUpdated(result.changedTasks ?? [result.task], requestTask);
      } else if (onRefreshData) await onRefreshData();
      setUpdateError(null);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to reorder task');
    }
  };

  const handleCleanupSuccess = async (movedCount: number) => {
    setShowCleanupModal(false);
    setCleanupSuccessMessage(`Successfully moved ${movedCount} task${movedCount !== 1 ? 's' : ''} to completed folder`);

    // Refresh data to reflect the changes
    if (onRefreshData) {
      await onRefreshData();
    }

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      setCleanupSuccessMessage(null);
    }, 4000);
  };

  // Use all tasks for building lanes (so we can show/collapse other milestones)
  const lanes = useMemo(
    () => buildLanes(laneMode, tasks, milestoneEntities.map((milestone) => milestone.id), milestoneEntities, {
      archivedMilestoneIds,
      archivedMilestones,
    }),
    [laneMode, tasks, milestoneEntities, archivedMilestoneIds, archivedMilestones]
  );

  // Check if any tasks actually have milestones assigned
  const hasTasksWithMilestones = useMemo(() => {
    if (archivedMilestoneIds.length === 0) {
      return tasks.some(task => task.milestone && task.milestone.trim() !== '');
    }
    const archivedKeys = new Set(archivedMilestoneIds.map((value) => milestoneKey(value)));
    return tasks.some(task => {
      const key = milestoneKey(canonicalizeMilestone(task.milestone));
      return key.length > 0 && !archivedKeys.has(key);
    });
  }, [tasks, archivedMilestoneIds, milestoneAliasToCanonical]);

  // The cards the columns show, and the ones lane counts and progress are read from.
  const displayTasksByLane = useMemo(
    () =>
      groupTasksByLaneAndStatus(laneMode, lanes, statuses, filteredTasks, {
        archivedMilestoneIds,
        milestoneEntities,
        archivedMilestones,
      }),
    [laneMode, lanes, statuses, filteredTasks, archivedMilestoneIds, milestoneEntities, archivedMilestones]
  );
  const laneMetadataTasksByLane = useMemo(
    () =>
      laneMetadataTasks === filteredTasks
        ? displayTasksByLane
        : groupTasksByLaneAndStatus(laneMode, lanes, statuses, laneMetadataTasks, {
            archivedMilestoneIds,
            milestoneEntities,
            archivedMilestones,
          }),
    [laneMode, lanes, statuses, laneMetadataTasks, filteredTasks, displayTasksByLane, archivedMilestoneIds, milestoneEntities, archivedMilestones]
  );

  const getTasksForLane = (laneKey: string, status: string): Task[] => {
    const statusMap = displayTasksByLane.get(laneKey);
    if (!statusMap) {
      return [];
    }
    return statusMap.get(status) ?? [];
  };

  const laneTaskCount = (laneKey: string): number => {
    const statusMap = laneMetadataTasksByLane.get(laneKey);
    if (!statusMap) return 0;
    let count = 0;
    for (const list of statusMap.values()) {
      count += list.length;
    }
    return count;
  };

  const countDoneTasksInLane = (laneKey: string): number => {
    const statusMap = laneMetadataTasksByLane.get(laneKey);
    if (!statusMap) return 0;
    let count = 0;
    for (const [status, taskList] of statusMap) {
      if (status.toLowerCase().includes('done') || status.toLowerCase().includes('complete')) {
        count += taskList.length;
      }
    }
    return count;
  };

  const getLaneProgress = (laneKey: string): number => {
    const total = laneTaskCount(laneKey);
    if (total === 0) return 0;
    const done = countDoneTasksInLane(laneKey);
    return Math.round((done / total) * 100);
  };

  // Filter out empty lanes in milestone mode
  const visibleLanes = useMemo(() => {
    if (laneMode !== 'milestone') return lanes;
    return lanes.filter(l => laneTaskCount(l.key) > 0);
  }, [laneMode, lanes, laneMetadataTasksByLane]);

  // When hideEmptyColumns is on, filter out status columns with no tasks across all visible lanes.
  // While a task is being dragged we keep every column visible so empty statuses remain drop targets.
  const visibleStatuses = useMemo(() => {
    if (!hideEmptyColumns || hiddenColumnsRevealed) return statuses;
    return statuses.filter(status => {
      for (const statusMap of displayTasksByLane.values()) {
        if ((statusMap.get(status) ?? []).length > 0) return true;
      }
      return false;
    });
  }, [hideEmptyColumns, hiddenColumnsRevealed, statuses, displayTasksByLane]);

  const cancelHiddenColumnsReveal = () => {
    if (revealHiddenColumnsTimer.current !== null) clearTimeout(revealHiddenColumnsTimer.current);
    revealHiddenColumnsTimer.current = null;
  };

  const handleColumnDragStart = ({ status, laneId }: { status: string; laneId?: string | null }) => {
    setDragSourceStatus(status);
    setDragSourceLane(laneId ?? null);
    if (!hideEmptyColumns) return;
    // Adding the hidden columns changes the board layout, and Chromium aborts a native drag whose
    // dragstart handler does that: the card never becomes draggable. React commits this state
    // update synchronously inside the event, so the reveal has to wait for the next task, by which
    // time the browser has committed the drag.
    cancelHiddenColumnsReveal();
    revealHiddenColumnsTimer.current = setTimeout(() => {
      revealHiddenColumnsTimer.current = null;
      setHiddenColumnsRevealed(true);
    }, 0);
  };

  const handleColumnDragEnd = () => {
    cancelHiddenColumnsReveal();
    setDragSourceStatus(null);
    setDragSourceLane(null);
    setHiddenColumnsRevealed(false);
  };

  useEffect(() => cancelHiddenColumnsReveal, []);

  // Only show lane headers when multiple lanes exist
  const shouldShowLaneHeaders = useMemo(() => {
    if (laneMode !== 'milestone') return false;
    return visibleLanes.length > 1;
  }, [laneMode, visibleLanes]);

  // Determine if a lane should be collapsed (respects the milestone filter)
  const isLaneCollapsed = (laneKey: string, laneMilestone?: string): boolean => {
    // If user manually toggled, respect that
    if (collapsedLanes[laneKey] !== undefined) {
      return collapsedLanes[laneKey];
    }
    // When filtering by milestone, the lanes the filter leaves out start collapsed
    return (
      !isSelectionEmpty(filters.milestone) &&
      !valuesPassSelection('milestone', [laneMilestone], filters.milestone, filterContext)
    );
  };

  const getLaneLabel = (lane: typeof lanes[0]): string => {
    if (lane.isNoMilestone || !lane.milestone) {
      return 'Unassigned';
    }
    return lane.label;
  };

  const toggleLaneCollapse = (laneKey: string) => {
    setCollapsedLanes(prev => ({
      ...prev,
      [laneKey]: !prev[laneKey],
    }));
  };

  // A card hidden by a filter or a collapsed lane is no longer part of what the user sees, so it
  // must not ride along in a batch move. Pruning here keeps the selection equal to the visible cards.
  useEffect(() => {
    const visibleIds = new Set(filteredTasks.map((task) => task.id));
    if (laneMode === 'milestone') {
      for (const lane of lanes) {
        if (!isLaneCollapsed(lane.key, lane.milestone)) continue;
        const statusMap = displayTasksByLane.get(lane.key);
        if (!statusMap) continue;
        for (const laneTasks of statusMap.values()) {
          for (const task of laneTasks) visibleIds.delete(task.id);
        }
      }
    }
    setSelectedTaskIds((previous) => {
      const next = previous.filter((taskId) => visibleIds.has(taskId));
      return next.length === previous.length ? previous : next;
    });
    setSelectionAnchorId((previous) => (previous && visibleIds.has(previous) ? previous : null));
    // biome-ignore lint/correctness/useExhaustiveDependencies: isLaneCollapsed is a plain render-scope helper; its inputs are listed.
  }, [filteredTasks, laneMode, lanes, displayTasksByLane, collapsedLanes, filters.milestone, filterContext]);

  // Dynamic layout using flexbox:
  // - Columns are flex items with equal growth (flex-1) to divide space evenly
  // - A minimum width keeps columns readable; beyond available space, container scrolls horizontally
  // - Works uniformly for any number of columns without per-count conditionals

  const selectionProps = {
    selectedTaskIds,
    selectionAnchorId,
    onToggleTaskSelection: toggleTaskSelection,
    onSelectTaskRange: selectTaskRange,
    onBatchMove: handleBatchMove,
    isSelectionDragging,
    onSelectionDragChange: setIsSelectionDragging,
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape already clears the selection for keyboard users.
    <div
      className="w-full"
      onClick={(event) => {
        if (selectedTaskIds.length > 0 && event.target === event.currentTarget) clearSelection();
      }}
    >
      {updateError && (
        <div className="mb-4 rounded-md bg-red-100 px-4 py-3 text-sm text-red-700 dark:bg-red-900/40 dark:text-red-200 transition-colors duration-200">
          {updateError}
        </div>
      )}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 transition-colors duration-200">Kanban Board</h2>
          <button
            className="inline-flex items-center px-4 py-2 bg-blue-500 dark:bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400 dark:focus:ring-blue-500 dark:focus:ring-offset-gray-800 transition-colors duration-200"
            onClick={onNewTask}
          >
            + New Task
          </button>
        </div>
        {(decisionQueues.questions.length > 0 || decisionQueues.proposals.length > 0 || blockedTasks.length > 0 || blockedFilter !== 'off') && (
          <div className="flex flex-wrap gap-3">
            {(decisionQueues.questions.length > 0 || decisionQueues.proposals.length > 0) && (
              <div className="contents" role="region" aria-label="Decisions waiting">
                {decisionQueues.questions[0] && workflow.waitingStatus && (
                  <button
                    type="button"
                    onClick={() => onEditTask(decisionQueues.questions[0] as Task)}
                    className="group flex min-w-[15rem] flex-1 items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left transition-colors duration-150 hover:border-amber-400 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-700 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 sm:flex-none"
                  >
                    <span className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-300">{decisionQueues.questions.length}</span>
                    <span className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
                      <span className="block font-semibold">{workflow.waitingStatus}</span>
                      <span className="block text-xs text-amber-800/80 dark:text-amber-200/80">unanswered questions</span>
                    </span>
                    <span className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white group-hover:bg-amber-600 dark:bg-amber-600">Answer</span>
                  </button>
                )}
                {decisionQueues.proposals[0] && workflow.proposalStatus && (
                  <button
                    type="button"
                    onClick={() => onEditTask(decisionQueues.proposals[0] as Task)}
                    className="group flex min-w-[15rem] flex-1 items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left transition-colors duration-150 hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 sm:flex-none"
                  >
                    <span className="text-2xl font-bold tabular-nums text-blue-700 dark:text-blue-300">{decisionQueues.proposals.length}</span>
                    <span className="min-w-0 flex-1 text-sm text-blue-900 dark:text-blue-100">
                      <span className="block font-semibold">{workflow.proposalStatus}</span>
                      <span className="block text-xs text-blue-800/80 dark:text-blue-200/80">proposals to approve or decline</span>
                    </span>
                    <span className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white group-hover:bg-blue-700">Review</span>
                  </button>
                )}
              </div>
            )}
            {onFiltersChange && (blockedTasks.length > 0 || blockedFilter !== 'off') && (
              <div
                role="group"
                aria-label="Blocked cards"
                className={`flex min-w-[15rem] flex-1 items-stretch overflow-hidden rounded-lg border transition-colors duration-150 sm:flex-none ${
                  blockedFilter === 'include'
                    ? 'border-red-400 bg-red-100 dark:border-red-600 dark:bg-red-950/60'
                    : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={blockedFilter === 'include'}
                  onClick={() => setBlockedFilter(blockedFilter === 'include' ? 'off' : 'include')}
                  className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 dark:hover:bg-red-950/50"
                >
                  <span className="text-2xl font-bold tabular-nums text-red-700 dark:text-red-300">{blockedTasks.length}</span>
                  <span className="min-w-0 flex-1 text-sm text-red-900 dark:text-red-100">
                    <span className="block font-semibold">Blocked</span>
                    <span className="block text-xs text-red-800/80 dark:text-red-200/80">
                      {blockedFilter === 'include'
                        ? 'only these are shown'
                        : blockedFilter === 'exclude'
                          ? 'hidden from the board'
                          : 'cards waiting on something'}
                    </span>
                  </span>
                  <span className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white group-hover:bg-red-700 dark:bg-red-700 dark:group-hover:bg-red-600">
                    {blockedFilter === 'include' ? 'Show all' : 'Show'}
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={blockedFilter === 'exclude'}
                  aria-label="Hide blocked cards"
                  title={blockedFilter === 'exclude' ? 'Show blocked cards again' : 'Hide blocked cards'}
                  onClick={() => setBlockedFilter(blockedFilter === 'exclude' ? 'off' : 'exclude')}
                  className={`flex w-12 shrink-0 items-center justify-center border-l transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 ${
                    blockedFilter === 'exclude'
                      ? 'border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-700 dark:bg-red-700'
                      : 'border-red-200 text-red-600 hover:bg-red-100 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50'
                  }`}
                >
                  <ExcludeIcon className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        )}
        {selectedTaskIds.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 px-4 py-2 transition-colors duration-200"
            role="toolbar"
            aria-label="Task selection"
          >
            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {selectedTaskIds.length} selected
            </span>
            <label className="sr-only" htmlFor="batch-move-status">
              Move selected tasks to
            </label>
            <select
              id="batch-move-status"
              className={BOARD_FILTER_SELECT_CLASS}
              value={batchMoveStatus}
              onChange={(event) => setBatchMoveStatus(event.target.value)}
            >
              <option value="">Move to...</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={BOARD_FILTER_BUTTON_CLASS}
              disabled={!batchMoveStatus}
              onClick={() => handleBatchMove(batchMoveStatus)}
            >
              Move
            </button>
            <button type="button" className={BOARD_FILTER_BUTTON_CLASS} onClick={clearSelection}>
              Clear
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3" role="toolbar" aria-label="Board view controls">
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-1 bg-gray-50 dark:bg-gray-800/50 transition-colors duration-200">
              <button
                type="button"
                onClick={() => onLaneChange('none')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                  laneMode === 'none'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                All Tasks
              </button>
              <button
                type="button"
                onClick={() => onLaneChange('milestone')}
                disabled={!hasTasksWithMilestones}
                title={!hasTasksWithMilestones ? 'No tasks have milestones. Assign milestones to tasks first.' : 'Group tasks by milestone'}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                  !hasTasksWithMilestones
                    ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50'
                    : laneMode === 'milestone'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                Milestone
              </button>
            </div>
            {onFiltersChange && (
              <FilterBar
                id="board-filter"
                label="Board filters"
                definitions={filterDefinitions}
                filters={filters}
                onChange={onFiltersChange}
                countNoun="cards"
              />
            )}
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-800 dark:bg-red-900/20" role="alert">
          <p className="font-medium text-red-700 dark:text-red-300">Failed to load tasks</p>
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{loadError.message}</p>
          {onRefreshData && (
            <button
              type="button"
              onClick={() => void onRefreshData()}
              className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
            >
              Retry
            </button>
          )}
        </div>
      ) : isLoading ? (
        <BoardLoadingSkeleton message={loadingMessage} columnCount={statuses.length} />
      ) : laneMode === 'milestone' ? (
        <div className="space-y-6">
          {visibleLanes.map((lane) => {
            const taskCount = laneTaskCount(lane.key);
            const progress = getLaneProgress(lane.key);
            const isCollapsed = isLaneCollapsed(lane.key, lane.milestone);

            return (
              <div key={lane.key} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-800/20 overflow-hidden">
                {/* Lane header inside the box */}
                {shouldShowLaneHeaders && (
                  <button
                    type="button"
                    onClick={() => toggleLaneCollapse(lane.key)}
                    className={`w-full flex items-center justify-between gap-4 px-4 py-3 bg-gray-100/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200 group ${!isCollapsed ? 'border-b border-gray-200 dark:border-gray-700' : ''}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <svg
                        className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-200 truncate">
                        {getLaneLabel(lane)}
                      </h3>
                      <span className="shrink-0 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors duration-200">
                        {taskCount}
                      </span>
                    </div>

                    {/* Mini progress bar */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-8 text-right">
                        {progress}%
                      </span>
                    </div>
                  </button>
                )}

                {/* Lane content - columns */}
                {!isCollapsed && (
                  <div className="p-4">
                    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${visibleStatuses.length}, minmax(0, 1fr))` }}>
                      {visibleStatuses.map((status) => (
                        <div key={`${lane.key}-${status}`} className="min-w-0">
                          <TaskColumn
                            title={status}
                            tasks={getTasksForLane(lane.key, status)}
                            onTaskUpdate={handleTaskUpdate}
                            onEditTask={onEditTask}
                            onTaskReorder={handleTaskReorder}
                            dragSourceStatus={dragSourceStatus}
                            dragSourceLane={dragSourceLane}
                            laneId={lane.key}
                            targetMilestone={lane.milestone ?? null}
                            priorityOrder={availablePriorities}
                            availableTypes={typeOptions}
                            availableProjects={projectOptions}
                            dateFormat={dateFormat}
                            onDragStart={handleColumnDragStart}
                            onDragEnd={handleColumnDragEnd}
                            onCleanup={status === terminalStatus ? () => setShowCleanupModal(true) : undefined}
                            decisionKind={decisionKindFor(status, workflow)}
                            blockedStates={blockedStates}
                            {...selectionProps}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto pb-2 snap-x snap-mandatory sm:snap-none">
          <div className="flex flex-row flex-nowrap gap-4 w-full">
            {visibleStatuses.map((status) => (
              <div key={status} className="flex-1 min-w-[85%] snap-start sm:min-w-[15rem]">
                <TaskColumn
                  title={status}
                  tasks={getTasksForLane(DEFAULT_LANE_KEY, status)}
                  onTaskUpdate={handleTaskUpdate}
                  onEditTask={onEditTask}
                  onTaskReorder={handleTaskReorder}
                  dragSourceStatus={dragSourceStatus}
                  dragSourceLane={dragSourceLane}
                  laneId={DEFAULT_LANE_KEY}
                  priorityOrder={availablePriorities}
                  availableTypes={typeOptions}
                  availableProjects={projectOptions}
                  dateFormat={dateFormat}
                  onDragStart={handleColumnDragStart}
                  onDragEnd={handleColumnDragEnd}
                  onCleanup={status === terminalStatus ? () => setShowCleanupModal(true) : undefined}
                  decisionKind={decisionKindFor(status, workflow)}
                  blockedStates={blockedStates}
                  {...selectionProps}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cleanup Modal */}
      <CleanupModal
        isOpen={showCleanupModal}
        onClose={() => setShowCleanupModal(false)}
        onSuccess={handleCleanupSuccess}
        dateFormat={dateFormat}
      />

      {/* Cleanup Success Toast */}
      {cleanupSuccessMessage && (
        <SuccessToast
          message={cleanupSuccessMessage}
          onDismiss={() => setCleanupSuccessMessage(null)}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      )}
    </div>
  );
};

export default Board;
