import type { TenantStatus } from '@crm/shared';
import type { Tone } from '../ui';

/** The tone each consultancy status wears everywhere it is shown. */
export const STATUS_TONE: Record<TenantStatus, Tone> = {
  active: 'ok',
  suspended: 'warn',
  deactivated: 'bad',
};
