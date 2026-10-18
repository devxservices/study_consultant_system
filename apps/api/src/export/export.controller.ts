import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { isExportDataset, type AuthUser } from '@crm/shared';
import { CurrentUser, Roles } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions';
import { ExportService } from './export.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

@Roles('consultant', 'manager')
@RequirePermission('data.export')
@Controller('export')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  /** A CSV download. The date range is optional and applies to each dataset's own date. */
  @Get(':dataset')
  async download(
    @CurrentUser() actor: AuthUser,
    @Param('dataset') dataset: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    if (!isExportDataset(dataset)) throw new BadRequestException('There is no export by that name.');
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
      throw new BadRequestException('Dates must be in the form YYYY-MM-DD.');
    }
    if (from && to && from > to) throw new BadRequestException('The start date is after the end date.');

    const file = await this.exports.export(actor, dataset, { from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Export-Rows', String(file.rows));
    res.send(file.body);
  }
}
