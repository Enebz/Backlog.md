import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLocalEditableTask, type AcceptanceCriterion, type Milestone, type Task, type TaskComment } from "../../types";
import { type TaskDetail, taskDependencyGraph, taskReadiness } from "../../core/task-detail";
import Modal from "./Modal";
import { apiClient, NetworkError, readDemotionFailureCause, readMovedFailureState } from "../lib/api";
import { useTheme } from "../contexts/ThemeContext";
import MDEditor from "@uiw/react-md-editor";
import AcceptanceCriteriaEditor from "./AcceptanceCriteriaEditor";
import MermaidMarkdown from './MermaidMarkdown';
import ChipInput from "./ChipInput";
import DependencyInput from "./DependencyInput";
import { DependencyGraphSection } from "./DependencyGraphSection";
import StoredDate from "./StoredDate";
import { getPriorityOptions } from "../../utils/priority-config";
import { getProjectValues, resolveProjectValue } from "../../utils/project-config";
import { getTaskTypeValues, resolveTaskTypeValue } from "../../utils/task-type-config";
import { formatReadinessBlockers } from "../../utils/readiness";
import { buildTaskIdIndex, resolveTaskReference } from "../utils/task-id-links";
import { findDirectSubtasks, findParentTask, summarizeSubtaskProgress } from "../../utils/task-subtasks.ts";
import { isTerminalStatus } from "../../utils/terminal-status.ts";
import { createUrlPath } from "../utils/urlHelpers";
import { useWebUserName } from "../contexts/WebUserContext";
import CommentThread from "./CommentThread";
import PersonAvatar from "./PersonAvatar";
import ReplyBox, { type ReplyAction } from "./ReplyBox";
import {
  askedBy,
  decisionKindFor,
  displayPerson,
  getWorkflow,
  hasUserReplied,
  nextInQueue,
  parseDecisionOptions,
  statusQueue,
  type Workflow,
} from "../utils/workflow";

interface Props {
  task?: Task | TaskDetail; // Optional for create mode
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => Promise<void> | void; // refresh callback
  onSubmit?: (taskData: Partial<Task>) => Promise<void>; // For creating new tasks
  onArchive?: () => Promise<void> | void; // For archiving tasks
  onDependencyCleanup?: (taskId: string, cleanedTaskIds: string[]) => void; // Reports records that lost a reference
  availableStatuses?: string[]; // Available statuses for new tasks
  availableTasks?: Task[]; // Shared task corpus for dependency selection
  onNavigateToTask?: (task: Task) => void; // Opens another task, preserving close/back context
  isDraftMode?: boolean; // Whether creating a draft
  availableMilestones?: string[];
  availablePriorities?: string[];
  availableTypes?: string[];
  availableProjects?: string[];
  milestoneEntities?: Milestone[];
  archivedMilestoneEntities?: Milestone[];
  definitionOfDoneDefaults?: string[];
  defaultAssignee?: string[];
  dateFormat?: string;
}

type Mode = "preview" | "edit" | "create";

type TaskUpdatePayload = Omit<Partial<Task>, "dueDate" | "project"> & {
	dueDate?: string | null;
  project?: string | null;
  definitionOfDoneAdd?: string[];
  definitionOfDoneRemove?: number[];
  definitionOfDoneCheck?: number[];
  definitionOfDoneUncheck?: number[];
  disableDefinitionOfDoneDefaults?: boolean;
  commentsAppend?: string[];
};

type InlineMetaUpdatePayload = Omit<Partial<Task>, "milestone"> & {
  milestone?: string | null;
};

type TaskDetailsFormState = {
  title: string;
  description: string;
  plan: string;
  notes: string;
  displayComments: TaskComment[];
  finalSummary: string;
  criteria: AcceptanceCriterion[];
  definitionOfDone: AcceptanceCriterion[];
  status: string;
  assignee: string[];
  labels: string[];
  priority: string;
  taskType: string;
  project: string;
  dependencies: string[];
  references: string[];
  modifiedFiles: string[];
  milestone: string;
  dueDate: string;
};

// Shared empty defaults. A `= []` default parameter allocates a fresh array on every render, so
// every memo and effect keyed on it re-runs each time; combined with a state update in that chain
// the modal spins until React aborts with "Maximum update depth exceeded".
const EMPTY_STATUSES: string[] = [];
const EMPTY_TASKS: Task[] = [];

const containsCommentDelimiterLine = (value: string): boolean => /^\s*---\s*$/m.test(value.replace(/\r\n/g, "\n"));

const areJsonEqual = (first: unknown, second: unknown): boolean => JSON.stringify(first) === JSON.stringify(second);

const isEditableKeyboardTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;

const preserveDirtyRefreshValue = <T,>(
  current: T,
  previous: T,
  next: T,
  isEqual: (first: T, second: T) => boolean = Object.is,
): T => (isEqual(current, previous) ? next : current);

const buildTaskDetailsFormState = ({
  task,
  isCreateMode,
  isDraftMode,
  availableStatuses,
  defaultDefinitionOfDone,
  createModeAssignee,
}: {
  task?: Task | TaskDetail;
  isCreateMode: boolean;
  isDraftMode?: boolean;
  availableStatuses?: string[];
  defaultDefinitionOfDone: AcceptanceCriterion[];
  createModeAssignee: string[];
}): TaskDetailsFormState => ({
  title: task?.title || "",
  description: task?.description || "",
  plan: task?.implementationPlan || "",
  notes: task?.implementationNotes || "",
  displayComments: task?.comments ?? [],
  finalSummary: task?.finalSummary || "",
  criteria: task?.acceptanceCriteriaItems || [],
  definitionOfDone: task?.definitionOfDoneItems || (isCreateMode ? defaultDefinitionOfDone : []),
  status: isDraftMode ? "Draft" : (task?.status || (availableStatuses?.[0] || "To Do")),
  assignee: task?.assignee || createModeAssignee,
  labels: task?.labels || [],
  priority: task?.priority || "",
  taskType: task?.type || "",
  project: task?.project || "",
  dependencies: task?.dependencies || [],
  references: task?.references || [],
  modifiedFiles: task?.modifiedFiles || [],
  milestone: task?.milestone || "",
  dueDate: task?.dueDate || "",
});

/** A status as a coloured pill: questions amber, approvals green, work in progress blue, done muted. */
const statusTone = (status: string, workflow: Workflow, statuses: string[]): string => {
  const normalized = status.trim().toLowerCase();
  if (workflow.waitingStatus && normalized === workflow.waitingStatus.toLowerCase()) {
    return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200";
  }
  if (workflow.approvedStatus && normalized === workflow.approvedStatus.toLowerCase()) {
    return "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200";
  }
  if (isTerminalStatus(status, statuses)) {
    return "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200";
  }
  if (normalized.includes("progress") || normalized.includes("doing")) {
    return "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-200";
  }
  return "border-gray-300 bg-white text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
};

/** One labelled property in the task's side panel. */
const Field: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode; right?: React.ReactNode }> = ({
  label,
  htmlFor,
  children,
  right,
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between">
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </label>
      {right ? <span className="text-xs text-gray-500 dark:text-gray-400">{right}</span> : null}
    </div>
    {children}
  </div>
);

const SIDEBAR_SELECT_CLASS =
  "w-full h-9 px-2.5 pr-8 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-colors duration-200";

const SectionHeader: React.FC<{ title: string; right?: React.ReactNode }> = ({ title, right }) => (
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight transition-colors duration-200">
      {title}
    </h3>
    {right ? <div className="ml-2 text-xs text-gray-500 dark:text-gray-400">{right}</div> : null}
  </div>
);

const HierarchyStatusBadge: React.FC<{ status: string; statuses: string[] }> = ({ status, statuses }) => {
  const normalized = (status ?? '').toLowerCase();
  const tone = isTerminalStatus(status, statuses)
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : normalized.includes('progress')
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {status}
    </span>
  );
};

