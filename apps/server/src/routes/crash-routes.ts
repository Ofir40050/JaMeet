import type { FastifyInstance } from 'fastify';
import { crashReportSchema, type CrashReport, sanitizeLogData } from '@jameet/shared';
import type { CrashReportStore } from '../crashes/crash-store.js';
import { logger } from '../core/logger.js';

export function registerCrashRoutes(app: FastifyInstance, crashStore: CrashReportStore): void {
  // REST Canonical Crash Report Ingestion Endpoint
  app.post('/api/crashes', {
    bodyLimit: 64 * 1024,
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const parsed = crashReportSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn('crash_report_invalid', 'Crash report payload validation failed', {
        reason: parsed.error.issues[0]?.message
      });
      return reply.code(400).send({
        ok: false,
        message: parsed.error.issues[0]?.message || 'Invalid crash report payload.'
      });
    }

    try {
      // Re-sanitize entire crash report payload on the server before storage
      const sanitizedReport = sanitizeLogData(parsed.data) as CrashReport;

      const result = crashStore.recordReport(sanitizedReport);
      if (result.isDuplicate) {
        logger.info('crash_report_duplicate', `Duplicate crash report acknowledged: ${result.report.reportId}`, {
          reportId: result.report.reportId,
          process: result.report.process
        });
        return reply.code(200).send({
          ok: true,
          reportId: result.report.reportId,
          duplicate: true
        });
      }

      logger.info('crash_report_stored', `Crash report durably stored: ${result.report.reportId}`, {
        reportId: result.report.reportId,
        process: result.report.process,
        appVersion: result.report.appVersion,
        platform: result.report.platform,
        reason: result.report.reason
      });

      return reply.code(201).send({
        ok: true,
        reportId: result.report.reportId,
        duplicate: false
      });
    } catch (err) {
      logger.error('crash_report_store_failed', 'Failed to durably store crash report', {}, err);
      return reply.code(500).send({
        ok: false,
        message: 'Failed to persist crash report.'
      });
    }
  });
}
