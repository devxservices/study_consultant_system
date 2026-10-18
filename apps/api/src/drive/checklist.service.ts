import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  typeLabel,
  type ApplicationChecklistView,
  type AuthUser,
  type ChecklistItemView,
  type DocumentStatus,
  type StudentChecklistView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { cases, clients, documentTypes, documents, requirementSets } from '../db/schema';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { studentScope } from '../documents/drive-sql';
import { today } from '../common/db-helpers';

type SetRow = typeof requirementSets.$inferSelect;
type DocBest = { clientId: string; caseId: string | null; typeKey: string; status: DocumentStatus; id: string; expiresOn: string | null };

const RANK: Record<DocumentStatus, number> = { verified: 3, under_review: 2, pending: 2, reupload_requested: 1, rejected: 1 };
const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

/**
 * Which documents each application needs, and how far along the student is.
 *
 * The checklist for an application is the consultancy's most specific
 * requirement set for it - country, level and visa type beat country alone,
 * which beats the general list - and a student's own documents (a passport)
 * count for every application that needs them. Completion is the share of
 * required documents that are approved; an expired one does not count.
 */
@Injectable()
export class ChecklistService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The best-matching set: every field it names must match, and the more it names the better. */
  static match(sets: SetRow[], app: { country: string | null; level: string | null; visaType: string | null }): SetRow | null {
    let best: { set: SetRow; score: number } | null = null;
    for (const s of sets) {
      if (!s.active) continue;
      if (s.country && norm(s.country) !== norm(app.country)) continue;
      if (s.studyLevel && norm(s.studyLevel) !== norm(app.level)) continue;
      if (s.visaType && norm(s.visaType) !== norm(app.visaType)) continue;
      const score = (s.country ? 4 : 0) + (s.studyLevel ? 2 : 0) + (s.visaType ? 1 : 0);
      if (!best || score > best.score) best = { set: s, score };
    }
    return best?.set ?? null;
  }

  async forStudent(actor: AuthUser, clientId: string): Promise<StudentChecklistView> {
    const tenantId = tenantOf(actor);
    const [client] = await this.db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), studentScope(actor)))
      .limit(1);
    if (!client) throw new NotFoundException('Student not found.');
    const [result] = await this.compute(tenantId, [clientId]);
    return result ?? { clientId, applications: [], overall: 0 };
  }

  /** Overall completion for many students at once - three queries whatever the count. */
  async completionFor(tenantId: string, clientIds: string[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    for (const r of await this.compute(tenantId, clientIds)) out.set(r.clientId, r.applications.length ? r.overall : null);
    return out;
  }

  private async compute(tenantId: string, clientIds: string[]): Promise<StudentChecklistView[]> {
    if (clientIds.length === 0) return [];
    const [sets, types, students, apps, docs] = await Promise.all([
      this.db.select().from(requirementSets).where(eq(requirementSets.tenantId, tenantId)),
      this.db
        .select({ key: documentTypes.key, label: documentTypes.label, hint: documentTypes.hint })
        .from(documentTypes)
        .where(eq(documentTypes.tenantId, tenantId)),
      this.db
        .select({ id: clients.id, level: clients.intendedLevel })
        .from(clients)
        .where(and(eq(clients.tenantId, tenantId), inArray(clients.id, clientIds))),
      this.db
        .select({
          id: cases.id,
          clientId: cases.clientId,
          reference: cases.reference,
          country: cases.targetCountry,
          visaType: cases.visaType,
          level: cases.studyLevel,
          status: cases.status,
        })
        .from(cases)
        .where(and(eq(cases.tenantId, tenantId), inArray(cases.clientId, clientIds)))
        .orderBy(asc(cases.createdAt)),
      this.db
        .select({
          id: documents.id,
          clientId: documents.clientId,
          caseId: documents.caseId,
          typeKey: documents.typeKey,
          status: documents.status,
          expiresOn: documents.expiresOn,
        })
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, tenantId),
            inArray(documents.clientId, clientIds),
            isNull(documents.deletedAt),
            isNull(documents.trashedAt),
            isNull(documents.supersededBy),
          ),
        ),
    ]);
    const label = (key: string) => types.find((t) => t.key === key)?.label ?? typeLabel(key);
    const hint = (key: string) => types.find((t) => t.key === key)?.hint ?? null;
    const now = today();

    return students.map((s) => {
      const theirs = apps.filter((a) => a.clientId === s.id && a.status !== 'withdrawn');
      const targets: { caseId: string | null; reference: string | null; country: string | null; visaType: string | null; level?: string | null }[] = theirs.length
        ? theirs.map((a) => ({ caseId: a.id, reference: a.reference, country: a.country, visaType: a.visaType, level: a.level }))
        : [{ caseId: null, reference: null, country: null, visaType: null, level: null }];
      const studentDocs = docs.filter((d) => d.clientId === s.id) as DocBest[];

      const applications: ApplicationChecklistView[] = targets.map((t) => {
        const set = ChecklistService.match(sets, { country: t.country, level: t.level ?? s.level, visaType: t.visaType });
        const relevant = studentDocs.filter((d) => d.caseId === null || d.caseId === t.caseId);
        const items: ChecklistItemView[] = (set?.items ?? []).map((item) => {
          const best = relevant
            .filter((d) => d.typeKey === item.typeKey)
            .sort((a, b) => RANK[b.status] - RANK[a.status])[0];
          const expired = Boolean(best?.expiresOn && best.expiresOn < now);
          return {
            typeKey: item.typeKey,
            label: label(item.typeKey),
            hint: hint(item.typeKey),
            required: item.required,
            note: item.note ?? null,
            status: best ? best.status : 'missing',
            documentId: best?.id ?? null,
            expiresOn: best?.expiresOn ?? null,
            expired,
          };
        });
        const required = items.filter((i) => i.required);
        const approved = required.filter((i) => i.status === 'verified' && !i.expired).length;
        return {
          caseId: t.caseId,
          reference: t.reference,
          targetCountry: t.country,
          setName: set?.name ?? 'No checklist',
          items,
          required: required.length,
          approved,
          percent: required.length ? Math.round((approved / required.length) * 100) : 100,
        };
      });
      const overall = Math.round(applications.reduce((n, a) => n + a.percent, 0) / applications.length);
      return { clientId: s.id, applications, overall };
    });
  }
}
