import type { NotificationFeed } from '@crm/shared';
import { apiFetch } from './api';

/**
 * Preloaded on the server so the bell badge is right on first paint rather
 * than popping in. Never throws: a notification failure must not take down
 * the page it decorates.
 */
export async function getNotificationFeed(): Promise<NotificationFeed> {
  try {
    return await apiFetch<NotificationFeed>('/notifications?limit=20');
  } catch {
    return { items: [], unread: 0 };
  }
}
