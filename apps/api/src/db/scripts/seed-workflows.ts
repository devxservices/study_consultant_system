import { and, eq, inArray, sql } from 'drizzle-orm';
import { countrySchema, saveWorkflowDraftSchema, type CountryInput, type WorkflowStageInput } from '@crm/shared';
import type { Db } from '../connection';
import { automationRules, caseStageEvents, cases, countries, users, workflowStages, workflowTemplates, workflowVersions } from '../schema';
import { stageInsert } from '../../workflows/stage-rows';

/**
 * Demo data for countries and workflows: five destinations, a Canada and a
 * UK workflow with their own stages, three automations, and the open
 * Canada and UK applications moved onto their workflows so the board has
 * something to show. Fills only what is empty, so it is safe to re-run.
 *
 * The country figures are illustrative sample data. Visa fees, funds and
 * test scores change; the notes say to check the official source.
 */
const SAMPLE = 'Sample data for the demo - check the official government source before advising a student.';

const COUNTRIES: CountryInput[] = [
  {
    name: 'United Kingdom',
    code: 'GB',
    currency: 'GBP',
    intakes: [
      { name: 'September', month: 9, applicationDeadline: 'UCAS deadline for undergraduates; most masters accept until summer' },
      { name: 'January', month: 1, applicationDeadline: 'Usually October-November' },
    ],
    fees: [{ label: 'Student visa application', amount: 524, currency: 'GBP' }],
    proofOfFunds: { currency: 'GBP', basis: 'Unpaid first-year tuition plus living costs for up to 9 months (higher in London)', holdingDays: 28 },
    languageRequirements: [{ test: 'IELTS for UKVI (Academic)', overall: '6.0', minimumBand: '5.5' }],
    visaTypes: ['Student visa'],
    visaProcessingDays: 21,
    workRights: 'Up to 20 hours a week in term time at degree level.',
    postStudyWork: 'Graduate route after the course.',
    notes: SAMPLE,
  },
  {
    name: 'Canada',
    code: 'CA',
    currency: 'CAD',
    intakes: [
      { name: 'September', month: 9, applicationDeadline: 'Colleges often close January-March' },
      { name: 'January', month: 1, applicationDeadline: 'Usually by September' },
      { name: 'May', month: 5 },
    ],
    fees: [
      { label: 'Study permit', amount: 150, currency: 'CAD' },
      { label: 'Biometrics', amount: 85, currency: 'CAD' },
    ],
    proofOfFunds: { currency: 'CAD', basis: 'First-year tuition plus the living-cost amount IRCC publishes for the year; a GIC is the usual proof' },
    languageRequirements: [{ test: 'IELTS Academic', overall: '6.0', minimumBand: '6.0' }],
    visaTypes: ['Study permit'],
    visaProcessingDays: 56,
    workRights: 'Off-campus work allowed within the weekly limit IRCC sets.',
    postStudyWork: 'Post-Graduation Work Permit for eligible programmes.',
    notes: `${SAMPLE} A provincial attestation letter (PAL) is needed for most applications.`,
  },
  {
    name: 'Australia',
    code: 'AU',
    currency: 'AUD',
    intakes: [
      { name: 'February', month: 2 },
      { name: 'July', month: 7 },
    ],
    fees: [{ label: 'Student visa (subclass 500)', amount: 2000, currency: 'AUD' }],
    proofOfFunds: { currency: 'AUD', basis: 'Twelve months of living costs, tuition and travel, at the rate Home Affairs publishes' },
    languageRequirements: [{ test: 'IELTS Academic', overall: '6.0' }, { test: 'PTE Academic', overall: '50' }],
    visaTypes: ['Student visa (subclass 500)'],
    visaProcessingDays: 30,
    notes: `${SAMPLE} The Genuine Student requirement replaced the GTE statement.`,
  },
  {
    name: 'United States',
    code: 'US',
    currency: 'USD',
    intakes: [
      { name: 'Fall', month: 8 },
      { name: 'Spring', month: 1 },
    ],
    fees: [
      { label: 'Visa application (MRV)', amount: 185, currency: 'USD' },
      { label: 'SEVIS I-901', amount: 350, currency: 'USD' },
    ],
    proofOfFunds: { currency: 'USD', basis: 'The first-year cost of attendance shown on the I-20' },
    languageRequirements: [{ test: 'TOEFL iBT', overall: '80' }, { test: 'IELTS Academic', overall: '6.5' }],
    visaTypes: ['F-1'],
    visaProcessingDays: 60,
    postStudyWork: 'OPT, and STEM OPT for eligible degrees.',
    notes: `${SAMPLE} Every F-1 applicant attends an embassy interview.`,
  },
  {
    name: 'Germany',
    code: 'DE',
    currency: 'EUR',
    intakes: [
      { name: 'Winter semester', month: 10, applicationDeadline: 'Often 15 July for international applicants' },
      { name: 'Summer semester', month: 4, applicationDeadline: 'Often 15 January' },
    ],
    fees: [{ label: 'National visa', amount: 75, currency: 'EUR' }],
    proofOfFunds: { currency: 'EUR', basis: 'A blocked account holding the yearly amount the Federal Foreign Office sets' },
    languageRequirements: [{ test: 'IELTS Academic', overall: '6.5' }, { test: 'TestDaF', overall: 'TDN 4' }],
    visaTypes: ['National visa (study)'],
    visaProcessingDays: 45,
    notes: SAMPLE,
  },
];