const HierarchyChevron: React.FC = () => (
  <svg
    className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 group-hover:translate-x-0.5 dark:text-gray-500"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

export const TaskDetailsModal: React.FC<Props> = ({
  task,
  isOpen,
  onClose,
  onSaved,
  onSubmit,
  onArchive,
  onDependencyCleanup,
  availableStatuses = EMPTY_STATUSES,
  availableTasks = EMPTY_TASKS,
  onNavigateToTask,
  availableMilestones: _availableMilestones,
  availablePriorities,
  availableTypes,
  availableProjects,
  milestoneEntities,
  archivedMilestoneEntities,
  isDraftMode,
  definitionOfDoneDefaults,
  defaultAssignee,
  dateFormat,
}) => {
  const { theme } = useTheme();
  const webUserName = useWebUserName();
  const isCreateMode = !task;
  const isFromOtherBranch = Boolean(task?.branch);
  // Promoting a draft replaces it with a new task ID, which the Drafts page does through its own
  // Promote action, so the popup shows the draft status without turning the field into a second one.
  const isOpenDraft = (task?.status ?? "").trim().toLowerCase() === "draft";
  const demotionIdentity = [isOpen ? "open" : "closed", task?.id, task?.source, task?.branch, isOpenDraft ? "draft" : "task"].join("\0");
  const demotionIdentityRef = useRef(demotionIdentity);
  demotionIdentityRef.current = demotionIdentity;
  const [mode, setMode] = useState<Mode>(isCreateMode ? "create" : "preview");
  const modeRef = useRef(mode);
  const previousTaskId = useRef(task?.id ?? "");
  const previousIsOpen = useRef(isOpen);
  const formBaselineRef = useRef<TaskDetailsFormState | null>(null);
  const activeDemotionRequest = useRef<{ identity: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [demoting, setDemoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Title field for create mode
  const [title, setTitle] = useState(task?.title || "");

  // Editable fields (edit mode)
  const [description, setDescription] = useState(task?.description || "");
  const [plan, setPlan] = useState(task?.implementationPlan || "");
  const [notes, setNotes] = useState(task?.implementationNotes || "");
  const [displayComments, setDisplayComments] = useState<TaskComment[]>(task?.comments ?? []);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  // What the last decision did, shown on the card that follows it so the move stays visible.
  const [lastDecision, setLastDecision] = useState<{ id: string; title: string; outcome: string } | null>(null);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  // The title reads as a wrapping heading; clicking it renames in place.
  const [renamingTitle, setRenamingTitle] = useState(false);
  const cancelRenameRef = useRef(false);
  const [finalSummary, setFinalSummary] = useState(task?.finalSummary || "");
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(task?.acceptanceCriteriaItems || []);
  const defaultDefinitionOfDone = useMemo(
    () => (definitionOfDoneDefaults ?? []).map((text, index) => ({ index: index + 1, text, checked: false })),
    [definitionOfDoneDefaults],
  );
  // Create mode starts with the configured defaultAssignee already in the field, as ordinary
  // removable chips, so emptying it says "unassigned" instead of "no opinion".
  const createModeAssignee = useMemo(
    () => (isCreateMode ? (defaultAssignee ?? []) : []),
    [isCreateMode, defaultAssignee],
  );
  const initialDefinitionOfDone = task?.definitionOfDoneItems ?? (isCreateMode ? defaultDefinitionOfDone : []);
  const [definitionOfDone, setDefinitionOfDone] = useState<AcceptanceCriterion[]>(initialDefinitionOfDone);
  const priorityOptions = useMemo(() => getPriorityOptions(availablePriorities), [availablePriorities]);
  const typeOptions = useMemo(() => getTaskTypeValues(availableTypes), [availableTypes]);
  const projectOptions = useMemo(() => getProjectValues(availableProjects), [availableProjects]);
  const resolveMilestoneToId = useCallback((value?: string | null): string => {
    const normalized = (value ?? "").trim();
    if (!normalized) return "";
    const key = normalized.toLowerCase();
    const aliasKeys = new Set<string>([key]);
    const looksLikeMilestoneId = /^\d+$/.test(normalized) || /^m-\d+$/i.test(normalized);
    const canonicalInputId = looksLikeMilestoneId
      ? `m-${String(Number.parseInt(normalized.replace(/^m-/i, ""), 10))}`
      : null;
    if (/^\d+$/.test(normalized)) {
      const numericAlias = String(Number.parseInt(normalized, 10));
      aliasKeys.add(numericAlias);
      aliasKeys.add(`m-${numericAlias}`);
    } else {
      const idMatch = normalized.match(/^m-(\d+)$/i);
      if (idMatch?.[1]) {
        const numericAlias = String(Number.parseInt(idMatch[1], 10));
        aliasKeys.add(numericAlias);
        aliasKeys.add(`m-${numericAlias}`);
      }
    }
    const idMatchesAlias = (milestoneId: string): boolean => {
      const milestoneKey = milestoneId.trim().toLowerCase();
      if (aliasKeys.has(milestoneKey)) {
        return true;
      }
      const idMatch = milestoneId.trim().match(/^m-(\d+)$/i);
      if (!idMatch?.[1]) {
        return false;
      }
      const numericAlias = String(Number.parseInt(idMatch[1], 10));
      return aliasKeys.has(numericAlias) || aliasKeys.has(`m-${numericAlias}`);
    };
    const findIdMatch = (milestones: Milestone[]): Milestone | undefined => {
      const rawExactMatch = milestones.find((milestone) => milestone.id.trim().toLowerCase() === key);
      if (rawExactMatch) {
        return rawExactMatch;
      }
      if (canonicalInputId) {
        const canonicalRawMatch = milestones.find(
          (milestone) => milestone.id.trim().toLowerCase() === canonicalInputId,
        );
        if (canonicalRawMatch) {
          return canonicalRawMatch;
        }
      }
      return milestones.find((milestone) => idMatchesAlias(milestone.id));
    };
    const activeMilestones = milestoneEntities ?? [];
    const archivedMilestones = archivedMilestoneEntities ?? [];
    const activeIdMatch = findIdMatch(activeMilestones);
    if (activeIdMatch) {
      return activeIdMatch.id;
    }
    if (looksLikeMilestoneId) {
      const archivedIdMatch = findIdMatch(archivedMilestones);
      if (archivedIdMatch) {
        return archivedIdMatch.id;
      }
    }
    const activeTitleMatches = activeMilestones.filter((milestone) => milestone.title.trim().toLowerCase() === key);
    if (activeTitleMatches.length === 1) {
      return activeTitleMatches[0]?.id ?? normalized;
    }
    if (activeTitleMatches.length > 1) {
      return normalized;
    }
    const archivedIdMatch = findIdMatch(archivedMilestones);
    if (archivedIdMatch) {
      return archivedIdMatch.id;
    }
    const archivedTitleMatches = archivedMilestones.filter((milestone) => milestone.title.trim().toLowerCase() === key);
    if (archivedTitleMatches.length === 1) {
      return archivedTitleMatches[0]?.id ?? normalized;
    }
    return normalized;
  }, [milestoneEntities, archivedMilestoneEntities]);
  const resolveMilestoneLabel = useCallback((value?: string | null): string => {
    const normalized = (value ?? "").trim();
    if (!normalized) return "";
    const key = normalized.toLowerCase();
    const aliasKeys = new Set<string>([key]);
    const canonicalInputId =
      /^\d+$/.test(normalized) || /^m-\d+$/i.test(normalized)
        ? `m-${String(Number.parseInt(normalized.replace(/^m-/i, ""), 10))}`
        : null;
    if (/^\d+$/.test(normalized)) {
      const numericAlias = String(Number.parseInt(normalized, 10));
      aliasKeys.add(numericAlias);
      aliasKeys.add(`m-${numericAlias}`);
    } else {
      const idMatch = normalized.match(/^m-(\d+)$/i);
      if (idMatch?.[1]) {
        const numericAlias = String(Number.parseInt(idMatch[1], 10));
        aliasKeys.add(numericAlias);
        aliasKeys.add(`m-${numericAlias}`);
      }
    }
    const idMatchesAlias = (milestoneId: string): boolean => {
      const milestoneKey = milestoneId.trim().toLowerCase();
      if (aliasKeys.has(milestoneKey)) {
        return true;
      }
      const idMatch = milestoneId.trim().match(/^m-(\d+)$/i);
      if (!idMatch?.[1]) {
        return false;
      }
      const numericAlias = String(Number.parseInt(idMatch[1], 10));
      return aliasKeys.has(numericAlias) || aliasKeys.has(`m-${numericAlias}`);
    };
    const findIdMatch = (milestones: Milestone[]): Milestone | undefined => {
      const rawExactMatch = milestones.find((milestone) => milestone.id.trim().toLowerCase() === key);
      if (rawExactMatch) {
        return rawExactMatch;
      }
      if (canonicalInputId) {
        const canonicalRawMatch = milestones.find(
          (milestone) => milestone.id.trim().toLowerCase() === canonicalInputId,
        );
        if (canonicalRawMatch) {
          return canonicalRawMatch;
        }
      }
      return milestones.find((milestone) => idMatchesAlias(milestone.id));
    };
    const allMilestones = [...(milestoneEntities ?? []), ...(archivedMilestoneEntities ?? [])];
    const idMatch = findIdMatch(allMilestones);
    if (idMatch) {
      return idMatch.title;
    }
    const titleMatches = allMilestones.filter((milestone) => milestone.title.trim().toLowerCase() === key);
    return titleMatches.length === 1 ? (titleMatches[0]?.title ?? normalized) : normalized;
  }, [milestoneEntities, archivedMilestoneEntities]);

  // Sidebar metadata (inline edit)
  const [status, setStatus] = useState(isDraftMode ? "Draft" : (task?.status || (availableStatuses?.[0] || "To Do")));
  const [assignee, setAssignee] = useState<string[]>(task?.assignee || createModeAssignee);
  const [labels, setLabels] = useState<string[]>(task?.labels || []);
  const [priority, setPriority] = useState<string>(task?.priority || "");
  const [taskType, setTaskType] = useState<string>(task?.type || "");
  const [project, setProject] = useState<string>(task?.project || "");
  const [typeUpdateError, setTypeUpdateError] = useState<string | null>(null);
  const [isTypeUpdating, setIsTypeUpdating] = useState(false);
  const typeUpdateInFlightRef = useRef(false);
  const typeUpdateRequestRef = useRef(0);
  const [dependencies, setDependencies] = useState<string[]>(task?.dependencies || []);
  const [references, setReferences] = useState<string[]>(task?.references || []);
  const [modifiedFiles, setModifiedFiles] = useState<string[]>(task?.modifiedFiles || []);
  const [milestone, setMilestone] = useState<string>(task?.milestone || "");
  const [dueDate, setDueDate] = useState<string>(task?.dueDate || "");
  const canonicalTypeSelection = resolveTaskTypeValue(taskType, typeOptions);
  const typeSelectionValue = canonicalTypeSelection ?? taskType;
  const canonicalProjectSelection = resolveProjectValue(project, projectOptions);
  const projectSelectionValue = canonicalProjectSelection ?? project;
  const milestoneSelectionValue = resolveMilestoneToId(milestone);
  const hasMilestoneSelection = (milestoneEntities ?? []).some((milestoneEntity) => milestoneEntity.id === milestoneSelectionValue);

  // Both derived at read time and delivered with the task itself, so there is nothing to resolve
  // or fetch here: the verdict the modal shows is the one every other surface shows.
  const dependencyGraph = taskDependencyGraph(task);
  const readiness = taskReadiness(task);
  // The verdict answers for the status and the dependencies it was read with, and it belongs to the
  // Dependencies card, so it is shown only while all of that still describes what is on screen. An
  // optimistic edit that has not come back yet - including one whose save failed and left the shown
  // status ahead of the record - shows no badge rather than a claim about what it replaced.
  const shownReadiness =
    readiness &&
    (readiness.isReady || readiness.isBlocked) &&
    dependencies.length > 0 &&
    dependencies.join(",") === (task?.dependencies ?? []).join(",") &&
    status === (task?.status ?? "")
      ? readiness
      : null;

  // Dependency validation stays local-only (see BACK-623), so the picker must only suggest what a
  // save can accept: a cross-branch task is rejected, and so is a canonically ambiguous ID that more
  // than one local file claims. The index drops those collisions already, so a task survives only
  // when it is the one its own canonical ID resolves to.
  const localAvailableTasks = useMemo(() => {
    const local = availableTasks.filter(isLocalEditableTask);
    const index = buildTaskIdIndex(local);
    return local.filter((candidate) => resolveTaskReference(index, candidate.id) === candidate);
  }, [availableTasks]);

  // Hierarchy is derived from the shared corpus rather than the task payload: the single-task
  // API does not carry parent/subtask fields, while the list the modal already receives does.
  const parentTask = useMemo(
    () => (task ? findParentTask(task, availableTasks) : null),
    [task, availableTasks],
  );

  const subtasks = useMemo(
    () => (task ? findDirectSubtasks(task, availableTasks) : []),
    [task, availableTasks],
  );

  const subtaskProgress = useMemo(
    () => (task ? summarizeSubtaskProgress(task, availableTasks, availableStatuses) : null),
    [task, availableTasks, availableStatuses],
  );

  // Keep a baseline for dirty-check
  const baseline = useMemo(() => ({
    title: task?.title || "",
    description: task?.description || "",
    plan: task?.implementationPlan || "",
    notes: task?.implementationNotes || "",
    finalSummary: task?.finalSummary || "",
    dueDate: task?.dueDate || "",
    criteria: JSON.stringify(task?.acceptanceCriteriaItems || []),
    definitionOfDone: JSON.stringify(task?.definitionOfDoneItems || (isCreateMode ? defaultDefinitionOfDone : [])),
  }), [task, defaultDefinitionOfDone, isCreateMode]);

  const isDirty = useMemo(() => {
    return (
      title !== baseline.title ||
      description !== baseline.description ||
      plan !== baseline.plan ||
      notes !== baseline.notes ||
      finalSummary !== baseline.finalSummary ||
      dueDate !== baseline.dueDate ||
      JSON.stringify(criteria) !== baseline.criteria ||
      JSON.stringify(definitionOfDone) !== baseline.definitionOfDone
    );
  }, [title, description, plan, notes, finalSummary, dueDate, criteria, definitionOfDone, baseline]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(
    () => () => {
      activeDemotionRequest.current = null;
    },
    [],
  );

  useEffect(() => {
    activeDemotionRequest.current = null;
    setDemoting(false);
  }, [demotionIdentity]);

  // Intercept Escape to cancel edit (not close modal) when in edit mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === "edit" && (e.key === "Escape")) {
        e.preventDefault();
        e.stopPropagation();
        handleCancelEdit();
      }
      if (mode === "edit" && ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s")) {
        e.preventDefault();
        e.stopPropagation();
        void handleSave();
      }
      if (mode !== "preview" || isEditableKeyboardTarget(e.target)) {
        return;
      }
      if (e.key.toLowerCase() === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        setMode("edit");
      }
      if (isDoneStatus && (e.key.toLowerCase() === "c") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        void handleComplete();
      }
      if (!isOpen || !task || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (renamingTitle && e.key === "Escape") {
        // Escape leaves the rename, not the dialog.
        e.preventDefault();
        e.stopPropagation();
        cancelRenameRef.current = true;
        setTitle(task.title);
        setRenamingTitle(false);
        return;
      }
      // j/k walk the card's column, r jumps to the reply box.
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        openQueueNeighbour(e.key === "j" ? 1 : -1);
      }
      if (e.key === "r" && replyRef.current) {
        e.preventDefault();
        e.stopPropagation();
        replyRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [mode, title, description, plan, notes, finalSummary, criteria, definitionOfDone, status, isOpen, task, availableTasks, commentBody, renamingTitle]);

  // Reset local state when task changes or modal opens
  useEffect(() => {
    const nextTaskId = task?.id ?? "";
    const modalIdentityChanged = previousTaskId.current !== nextTaskId || previousIsOpen.current !== isOpen;
    if (modalIdentityChanged) {
      typeUpdateRequestRef.current += 1;
      typeUpdateInFlightRef.current = false;
      setIsTypeUpdating(false);
      setTypeUpdateError(null);
    }
    const nextFormState = buildTaskDetailsFormState({
      task,
      isCreateMode,
      isDraftMode,
      availableStatuses,
      defaultDefinitionOfDone,
      createModeAssignee,
    });
    const previousFormState = formBaselineRef.current;
    const sameOpenModalRefresh =
      Boolean(previousFormState) && isOpen && previousIsOpen.current && previousTaskId.current === nextTaskId;
    const shouldPreserveEditMode =
      !isCreateMode &&
      sameOpenModalRefresh &&
      modeRef.current === "edit";

    if (sameOpenModalRefresh && previousFormState) {
      setTitle((current) => preserveDirtyRefreshValue(current, previousFormState.title, nextFormState.title));
      setDescription((current) =>
        preserveDirtyRefreshValue(current, previousFormState.description, nextFormState.description),
      );
      setPlan((current) => preserveDirtyRefreshValue(current, previousFormState.plan, nextFormState.plan));
      setNotes((current) => preserveDirtyRefreshValue(current, previousFormState.notes, nextFormState.notes));
      setDisplayComments(nextFormState.displayComments);
      setCommentSaving(false);
      setFinalSummary((current) =>
        preserveDirtyRefreshValue(current, previousFormState.finalSummary, nextFormState.finalSummary),
      );
      setCriteria((current) =>
        preserveDirtyRefreshValue(current, previousFormState.criteria, nextFormState.criteria, areJsonEqual),
      );
      setDefinitionOfDone((current) =>
        preserveDirtyRefreshValue(
          current,
          previousFormState.definitionOfDone,
          nextFormState.definitionOfDone,
          areJsonEqual,
        ),
      );
      setStatus((current) => preserveDirtyRefreshValue(current, previousFormState.status, nextFormState.status));
      setAssignee((current) =>
        preserveDirtyRefreshValue(current, previousFormState.assignee, nextFormState.assignee, areJsonEqual),
      );
      setLabels((current) =>
        preserveDirtyRefreshValue(current, previousFormState.labels, nextFormState.labels, areJsonEqual),
      );
      setPriority((current) => preserveDirtyRefreshValue(current, previousFormState.priority, nextFormState.priority));
      setTaskType((current) => preserveDirtyRefreshValue(current, previousFormState.taskType, nextFormState.taskType));
      setProject((current) => preserveDirtyRefreshValue(current, previousFormState.project, nextFormState.project));
      setDependencies((current) =>
        preserveDirtyRefreshValue(current, previousFormState.dependencies, nextFormState.dependencies, areJsonEqual),
      );
      setReferences((current) =>
        preserveDirtyRefreshValue(current, previousFormState.references, nextFormState.references, areJsonEqual),
      );
      setModifiedFiles((current) =>
        preserveDirtyRefreshValue(
          current,
          previousFormState.modifiedFiles,
          nextFormState.modifiedFiles,
          areJsonEqual,
        ),
      );
      setMilestone((current) =>
        preserveDirtyRefreshValue(current, previousFormState.milestone, nextFormState.milestone),
      );
      setDueDate((current) => preserveDirtyRefreshValue(current, previousFormState.dueDate, nextFormState.dueDate));
      setMode(shouldPreserveEditMode ? "edit" : isCreateMode ? "create" : modeRef.current);
      previousTaskId.current = nextTaskId;
      previousIsOpen.current = isOpen;
      formBaselineRef.current = nextFormState;
      setError(null);
      return;
    }

    setTitle(nextFormState.title);
    setDescription(nextFormState.description);
    setPlan(nextFormState.plan);
    setNotes(nextFormState.notes);
    setDisplayComments(nextFormState.displayComments);
    setCommentBody("");
    setCommentSaving(false);
    setFinalSummary(nextFormState.finalSummary);
    setCriteria(nextFormState.criteria);
    setDefinitionOfDone(nextFormState.definitionOfDone);
    setStatus(nextFormState.status);
    setAssignee(nextFormState.assignee);
    setLabels(nextFormState.labels);
    setPriority(nextFormState.priority);
    setTaskType(nextFormState.taskType);
    setProject(nextFormState.project);
    setDependencies(nextFormState.dependencies);
    setReferences(nextFormState.references);
    setModifiedFiles(nextFormState.modifiedFiles);
    setMilestone(nextFormState.milestone);
    setDueDate(nextFormState.dueDate);
    setMode(isCreateMode ? "create" : "preview");
    setRenamingTitle(false);
    previousTaskId.current = nextTaskId;
    previousIsOpen.current = isOpen;
    formBaselineRef.current = nextFormState;
    setError(null);
  }, [task, isOpen, isCreateMode, isDraftMode, availableStatuses, defaultDefinitionOfDone, createModeAssignee]);

  // The reply box is always there, so an unsent comment is unsaved work in every mode.
  const hasCommentDraft = commentBody.trim() !== "";
  // Nothing is persisted while creating, so any entered field is unsaved work.
  const hasCreateModeEntries =
    isCreateMode &&
    (title.trim() !== "" ||
      taskType.trim() !== "" ||
      priority.trim() !== "" ||
      project.trim() !== "" ||
      milestone.trim() !== "" ||
      dueDate.trim() !== "" ||
      // The prefilled default is not the user's work, but removing or replacing it is.
      !areJsonEqual(assignee, createModeAssignee) ||
      labels.length > 0 ||
      dependencies.length > 0 ||
      references.length > 0 ||
      modifiedFiles.length > 0);
  const hasUnsavedEdits =
    ((mode === "edit" || mode === "create") && (isDirty || hasCreateModeEntries)) || hasCommentDraft;

  // Links inside the modal (dependency chips, auto-linked task IDs in markdown) leave this
  // task behind, so they ask the same question closing does before the navigation happens.
  const confirmNavigationAwayFromEdits = (event: React.MouseEvent<HTMLElement>) => {
    if (!hasUnsavedEdits || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    if (link.target && link.target !== "_self") return;
    const destination = new URL(link.href, window.location.href);
    if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
    // Same-page anchors (markdown heading links) do not unload the form.
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
    if (window.confirm("Discard unsaved changes and leave this task?")) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleCancelEdit = () => {
    if (demoting) return;
    if (isDirty) {
      const confirmDiscard = window.confirm("Discard unsaved changes?");
      if (!confirmDiscard) return;
    }
    if (isCreateMode) {
      // In create mode, close the modal on cancel
      onClose();
    } else {
      setTitle(task?.title || "");
      setDescription(task?.description || "");
      setPlan(task?.implementationPlan || "");
      setNotes(task?.implementationNotes || "");
      setFinalSummary(task?.finalSummary || "");
      setDueDate(task?.dueDate || "");
      setCriteria(task?.acceptanceCriteriaItems || []);
      setDefinitionOfDone(task?.definitionOfDoneItems || []);
      setMode("preview");
    }
  };

  const normalizeChecklistItems = (items: AcceptanceCriterion[]): AcceptanceCriterion[] => {
    return items
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0);
  };

  const buildDefinitionOfDoneCreatePayload = (): TaskUpdatePayload => {
    const cleanedCurrent = normalizeChecklistItems(definitionOfDone);
    const defaults = (definitionOfDoneDefaults ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
    const defaultItems = defaults.map((text, index) => ({ index: index + 1, text, checked: false }));
    const defaultsMatch =
      cleanedCurrent.length >= defaultItems.length &&
      defaultItems.every(
        (item, index) =>
          cleanedCurrent[index]?.text === item.text && cleanedCurrent[index]?.checked === false,
      );

    const disableDefaults = !defaultsMatch;
    const definitionOfDoneAdd = disableDefaults
      ? cleanedCurrent.map((item) => item.text)
      : cleanedCurrent.slice(defaultItems.length).map((item) => item.text);

    const payload: TaskUpdatePayload = {};
    if (definitionOfDoneAdd.length > 0) {
      payload.definitionOfDoneAdd = definitionOfDoneAdd;
    }
    if (disableDefaults) {
      payload.disableDefinitionOfDoneDefaults = true;
    }
    return payload;
  };

  const buildDefinitionOfDoneEditPayload = (): TaskUpdatePayload => {
    const original = task?.definitionOfDoneItems ?? [];
    const cleanedCurrent = normalizeChecklistItems(definitionOfDone);
    const originalByIndex = new Map(original.map((item) => [item.index, item]));
    const currentByIndex = new Map(cleanedCurrent.map((item) => [item.index, item]));
    const removals = new Set<number>();
    const additions: string[] = [];
    const checks: number[] = [];
    const unchecks: number[] = [];

    let nextIndex = original.reduce((max, item) => Math.max(max, item.index), 0);

    for (const item of cleanedCurrent) {
      const originalItem = originalByIndex.get(item.index);
      if (!originalItem) {
        additions.push(item.text);
        nextIndex += 1;
        if (item.checked) {
          checks.push(nextIndex);
        }
        continue;
      }
      if (originalItem.text !== item.text) {
        removals.add(item.index);
        additions.push(item.text);
        nextIndex += 1;
        if (item.checked) {
          checks.push(nextIndex);
        }
        continue;
      }
      if (originalItem.checked !== item.checked) {
        if (item.checked) {
          checks.push(item.index);
        } else {
          unchecks.push(item.index);
        }
      }
    }

    for (const originalItem of original) {
      if (!currentByIndex.has(originalItem.index)) {
        removals.add(originalItem.index);
      }
    }

    const payload: TaskUpdatePayload = {};
    if (additions.length > 0) {
      payload.definitionOfDoneAdd = additions;
    }
    if (removals.size > 0) {
      payload.definitionOfDoneRemove = Array.from(removals);
    }
    if (checks.length > 0) {
      payload.definitionOfDoneCheck = checks;
    }
    if (unchecks.length > 0) {
      payload.definitionOfDoneUncheck = unchecks;
    }
    return payload;
  };

  const handleSave = async () => {
    if (demoting) return;
    setSaving(true);
    setError(null);

    // Validation for create mode
    if (isCreateMode && !title.trim()) {
      setError("Title is required");
      setSaving(false);
      return;
    }

    try {
      const taskData: TaskUpdatePayload = {
        title: title.trim(),
        description,
        implementationPlan: plan,
        implementationNotes: notes,
        finalSummary,
        acceptanceCriteriaItems: criteria,
        status,
        // Create starts with the configured defaultAssignee in the field, so what the field
        // holds is what the user meant: empty is an explicit "unassigned". Only a project
        // without a default has nothing to remove, so there a blank field still omits the
        // field. On edit an explicit empty list clears the assignees.
        ...(isCreateMode && assignee.length === 0 && createModeAssignee.length === 0 ? {} : { assignee }),
        labels,
        priority: priority === "" ? undefined : priority,
        dependencies,
        milestone: milestone.trim().length > 0 ? milestone.trim() : undefined,
        dueDate: dueDate.trim().length > 0 ? dueDate.trim() : isCreateMode ? undefined : null,
      };

      // Like type, project is only sent from the create form. On edit the sidebar select
      // persists immediately through handleInlineMetaUpdate, so including it here would
      // re-send a value the form never showed -- clearing a stale project when none are
      // configured, or failing the whole save when the stored value is no longer valid.
      if (isCreateMode) {
        taskData.type = taskType;
        taskData.project = project.trim().length > 0 ? project.trim() : undefined;
      }

      if (isCreateMode && onSubmit) {
        Object.assign(taskData, buildDefinitionOfDoneCreatePayload());
        // Create new task
        await onSubmit({ ...taskData, dueDate: taskData.dueDate ?? undefined } as Partial<Task>);
        // Only close if successful (no error thrown)
        onClose();
      } else if (task) {
        Object.assign(taskData, buildDefinitionOfDoneEditPayload());
        // Update existing task
        await apiClient.updateTask(task.id, taskData);
        setMode("preview");
        if (onSaved) await onSaved();
      }
    } catch (err) {
      // Extract and display the error message from API response
      let errorMessage = 'Failed to save task';

      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null && 'error' in err) {
        errorMessage = String((err as any).error);
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCriterion = async (index: number, checked: boolean) => {
    if (demoting) return;
    if (!task) return; // Can't toggle in create mode
    if (isFromOtherBranch) return; // Can't toggle for cross-branch tasks
    // Optimistic update
    const next = (criteria || []).map((c) => (c.index === index ? { ...c, checked } : c));
    setCriteria(next);
    try {
      await apiClient.updateTask(task.id, { acceptanceCriteriaItems: next });
      if (onSaved) await onSaved();
    } catch (err) {
      // rollback
      setCriteria(criteria);
      console.error("Failed to update criterion", err);
    }
  };

  const handleToggleDefinitionOfDone = async (index: number, checked: boolean) => {
    if (demoting) return;
    if (!task) return; // Can't toggle in create mode
    if (isFromOtherBranch) return; // Can't toggle for cross-branch tasks
    const next = (definitionOfDone || []).map((c) => (c.index === index ? { ...c, checked } : c));
    setDefinitionOfDone(next);
    try {
      const updates: TaskUpdatePayload = checked
        ? { definitionOfDoneCheck: [index] }
        : { definitionOfDoneUncheck: [index] };
      await apiClient.updateTask(task.id, updates);
      if (onSaved) await onSaved();
    } catch (err) {
      setDefinitionOfDone(definitionOfDone);
      console.error("Failed to update Definition of Done item", err);
    }
  };

  const handleInlineMetaUpdate = async (updates: InlineMetaUpdatePayload) => {
    if (demoting) return;
    // Don't allow updates for cross-branch tasks
    if (isFromOtherBranch) return;

    setError(null);

    // Optimistic UI
    if (updates.status !== undefined) setStatus(String(updates.status));
    if (updates.assignee !== undefined) setAssignee(updates.assignee as string[]);
    if (updates.labels !== undefined) setLabels(updates.labels as string[]);
    if (updates.priority !== undefined) setPriority(String(updates.priority));
    if (updates.type !== undefined) setTaskType(String(updates.type));
    if (updates.project !== undefined) setProject(String(updates.project));
    if (updates.dependencies !== undefined) setDependencies(updates.dependencies as string[]);
    if (updates.references !== undefined) setReferences(updates.references as string[]);
    if (updates.modifiedFiles !== undefined) setModifiedFiles(updates.modifiedFiles as string[]);
    if (updates.milestone !== undefined) setMilestone((updates.milestone ?? "") as string);

    // Only update server if editing existing task
    if (task) {
      try {
        await apiClient.updateTask(task.id, updates);
        if (onSaved) await onSaved();
      } catch (err) {
        console.error("Failed to update task metadata", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleTaskTypeChange = async (nextType: string) => {
    if (demoting) return;
    if (isFromOtherBranch) return;
    if (!task) {
      setTaskType(nextType);
      setTypeUpdateError(null);
      return;
    }
    if (typeUpdateInFlightRef.current) return;

    const previousType = taskType;
    const requestId = typeUpdateRequestRef.current + 1;
    typeUpdateRequestRef.current = requestId;
    typeUpdateInFlightRef.current = true;
    setIsTypeUpdating(true);
    setTypeUpdateError(null);
    setTaskType(nextType);

    try {
      const updatedTask = await apiClient.updateTask(task.id, { type: nextType });
      if (typeUpdateRequestRef.current !== requestId) return;
      setTaskType(updatedTask.type ?? "");
      if (onSaved) {
        try {
          await onSaved();
        } catch (refreshError) {
          console.error("Task type was saved, but refreshing task data failed", refreshError);
        }
      }
    } catch (updateError) {
      if (typeUpdateRequestRef.current !== requestId) return;
      setTaskType(previousType);
      setTypeUpdateError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      if (typeUpdateRequestRef.current === requestId) {
        typeUpdateInFlightRef.current = false;
        setIsTypeUpdating(false);
      }
    }
  };

  // Statuses other than Draft decide what a card asks of the person at the board.
  const workflow = useMemo(
    () => getWorkflow(availableStatuses.filter((candidate) => candidate.trim().toLowerCase() !== "draft")),
    [availableStatuses],
  );
  const decisionKind =
    task && !isFromOtherBranch && !isOpenDraft && !isDraftMode ? decisionKindFor(task.status, workflow) : null;
  const decisionOptions = useMemo(
    () => (decisionKind === "question" ? parseDecisionOptions(task?.description) : []),
    [decisionKind, task?.description],
  );
  // The card's column in board order, to step through it and to find the next card needing a decision.
  const columnQueue = useMemo(
    () => (task && !isFromOtherBranch && !isOpenDraft ? statusQueue(availableTasks, task.status) : []),
    [task, availableTasks, isFromOtherBranch, isOpenDraft],
  );
  const queueIndex = task ? columnQueue.findIndex((candidate) => candidate.id === task.id) : -1;
  const undecidedInColumn = columnQueue.filter((candidate) => !hasUserReplied(candidate, webUserName)).length;

  const confirmDiscardReply = (): boolean => !hasCommentDraft || window.confirm("Discard your unsent comment?");

  const openQueueNeighbour = (step: 1 | -1) => {
    if (!onNavigateToTask || queueIndex === -1 || columnQueue.length < 2) return;
    const neighbour = columnQueue[(queueIndex + step + columnQueue.length) % columnQueue.length];
    if (!neighbour || neighbour.id === task?.id) return;
    if (mode === "edit" && isDirty && !window.confirm("Discard unsaved changes and leave this task?")) return;
    if (!confirmDiscardReply()) return;
    onNavigateToTask(neighbour);
  };

  useEffect(() => {
    if (!lastDecision) return;
    const timer = setTimeout(() => setLastDecision(null), 8000);
    return () => clearTimeout(timer);
  }, [lastDecision]);

  /**
   * Writes a comment, a status move, or both, in one update. A decision or an answer settles the
   * card, so the next card in its column that still needs one opens (or the dialog closes when none
   * is left): working through proposals or questions is one card after another.
   */
  const handleReply = async ({ body, status: nextStatus, settles }: ReplyAction) => {
    if (demoting || !task || isFromOtherBranch) return;
    const comment = body.trim();
    if (!comment && !nextStatus) return;
    if (comment && containsCommentDelimiterLine(comment)) {
      setError("A comment cannot contain a line with only '---' on it.");
      return;
    }
    // Read before the move: once it lands, this card is no longer part of its column.
    const next =
      settles && mode === "preview"
        ? nextInQueue(columnQueue, task.id, (candidate) => !hasUserReplied(candidate, webUserName))
        : null;
    setCommentSaving(true);
    setError(null);
    try {
      const updatedTask = await apiClient.updateTask(task.id, {
        ...(comment ? { commentsAppend: [comment] } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
      });
      setCommentBody("");
      setDisplayComments(updatedTask.comments ?? []);
      if (nextStatus) setStatus(updatedTask.status ?? nextStatus);
      if (settles) {
        const outcome =
          nextStatus && nextStatus === workflow.approvedStatus
            ? "approved"
            : nextStatus && nextStatus === workflow.doneStatus
              ? `declined, moved to ${nextStatus}`
              : nextStatus
                ? `moved to ${nextStatus}`
                : "answered";
        setLastDecision({ id: task.id, title: task.title, outcome });
      }
      if (onSaved) {
        try {
          await onSaved();
        } catch (refreshError) {
          console.error("The reply was saved, but refreshing task data failed", refreshError);
        }
      }
      if (settles && mode === "preview") {
        if (next && onNavigateToTask) {
          onNavigateToTask(next);
        } else {
          setLastDecision(null);
          onClose();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommentSaving(false);
    }
  };

  // labels handled via ChipInput; no textarea parsing

	const handleComplete = async () => {
		if (demoting) return;
		if (!task) return;
		if (!window.confirm("Complete this task? It will be moved to the completed folder.")) return;
		try {
			await apiClient.completeTask(task.id);
			if (onSaved) await onSaved();
			onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleDemote = async () => {
		if (!task || !canDemote || activeDemotionRequest.current !== null) return;
		if (!window.confirm(`Demote "${task.title}" to draft? It will be moved to the drafts folder.`)) return;

		const request = { identity: demotionIdentity };
		activeDemotionRequest.current = request;
		const isCurrentRequest = () =>
			activeDemotionRequest.current === request && demotionIdentityRef.current === request.identity;
		const finishWithRefreshWarning = async (message: string) => {
			window.dispatchEvent(new window.Event("drafts-updated"));
			try {
				if (onSaved) await onSaved();
			} catch (refreshError) {
				console.error("Task was demoted, but refreshing the Web UI failed", refreshError);
			}
			if (!isCurrentRequest()) return;
			try {
				window.alert(message);
			} catch {
				setError(message);
			}
			onClose();
		};
		setDemoting(true);
		setError(null);
		try {
			const { cleanedTaskIds } = await apiClient.demoteTask(task.id);
			if (!isCurrentRequest()) return;
			onDependencyCleanup?.(task.id, cleanedTaskIds);
			try {
				window.dispatchEvent(new window.Event("drafts-updated"));
				if (onSaved) await onSaved();
			} catch {
				await finishWithRefreshWarning(
					"The task was moved to drafts, but refreshing the view failed. Close this dialog and verify the draft before retrying.",
				);
				return;
			}
			if (!isCurrentRequest()) return;
			onClose();
		} catch (err) {
			if (!isCurrentRequest()) return;
			const demotionFailureState = readMovedFailureState(err, "demotionState");
			if (demotionFailureState) {
				const demotionFailureCause = readDemotionFailureCause(err);
				const message =
					demotionFailureState === "moved"
						? demotionFailureCause === "cleanup"
							? "The task was moved to drafts, but removing references from dependent tasks failed. Some dependent tasks may still reference it. The view was refreshed; check those tasks before retrying."
							: demotionFailureCause === "commit"
								? "The task was moved to drafts, but recording the Git commit failed. The view was refreshed; verify the draft before retrying."
								: "The task was moved to drafts, but a later step failed. The view was refreshed; verify the draft and dependent tasks before retrying."
						: "The demotion encountered a filesystem failure and may have left both task and draft copies. The view was refreshed; inspect them before retrying.";
				await finishWithRefreshWarning(message);
				return;
			}
			if (err instanceof NetworkError) {
				await finishWithRefreshWarning(
					"The demotion request may have succeeded, but its response was lost. Check the task and drafts views before retrying.",
				);
				return;
			}
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			if (isCurrentRequest()) {
				activeDemotionRequest.current = null;
				setDemoting(false);
			}
		}
	};

  const handleArchive = async () => {
    if (demoting) return;
    if (!task || !onArchive) return;
    if (!window.confirm(`Are you sure you want to archive "${task.title}"? This will move the task to the archive folder.`)) return;
    await onArchive();
  };

  const checkedCount = (criteria || []).filter((c) => c.checked).length;
  const totalCount = (criteria || []).length;
  const definitionCheckedCount = (definitionOfDone || []).filter((c) => c.checked).length;
  const definitionTotalCount = (definitionOfDone || []).length;
	const isDoneStatus = (status || "").toLowerCase().includes("done");
	const canDemote = Boolean(
		task && !isDraftMode && !isOpenDraft && isLocalEditableTask(task) && task.source !== "completed" && !isFromOtherBranch,
	);
  const comments = displayComments;
  const isPreview = mode === "preview";

  const displayId = task?.id ?? "";
  const documentation = task?.documentation ?? [];
  const requesters = askedBy(labels);
  const lastDecisionTask = lastDecision ? availableTasks.find((candidate) => candidate.id === lastDecision.id) : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
		if (demoting) return;
        // Closing drops unsaved edits and an unsent comment, so both ask first.
        if (mode === "edit" && isDirty) {
          if (!window.confirm("Discard unsaved changes and close?")) return;
        } else if (!confirmDiscardReply()) {
          return;
        }
        setLastDecision(null);
        onClose();
      }}
      title={
        isCreateMode ? (
          isDraftMode ? "Create New Draft" : "Create New Task"
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-sm font-medium text-gray-500 dark:text-gray-400">{displayId}</span>
            <span className="sr-only"> — {task.title}</span>
          </span>
        )
      }
      maxWidthClass="max-w-5xl"
      disableEscapeClose={mode === "edit" || mode === "create" || demoting}
      actions={
		<div className="flex flex-wrap items-center justify-end gap-2">
		          {task && !isCreateMode && (
		            <StatusSelect
		              current={status}
		              statuses={availableStatuses}
		              onChange={(val) => handleInlineMetaUpdate({ status: val })}
		              disabled={isFromOtherBranch || isOpenDraft}
		              className={`h-9 rounded-circle border px-3 pr-8 text-sm font-medium ${statusTone(status, workflow, availableStatuses)}`}
		            />
		          )}
		          {task && queueIndex !== -1 && columnQueue.length > 1 && (
		            <div
		              className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800"
		              role="group"
		              aria-label={`${task.status}: card ${queueIndex + 1} of ${columnQueue.length}`}
		            >
		              <button
		                type="button"
		                onClick={() => openQueueNeighbour(-1)}
		                className="flex h-full items-center rounded-l-lg px-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
		                aria-label="Previous card in this column"
		                title="Previous card in this column (k)"
		              >
		                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
		                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
		                </svg>
		              </button>
		              <span className="px-1 text-xs tabular-nums text-gray-600 dark:text-gray-300">
		                {queueIndex + 1}/{columnQueue.length}
		              </span>
		              <button
		                type="button"
		                onClick={() => openQueueNeighbour(1)}
		                className="flex h-full items-center rounded-r-lg px-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
		                aria-label="Next card in this column"
		                title="Next card in this column (j)"
		              >
		                <HierarchyChevron />
		              </button>
		            </div>
		          )}
		          {isDoneStatus && isPreview && !isCreateMode && !isFromOtherBranch && (
		            <button
		              onClick={handleComplete}
		              disabled={demoting}
		              className="inline-flex h-9 items-center px-3 rounded-lg text-sm font-medium text-white bg-emerald-600 dark:bg-emerald-700 hover:bg-emerald-700 dark:hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200"
		              title="Move to completed folder (removes from board)"
		            >
		              <span className="sm:hidden">Complete</span>
		              <span className="hidden sm:inline">Mark as completed</span>
		            </button>
		          )}
		          {isPreview && !isCreateMode && !isFromOtherBranch ? (
		            <button
		              onClick={() => setMode("edit")}
		              disabled={demoting}
		              className="inline-flex h-9 items-center px-3 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200"
		              title="Edit description, checklists, plan and notes (e)"
		            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
          ) : (mode === "edit" || mode === "create") ? (
            <div className="flex items-center gap-2">
	              <button
		                onClick={handleCancelEdit}
		                disabled={demoting}
		                className="inline-flex h-9 items-center px-3 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200"
		                title="Cancel"
		              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
	              <button
		                onClick={() => void handleSave()}
		                disabled={saving || demoting}
		                className="inline-flex h-9 items-center px-3 rounded-lg text-sm font-medium text-white bg-blue-600 dark:bg-blue-700 hover:bg-blue-700 dark:hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200 disabled:opacity-50"
		                title="Save (Ctrl+S)"
		              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {saving ? "Saving…" : (isCreateMode ? "Create" : "Save")}
              </button>
            </div>
          ) : null}
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</div>
      )}

      {lastDecision && lastDecision.id !== task?.id && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          <span className="min-w-0">
            <span className="font-mono">{lastDecision.id}</span> {lastDecision.outcome}.
            {task && queueIndex !== -1 ? ` ${undecidedInColumn} left in ${task.status}.` : ""}
          </span>
          {lastDecisionTask && onNavigateToTask && (
            <button
              type="button"
              className="shrink-0 font-medium underline decoration-emerald-400 underline-offset-2 hover:no-underline focus:outline-none focus:ring-2 focus:ring-emerald-500"
              onClick={() => {
                if (!confirmDiscardReply()) return;
                setLastDecision(null);
                onNavigateToTask(lastDecisionTask);
              }}
            >
              Open {lastDecision.id}
            </button>
          )}
        </div>
      )}

		<fieldset disabled={demoting} className="contents" aria-busy={demoting}>
      {/* Cross-branch task indicator */}
      {isFromOtherBranch && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-amber-800 dark:text-amber-200">
          <svg className="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <div className="flex-1">
            <span className="font-medium">Read-only:</span> This task exists in the <span className="font-semibold">{task?.branch}</span> branch. Switch to that branch to edit it.
          </div>
        </div>
      )}

      {parentTask && task && (
        <nav
          aria-label="Task hierarchy"
          className="mb-4"
          data-task-hierarchy
          onClickCapture={confirmNavigationAwayFromEdits}
        >
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <li className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Parent
            </li>
            <li className="min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => onNavigateToTask?.(parentTask)}
                disabled={!onNavigateToTask}
                data-parent-task-id={parentTask.id}
                data-parent-task-href={createUrlPath('/tasks', parentTask.id, parentTask.title)}
                className="group inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 text-left text-gray-700 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-950 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-default disabled:hover:bg-transparent dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:text-white"
                aria-label={`Open parent task ${parentTask.id}: ${parentTask.title} (${parentTask.status})`}
              >
                <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
                  {parentTask.id}
                </span>
                <span className="min-w-0 break-words font-medium">{parentTask.title}</span>
                <HierarchyStatusBadge status={parentTask.status} statuses={availableStatuses} />
              </button>
            </li>
            <li aria-hidden="true">
              <HierarchyChevron />
            </li>
            <li aria-current="page" className="font-mono text-xs text-gray-500 dark:text-gray-400">
              {task.id}
            </li>
          </ol>
        </nav>
      )}

      <div
        className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_17rem]"
        onClickCapture={confirmNavigationAwayFromEdits}
      >
        {/* Main content */}
        <div className="min-w-0 space-y-6">
          {isCreateMode ? (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title="Title" />
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter task title"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-colors duration-200"
              />
            </div>
          ) : task ? (
            <div>
              {isPreview && !renamingTitle ? (
                <button
                  type="button"
                  onClick={() => setRenamingTitle(true)}
                  disabled={isFromOtherBranch}
                  aria-label={`Rename: ${title}`}
                  title={isFromOtherBranch ? undefined : "Click to rename"}
                  className="group -mx-2 block w-[calc(100%+1rem)] rounded-md border border-transparent px-2 py-1 text-left text-xl font-semibold leading-snug break-words text-gray-900 transition-colors duration-150 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-default disabled:hover:border-transparent dark:text-gray-100 dark:hover:border-gray-600"
                  data-task-title
                >
                  {title}
                  {!isFromOtherBranch && (
                    <svg className="ml-2 inline h-4 w-4 align-baseline text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  )}
                </button>
              ) : (
                <>
                  <label htmlFor="task-title-input" className="sr-only">
                    Title
                  </label>
                  <input
                    id="task-title-input"
                    type="text"
                    value={title}
                    // biome-ignore lint/a11y/noAutofocus: the person just asked to rename.
                    autoFocus={renamingTitle}
                    onChange={(e) => {
                      setTitle(e.target.value);
                    }}
                    onBlur={() => {
                      const cancelled = cancelRenameRef.current;
                      cancelRenameRef.current = false;
                      setRenamingTitle(false);
                      if (!cancelled && title.trim() && title !== task.title) {
                        void handleInlineMetaUpdate({ title: title.trim() });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    disabled={isFromOtherBranch}
                    className="-mx-2 w-[calc(100%+1rem)] rounded-md border border-blue-500 bg-white px-2 py-1 text-xl font-semibold leading-snug text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:bg-gray-900 dark:text-gray-100"
                  />
                </>
              )}
              {(requesters.length > 0 || assignee.length > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600 dark:text-gray-300">
                  {requesters.length > 0 && (
                    <span className="inline-flex flex-wrap items-center gap-1.5" data-asked-by={requesters.join(",")}>
                      <span className="text-gray-500 dark:text-gray-400">Asked by</span>
                      {requesters.map((name) => (
                        <span key={name} className="inline-flex items-center gap-1 font-medium text-gray-800 dark:text-gray-100">
                          <PersonAvatar name={name} webUserName={webUserName} size="xs" />
                          {displayPerson(name, webUserName)}
                        </span>
                      ))}
                    </span>
                  )}
                  {assignee.length > 0 && (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span className="text-gray-500 dark:text-gray-400">Assigned to</span>
                      {assignee.map((name) => (
                        <span key={name} className="inline-flex items-center gap-1 font-medium text-gray-800 dark:text-gray-100">
                          <PersonAvatar name={name} webUserName={webUserName} size="xs" />
                          {displayPerson(name, webUserName)}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Description */}
          <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <SectionHeader title="Description" />
            {isPreview ? (
              description ? (
                <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                  <MermaidMarkdown source={description} />
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">No description</div>
              )
            ) : (
              <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                <MDEditor
                  value={description}
                  onChange={(val) => setDescription(val || "")}
                  preview="edit"
                  height={320}
                  data-color-mode={theme}
                />
              </div>
            )}
          </section>

          {subtasks.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <SectionHeader
                title="Subtasks"
                right={
                  subtaskProgress
                    ? `${subtaskProgress.completed} of ${subtaskProgress.total} complete`
                    : undefined
                }
              />
              <div className="divide-y divide-gray-100 dark:divide-gray-700" data-subtask-list>
                {subtasks.map((subtask) => {
                  const nested = summarizeSubtaskProgress(subtask, availableTasks, availableStatuses);
                  return (
                    <button
                      key={subtask.id}
                      type="button"
                      onClick={() => onNavigateToTask?.(subtask)}
                      disabled={!onNavigateToTask}
                      data-subtask-id={subtask.id}
                      data-subtask-href={createUrlPath('/tasks', subtask.id, subtask.title)}
                      className="group flex w-full items-center gap-3 rounded-md px-2 py-3 text-left transition-colors duration-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-gray-700/50"
                      aria-label={`Open subtask ${subtask.id}: ${subtask.title} (${subtask.status})`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
                            {subtask.id}
                          </span>
                          <HierarchyStatusBadge status={subtask.status} statuses={availableStatuses} />
                          {nested && (
                            <span
                              className="text-xs text-gray-500 dark:text-gray-400"
                              data-nested-progress={`${nested.completed}/${nested.total}`}
                            >
                              {nested.completed} of {nested.total} complete
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block break-words text-sm font-medium text-gray-900 dark:text-gray-100">
                          {subtask.title}
                        </span>
                      </span>
                      <HierarchyChevron />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Acceptance Criteria: shown when there are any, always while editing */}
          {(!isPreview || totalCount > 0) && (
            <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader
                title={`Acceptance Criteria ${totalCount ? `(${checkedCount}/${totalCount})` : ""}`}
              />
              {isPreview ? (
                <ul className="space-y-2">
                  {(criteria || []).map((c) => (
                    <li key={c.index} className="flex items-start gap-2 rounded-md px-2 py-1">
                      <input
                        type="checkbox"
                        checked={c.checked}
                        onChange={(e) => void handleToggleCriterion(c.index, e.target.checked)}
                        aria-label={`Acceptance criterion ${c.index}`}
                        className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="mt-0.5 w-8 shrink-0 text-right font-mono text-xs font-semibold text-gray-500 dark:text-gray-400">
                        {`#${c.index}`}
                      </span>
                      <div className="text-sm text-gray-800 dark:text-gray-100">{c.text}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <AcceptanceCriteriaEditor criteria={criteria} onChange={setCriteria} />
              )}
            </section>
          )}

          {/* Definition of Done */}
          {(!isPreview || definitionTotalCount > 0) && (
            <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader
                title={`Definition of Done ${definitionTotalCount ? `(${definitionCheckedCount}/${definitionTotalCount})` : ""}`}
              />
              {isPreview ? (
                <ul className="space-y-2">
                  {(definitionOfDone || []).map((item) => (
                    <li key={item.index} className="flex items-start gap-2 rounded-md px-2 py-1">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(e) => void handleToggleDefinitionOfDone(item.index, e.target.checked)}
                        aria-label={`Definition of Done item ${item.index}`}
                        className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <div className="text-sm text-gray-800 dark:text-gray-100">{item.text}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <AcceptanceCriteriaEditor
                  criteria={definitionOfDone}
                  onChange={setDefinitionOfDone}
                  label="Definition of Done"
                  preserveIndices
                  disableToggle={isCreateMode}
                />
              )}
            </section>
          )}

          {dependencyGraph && dependencyGraph.nodes.length > 1 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <SectionHeader title="Dependency Graph" />
              <DependencyGraphSection graph={dependencyGraph} />
            </section>
          )}

          {/* Implementation Plan */}
          {(!isPreview || plan) && (
            <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title="Implementation Plan" />
              {isPreview ? (
                <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                  <MermaidMarkdown source={plan} />
                </div>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                  <MDEditor
                    value={plan}
                    onChange={(val) => setPlan(val || "")}
                    preview="edit"
                    height={280}
                    data-color-mode={theme}
                  />
                </div>
              )}
            </section>
          )}

          {/* Implementation Notes */}
          {(!isPreview || notes) && (
            <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title="Implementation Notes" />
              {isPreview ? (
                <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                  <MermaidMarkdown source={notes} />
                </div>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                  <MDEditor
                    value={notes}
                    onChange={(val) => setNotes(val || "")}
                    preview="edit"
                    height={280}
                    data-color-mode={theme}
                  />
                </div>
              )}
            </section>
          )}

          {/* Documentation */}
          {documentation.length > 0 && (
            <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title="Documentation" />
              <ul className="space-y-2">
                {documentation.map((doc, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <span className="flex-1 min-w-0">
                      {doc.startsWith("http://") || doc.startsWith("https://") ? (
                        <a
                          href={doc}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
                        >
                          {doc}
                        </a>
                      ) : (
                        <code className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded break-all">
                          {doc}
                        </code>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Final Summary */}
          {(!isPreview || finalSummary.trim().length > 0) && (
            <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title="Final Summary" right="Completion summary" />
              {isPreview ? (
                <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                  <MermaidMarkdown source={finalSummary} />
                </div>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                  <MDEditor
                    value={finalSummary}
                    onChange={(val) => setFinalSummary(val || "")}
                    preview="edit"
                    height={220}
                    data-color-mode={theme}
                    textareaProps={{
                      placeholder: "PR-style summary of what was implemented (write when task is complete)",
                    }}
                  />
                </div>
              )}
            </section>
          )}

          {/* Comments: the conversation, and the reply box under it in every mode */}
          {!isCreateMode && (
            <section className="space-y-4" aria-labelledby="task-comments-heading">
              <div className="flex items-center justify-between">
                <h3 id="task-comments-heading" className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  {`Comments${comments.length ? ` (${comments.length})` : ""}`}
                </h3>
                {!isFromOtherBranch && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    <kbd className="rounded border border-gray-300 px-1 font-sans dark:border-gray-600">r</kbd> to reply
                  </span>
                )}
              </div>
              <CommentThread comments={comments} webUserName={webUserName} theme={theme} dateFormat={dateFormat} />
              {!isFromOtherBranch && (
                <ReplyBox
                  kind={isPreview ? decisionKind : null}
                  options={decisionOptions}
                  approvedStatus={workflow.approvedStatus}
                  declineStatus={workflow.doneStatus}
                  value={commentBody}
                  onChange={setCommentBody}
                  onSubmit={handleReply}
                  busy={commentSaving || demoting}
                  webUserName={webUserName}
                  textareaRef={replyRef}
                />
              )}
            </section>
          )}
        </div>

        {/* Properties */}
        <aside className="min-w-0 space-y-4" aria-label="Task properties">
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            {isCreateMode && (
              <Field label="Status">
                <StatusSelect
                  current={status}
                  statuses={availableStatuses}
                  onChange={(val) => handleInlineMetaUpdate({ status: val })}
                  disabled={isFromOtherBranch || isOpenDraft}
                />
              </Field>
            )}

            <Field label="Assignee" htmlFor="chip-input-assignee">
              <ChipInput
                name="assignee"
                label=""
                value={assignee}
                onChange={(value) => handleInlineMetaUpdate({ assignee: value })}
                placeholder="@name, then Enter"
                disabled={isFromOtherBranch}
              />
            </Field>

            <Field label="Labels" htmlFor="chip-input-labels">
              <ChipInput
                name="labels"
                label=""
                value={labels}
                onChange={(value) => handleInlineMetaUpdate({ labels: value })}
                placeholder="Label, then Enter"
                disabled={isFromOtherBranch}
              />
            </Field>

            <Field label="Priority">
              <select
                aria-label="Priority"
                className={`${SIDEBAR_SELECT_CLASS} ${isFromOtherBranch ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={priority}
                onChange={(e) => handleInlineMetaUpdate({ priority: e.target.value as any })}
                disabled={isFromOtherBranch}
              >
                <option value="">No Priority</option>
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type">
              <select
                aria-label="Task type"
                aria-invalid={typeUpdateError ? true : undefined}
                aria-describedby={typeUpdateError ? "task-type-update-error" : undefined}
                className={`${SIDEBAR_SELECT_CLASS} ${isFromOtherBranch || isTypeUpdating ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={typeSelectionValue}
                onChange={(event) => void handleTaskTypeChange(event.target.value)}
                disabled={isFromOtherBranch || isTypeUpdating}
              >
                <option value="">No type</option>
                {!canonicalTypeSelection && taskType.trim() ? (
                  <option value={taskType}>{taskType} (not configured)</option>
                ) : null}
                {typeOptions.map((typeOption) => (
                  <option key={typeOption} value={typeOption}>
                    {typeOption}
                  </option>
                ))}
              </select>
              {typeUpdateError ? (
                <p id="task-type-update-error" role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {typeUpdateError}
                </p>
              ) : null}
            </Field>

            {projectOptions.length > 0 && (
              <Field label="Project">
                <select
                  className={`${SIDEBAR_SELECT_CLASS} ${isFromOtherBranch ? 'opacity-60 cursor-not-allowed' : ''}`}
                  aria-label="Task project"
                  value={projectSelectionValue}
                  onChange={(e) => handleInlineMetaUpdate({ project: e.target.value })}
                  disabled={isFromOtherBranch}
                >
                  <option value="">No Project</option>
                  {!canonicalProjectSelection && project.trim() ? (
                    <option value={project}>{project} (not configured)</option>
                  ) : null}
                  {projectOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Milestone">
              <select
                aria-label="Milestone"
                className={`${SIDEBAR_SELECT_CLASS} ${isFromOtherBranch ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={milestoneSelectionValue}
				onChange={(e) => {
					const value = e.target.value;
					setMilestone(value);
					handleInlineMetaUpdate({ milestone: value.trim().length > 0 ? value : null });
				}}
                disabled={isFromOtherBranch}
              >
                <option value="">No milestone</option>
                {!hasMilestoneSelection && milestoneSelectionValue ? (
                  <option value={milestoneSelectionValue}>{resolveMilestoneLabel(milestoneSelectionValue)}</option>
                ) : null}
                {(milestoneEntities ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </Field>

            {!isPreview && (
              <Field label="Due">
                <input
                  type="date"
                  aria-label="Due date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="w-full h-9 px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                />
              </Field>
            )}

            <Field label="Dependencies" htmlFor="dependency-input">
              <DependencyInput
                value={dependencies}
                onChange={(value) => handleInlineMetaUpdate({ dependencies: value })}
                availableTasks={availableTasks}
                suggestableTasks={localAvailableTasks}
                currentTaskId={task?.id}
                label=""
                disabled={isFromOtherBranch}
              />
              {shownReadiness && (
                <div
                  className={`mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${
                    shownReadiness.isReady
                      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300'
                      : 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  <span aria-hidden="true">{shownReadiness.isReady ? '✓' : '⏳'}</span>
                  <span>{shownReadiness.isReady ? 'Ready to start' : formatReadinessBlockers(shownReadiness)}</span>
                </div>
              )}
            </Field>

            {/* References */}
            <Field label="References">
              <div className="space-y-2">
                {references.length > 0 && (
                  <ul className="space-y-1.5">
                    {references.map((ref, idx) => (
                      <li key={idx} className="flex items-center gap-2 group">
                        <span className="flex-1 min-w-0">
                          {ref.startsWith("http://") || ref.startsWith("https://") ? (
                            <a
                              href={ref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
                            >
                              {ref}
                            </a>
                          ) : (
                            <code className="text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded break-all">
                              {ref}
                            </code>
                          )}
                        </span>
                        {!isFromOtherBranch && (
                          <button
                            type="button"
                            onClick={() => {
                              const newRefs = references.filter((_, i) => i !== idx);
                              handleInlineMetaUpdate({ references: newRefs });
                            }}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
                            title="Remove reference"
                            aria-label={`Remove reference ${ref}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {isPreview && !isFromOtherBranch && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.elements.namedItem("newRef") as HTMLInputElement;
                      const value = input.value.trim();
                      if (value && !references.includes(value)) {
                        handleInlineMetaUpdate({ references: [...references, value] });
                        input.value = "";
                      }
                    }}
                  >
                    <input
                      name="newRef"
                      type="text"
                      aria-label="Add a reference"
                      placeholder="Add URL or path, then Enter"
                      className="w-full h-9 text-sm px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    />
                  </form>
                )}
              </div>
            </Field>

            {/* Modified files */}
            <Field label={`Modified files${modifiedFiles.length ? ` (${modifiedFiles.length})` : ""}`}>
              <div className="space-y-2">
                {modifiedFiles.length > 0 ? (
                  // A finished task can list hundreds of paths, so the list scrolls inside the
                  // section instead of pushing the sections below it out of reach.
                  <ul className="space-y-1.5 max-h-64 overflow-y-auto overscroll-contain pr-1">
                    {modifiedFiles.map((file, idx) => (
                      <li key={idx} className="flex items-start gap-2 group">
                        <span className="flex-1 min-w-0">
                          <code className="text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded break-all">
                            {file}
                          </code>
                        </span>
                        {!isFromOtherBranch && (
                          <button
                            type="button"
                            onClick={() => {
                              const newFiles = modifiedFiles.filter((_, i) => i !== idx);
                              handleInlineMetaUpdate({ modifiedFiles: newFiles });
                            }}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0 mt-0.5"
                            title="Remove modified file"
                            aria-label={`Remove modified file ${file}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400">No modified files</p>
                )}
                {isPreview && !isFromOtherBranch && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.elements.namedItem("newModifiedFile") as HTMLInputElement;
                      const value = input.value.trim();
                      if (value && !modifiedFiles.includes(value)) {
                        handleInlineMetaUpdate({ modifiedFiles: [...modifiedFiles, value] });
                        input.value = "";
                      }
                    }}
                  >
                    <input
                      name="newModifiedFile"
                      type="text"
                      aria-label="Add a modified file"
                      placeholder="Add path, then Enter"
                      className="w-full h-9 text-sm px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    />
                  </form>
                )}
              </div>
            </Field>
          </div>

          {/* Dates */}
	          {task && (
	            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
	              <div><span className="font-semibold text-gray-800 dark:text-gray-100">Created:</span> <StoredDate value={task.createdDate} dateFormat={dateFormat} className="text-gray-700 dark:text-gray-200" /></div>
	              {task.updatedDate && (
	                <div><span className="font-semibold text-gray-800 dark:text-gray-100">Updated:</span> <StoredDate value={task.updatedDate} dateFormat={dateFormat} className="text-gray-700 dark:text-gray-200" /></div>
	              )}
	              {task.dueDate && isPreview && (
	                <div><span className="font-semibold text-gray-800 dark:text-gray-100">Due:</span> <StoredDate value={task.dueDate} dateFormat={dateFormat} className="text-gray-700 dark:text-gray-200" /></div>
	              )}
	            </div>
	          )}

          {/* Rare and destructive actions stay out of the header */}
          {task && ((canDemote && isPreview) || (onArchive && !isFromOtherBranch)) && (
            <div className="flex flex-col gap-2">
              {canDemote && isPreview && (
                <button
                  type="button"
                  onClick={() => void handleDemote()}
                  disabled={demoting}
                  className="w-full inline-flex items-center justify-center px-3 py-2 rounded-md border border-amber-300 bg-white text-sm font-medium text-amber-800 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-300 dark:hover:bg-amber-950/40 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Move task to drafts"
                >
                  {demoting ? "Demoting…" : "Demote to draft"}
                </button>
              )}
              {onArchive && !isFromOtherBranch && (
                <button
                  type="button"
                  onClick={handleArchive}
                  disabled={demoting}
                  className="w-full inline-flex items-center justify-center px-3 py-2 rounded-md border border-red-300 bg-white text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-800 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-950/40 transition-colors duration-200"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  Archive Task
                </button>
              )}
            </div>
          )}
        </aside>
	      </div>
		</fieldset>
    </Modal>
  );
};

const StatusSelect: React.FC<{
  current: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  statuses?: string[];
  className?: string;
}> = ({ current, onChange, disabled, statuses: providedStatuses, className }) => {
  const [fetchedStatuses, setFetchedStatuses] = useState<string[]>([]);
  const hasProvidedStatuses = Boolean(providedStatuses && providedStatuses.length > 0);
  useEffect(() => {
    if (hasProvidedStatuses) return;
    apiClient.fetchStatuses().then(setFetchedStatuses).catch(() => setFetchedStatuses(["To Do", "In Progress", "Done"]));
  }, [hasProvidedStatuses]);
  const statuses = hasProvidedStatuses ? (providedStatuses ?? []) : fetchedStatuses;
  // A draft is on status Draft, and a completed record can hold a historical status, neither of
  // which is configured. Showing the value the record actually has beats showing the first option.
  const options = !current || statuses.includes(current) ? statuses : [current, ...statuses];
  return (
    <select
      aria-label="Status"
      className={`${className ?? SIDEBAR_SELECT_CLASS} focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
};

export default TaskDetailsModal;
