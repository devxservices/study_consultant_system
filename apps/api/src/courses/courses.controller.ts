import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { z } from 'zod';
import {
  UPLOAD_CEILING_MB,
  assessmentSchema,
  attendanceSchema,
  batchSchema,
  courseSchema,
  courseSettingsSchema,
  enrolSchema,
  freezeSchema,
  gradeSchema,
  scoresInputSchema,
  sessionUpdateSchema,
  testResultSchema,
  transferSchema,
  convertEnquirySchema,
  enquiryContactSchema,
  enquiryLostSchema,
  enquirySchema,
  handOverSchema,
  listEnquiriesQuerySchema,
  listStudentsQuerySchema,
  publicEnquirySchema,
  trialOutcomeSchema,
  trialSchema,
  type AuthUser,
  type EnquiryInput,
  type ListEnquiriesQuery,
  type ListStudentsQuery,
} from '@crm/shared';
import { BadRequestException as BadRequest, UseGuards } from '@nestjs/common';
import { zodPipe } from '../common/zod.pipe';
import { CurrentUser, Public, Roles, Site } from '../auth/auth.guard';
import type { ResolvedHost } from '../tenancy/tenant-resolver.service';
import { FormThrottleGuard } from '../partners/form-throttle.guard';
import { EnquiriesService } from './enquiries.service';
import { sendFile } from '../documents/documents.controller';
import { CoursesService } from './courses.service';
import { EnrollmentsService } from './enrollments.service';
import { TeachingService } from './teaching.service';
import { TestResultsService } from './results.service';

const reason = zodPipe(z.object({ reason: z.string().trim().min(5, 'Say why, so the record explains itself later').max(500) }));
const uploadLimits = { limits: { fileSize: UPLOAD_CEILING_MB * 1024 * 1024, files: 1 } };
type Upload = { buffer: Buffer; originalname: string; size: number };
const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/** Multipart forms carry everything as text; JSON-ish fields arrive as strings. */
function formJson(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v !== 'string') {
      out[k] = v;
      continue;
    }
    if (v === '') continue;
    if (k === 'scores') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        throw new BadRequestException({ message: 'Scores could not be read.', fieldErrors: { scores: 'Invalid' } });
      }
    } else out[k] = v;
  }
  return out;
}

/**
 * Courses, batches, enrolments, teaching and official tests, for staff. The
 * services check the permission for each thing (see courses.service.ts).
 */