const CANADA: WorkflowStageInput[] = [
  { key: 'consultation', name: 'Consultation', clientLabel: 'Getting started', clientDescription: 'We are planning your Canada application together.', category: 'inquiry', color: 'slate', slaDays: 7,
    tasks: [{ title: 'Assessment call with {student}', dueInDays: 1 }] },
  { key: 'program_selection', name: 'College and programme', clientLabel: 'Choosing your college', clientDescription: 'Your consultant is shortlisting DLI colleges and programmes for you.', category: 'shortlisting', color: 'blue', slaDays: 10 },
  { key: 'documents', name: 'Documents', clientLabel: 'Collecting your documents', clientDescription: 'Upload each document below. We check every one.', category: 'documents_collection', color: 'violet', slaDays: 14,
    requiredDocuments: ['passport', 'transcript', 'language_test', 'sop'],
    messages: [{ audience: 'student', channels: ['in_app', 'email'], subject: 'Your Canada document checklist, {first_name}', body: 'Hi {student}, your Canada application {reference} needs your passport, transcripts, IELTS result and statement of purpose. Upload them in your portal: {portal_link}' }] },
  { key: 'application', name: 'Application to college', clientLabel: 'Application sent', clientDescription: 'Your application is with the college.', category: 'application_submitted', color: 'blue', slaDays: 21 },
  { key: 'loa', name: 'LOA received', clientLabel: 'Offer received', clientDescription: 'The college has offered you a place.', category: 'offer_letter', color: 'teal', slaDays: 10, requiredDocuments: ['offer_letter'] },
  { key: 'gic_tuition', name: 'GIC and tuition deposit', clientLabel: 'GIC and deposit', clientDescription: 'Open your GIC and pay the first-year tuition deposit.', category: 'fee_payment', color: 'amber', slaDays: 21,
    requiredDocuments: ['fee_receipt', 'bank_statement'],
    fees: [{ label: 'Visa filing service fee', amount: 5_000_000, currency: 'PKR', mode: 'task', dueInDays: 7 }] },
  { key: 'file_review', name: 'File review', clientLabel: 'Final check of your file', clientDescription: 'A senior consultant reviews your file before it is submitted.', category: 'visa_filed', color: 'orange', slaDays: 5, approvalRequired: true, autoAdvance: false },
  { key: 'permit_filed', name: 'Study permit filed', clientLabel: 'Study permit applied', clientDescription: 'Your study permit application is submitted to IRCC.', category: 'visa_filed', color: 'orange', slaDays: 10, requiredDocuments: ['visa_form'] },
  { key: 'biometrics', name: 'Biometrics', clientLabel: 'Biometrics appointment', clientDescription: 'Give your fingerprints and photo at the VAC.', category: 'visa_interview', color: 'orange', slaDays: 14,
    tasks: [{ title: 'Book the biometrics appointment for {student}', dueInDays: 2, priority: 'high' }] },
  { key: 'decision', name: 'IRCC decision', clientLabel: 'Decision on your permit', clientDescription: 'IRCC is deciding on your study permit.', category: 'visa_decision', color: 'rose', slaDays: 60 },
  { key: 'pre_departure', name: 'Pre-departure', clientLabel: 'Getting ready to fly', clientDescription: 'Tickets, accommodation and arrival.', category: 'closed', color: 'green', slaDays: 3650 },
];

