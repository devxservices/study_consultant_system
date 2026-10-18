import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import type { AuthUser } from '@crm/shared';
import { cases, clients, docFolders, documents } from '../db/schema';
import { seesAll } from '../auth/permissions';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { NIL_UUID } from '../common/db-helpers';

/*
 * Who may see which documents and folders, in SQL - one place, used by every
 * query the drive makes. The order of the rules:
 *
 *  1. Always inside the person's own consultancy.
 *  2. A manager sees everything.
 *  3. Staff see the students they work with - assigned to them, or on an
 *     application they handle - or every student with "See every client".
 *     The agency's own files (no student) are every member of staff's.
 *  4. A restricted folder (and everything under it) is hidden from everyone
 *     but managers, unless they were granted access to it.
 *  5. A grant opens one folder (with everything under it) or one document
 *     to one person, beyond rules 3 and 4.
 *  6. A student sees their own documents, never a restricted folder's.
 */

/**
 * The outer row's column, always written with its table's name. Drizzle
 * leaves the table off when a query selects from a single table, and inside a
 * correlated subquery an unqualified "id" binds to the subquery's own table -
 * silently comparing a row with itself.
 */
const outer = (table: string, column: string) => sql.raw(`"${table}"."${column}"`);
const D = { id: outer('documents', 'id'), folderId: outer('documents', 'folder_id'), clientId: outer('documents', 'client_id') };
const F = {
  id: outer('doc_folders', 'id'),
  tenantId: outer('doc_folders', 'tenant_id'),
  clientId: outer('doc_folders', 'client_id'),
  ancestry: outer('doc_folders', 'ancestry'),
};
const C = { id: outer('clients', 'id') };

/** Expects clients and cases LEFT-joined to documents in the query. */
export function documentScope(actor: AuthUser): SQL {
  const tenant = eq(documents.tenantId, tenantOf(actor));
  switch (actor.role) {
    case 'manager':
      return tenant;
    case 'consultant': {
      const me = actor.consultantId ?? NIL_UUID;
      const theirs = seesAll(actor)
        ? sql`true`
        : or(sql`${D.clientId} is null`, eq(clients.assignedConsultantId, me), eq(cases.consultantId, me))!;
      return and(tenant, or(and(theirs, sql`not ${documentRestricted()}`), documentGranted(actor.id)))!;
    }
    case 'client':
      return and(tenant, eq(documents.clientId, actor.clientId ?? NIL_UUID), sql`not ${documentRestricted()}`)!;
    default:
      return sql`false`;
  }
}

/** The document sits in a restricted folder, or under one. */
export function documentRestricted(): SQL {
  return sql`exists (
    select 1 from doc_folders df
    join doc_folders rf on rf.restricted and rf.tenant_id = df.tenant_id
      and (rf.id = df.id or df.ancestry like '%/' || rf.id::text || '/%')
    where df.id = ${D.folderId}
  )`;
}

/** This person was granted the document, or a folder it sits in or under. */
export function documentGranted(userId: string): SQL {
  return sql`exists (
    select 1 from resource_grants g
    where g.user_id = ${userId}::uuid and (
      (g.resource_type = 'document' and g.resource_id = ${D.id})
      or (g.resource_type = 'folder' and exists (
        select 1 from doc_folders gf where gf.id = ${D.folderId}
          and (gf.id = g.resource_id or gf.ancestry like '%/' || g.resource_id::text || '/%')
      ))
    )
  )`;
}

/** The folder is restricted, or sits under a restricted one. */
export function folderRestricted(): SQL {
  return sql`exists (
    select 1 from doc_folders rf
    where rf.restricted and rf.tenant_id = ${F.tenantId}
      and (rf.id = ${F.id} or ${F.ancestry} like '%/' || rf.id::text || '/%')
  )`;
}

export function folderGranted(userId: string): SQL {
  return sql`exists (
    select 1 from resource_grants g
    where g.user_id = ${userId}::uuid and g.resource_type = 'folder'
      and (g.resource_id = ${F.id} or ${F.ancestry} like '%/' || g.resource_id::text || '/%')
  )`;
}

/**
 * Folders this person may see. Expects nothing joined: the student check is a
 * subquery, so agency folders (no student) work the same way.
 */
export function folderScope(actor: AuthUser): SQL {
  const tenant = eq(docFolders.tenantId, tenantOf(actor));
  switch (actor.role) {
    case 'manager':
      return tenant;
    case 'consultant': {
      const me = actor.consultantId ?? NIL_UUID;
      const theirs = seesAll(actor)
        ? sql`true`
        : sql`(${F.clientId} is null or exists (
            select 1 from clients c where c.id = ${F.clientId}
              and (c.assigned_consultant_id = ${me}::uuid
                or exists (select 1 from cases k where k.client_id = c.id and k.consultant_id = ${me}::uuid))
          ))`;
      return and(tenant, or(and(theirs, sql`not ${folderRestricted()}`), folderGranted(actor.id)))!;
    }
    case 'client':
      return and(tenant, eq(docFolders.clientId, actor.clientId ?? NIL_UUID), sql`not ${folderRestricted()}`)!;
    default:
      return sql`false`;
  }
}

/** Students this person may see, for the drive's student list. Expects `clients`. */
export function studentScope(actor: AuthUser): SQL {
  const tenant = eq(clients.tenantId, tenantOf(actor));
  switch (actor.role) {
    case 'manager':
      return tenant;
    case 'consultant': {
      if (seesAll(actor)) return tenant;
      const me = actor.consultantId ?? NIL_UUID;
      return and(
        tenant,
        or(
          eq(clients.assignedConsultantId, me),
          sql`exists (select 1 from cases k where k.client_id = ${C.id} and k.consultant_id = ${me}::uuid)`,
          sql`exists (select 1 from resource_grants g join doc_folders f on f.id = g.resource_id
            where g.user_id = ${actor.id}::uuid and g.resource_type = 'folder' and f.client_id = ${C.id})`,
          sql`exists (select 1 from resource_grants g join documents d on d.id = g.resource_id
            where g.user_id = ${actor.id}::uuid and g.resource_type = 'document' and d.client_id = ${C.id})`,
        ),
      )!;
    }
    case 'client':
      return and(tenant, eq(clients.id, actor.clientId ?? NIL_UUID))!;
    default:
      return sql`false`;
  }
}

/** For correlated subqueries elsewhere: the outer table's column, named in full. */
export { outer as qualified };
