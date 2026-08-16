import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CrashReport } from '@jameet/shared';
import { logger } from './logger.js';

export const MAX_CRASH_REPORTS = 500;

export interface StoredCrashReport extends CrashReport {
  reportId: string;
  receivedAt: string;
}

interface CrashStoreSchema {
  version: 1;
  reports: StoredCrashReport[];
}

export class CrashReportStore {
  private reports = new Map<string, StoredCrashReport>();
  private dataFilePath: string;

  constructor(dataDir: string) {
    this.dataFilePath = path.join(dataDir, 'crash-reports.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.dataFilePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.reports)) {
        this.reports.clear();
        for (const report of parsed.reports) {
          if (report && typeof report === 'object' && report.reportId) {
            this.reports.set(report.reportId, report as StoredCrashReport);
          }
        }
      } else {
        this.quarantineCorruptedFile(new Error('Invalid crash store format'));
      }
    } catch (err) {
      this.quarantineCorruptedFile(err);
    }
  }

  private quarantineCorruptedFile(error: unknown): void {
    const timestamp = Date.now();
    const corruptedPath = `${this.dataFilePath}.corrupted.${timestamp}.json`;
    try {
      if (fs.existsSync(this.dataFilePath)) {
        fs.renameSync(this.dataFilePath, corruptedPath);
        logger.warn('crash_store_quarantined', `Corrupted crash report store quarantined to ${corruptedPath}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } catch (renameErr) {
      logger.warn('crash_store_quarantine_failed', 'Failed to rename corrupted crash store file', {
        error: renameErr instanceof Error ? renameErr.message : String(renameErr)
      });
    }
    this.reports.clear();
  }

  private persistReportsToDisk(reportsList: StoredCrashReport[]): void {
    const schema: CrashStoreSchema = {
      version: 1,
      reports: reportsList
    };

    const dir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${this.dataFilePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(schema, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.dataFilePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {}
      throw err;
    }
  }

  recordReport(report: CrashReport): { isDuplicate: boolean; report: StoredCrashReport } {
    const reportId = report.reportId || crypto.randomUUID();

    // 1. Check if already durably stored
    const existing = this.reports.get(reportId);
    if (existing) {
      return { isDuplicate: true, report: existing };
    }

    const storedReport: StoredCrashReport = {
      ...report,
      reportId,
      receivedAt: new Date().toISOString()
    };

    // 2. Prepare prospective state bounded to MAX_CRASH_REPORTS
    const currentList = Array.from(this.reports.values());
    const nextList = [...currentList, storedReport];
    const prunedList = nextList.length > MAX_CRASH_REPORTS
      ? nextList.slice(nextList.length - MAX_CRASH_REPORTS)
      : nextList;

    // 3. Perform durable persistence BEFORE updating authoritative in-memory state
    this.persistReportsToDisk(prunedList);

    // 4. Update authoritative in-memory map only after durable save succeeds
    this.reports.clear();
    for (const r of prunedList) {
      this.reports.set(r.reportId, r);
    }

    return { isDuplicate: false, report: storedReport };
  }

  getReports(): StoredCrashReport[] {
    return Array.from(this.reports.values());
  }

  getReportById(reportId: string): StoredCrashReport | undefined {
    return this.reports.get(reportId);
  }

  getReportCount(): number {
    return this.reports.size;
  }
}