const UK: WorkflowStageInput[] = [
  { key: 'inquiry', name: 'Inquiry', clientLabel: 'Getting started', clientDescription: 'We are learning about your goals.', category: 'inquiry', color: 'slate', slaDays: 7 },
  { key: 'shortlisting', name: 'University shortlisting', clientLabel: 'Choosing your universities', clientDescription: 'Your consultant is shortlisting UK universities for you.', category: 'shortlisting', color: 'blue', slaDays: 10 },
  { key: 'documents', name: 'Documents', clientLabel: 'Collecting your documents', clientDescription: 'Upload each document below.', category: 'documents_collection', color: 'violet', slaDays: 14,
    requiredDocuments: ['passport', 'transcript', 'language_test', 'sop', 'recommendation_letter'] },
  { key: 'applied', name: 'Applied', clientLabel: 'Application sent', clientDescription: 'Your application is with the university.', category: 'application_submitted', color: 'blue', slaDays: 30 },
  { key: 'offer', name: 'Offer', clientLabel: 'Offer received', clientDescription: 'The university has made you an offer.', category: 'offer_letter', color: 'teal', slaDays: 14, requiredDocuments: ['offer_letter'] },
  { key: 'credibility', name: 'Credibility interview', clientLabel: 'University interview', clientDescription: 'Some universities hold a short interview before issuing a CAS.', category: 'offer_letter', color: 'teal', slaDays: 10,
    conditions: [{ field: 'studyLevel', op: 'in', value: ['master', 'bachelor'] }],
    tasks: [{ title: 'Prepare {student} for the credibility interview', dueInDays: 2 }] },
  { key: 'cas', name: 'Deposit and CAS', clientLabel: 'Deposit and CAS', clientDescription: 'Pay the deposit so the university can issue your CAS.', category: 'fee_payment', color: 'amber', slaDays: 21, requiredDocuments: ['fee_receipt', 'i20_cas'] },
  { key: 'visa_filed', name: 'Visa filed', clientLabel: 'Visa application filed', clientDescription: 'Your Student visa application is submitted.', category: 'visa_filed', color: 'orange', slaDays: 21, requiredDocuments: ['visa_form'], movableBy: 'managers' },
  { key: 'decision', name: 'Visa decision', clientLabel: 'Visa decision', clientDescription: 'UKVI is deciding on your visa.', category: 'visa_decision', color: 'rose', slaDays: 30 },
  { key: 'closed', name: 'Enrolled', clientLabel: 'All done', clientDescription: 'Your case is complete. We wish you the very best.', category: 'closed', color: 'green', slaDays: 3650 },
];

