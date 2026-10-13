import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { deleteClinicalTemplate, listClinicalTemplates, saveClinicalTemplate } from '../../src/main/services/clinical-templates';
import type { ClinicalTemplateKind } from '../../src/shared/clinical-templates';
import type { PermissionKey } from '../../src/shared/permissions';

let env: TestEnv;
beforeEach(() => { env = createTestEnv('clinical-templates'); });
afterEach(() => cleanupEnv(env));

const examples: { kind: ClinicalTemplateKind; permission: PermissionKey; body: object }[] = [
  { kind: 'visit', permission: 'clinical.visit.create', body: { diagnosis: 'Routine visit', notes: 'General note' } },
  { kind: 'plan', permission: 'clinical.visit.create', body: { treatmentPlan: 'Discuss options' } },
  { kind: 'notes', permission: 'clinical.visit.create', body: { notes: 'Generic examination' } },
  { kind: 'prescription', permission: 'clinical.prescription.create', body: { diagnosis: 'Routine', advice: 'Follow up' } },
  { kind: 'instructions', permission: 'clinical.prescription.create', body: { advice: 'Take with food' } },
  { kind: 'invoice_items', permission: 'billing.invoice.create', body: { items: [{ description: 'Consultation', qty: 1, unitPricePaisa: 50000, treatmentId: null }] } },
];

describe('clinician-authored reusable templates', () => {
  it.each(examples)('$kind can be saved, applied (read), replaced by name and removed without touching records', ({ kind, permission, body }) => {
    const owner = ownerCtx(env);
    const saved = saveClinicalTemplate(owner, { kind, name: 'Routine', body });
    expect(saved.body).toEqual(body);
    expect(listClinicalTemplates(owner, kind)).toHaveLength(1);
    expect(listClinicalTemplates({ ...owner, session: sessionWith([permission]) }, kind)).toHaveLength(1);
    const updated = saveClinicalTemplate(owner, { kind, name: 'ROUTINE', body });
    expect(updated.id).toBe(saved.id);
    expect(listClinicalTemplates(owner, kind)).toHaveLength(1);
    expect(deleteClinicalTemplate(owner, saved.id)).toEqual({ ok: true });
    expect(listClinicalTemplates(owner, kind)).toEqual([]);
    const audit = env.db.prepare("SELECT summary, before_json, after_json FROM audit_log WHERE entity_type = 'clinical_template'").all<{ summary: string; before_json: string | null; after_json: string | null }>();
    expect(audit).toHaveLength(3);
    expect(audit.every((r) => r.before_json === null && r.after_json === null && !r.summary.includes('Consultation'))).toBe(true);
  });

  it('denies guessing a template ID from another domain and refuses unknown kinds', () => {
    const owner = ownerCtx(env);
    const row = saveClinicalTemplate(owner, { kind: 'prescription', name: 'Medication', body: { advice: 'Take with food' } });
    const invoiceOnly = { ...owner, session: sessionWith(['billing.invoice.create']) };
    expect(() => listClinicalTemplates(invoiceOnly, 'prescription')).toThrow(/permission/i);
    expect(() => saveClinicalTemplate(invoiceOnly, { kind: 'prescription', name: 'Wrong', body: { advice: 'x' } })).toThrow(/permission/i);
    expect(() => deleteClinicalTemplate(invoiceOnly, row.id)).toThrow(/permission/i);
    expect(() => listClinicalTemplates(owner, 'unexpected')).toThrow(/kind/i);
    expect(() => deleteClinicalTemplate(owner, 0)).toThrow(/id/i);
  });

  it('validates structure, text length and prices before writing', () => {
    const ctx = ownerCtx(env);
    expect(() => saveClinicalTemplate(ctx, { kind: 'plan', name: 'Empty', body: { notes: 'not a plan' } })).toThrow(/empty/i);
    expect(() => saveClinicalTemplate(ctx, { kind: 'plan', name: 'Too long', body: { treatmentPlan: 'x'.repeat(10_001) } })).toThrow(/text/i);
    expect(() => saveClinicalTemplate(ctx, { kind: 'invoice_items', name: 'Bad price', body: { items: [{ description: 'X', qty: 1, unitPricePaisa: -100 }] } })).toThrow(/price/i);
    expect(() => saveClinicalTemplate(ctx, { kind: 'invoice_items', name: 'Bad qty', body: { items: [{ description: 'X', qty: 0, unitPricePaisa: 100 }] } })).toThrow(/quantity/i);
    expect((env.db.prepare('SELECT COUNT(*) n FROM clinical_templates').get() as { n: number }).n).toBe(0);
  });
});
