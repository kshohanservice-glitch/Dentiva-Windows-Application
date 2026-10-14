import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../core/context';
import { audit, hasPermission, requirePermission, tx } from '../core/context';
import { notFound, validation } from '../errors';
import { optString, reqInt, reqString, oneOf } from '../core/validate';
import { getSettings } from './settings';
import { ensureDir, safeResolve, sanitizeFilename } from '../paths';
import {
  buildWhatsAppUrl,
  DEFAULT_WHATSAPP_TEMPLATES,
  hasUnresolvedPlaceholders,
  isSafeWhatsAppUrl,
  normalizeWhatsAppNumber,
  placeholderLabel,
  renderWhatsAppTemplate,
  resolveGreeting,
  unknownPlaceholdersIn,
  type WhatsAppTemplateCategory,
} from '../../shared/whatsapp';
import type {
  PatientDocumentDTO,
  WhatsAppDocumentPrepareResult,
  WhatsAppDocumentSelection,
  WhatsAppMessageLogDTO,
  WhatsAppPrepareInput,
  WhatsAppPrepareResult,
  WhatsAppTemplateDTO,
  WhatsAppTemplateSaveInput,
} from '../../shared/types';
import { nowISO } from '../../shared/currency';

/**
 * Free WhatsApp messaging service.
 *
 * Everything here only *prepares* messages and documents. Sending happens
 * when the doctor presses Send inside WhatsApp after the official Click to
 * Chat link opens; PDFs produced by the existing Print flow are attached by
 * hand. No API, token, cloud service or unofficial automation is involved,
 * and a history entry records only the doctor's own reported outcome.
 */

const CATEGORIES: WhatsAppTemplateCategory[] = [
  'appointment_reminder', 'follow_up_reminder', 'appointment_confirmation',
  'rescheduling', 'cancellation', 'pdf_introduction', 'custom',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Consistent document date format used inside patient messages: 20 Oct 2026. */
export function formatMessageDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!MONTHS[m - 1]) return null;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Consistent time format used inside patient messages: 10:30 AM. */
export function formatMessageTime(time: string | null | undefined): string | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

interface PatientRow {
  id: number; code: string; name: string; bengali_name: string | null;
  phone: string | null; whatsapp_number: string | null; whatsapp_consent: string;
}

function loadPatient(ctx: Ctx, patientId: number): PatientRow {
  const id = reqInt(patientId, 'Patient', { min: 1 });
  const row = ctx.db
    .prepare('SELECT id, code, name, bengali_name, phone, whatsapp_number, whatsapp_consent FROM patients WHERE id = ? AND deleted_at IS NULL')
    .get(id) as PatientRow | undefined;
  if (!row) throw notFound('Patient not found.');
  return row;
}

/** Validate the destination and consent state; returns English warnings for the UI. */
function assertDestination(patient: PatientRow): { destination: string; display: string; warnings: string[] } {
  if (!patient.whatsapp_number) {
    throw validation('WhatsApp number is missing for this patient. Add a WhatsApp number from the patient profile, then try again.');
  }
  const normalized = normalizeWhatsAppNumber(patient.whatsapp_number);
  if (!normalized.ok) throw validation(normalized.error);
  if (patient.whatsapp_consent === 'declined') {
    throw validation('This patient has declined WhatsApp messages, so Dentiva Pro will not prepare one. Update the recorded consent only if the patient agrees again.');
  }
  const warnings: string[] = [];
  if (patient.whatsapp_consent !== 'granted') {
    warnings.push('WhatsApp consent has not been recorded for this patient. Confirm the patient agrees to receive WhatsApp messages before sending.');
  }
  return { destination: normalized.international, display: normalized.display, warnings };
}

/* ------------------------- document registry ------------------------- */

function suggestedFileName(typeLabel: string, reference: string | null, documentId: number, date: string): string {
  return sanitizeFilename(`${typeLabel}-${reference ?? documentId}-${(date || '').slice(0, 10)}.pdf`);
}

/**
 * Central registry of every existing patient document Dentiva Pro can
 * already print or save as PDF (see PrintPage): prescriptions, invoices,
 * payment receipts, visit summaries and appointment cards. Filtered by the
 * selected patient and by the caller's existing permissions, and re-derived
 * from the live tables on every call — Patient A's documents can never
 * appear on Patient B's profile.
 */