@Roles('consultant', 'manager')
@Controller('courses')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly enrollments: EnrollmentsService,
    private readonly teaching: TeachingService,
    private readonly results: TestResultsService,
    private readonly enquiriesService: EnquiriesService,
  ) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query('all') all?: string) {
    return this.courses.list(actor, all === 'true');
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(zodPipe(courseSchema)) body: z.input<typeof courseSchema>) {
    return this.courses.save(actor, body);
  }

  @Get('trainers')
  trainers(@CurrentUser() actor: AuthUser) {
    return this.courses.trainerOptions(actor);
  }

  @Get('settings')
  settings(@CurrentUser() actor: AuthUser) {
    this.courses.assertView(actor);
    return this.courses.settings(actor.tenantId!);
  }

  @Put('settings')
  saveSettings(@CurrentUser() actor: AuthUser, @Body(zodPipe(courseSettingsSchema)) body: z.input<typeof courseSettingsSchema>) {
    return this.courses.saveSettings(actor, body);
  }

  @Get('reports')
  report(@CurrentUser() actor: AuthUser) {
    return this.courses.report(actor);
  }

  /* Batches */

  @Get('batches')
  batches(@CurrentUser() actor: AuthUser, @Query('courseId') courseId?: string, @Query('status') status?: string, @Query('mine') mine?: string) {
    return this.courses.batches(actor, { courseId: uuid(courseId), status, mine: mine === 'true' });
  }

  @Post('batches')
  addBatch(@CurrentUser() actor: AuthUser, @Body(zodPipe(batchSchema)) body: z.input<typeof batchSchema>) {
    return this.courses.saveBatch(actor, body);
  }

  @Get('batches/:id')
  batch(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.batch(actor, id, (batchId) => this.enrollments.roster(batchId));
  }

  @Put('batches/:id')
  saveBatch(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(batchSchema)) body: z.input<typeof batchSchema>) {
    return this.courses.saveBatch(actor, body, id);
  }

  @Post('batches/:id/complete')
  completeBatch(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.completeBatch(actor, id);
  }

  @Post('batches/:id/sessions')
  addSession(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { date: string; startTime: string; endTime: string; topic?: string | null }) {
    return this.courses.addSession(actor, id, body);
  }

  @Put('sessions/:id')
  session(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(sessionUpdateSchema)) body: z.input<typeof sessionUpdateSchema>) {
    return this.courses.updateSession(actor, id, body);
  }

  @Get('sessions/:id/attendance')
  sheet(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teaching.sheet(actor, id);
  }

  @Put('sessions/:id/attendance')
  mark(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(attendanceSchema)) body: z.input<typeof attendanceSchema>) {
    return this.teaching.mark(actor, id, body);
  }

  @Get('batches/:id/assessments')
  assessments(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teaching.assessments(actor, id);
  }

  @Post('batches/:id/assessments')
  addAssessment(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(assessmentSchema)) body: z.input<typeof assessmentSchema>) {
    return this.teaching.addAssessment(actor, id, body);
  }

  @Put('assessments/:id/scores')
  scores(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(scoresInputSchema)) body: z.input<typeof scoresInputSchema>) {
    return this.teaching.recordScores(actor, id, body);
  }

  @Get('batches/:id/homework')
  homework(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teaching.homeworkList(actor, id);
  }

  @Post('batches/:id/homework')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  addHomework(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @UploadedFile() file?: Upload) {
    return this.teaching.addHomework(actor, id, formJson(body) as never, file);
  }

  @Get('homework/:id/file')
  async homeworkFile(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.teaching.homeworkFile(actor, id);
    sendFile(res, f.stream, f.mime, f.name, 'attachment');
  }

  @Post('submissions/:id/grade')
  grade(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(gradeSchema)) body: z.input<typeof gradeSchema>) {
    return this.teaching.grade(actor, id, body);
  }

  @Get('submissions/:id/file')
  async submissionFile(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.teaching.submissionFile(actor, id);
    sendFile(res, f.stream, f.mime, f.name, 'attachment');
  }

  /* Enquiries: before someone enrols */

  @Get('enquiries')
  enquiries(@CurrentUser() actor: AuthUser, @Query(zodPipe(listEnquiriesQuerySchema)) query: ListEnquiriesQuery) {
    return this.enquiriesService.list(actor, query);
  }

  @Get('enquiries/summary')
  enquirySummary(@CurrentUser() actor: AuthUser) {
    return this.enquiriesService.summary(actor);
  }

  @Get('enquiries/staff')
  enquiryStaff(@CurrentUser() actor: AuthUser) {
    return this.enquiriesService.staffOptions(actor);
  }

  @Get('enquiries/trial-slots')
  trialSlots(@CurrentUser() actor: AuthUser, @Query('courseId') courseId?: string) {
    return this.enquiriesService.trialSlots(actor, uuid(courseId));
  }

  @Post('enquiries')
  addEnquiry(@CurrentUser() actor: AuthUser, @Body(zodPipe(enquirySchema)) body: EnquiryInput) {
    return this.enquiriesService.create(actor, body);
  }

  @Get('enquiries/:id')
  enquiry(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enquiriesService.get(actor, id);
  }

  @Put('enquiries/:id')
  saveEnquiry(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(enquirySchema)) body: EnquiryInput) {
    return this.enquiriesService.update(actor, id, body);
  }

  @Post('enquiries/:id/contact')
  contact(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(enquiryContactSchema)) body: z.input<typeof enquiryContactSchema>) {
    return this.enquiriesService.contact(actor, id, body);
  }

  @Post('enquiries/:id/trial')
  bookTrial(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(trialSchema)) body: z.input<typeof trialSchema>) {
    return this.enquiriesService.bookTrial(actor, id, body);
  }

  @Post('enquiries/:id/trial-outcome')
  trialOutcome(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(trialOutcomeSchema)) body: z.input<typeof trialOutcomeSchema>) {
    return this.enquiriesService.trialOutcome(actor, id, body);
  }

  @Post('enquiries/:id/lost')
  lost(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(enquiryLostSchema)) body: z.input<typeof enquiryLostSchema>) {
    return this.enquiriesService.lose(actor, id, body);
  }

  @Post('enquiries/:id/reopen')
  reopen(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enquiriesService.reopen(actor, id);
  }

  @Post('enquiries/:id/convert')
  convert(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(convertEnquirySchema)) body: z.input<typeof convertEnquirySchema>) {
    return this.enquiriesService.convert(actor, id, body);
  }

  /* Every student, across batches */

  @Get('students')
  students(@CurrentUser() actor: AuthUser, @Query(zodPipe(listStudentsQuerySchema)) query: ListStudentsQuery) {
    return this.enrollments.list(actor, query);
  }

  @Post('students/:clientId/hand-over')
  handOver(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string, @Body(zodPipe(handOverSchema)) body: z.input<typeof handOverSchema>) {
    return this.enrollments.handOver(actor, clientId, body);
  }

  /* Enrolments */

  @Post('enrollments')
  enrol(@CurrentUser() actor: AuthUser, @Body(zodPipe(enrolSchema)) body: z.input<typeof enrolSchema>) {
    return this.enrollments.enrol(actor, body);
  }

  @Get('enrollments/:id')
  enrollment(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.get(actor, id);
  }

  @Post('enrollments/:id/transfer')
  transfer(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(transferSchema)) body: z.input<typeof transferSchema>) {
    return this.enrollments.transfer(actor, id, body);
  }

  @Post('enrollments/:id/freeze')
  freeze(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(freezeSchema)) body: z.input<typeof freezeSchema>) {
    return this.enrollments.freeze(actor, id, body);
  }

  @Post('enrollments/:id/resume')
  resume(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.resume(actor, id);
  }

  @Post('enrollments/:id/drop')
  drop(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(reason) body: { reason: string }) {
    return this.enrollments.drop(actor, id, body.reason);
  }

  @Post('enrollments/:id/complete')
  complete(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.complete(actor, id);
  }

  @Get('enrollments/:id/certificate')
  async certificate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const c = await this.enrollments.certificate(actor, id);
    sendFile(res, Readable.from(c.pdf), 'application/pdf', c.name, 'inline');
  }

  /** A student's courses and tests, for their page. */
  @Get('clients/:clientId')
  async forClient(@CurrentUser() actor: AuthUser, @Param('clientId', ParseUUIDPipe) clientId: string) {
    const [enrollments, results] = await Promise.all([this.enrollments.forClient(actor, clientId), this.results.list(actor, { clientId })]);
    return { enrollments, results };
  }

  /* Official tests */

  @Get('results')
  resultList(@CurrentUser() actor: AuthUser, @Query('clientId') clientId?: string, @Query('status') status?: string, @Query('expiring') expiring?: string) {
    return this.results.list(actor, { clientId: uuid(clientId), status, expiring: expiring === 'true' });
  }

  @Post('results')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  addResult(@CurrentUser() actor: AuthUser, @Body() body: Record<string, unknown>, @UploadedFile() file?: Upload) {
    return this.results.save(actor, zodPipe(testResultSchema).transform(formJson(body)) as z.input<typeof testResultSchema>, undefined, file);
  }

  @Put('results/:id')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  saveResult(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @UploadedFile() file?: Upload) {
    return this.results.save(actor, zodPipe(testResultSchema).transform(formJson(body)) as z.input<typeof testResultSchema>, id, file);
  }

  /* One course - last, so the fixed paths above win. */

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courses.get(actor, id);
  }

  @Put(':id')
  save(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(zodPipe(courseSchema)) body: z.input<typeof courseSchema>) {
    return this.courses.save(actor, body, id);
  }
}

