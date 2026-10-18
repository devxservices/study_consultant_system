/**
 * Every state change worth disputing later is written to the audit log.
 * Values are stable DB identifiers.
 */
export const AUDIT_ACTIONS = [
  'client.created',
  'client.updated',
  'client.archived',
  'client.reassigned',
  'case.created',
  'case.stage_advanced',
  'case.stage_overridden',
  'case.status_changed',
  'case.note_added',
  'document.uploaded',
  'document.verified',
  'document.rejected',
  'document.commented',
  'document.deleted',
  'user.invited',
  'user.signed_in',
  'tenant.created',
  'tenant.updated',
  'tenant.status_changed',
  'tenant.domain_added',
  'tenant.domain_verified',
  'tenant.domain_removed',
  'tenant.plan_changed',
  'tenant.subscription_paid',
  'platform.settings_changed',
  'client.portal_access_granted',
  'client.portal_access_revoked',
  'case.updated',
  'invoice.created',
  'invoice.voided',
  'payment.recorded',
  'refund.recorded',
  'payment.voided',
  'task.created',
  'task.updated',
  'task.completed',
  'catalog.updated',
  'announcement.published',
  'announcement.deleted',
  'staff.updated',
  'staff.password_reset',
  'user.password_changed',
  'user.signed_out',
  'user.sign_in_failed',
  'client.viewed',
  'case.viewed',
  'document.downloaded',
  'message.sent',
  'staff.created',
  'staff.deactivated',
  'staff.reactivated',
  'permission.changed',
  'security.policy_changed',
  'mfa.enabled',
  'mfa.disabled',
  'mfa.recovery_codes_regenerated',
  'mfa.recovery_code_used',
  'mfa.challenge_failed',
  'mfa.reset',
  'data.exported',
  'role.saved',
  'role.deleted',
  'staff.role_assigned',
  'folder.created',
  'folder.updated',
  'folder.trashed',
  'folder.restored',
  'document.updated',
  'document.copied',
  'document.trashed',
  'document.restored',
  'document.purged',
  'document.status_changed',
  'document.version_restored',
  'document.bulk_downloaded',
  'share.created',
  'share.revoked',
  'share.accessed',
  'grant.added',
  'grant.removed',
  'drive.settings_changed',
  'document_type.saved',
  'checklist.saved',
  'folder_template.saved',
  'country.saved',
  'workflow.saved',
  'workflow.published',
  'workflow.cloned',
  'workflow.archived',
  'automation.saved',
  'automation.deleted',
  'case.workflow_changed',
  'case.stage_approved',
  'invoice.approved',
  'invoice.sent',
  'quote.saved',
  'quote.converted',
  'credit_note.issued',
  'credit_note.voided',
  'installments.set',
  'late_fee.charged',
  'payment_proof.submitted',
  'payment_proof.approved',
  'payment_proof.rejected',
  'online_payment.received',
  'refund.requested',
  'refund.approved',
  'refund.rejected',
  'expense.recorded',
  'expense.voided',
  'bill.saved',
  'bill.paid',
  'bill.voided',
  'journal.posted',
  'journal.reversed',
  'period.locked',
  'bank.imported',
  'bank.matched',
  'bank.unmatched',
  'finance.settings_changed',
  'tax.saved',
  'promo.saved',
  'institution.saved',
  'institution_agreement.saved',
  'commission.created',
  'commission.status_changed',
  'commission.adjusted',
  'claim.created',
  'claim.updated',
  'commission_receipt.recorded',
  'partner.applied',
  'partner.saved',
  'partner.approved',
  'partner.status_changed',
  'partner.tier_changed',
  'partner_agreement.sent',
  'partner_agreement.signed',
  'attribution.conflict',
  'attribution.resolved',
  'partner_rule.saved',
  'payout.created',
  'payout.approved',
  'payout.paid',
  'payout.voided',
  'advance.recorded',
  'partner_user.created',
  'partner_user.updated',
  'partner_document.uploaded',
  'partner_document.reviewed',
  'partner_earning.created',
  'partner_earning.reversed',
  'attribution.changed',
  'advance.voided',
  'partner_settings.changed',
  'course.saved',
  'batch.saved',
  'enrollment.created',
  'enrollment.updated',
  'attendance.marked',
  'assessment.saved',
  'scores.recorded',
  'test_result.saved',
  'homework.saved',
  'homework.submitted',
  'homework.graded',
  'certificate.issued',
  'enquiry.created',
  'enquiry.updated',
  'enquiry.enrolled',
  'enquiry.closed',
  'client.handed_over',
  'user.password_reset_requested',
  'user.password_reset',
  'user.password_link_sent',
  'user.sessions_ended',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  'client.created': 'Client added',
  'client.updated': 'Client details updated',
  'client.archived': 'Client archived',
  'client.reassigned': 'Client reassigned to another consultant',
  'case.created': 'Case opened',
  'case.stage_advanced': 'Moved to the next stage',
  'case.stage_overridden': 'Stage changed manually',
  'case.status_changed': 'Case status changed',
  'case.note_added': 'Note added',
  'document.uploaded': 'Document uploaded',
  'document.verified': 'Document verified',
  'document.rejected': 'Document rejected',
  'document.commented': 'Comment left on a document',
  'document.deleted': 'Document deleted',
  'user.invited': 'User invited',
  'user.signed_in': 'Signed in',
  'tenant.created': 'Consultancy created',
  'tenant.updated': 'Consultancy settings updated',
  'tenant.status_changed': 'Consultancy status changed',
  'tenant.domain_added': 'Domain added',
  'tenant.domain_verified': 'Domain verified',
  'tenant.domain_removed': 'Domain removed',
  'tenant.plan_changed': 'Subscription changed',
  'tenant.subscription_paid': 'Subscription payment recorded',
  'platform.settings_changed': 'Platform settings changed',
  'client.portal_access_granted': 'Portal access given',
  'client.portal_access_revoked': 'Portal access removed',
  'case.updated': 'Application details updated',
  'invoice.created': 'Invoice issued',
  'invoice.voided': 'Invoice voided',
  'payment.recorded': 'Payment recorded',
  'refund.recorded': 'Refund recorded',
  'payment.voided': 'Payment voided',
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'task.completed': 'Task completed',
  'catalog.updated': 'Catalogue updated',
  'announcement.published': 'Announcement published',
  'announcement.deleted': 'Announcement removed',
  'staff.updated': 'Staff account updated',
  'staff.password_reset': 'Staff password reset',
  'user.password_changed': 'Password changed',
  'user.password_reset_requested': 'Asked for a password reset link',
  'user.password_reset': 'Chose a new password from a link',
  'user.password_link_sent': 'Sent a set-password link',
  'user.sessions_ended': 'Signed out on every device',
  'user.signed_out': 'Signed out',
  'user.sign_in_failed': 'Failed sign-in',
  'client.viewed': 'Viewed a client',
  'case.viewed': 'Viewed an application',
  'document.downloaded': 'Opened a document',
  'message.sent': 'Sent a message',
  'staff.created': 'Consultant added',
  'staff.deactivated': 'Login switched off',
  'staff.reactivated': 'Login switched back on',
  'permission.changed': 'Permission changed',
  'security.policy_changed': 'Security policy changed',
  'mfa.enabled': 'Two-step verification switched on',
  'mfa.disabled': 'Two-step verification switched off',
  'mfa.recovery_codes_regenerated': 'New recovery codes generated',
  'mfa.recovery_code_used': 'Signed in with a recovery code',
  'mfa.challenge_failed': 'Wrong two-step code',
  'mfa.reset': 'Two-step verification reset',
  'data.exported': 'Data exported',
  'role.saved': 'Role saved',
  'role.deleted': 'Role removed',
  'staff.role_assigned': 'Role assigned',
  'folder.created': 'Folder created',
  'folder.updated': 'Folder changed',
  'folder.trashed': 'Folder moved to the trash',
  'folder.restored': 'Folder restored',
  'document.updated': 'Document details changed',
  'document.copied': 'Document copied',
  'document.trashed': 'Document moved to the trash',
  'document.restored': 'Document restored',
  'document.purged': 'Document removed for good',
  'document.status_changed': 'Document status changed',
  'document.version_restored': 'Earlier version restored',
  'document.bulk_downloaded': 'Documents downloaded together',
  'share.created': 'Share link created',
  'share.revoked': 'Share link revoked',
  'share.accessed': 'Shared document opened',
  'grant.added': 'Access granted',
  'grant.removed': 'Access removed',
  'drive.settings_changed': 'Document settings changed',
  'document_type.saved': 'Document type saved',
  'checklist.saved': 'Checklist saved',
  'folder_template.saved': 'Folder template saved',
  'country.saved': 'Country details saved',
  'workflow.saved': 'Workflow saved',
  'workflow.published': 'Workflow published',
  'workflow.cloned': 'Workflow copied',
  'workflow.archived': 'Workflow archived',
  'automation.saved': 'Automation saved',
  'automation.deleted': 'Automation removed',
  'case.workflow_changed': 'Application moved to another workflow',
  'case.stage_approved': 'Stage approved',
  'invoice.approved': 'Invoice approved',
  'invoice.sent': 'Invoice emailed',
  'quote.saved': 'Quote saved',
  'quote.converted': 'Quote turned into an invoice',
  'credit_note.issued': 'Credit note issued',
  'credit_note.voided': 'Credit note voided',
  'installments.set': 'Installment plan set',
  'late_fee.charged': 'Late fee charged',
  'payment_proof.submitted': 'Proof of payment sent',
  'payment_proof.approved': 'Proof of payment approved',
  'payment_proof.rejected': 'Proof of payment rejected',
  'online_payment.received': 'Online payment received',
  'refund.requested': 'Refund requested',
  'refund.approved': 'Refund approved',
  'refund.rejected': 'Refund rejected',
  'expense.recorded': 'Expense recorded',
  'expense.voided': 'Expense voided',
  'bill.saved': 'Bill saved',
  'bill.paid': 'Bill paid',
  'bill.voided': 'Bill voided',
  'journal.posted': 'Journal entry posted',
  'journal.reversed': 'Journal entry reversed',
  'period.locked': 'Books closed',
  'bank.imported': 'Bank statement imported',
  'bank.matched': 'Bank line matched',
  'bank.unmatched': 'Bank match undone',
  'finance.settings_changed': 'Finance settings changed',
  'tax.saved': 'Tax rate saved',
  'promo.saved': 'Promo code saved',
  'institution.saved': 'University saved',
  'institution_agreement.saved': 'University agreement saved',
  'commission.created': 'Commission recorded',
  'commission.status_changed': 'Commission status changed',
  'commission.adjusted': 'Commission adjusted',
  'claim.created': 'Commission claim raised',
  'claim.updated': 'Commission claim updated',
  'commission_receipt.recorded': 'University payment recorded',
  'partner.applied': 'Partner applied',
  'partner.saved': 'Partner saved',
  'partner.approved': 'Partner approved',
  'partner.status_changed': 'Partner status changed',
  'partner.tier_changed': 'Partner tier changed',
  'partner_agreement.sent': 'Agreement sent to partner',
  'partner_agreement.signed': 'Partner signed agreement',
  'attribution.conflict': 'Duplicate student flagged',
  'attribution.resolved': 'Student ownership settled',
  'partner_rule.saved': 'Partner commission rule saved',
  'payout.created': 'Partner payout prepared',
  'payout.approved': 'Partner payout approved',
  'payout.paid': 'Partner paid',
  'payout.voided': 'Partner payout voided',
  'advance.recorded': 'Advance to partner recorded',
  'partner_user.created': 'Partner login created',
  'partner_user.updated': 'Partner login changed',
  'partner_document.uploaded': 'Partner paper uploaded',
  'partner_document.reviewed': 'Partner paper checked',
  'partner_earning.created': 'Partner earning added',
  'partner_earning.reversed': 'Partner earning reversed',
  'attribution.changed': 'Student moved to another partner',
  'advance.voided': 'Advance to partner voided',
  'partner_settings.changed': 'Partner settings changed',
  'course.saved': 'Course saved',
  'batch.saved': 'Batch saved',
  'enrollment.created': 'Student enrolled',
  'enrollment.updated': 'Enrolment changed',
  'attendance.marked': 'Attendance taken',
  'assessment.saved': 'Assessment saved',
  'scores.recorded': 'Scores recorded',
  'test_result.saved': 'Official test result saved',
  'homework.saved': 'Homework set',
  'homework.submitted': 'Homework handed in',
  'homework.graded': 'Homework graded',
  'certificate.issued': 'Certificate issued',
  'enquiry.created': 'Course enquiry received',
  'enquiry.updated': 'Course enquiry updated',
  'enquiry.enrolled': 'Course enquiry enrolled',
  'enquiry.closed': 'Course enquiry closed',
  'client.handed_over': 'Handed over to study abroad',
};

