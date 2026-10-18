/**
 * Courses and test preparation: the catalogue, batches and their sessions,
 * enrolment with seats, a waiting list and billing through finance, moving,
 * pausing and dropping, attendance with absence alerts, mock tests scored on
 * the real IELTS scale, homework handed in and marked, official results that
 * update the profile, file the score report with its expiry and are checked
 * against destination countries, completion with certificates, the report,
 * the daily sweep, and the usual attacks.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { HOST, appGet, as, call as rawCall, db, fx, pdf, schema, session, setPermission, startApp, stopApp, upload } from './harness';
import { EnrollmentsService } from '../src/courses/enrollments.service';

before(startApp);
after(stopApp);

const alphaM = as('alphaManager');
const alphaC = as('alphaConsultant');
const alphaS = as('alphaClient');
const bravoM = as('bravoManager');

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let ielts = '';
let pastBatch = '';
let futureBatch = '';
let mine = '';
const students: string[] = [];
const enrolled: Record<string, string> = {};

async function sessionsOf(batchId: string) {
  return (await alphaM('GET', `/courses/batches/${batchId}`)).body.sessions as any[];
}

describe('the catalogue and batches', () => {
  test('managers build courses; staff read them; another consultancy sees none', async () => {
    const body = { name: 'IELTS Academic preparation', code: 'ielts-a', testType: 'ielts_academic', level: 'any', mode: 'in_person', durationWeeks: 6, hoursPerWeek: 7.5, fee: 30_000, currency: 'PKR', capacity: 2 };
    assert.equal((await alphaC('POST', '/courses', body)).status, 403);
    const r = await alphaM('POST', '/courses', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ielts = r.body.id;
    assert.equal(r.body.code, 'IELTS-A');
    assert.equal(r.body.hoursPerWeek, 7.5);
    assert.equal(r.body.fee, 30_000_00);
    assert.equal((await alphaM('POST', '/courses', { ...body, name: 'Again' })).status, 409, 'codes are unique');
    assert.equal((await alphaM('POST', '/courses', { ...body, code: 'SPOKEN', name: 'Spoken English', testType: 'none' })).status, 201, 'any course of its own');
    assert.equal((await alphaC('GET', '/courses')).body.length, 2);
    assert.equal((await bravoM('GET', '/courses')).body.length, 0);
    assert.equal((await bravoM('GET', `/courses/${ielts}`)).status, 404);
  });

  test('a batch makes its sessions from its timetable, and has trainers', async () => {
    await setPermission('alpha', 'course.teach', 'allow');
    const trainers = await alphaM('GET', '/courses/trainers');
    assert.ok(trainers.body.some((t: any) => t.id === fx.alpha.consultantUserId));
    const base = { courseId: ielts, startTime: '18:00', endTime: '20:00', location: 'Room 2', capacity: 2, status: 'enrolling', trainerIds: [fx.alpha.consultantUserId] };
    const past = await alphaM('POST', '/courses/batches', { ...base, code: 'IELTS-PAST', startDate: day(-14), endDate: day(14), days: [1, 3, 5] });
    assert.equal(past.status, 201, JSON.stringify(past.body));
    pastBatch = past.body.id;
    assert.ok(past.body.sessionsTotal >= 11 && past.body.sessionsTotal <= 13, `three a week for four weeks, got ${past.body.sessionsTotal}`);
    assert.equal(past.body.trainers[0].userId, fx.alpha.consultantUserId);
    const fut = await alphaM('POST', '/courses/batches', { ...base, code: 'IELTS-NEXT', startDate: day(20), endDate: day(60), days: [2, 4], trainerIds: [] });
    futureBatch = fut.body.id;
    assert.equal((await alphaM('POST', '/courses/batches', { ...base, code: 'BAD', startDate: day(5), endDate: day(1), days: [1] })).status, 400, 'ends after it starts');
    assert.equal((await alphaC('POST', '/courses/batches', { ...base, code: 'NOPE', startDate: day(5), endDate: day(9), days: [1] })).status, 403);
    // A trainer sees the batches they teach.
    const teaches = await alphaC('GET', '/courses/batches?mine=true');
    assert.deepEqual(teaches.body.map((b: any) => b.code), ['IELTS-PAST']);
  });
});

describe('enrolment', () => {
  test('seats, then a waiting list; the fee billed through finance as course income', async () => {
    for (const [name, email] of [['Ali Raza', 'ali.raza@x.example'], ['Sara Khan', 'sara.khan@x.example']] as const) {
      const c = await alphaC('POST', '/clients', { fullName: name, email, phone: `+92 300 ${Math.floor(1000000 + Math.random() * 8999999)}` });
      assert.equal(c.status, 201, JSON.stringify(c.body));
      students.push(c.body.id);
    }
    const first = await alphaC('POST', '/courses/enrollments', { clientId: fx.alpha.clientId, batchIds: [pastBatch], targetScore: 7 });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    mine = first.body[0].id;
    assert.equal(first.body[0].status, 'enrolled');
    assert.ok(first.body[0].invoiceNumber, 'billed');
    const inv = await alphaM('GET', `/billing/invoices/${first.body[0].invoiceId}`);
    assert.equal(inv.body.total, 30_000_00);
    assert.equal(inv.body.items[0].category, 'course');
    const lines = await db()
      .select({ key: schema.ledgerAccounts.systemKey, credit: schema.journalLines.credit })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
      .innerJoin(schema.ledgerAccounts, eq(schema.ledgerAccounts.id, schema.journalLines.accountId))
      .where(and(eq(schema.journalEntries.sourceType, 'invoice'), eq(schema.journalEntries.sourceId, inv.body.id)));
    assert.equal(lines.find((l) => l.key === 'fees_course')?.credit, 30_000_00, 'booked as course fees');
    assert.equal((await alphaC('POST', '/courses/enrollments', { clientId: fx.alpha.clientId, batchIds: [pastBatch] })).status, 409, 'once per batch');

    const second = await alphaC('POST', '/courses/enrollments', { clientId: students[0], batchIds: [pastBatch], invoice: false });
    assert.equal(second.body[0].status, 'enrolled');
    const third = await alphaC('POST', '/courses/enrollments', { clientId: students[1], batchIds: [pastBatch], invoice: false });
    assert.equal(third.body[0].status, 'waitlisted', 'two seats');
    assert.equal(third.body[0].waitlistPosition, 1);
    enrolled.ali = second.body[0].id;
    enrolled.sara = third.body[0].id;
    assert.equal((await alphaM('GET', `/courses/batches/${pastBatch}`)).body.waitlisted, 1);
  });

  test('a seat that frees goes to the first on the waiting list', async () => {
    assert.equal((await alphaC('POST', `/courses/enrollments/${enrolled.ali}/drop`, { reason: 'Moved to Karachi' })).status, 201);
    assert.equal((await alphaC('GET', `/courses/enrollments/${enrolled.sara}`)).body.status, 'enrolled');
    // Ali comes back for the next batch instead - moved, not enrolled twice.
    const back = await alphaC('POST', '/courses/enrollments', { clientId: students[0], batchIds: [futureBatch], invoice: false });
    assert.equal(back.status, 201, JSON.stringify(back.body));
    const moved = await alphaC('POST', `/courses/enrollments/${enrolled.sara}/transfer`, { batchId: futureBatch, reason: 'Evening slot suits her better' });
    assert.equal(moved.status, 201, JSON.stringify(moved.body));
    assert.equal(moved.body.batchCode, 'IELTS-NEXT');
    assert.equal(moved.body.transferredFromBatch, 'IELTS-PAST');
    enrolled.sara = moved.body.id;
  });

  test('a pause keeps the seat; the sweep brings the student back when it ends', async () => {
    const p = await alphaC('POST', `/courses/enrollments/${enrolled.sara}/freeze`, { from: day(21), until: day(30), reason: 'Family wedding' });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    assert.equal(p.body.status, 'frozen');
    await db().update(schema.enrollments).set({ frozenUntil: day(-1) }).where(eq(schema.enrollments.id, enrolled.sara!));
    const sweeper = appGet<EnrollmentsService>(EnrollmentsService);
    await sweeper.sweep();
    assert.equal((await alphaC('GET', `/courses/enrollments/${enrolled.sara}`)).body.status, 'enrolled');
    assert.equal((await alphaM('GET', `/courses/batches/${pastBatch}`)).body.status, 'running', 'it started two weeks ago');
  });
});

describe('teaching', () => {
  test('attendance by the trainer, and an alert when absences run on', async () => {
    const sessions = (await sessionsOf(pastBatch)).filter((s) => s.date <= day(0));
    assert.ok(sessions.length >= 3);
    const sheet = await alphaC('GET', `/courses/sessions/${sessions[0].id}/attendance`);
    assert.equal(sheet.status, 200, JSON.stringify(sheet.body));
    const roster = sheet.body.rows.map((r: any) => r.enrollmentId);
    assert.ok(roster.includes(mine));
    assert.equal((await alphaC('PUT', `/courses/sessions/${sessions[0].id}/attendance`, { marks: [{ enrollmentId: enrolled.ali, status: 'present' }] })).status, 400, 'only those in the batch');
    const future = (await sessionsOf(pastBatch)).find((s) => s.date > day(0));
    assert.equal((await alphaC('PUT', `/courses/sessions/${future.id}/attendance`, { marks: [{ enrollmentId: mine, status: 'present' }] })).status, 400, 'not before it happens');
    assert.equal((await alphaC('PUT', `/courses/sessions/${sessions[0].id}/attendance`, { marks: [{ enrollmentId: mine, status: 'present' }] })).status, 200);
    const listed = (await sessionsOf(pastBatch)).find((x) => x.id === sessions[0].id);
    assert.equal(listed.marked, 1, 'the session list counts its own attendance');
    assert.equal(listed.present, 1);
    for (const s of sessions.slice(1, 3)) {
      assert.equal((await alphaC('PUT', `/courses/sessions/${s.id}/attendance`, { marks: [{ enrollmentId: mine, status: 'absent' }] })).status, 200);
    }
    const bell = await alphaC('GET', '/notifications?limit=30');
    assert.ok(bell.body.items.some((n: any) => n.type === 'absence_alert'), 'the consultant hears after two in a row');
    const e = (await alphaC('GET', `/courses/enrollments/${mine}`)).body;
    assert.equal(e.attendance.present, 1);
    assert.equal(e.attendance.absent, 2);
    assert.equal(e.attendance.percent, 33);
    // Without teaching it (and without managing courses) nobody marks it.
    await setPermission('alpha', 'course.teach', 'deny');
    assert.equal((await alphaC('PUT', `/courses/sessions/${sessions[0].id}/attendance`, { marks: [{ enrollmentId: mine, status: 'late' }] })).status, 403);
    await setPermission('alpha', 'course.teach', 'allow');
  });

  test('mock tests on the real IELTS scale: half bands, and the overall rounded the IELTS way', async () => {
    const a = await alphaC('POST', `/courses/batches/${pastBatch}/assessments`, { title: 'Mock 1', kind: 'mock', heldOn: day(-3) });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const id = a.body[0].id;
    const bad = await alphaC('PUT', `/courses/assessments/${id}/scores`, { scores: [{ enrollmentId: mine, scores: { listening: 6.3, reading: 6, writing: 6, speaking: 7 } }] });
    assert.equal(bad.status, 400, 'half bands only');
    assert.equal((await alphaC('PUT', `/courses/assessments/${id}/scores`, { scores: [{ enrollmentId: mine, scores: { listening: 9.5, reading: 6, writing: 6, speaking: 7 } }] })).status, 400, 'nine at most');
    const ok = await alphaC('PUT', `/courses/assessments/${id}/scores`, { scores: [{ enrollmentId: mine, scores: { listening: 6.5, reading: 6, writing: 6, speaking: 7 }, feedback: 'Writing task 2 needs structure' }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.scores[0].overall, 6.5, '6.375 rounds up to 6.5');
    const again = await alphaC('PUT', `/courses/assessments/${id}/scores`, { scores: [{ enrollmentId: mine, scores: { listening: 6.5, reading: 6.5, writing: 6, speaking: 6 } }] });
    assert.equal(again.body.scores[0].overall, 6.5, '6.25 rounds up to 6.5');
    const b = await alphaC('POST', `/courses/batches/${pastBatch}/assessments`, { title: 'Mock 2', kind: 'mock', heldOn: day(-1) });
    const id2 = b.body.find((x: any) => x.title === 'Mock 2').id;
    const two = await alphaC('PUT', `/courses/assessments/${id2}/scores`, { scores: [{ enrollmentId: mine, scores: { listening: 7, reading: 7, writing: 6.5, speaking: 7 } }] });
    assert.equal(two.body.scores[0].overall, 7, '6.875 rounds to 7');
    assert.equal((await alphaC('GET', `/courses/enrollments/${mine}`)).body.latestMock.overall, 7);
  });

  test('homework: set with a file, handed in by the student, sent back, handed in again, marked', async () => {
    const h = await upload('alphaConsultant', `/courses/batches/${pastBatch}/homework`, { title: 'Task 2 essay', instructions: 'Write 250 words on remote work.', kind: 'homework', maxScore: '9', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }, { name: 'prompt.pdf', type: 'application/pdf', bytes: pdf('prompt') });
    assert.equal(h.status, 201, JSON.stringify(h.body));
    const hw = h.body[0];
    const portal = await alphaS('GET', '/my-courses');
    assert.equal(portal.status, 200, JSON.stringify(portal.body));
    const mineThere = portal.body.enrollments.find((e: any) => e.id === mine);
    assert.ok(mineThere.homework.some((x: any) => x.id === hw.id));
    assert.ok(mineThere.upcoming.length > 0, 'the next classes');
    assert.equal((await alphaS('GET', `/my-courses/homework/${hw.id}/file`)).raw.subarray(0, 4).toString(), '%PDF');
    assert.equal((await alphaS('POST', `/my-courses/homework/${hw.id}/submit`, {})).status, 400, 'something to hand in');
    const sub = await upload('alphaClient', `/my-courses/homework/${hw.id}/submit`, { text: 'Remote work has transformed…' }, { name: 'essay.pdf', type: 'application/pdf', bytes: pdf('essay') });
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    const list = await alphaC('GET', `/courses/batches/${pastBatch}/homework`);
    const s = list.body[0].submissions[0];
    assert.equal(s.clientName, (await alphaM('GET', `/clients/${fx.alpha.clientId}`)).body.fullName);
    assert.equal((await alphaC('POST', `/courses/submissions/${s.id}/grade`, { returned: true })).status, 400, 'say why it goes back');
    assert.equal((await alphaC('POST', `/courses/submissions/${s.id}/grade`, { returned: true, feedback: 'Add a conclusion' })).status, 201);
    const resub = await upload('alphaClient', `/my-courses/homework/${hw.id}/submit`, { text: 'Remote work has transformed… In conclusion…' }, { name: 'essay2.pdf', type: 'application/pdf', bytes: pdf('essay2') });
    assert.equal(resub.status, 201);
    assert.equal((await alphaC('POST', `/courses/submissions/${s.id}/grade`, { score: 10 })).status, 400, 'out of nine');
    const graded = await alphaC('POST', `/courses/submissions/${s.id}/grade`, { score: 6.5, feedback: 'Clear structure now' });
    assert.equal(graded.status, 201);
    assert.equal(graded.body.submissions[0].status, 'graded');
    assert.equal((await alphaS('POST', `/my-courses/homework/${hw.id}/submit`, { text: 'Once more' })).status, 400, 'marked is final');
    assert.equal((await alphaC('GET', `/courses/submissions/${s.id}/file`)).raw.subarray(0, 4).toString(), '%PDF');
  });
});

describe('official tests', () => {
  test('a result updates the profile, files the score report with its expiry, and is checked against the destination', async () => {
    const country = await alphaM('POST', '/countries', { name: 'United Kingdom', code: 'gb', currency: 'GBP', languageRequirements: [{ test: 'IELTS Academic', overall: '6.5', minimumBand: '6.0' }] });
    assert.ok(country.status === 201 || country.status === 400, JSON.stringify(country.body));
    assert.equal((await alphaS('POST', '/courses/results', {})).status, 403, 'students do not record their own');
    const booked = await alphaC('POST', '/courses/results', { clientId: fx.alpha.clientId, testType: 'ielts_academic', status: 'booked', testDate: day(10), bookedOn: day(0), venue: 'British Council, Lahore', reference: 'BC-4471' });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    const form = new FormData();
    for (const [k, v] of Object.entries({ clientId: fx.alpha.clientId, testType: 'ielts_academic', status: 'result', testDate: day(-5), reference: '25PK004471RAZA001A', scores: JSON.stringify({ listening: 7.5, reading: 7, writing: 6, speaking: 6.5 }) })) form.append(k, v);
    form.append('file', new Blob([pdf('trf')], { type: 'application/pdf' }), 'trf.pdf');
    const r = await rawCall('PUT', `/courses/results/${booked.body.id}`, { host: HOST.alpha, session: session.alphaConsultant, form });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.overall, 7, '6.75 rounds up to 7');
    assert.equal(r.body.expiresOn, (() => { const d = new Date(`${day(-5)}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 2); return d.toISOString().slice(0, 10); })());
    assert.ok(r.body.documentId, 'the score report is filed');
    const doc = await alphaM('GET', `/drive/documents/${r.body.documentId}`);
    assert.equal(doc.body.expiresOn, r.body.expiresOn);
    const profile = (await alphaM('GET', `/clients/${fx.alpha.clientId}`)).body.profile;
    assert.equal(profile.englishTest, 'ielts');
    assert.equal(profile.englishScore, '7');
    const uk = r.body.eligibility.find((e: any) => e.country === 'United Kingdom');
    assert.ok(uk, JSON.stringify(r.body.eligibility));
    assert.equal(uk.meets, true, 'overall 7, no part below 6');
    const low = await alphaC('POST', '/courses/results', { clientId: students[0], testType: 'ielts_academic', status: 'result', testDate: day(-40), scores: { listening: 6, reading: 6, writing: 5.5, speaking: 6 } });
    assert.equal(low.status, 201, JSON.stringify(low.body));
    assert.equal(low.body.overall, 6);
    await alphaC('PATCH', `/clients/${students[0]}`, { preferredCountries: ['United Kingdom'] });
    const lowView = (await alphaC('GET', `/courses/results?clientId=${students[0]}`)).body[0];
    const ukLow = lowView.eligibility.find((e: any) => e.country === 'United Kingdom');
    assert.ok(ukLow, JSON.stringify(lowView));
    assert.equal(ukLow.meets, false);
    assert.match(ukLow.shortBy, /overall 6 of 6.5/);
    const mineView = await alphaS('GET', '/my-courses');
    assert.ok(mineView.body.results.some((x: any) => x.id === booked.body.id));
  });
});

describe('finishing', () => {
  test('completion: a certificate only with enough attendance; finishing a batch completes everyone', async () => {
    assert.equal((await alphaC('POST', `/courses/enrollments/${mine}/complete`)).status, 403, 'managers of courses complete them');
    const done = await alphaM('POST', `/courses/enrollments/${mine}/complete`);
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.status, 'completed');
    assert.equal(done.body.certificateNumber, null, '33% attendance is below the 75% needed');
    await alphaM('PUT', '/courses/settings', { absenceAlertAfter: 2, certificateMinAttendance: 30 });
    const other = await alphaM('POST', '/courses/enrollments', { clientId: students[1], batchIds: [pastBatch], invoice: false });
    assert.equal(other.status, 201, JSON.stringify(other.body));
    const sessions = (await sessionsOf(pastBatch)).filter((s) => s.date <= day(0));
    await alphaC('PUT', `/courses/sessions/${sessions[0].id}/attendance`, { marks: [{ enrollmentId: other.body[0].id, status: 'present' }] });
    const finished = await alphaM('POST', `/courses/batches/${pastBatch}/complete`);
    assert.equal(finished.status, 201, JSON.stringify(finished.body));
    assert.equal(finished.body.certificates, 1);
    const cert = (await alphaM('GET', `/courses/enrollments/${other.body[0].id}`)).body.certificateNumber;
    assert.match(cert, /^CERT-\d{4}-\d{4}$/);
    const certPdf = await alphaM('GET', `/courses/enrollments/${other.body[0].id}/certificate`);
    assert.equal(certPdf.raw.subarray(0, 4).toString(), '%PDF');
    assert.equal((await alphaM('GET', `/courses/batches/${pastBatch}`)).body.status, 'completed');
  });

  test('the report: enrolments, attendance, improvement between mocks, course income', async () => {
    const r = await alphaM('GET', '/courses/reports');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = r.body.find((x: any) => x.courseId === ielts);
    assert.ok(row.enrolled >= 2);
    assert.ok(row.completed >= 2);
    assert.equal(row.averageImprovement, 0.5, 'from 6.5 to 7');
    assert.equal(row.revenue[0].amount, 30_000_00);
  });
});

describe('isolation', () => {
  test('another consultancy, a student and people without permission see none of it', async () => {
    assert.equal((await bravoM('GET', `/courses/batches/${pastBatch}`)).status, 404);
    assert.equal((await bravoM('GET', `/courses/enrollments/${mine}`)).status, 404);
    assert.equal((await bravoM('POST', '/courses/enrollments', { clientId: fx.alpha.clientId, batchIds: [futureBatch], invoice: false })).status, 404);
    assert.equal((await bravoM('GET', '/courses/results')).body.length, 0);
    assert.equal((await alphaS('GET', '/courses')).status, 403);
    assert.equal((await alphaS('GET', `/courses/batches/${pastBatch}/homework`)).status, 403);
    await setPermission('alpha', 'course.view', 'deny');
    await setPermission('alpha', 'course.teach', 'deny');
    assert.equal((await alphaC('GET', '/courses')).status, 403);
    await setPermission('alpha', 'course.view', 'inherit');
    await setPermission('alpha', 'course.teach', 'inherit');
  });
});
