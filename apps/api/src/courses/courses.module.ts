import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClientsModule } from '../clients/clients.module';
import { DocumentsModule } from '../documents/documents.module';
import { CoursesService } from './courses.service';
import { EnrollmentsService } from './enrollments.service';
import { TeachingService } from './teaching.service';
import { TestResultsService } from './results.service';
import { CourseEnquiryPublicController, CoursesController, MyCoursesController } from './courses.controller';
import { EnquiriesService } from './enquiries.service';
import { FormThrottleGuard } from '../partners/form-throttle.guard';

/** Courses and test preparation: the catalogue, batches, enrolments, teaching and official tests. */
@Module({
  imports: [BillingModule, ClientsModule, DocumentsModule],
  controllers: [CoursesController, MyCoursesController, CourseEnquiryPublicController],
  providers: [CoursesService, EnrollmentsService, TeachingService, TestResultsService, EnquiriesService, FormThrottleGuard],
  exports: [CoursesService],
})
export class CoursesModule {}