/** The student's own courses: schedule, homework to hand in, scores, results, certificates. */
@Roles('client')
@Controller('my-courses')
export class MyCoursesController {
  constructor(
    private readonly enrollments: EnrollmentsService,
    private readonly teaching: TeachingService,
    private readonly results: TestResultsService,
  ) {}

  @Get()
  mine(@CurrentUser() actor: AuthUser) {
    return this.results.mine(actor);
  }

  @Post('homework/:id/submit')
  @UseInterceptors(FileInterceptor('file', uploadLimits))
  submit(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { text?: string }, @UploadedFile() file?: Upload) {
    return this.teaching.submit(actor, id, { text: body.text ?? null }, file);
  }

  @Get('homework/:id/file')
  async homeworkFile(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.teaching.homeworkFile(actor, id);
    sendFile(res, f.stream, f.mime, f.name, 'attachment');
  }

  @Get('submissions/:id/file')
  async submissionFile(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.teaching.submissionFile(actor, id);
    sendFile(res, f.stream, f.mime, f.name, 'attachment');
  }

  @Get('enrollments/:id/certificate')
  async certificate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const c = await this.enrollments.certificate(actor, id);
    sendFile(res, Readable.from(c.pdf), 'application/pdf', c.name, 'inline');
  }
}

/** The public "ask about a course" form on the consultancy's own site. */
@Public()
@Controller('public/courses')
export class CourseEnquiryPublicController {
  constructor(private readonly enquiries: EnquiriesService) {}

  @Get('enquire')
  info(@Site() site: ResolvedHost) {
    if (site.kind !== 'tenant') throw new BadRequest('Ask on the consultancy site.');
    return this.enquiries.publicCourses(site.tenant.id);
  }

  @Post('enquire')
  @UseGuards(FormThrottleGuard)
  enquire(@Site() site: ResolvedHost, @Body(zodPipe(publicEnquirySchema)) body: z.input<typeof publicEnquirySchema>) {
    if (site.kind !== 'tenant') throw new BadRequest('Ask on the consultancy site.');
    return this.enquiries.createPublic(site.tenant.id, body);
  }
}
