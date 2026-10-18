import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * Follow-ups: "call Hamza about his transcript on Thursday". The thing that
 * lived in a consultant's notebook, now with a due date the whole office can
 * see and a nudge when it slips.
 */
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const createTaskSchema = z.object({
  title: z.string().trim().min(3, 'Say what needs doing').max(200),
  notes: z.string().trim().max(2000).optional(),
  clientId: uuidSchema.optional(),
  caseId: uuidSchema.optional(),
  /** Defaults to the person creating it. Managers may assign to anyone on staff. */
  assigneeId: uuidSchema.optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  assigneeId: uuidSchema.optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  /** Flag it for a manager's attention. */
  escalated: z.boolean().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksQuerySchema = z.object({
  view: z.enum(['open', 'overdue', 'today', 'upcoming', 'done', 'all']).default('open'),
  /** "me" or a staff user id (managers only). Omitted: mine for consultants, everyone for managers. */
  assignee: z.string().trim().optional(),
  clientId: uuidSchema.optional(),
  caseId: uuidSchema.optional(),
  escalated: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export interface TaskView {
  id: string;
  title: string;
  notes: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  overdue: boolean;
  escalated: boolean;
  assigneeId: string;
  assigneeName: string;
  createdByName: string | null;
  clientId: string | null;
  clientName: string | null;
  caseId: string | null;
  caseReference: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface TaskCounts {
  open: number;
  overdue: number;
  today: number;
  escalated: number;
}
