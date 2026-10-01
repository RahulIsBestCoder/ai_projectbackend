import ejs from 'ejs';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { reportChart } from './report_chart';

const execFileAsync = promisify(execFile);

export interface PreparedReportPdf {
  filePath: string;
  fileName: string;
  cleanup: () => Promise<void>;
}

export class ReportPdfService {
  private templatePath(): string {
    const runtimePath = global.path || path.resolve(__dirname, '../../..');
    return path.join(runtimePath, 'views', 'report_templates', 'project_report.ejs');
  }

  private async browserPath(): Promise<string> {
    const configured = process.env.PDF_BROWSER_PATH;
    const candidates = [
      configured,
      process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
      process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : undefined,
      process.platform === 'win32' ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : undefined,
      process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined,
      process.platform !== 'win32' ? '/usr/bin/google-chrome' : undefined,
      process.platform !== 'win32' ? '/usr/bin/chromium' : undefined,
      process.platform !== 'win32' ? '/usr/bin/chromium-browser' : undefined,
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      try { await fs.access(candidate); return candidate; } catch { /* try the next installed browser */ }
    }
    throw new Error('PDF browser not found. Set PDF_BROWSER_PATH to Chrome, Edge, or Chromium.');
  }

  public async prepare(reportRecord: any): Promise<PreparedReportPdf> {
    const report = reportRecord?.report_data || reportRecord?.definition?.generated_report;
    if (!report) throw new Error('REPORT_DATA_MISSING');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-project-report-'));
    const htmlPath = path.join(tempDir, 'report.html');
    const pdfPath = path.join(tempDir, 'report.pdf');
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await fs.rm(tempDir, { recursive: true, force: true });
    };
    try {
      const html = await ejs.renderFile(this.templatePath(), { report, record: reportRecord, reportChart });
      await fs.writeFile(htmlPath, html, 'utf8');
      const browser = await this.browserPath();
      await execFileAsync(browser, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
        '--print-to-pdf-no-header', `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
      ], { timeout: 60000, windowsHide: true });
      const stat = await fs.stat(pdfPath);
      if (!stat.isFile() || stat.size === 0) throw new Error('PDF generation produced an empty file.');
      const safeName = String(reportRecord?.name || report?.report?.title || 'project-report')
        .replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'project-report';
      return { filePath: pdfPath, fileName: `${safeName}.pdf`, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}