export function listPatientDocuments(ctx: Ctx, patientId: number): PatientDocumentDTO[] {
  requirePermission(ctx, 'patients.view');
  const patient = loadPatient(ctx, patientId);
  const docs: PatientDocumentDTO[] = [];

  if (hasPermission(ctx, 'clinical.view')) {
    const rx = ctx.db.prepare(
      `SELECT rx.id, rx.number, rx.date, d.name dentist_name FROM prescriptions rx
       LEFT JOIN dentists d ON d.id = rx.dentist_id
       WHERE rx.patient_id = ? AND rx.deleted_at IS NULL ORDER BY rx.date DESC, rx.id DESC LIMIT 200`,
    ).all(patient.id) as { id: number; number: string; date: string; dentist_name: string | null }[];
    for (const r of rx) {
      docs.push({
        key: `prescription:${r.id}`, kind: 'prescription', documentId: r.id,
        typeLabel: 'Prescription', reference: r.number, date: r.date,
        relatedLabel: r.dentist_name, amountPaisa: null, status: null,
        suggestedFileName: suggestedFileName('Prescription', r.number, r.id, r.date),
      });
    }
    const visits = ctx.db.prepare(
      `SELECT v.id, v.datetime, d.name dentist_name FROM visits v
       LEFT JOIN dentists d ON d.id = v.dentist_id
       WHERE v.patient_id = ? AND v.deleted_at IS NULL ORDER BY v.datetime DESC LIMIT 200`,
    ).all(patient.id) as { id: number; datetime: string; dentist_name: string | null }[];
    for (const v of visits) {
      const date = (v.datetime ?? '').slice(0, 10);
      docs.push({
        key: `visit-summary:${v.id}`, kind: 'visit-summary', documentId: v.id,
        typeLabel: 'Visit summary', reference: null, date,
        relatedLabel: v.dentist_name, amountPaisa: null, status: null,
        suggestedFileName: suggestedFileName('Visit summary', null, v.id, date),
      });
    }
  }

  if (hasPermission(ctx, 'billing.invoice.view')) {
    const invoices = ctx.db.prepare(
      `SELECT id, number, date, total_paisa, status, voided_at FROM invoices
       WHERE patient_id = ? AND deleted_at IS NULL ORDER BY date DESC, id DESC LIMIT 200`,
    ).all(patient.id) as { id: number; number: string; date: string; total_paisa: number; status: string; voided_at: string | null }[];
    for (const inv of invoices) {
      docs.push({
        key: `invoice:${inv.id}`, kind: 'invoice', documentId: inv.id,
        typeLabel: 'Invoice', reference: inv.number, date: inv.date,
        relatedLabel: null, amountPaisa: inv.total_paisa,
        status: inv.voided_at ? 'voided' : inv.status,
        suggestedFileName: suggestedFileName('Invoice', inv.number, inv.id, inv.date),
      });
    }
  }

  if (hasPermission(ctx, 'billing.payment.view')) {
    const receipts = ctx.db.prepare(
      `SELECT i.id, i.number, MAX(p.paid_at) last_paid_at,
              (SELECT amount_paisa FROM payments WHERE invoice_id = i.id AND type = 'payment' ORDER BY paid_at DESC, id DESC LIMIT 1) last_amount
       FROM invoices i JOIN payments p ON p.invoice_id = i.id AND p.type = 'payment'
       WHERE i.patient_id = ? AND i.deleted_at IS NULL GROUP BY i.id ORDER BY last_paid_at DESC LIMIT 200`,
    ).all(patient.id) as { id: number; number: string; last_paid_at: string; last_amount: number }[];
    for (const r of receipts) {
      const date = (r.last_paid_at ?? '').slice(0, 10);
      docs.push({
        key: `receipt:${r.id}`, kind: 'receipt', documentId: r.id,
        typeLabel: 'Payment receipt', reference: `Receipt for ${r.number}`, date,
        relatedLabel: r.number, amountPaisa: r.last_amount, status: null,
        suggestedFileName: suggestedFileName('Receipt', r.number, r.id, date),
      });
    }
  }

  if (hasPermission(ctx, 'appointments.view')) {
    const appts = ctx.db.prepare(
      `SELECT a.id, a.date, a.time, a.type, a.status, d.name dentist_name FROM appointments a
       LEFT JOIN dentists d ON d.id = a.dentist_id
       WHERE a.patient_id = ? AND a.deleted_at IS NULL ORDER BY a.date DESC, a.time DESC LIMIT 200`,
    ).all(patient.id) as { id: number; date: string; time: string; type: string; status: string; dentist_name: string | null }[];
    for (const a of appts) {
      docs.push({
        key: `appointment-card:${a.id}`, kind: 'appointment-card', documentId: a.id,
        typeLabel: 'Appointment card', reference: null, date: a.date,
        relatedLabel: [a.type, a.dentist_name].filter(Boolean).join(' · ') || null,
        amountPaisa: null, status: a.status,
        suggestedFileName: suggestedFileName('Appointment card', null, a.id, a.date),
      });
    }
  }

  return docs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.documentId - a.documentId));
}

