/**
 * The documents drive: folders, filing, review, versions, trash, sharing,
 * bulk work, resumable uploads, reminders and checklists - each attacked from
 * the other consultancy, the wrong student, and without the permission.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { HOST, OUTBOX, appGet, as, call, db, fx, pdf, rawRequest, schema, setPermission, startApp, stopApp, upload } from './harness';

before(startApp);
after(stopApp);

const alphaM = as('alphaManager');
const alphaC = as('alphaConsultant');
const alphaS = as('alphaClient');
const bravoM = as('bravoManager');
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

async function folderOf(clientWho: typeof alphaM, clientId: string, key: string): Promise<string> {
  const r = await clientWho('GET', `/drive?clientId=${clientId}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const f = r.body.folders.find((x: { systemKey: string }) => x.systemKey === key);
  assert.ok(f, `the student has a ${key} folder`);
  return f.id;
}

describe('a student’s drive', () => {
  test('is built from the template on first visit, and existing documents are filed by type', async () => {
    const r = await alphaC('GET', `/drive?clientId=${fx.alpha.clientId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const keys = r.body.folders.map((f: { systemKey: string }) => f.systemKey).sort();
    assert.deepEqual(keys, ['academic', 'application', 'financial', 'language', 'offers', 'other', 'passport', 'visa']);
    const passportFolder = r.body.folders.find((f: { systemKey: string }) => f.systemKey === 'passport');
    assert.equal(passportFolder.documentCount, 1, 'the fixture passport was filed');

    const inside = await alphaC('GET', `/drive?folderId=${passportFolder.id}`);
    assert.equal(inside.body.documents[0].id, fx.alpha.documentId);
    assert.deepEqual(inside.body.breadcrumb.map((c: { kind: string }) => c.kind), ['root', 'students', 'student', 'folder']);
  });

  test('a student uploads without picking anything and the file is classified and filed', async () => {
    const up = await upload('alphaClient', '/drive/upload', {}, { name: 'my_IELTS_TRF.pdf', type: 'application/pdf', bytes: pdf('ielts') });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.typeKey, 'language_test');
    assert.equal(up.body.folderId, await folderOf(alphaS, fx.alpha.clientId, 'language'));
    assert.equal(up.body.caseId, null, 'the student’s own document, for every application');
    assert.equal(up.body.status, 'pending');
  });

  test('the same file twice is flagged as a duplicate', async () => {
    const bytes = pdf('same-bytes');
    const a = await upload('alphaClient', '/drive/upload', { typeKey: 'cv' }, { name: 'cv.pdf', type: 'application/pdf', bytes });
    const b = await upload('alphaClient', '/drive/upload', { typeKey: 'cv' }, { name: 'cv-again.pdf', type: 'application/pdf', bytes });
    assert.equal(b.body.duplicateOfId, a.body.id);
  });
});

describe('who sees what', () => {
  test('another consultancy sees none of it, by any route', async () => {
    const docId = fx.alpha.documentId;
    const folderId = await folderOf(alphaM, fx.alpha.clientId, 'passport');
    for (const url of [`/drive/documents/${docId}`, `/drive/folders/${folderId}`, `/drive?folderId=${folderId}`, `/drive?clientId=${fx.alpha.clientId}`, `/documents/${docId}/versions`, `/drive/students/${fx.alpha.clientId}/checklist`]) {
      const r = await bravoM('GET', url);
      assert.equal(r.status, 404, `${url} from bravo`);
    }
    const all = await bravoM('GET', '/drive?view=all');
    assert.ok(all.body.documents.every((d: { id: string }) => d.id !== docId));
    for (const [method, url, json] of [
      ['PATCH', `/drive/documents/${docId}`, { fileName: 'stolen' }],
      ['POST', `/drive/folders/${folderId}/trash`, undefined],
      ['POST', '/drive/shares', { documentId: docId, label: 'Exfiltrate this', expiresInDays: 7 }],
      ['POST', '/drive/star', { itemType: 'document', itemId: docId, starred: true }],
    ] as const) {
      const r = await bravoM(method, url, json);
      assert.equal(r.status, 404, `${method} ${url} from bravo`);
    }
  });

  test('a consultant sees only students they work with; a restricted folder needs a grant', async () => {
    const [other] = await db()
      .insert(schema.clients)
      .values({ tenantId: fx.alpha.id, fullName: 'Unassigned Student', email: 'u@example.com', phone: '+92 300 9999999' })
      .returning();
    assert.equal((await alphaC('GET', `/drive?clientId=${other!.id}`)).status, 404);
    const students = await alphaC('GET', '/drive/students');
    assert.ok(!students.body.items.some((s: { clientId: string }) => s.clientId === other!.id));

    // A manager's restricted folder inside an assigned student's drive.
    const secret = await alphaM('POST', '/drive/folders', { clientId: fx.alpha.clientId, name: 'Sponsor bank records', restricted: true });
    assert.equal(secret.status, 201);
    const listing = await alphaC('GET', `/drive?clientId=${fx.alpha.clientId}`);
    assert.ok(!listing.body.folders.some((f: { id: string }) => f.id === secret.body.id), 'hidden from the consultant');
    // Regression: one restricted folder must not hide every other folder.
    assert.equal(listing.body.folders.length, 8, 'the ordinary folders are all still there');
    const passportCount = listing.body.folders.find((f: { systemKey: string }) => f.systemKey === 'passport').documentCount;
    assert.ok(passportCount >= 1, 'and their counts are real');
    assert.equal((await alphaC('GET', `/drive/folders/${secret.body.id}`)).status, 404);
    assert.equal((await alphaS('GET', `/drive/folders/${secret.body.id}`)).status, 404, 'and from the student');

    const grant = await alphaM('POST', '/drive/grants', { resourceType: 'folder', resourceId: secret.body.id, userId: fx.alpha.consultantUserId, access: 'view' });
    assert.equal(grant.status, 201, JSON.stringify(grant.body));
    assert.equal((await alphaC('GET', `/drive/folders/${secret.body.id}`)).status, 200, 'visible once granted');
    assert.equal((await alphaC('POST', '/drive/grants', { resourceType: 'folder', resourceId: secret.body.id, userId: fx.alpha.consultantUserId })).status, 403, 'only managers grant');
    assert.equal((await alphaM('DELETE', `/drive/grants/${grant.body.id}`)).status, 204);
    assert.equal((await alphaC('GET', `/drive/folders/${secret.body.id}`)).status, 404, 'and hidden again');
  });

  test('organising needs the permission, refused by the API', async () => {
    await setPermission('alpha', 'document.manage', 'deny');
    const r = await alphaC('POST', '/drive/folders', { clientId: fx.alpha.clientId, name: 'Nope' });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'PERMISSION_DENIED');
    await setPermission('alpha', 'document.manage', 'inherit');
  });
});

describe('review, versions and trash', () => {
  test('under review, re-upload requested with a reason, a new version, then approved - the student hears each step', async () => {
    const up = await upload('alphaClient', '/drive/upload', { typeKey: 'bank_statement' }, { name: 'bank.pdf', type: 'application/pdf', bytes: pdf('bank-v1') });
    const id = up.body.id;
    assert.equal((await alphaC('POST', `/documents/${id}/status`, { status: 'under_review' })).body.status, 'under_review');
    const noReason = await alphaC('POST', `/documents/${id}/status`, { status: 'reupload_requested', comment: 'blurry' });
    assert.equal(noReason.status, 400, 'a reason is a full sentence');
    const ask = await alphaC('POST', `/documents/${id}/status`, { status: 'reupload_requested', comment: 'The stamp on page two is not readable, please scan it again.' });
    assert.equal(ask.status, 201);
    assert.equal(ask.body.status, 'reupload_requested');

    const v2 = await upload('alphaClient', '/drive/upload', { replacesId: id }, { name: 'bank-rescan.pdf', type: 'application/pdf', bytes: pdf('bank-v2') });
    assert.equal(v2.status, 201, JSON.stringify(v2.body));
    assert.equal(v2.body.version, 2);
    assert.equal(v2.body.versionCount, 2);
    const versions = await alphaC('GET', `/documents/${v2.body.id}/versions`);
    assert.deepEqual(versions.body.map((v: { version: number; current: boolean }) => [v.version, v.current]), [[2, true], [1, false]]);

    const ok = await alphaC('POST', `/documents/${v2.body.id}/status`, { status: 'verified' });
    assert.equal(ok.body.status, 'verified');
    const mails = fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.eml')).map((f) => fs.readFileSync(path.join(OUTBOX, f), 'utf8'));
    assert.ok(mails.some((m) => /Subject: Please send your Bank Statement again/.test(m)), 'the student was emailed the request');
    assert.ok(mails.some((m) => /Subject: Bank Statement approved/.test(m)), 'and the approval');

    // An earlier version comes back as the newest.
    const back = await alphaC('POST', `/documents/${v2.body.id}/versions/${id}/restore`);
    assert.equal(back.status, 201, JSON.stringify(back.body));
    const after = await alphaC('GET', `/documents/${back.body.id}/versions`);
    assert.equal(after.body.length, 3);
    assert.equal(after.body[0].version, 3);
  });

  test('the trash: a student removes their own unapproved upload, cannot remove an approved one; it can be restored', async () => {
    const up = await upload('alphaClient', '/drive/upload', { typeKey: 'photograph' }, { name: 'photo.png', type: 'image/png', bytes: png() });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal((await alphaS('DELETE', `/documents/${up.body.id}`)).status, 204);
    assert.equal((await alphaS('GET', `/drive/documents/${up.body.id}`)).body.trashedAt !== null, true);
    const trash = await alphaM('GET', '/drive?view=trash');
    assert.ok(trash.body.documents.some((d: { id: string }) => d.id === up.body.id));
    assert.equal((await alphaM('POST', `/documents/${up.body.id}/restore`)).status, 201);
    assert.equal((await alphaM('GET', `/drive/documents/${up.body.id}`)).body.trashedAt, null);

    await alphaC('POST', `/documents/${up.body.id}/status`, { status: 'verified' });
    assert.equal((await alphaS('DELETE', `/documents/${up.body.id}`)).status, 403);
  });

  test('the trash is emptied after the retention period: bytes gone, record kept', async () => {
    const up = await upload('alphaClient', '/drive/upload', { typeKey: 'other' }, { name: 'old.pdf', type: 'application/pdf', bytes: pdf('old') });
    await alphaS('DELETE', `/documents/${up.body.id}`);
    await db()
      .update(schema.documents)
      .set({ trashedAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(schema.documents.id, up.body.id));
    const { RemindersService } = require('../src/reminders/reminders.service') as typeof import('../src/reminders/reminders.service');
    const ran = await appGet<InstanceType<typeof RemindersService>>(RemindersService).run('trash-purge');
    assert.ok(ran['trash-purge']! >= 1);
    const [row] = await db().select().from(schema.documents).where(eq(schema.documents.id, up.body.id));
    assert.ok(row!.deletedAt, 'marked deleted');
    assert.ok(!fs.existsSync(path.join(process.env.STORAGE_LOCAL_DIR!, row!.fileKey)), 'bytes removed');
  });
});

describe('organising', () => {
  test('rename keeps the extension; move and copy stay with the student; tags and stars', async () => {
    const up = await upload('alphaClient', '/drive/upload', { typeKey: 'sop' }, { name: 'sop draft.pdf', type: 'application/pdf', bytes: pdf('sop') });
    const renamed = await alphaC('PATCH', `/drive/documents/${up.body.id}`, { fileName: 'Statement of Purpose', tags: ['final', 'UK'] });
    assert.equal(renamed.body.fileName, 'Statement of Purpose.pdf');
    assert.deepEqual(renamed.body.tags, ['final', 'UK']);

    const otherFolder = await folderOf(alphaC, fx.alpha.clientId, 'other');
    const moved = await alphaC('PATCH', `/drive/documents/${up.body.id}`, { folderId: otherFolder });
    assert.equal(moved.body.folderId, otherFolder);
    const copy = await alphaC('POST', `/drive/documents/${up.body.id}/copy`, { folderId: await folderOf(alphaC, fx.alpha.clientId, 'application') });
    assert.equal(copy.status, 201);
    assert.notEqual(copy.body.id, up.body.id);

    assert.equal((await alphaC('POST', '/drive/star', { itemType: 'document', itemId: up.body.id, starred: true })).status, 204);
    const starred = await alphaC('GET', '/drive?view=starred');
    assert.ok(starred.body.documents.some((d: { id: string }) => d.id === up.body.id));
    const managerStars = await alphaM('GET', '/drive?view=starred');
    assert.ok(!managerStars.body.documents.some((d: { id: string }) => d.id === up.body.id), 'stars are personal');

    const tagged = await alphaC('GET', '/drive?view=all&tag=final');
    assert.ok(tagged.body.documents.some((d: { id: string }) => d.id === up.body.id));
    const searched = await alphaC('GET', `/drive?view=all&q=${encodeURIComponent('Statement of')}`);
    assert.ok(searched.body.documents.some((d: { id: string }) => d.id === up.body.id));
  });

  test('bulk approve reports each document, and a folder trashes and restores with its contents', async () => {
    const a = await upload('alphaClient', '/drive/upload', { typeKey: 'transcript' }, { name: 't1.pdf', type: 'application/pdf', bytes: pdf('t1') });
    const b = await upload('alphaClient', '/drive/upload', { typeKey: 'transcript' }, { name: 't2.pdf', type: 'application/pdf', bytes: pdf('t2') });
    const res = await alphaC('POST', '/drive/bulk', { action: 'approve', documentIds: [a.body.id, b.body.id, fx.bravo.documentId] });
    assert.equal(res.body.done, 2);
    assert.equal(res.body.failed.length, 1, 'the other consultancy’s document is refused, the rest go through');

    const folder = await alphaC('POST', '/drive/folders', { clientId: fx.alpha.clientId, name: 'Scholarship' });
    const inner = await upload('alphaConsultant', '/drive/upload', { folderId: folder.body.id }, { name: 'award.pdf', type: 'application/pdf', bytes: pdf('award') });
    assert.equal((await alphaC('POST', `/drive/folders/${folder.body.id}/trash`)).status, 204);
    assert.ok((await alphaC('GET', `/drive/documents/${inner.body.id}`)).body.trashedAt, 'its document went with it');
    assert.equal((await alphaC('POST', `/drive/folders/${folder.body.id}/restore`)).status, 204);
    assert.equal((await alphaC('GET', `/drive/documents/${inner.body.id}`)).body.trashedAt, null);

    // Once it holds an approved document, the folder is no easier to remove
    // than the document itself: only a manager can.
    await alphaC('POST', `/documents/${inner.body.id}/status`, { status: 'verified' });
    assert.equal((await alphaC('POST', `/drive/folders/${folder.body.id}/trash`)).status, 403);
    assert.equal((await alphaM('POST', `/drive/folders/${folder.body.id}/trash`)).status, 204);

    const builtIn = await folderOf(alphaC, fx.alpha.clientId, 'passport');
    assert.equal((await alphaC('POST', `/drive/folders/${builtIn}/trash`)).status, 400, 'built-in folders stay');
  });

  test('download renamed by the pattern, and many as one ZIP', async () => {
    const one = await alphaC('GET', `/documents/${fx.alpha.documentId}/download`);
    assert.equal(one.status, 200);
    assert.match(one.headers.get('content-disposition')!, /attachment; filename="alpha_student_Passport\.pdf"/);

    const zip = await alphaC('GET', `/drive/zip?folderId=${await folderOf(alphaC, fx.alpha.clientId, 'passport')}`);
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    assert.equal(zip.raw.subarray(0, 2).toString('ascii'), 'PK');
    assert.ok(zip.raw.includes(Buffer.from('alpha_student_Passport.pdf')));
  });
});

describe('sharing outside', () => {
  test('needs the permission; the link needs its password, locks after five wrong ones, and logs everything', async () => {
    const denied = await alphaC('POST', '/drive/shares', { documentId: fx.alpha.documentId, label: 'Leeds admissions', expiresInDays: 7 });
    assert.equal(denied.status, 403);
    await setPermission('alpha', 'document.share', 'allow');

    const made = await alphaC('POST', '/drive/shares', {
      documentId: fx.alpha.documentId,
      label: 'Leeds admissions',
      expiresInDays: 7,
      password: 'leeds-2026',
      viewOnly: true,
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const token = made.body.token as string;
    const pub = (method: string, url: string, json?: unknown, host: string = HOST.alpha) => call(method, url, { host, json });

    const locked = await pub('GET', `/share/${token}`);
    assert.equal(locked.status, 200);
    assert.equal(locked.body.needsPassword, true);
    assert.equal(locked.body.items, null);
    assert.equal((await pub('GET', `/share/${token}/files/${fx.alpha.documentId}`)).status, 401);
    assert.equal((await pub('GET', `/share/${token}`, undefined, HOST.bravo)).status, 404, 'not on another consultancy’s address');

    for (let i = 0; i < 5; i++) assert.equal((await pub('POST', `/share/${token}/unlock`, { password: 'wrong' })).status, 401);
    assert.equal((await pub('POST', `/share/${token}/unlock`, { password: 'leeds-2026' })).status, 429, 'locked after five');
    await db().update(schema.shareLinks).set({ lockedUntil: null }).where(eq(schema.shareLinks.id, made.body.id));

    const ok = await pub('POST', `/share/${token}/unlock`, { password: 'leeds-2026' });
    assert.equal(ok.status, 201);
    const access = ok.body.access as string;
    const open = await pub('GET', `/share/${token}?access=${access}`);
    assert.equal(open.body.items.length, 1);
    const file = await pub('GET', `/share/${token}/files/${fx.alpha.documentId}?access=${access}&download=1`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-disposition')!, /^inline/, 'view-only never downloads');
    assert.equal((await pub('GET', `/share/${token}/files/${fx.bravo.documentId}?access=${access}`)).status, 404);

    const log = await alphaC('GET', `/drive/shares/${made.body.id}/access`);
    const actions = log.body.map((l: { action: string }) => l.action);
    assert.equal(actions.filter((a: string) => a === 'denied_password').length, 5);
    assert.ok(actions.includes('view'));

    assert.equal((await alphaC('POST', `/drive/shares/${made.body.id}/revoke`)).status, 204);
    assert.equal((await pub('GET', `/share/${token}`)).status, 410);
    await setPermission('alpha', 'document.share', 'inherit');
  });

  test('a folder link opens what is in it, and nothing else', async () => {
    await setPermission('alpha', 'document.share', 'allow');
    const folder = await folderOf(alphaC, fx.alpha.clientId, 'passport');
    const made = await alphaC('POST', '/drive/shares', { folderId: folder, label: 'Visa agent', expiresInDays: 1 });
    const view = await call('GET', `/share/${made.body.token}`, { host: HOST.alpha });
    assert.equal(view.body.needsPassword, false);
    const ids = view.body.items.map((i: { id: string }) => i.id);
    assert.ok(ids.includes(fx.alpha.documentId), 'the passport is in it');
    assert.ok(!ids.includes(fx.bravo.documentId));
    const passportFolderDocs = (await alphaC('GET', `/drive?folderId=${folder}`)).body.documents.map((d: { id: string }) => d.id);
    assert.deepEqual([...ids].sort(), [...passportFolderDocs].sort(), 'exactly the folder’s documents');
    const dl = await call('GET', `/share/${made.body.token}/files/${fx.alpha.documentId}?download=1`, { host: HOST.alpha });
    assert.match(dl.headers.get('content-disposition')!, /^attachment/);
    await setPermission('alpha', 'document.share', 'inherit');
  });
});

describe('uploads', () => {
  test('a large file goes up in chunks, survives a resent chunk, and lands like any other upload', async () => {
    const bytes = Buffer.concat([pdf('chunked'), Buffer.alloc(2 * 1024 * 1024 + 100, 0x20)]);
    const start = await alphaS('POST', '/drive/uploads', { fileName: 'big-transcript.pdf', size: bytes.length, typeKey: 'transcript' });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    const put = (offset: number, part: Buffer) =>
      rawRequest('alphaClient', 'PUT', `/drive/uploads/${start.body.id}?offset=${offset}`, part, 'application/octet-stream');
    const size = start.body.chunkSize as number;
    const first = await put(0, bytes.subarray(0, size));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.received, size);
    const again = await put(0, bytes.subarray(0, size));
    assert.equal(again.body.received, size, 'a resent chunk changes nothing');
    const wrongPlace = await put(size + 10, bytes.subarray(size + 10, size + 20));
    assert.equal(wrongPlace.status, 400);
    assert.equal((await put(size, bytes.subarray(size))).body.received, bytes.length);
    const done = await alphaS('POST', `/drive/uploads/${start.body.id}/complete`);
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.fileSize, bytes.length);
    assert.equal(done.body.typeKey, 'transcript');
    assert.equal((await bravoM('GET', `/drive/uploads/${start.body.id}`)).status, 404);
  });

  test('the consultancy’s own rules: file types and size', async () => {
    const before = await alphaM('GET', '/drive/settings');
    const narrowed = await alphaM('PUT', '/drive/settings', { ...before.body, acceptedTypes: ['pdf'], maxFileMb: 1 });
    assert.equal(narrowed.status, 200, JSON.stringify(narrowed.body));
    const pngUp = await upload('alphaClient', '/drive/upload', {}, { name: 'photo.png', type: 'image/png', bytes: png() });
    assert.equal(pngUp.status, 400);
    assert.match(pngUp.body.message, /Only PDF/);
    const big = await upload('alphaClient', '/drive/upload', {}, { name: 'big.pdf', type: 'application/pdf', bytes: Buffer.concat([pdf('x'), Buffer.alloc(1_100_000)]) });
    assert.equal(big.status, 400);
    assert.equal((await alphaC('PUT', '/drive/settings', before.body)).status, 403, 'a consultant cannot change them');
    await alphaM('PUT', '/drive/settings', before.body);
  });
});

describe('reminders and checklists', () => {
  test('an expiring passport is reminded once per window, to the student and their consultant', async () => {
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const up = await upload('alphaClient', '/drive/upload', { typeKey: 'passport', expiresOn: soon }, { name: 'new-passport.pdf', type: 'application/pdf', bytes: pdf('pp-new') });
    assert.equal(up.body.expiresOn, soon);
    assert.ok(up.body.daysToExpiry >= 19 && up.body.daysToExpiry <= 20);
    const { RemindersService } = require('../src/reminders/reminders.service') as typeof import('../src/reminders/reminders.service');
    const reminders = appGet<InstanceType<typeof RemindersService>>(RemindersService);
    const first = await reminders.run('document-expiry');
    assert.ok(first['document-expiry']! >= 1);
    const second = await reminders.run('document-expiry');
    assert.equal(second['document-expiry'], 0, 'never twice for the same window');

    const notes = await db().select().from(schema.notifications).where(eq(schema.notifications.type, 'document_expiring'));
    const users = new Set(notes.map((n) => n.userId));
    assert.ok(users.has(fx.alpha.clientUserId) && users.has(fx.alpha.consultantUserId));
    const expiring = await alphaC('GET', '/drive?view=expiring');
    assert.ok(expiring.body.documents.some((d: { id: string }) => d.id === up.body.id));

    // Soonest to run out comes first unless another order is asked for.
    const later = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    await upload('alphaClient', '/drive/upload', { typeKey: 'language_test', expiresOn: later }, { name: 'ielts.pdf', type: 'application/pdf', bytes: pdf('ielts-later') });
    const ordered = await alphaC('GET', '/drive?view=expiring');
    const dates = ordered.body.documents.map((d: { expiresOn: string }) => d.expiresOn);
    assert.deepEqual(dates, [...dates].sort(), 'soonest first');
    const newest = await alphaC('GET', '/drive?view=expiring&sort=newest');
    assert.equal(newest.body.documents[0].fileName, 'ielts.pdf');
  });

  test('the checklist follows the most specific set for the application, and counts approved documents', async () => {
    const set = await alphaM('POST', '/drive/checklists', {
      name: 'UK student visa',
      country: 'United Kingdom',
      items: [
        { typeKey: 'passport', required: true },
        { typeKey: 'transcript', required: true },
        { typeKey: 'cv', required: false },
      ],
    });
    assert.equal(set.status, 201, JSON.stringify(set.body));
    const c = await alphaC('GET', `/drive/students/${fx.alpha.clientId}/checklist`);
    assert.equal(c.status, 200);
    const app = c.body.applications.find((a: { caseId: string }) => a.caseId === fx.alpha.caseId);
    assert.equal(app.setName, 'UK student visa');
    assert.equal(app.required, 2);
    assert.ok(app.items.find((i: { typeKey: string }) => i.typeKey === 'transcript').status === 'verified');
    assert.equal((await alphaS('GET', '/drive/checklist')).body.clientId, fx.alpha.clientId);
    assert.equal((await bravoM('POST', `/drive/checklists`, { name: 'x', items: [{ typeKey: 'nope_type' }] })).status, 400);
  });
});
