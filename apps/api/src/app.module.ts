import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { RequestContextMiddleware } from './common/request-context';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './db/database.module';
import { AuthModule } from './auth/auth.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { AuthGuard } from './auth/auth.guard';
import { RateLimitGuard } from './common/rate-limit';
import { AuditModule } from './audit/audit.module';
import { CasesModule } from './cases/cases.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ClientsModule } from './clients/clients.module';
import { DocumentsModule } from './documents/documents.module';
import { StorageModule } from './storage/storage.module';
import { ConsultantsModule } from './consultants/consultants.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { MessagesModule } from './messages/messages.module';
import { HealthController } from './health.controller';
import { BillingModule } from './billing/billing.module';
import { TasksModule } from './tasks/tasks.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { TeamModule } from './team/team.module';
import { ExportModule } from './export/export.module';
import { SyncModule } from './sync/sync.module';
import { MailModule } from './mail/mail.module';
import { RemindersModule } from './reminders/reminders.module';
import { DriveModule } from './drive/drive.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { CommissionsModule } from './commissions/commissions.module';
import { PartnersModule } from './partners/partners.module';
import { CoursesModule } from './courses/courses.module';
import { SyncInterceptor } from './sync/sync.interceptor';

@Module({
  imports: [
    DatabaseModule,
    MailModule,
    RemindersModule,
    TenancyModule,
    AuthModule,
    AuditModule,
    NotificationsModule,
    CasesModule,
    StorageModule,
    ClientsModule,
    DocumentsModule,
    ConsultantsModule,
    AnalyticsModule,
    MessagesModule,
    BillingModule,
    TasksModule,
    AnnouncementsModule,
    TeamModule,
    ExportModule,
    SyncModule,
    DriveModule,
    WorkflowsModule,
    CommissionsModule,
    PartnersModule,
    CoursesModule,
  ],
  controllers: [HealthController],
  providers: [
    // Authentication is on by default for every route in the app; endpoints
    // opt out explicitly with @Public(). Forgetting a guard cannot leak data.
    { provide: APP_GUARD, useClass: AuthGuard },
    // After AuthGuard (global guards run in this order), so it counts per person.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Every write moves its consultancy's change marker forward (see sync/).
    { provide: APP_INTERCEPTOR, useClass: SyncInterceptor },
  ],
})
export class AppModule implements NestModule {
  /** Every request carries where it came from, for the audit log. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