/** Groups for filtering the trail: an action belongs to the group its prefix names. */
export const AUDIT_CATEGORIES = [
  { key: 'user', label: 'Sign-ins and account', prefixes: ['user.', 'mfa.'] },
  { key: 'client', label: 'Clients', prefixes: ['client.'] },
  { key: 'case', label: 'Applications', prefixes: ['case.'] },
  { key: 'document', label: 'Documents', prefixes: ['document.', 'folder.', 'share.', 'grant.', 'drive.', 'document_type.', 'checklist.', 'folder_template.'] },
  { key: 'workflow', label: 'Workflows', prefixes: ['country.', 'workflow.', 'automation.'] },
  { key: 'message', label: 'Messages', prefixes: ['message.'] },
  { key: 'money', label: 'Money', prefixes: ['invoice.', 'payment.', 'refund.', 'quote.', 'credit_note.', 'installments.', 'late_fee.', 'payment_proof.', 'online_payment.', 'expense.', 'bill.', 'journal.', 'period.', 'bank.', 'finance.', 'tax.', 'promo.'] },
  { key: 'commission', label: 'Commissions', prefixes: ['institution.', 'institution_agreement.', 'commission.', 'claim.', 'commission_receipt.'] },
  { key: 'partner', label: 'Partners', prefixes: ['partner.', 'partner_agreement.', 'attribution.', 'partner_rule.', 'payout.', 'advance.', 'partner_user.', 'partner_document.', 'partner_earning.', 'partner_settings.'] },
  { key: 'course', label: 'Courses', prefixes: ['course.', 'enquiry.', 'batch.', 'enrollment.', 'attendance.', 'assessment.', 'scores.', 'test_result.', 'homework.', 'certificate.'] },
  { key: 'team', label: 'Team and security', prefixes: ['staff.', 'permission.', 'security.', 'tenant.', 'role.', 'platform.'] },
  { key: 'data', label: 'Exports', prefixes: ['data.'] },
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]['key'];

