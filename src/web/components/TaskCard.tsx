import React from 'react';
import { type Task } from '../../types';
import { formatPriorityLabel } from '../../utils/priority-config';
import AcceptanceCriteriaProgress, { getAcceptanceCriteriaProgressCounts } from './AcceptanceCriteriaProgress';
import StoredDate from './StoredDate';
import ProjectBadge from './ProjectBadge';
import TaskTypeBadge from './TaskTypeBadge';
import PersonAvatar from './PersonAvatar';
import { useWebUserName } from '../contexts/WebUserContext';
import { askedBy, displayPerson, hasUserReplied, topicLabels } from '../utils/workflow';
import { type BlockedState, describeBlocked, isBlockedLabel } from '../utils/blocked';
import { isSamePerson } from '../../utils/web-user';
import BlockedPill from './BlockedPill';

interface TaskCardProps {
  task: Task;
  onUpdate: (taskId: string, updates: Partial<Task>) => void;
  onEdit: (task: Task) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  status?: string;
  laneId?: string;
  availableTypes?: string[];
  availableProjects?: string[];
  dateFormat?: string;
  isSelected?: boolean;
  selectionCount?: number;
  onSelect?: (event: { shiftKey: boolean }) => void;
  isSelectionDragging?: boolean;
  onSelectionDragChange?: (active: boolean) => void;
  /** Why the card is blocked, when it is: a red pill and outline, the reason on hover and on focus. */
  blocked?: BlockedState | null;
}

// A blocked card: a red left edge in place of the priority colour (its badge still shows it), inside a
// faint red outline. Each side is set on its own so no colour utility can override another.
const BLOCKED_CARD_CLASS =
  'border-l-4 border-l-red-500 border-t-red-200 border-r-red-200 border-b-red-200 ' +
  'dark:border-l-red-500 dark:border-t-red-900 dark:border-r-red-900 dark:border-b-red-900';

