/**
 * Foundations the modules stand on: staff roles, the partner role's closed
 * door, files encrypted at rest, Word uploads, the virus scanner and email.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  HOST,
  OUTBOX,
  PASSWORD,
  appGet,
  as,
  call as request,
  db,
  fx,
  giveRole,
  pdf,
  schema,
  setPermission,
  signIn,
  startApp,
  stopApp,
  upload,
} from './harness';

before(startApp);
after(stopApp);

const me = async (who: Parameters<typeof as>[0]) => (await as(who)('GET', '/auth/me')).body.user;

describe('staff roles', () => {
  test('every consultancy starts with its own roles, and cannot see or touch another’s', async () => {
    const alpha = await as('alphaManager')('GET', '/team/roles');
    assert.equal(alpha.status, 200);
    assert.deepEqual(
      alpha.body.map((r: { systemKey: string }) => r.systemKey).sort(),
      ['accountant', 'counsellor', 'partner_manager', 'senior', 'trainer'],
    );
    const bravoIds = new Set(((await as('bravoManager')('GET', '/team/roles')).body as { id: string }[]).map((r) => r.id));
    assert.ok(alpha.body.every((r: { id: string }) => !bravoIds.has(r.id)), 'no role is shared');

    const hijack = await as('bravoManager')('PATCH', `/team/roles/${fx.alpha.roles.accountant}`, {
      name: 'Hijacked',
      effects: {},
      takesClients: true,
    });
    assert.equal(hijack.status, 404);
    const assignAcross = await as('bravoManager')('PUT', `/team/${fx.bravo.consultantUserId}/role`, {
      roleId: fx.alpha.roles.accountant,
    });
    assert.equal(assignAcross.status, 404, 'a role from another consultancy cannot be given');
  });

  test('a role changes what someone can do on their next request; their own override still wins', async () => {
    const before = await me('alphaConsultant');
    assert.ok(before.permissions.includes('case.move'));
    assert.ok(!before.permissions.includes('billing.verify'));
    assert.equal(before.roleTitle, null);

    await giveRole('alpha', 'accountant');
    const accountant = await me('alphaConsultant');
    assert.equal(accountant.roleTitle, 'Accountant');
    assert.ok(accountant.permissions.includes('billing.verify'));
    assert.ok(accountant.permissions.includes('finance.ledger'));
    assert.ok(!accountant.permissions.includes('case.move'), 'the role denies moving applications');

    // Refused by the API, not just hidden: moving a case is now forbidden.
    const move = await as('alphaConsultant')('POST', `/cases/${fx.alpha.caseId}/stage`, {
      stage: 'application_submitted',
      reason: 'Trying to move it anyway',
    });
    assert.equal(move.status, 403);
    assert.equal(move.body.code, 'PERMISSION_DENIED');

    await setPermission('alpha', 'case.move', 'allow');
    assert.ok((await me('alphaConsultant')).permissions.includes('case.move'), 'own override beats the role');
    await setPermission('alpha', 'case.move', 'inherit');

    const view = await as('alphaManager')('GET', `/team/${fx.alpha.consultantUserId}/permissions`);
    assert.equal(view.body.roleName, 'Accountant');
    const row = view.body.rows.find((r: { key: string }) => r.key === 'billing.verify');
    assert.deepEqual([row.allowed, row.source], [true, 'role']);

    await giveRole('alpha', null);
    assert.ok((await me('alphaConsultant')).permissions.includes('case.move'), 'back to the defaults');
  });

  test('only a manager hands out roles', async () => {
    await setPermission('alpha', 'staff.manage', 'allow');
    const create = await as('alphaConsultant')('POST', '/consultants', {
      fullName: 'Self Promoted',
      email: 'promoted@alpha.test',
      password: PASSWORD,
      roleId: fx.alpha.roles.senior,
    });
    assert.equal(create.status, 403);
    for (const [method, url] of [
      ['GET', '/team/roles'],
      ['POST', '/team/roles'],
      ['PUT', `/team/${fx.alpha.consultantUserId}/role`],
    ] as const) {
      const r = await as('alphaConsultant')(method, url, { name: 'x', effects: {}, takesClients: true, roleId: null });
      assert.equal(r.status, 403, `${method} ${url}`);
    }
    await setPermission('alpha', 'staff.manage', 'inherit');
  });

  test('roles with no caseload are never offered for students, and the API refuses the assignment', async () => {
    const created = await as('alphaManager')('POST', '/consultants', {
      fullName: 'Amna Accounts',
      email: 'amna@alpha.test',
      password: PASSWORD,
      roleId: fx.alpha.roles.accountant,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.takesClients, false);
    assert.equal(created.body.roleTitle, 'Accountant');
    const accountantRole = (await as('alphaManager')('GET', '/team/roles')).body.find((r: { systemKey: string }) => r.systemKey === 'accountant');
    assert.equal(accountantRole.members, 1, 'the role counts its members');

    const assignable = await as('alphaManager')('GET', '/consultants');
    assert.ok(!assignable.body.some((c: { id: string }) => c.id === created.body.id), 'not in the assignment list');
    const team = await as('alphaManager')('GET', '/consultants?includeInactive=true');
    assert.ok(team.body.some((c: { id: string }) => c.id === created.body.id), 'still on the team page');

    const assign = await as('alphaManager')('POST', '/clients', {
      fullName: 'Student For Accountant',
      email: 'sfa@example.com',
      phone: '+92 300 1111111',
      assignedConsultantId: created.body.id,
    });
    assert.equal(assign.status, 400);
    assert.match(assign.body.message, /does not take clients/);
  });

  test('a duplicate role name is a field error, not a crash', async () => {
    const r = await as('alphaManager')('POST', '/team/roles', { name: 'accountant', effects: {}, takesClients: false });
    assert.equal(r.status, 400);
    assert.ok(r.body.fieldErrors.name);
  });
});

describe('the partner role', () => {
  test('is refused everything not built for partners, but can manage its own account', async () => {
    const { hash } = require('bcryptjs') as typeof import('bcryptjs');
    await db()
      .insert(schema.users)
      .values({
        tenantId: fx.alpha.id,
        email: 'agent@partner.test',
        passwordHash: await hash(PASSWORD, 4),
        fullName: 'Agent Partner',
        role: 'partner',
      });
    const partner = await signIn(HOST.alpha, 'agent@partner.test');
    const call = (method: string, url: string) => request(method, url, { host: HOST.alpha, session: partner });
    for (const url of ['/clients', `/clients/${fx.alpha.clientId}`, `/cases/${fx.alpha.caseId}`, '/documents', '/billing/invoices', '/consultants', '/tasks', '/messages/threads']) {
      const r = await call('GET', url);
      assert.equal(r.status, 403, `${url} must be closed to partners`);
    }
    const whoami = await call('GET', '/auth/me');
    assert.equal(whoami.status, 200);
    assert.equal(whoami.body.user.role, 'partner');
    assert.deepEqual(whoami.body.user.permissions, []);
    assert.equal((await call('GET', '/notifications')).status, 200);
  });
});

describe('files at rest', () => {
  test('an upload is encrypted on disk and comes back exactly as sent', async () => {
    const bytes = pdf('encrypted-at-rest');
    const up = await upload('alphaClient', '/documents', { caseId: fx.alpha.caseId, type: 'transcript' }, {
      name: 'transcript.pdf',
      type: 'application/pdf',
      bytes,
    });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const [row] = await db().select().from(schema.documents).where(eq(schema.documents.id, up.body.id));
    const onDisk = fs.readFileSync(path.join(process.env.STORAGE_LOCAL_DIR!, row!.fileKey));
    assert.equal(onDisk.subarray(0, 8).toString('ascii'), 'CRMENC01', 'stored encrypted');
    assert.ok(!onDisk.includes(Buffer.from('encrypted-at-rest')), 'the content is not readable on disk');

    const back = await as('alphaConsultant')('GET', `/documents/${up.body.id}/file`);
    assert.equal(back.status, 200);
    assert.deepEqual(back.raw, bytes);
  });

  test('files written before encryption still open', async () => {
    const back = await as('alphaManager')('GET', `/documents/${fx.alpha.documentId}/file`);
    assert.equal(back.status, 200);
    assert.match(back.raw.toString('utf8'), /fixture passport/);
  });

  test('Word documents are accepted by their contents; a renamed archive is not', async () => {
    const docx = fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/sample.docx'));
    const ok = await upload('alphaClient', '/documents', { caseId: fx.alpha.caseId, type: 'sop' }, {
      name: 'statement.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docx,
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.match(ok.body.fileName, /\.docx$/);

    const zipOnly = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]);
    const bad = await upload('alphaClient', '/documents', { caseId: fx.alpha.caseId, type: 'sop' }, {
      name: 'statement.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: zipOnly,
    });
    assert.equal(bad.status, 400);
  });
});

describe('the virus scanner', () => {
  function fakeClamd(answer: (body: Buffer) => string): Promise<{ port: number; close: () => void }> {
    return new Promise((resolve) => {
      const server = net.createServer((socket) => {
        const chunks: Buffer[] = [];
        socket.on('data', (d) => {
          chunks.push(d);
          const all = Buffer.concat(chunks);
          if (all.length >= 14 && all.subarray(-4).equals(Buffer.alloc(4))) {
            socket.end(`stream: ${answer(all)}\0`);
          }
        });
      });
      server.listen(0, '127.0.0.1', () =>
        resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() }),
      );
    });
  }

  test('speaks clamd’s INSTREAM protocol: clean, infected, and unreachable', async () => {
    const { scanWithClamd } = require('../src/storage/virus-scan') as typeof import('../src/storage/virus-scan');
    const clamd = await fakeClamd((body) => (body.includes(Buffer.from('EICAR')) ? 'Eicar-Test-Signature FOUND' : 'OK'));
    try {
      assert.deepEqual(await scanWithClamd(Buffer.from('a harmless file'), '127.0.0.1', clamd.port), { clean: true });
      assert.deepEqual(await scanWithClamd(Buffer.from('X5O!P%@AP EICAR test'), '127.0.0.1', clamd.port), {
        clean: false,
        signature: 'Eicar-Test-Signature',
      });
    } finally {
      clamd.close();
    }
    await assert.rejects(scanWithClamd(Buffer.from('x'), '127.0.0.1', 1, 2_000));
  });
});

describe('email', () => {
  test('a message is written to the outbox as a real email, attachment and all', async () => {
    const { MailService } = require('../src/mail/mail.service') as typeof import('../src/mail/mail.service');
    const sent = await appGet<InstanceType<typeof MailService>>(MailService).send({
      to: 'student@example.com',
      subject: 'Your receipt',
      text: 'Thank you for your payment.',
      fromName: 'Alpha Consultancy',
      attachments: [{ filename: 'receipt.pdf', content: pdf('receipt'), contentType: 'application/pdf' }],
    });
    assert.equal(sent, true);
    const files = fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.eml'));
    const eml = fs.readFileSync(path.join(OUTBOX, files.at(-1)!), 'utf8');
    assert.match(eml, /Subject: Your receipt/);
    assert.match(eml, /From: Alpha Consultancy/);
    assert.match(eml, /filename=receipt\.pdf/);
  });
});
