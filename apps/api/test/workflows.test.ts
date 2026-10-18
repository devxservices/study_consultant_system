/**
 * Countries, workflows and automations: the Standard workflow behaving
 * exactly like the fixed pipeline it replaces, a country workflow with its
 * own stages, gates, tasks, fees and messages, versions that never change
 * under a running application, automations with a run log and a loop
 * guard - each tried from the other consultancy and without the permission.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { OUTBOX, as, db, fx, pdf, schema, setPermission, startApp, stopApp, upload } from './harness';

const shared = require('@crm/shared') as typeof import('@crm/shared');

before(startApp);
after(stopApp);

const alphaM = as('alphaManager');
const alphaC = as('alphaConsultant');
const alphaS = as('alphaClient');
const bravoM = as('bravoManager');

const CANADA = [
  {
    key: 'consultation',
    name: 'Consultation',
    clientLabel: 'Getting started',
    category: 'inquiry',
    slaDays: 5,
    tasks: [{ title: 'Call {student} to plan the application', dueInDays: 1 }],
  },
  {
    key: 'documents',
    name: 'Documents',
    clientLabel: 'Your documents',
    category: 'documents_collection',
    requiredDocuments: ['passport', 'transcript'],
    messages: [
      {
        audience: 'student',
        channels: ['in_app', 'email'],
        subject: 'Send us your documents, {first_name}',
        body: 'Hi {student}, please upload your passport and transcript for {reference}.',
      },
    ],
  },
  { key: 'sop_review', name: 'SOP review', clientLabel: 'Reviewing your SOP', category: 'documents_collection', requiredDocuments: ['sop'], approvalRequired: true },
  { key: 'applied', name: 'Applied', clientLabel: 'Applied', category: 'application_submitted', movableBy: 'managers' },
  {
    key: 'gic',
    name: 'GIC and medicals',
    clientLabel: 'GIC and medicals',
    category: 'fee_payment',
    slaDays: 1,
    fees: [{ label: 'Visa filing fee', amount: 1_500_000, currency: 'PKR', mode: 'task' }],
  },
  { key: 'biometrics', name: 'Biometrics', clientLabel: 'Biometrics', category: 'visa_filed', conditions: [{ field: 'studyLevel', op: 'is', value: 'master' }] },
  { key: 'decision', name: 'Decision', clientLabel: 'Decision', category: 'visa_decision' },
  { key: 'done', name: 'Done', clientLabel: 'All done', category: 'closed' },
];

let canadaId = '';
let canadaCaseId = '';

async function newCase(country: string, extra: Record<string, unknown> = {}) {
  const r = await alphaC('POST', '/cases', { clientId: fx.alpha.clientId, targetCountry: country, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

async function caseOf(id: string, who = alphaC) {
  const r = await who('GET', `/cases/${id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

async function approvedDoc(caseId: string, typeKey: string) {
  const up = await upload('alphaClient', '/drive/upload', { caseId, typeKey }, { name: `${typeKey}.pdf`, type: 'application/pdf', bytes: pdf(`${typeKey}-${caseId}`) });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const v = await alphaC('POST', `/documents/${up.body.id}/status`, { status: 'verified' });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  return up.body.id as string;
}

describe('the Standard workflow', () => {
  test('every consultancy has one, and the existing application runs on it at the stage it was at', async () => {
    for (const who of [alphaM, bravoM]) {
      const list = await who('GET', '/workflows');
      assert.equal(list.status, 200);
      const standard = list.body.find((w: { isDefault: boolean }) => w.isDefault);
      assert.equal(standard.name, 'Standard');
      assert.equal(standard.current.stageCount, 10);
    }
    const k = await caseOf(fx.alpha.caseId);
    assert.equal(k.currentStage, 'documents_collection');
    assert.equal(k.currentStageKey, 'documents_collection', 'filled for an application written the original way');
    assert.equal(k.currentStageName, 'Documents Collection');
    assert.equal(k.workflow.templateName, 'Standard');
    assert.equal(k.workflow.stages.length, 10);
    assert.equal(k.workflow.stages.find((s: { key: string }) => s.key === 'visa_interview').applies, false, 'no interview for the UK');
    assert.equal(k.history[0].stageKey, 'documents_collection');
    assert.deepEqual(k.progress.items.map((i: { type: string }) => i.type), ['passport', 'cnic', 'transcript', 'language_test', 'bank_statement', 'sop']);
  });

  test('moves exactly like the fixed pipeline: same allowed moves, same reasons required', () => {
    const stages = shared.STANDARD_WORKFLOW_STAGES;
    for (const country of ['United Kingdom', 'United States', 'USA', 'US', 'Canada', null]) {
      for (const from of shared.STAGES) {
        for (const to of shared.STAGES) {
          const old = shared.checkStageTransition(from, to, country);
          const now = shared.checkWorkflowTransition(stages, from, to, { targetCountry: country });
          assert.equal(now.allowed, old.allowed, `${from}->${to} (${country}) allowed`);
          assert.equal(now.kind, old.kind, `${from}->${to} (${country}) kind`);
          assert.equal(now.requiresReason, old.requiresReason, `${from}->${to} (${country}) reason`);
        }
        assert.equal(shared.nextStageKey(stages, from, { targetCountry: country }), shared.nextApplicableStage(from, country), `next after ${from} (${country})`);
      }
    }
  });

  test('a new application without a matching workflow starts on Standard, and moves and advances as before', async () => {
    const id = await newCase('Australia');
    let k = await caseOf(id);
    assert.equal(k.workflow.templateName, 'Standard');
    assert.equal(k.currentStageKey, 'inquiry');

    const skip = await alphaC('POST', `/cases/${id}/stage`, { stage: 'documents_collection' });
    assert.equal(skip.status, 400, 'skipping needs a reason');
    const next = await alphaC('POST', `/cases/${id}/stage`, { stage: 'shortlisting' });
    assert.equal(next.status, 201, JSON.stringify(next.body));
    const by = await alphaC('POST', `/cases/${id}/stage`, { stageKey: 'documents_collection' });
    assert.equal(by.status, 201, 'by stage key too');

    for (const t of ['passport', 'cnic', 'transcript', 'language_test', 'bank_statement', 'sop']) await approvedDoc(id, t);
    k = await caseOf(id);
    assert.equal(k.currentStage, 'application_submitted', 'auto-advanced once the checklist was complete');
    assert.equal(k.history[0].method, 'auto');
  });

  test('cannot be archived or aimed at one country', async () => {
    const list = await alphaM('GET', '/workflows');
    const standard = list.body.find((w: { isDefault: boolean }) => w.isDefault);
    assert.equal((await alphaM('POST', `/workflows/${standard.id}/archive`)).status, 400);
    assert.equal((await alphaM('PATCH', `/workflows/${standard.id}`, { name: 'Standard', country: 'Canada' })).status, 400);
  });
});

describe('building a country workflow', () => {
  test('starts as a draft copy of Standard; a bad draft is refused with the reason', async () => {
    const created = await alphaM('POST', '/workflows', { name: 'Canada study permit', country: 'Canada' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    canadaId = created.body.id;
    assert.equal(created.body.current, null, 'nothing published yet');
    assert.equal(created.body.draftStages.length, 10);

    const decreasing = [...CANADA];
    decreasing.splice(1, 0, { key: 'late', name: 'Late', clientLabel: 'Late', category: 'visa_decision' } as never);
    const bad = await alphaM('PUT', `/workflows/${canadaId}/draft`, { stages: decreasing });
    assert.equal(bad.status, 400, 'a stage cannot be an earlier step than the one before it');

    const noEnd = await alphaM('PUT', `/workflows/${canadaId}/draft`, { stages: CANADA.slice(0, -1) });
    assert.equal(noEnd.status, 400, 'the last stage closes the application');

    const dupe = await alphaM('PUT', `/workflows/${canadaId}/draft`, { stages: [CANADA[0], { ...CANADA[1], key: 'consultation' }, CANADA[7]] });
    assert.equal(dupe.status, 400, 'keys are unique');

    const unknownDoc = await alphaM('PUT', `/workflows/${canadaId}/draft`, { stages: CANADA.map((s) => (s.key === 'documents' ? { ...s, requiredDocuments: ['gic_certificate'] } : s)) });
    assert.equal(unknownDoc.status, 400);
    assert.match(unknownDoc.body.message, /gic_certificate/);

    const ok = await alphaM('PUT', `/workflows/${canadaId}/draft`, { stages: CANADA, notes: 'First version' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.draftStages.length, 8);
  });

  test('applications cannot use it until it is published', async () => {
    const r = await alphaC('POST', '/cases', { clientId: fx.alpha.clientId, targetCountry: 'Canada', workflowId: canadaId });
    assert.equal(r.status, 400);
    const pub = await alphaM('POST', `/workflows/${canadaId}/publish`, {});
    assert.equal(pub.status, 201, JSON.stringify(pub.body));
    assert.equal(pub.body.current.version, 1);
    assert.equal(pub.body.draft, null);
  });

  test('a new Canada application picks it, starts at its first stage, and the stage’s task is created', async () => {
    canadaCaseId = await newCase('canada');
    const k = await caseOf(canadaCaseId);
    assert.equal(k.workflow.templateName, 'Canada study permit', 'matched however the country was typed');
    assert.equal(k.currentStageKey, 'consultation');
    assert.equal(k.currentStage, 'inquiry');
    assert.equal(k.stageSlaDays, 5);
    assert.equal(k.workflow.stages.find((s: { key: string }) => s.key === 'biometrics').applies, false);

    const tasks = await alphaC('GET', '/tasks?view=open');
    assert.ok(tasks.body.items.some((t: { title: string; caseId: string }) => t.title === 'Call alpha student to plan the application' && t.caseId === canadaCaseId));
    const runs = await alphaM('GET', '/automations/runs');
    assert.ok(runs.body.items.some((r: { caseId: string; status: string }) => r.caseId === canadaCaseId && r.status === 'done'), 'the stage’s actions are in the run log');
  });

  test('entering a stage sends its message; the checklist is the stage’s own and advances it', async () => {
    const moved = await alphaC('POST', `/cases/${canadaCaseId}/stage`, { stageKey: 'documents' });
    assert.equal(moved.status, 201, JSON.stringify(moved.body));
    const mails = fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.eml')).map((f) => fs.readFileSync(path.join(OUTBOX, f), 'utf8'));
    assert.ok(mails.some((m) => m.includes('Send us your documents, alpha')), 'the student was emailed with their name filled in');
    assert.deepEqual(moved.body.progress.items.map((i: { type: string }) => i.type), ['passport', 'transcript']);

    await approvedDoc(canadaCaseId, 'passport');
    await approvedDoc(canadaCaseId, 'transcript');
    const k = await caseOf(canadaCaseId);
    assert.equal(k.currentStageKey, 'sop_review', 'moved on by itself');
  });

  test('an approval gate holds it until someone allowed signs it off', async () => {
    await approvedDoc(canadaCaseId, 'sop');
    let k = await caseOf(canadaCaseId);
    assert.equal(k.currentStageKey, 'sop_review', 'documents done, but not signed off');
    assert.equal(k.workflow.approval.required, true);

    const tryMove = await alphaC('POST', `/cases/${canadaCaseId}/stage`, { stageKey: 'applied' });
    assert.equal(tryMove.status, 403);
    assert.equal((await alphaC('POST', `/cases/${canadaCaseId}/approve`, {})).status, 403, 'a consultant cannot approve without the permission');

    const approved = await alphaM('POST', `/cases/${canadaCaseId}/approve`, { note: 'SOP reads well' });
    assert.equal(approved.status, 201, JSON.stringify(approved.body));
    assert.equal(approved.body.currentStageKey, 'applied', 'signed off, and the finished checklist moved it on');
    k = await caseOf(canadaCaseId);
    assert.ok(k.history.some((h: { stageKey: string; stageName: string }) => h.stageKey === 'sop_review' && h.stageName === 'SOP review'));
  });

  test('a managers-only stage refuses staff without the permission, and the stage fee becomes a task', async () => {
    const out = await alphaC('POST', `/cases/${canadaCaseId}/stage`, { stageKey: 'gic' });
    assert.equal(out.status, 403);
    assert.match(out.body.message, /Only managers/);

    await setPermission('alpha', 'case.approve', 'allow');
    const allowed = await alphaC('POST', `/cases/${canadaCaseId}/stage`, { stageKey: 'gic' });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
    await setPermission('alpha', 'case.approve', 'inherit');

    const tasks = await alphaC('GET', '/tasks?view=open');
    const fee = tasks.body.items.find((t: { title: string }) => t.title.startsWith('Collect fee: Visa filing fee'));
    assert.ok(fee, 'a task to collect the fee');
    assert.equal(fee.priority, 'high');
  });

  test('a stage that does not apply is skipped without needing a reason', async () => {
    const r = await alphaC('POST', `/cases/${canadaCaseId}/stage`, { stageKey: 'decision' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await alphaC('POST', `/cases/${canadaCaseId}/stage`, { stageKey: 'biometrics' })).status, 400, 'not for this application');
    const back = await alphaC('POST', `/cases/${canadaCaseId}/stage`, { stageKey: 'gic' });
    assert.equal(back.status, 400, 'going back needs a reason');
  });
});

describe('versions', () => {
  test('a published version’s stages cannot change, even from SQL', async () => {
    const detail = await alphaM('GET', `/workflows/${canadaId}`);
    const versionId = detail.body.current.versionId;
    await assert.rejects(
      db().update(schema.workflowStages).set({ name: 'Hacked' }).where(eq(schema.workflowStages.versionId, versionId)),
      (err: Error & { cause?: Error }) => /cannot change/.test(err.cause?.message ?? err.message),
    );
    await assert.rejects(db().delete(schema.workflowStages).where(eq(schema.workflowStages.versionId, versionId)));
  });

  test('publishing a new version leaves running applications alone unless asked to move them', async () => {
    const stillOnV1 = await newCase('Canada');
    const stages = CANADA.map((s) => (s.key === 'gic' ? { ...s, name: 'GIC, medicals and PAL', slaDays: 10 } : s));
    assert.equal((await alphaM('PUT', `/workflows/${canadaId}/draft`, { stages })).status, 200);
    const v2 = await alphaM('POST', `/workflows/${canadaId}/publish`, { notes: 'PAL added' });
    assert.equal(v2.status, 201);
    assert.equal(v2.body.current.version, 2);
    assert.equal(v2.body.upgraded, 0);

    let k = await caseOf(stillOnV1);
    assert.equal(k.workflow.version, 1);
    assert.deepEqual(k.workflow.newerVersion, { id: v2.body.current.versionId, version: 2 });
    assert.equal((await caseOf(newCaseIdHolder.id = await newCase('Canada'))).workflow.version, 2, 'new applications get the new version');

    // v3, this time moving every open application across.
    assert.equal((await alphaM('PUT', `/workflows/${canadaId}/draft`, { stages, notes: 'v3' })).status, 200);
    const v3 = await alphaM('POST', `/workflows/${canadaId}/publish`, { upgradeActive: true });
    assert.equal(v3.status, 201);
    assert.ok(v3.body.upgraded >= 3, `moved ${v3.body.upgraded}`);
    k = await caseOf(stillOnV1);
    assert.equal(k.workflow.version, 3);
    assert.equal(k.currentStageKey, 'consultation', 'kept its place');
    const moved = await caseOf(canadaCaseId);
    assert.equal(moved.workflow.version, 3);
    assert.equal(moved.currentStageKey, 'decision');

    const versions = (await alphaM('GET', `/workflows/${canadaId}`)).body.versions;
    assert.deepEqual(versions.map((v: { status: string }) => v.status), ['published', 'retired', 'retired']);
  });

  test('an application can be moved to another workflow, with a reason, landing on the same kind of step', async () => {
    const standardCase = await newCase('Germany');
    const canada = (await alphaM('GET', `/workflows/${canadaId}`)).body;
    assert.equal((await alphaC('POST', `/cases/${standardCase}/workflow`, { versionId: canada.current.versionId })).status, 400, 'needs a reason');
    const r = await alphaC('POST', `/cases/${standardCase}/workflow`, { versionId: canada.current.versionId, reason: 'Student switched to Canada' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.workflow.templateName, 'Canada study permit');
    assert.equal(r.body.currentStageKey, 'consultation', 'inquiry on Standard is consultation here');
    const retired = canada.versions.find((v: { status: string }) => v.status === 'retired');
    assert.equal((await alphaC('POST', `/cases/${standardCase}/workflow`, { versionId: retired.id, reason: 'Old version please' })).status, 400, 'only current versions');
  });
});

const newCaseIdHolder = { id: '' };

describe('automations', () => {
  test('run when their trigger and conditions match, and say what they did', async () => {
    const rule = await alphaM('POST', '/automations', {
      name: 'Chase the SOP',
      trigger: 'stage_entered',
      workflowId: canadaId,
      stageKey: 'documents',
      conditions: [{ field: 'targetCountry', op: 'in', value: ['Canada', 'CA'] }],
      actions: [
        { type: 'create_task', task: { title: 'Start the SOP draft for {student}', dueInDays: 3, priority: 'high' } },
        { type: 'notify', audience: 'managers', title: '{reference} is collecting documents' },
        { type: 'send_message', message: { audience: 'student', channels: ['sms', 'whatsapp'], subject: 'Documents', body: 'Upload them in your portal: {portal_link}' } },
      ],
    });
    assert.equal(rule.status, 201, JSON.stringify(rule.body));

    const id = await newCase('Canada');
    const moved = await alphaC('POST', `/cases/${id}/stage`, { stageKey: 'documents' });
    assert.equal(moved.status, 201);

    const runs = await alphaM('GET', `/automations/runs?ruleId=${rule.body.id}`);
    assert.equal(runs.body.items.length, 1);
    const run = runs.body.items[0];
    assert.equal(run.status, 'done', JSON.stringify(run.results));
    assert.equal(run.results.length, 3);
    assert.match(run.results[2].detail, /SMS \(1\).*WhatsApp \(1\)/);
    const tasks = await alphaC('GET', '/tasks?view=open');
    assert.ok(tasks.body.items.some((t: { title: string }) => t.title === 'Start the SOP draft for alpha student'));
    const after = await alphaM('GET', `/automations/${rule.body.id}`);
    assert.equal(after.body.runCount, 1);

    // Conditions that do not hold: nothing runs.
    const uk = await newCase('United Kingdom', { workflowId: canadaId });
    await alphaC('POST', `/cases/${uk}/stage`, { stageKey: 'documents' });
    assert.equal((await alphaM('GET', `/automations/runs?ruleId=${rule.body.id}`)).body.items.length, 1);
  });

  test('document triggers fire once per review, for the application the document is on', async () => {
    const rule = await alphaM('POST', '/automations', {
      name: 'Passport approved',
      trigger: 'document_approved',
      documentType: 'passport',
      actions: [{ type: 'notify', audience: 'consultant', title: 'Passport approved for {student}' }],
    });
    assert.equal(rule.status, 201, JSON.stringify(rule.body));
    const id = await newCase('Ireland');
    await approvedDoc(id, 'passport');
    await approvedDoc(id, 'transcript');
    const runs = await alphaM('GET', `/automations/runs?ruleId=${rule.body.id}`);
    assert.equal(runs.body.items.length, 1, 'only the passport');
  });

  test('automations that set each other off stop after three hops', async () => {
    const ping = await alphaM('POST', '/automations', {
      name: 'Ping',
      trigger: 'stage_entered',
      workflowId: canadaId,
      stageKey: 'decision',
      actions: [{ type: 'move_stage', stageKey: 'gic' }],
    });
    const pong = await alphaM('POST', '/automations', {
      name: 'Pong',
      trigger: 'stage_entered',
      workflowId: canadaId,
      stageKey: 'gic',
      actions: [{ type: 'move_stage', stageKey: 'decision' }],
    });
    assert.equal(ping.status, 201);
    assert.equal(pong.status, 201);
    const id = await newCase('Canada');
    await alphaM('POST', `/cases/${id}/stage`, { stageKey: 'decision', reason: 'Testing a loop of automations' });
    const runs = (await alphaM('GET', '/automations/runs?pageSize=100')).body.items.filter((r: { caseId: string; ruleName: string }) => r.caseId === id && ['Ping', 'Pong'].includes(r.ruleName));
    assert.ok(runs.length <= 4, `ran ${runs.length} times`);
    assert.ok(runs.some((r: { status: string }) => r.status === 'skipped'), 'the loop was stopped and says so');
    await alphaM('DELETE', `/automations/${ping.body.id}`);
    await alphaM('DELETE', `/automations/${pong.body.id}`);
    assert.ok((await alphaM('GET', '/automations')).body.every((r: { id: string }) => r.id !== ping.body.id), 'removed from the list');
  });

  test('a rule naming a stage its workflow does not have is refused', async () => {
    const r = await alphaM('POST', '/automations', { name: 'Wrong', trigger: 'stage_entered', workflowId: canadaId, stageKey: 'nope', actions: [{ type: 'set_status', status: 'on_hold' }] });
    assert.equal(r.status, 400);
  });
});

describe('the board and the numbers', () => {
  test('shows each stage as a column with its applications, oldest first', async () => {
    const board = await alphaM('GET', `/workflows/board?templateId=${canadaId}`);
    assert.equal(board.status, 200, JSON.stringify(board.body));
    assert.deepEqual(board.body.columns.map((c: { key: string }) => c.key), CANADA.map((s) => s.key));
    const consultation = board.body.columns.find((c: { key: string }) => c.key === 'consultation');
    assert.ok(consultation.total >= 1);
    assert.equal(consultation.cards.length, consultation.total);
    const limited = await alphaM('GET', `/workflows/board?templateId=${canadaId}&perColumn=1`);
    const col = limited.body.columns.find((c: { key: string }) => c.key === 'consultation');
    assert.equal(col.cards.length, 1);
    assert.equal(col.total, consultation.total, 'the count is the full count');
    const byCountry = await alphaC('GET', '/workflows/board?country=Canada');
    assert.equal(byCountry.body.workflow.id, canadaId, 'a country picks its workflow');
  });

  test('a stage’s own time limit decides what is stuck', async () => {
    const id = await newCase('Canada');
    await alphaM('POST', `/cases/${id}/stage`, { stageKey: 'gic', reason: 'Testing the time limit' });
    await db().update(schema.cases).set({ stageEnteredAt: new Date(Date.now() - 12 * 86_400_000) }).where(eq(schema.cases.id, id));
    const stuck = await alphaM('GET', '/analytics/stuck?pageSize=100');
    const row = stuck.body.items.find((r: { id: string }) => r.id === id);
    assert.ok(row, 'past its 10-day limit');
    assert.equal(row.currentStageName, 'GIC, medicals and PAL');
    assert.equal(row.daysOverdue, 2);
    const k = await caseOf(id);
    assert.equal(k.isStuck, true);
    const board = await alphaM('GET', `/workflows/board?templateId=${canadaId}`);
    assert.ok(board.body.columns.find((c: { key: string }) => c.key === 'gic').cards.some((c: { id: string; overdue: boolean }) => c.id === id && c.overdue));
  });

  test('per-stage performance counts what entered each stage and what is there now', async () => {
    const perf = await alphaM('GET', `/workflows/${canadaId}/performance`);
    assert.equal(perf.status, 200, JSON.stringify(perf.body));
    const consultation = perf.body.stages.find((s: { key: string }) => s.key === 'consultation');
    assert.ok(consultation.reached >= 5);
    assert.ok(perf.body.totals.started >= 5);
    assert.ok(perf.body.stages.find((s: { key: string }) => s.key === 'gic').overdue >= 1);
  });
});

describe('countries', () => {
  test('staff read them; building them needs the workflow permission', async () => {
    const body = {
      name: 'Canada',
      code: 'ca',
      currency: 'CAD',
      intakes: [{ name: 'September', month: 9, applicationDeadline: 'Most colleges close in March' }],
      fees: [{ label: 'Study permit', amount: 150, currency: 'CAD' }],
      proofOfFunds: { amount: 20635, currency: 'CAD', basis: 'Living costs for one year, plus first-year tuition', holdingDays: null },
      languageRequirements: [{ test: 'IELTS Academic', overall: '6.0', minimumBand: '6.0' }],
      visaTypes: ['Study permit (SDS)', 'Study permit'],
      visaProcessingDays: 56,
    };
    assert.equal((await alphaC('POST', '/countries', body)).status, 403);
    const created = await alphaM('POST', '/countries', body);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.code, 'CA');
    assert.equal(created.body.flag, '🇨🇦');
    assert.ok(created.body.caseCount >= 5, 'counts applications typed as "canada" too');
    assert.equal(created.body.workflowCount, 1);

    assert.equal((await alphaM('POST', '/countries', { ...body, name: 'canada' })).status, 400, 'no duplicates');
    const list = await alphaC('GET', '/countries');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);

    const updated = await alphaM('PUT', `/countries/${created.body.id}`, { ...body, visaProcessingDays: 60 });
    assert.equal(updated.body.visaProcessingDays, 60);

    const unlisted = await alphaM('GET', '/countries/unlisted');
    assert.ok(unlisted.body.some((u: { name: string }) => u.name === 'United Kingdom'));
    assert.ok(unlisted.body.every((u: { name: string }) => u.name.toLowerCase() !== 'canada'));
  });
});

describe('isolation and permissions', () => {
  test('another consultancy cannot see or use any of it', async () => {
    for (const url of [`/workflows/${canadaId}`, `/workflows/${canadaId}/performance`, `/workflows/board?templateId=${canadaId}`]) {
      assert.equal((await bravoM('GET', url)).status, 404, url);
    }
    assert.ok((await bravoM('GET', '/workflows')).body.every((w: { id: string }) => w.id !== canadaId));
    assert.equal((await bravoM('PUT', `/workflows/${canadaId}/draft`, { stages: CANADA })).status, 404);
    assert.equal((await bravoM('POST', `/workflows/${canadaId}/publish`, {})).status, 404);
    const theirCase = await as('bravoConsultant')('POST', '/cases', { clientId: fx.bravo.clientId, targetCountry: 'Canada', workflowId: canadaId });
    assert.equal(theirCase.status, 400, 'cannot run an application on another consultancy’s workflow');
    assert.equal((await bravoM('GET', '/automations')).body.length, 0);
    assert.equal((await bravoM('GET', '/automations/runs')).body.total, 0);
    assert.equal((await bravoM('GET', '/countries')).body.length, 0);
    const k = await as('bravoConsultant')('POST', '/cases', { clientId: fx.bravo.clientId, targetCountry: 'Canada' });
    assert.equal((await caseOf(k.body.id, as('bravoConsultant'))).workflow.templateName, 'Standard', 'their Canada applications use their own workflows');
    const versionId = (await alphaM('GET', `/workflows/${canadaId}`)).body.current.versionId;
    assert.equal((await as('bravoConsultant')('POST', `/cases/${k.body.id}/workflow`, { versionId, reason: 'Borrow theirs please' })).status, 400);
    assert.equal((await bravoM('GET', `/workflows/versions/${versionId}`)).status, 404);
  });

  test('without the permission staff read workflows and the board, but build nothing', async () => {
    assert.equal((await alphaC('GET', '/workflows')).status, 200);
    assert.equal((await alphaC('GET', '/workflows/board')).status, 200);
    assert.equal((await alphaC('POST', '/workflows', { name: 'Mine' })).status, 403);
    assert.equal((await alphaC('PUT', `/workflows/${canadaId}/draft`, { stages: CANADA })).status, 403);
    assert.equal((await alphaC('GET', '/automations')).status, 403);
    await setPermission('alpha', 'workflow.manage', 'allow');
    assert.equal((await alphaC('GET', '/automations')).status, 200);
    assert.equal((await alphaC('POST', '/workflows', { name: 'Mine' })).status, 201);
    await setPermission('alpha', 'workflow.manage', 'inherit');
    assert.equal((await alphaS('GET', '/workflows')).status, 403, 'students do not see workflows');
  });

  test('the student sees their own stages by the names written for them, nothing internal', async () => {
    const k = await caseOf(canadaCaseId, alphaS);
    assert.equal(k.workflow.stages.length, 8);
    assert.ok(k.workflow.stages.every((s: Record<string, unknown>) => !('tasks' in s) && !('fees' in s) && !('messages' in s)));
    assert.equal(k.notes, null);
  });
});

describe('writing applications the original way', () => {
  test('still gets a workflow and a stage key, and a moved category moves the key', async () => {
    const [k] = await db()
      .insert(schema.cases)
      .values({ tenantId: fx.alpha.id, reference: 'APP-LEGACY-1', clientId: fx.alpha.clientId, targetCountry: 'Malta', currentStage: 'offer_letter' })
      .returning();
    assert.ok(k!.workflowVersionId);
    assert.equal(k!.currentStageKey, 'offer_letter');
    assert.equal(k!.currentStageName, 'Offer Letter Received');
    assert.equal(k!.stageSlaDays, 14);
    const [moved] = await db().update(schema.cases).set({ currentStage: 'visa_filed' }).where(eq(schema.cases.id, k!.id)).returning();
    assert.equal(moved!.currentStageKey, 'visa_filed');
    assert.equal(moved!.stageSlaDays, 21);
    const [{ n }] = (await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.workflowTemplates)
      .where(and(eq(schema.workflowTemplates.tenantId, fx.alpha.id), eq(schema.workflowTemplates.isDefault, true)))) as [{ n: number }];
    assert.equal(n, 1);
  });
});