// Dragging a selected card moves the whole selection, so the drag image has to show it. Stacking
// empty cards (up to two) behind a copy of the dragged one, plus the count of every task that will
// move, keeps the board's own card styling.
const buildSelectionDragImage = (source: HTMLElement, count: number): HTMLElement => {
  const width = source.offsetWidth;
  const height = source.offsetHeight;
  const layer = (offset: number) => `position:absolute;top:${offset}px;left:${offset}px;width:${width}px;height:${height}px;margin:0;`;

  const behind = Math.min(count - 1, 2);
  const spread = 6 * behind;
  const ghost = document.createElement('div');
  ghost.style.cssText = `position:fixed;top:-1000px;left:-1000px;width:${width + spread}px;height:${height + spread}px;pointer-events:none;`;

  for (let depth = behind; depth >= 1; depth -= 1) {
    const shell = document.createElement('div');
    shell.className = source.className;
    shell.style.cssText = layer(6 * depth);
    ghost.appendChild(shell);
  }

  const front = source.cloneNode(true) as HTMLElement;
  front.style.cssText = layer(0);
  ghost.appendChild(front);

  const badge = document.createElement('div');
  badge.textContent = String(count);
  badge.style.cssText =
    'position:absolute;top:-8px;right:-8px;min-width:24px;height:24px;padding:0 6px;border-radius:9999px;' +
    'background:#3b82f6;color:#ffffff;font-size:12px;font-weight:600;line-height:24px;text-align:center;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.3);';
  ghost.appendChild(badge);

  return ghost;
};

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onEdit,
  onDragStart,
  onDragEnd,
  status,
  laneId,
  availableTypes,
  availableProjects,
  dateFormat,
  isSelected = false,
  selectionCount = 0,
  onSelect,
  isSelectionDragging = false,
  onSelectionDragChange,
  blocked = null,
}) => {
  const [isDragging, setIsDragging] = React.useState(false);
  const [showBranchTooltip, setShowBranchTooltip] = React.useState(false);
  const webUserName = useWebUserName();
  const requesters = askedBy(task.labels);
  // The pill says blocked, so the label that makes it is not repeated as a chip.
  const labels = topicLabels(task.labels).filter((label) => !blocked || !isBlockedLabel(label));
  const commentCount = task.comments?.length ?? 0;
  const userReplied = hasUserReplied(task, webUserName);
  const assigneeIsRequester = Boolean(requesters[0]) && task.assignee.length === 1 && isSamePerson(task.assignee[0], requesters[0]);

  // Check if task is from another branch (read-only)
  const isFromOtherBranch = Boolean(task.branch);
  const acceptanceCriteriaProgress = getAcceptanceCriteriaProgressCounts(task);
  const blockedLines = blocked ? describeBlocked(blocked) : [];
  const accessibleLabel = [
    `Open ${task.id}: ${task.title}`,
    ...blockedLines,
    ...(acceptanceCriteriaProgress
      ? [`Acceptance criteria progress: ${acceptanceCriteriaProgress.checked} of ${acceptanceCriteriaProgress.total}`]
      : []),
  ].join('. ');

  const handleDragStart = (e: React.DragEvent) => {
    // Prevent dragging cross-branch tasks
    if (isFromOtherBranch) {
      e.preventDefault();
      setShowBranchTooltip(true);
      setTimeout(() => setShowBranchTooltip(false), 3000);
      return;
    }

    e.dataTransfer.setData('text/plain', task.id);
    if (status) {
      e.dataTransfer.setData('text/status', status);
    }
    if (laneId !== undefined) {
      e.dataTransfer.setData('text/lane', laneId);
    }
    e.dataTransfer.effectAllowed = 'move';

    // A modifier-press that turns straight into a drag never completes the click, so the selection
    // would miss the very card being dragged and both the badge and the drop would come up one
    // short. Joining the selection here keeps them in agreement with what the user grabbed.
    const joinsSelection = !isSelected && selectionCount > 0 && (e.ctrlKey || e.metaKey) && Boolean(onSelect);
    if (joinsSelection) onSelect?.({ shiftKey: false });
    const batchCount = isSelected ? selectionCount : joinsSelection ? selectionCount + 1 : 1;

    if (batchCount > 1) {
      // The whole selection moves with this drag, so every selected card on the board carries the
      // same dragging treatment as the grabbed one.
      onSelectionDragChange?.(true);
      if (typeof e.dataTransfer.setDragImage === 'function') {
        const ghost = buildSelectionDragImage(e.currentTarget as HTMLElement, batchCount);
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 16, 16);
        // The browser snapshots the element during setDragImage, so it only has to survive this tick.
        setTimeout(() => ghost.remove(), 0);
      }
    }

    setIsDragging(true);
    onDragStart?.();
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    onSelectionDragChange?.(false);
    onDragEnd?.();
  };

  const getPriorityClass = (priority?: string) => {
    switch (priority) {
      case 'high': return 'border-l-4 border-l-red-500 dark:border-l-red-400';
      case 'medium': return 'border-l-4 border-l-yellow-500 dark:border-l-yellow-400';
      case 'low': return 'border-l-4 border-l-green-500 dark:border-l-green-400';
      default: return 'border-l-4 border-l-gray-300 dark:border-l-gray-600';
    }
  };

  const formatRelativeDate = (dateStr: string) => {
    // Handle both date-only and datetime formats
    const hasTime = dateStr.includes(" ") || dateStr.includes("T");
    const date = new Date(dateStr.replace(" ", "T") + (hasTime ? ":00Z" : "T00:00:00Z"));
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  };

  const getPriorityBadge = (priority?: string) => {
    switch (priority) {
      case 'high': return { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', label: 'High' };
      case 'medium': return { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300', label: 'Med' };
      case 'low': return { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300', label: 'Low' };
      default:
        return priority
          ? {
              bg: 'bg-gray-100 dark:bg-gray-600',
              text: 'text-gray-700 dark:text-gray-200',
              label: formatPriorityLabel(priority),
            }
          : null;
    }
  };

  const priorityBadge = getPriorityBadge(task.priority);

  return (
    <div className="relative">
      {/* Branch tooltip when trying to drag cross-branch task */}
      {showBranchTooltip && isFromOtherBranch && (
        <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 z-50 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-md shadow-lg whitespace-nowrap">
          <div className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Switch to <span className="font-semibold text-amber-300">{task.branch}</span> branch to move this task
          </div>
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 rotate-45 w-2 h-2 bg-gray-900 dark:bg-gray-700"></div>
        </div>
      )}

      <div
        className={`group/card bg-white dark:bg-gray-700 border rounded-md p-3 mb-2 transition-all duration-200 ${
          blocked ? BLOCKED_CARD_CLASS : `border-gray-200 dark:border-gray-600 ${getPriorityClass(task.priority)}`
        } ${
          isFromOtherBranch
            ? 'opacity-75 cursor-not-allowed border-dashed'
            : `cursor-pointer hover:shadow-md dark:hover:shadow-lg ${
                blocked ? '' : 'hover:border-stone-500 dark:hover:border-stone-400'
              }`
        } ${
          isDragging || (isSelected && isSelectionDragging) ? 'opacity-50 transform rotate-2 scale-105' : ''
        } ${
          isSelected
            ? 'ring-2 ring-blue-500 dark:ring-blue-400 border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
            : ''
        }`}
        aria-selected={isSelected}
        title={blockedLines.length > 0 ? blockedLines.join('\n') : undefined}
        data-blocked={blocked ? 'true' : undefined}
        draggable={!isFromOtherBranch}
		role="button"
		tabIndex={0}
		aria-label={accessibleLabel}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={(event) => {
          // Ctrl/Cmd and Shift belong to the board selection, so they must not open the editor.
          if (onSelect && !isFromOtherBranch && (event.ctrlKey || event.metaKey || event.shiftKey)) {
            event.preventDefault();
            event.stopPropagation();
            onSelect({ shiftKey: event.shiftKey });
            return;
          }
          onEdit(task);
        }}
		onKeyDown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				if (onSelect && !isFromOtherBranch && (event.ctrlKey || event.metaKey || event.shiftKey)) {
					onSelect({ shiftKey: event.shiftKey });
					return;
				}
				onEdit(task);
			}
		}}
      >
        {/* Cross-branch indicator banner */}
        {isFromOtherBranch && (
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1 -mx-1 -mt-1 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700 rounded-t text-xs text-amber-700 dark:text-amber-300">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="truncate">
              From <span className="font-semibold">{task.branch}</span> branch
            </span>
          </div>
        )}

        {/* Header row with task metadata */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500 font-mono transition-colors duration-200">{task.id}</span>
            <TaskTypeBadge type={task.type} availableTypes={availableTypes} className="min-w-0" />
            <ProjectBadge project={task.project} availableProjects={availableProjects} className="min-w-0" />
          </div>
          {(acceptanceCriteriaProgress || priorityBadge || blocked) && (
            <div className="flex shrink-0 items-center gap-2">
              {blocked && <BlockedPill />}
              <AcceptanceCriteriaProgress task={task} density="card" />
              {priorityBadge && (
                <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${priorityBadge.bg} ${priorityBadge.text} transition-colors duration-200`}>
                  {priorityBadge.label}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Title */}
        <h4 className={`font-semibold text-sm line-clamp-2 transition-colors duration-200 ${
          isFromOtherBranch
            ? 'text-gray-600 dark:text-gray-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}>
          {task.title}
        </h4>

        {/* The reason for keyboard users, whom the tooltip never reaches */}
        {blockedLines.length > 0 && (
          <div
            className="mt-1.5 hidden space-y-0.5 text-[11px] leading-snug text-red-700 group-focus-visible/card:block dark:text-red-300"
            aria-hidden="true"
            data-blocked-reason
          >
            {blockedLines.map((line) => (
              <p key={line} className="line-clamp-3">{line}</p>
            ))}
          </div>
        )}

        {/* Topic labels - limit to 3; from: labels are shown as who asked */}
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {labels.slice(0, 3).map(label => (
              <span
                key={label}
                className="inline-block px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors duration-200"
              >
                {label}
              </span>
            ))}
            {labels.length > 3 && (
              <span className="inline-block px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                +{labels.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Footer: who asked and when, then the conversation and who has it */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-100 dark:border-gray-600/50 transition-colors duration-200">
          <span className="flex min-w-0 items-center gap-1.5">
            {requesters[0] && (
              <span className="flex min-w-0 items-center gap-1" title={`Asked by ${requesters.join(', ')}`} data-asked-by={requesters[0]}>
                <PersonAvatar name={requesters[0]} webUserName={webUserName} size="xs" />
                <span className="truncate font-medium text-gray-600 dark:text-gray-300">{displayPerson(requesters[0], webUserName)}</span>
              </span>
            )}
            <span className="shrink-0 text-gray-400 dark:text-gray-500">{formatRelativeDate(task.createdDate)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {task.dueDate && <span>Due: <StoredDate value={task.dueDate} dateFormat={dateFormat} /></span>}
            {userReplied && (
              <span
                className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-200"
                title="Your comment is the latest"
              >
                You replied
              </span>
            )}
            {commentCount > 0 && (
              <span className="inline-flex items-center gap-0.5" title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="sr-only">Comments: </span>
                {commentCount}
              </span>
            )}
            {task.assignee.length > 0 && !assigneeIsRequester && (
              <span className="flex min-w-0 items-center gap-1" title={task.assignee.join(', ')}>
                <PersonAvatar name={task.assignee[0]} webUserName={webUserName} size="xs" />
                <span className="truncate max-w-[80px]">{displayPerson(task.assignee[0] ?? '', webUserName)}</span>
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

export default TaskCard;