export async function seedWorkflows(db: Db, tenantId: string): Promise<{ countries: number; workflows: number; automations: number; moved: number }> {
  let countryCount = 0;
  const [hasCountry] = await db.select({ id: countries.id }).from(countries).where(eq(countries.tenantId, tenantId)).limit(1);
  if (!hasCountry) {
    await db.insert(countries).values(
      COUNTRIES.map((c) => {
        const d = countrySchema.parse(c);
        return {
          tenantId,
          ...d,
          workRights: d.workRights ?? null,
          postStudyWork: d.postStudyWork ?? null,
          notes: d.notes ?? null,
        };
      }),
    );
    countryCount = COUNTRIES.length;
  }

  const [manager] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager')))
    .orderBy(users.createdAt)
    .limit(1);

  let workflowCount = 0;
  let moved = 0;
  for (const wf of [
    { name: 'Canada study permit', country: 'Canada', description: 'College and university applications for Canada, through GIC, file review and biometrics.', stages: CANADA },
    { name: 'UK Student visa', country: 'United Kingdom', description: 'UK undergraduate and postgraduate applications through CAS and the Student visa.', stages: UK },
  ]) {
    const [exists] = await db
      .select({ id: workflowTemplates.id })
      .from(workflowTemplates)
      .where(and(eq(workflowTemplates.tenantId, tenantId), sql`lower(${workflowTemplates.name}) = lower(${wf.name})`))
      .limit(1);
    if (exists) continue;
    const [template] = await db
      .insert(workflowTemplates)
      .values({ tenantId, name: wf.name, description: wf.description, country: wf.country, createdBy: manager?.id ?? null })
      .returning({ id: workflowTemplates.id });
    const [version] = await db
      .insert(workflowVersions)
      .values({ tenantId, templateId: template!.id, version: 1, status: 'draft', notes: 'First version', createdBy: manager?.id ?? null })
      .returning({ id: workflowVersions.id });
    // The same validation as the builder: order, closing stage, unique keys.
    const { stages } = saveWorkflowDraftSchema.parse({ stages: wf.stages });
    await db.insert(workflowStages).values(stages.map((s, i) => stageInsert(s, tenantId, version!.id, i)));
    await db
      .update(workflowVersions)
      .set({ status: 'published', publishedAt: new Date(), publishedBy: manager?.id ?? null })
      .where(eq(workflowVersions.id, version!.id));
    workflowCount++;

    // Open applications to this country onto it, at the first stage of the
    // same category, as a manager would with "Move to workflow".
    const open = await db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.tenantId, tenantId), eq(cases.status, 'active'), sql`lower(${cases.targetCountry}) = lower(${wf.country})`));
    if (open.length) {
      const ids = open.map((o) => o.id);
      await db
        .update(cases)
        .set({
          workflowVersionId: version!.id,
          currentStageKey: sql`coalesce(
            (select s.key from workflow_stages s where s.version_id = ${version!.id}::uuid and s.category = "cases"."current_stage" order by s.position limit 1),
            (select s.key from workflow_stages s where s.version_id = ${version!.id}::uuid order by s.position limit 1))`,
        })
        .where(inArray(cases.id, ids));
      await db
        .update(caseStageEvents)
        .set({ workflowVersionId: version!.id, stageKey: sql`(select c.current_stage_key from cases c where c.id = "case_stage_events"."case_id")` })
        .where(and(inArray(caseStageEvents.caseId, ids), sql`${caseStageEvents.completedAt} is null`));
      moved += ids.length;
    }
  }

  let automationCount = 0;
  const [hasRule] = await db.select({ id: automationRules.id }).from(automationRules).where(eq(automationRules.tenantId, tenantId)).limit(1);
  if (!hasRule) {
    await db.insert(automationRules).values([
      {
        tenantId,
        name: 'Welcome every new application',
        trigger: 'case_created',
        actions: [
          {
            type: 'send_message',
            message: {
              audience: 'student',
              channels: ['in_app', 'email'],
              subject: 'Your {country} application has started',
              body: 'Hi {first_name}, we have opened your application {reference} for {country}. {consultant} will guide you through every step. You can follow it in your portal: {portal_link}',
            },
          },
        ],
        createdBy: manager?.id ?? null,
      },
      {
        tenantId,
        name: 'Escalate stalled applications',
        trigger: 'case_stuck',
        actions: [
          { type: 'create_task', task: { title: 'Unblock {reference} ({student}) - stuck at {stage}', dueInDays: 1, assignee: 'managers', priority: 'high' } },
        ],
        createdBy: manager?.id ?? null,
      },
      {
        tenantId,
        name: 'Follow up on rejected documents',
        trigger: 'document_rejected',
        actions: [
          { type: 'create_task', task: { title: 'Check {student} has re-sent the rejected document', dueInDays: 2, assignee: 'consultant', priority: 'normal' } },
        ],
        createdBy: manager?.id ?? null,
      },
    ]);
    automationCount = 3;
  }

  return { countries: countryCount, workflows: workflowCount, automations: automationCount, moved };
}
