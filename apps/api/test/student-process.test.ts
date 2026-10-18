/**
 * The course student, start to finish: an enquiry (taken by staff or from the
 * website form, never twice for the same phone), calls and follow-ups, a
 * trial class the trainer sees on their sheet, enrolling (a course-only
 * student record made on the way, the fees billed), the fees followed from
 * unpaid to paid, every student across batches with filters, closing an
 * enquiry that goes nowhere, the daily follow-up reminder, and handing a
 * finished course-only student over to study abroad.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { HOST, appGet, as, call, db, fx, schema, setPermission, startApp, stopApp } from './harness';
import { EnquiriesService } from '../src/courses/enquiries.service';

before(startApp);
after(stopApp);

const alphaM = as('alphaManager');
const alphaC = as('alphaConsultant');
const alphaS = as('alphaClient');
const bravoM = as('bravoManager');

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let course = '';
let running = '';
let next = '';
let todaySession = '';
let futureSession = '';
let hina = '';
let website = '';
let hinaClient = '';
let hinaEnrolment = '';
let invoiceId = '';

describe('setting up', () => {
  test('a course with a batch in class (every day) and one starting later', async () => {
    await setPermission('alpha', 'course.teach', 'allow');
    const c = await alphaM('POST', '/courses', { name: 'IELTS General', code: 'IELTS-G', testType: 'ielts_general', level: 'any', mode: 'in_person', durationWeeks: 4, hoursPerWeek: 6, fee: 25_000, currency: 'PKR', capacity: 10 });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    course = c.body.id;
    const r = await alphaM('POST', '/courses/batches', { courseId: course, code: 'IG-NOW', startDate: day(-7), endDate: day(21), days: [0, 1, 2, 3, 4, 5, 6], startTime: '17:00', endTime: '19:00', capacity: 10, status: 'running', trainerIds: [fx.alpha.consultantUserId] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    running = r.body.id;
    const n = await alphaM('POST', '/courses/batches', { courseId: course, code: 'IG-NEXT', startDate: day(10), endDate: day(40), days: [1, 3], startTime: '10:00', endTime: '12:00', capacity: 10, status: 'enrolling', trainerIds: [] });
    next = n.body.id;
    const sessions = (await alphaM('GET', `/courses/batches/${running}`)).body.sessions as any[];
    todaySession = sessions.find((s) => s.date === day(0)).id;
    futureSession = sessions.find((s) => s.date === day(2)).id;
  });
});

describe('enquiries', () => {
  test('staff take one; the same phone is not taken twice; others cannot see it', async () => {
    const body = { fullName: 'Hina Baig', phone: '+92 321 555 0101', courseId: course, source: 'walk_in', targetScore: 6.5, notes: 'Wants evening classes.' };
    const r = await alphaC('POST', '/courses/enquiries', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    hina = r.body.id;
    assert.match(r.body.number, /^ENQ-\d{4}-0001$/);
    assert.equal(r.body.status, 'new');
    assert.equal(r.body.assignedTo.id, fx.alpha.consultantUserId, 'whoever takes it follows it up');
    assert.equal(r.body.followUpOn, day(0));
    assert.equal(r.body.followUpDue, true);
    assert.equal(r.body.events[0].kind, 'created');
    const dupe = await alphaM('POST', '/courses/enquiries', { ...body, phone: '0092-321-5550101'.replace('0092', '+92') });
    assert.equal(dupe.status, 409, 'same digits, open enquiry');
    assert.equal((await alphaM('POST', '/courses/enquiries', { ...body, phone: '12' })).status, 400);
    assert.equal((await bravoM('GET', `/courses/enquiries/${hina}`)).status, 404);
    assert.equal((await bravoM('GET', '/courses/enquiries')).body.length, 0);
    assert.equal((await alphaS('GET', '/courses/enquiries')).status, 403);
  });

  test('the website form: a new enquiry for the managers, the same person again is the same enquiry, bots refused', async () => {
    const info = await call('GET', '/public/courses/enquire', { host: HOST.alpha });
    assert.equal(info.status, 200);
    assert.ok(info.body.courses.some((c: any) => c.id === course && c.batches.some((b: any) => b.id === next && b.seatsLeft === 10)), 'courses with batches still to start');
    const form = { fullName: 'Usman Tariq', phone: '+92 300 777 8899', email: 'usman.t@x.example', courseId: course, studyAbroad: true, message: 'Is there a weekend batch?' };
    assert.equal((await call('POST', '/public/courses/enquire', { host: HOST.alpha, json: { ...form, website: 'http://spam' } })).status, 400, 'the honeypot');
    const a = await call('POST', '/public/courses/enquire', { host: HOST.alpha, json: form });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const again = await call('POST', '/public/courses/enquire', { host: HOST.alpha, json: { ...form, message: 'Any news?' } });
    assert.equal(again.body.number, a.body.number, 'added to the open one');
    const list = await alphaM('GET', '/courses/enquiries?q=Usman');
    assert.equal(list.body.length, 1);
    website = list.body[0].id;
    assert.equal(list.body[0].source, 'website');
    assert.equal(list.body[0].assignedTo, null);
    assert.equal(list.body[0].studyAbroad, true);
    const detail = await alphaM('GET', `/courses/enquiries/${website}`);
    assert.ok(detail.body.events.some((e: any) => /Asked again/.test(e.body)));
    const bell = await alphaM('GET', '/notifications?limit=20');
    assert.ok(bell.body.items.some((n: any) => n.title === 'New course enquiry: Usman Tariq'));
    assert.equal((await call('POST', '/public/courses/enquire', { host: HOST.bravo, json: { ...form, email: 'other@x.example', phone: '+92 300 777 0000' } })).status, 400, 'not another consultancy’s course');
  });

  test('a call moves a new enquiry on and sets the next follow-up', async () => {
    const r = await alphaC('POST', `/courses/enquiries/${hina}/contact`, { kind: 'call', body: 'Called. Wants to see a class first.', followUpOn: day(1) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'contacted');
    assert.equal(r.body.followUpOn, day(1));
    assert.equal(r.body.followUpDue, false);
    assert.ok(r.body.lastContactAt);
    assert.match(r.body.events[0].body, /Next follow-up/);
    assert.equal((await alphaC('POST', `/courses/enquiries/${hina}/contact`, { kind: 'call', body: '' })).status, 400);
  });

  test('a trial class: offered from the coming weeks, the trainer sees the guest and marks them', async () => {
    const slots = await alphaC('GET', `/courses/enquiries/trial-slots?courseId=${course}`);
    assert.ok(slots.body.some((s: any) => s.sessionId === futureSession));
    assert.ok(!slots.body.some((s: any) => s.date < day(0)), 'nothing already past');

    const booked = await alphaC('POST', `/courses/enquiries/${hina}/trial`, { sessionId: futureSession });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal(booked.body.status, 'trial_booked');
    assert.equal(booked.body.trial.batchCode, 'IG-NOW');
    assert.equal(booked.body.followUpOn, day(2), 'follow up on the day');
    assert.equal((await alphaC('POST', `/courses/enquiries/${hina}/trial-outcome`, { outcome: 'attended' })).status, 400, 'not happened yet');

    // Moved to today's class instead.
    const today = await alphaC('POST', `/courses/enquiries/${hina}/trial`, { sessionId: todaySession });
    assert.equal(today.body.trial.date, day(0));
    const sheet = await alphaC('GET', `/courses/sessions/${todaySession}/attendance`);
    assert.equal(sheet.status, 200);
    assert.deepEqual(sheet.body.trials.map((t: any) => t.fullName), ['Hina Baig']);
    const done = await alphaC('POST', `/courses/enquiries/${hina}/trial-outcome`, { outcome: 'attended', note: 'Joined in well.' });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.status, 'trial_done');
    assert.equal(done.body.trial.outcome, 'attended');
    assert.equal(done.body.followUpOn, day(1));
    assert.equal((await bravoM('POST', `/courses/enquiries/${hina}/trial-outcome`, { outcome: 'no_show' })).status, 404);
  });

  test('enrolling makes a course-only student, places them and bills the fee', async () => {
    const noEmail = await alphaC('POST', `/courses/enquiries/${hina}/convert`, { batchIds: [running] });
    assert.equal(noEmail.status, 400);
    assert.ok(noEmail.body.fieldErrors?.email, 'their email is needed for a record');
    const r = await alphaC('POST', `/courses/enquiries/${hina}/convert`, { batchIds: [running], email: 'hina.baig@x.example' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.enquiry.status, 'enrolled');
    assert.equal(r.body.enquiry.client.programme, 'course_only');
    assert.equal(r.body.enquiry.enrollment.batchCode, 'IG-NOW');
    const e = r.body.enrollments[0];
    hinaClient = e.clientId;
    hinaEnrolment = e.id;
    invoiceId = e.invoiceId;
    assert.equal(e.status, 'enrolled');
    assert.equal(e.targetScore, 6.5, 'their target came across');
    assert.equal(e.programme, 'course_only');
    assert.equal(e.fee.status, 'unpaid');
    assert.equal(e.fee.total, 25_000_00);
    assert.equal(e.fee.balance, 25_000_00);
    assert.equal((await alphaC('POST', `/courses/enquiries/${hina}/convert`, { batchIds: [next] })).status, 400, 'once');
    assert.equal((await alphaC('POST', `/courses/enquiries/${hina}/lost`, { reason: 'Changed mind' })).status, 400, 'drop the enrolment instead');

    const client = await alphaC('GET', `/clients/${hinaClient}`);
    assert.equal(client.body.programme, 'course_only');
    assert.equal(client.body.cases.length, 0, 'not in the study-abroad pipeline');
    const onlyCourse = await alphaM('GET', '/clients?programme=course_only');
    assert.deepEqual(onlyCourse.body.items.map((c: any) => c.id), [hinaClient]);
    assert.ok(!(await alphaM('GET', '/clients?programme=study_abroad')).body.items.some((c: any) => c.id === hinaClient));
  });

  test('an enquiry that goes nowhere is closed with a reason, and can be reopened', async () => {
    const lost = await alphaM('POST', `/courses/enquiries/${website}/lost`, { reason: 'Fee too high' });
    assert.equal(lost.status, 201, JSON.stringify(lost.body));
    assert.equal(lost.body.status, 'lost');
    assert.equal(lost.body.followUpOn, null);
    assert.equal((await alphaM('POST', `/courses/enquiries/${website}/contact`, { kind: 'note', body: 'Hello' })).status, 400, 'closed');
    assert.ok(!(await alphaM('GET', '/courses/enquiries')).body.some((e: any) => e.id === website), 'not among the open ones');
    assert.ok((await alphaM('GET', '/courses/enquiries?status=lost')).body.some((e: any) => e.id === website));
    const back = await alphaM('POST', `/courses/enquiries/${website}/reopen`);
    assert.equal(back.body.status, 'new');
    assert.equal(back.body.followUpOn, day(0));
    await alphaM('POST', `/courses/enquiries/${website}/lost`, { reason: 'Fee too high' });
  });

  test('the summary: open by stage, follow-ups due, conversion and sources', async () => {
    await alphaC('POST', '/courses/enquiries', { fullName: 'Bilal Ahmed', phone: '+92 333 111 2222', source: 'phone', followUpOn: day(-1) });
    const s = await alphaM('GET', '/courses/enquiries/summary');
    assert.equal(s.status, 200);
    assert.equal(s.body.open.new, 1);
    assert.equal(s.body.followUpsDue, 1);
    assert.equal(s.body.last90.received, 3);
    assert.equal(s.body.last90.enrolled, 1);
    assert.equal(s.body.last90.lost, 1);
    assert.equal(s.body.last90.conversionPercent, 50);
    assert.deepEqual(s.body.bySource.map((x: any) => x.source).sort(), ['phone', 'walk_in', 'website']);
    assert.equal((await alphaM('GET', '/courses/enquiries?due=1')).body.length, 1);
  });

  test('the daily reminder tells whoever has a follow-up due, once', async () => {
    const sweep = appGet<EnquiriesService>(EnquiriesService);
    assert.equal(await sweep.remindFollowUps(), 1, 'Bilal, due yesterday');
    assert.equal(await sweep.remindFollowUps(), 0, 'not again for the same date');
    const bell = await alphaC('GET', '/notifications?limit=30');
    assert.ok(bell.body.items.some((n: any) => n.title === 'Follow up with Bilal Ahmed today'));
  });
});

describe('every student, and their fees', () => {
  test('across batches, filtered by course, status, fees and programme', async () => {
    await alphaM('POST', '/courses/enrollments', { clientId: fx.alpha.clientId, batchIds: [next], invoice: false });
    const all = await alphaM('GET', '/courses/students');
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.equal(all.body.total, 2);
    const upcoming = await alphaM('GET', '/courses/students?status=upcoming');
    assert.deepEqual(upcoming.body.items.map((e: any) => e.batchCode), ['IG-NEXT']);
    const inClass = await alphaM('GET', '/courses/students?status=running');
    assert.deepEqual(inClass.body.items.map((e: any) => e.clientId), [hinaClient]);
    const owing = await alphaM('GET', '/courses/students?fees=owing');
    assert.deepEqual(owing.body.items.map((e: any) => e.id), [hinaEnrolment]);
    assert.deepEqual(owing.body.owing, [{ currency: 'PKR', amount: 25_000_00 }]);
    assert.deepEqual((await alphaM('GET', '/courses/students?fees=not_billed')).body.items.map((e: any) => e.batchCode), ['IG-NEXT']);
    assert.equal((await alphaM('GET', '/courses/students?programme=course_only')).body.total, 1);
    assert.equal((await alphaM('GET', '/courses/students?q=hina')).body.total, 1);
    assert.equal((await alphaM('GET', `/courses/students?batchId=${next}`)).body.total, 1);
    assert.equal((await bravoM('GET', '/courses/students')).body.total, 0);
    assert.equal((await alphaS('GET', '/courses/students')).status, 403);
    assert.equal((await alphaM('GET', '/courses/students?status=nonsense')).status, 400);
  });

  test('fees follow the invoice: part paid, then paid', async () => {
    const part = await alphaM('POST', `/billing/invoices/${invoiceId}/payments`, { amount: 10_000_00, method: 'cash', receivedOn: day(0) });
    assert.equal(part.status, 201, JSON.stringify(part.body));
    let e = (await alphaM('GET', `/courses/enrollments/${hinaEnrolment}`)).body;
    assert.equal(e.fee.status, 'part_paid');
    assert.equal(e.fee.paid, 10_000_00);
    assert.equal(e.fee.balance, 15_000_00);
    await alphaM('POST', `/billing/invoices/${invoiceId}/payments`, { amount: 15_000_00, method: 'cash', receivedOn: day(0) });
    e = (await alphaM('GET', `/courses/enrollments/${hinaEnrolment}`)).body;
    assert.equal(e.fee.status, 'paid');
    assert.equal(e.fee.balance, 0);
    assert.equal((await alphaM('GET', '/courses/students?fees=owing')).body.total, 0);
    assert.equal((await alphaM('GET', '/courses/students?fees=paid')).body.total, 1);
    const roster = (await alphaM('GET', `/courses/batches/${running}`)).body.roster;
    assert.equal(roster[0].fee.status, 'paid', 'on the batch’s list too');
  });
});

describe('after the course', () => {
  test('a finished course-only student is offered to study abroad, then handed over', async () => {
    assert.equal((await alphaM('POST', `/courses/enrollments/${hinaEnrolment}/complete`)).status, 201);
    const ready = await alphaM('GET', '/courses/students?status=completed&handOver=1');
    assert.deepEqual(ready.body.items.map((e: any) => e.clientId), [hinaClient]);
    assert.equal((await alphaS('POST', `/courses/students/${hinaClient}/hand-over`, {})).status, 403);
    assert.equal((await bravoM('POST', `/courses/students/${hinaClient}/hand-over`, {})).status, 404);
    const r = await alphaM('POST', `/courses/students/${hinaClient}/hand-over`, { consultantId: fx.alpha.consultantId, note: 'Interested in Canada, 2027 intake.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await alphaM('GET', `/clients/${hinaClient}`)).body.programme, 'study_abroad');
    assert.equal((await alphaM('GET', '/courses/students?status=completed&handOver=1')).body.total, 0);
    assert.equal((await alphaM('POST', `/courses/students/${hinaClient}/hand-over`, {})).status, 400, 'once');
    const bell = await alphaC('GET', '/notifications?limit=30');
    const note = bell.body.items.find((n: any) => n.title === 'Hina Baig: wants to study abroad');
    assert.ok(note, 'their consultant is told');
    assert.match(note.body, /IELTS General/);
    assert.match(note.body, /Canada/);
    const [audit] = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'client.handed_over'));
    assert.ok(audit);
  });

  test('opening an application makes a course-only student a study-abroad client', async () => {
    const c = await alphaM('POST', '/clients', { fullName: 'Zara Iqbal', email: 'zara.iqbal@x.example', phone: '+92 345 222 3333', programme: 'course_only' });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.programme, 'course_only');
    const k = await alphaM('POST', '/cases', { clientId: c.body.id, targetCountry: 'United Kingdom', studyLevel: 'master', intake: 'Fall 2027' });
    assert.equal(k.status, 201, JSON.stringify(k.body));
    assert.equal((await alphaM('GET', `/clients/${c.body.id}`)).body.programme, 'study_abroad');
    const withApp = await alphaM('POST', '/clients', { fullName: 'Omar Shah', email: 'omar.shah@x.example', phone: '+92 345 444 5555', programme: 'course_only', firstApplication: { targetCountry: 'Canada' } });
    assert.equal(withApp.body.programme, 'study_abroad', 'an application wins');
  });
});