/** Every selected document must exist in the patient's own registry. */
function assertDocumentsBelong(ctx: Ctx, patientId: number, selections: WhatsAppDocumentSelection[]): PatientDocumentDTO[] {
  if (!Array.isArray(selections) || selections.length === 0) return [];
  if (selections.length > 20) throw validation('Select at most 20 documents at a time.');
  const registry = listPatientDocuments(ctx, patientId);
  const byKey = new Map(registry.map((d) => [d.key, d]));
  const matched: PatientDocumentDTO[] = [];
  for (const sel of selections) {
    const doc = byKey.get(`${sel?.kind}:${Number(sel?.documentId)}`);
    if (!doc) {
      throw validation('One of the selected documents does not belong to this patient or is not available. Refresh the document list and try again.');
    }
    matched.push(doc);
  }
  return matched;
}

/* ------------------------------ templates ---------------------------- */

interface TemplateRow {
  id: number; key: string; name: string; category: string; body: string;
  is_default: number; enabled: number; created_at: string; updated_at: string;
}

function toTemplateDTO(r: TemplateRow): WhatsAppTemplateDTO {
  return {
    id: r.id, key: r.key, name: r.name, category: r.category as WhatsAppTemplateCategory,
    body: r.body, isDefault: !!r.is_default, enabled: !!r.enabled,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const SELECT_TEMPLATE = 'SELECT * FROM whatsapp_templates';

export function listWhatsAppTemplates(ctx: Ctx): WhatsAppTemplateDTO[] {
  requirePermission(ctx, 'patients.view');
  const rows = ctx.db
    .prepare(`${SELECT_TEMPLATE} ORDER BY is_default DESC, category, name`)
    .all() as TemplateRow[];
  return rows.map(toTemplateDTO);
}

function loadTemplate(ctx: Ctx, id: number): TemplateRow {
  const row = ctx.db.prepare(`${SELECT_TEMPLATE} WHERE id = ?`).get(reqInt(id, 'Template', { min: 1 })) as TemplateRow | undefined;
  if (!row) throw notFound('Message template not found.');
  return row;
}

function assertBodyValid(body: string): void {
  const unknown = unknownPlaceholdersIn(body);
  if (unknown.length > 0) {
    throw validation(`Template contains unknown placeholders: ${unknown.map((k) => `{{${k}}}`).join(', ')}. Use the placeholder list shown in the template manager.`);
  }
}

export function saveWhatsAppTemplate(ctx: Ctx, input: WhatsAppTemplateSaveInput): WhatsAppTemplateDTO {
  requirePermission(ctx, 'patients.edit');
  const name = reqString(input?.name, 'Template name', { max: 80 });
  const category = oneOf(input?.category, CATEGORIES, 'Template category');
  const body = reqString(input?.body, 'Template message', { max: 4000 });
  assertBodyValid(body);
  const now = nowISO();
  if (input?.id) {
    const existing = loadTemplate(ctx, Number(input.id));
    tx(ctx.db, () => {
      ctx.db.prepare('UPDATE whatsapp_templates SET name = ?, category = ?, body = ?, enabled = ?, updated_at = ? WHERE id = ?')
        .run(name, category, body, input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0, now, existing.id);
      audit(ctx, { action: 'whatsapp.template_update', entityType: 'whatsapp_template', entityId: existing.id, summary: `Updated WhatsApp message template "${name}"` });
    });
    return toTemplateDTO(loadTemplate(ctx, existing.id));
  }
  const key = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const info = ctx.db.prepare(
    `INSERT INTO whatsapp_templates (key, name, category, body, is_default, enabled, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(key, name, category, body, input?.enabled === false ? 0 : 1, ctx.session.userId, now, now);
  audit(ctx, { action: 'whatsapp.template_create', entityType: 'whatsapp_template', entityId: Number(info.lastInsertRowid), summary: `Created WhatsApp message template "${name}"` });
  return toTemplateDTO(loadTemplate(ctx, Number(info.lastInsertRowid)));
}

export function duplicateWhatsAppTemplate(ctx: Ctx, id: number): WhatsAppTemplateDTO {
  requirePermission(ctx, 'patients.edit');
  const source = loadTemplate(ctx, id);
  const now = nowISO();
  const name = `${source.name} copy`.slice(0, 80);
  const key = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const info = ctx.db.prepare(
    `INSERT INTO whatsapp_templates (key, name, category, body, is_default, enabled, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(key, name, source.category, source.body, source.enabled, ctx.session.userId, now, now);
  audit(ctx, { action: 'whatsapp.template_duplicate', entityType: 'whatsapp_template', entityId: Number(info.lastInsertRowid), summary: `Duplicated WhatsApp message template "${source.name}"` });
  return toTemplateDTO(loadTemplate(ctx, Number(info.lastInsertRowid)));
}

export function setWhatsAppTemplateEnabled(ctx: Ctx, id: number, enabled: boolean): WhatsAppTemplateDTO {
  requirePermission(ctx, 'patients.edit');
  const row = loadTemplate(ctx, id);
  ctx.db.prepare('UPDATE whatsapp_templates SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, nowISO(), row.id);
  return toTemplateDTO(loadTemplate(ctx, row.id));
}

export function restoreWhatsAppTemplate(ctx: Ctx, id: number): WhatsAppTemplateDTO {
  requirePermission(ctx, 'patients.edit');
  const row = loadTemplate(ctx, id);
  const fallback = DEFAULT_WHATSAPP_TEMPLATES.find((t) => t.key === row.key);
  if (!fallback) throw validation('Only a default template can be restored. Custom templates can be edited or deleted instead.');
  ctx.db.prepare('UPDATE whatsapp_templates SET name = ?, category = ?, body = ?, enabled = 1, updated_at = ? WHERE id = ?')
    .run(fallback.name, fallback.category, fallback.body, nowISO(), row.id);
  audit(ctx, { action: 'whatsapp.template_restore', entityType: 'whatsapp_template', entityId: row.id, summary: `Restored default WhatsApp message template "${fallback.name}"` });
  return toTemplateDTO(loadTemplate(ctx, row.id));
}

export function deleteWhatsAppTemplate(ctx: Ctx, id: number): { ok: true } {
  requirePermission(ctx, 'patients.edit');
  const row = loadTemplate(ctx, id);
  if (row.is_default) throw validation('Default templates cannot be deleted. Disable the template instead, or restore it later.');
  ctx.db.prepare('DELETE FROM whatsapp_templates WHERE id = ?').run(row.id);
  audit(ctx, { action: 'whatsapp.template_delete', entityType: 'whatsapp_template', entityId: row.id, summary: `Deleted WhatsApp message template "${row.name}"` });
  return { ok: true };
}

/* --------------------------- message prepare -------------------------- */

interface AppointmentRow {
  id: number; patient_id: number; date: string; time: string; type: string;
  notes: string | null; dentist_name: string | null;
}

function loadAppointment(ctx: Ctx, id: number, patientId: number, label: string): AppointmentRow {
  const row = ctx.db.prepare(
    `SELECT a.id, a.patient_id, a.date, a.time, a.type, a.notes, d.name dentist_name
     FROM appointments a LEFT JOIN dentists d ON d.id = a.dentist_id
     WHERE a.id = ? AND a.deleted_at IS NULL`,
  ).get(reqInt(id, label, { min: 1 })) as AppointmentRow | undefined;
  if (!row) throw notFound(`${label} not found.`);
  if (row.patient_id !== patientId) throw validation(`The selected ${label.toLowerCase()} does not belong to this patient.`);
  return row;
}

function resolveTemplateBody(ctx: Ctx, input: WhatsAppPrepareInput): { body: string; templateId: number | null; templateKey: string | null; category: string } {
  if (input.templateId) {
    const row = loadTemplate(ctx, Number(input.templateId));
    if (!row.enabled) throw validation('The selected template is disabled. Enable it in Message Templates or choose another template.');
    return { body: row.body, templateId: row.id, templateKey: row.key, category: row.category };
  }
  const category = input.category ?? 'custom';
  const row = ctx.db.prepare(
    `${SELECT_TEMPLATE} WHERE category = ? AND enabled = 1 ORDER BY is_default DESC, id LIMIT 1`,
  ).get(category) as TemplateRow | undefined;
  if (row) return { body: row.body, templateId: row.id, templateKey: row.key, category: row.category };
  const fallback = DEFAULT_WHATSAPP_TEMPLATES.find((t) => t.category === category) ?? DEFAULT_WHATSAPP_TEMPLATES[DEFAULT_WHATSAPP_TEMPLATES.length - 1];
  return { body: fallback.body, templateId: null, templateKey: fallback.key, category: fallback.category };
}

export function prepareWhatsAppMessage(ctx: Ctx, input: WhatsAppPrepareInput): WhatsAppPrepareResult {
  requirePermission(ctx, 'patients.view');
  const patient = loadPatient(ctx, Number(input?.patientId));
  const { destination, display, warnings } = assertDestination(patient);
  const settings = getSettings(ctx);
  const { greeting, usedFallbackZone } = resolveGreeting(new Date(), settings.whatsapp.greetingRanges, settings.whatsapp.timezone);
  if (usedFallbackZone) {
    warnings.push('The configured clinic time zone could not be resolved, so the greeting uses this computer\'s local time. Check Settings, Message Templates.');
  }
  if (!greeting) {
    warnings.push('The greeting could not be determined automatically from the configured time ranges. Check the greeting ranges in Settings, Message Templates.');
  }

  const documents = assertDocumentsBelong(ctx, patient.id, input.documents ?? []);
  const appointment = input.appointmentId ? loadAppointment(ctx, Number(input.appointmentId), patient.id, 'Appointment') : null;
  const previous = input.previousAppointmentId ? loadAppointment(ctx, Number(input.previousAppointmentId), patient.id, 'Previous appointment') : null;

  interface VisitContext { datetime: string; follow_up_date: string | null; chief_complaint: string | null; dentist_name: string | null }
  let visit: VisitContext | null = null;
  if (input.visitId) {
    const row = ctx.db.prepare(
      `SELECT v.patient_id, v.datetime, v.follow_up_date, v.chief_complaint, d.name dentist_name
       FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id
       WHERE v.id = ? AND v.deleted_at IS NULL`,
    ).get(reqInt(input.visitId, 'Visit', { min: 1 })) as (VisitContext & { patient_id: number }) | undefined;
    if (!row) throw notFound('Visit not found.');
    if (row.patient_id !== patient.id) throw validation('The selected visit does not belong to this patient.');
    visit = row;
  }

  const clinic = settings.clinic;
  const context: Record<string, string | null> = {
    'সময়ের_গ্রিটিং': greeting,
    'রোগীর_নাম': patient.bengali_name || patient.name,
    'রোগীর_আইডি': patient.code,
    'হোয়াটসঅ্যাপ_নম্বর': display,
    'ক্লিনিকের_নাম': clinic.clinicName || null,
    'ক্লিনিকের_ফোন': clinic.phone,
    'ক্লিনিকের_ঠিকানা': clinic.address,
    'ডেন্টিস্টের_নাম': appointment?.dentist_name ?? visit?.dentist_name ?? null,
    'অ্যাপয়েন্টমেন্টের_তারিখ': formatMessageDate(appointment?.date),
    'অ্যাপয়েন্টমেন্টের_সময়': formatMessageTime(appointment?.time),
    'অ্যাপয়েন্টমেন্টের_কারণ': appointment ? (appointment.notes || appointment.type || null) : null,
    'ফলোআপের_তারিখ': formatMessageDate(appointment?.date ?? visit?.follow_up_date),
    'ফলোআপের_সময়': formatMessageTime(appointment?.time),
    'ফলোআপের_কারণ': appointment ? (appointment.notes || appointment.type || null) : (visit?.chief_complaint ?? null),
    'পুরোনো_তারিখ': formatMessageDate(previous?.date ?? appointment?.date),
    'পুরোনো_সময়': formatMessageTime(previous?.time ?? appointment?.time),
    'নতুন_তারিখ': formatMessageDate(appointment?.date),
    'নতুন_সময়': formatMessageTime(appointment?.time),
    'ডকুমেন্টের_নাম': documents.length ? documents.map((d) => (d.reference ? `${d.typeLabel} ${d.reference}` : d.typeLabel)).join(', ') : null,
    'ডকুমেন্টের_তারিখ': documents.length ? documents.map((d) => formatMessageDate(d.date) ?? d.date).join(', ') : null,
    'বার্তার_মূল_বিষয়': input.customBody ?? null,
  };

  const resolved = resolveTemplateBody(ctx, input);
  let message: string;
  if (input.messageOverride !== undefined && input.messageOverride !== null) {
    message = String(input.messageOverride).trim();
    if (!message) throw validation('Message is empty. Write a message or restore the generated text.');
    if (hasUnresolvedPlaceholders(message)) {
      throw validation('The message still contains unresolved placeholders ({{...}}). Replace or remove them before opening WhatsApp.');
    }
    if (message.length > 4000) throw validation('Message is too long (max 4000 characters).');
  } else {
    const rendered = renderWhatsAppTemplate(resolved.body, context);
    message = rendered.text;
    if (!message) throw validation('The generated message is empty. Check the template and patient information.');
    if (rendered.missingRequired.length > 0) {
      warnings.push(`Missing required information: ${rendered.missingRequired.map(placeholderLabel).join(', ')}. Add it before sending if it should appear in the message.`);
    }
    const optionalMissing = rendered.missing.filter((k) => !rendered.missingRequired.includes(k));
    if (optionalMissing.length > 0) {
      warnings.push(`Some optional information is missing and was left out of the message: ${optionalMissing.map(placeholderLabel).join(', ')}.`);
    }
    if (rendered.unknown.length > 0) {
      warnings.push(`Unknown placeholders were removed from the message: ${rendered.unknown.join(', ')}.`);
    }
  }

  const url = buildWhatsAppUrl(destination, message);
  let logId: number | null = null;
  if (!input.dryRun) {
    const now = nowISO();
    const info = ctx.db.prepare(
      `INSERT INTO whatsapp_message_log (patient_id, template_id, template_key, category, destination_number, message_preview, documents_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`,
    ).run(
      patient.id, resolved.templateId, resolved.templateKey, resolved.category,
      destination, message.slice(0, 300),
      documents.length ? JSON.stringify(documents.map((d) => ({ kind: d.kind, documentId: d.documentId }))) : null,
      ctx.session.userId, now, now,
    );
    logId = Number(info.lastInsertRowid);
    audit(ctx, {
      action: 'whatsapp.prepare', entityType: 'patient', entityId: patient.id,
      summary: `Prepared a WhatsApp message for ${patient.name} (${patient.code}) — not sent by Dentiva Pro`,
    });
  }

  return {
    logId, url, message, greeting,
    destination, destinationDisplay: display,
    patientName: patient.name, warnings,
  };
}

/* ------------------------- document share prep ------------------------ */

function cleanupOldShareFolders(ctx: Ctx): void {
  try {
    const base = safeResolve(ctx.paths.tempDir, 'whatsapp');
    if (!fs.existsSync(base)) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = safeResolve(base, entry.name);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch { /* cleanup is best effort; sharing must not fail because of it */ }
}

/**
 * Validate a document selection and prepare the share session: a Bengali
 * introduction message, an organized folder in the app's temp area, and a
 * manifest naming every selected document. The PDFs themselves are produced
 * by the existing Print → Save PDF flow into that folder; Click to Chat
 * cannot attach files, so the doctor attaches them manually in WhatsApp.
 * Temporary share folders are removed after 24 hours; original clinic
 * documents are never touched.
 */
export function prepareWhatsAppDocuments(
  ctx: Ctx,
  input: { patientId: number; documents: WhatsAppDocumentSelection[] },
): WhatsAppDocumentPrepareResult {
  requirePermission(ctx, 'patients.view');
  const patient = loadPatient(ctx, Number(input?.patientId));
  const { display, warnings } = assertDestination(patient);
  const documents = assertDocumentsBelong(ctx, patient.id, input?.documents ?? []);
  if (documents.length === 0) throw validation('Select at least one document to share.');

  const prepared = prepareWhatsAppMessage(ctx, {
    patientId: patient.id,
    category: 'pdf_introduction',
    documents: input.documents,
  });
  warnings.push(...prepared.warnings.filter((w) => !warnings.includes(w)));

  cleanupOldShareFolders(ctx);
  const shareFolder = safeResolve(ctx.paths.tempDir, 'whatsapp', `${patient.id}-${Date.now()}`);
  ensureDir(shareFolder);
  const manifest = [
    'Dentiva Pro — WhatsApp document share (prepared, not sent)',
    `Patient: ${patient.name} (${patient.code})`,
    `WhatsApp destination: ${display}`,
    `Prepared at: ${new Date().toISOString()}`,
    '',
    'Save each PDF into this folder from its Print preview (Save PDF button), using the suggested file names:',
    ...documents.map((d, i) => `${i + 1}. ${d.typeLabel}${d.reference ? ` — ${d.reference}` : ''} (${d.date}) -> ${d.suggestedFileName}`),
    '',
    'Then attach the PDF files manually in WhatsApp and press Send there.',
    'Dentiva Pro does not attach or send files automatically.',
    'This temporary folder is deleted automatically after 24 hours. Original clinic documents are not affected.',
  ].join('\n');
  fs.writeFileSync(path.join(shareFolder, 'SHARE-MANIFEST.txt'), manifest, 'utf8');

  audit(ctx, {
    action: 'whatsapp.prepare_documents', entityType: 'patient', entityId: patient.id,
    summary: `Prepared ${documents.length} document(s) for manual WhatsApp sharing for ${patient.name} (${patient.code})`,
  });

  return {
    patientId: patient.id,
    patientName: patient.name,
    destinationDisplay: display,
    documents,
    introMessage: prepared.message,
    greeting: prepared.greeting,
    shareFolder,
    warnings,
    logId: prepared.logId,
  };
}

/* ------------------------------- history ------------------------------ */

interface LogRow {
  id: number; patient_id: number; template_key: string | null; category: string | null;
  destination_number: string | null; message_preview: string | null; documents_json: string | null;
  status: string; created_at: string; updated_at: string;
}

function toLogDTO(r: LogRow): WhatsAppMessageLogDTO {
  let documents: WhatsAppDocumentSelection[] = [];
  try {
    const parsed = r.documents_json ? JSON.parse(r.documents_json) : [];
    if (Array.isArray(parsed)) documents = parsed;
  } catch { /* a corrupt history row must not break the list */ }
  return {
    id: r.id, patientId: r.patient_id, templateKey: r.template_key, category: r.category,
    destinationNumber: r.destination_number, messagePreview: r.message_preview,
    documents, status: r.status as WhatsAppMessageLogDTO['status'],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listWhatsAppHistory(ctx: Ctx, patientId: number): WhatsAppMessageLogDTO[] {
  requirePermission(ctx, 'patients.view');
  const patient = loadPatient(ctx, patientId);
  const rows = ctx.db.prepare(
    'SELECT * FROM whatsapp_message_log WHERE patient_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
  ).all(patient.id) as LogRow[];
  return rows.map(toLogDTO);
}

/** Record the doctor's own report. This is never a delivery receipt. */
export function recordWhatsAppStatus(ctx: Ctx, logId: number, status: string): WhatsAppMessageLogDTO {
  requirePermission(ctx, 'patients.view');
  const next = oneOf(status, ['sent', 'not_sent', 'unknown'] as const, 'Message status');
  const row = ctx.db.prepare('SELECT * FROM whatsapp_message_log WHERE id = ?')
    .get(reqInt(logId, 'Message history entry', { min: 1 })) as LogRow | undefined;
  if (!row) throw notFound('Message history entry not found.');
  ctx.db.prepare('UPDATE whatsapp_message_log SET status = ?, updated_at = ? WHERE id = ?')
    .run(next, nowISO(), row.id);
  audit(ctx, {
    action: 'whatsapp.status', entityType: 'patient', entityId: row.patient_id,
    summary: `Doctor reported WhatsApp message outcome "${next}" (self-reported, not a delivery receipt)`,
  });
  const updated = ctx.db.prepare('SELECT * FROM whatsapp_message_log WHERE id = ?').get(row.id) as LogRow;
  return toLogDTO(updated);
}

/* ------------------------------ open link ----------------------------- */

/** The only external URLs this feature may open: official wa.me links. */
export function assertSafeWhatsAppOpenUrl(value: unknown): string {
  const url = optString(value, 'WhatsApp link', { max: 8000 });
  if (!url || !isSafeWhatsAppUrl(url)) {
    throw validation('Refusing to open an unsafe or invalid WhatsApp link.');
  }
  return url;
}
