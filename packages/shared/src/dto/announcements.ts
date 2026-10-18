import { z } from 'zod';

/**
 * Notices from the consultancy: "office closed for Eid", "UK September intake
 * deadlines are approaching". Written by a manager, shown to whoever it is for.
 */
export const AUDIENCES = ['everyone', 'staff', 'clients', 'partners'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<Audience, string> = {
  everyone: 'Everyone',
  staff: 'Staff only',
  clients: 'Clients only',
  partners: 'Partners only',
};

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(3, 'Give it a headline').max(140),
  body: z.string().trim().min(3, 'Say what people need to know').max(3000),
  audience: z.enum(AUDIENCES).default('everyone'),
  pinned: z.boolean().default(false),
  /** Stops showing after this date. Omitted: shows until deleted. */
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  pinned: boolean;
  expiresOn: string | null;
  authorName: string | null;
  createdAt: string;
}
