import { BrowserWindow, dialog, app, type WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { PrintProfile } from '../shared/types';
import { AppError } from './errors';

export interface PrintDocRef { type: import('../shared/ipc').PrintDocKind; id: number; reportName?: string; profileId?: string }

let printWindow: BrowserWindow | null = null;

function appHtml(): string {
  return path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
}

export function openPrintWindow(doc: PrintDocRef): void {
  const hash = `#print/${doc.type}/${doc.id}${doc.reportName ? `?report=${encodeURIComponent(doc.reportName)}` : ''}${doc.profileId ? `${doc.reportName ? '&' : '?'}profile=${encodeURIComponent(doc.profileId)}` : ''}`;
  if (printWindow && !printWindow.isDestroyed()) {
    printWindow.focus();
    printWindow.loadFile(appHtml(), { hash: hash.slice(1) });
    return;
  }
  printWindow = new BrowserWindow({
    width: 1000,
    height: 860,
    minWidth: 720,
    minHeight: 540,
    title: 'Print — Dentiva Pro',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  printWindow.once('ready-to-show', () => printWindow?.show());
  printWindow.on('closed', () => { printWindow = null; });
  void printWindow.loadFile(appHtml(), { hash: hash.slice(1) });
}

export function getPrintContents(): WebContents {
  if (printWindow && !printWindow.isDestroyed()) return printWindow.webContents;
  throw new AppError('INTERNAL', 'Print window is not open.');
}

export interface PrintExecuteOptions {
  printerName?: string | null;
  silent?: boolean;
  copies?: number;
  landscape?: boolean;
  color?: boolean;
}

export type PrintResult = { ok: true } | { ok: false; cancelled?: boolean; error: string };

export async function executePrint(opts: PrintExecuteOptions): Promise<PrintResult> {
  const wc = getPrintContents();
  try {
    const ok = await new Promise<boolean>((resolve, reject) => {
      wc.print(
        {
          silent: opts.silent ?? false,
          deviceName: opts.printerName ?? '',
          copies: Math.max(1, Math.min(99, Number(opts.copies) || 1)),
          landscape: !!opts.landscape,
          color: opts.color !== false,
          margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
          pagesPerSheet: 1,
          scaleFactor: 100,
        },
        (success, failureReason) => {
          if (success) resolve(true);
          else if (failureReason === 'cancelled') resolve(false);
          else reject(new Error(failureReason || 'Print failed'));
        },
      );
    });
    if (!ok) return { ok: false, cancelled: true, error: 'Print job was cancelled.' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Print failed.' };
  }
}

export interface PdfOptions {
  suggestedName: string;
  widthMm: number;
  heightMm: number;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
}

export type PdfResult = { ok: true; path: string } | { ok: false; cancelled?: boolean; error: string };

export async function saveAsPdf(opts: PdfOptions): Promise<PdfResult> {
  const win = BrowserWindow.getFocusedWindow() ?? printWindow;
  if (!win || win.isDestroyed()) return { ok: false, error: 'Print window is not open.' };
  const save = await dialog.showSaveDialog(win, {
    title: 'Save as PDF',
    defaultPath: `${opts.suggestedName}.pdf`,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, cancelled: true, error: 'Save cancelled.' };

  try {
    // Micron units (1 mm = 1000 microns) per Electron printToPDF API.
    const m = opts.marginsMm ?? { top: 10, right: 10, bottom: 10, left: 10 };
    const data = await win.webContents.printToPDF({
      pageSize: { width: Math.round(opts.widthMm * 1000), height: Math.round(opts.heightMm * 1000) },
      margins: {
        top: Math.round(m.top * 1000),
        right: Math.round(m.right * 1000),
        bottom: Math.round(m.bottom * 1000),
        left: Math.round(m.left * 1000),
      },
      printBackground: true,
    });
    fs.writeFileSync(save.filePath, data);
    const stat = fs.statSync(save.filePath);
    if (stat.size <= 0) throw new Error('PDF file was not written.');
    return { ok: true, path: save.filePath };
  } catch (e: any) {
    try { if (fs.existsSync(save.filePath)) fs.rmSync(save.filePath, { force: true }); } catch { /* best effort */ }
    return { ok: false, error: e?.message ?? 'PDF generation failed.' };
  }
}

export interface PrinterInfo {
  name: string; displayName: string; description: string; options: Record<string, string>;
}

export async function listPrinters(from: WebContents): Promise<PrinterInfo[]> {
  try {
    // Electron ≥43: PrinterInfo exposes name/displayName/description/options —
    // status/isDefault were removed from the API (Chromium print backend change).
    const printers = await from.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      description: (p as { description?: string }).description ?? '',
      options: (p.options ?? {}) as Record<string, string>,
    }));
  } catch {
    return [];
  }
}

export function profilePageCss(profile: PrintProfile): string {
  const portrait = profile.orientation !== 'landscape';
  const w = profile.paperSize === 'a4' ? 210 : profile.paperSize === 'a5' ? 148 : profile.widthMm;
  const h = profile.paperSize === 'a4' ? 297 : profile.paperSize === 'a5' ? 210 : profile.heightMm;
  const width = portrait ? w : h;
  const height = portrait ? h : w;
  const m = profile.margins;
  return `@page { size: ${width}mm ${height}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
}
