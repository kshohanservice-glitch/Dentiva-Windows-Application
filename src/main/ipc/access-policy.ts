import { IPC, type PrintDocKind } from '../../shared/ipc';
import type { PermissionKey } from '../../shared/permissions';
import { REPORT_DEFS } from '../../shared/reports';

/**
 * Channels a read-only demo build may call (V5-003).
 *
 * The demo is documented as read-only, enforced in the main process. An
 * allow-list (instead of the former block-list) makes every channel that is
 * not explicitly listed here — including any channel added in the future —
 * refused in demo mode. Exports to files the operator chooses (CSV, PDF,
 * attachment copies) and printing do not modify clinic data and stay allowed.
 */
export const DEMO_ALLOWED_CHANNELS: ReadonlySet<string> = new Set<string>([
  IPC.systemInfo, IPC.systemActivity,
  IPC.activationStatus, IPC.authLogin, IPC.authSession, IPC.setupStatus,
  IPC.settingsGet,
  IPC.patientsList, IPC.patientsGet, IPC.patientsDuplicates, IPC.patientsTimeline, IPC.patientsExport,
  IPC.visitsList, IPC.visitsGet, IPC.chartGet,
  IPC.treatmentsList,
  IPC.prescriptionsList, IPC.prescriptionsGet, IPC.prescriptionsTemplates,
  IPC.clinicalTemplatesList,
  IPC.appointmentsList, IPC.appointmentsAgenda, IPC.appointmentsGet,
  IPC.invoicesList, IPC.invoicesGet, IPC.paymentsList,
  IPC.inventoryItems, IPC.inventoryBatches, IPC.inventorySuppliers,
  IPC.accountingExpenses, IPC.accountingIncomes, IPC.accountingCategories,
  IPC.staffList, IPC.dentistsList,
  IPC.usersList, IPC.rolesList, IPC.auditList,
  IPC.attachmentsList, IPC.attachmentsOpen, IPC.attachmentsExport,
  IPC.backupList,
  IPC.dashboardGet, IPC.notificationsList, IPC.searchGlobal,
  IPC.reportsRun, IPC.reportsExport, IPC.reportsPrint, IPC.reportsSavePdf,
  IPC.referralsList,
  IPC.whatsappDocuments, IPC.whatsappTemplatesList, IPC.whatsappHistory, IPC.whatsappOpen, IPC.whatsappCopyLink,
  IPC.printersList, IPC.printClose, IPC.printExecute, IPC.printPdf,
  IPC.quickDocumentsPayload,
  IPC.onSessionExpired,
]);

export function isDemoAllowed(channel: string): boolean {
  return DEMO_ALLOWED_CHANNELS.has(channel);
}

/** Document kinds that may be opened through `reports/print` / `reports/save-pdf`. */
export const PRINTABLE_KINDS: readonly Exclude<PrintDocKind, 'quick'>[] = [
  'invoice', 'receipt', 'prescription', 'prescription-duplicate',
  'visit-summary', 'appointment-card', 'stock-labels', 'report',
];

export function isPrintableKind(value: unknown): value is Exclude<PrintDocKind, 'quick'> {
  return typeof value === 'string' && (PRINTABLE_KINDS as readonly string[]).includes(value);
}

/**
 * Permissions required to open a print window for a document kind (V5-010).
 *
 * These are exactly the read permissions the print window needs to load the
 * document's data, so a user who could already print keeps that ability; the
 * check only stops a window from being opened by someone who could never read
 * the document. Walk-in documents are opened by `quick-documents/prepare`,
 * which enforces their own create + print permissions.
 */
export function printWindowPermissions(kind: Exclude<PrintDocKind, 'quick'>, reportName?: unknown): PermissionKey[] {
  switch (kind) {
    case 'invoice':
      return ['billing.invoice.view'];
    case 'receipt':
      return ['billing.invoice.view', 'billing.payment.view'];
    case 'prescription':
    case 'prescription-duplicate':
    case 'visit-summary':
      return ['clinical.view'];
    case 'appointment-card':
      return ['appointments.view'];
    case 'stock-labels':
      return ['inventory.view'];
    case 'report': {
      const def = REPORT_DEFS.find((r) => r.name === reportName);
      return def ? [def.permission as PermissionKey] : [];
    }
    default:
      return [];
  }
}
