import type { Ctx } from '../core/context';
import { audit, requirePermission, tx } from '../core/context';
import { notFound, validation } from '../errors';
import { reqString, oneOf } from '../core/validate';
import { nowISO } from '../../shared/currency';
import { TEMPLATE_KINDS, type ClinicalTemplate, type ClinicalTemplateKind, type ClinicalTemplateBody, type InvoiceTemplateItem } from '../../shared/clinical-templates';
import type { PermissionKey } from '../../shared/permissions';

const ACCESS: Record<ClinicalTemplateKind, PermissionKey> = {
  visit: 'clinical.visit.create', plan: 'clinical.visit.create', notes: 'clinical.visit.create',
  prescription: 'clinical.prescription.create', instructions: 'clinical.prescription.create',
  invoice_items: 'billing.invoice.create',
};
const FIELDS: Record<Exclude<ClinicalTemplateKind, 'invoice_items'>, readonly string[]> = {
  visit: ['chiefComplaint', 'history', 'examination', 'diagnosis', 'treatmentPlan', 'advice', 'notes'],
  plan: ['treatmentPlan'], notes: ['notes'],
  prescription: ['cC', 'oE', 'rE', 'diagnosis', 'treatment', 'advice', 'followUp'],
  instructions: ['advice'],
};

function kindOf(value: unknown): ClinicalTemplateKind {
  return oneOf(value, TEMPLATE_KINDS, 'Template kind');
}

function cleanBody(kind: ClinicalTemplateKind, raw: unknown): ClinicalTemplateBody {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validation('Template content must be an object.');
  const input = raw as Record<string, unknown>;
  if (kind === 'invoice_items') {
    const items = input.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 40) throw validation('Invoice template needs 1–40 items.');
    const clean: InvoiceTemplateItem[] = items.map((v: unknown, index: number) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw validation('Invalid invoice template item.');
      const row = v as Record<string, unknown>;
      const description = reqString(row.description, `Item ${index + 1} description`, { max: 300 });
      if (!Number.isSafeInteger(row.qty) || (row.qty as number) < 1 || (row.qty as number) > 999) throw validation('Template quantity must be 1–999.');
      if (!Number.isSafeInteger(row.unitPricePaisa) || (row.unitPricePaisa as number) < 0 || (row.unitPricePaisa as number) > 100_000_000_000) throw validation('Invalid template unit price.');
      if (row.treatmentId != null && (!Number.isSafeInteger(row.treatmentId) || (row.treatmentId as number) < 1)) throw validation('Invalid treatment ID.');
      return { description, qty: row.qty as number, unitPricePaisa: row.unitPricePaisa as number, treatmentId: row.treatmentId == null ? null : row.treatmentId as number };
    });
    return { items: clean };
  }
  const clean: Record<string, string> = {};
  for (const field of FIELDS[kind]) {
    const value = input[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.length > 10_000) throw validation(`Invalid ${field} template text.`);
    clean[field] = value.trim();
  }
  if (!Object.values(clean).some(Boolean)) throw validation('Template content cannot be empty.');
  return clean;
}

interface Row { id: number; kind: ClinicalTemplateKind; name: string; body_json: string; updated_at: string }
function dto(row: Row): ClinicalTemplate {
  return { id: row.id, kind: row.kind, name: row.name, body: JSON.parse(row.body_json), updatedAt: row.updated_at };
}

export function listClinicalTemplates(ctx: Ctx, rawKind: unknown): ClinicalTemplate[] {
  const kind = kindOf(rawKind);
  requirePermission(ctx, ACCESS[kind]);
  return ctx.db.prepare('SELECT id, kind, name, body_json, updated_at FROM clinical_templates WHERE kind = ? ORDER BY name')
    .all<Row>(kind).map(dto);
}

export function saveClinicalTemplate(ctx: Ctx, input: { kind: unknown; name: unknown; body: unknown }): ClinicalTemplate {
  const kind = kindOf(input?.kind);
  requirePermission(ctx, ACCESS[kind]);
  const name = reqString(input?.name, 'Template name', { max: 120 });
  const body = cleanBody(kind, input?.body);
  const now = nowISO();
  return tx(ctx.db, () => {
    const row = ctx.db.prepare(`INSERT INTO clinical_templates (kind, name, body_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, name) DO UPDATE SET body_json = excluded.body_json, updated_at = excluded.updated_at
      RETURNING id, kind, name, body_json, updated_at`)
      .get<Row>(kind, name, JSON.stringify(body), ctx.session.userId, now, now)!;
    audit(ctx, { action: 'clinical_template.save', entityType: 'clinical_template', entityId: row.id, summary: `Saved ${kind} template "${name}"` });
    return dto(row);
  });
}

export function deleteClinicalTemplate(ctx: Ctx, rawId: unknown): { ok: true } {
  if (!Number.isSafeInteger(rawId) || (rawId as number) < 1) throw validation('Invalid template ID.');
  const row = ctx.db.prepare('SELECT id, kind, name FROM clinical_templates WHERE id = ?').get<{ id: number; kind: ClinicalTemplateKind; name: string }>(rawId);
  if (!row) throw notFound('Template not found.');
  requirePermission(ctx, ACCESS[row.kind]);
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM clinical_templates WHERE id = ?').run(row.id);
    audit(ctx, { action: 'clinical_template.delete', entityType: 'clinical_template', entityId: row.id, summary: `Deleted ${row.kind} template "${row.name}"` });
  });
  return { ok: true };
}