/** One audit row, as the trail and the member activity page receive it. */
export interface AuditEntryView {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  caseId: string | null;
  clientId: string | null;
  clientName: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const human = (v: string) => v.replace(/_/g, ' ');

/**
 * A plain sentence for an audit row, written from the actor's point of view:
 * "Viewed Ali Khan's application APP-2026-0042", "Verified passport",
 * "Changed Sana's permission to move applications from allowed to denied".
 * Falls back to the action's label when the row carries no detail.
 */
export function describeAudit(e: Pick<AuditEntryView, 'action' | 'clientName' | 'metadata'>): string {
  const m = e.metadata ?? {};
  const who = e.clientName;
  const doc = str(m.fileName) ?? (str(m.type) ? human(str(m.type)!) : null);
  switch (e.action) {
    case 'client.viewed':
      return who ? `Viewed ${who}’s record` : 'Viewed a client record';
    case 'case.viewed':
      return `Viewed ${who ? `${who}’s ` : ''}application${str(m.reference) ? ` ${m.reference}` : ''}`;
    case 'document.downloaded':
      return `Opened ${doc ?? 'a document'}${who ? ` for ${who}` : ''}`;
    case 'document.uploaded':
      return `Uploaded ${doc ?? 'a document'}${who ? ` for ${who}` : ''}`;
    case 'document.verified':
      return `Verified ${doc ?? 'a document'}${who ? ` for ${who}` : ''}`;
    case 'document.rejected':
      return `Rejected ${doc ?? 'a document'}${who ? ` for ${who}` : ''}${str(m.reason) ? `: “${m.reason}”` : ''}`;
    case 'document.commented':
      return `Asked about ${doc ?? 'a document'}${who ? ` for ${who}` : ''}`;
    case 'document.deleted':
      return `Deleted ${doc ?? 'a document'}${who ? ` for ${who}` : ''}`;
    case 'case.stage_overridden':
    case 'case.stage_advanced':
      if (str(m.to)) {
        return `${e.action === 'case.stage_advanced' ? 'Automatically moved' : 'Moved'} ${who ? `${who}’s application` : 'an application'} to ${human(str(m.to)!)}`;
      }
      break;
    case 'case.status_changed':
      if (str(m.to)) return `Set ${who ? `${who}’s application` : 'an application'} to ${human(str(m.to)!)}`;
      break;
    case 'message.sent':
      return `Sent a message${who ? ` to ${who}` : ''}`;
    case 'user.sign_in_failed':
      return `Failed to sign in${str(m.email) ? ` as ${m.email}` : ''}${str(m.reason) ? ` (${m.reason})` : ''}`;
    case 'permission.changed': {
      const target = str(m.memberName) ?? 'consultants';
      const scope = m.scope === 'consultancy' ? 'the default for consultants' : `${target}’s permission`;
      return `Changed ${scope} “${str(m.label) ?? str(m.permission) ?? ''}” from ${str(m.from) ?? 'default'} to ${str(m.to) ?? 'default'}`;
    }
    case 'data.exported':
      return `Exported ${str(m.dataset) ?? 'data'}${typeof m.rows === 'number' ? ` (${m.rows} rows)` : ''}`;
    case 'invoice.created':
      return `Issued invoice ${str(m.number) ?? ''}${who ? ` to ${who}` : ''}`.trim();
    case 'payment.recorded':
      return `Recorded payment ${str(m.receipt) ?? ''}${who ? ` from ${who}` : ''}`.trim();
    case 'mfa.reset':
      return `Reset two-step verification${str(m.memberName) ? ` for ${m.memberName}` : ''}`;
    case 'staff.created':
      return `Added ${str(m.memberName) ?? 'a consultant'} to the team`;
    case 'staff.deactivated':
      return `Switched off ${str(m.memberName) ? `${m.memberName}’s` : 'a'} login`;
    case 'staff.reactivated':
      return `Switched ${str(m.memberName) ? `${m.memberName}’s` : 'a'} login back on`;
    case 'user.password_link_sent':
      return `Sent ${str(m.memberName) ?? 'someone'} a link to ${m.purpose === 'invite' ? 'set up' : 'reset'} their password`;
    case 'staff.password_reset':
      return `Set a new password for ${str(m.memberName) ?? 'a consultant'}`;
    case 'staff.updated':
      if (str(m.memberName)) return `Changed ${m.memberName}’s capacity or countries`;
      break;
    case 'security.policy_changed':
      if (str(m.to)) return `Changed two-step verification to “${human(str(m.to)!)}”`;
      break;
  }
  const label = AUDIT_ACTION_LABEL[e.action as AuditAction] ?? e.action;
  return who ? `${label} - ${who}` : label;
}
