import { useEffect, useMemo, useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, Tabs, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';
import { ClinicalTemplatePicker } from '../components/ClinicalTemplatePicker';
import { MedicineEntryEditor, type MedicineEntryValues } from '../components/medicine-entry-editor';
import { Money } from '../components/money';
import { DocumentPreview } from '../documents/document-preview';
import { quickDocumentNode, quickDocumentTitle } from '../documents/quick-document-view';
import { Icon } from '../components/shell';
import {
  QUICK_DOCUMENT_DEFS, QUICK_DOCUMENT_KINDS, quickDocumentReference, validateQuickDocumentInput,
  type QuickDocumentInput, type QuickDocumentKind,
} from '../../shared/quick-documents';
import { formatBdt, parseBdtToPaisa, todayISO } from '../../shared/currency';
import { computeInvoiceTotals } from '../../shared/billing-math';
import { CHIEF_COMPLAINT_OPTIONS, EXAMINATION_OPTIONS, clinicalChoice } from '../../shared/clinical-options';
import { pageSizeForDocument } from '../../shared/document-watermark';
import type { DentistDTO, TreatmentDTO } from '../../shared/types';

/**
 * Walk-in / Quick Documents.
 *
 * Prints any of the clinic's documents for a person who is not (and does not
 * become) a registered patient. Deliberately:
 *
 *   - the payload is validated by the shared validator before it leaves this
 *     screen, and again in the main process;
 *   - the document is held in memory only — no patient row, no invoice row, no
 *     prescription row, no draft is ever written;
 *   - the document is rendered by the same builders and printed by the same
 *     print window as stored documents, so the template is identical;
 *   - there is no WhatsApp action, link or message anywhere in this workflow.
 */
export function QuickDocumentsPage() {
  const { settings, can } = useApp();
  const toast = useToast();
  const [kind, setKind] = useState<QuickDocumentKind>('prescription');
  const [form, setForm] = useState<any>(() => emptyForm('prescription'));
  const [previewKey, setPreviewKey] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const dentists = useAsync<DentistDTO[]>(() => api['dentists/list'](), []);
  const treatments = useAsync<TreatmentDTO[]>(() => api['treatments/list'](), []);

  const allowed = QUICK_DOCUMENT_KINDS.filter((k) => can(QUICK_DOCUMENT_DEFS[k].permission));
  const def = QUICK_DOCUMENT_DEFS[kind];

  // If the signed-in role may not print the current kind, fall back to one it may.
  useEffect(() => {
    if (allowed.length > 0 && !allowed.includes(kind)) {
      setKind(allowed[0]);
      setForm(emptyForm(allowed[0]));
    }
  }, [allowed, kind]);

  const set = (path: string[], value: unknown): void => {
    setForm((f: any) => {
      const next = JSON.parse(JSON.stringify(f));
      let node = next;
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
      node[path[path.length - 1]] = value;
      return next;
    });
  };

  /** Turn editor state into a quick-document input (money/date normalization only). */
  const buildInput = (): unknown => {
    const customer = {
      name: form.customer.name,
      phone: form.customer.phone,
      ageYears: form.customer.ageYears === '' ? null : Number(form.customer.ageYears),
      gender: form.customer.gender || null,
    };
    const reference = quickDocumentReference(kind);
    switch (kind) {
      case 'prescription':
        return {
          kind, payload: {
            reference, date: form.date, customer,
            dentistId: form.dentistId ? Number(form.dentistId) : null,
            dentistName: form.dentistName || dentistName(form.dentistId),
            cC: (form.cC === 'Other' ? form.ccOther : form.cC) || null,
            oE: (form.oE === 'Other' ? form.oeOther : form.oE) || null,
            rE: form.rE || null,
            diagnosis: form.diagnosis || null, treatment: form.treatment || null,
            advice: form.advice || null, followUp: form.followUp || null,
            items: form.medicines.filter((m: any) => m.medicineName.trim()).map((m: any) => ({
              medicineName: m.medicineName, generic: m.generic || null, strength: m.strength || null,
              form: m.form || null, dosage: m.dosage || null, frequency: m.frequency || null,
              duration: m.duration || null, qty: m.qty || null, instruction: m.instruction || null,
              medicineInstruction: m.medicineInstruction || null,
            })),
          },
        };
      case 'invoice':
        return {
          kind, payload: {
            reference, date: form.date, customer,
            lines: form.lines.filter((l: any) => l.description.trim()).map((l: any) => ({
              description: l.description, qty: Number(l.qty) || 0,
              unitPricePaisa: parseBdtToPaisa(l.unitPrice) ?? 0,
              discountPaisa: parseBdtToPaisa(l.discount) ?? 0,
            })),
            invoiceDiscountPaisa: parseBdtToPaisa(form.invoiceDiscount) ?? 0,
            amountReceivedPaisa: parseBdtToPaisa(form.amountReceived) ?? 0,
            method: form.method || null,
            note: form.note || null,
          },
        };
      case 'receipt':
        return {
          kind, payload: {
            reference, date: form.date, customer,
            amountPaisa: parseBdtToPaisa(form.amount) ?? 0,
            method: form.method || null,
            paymentReference: form.paymentReference || null,
          },
        };
      case 'visit-summary':
        return {
          kind, payload: {
            reference, date: form.date, customer,
            dentistName: form.dentistName || dentistName(form.dentistId),
            chiefComplaint: form.chiefComplaint || null, diagnosis: form.diagnosis || null,
            treatmentNotes: form.treatmentNotes || null,
            nextVisitDate: form.nextVisitDate || null, nextVisitPurpose: form.nextVisitPurpose || null,
            procedures: form.procedures.filter((p: any) => p.treatmentName.trim()).map((p: any) => ({
              toothNumber: p.toothNumber || null, treatmentName: p.treatmentName,
              qty: Number(p.qty) || 0, unitPricePaisa: parseBdtToPaisa(p.unitPrice) ?? 0,
            })),
          },
        };
      case 'appointment-card':
        return {
          kind, payload: {
            reference, date: form.date, customer,
            time: form.time, dentistName: form.dentistName || dentistName(form.dentistId),
            purpose: form.purpose || null,
          },
        };
    }
  };

  function dentistName(id: string | number | null | undefined): string | null {
    const found = (dentists.data ?? []).find((d) => String(d.id) === String(id ?? ''));
    return found ? found.name : null;
  }

  const input: QuickDocumentInput | null = useMemo(() => {
    const built = buildInput() as QuickDocumentInput;
    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, kind, dentists.data]);

  // Preview through the shared validator so the preview and the print job agree.
  const validated = useMemo(() => validateForPreview(input), [input]);

  const previewCtx = useMemo(() => {
    const dentist = (dentists.data ?? []).find((d) => String(d.id) === String(form.dentistId ?? '')) ?? null;
    return {
      clinic: settings?.clinic ?? { clinicName: 'Dentiva', clinicNameBn: null, logoPath: null, logoDataUrl: null, address: null, phone: null, email: null, website: null, operatingHours: null, visitingDays: null, currency: 'BDT' },
      settings: settings ?? undefined,
      dentist: validated.input ? dentist : null,
    };
  }, [settings, dentists.data, form.dentistId, validated.input]);

  const print = async (): Promise<void> => {
    if (!validated.input) {
      setErrors(validated.errors.length ? validated.errors : ['Complete the document before printing.']);
      toast.error('Nothing printed', validated.errors[0]);
      return;
    }
    setPrinting(true);
    try {
      await api['quick-documents/prepare'](validated.input);
      toast.success('Print window opened', 'Nothing was saved to a patient record.');
    } catch (err) {
      toast.fromError(err, 'Could not prepare the document');
    } finally {
      setPrinting(false);
      setPreviewKey((k) => k + 1);
    }
  };

  if (allowed.length === 0) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Walk-in / Quick Documents</h1></div>
        <Card><p className="small muted" style={{ margin: 0 }}>Your role does not include permission to create any document from this screen.</p></Card>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Walk-in / Quick Documents</h1>
          <p className="page-subtitle">One-time customers · nothing is saved to a patient record</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => { setForm(emptyForm(kind)); setErrors([]); }}>Clear</Button>
          <Button variant="primary" icon={Icon.print} loading={printing} onClick={() => void print()}>
            Preview &amp; print
          </Button>
        </div>
      </div>

      <div className="callout callout-info" role="note">
        <strong>No patient record is created.</strong> This document is used once and discarded: the customer is not
        registered and no invoice, prescription or visit is stored. To keep a record, register the patient and use the
        normal screens.
      </div>

      <Tabs tabs={allowed.map((k) => ({ key: k, label: QUICK_DOCUMENT_DEFS[k].label }))} active={kind} onChange={(k) => { setKind(k); setForm(emptyForm(k)); setErrors([]); }} />

      <div className="quick-grid mt-4">
        <Card title={def.label} actions={<Badge tone="neutral">{def.referencePrefix}-…</Badge>}>
          <p className="xsmall muted" style={{ marginTop: 0 }}>{def.limitation}</p>
          <div className="form-grid">
            <Field label="Customer name" required>{(id) => <Input id={id} value={form.customer.name} onChange={(v) => set(['customer', 'name'], v)} placeholder="Walk-in customer" autoFocus />}</Field>
            <Field label="Phone">{(id) => <Input id={id} value={form.customer.phone} onChange={(v) => set(['customer', 'phone'], v)} placeholder="01XXXXXXXXX" inputMode="tel" />}</Field>
            <Field label="Age (years)">{(id) => <Input id={id} type="number" min={0} max={130} value={String(form.customer.ageYears ?? '')} onChange={(v) => set(['customer', 'ageYears'], v)} />}</Field>
            <Field label="Gender">
              {(id) => (
                <Select id={id} value={form.customer.gender ?? ''} onChange={(v) => set(['customer', 'gender'], v)} placeholder="Not specified"
                  options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }]} />
              )}
            </Field>
            <Field label="Date" required>{(id) => <Input id={id} type="date" value={form.date} onChange={(v) => set(['date'], v)} />}</Field>
            {kind !== 'receipt' && (
              <>
                <Field label="Dentist">
                  {(id) => (
                    <Select id={id} value={String(form.dentistId ?? '')} onChange={(v) => set(['dentistId'], v)} placeholder="Not selected"
                      options={(dentists.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))} />
                  )}
                </Field>
                <Field
                  label="Dentist name (typed)"
                  required={kind === 'prescription' && !form.dentistId}
                >
                  {(id) => <Input id={id} value={form.dentistName} onChange={(v) => set(['dentistName'], v)} disabled={!!form.dentistId} />}
                </Field>
              </>
            )}
          </div>

          {kind === 'prescription' && <PrescriptionFields form={form} set={set} showNameErrors={errors.some((error) => /medicine/i.test(error))} />}
          {kind === 'invoice' && <InvoiceFields form={form} set={set} treatments={treatments.data ?? []} />}
          {kind === 'receipt' && <ReceiptFields form={form} set={set} />}
          {kind === 'visit-summary' && <VisitFields form={form} set={set} treatments={treatments.data ?? []} />}
          {kind === 'appointment-card' && <AppointmentFields form={form} set={set} />}

          {errors.length > 0 && (
            <div className="callout callout-warning mt-4" role="alert">
              <strong>Check the following:</strong>
              <ul style={{ margin: '4px 0 0 18px' }}>{errors.map((e) => <li key={e} className="small">{e}</li>)}</ul>
            </div>
          )}
        </Card>

        <Card title="Preview" actions={<span className="xsmall muted">Exactly what will print</span>}>
          {validated.input
            ? (
              <DocumentPreview
                key={previewKey}
                zoom={0.6}
                watermark={settings?.documentWatermark}
                clinic={previewCtx.clinic}
                documentType={validated.input.kind}
                pageSize={pageSizeForDocument(settings?.printProfiles, validated.input.kind)}
              >
                {quickDocumentNode(validated.input, previewCtx)}
              </DocumentPreview>
            )
            : (
              <div className="empty-state">
                <p className="small muted" style={{ margin: 0 }}>{validated.errors[0] ?? 'Complete the document to see the preview.'}</p>
              </div>
            )}
          {validated.input && (
            <p className="xsmall muted mt-2" style={{ marginBottom: 0 }}>
              {quickDocumentTitle(validated.input)}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- sections */

function PrescriptionFields({
  form,
  set,
  showNameErrors,
}: {
  form: any;
  set: (path: string[], value: unknown) => void;
  showNameErrors: boolean;
}) {
  const rows: MedicineEntryValues[] = form.medicines;
  const setRow = (index: number, patch: Partial<MedicineEntryValues>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    set(['medicines'], next);
  };
  const applyPrescriptionText = (body: Record<string, string>) => {
    const cc = clinicalChoice(body.cC, CHIEF_COMPLAINT_OPTIONS);
    const oe = clinicalChoice(body.oE, EXAMINATION_OPTIONS);
    set(['cC'], cc.choice);
    set(['ccOther'], cc.other);
    set(['oE'], oe.choice);
    set(['oeOther'], oe.other);
    set(['rE'], body.rE ?? '');
    set(['diagnosis'], body.diagnosis ?? '');
    set(['treatment'], body.treatment ?? '');
    set(['advice'], body.advice ?? '');
    set(['followUp'], body.followUp ?? '');
  };
  return (
    <>
      <ClinicalTemplatePicker
        kind="prescription"
        label="Prescription text"
        getBody={() => ({
          cC: form.cC === 'Other' ? form.ccOther : form.cC,
          oE: form.oE === 'Other' ? form.oeOther : form.oE,
          rE: form.rE,
          diagnosis: form.diagnosis,
          treatment: form.treatment,
          advice: form.advice,
          followUp: form.followUp,
        })}
        onApply={(body) => { if (!('items' in body)) applyPrescriptionText(body); }}
      />
      <ClinicalTemplatePicker
        kind="instructions"
        label="Prescription instructions"
        getBody={() => ({ advice: form.advice })}
        onApply={(body) => { if (!('items' in body)) set(['advice'], body.advice ?? ''); }}
      />
      <div className="form-grid mt-4">
        <Field label="C/C (chief complaint)">
          {(id) => (
            <Select
              id={id}
              value={form.cC}
              onChange={(value) => set(['cC'], value)}
              placeholder="Select chief complaint…"
              options={CHIEF_COMPLAINT_OPTIONS}
            />
          )}
        </Field>
        {form.cC === 'Other' && (
          <Field label="C/C — Other">
            {(id) => <Input id={id} value={form.ccOther} onChange={(value) => set(['ccOther'], value)} placeholder="Write the chief complaint…" />}
          </Field>
        )}
        <Field label="O/E (on examination)">
          {(id) => (
            <Select
              id={id}
              value={form.oE}
              onChange={(value) => set(['oE'], value)}
              placeholder="Select examination finding…"
              options={EXAMINATION_OPTIONS}
            />
          )}
        </Field>
        {form.oE === 'Other' && (
          <Field label="O/E — Other">
            {(id) => <Input id={id} value={form.oeOther} onChange={(value) => set(['oeOther'], value)} placeholder="Write the examination finding…" />}
          </Field>
        )}
        <Field label="R/E">
          {(id) => <Input id={id} value={form.rE} onChange={(value) => set(['rE'], value)} />}
        </Field>
        <Field label="Diagnosis">{(id) => <Input id={id} value={form.diagnosis} onChange={(value) => set(['diagnosis'], value)} />}</Field>
        <Field label="Treatment">{(id) => <Input id={id} value={form.treatment} onChange={(value) => set(['treatment'], value)} />}</Field>
        <Field label="Follow-up">{(id) => <Input id={id} type="date" value={form.followUp} onChange={(value) => set(['followUp'], value)} />}</Field>
        <Field label="Advice" className="span-2">{(id) => <Textarea id={id} rows={2} value={form.advice} onChange={(value) => set(['advice'], value)} />}</Field>
      </div>
      <div className="mt-4">
        <MedicineEntryEditor
          items={rows}
          onChange={setRow}
          onAdd={() => set(['medicines'], [...rows, emptyMedicine()])}
          onRemove={(index) => set(['medicines'], rows.filter((_, row) => row !== index))}
          allowRemoveLast
          showNameErrors={showNameErrors}
        />
      </div>
    </>
  );
}

function InvoiceFields({ form, set, treatments }: { form: any; set: (p: string[], v: unknown) => void; treatments: TreatmentDTO[] }) {
  const rows: any[] = form.lines;
  const setRow = (index: number, patch: Record<string, unknown>) => set(['lines'], rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const invoiceDiscount = parseBdtToPaisa(form.invoiceDiscount) ?? 0;
  const received = parseBdtToPaisa(form.amountReceived) ?? 0;
  const totals = computeInvoiceTotals(rows.map((row) => ({
    description: row.description,
    qty: Number(row.qty) || 0,
    unitPricePaisa: parseBdtToPaisa(row.unitPrice) ?? 0,
    discountPaisa: parseBdtToPaisa(row.discount) ?? 0,
  })), invoiceDiscount);
  const amountAfterLineDiscounts = Math.max(0, totals.subtotalPaisa - totals.lineDiscountPaisa);
  return (
    <>
      <div className="row space-between mt-4">
        <strong className="small">Invoice lines</strong>
        <div className="row gap-2">
          <Select
            value=""
            ariaLabel="Add an invoice line from saved treatments"
            placeholder="+ Add from treatments"
            onChange={(value) => {
              const treatment = treatments.find((candidate) => String(candidate.id) === value);
              if (treatment) set(['lines'], [...rows, { description: treatment.name, qty: 1, unitPrice: String(treatment.defaultPricePaisa / 100), discount: '', treatmentId: treatment.id }]);
            }}
            options={treatments.map((treatment) => ({ value: String(treatment.id), label: `${treatment.name} · ${formatBdt(treatment.defaultPricePaisa)}` }))}
          />
          <Button size="sm" variant="secondary" onClick={() => set(['lines'], [...rows, emptyLine()])}>+ Add line</Button>
        </div>
      </div>
      <p className="xsmall muted mt-2" style={{ marginBottom: 0 }}>
        Quantity × unit price gives the line amount. A line discount applies only to that line; the invoice-wide discount is applied once after all lines.
      </p>
      <div className="col gap-3 mt-3">
        {rows.map((row, index) => (
          <div className="quick-line-card" key={index}>
            <div className="row between quick-line-card-heading">
              <strong className="small">Line {index + 1}</strong>
              <Button size="sm" variant="ghost" ariaLabel={`Remove invoice line ${index + 1}`} onClick={() => set(['lines'], rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button>
            </div>
            {/* Fixed arrangement at every supported size (see .quick-line-grid):
                row 1 = Item · Qty · Unit price, row 2 = Discount · Line total. */}
            <div className="quick-line-grid">
              <Field label="Item or procedure" required className="quick-line-item">
                {(id) => <Input id={id} value={row.description} onChange={(value) => setRow(index, { description: value })} placeholder="e.g. Consultation, scaling" required />}
              </Field>
              <Field label="Qty" className="quick-line-qty">
                {(id) => <Input id={id} type="number" min={1} step={1} value={String(row.qty)} onChange={(value) => setRow(index, { qty: value })} />}
              </Field>
              <Field label="Unit price (৳)" className="quick-line-unit-price">
                {(id) => <Input id={id} type="number" min={0} step="0.01" value={String(row.unitPrice)} onChange={(value) => setRow(index, { unitPrice: value })} />}
              </Field>
              <Field label="Discount (৳)" className="quick-line-discount">
                {(id) => <Input id={id} type="number" min={0} step="0.01" value={String(row.discount)} onChange={(value) => setRow(index, { discount: value })} />}
              </Field>
              <Field label="Line total (৳)" labelFor={false} className="quick-line-total">
                {() => <div className="input quick-line-total-value" aria-readonly="true"><Money paisa={totals.lines[index]?.totalPaisa ?? 0} /></div>}
              </Field>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="small muted" style={{ margin: 0 }}>Add at least one invoice line.</p>}
      </div>
      <div className="form-grid mt-4">
        <Field label="Invoice discount (৳)">
          {(id) => <Input id={id} type="number" min={0} step="0.01" value={String(form.invoiceDiscount)} onChange={(value) => set(['invoiceDiscount'], value)} />}
        </Field>
        <Field label="Amount received (৳)">
          {(id) => <Input id={id} type="number" min={0} step="0.01" value={String(form.amountReceived)} onChange={(value) => set(['amountReceived'], value)} />}
        </Field>
        <Field label="Payment method">
          {(id) => (
            <Select id={id} value={form.method || 'Cash'} onChange={(value) => set(['method'], value)}
              options={QUICK_PAYMENT_METHODS.map((method) => ({ value: method, label: method }))} />
          )}
        </Field>
        <Field label="Note">{(id) => <Input id={id} value={form.note} onChange={(value) => set(['note'], value)} />}</Field>
      </div>
      <div className="quick-invoice-summary mt-3 small" aria-label="Invoice calculation summary">
        <span>Gross subtotal <strong className="num"><Money paisa={totals.subtotalPaisa} /></strong></span>
        <span>Line discounts <strong className="num"><Money paisa={totals.lineDiscountPaisa} /></strong></span>
        <span>After line discounts <strong className="num"><Money paisa={amountAfterLineDiscounts} /></strong></span>
        <span>Invoice-wide discount <strong className="num"><Money paisa={totals.invoiceDiscountPaisa} /></strong></span>
        <span>Total <strong className="num"><Money paisa={totals.totalPaisa} /></strong></span>
        <span>Balance due <strong className="num"><Money paisa={Math.max(0, totals.totalPaisa - received)} /></strong></span>
      </div>
    </>
  );
}

function ReceiptFields({ form, set }: { form: any; set: (p: string[], v: unknown) => void }) {
  return (
    <div className="form-grid mt-4">
      <Field label="Amount received" required>
        {(id) => <Input id={id} type="number" min={0} step="0.01" value={String(form.amount)} onChange={(v) => set(['amount'], v)} />}
      </Field>
      <Field label="Method">
        {(id) => (
          <Select id={id} value={form.method || 'Cash'} onChange={(v) => set(['method'], v)}
            options={QUICK_PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
        )}
      </Field>
      <Field label="Payment reference">
        {(id) => <Input id={id} value={form.paymentReference} onChange={(v) => set(['paymentReference'], v)} />}
      </Field>
    </div>
  );
}

function VisitFields({ form, set, treatments }: { form: any; set: (p: string[], v: unknown) => void; treatments: TreatmentDTO[] }) {
  const rows: any[] = form.procedures;
  const setRow = (index: number, patch: Record<string, unknown>) => set(['procedures'], rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <>
      <div className="form-grid mt-4">
        <Field label="Chief complaint">{(id) => <Input id={id} value={form.chiefComplaint} onChange={(v) => set(['chiefComplaint'], v)} />}</Field>
        <Field label="Diagnosis">{(id) => <Input id={id} value={form.diagnosis} onChange={(v) => set(['diagnosis'], v)} />}</Field>
        <Field label="Treatment notes" className="span-2">{(id) => <Textarea id={id} rows={3} value={form.treatmentNotes} onChange={(v) => set(['treatmentNotes'], v)} />}</Field>
        <Field label="Next visit date">{(id) => <Input id={id} type="date" value={form.nextVisitDate} onChange={(v) => set(['nextVisitDate'], v)} />}</Field>
        <Field label="Next visit purpose">{(id) => <Input id={id} value={form.nextVisitPurpose} onChange={(v) => set(['nextVisitPurpose'], v)} />}</Field>
      </div>
      <div className="row space-between mt-4">
        <strong className="small">Procedures</strong>
        <div className="row gap-2">
          <Select value="" ariaLabel="Add a procedure from saved treatments" placeholder="+ Add from treatments"
            onChange={(v) => {
              const t = treatments.find((x) => String(x.id) === v);
              if (t) set(['procedures'], [...rows, { toothNumber: '', treatmentName: t.name, qty: 1, unitPrice: String(t.defaultPricePaisa / 100) }]);
            }}
            options={treatments.map((t) => ({ value: String(t.id), label: `${t.name} · ${formatBdt(t.defaultPricePaisa)}` }))} />
          <Button size="sm" variant="secondary" onClick={() => set(['procedures'], [...rows, { toothNumber: '', treatmentName: '', qty: 1, unitPrice: '' }])}>+ Add procedure</Button>
        </div>
      </div>
      <div className="col gap-2 mt-2">
        {rows.map((row, i) => (
          <div className="quick-line-card" key={i}>
            <div className="row between quick-line-card-heading">
              <strong className="small">Procedure {i + 1}</strong>
              <Button size="sm" variant="ghost" ariaLabel={`Remove procedure ${i + 1}`} onClick={() => set(['procedures'], rows.filter((_, x) => x !== i))}>Remove</Button>
            </div>
            <div className="quick-line-grid quick-procedure-grid">
              <Field label="Tooth #" className="quick-procedure-tooth">
                {(id) => <Input id={id} value={row.toothNumber} onChange={(v) => setRow(i, { toothNumber: v })} placeholder="Optional" />}
              </Field>
              <Field label="Procedure" className="quick-procedure-name">
                {(id) => <Input id={id} value={row.treatmentName} onChange={(v) => setRow(i, { treatmentName: v })} placeholder="e.g. Scaling" />}
              </Field>
              <Field label="Qty" className="quick-procedure-qty">
                {(id) => <Input id={id} type="number" min={1} step={1} value={String(row.qty)} onChange={(v) => setRow(i, { qty: v })} />}
              </Field>
              <Field label="Unit price (৳)" className="quick-procedure-unit-price">
                {(id) => <Input id={id} type="number" min={0} step="0.01" value={String(row.unitPrice)} onChange={(v) => setRow(i, { unitPrice: v })} />}
              </Field>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="xsmall muted" style={{ margin: 0 }}>Procedures are optional.</p>}
      </div>
    </>
  );
}

function AppointmentFields({ form, set }: { form: any; set: (p: string[], v: unknown) => void }) {
  return (
    <div className="form-grid mt-4">
      <Field label="Time" required>
        {(id) => <Input id={id} type="time" value={form.time} onChange={(v) => set(['time'], v)} />}
      </Field>
      <Field label="Purpose">{(id) => <Input id={id} value={form.purpose} onChange={(v) => set(['purpose'], v)} placeholder="e.g. Scaling" />}</Field>
    </div>
  );
}

/* ------------------------------------------------------------ editor state */

/** Methods offered here mirror the clinic's usual payment labels (free text is not stored). */
const QUICK_PAYMENT_METHODS = ['Cash', 'bKash', 'Nagad', 'Rocket', 'Card', 'Bank transfer'];

function emptyForm(kind: QuickDocumentKind): any {
  return {
    date: todayISO(),
    time: '10:00',
    dentistId: '',
    dentistName: '',
    customer: { name: '', phone: '', ageYears: '', gender: '' },
    // prescription
    cC: '', ccOther: '', oE: '', oeOther: '', rE: '', diagnosis: '', treatment: '', advice: '', followUp: '',
    medicines: [emptyMedicine()],
    // invoice
    lines: [emptyLine()],
    invoiceDiscount: '',
    amountReceived: '',
    method: '',
    note: '',
    // receipt
    amount: '',
    paymentReference: '',
    // visit summary
    chiefComplaint: '', treatmentNotes: '', nextVisitDate: '', nextVisitPurpose: '',
    procedures: [],
    // appointment card
    purpose: kind === 'appointment-card' ? '' : '',
    _kind: kind,
  };
}

function emptyMedicine(): any {
  return {
    medicineName: '', generic: '', strength: '', form: '', dosage: '', frequency: '',
    duration: '', qty: '', instruction: '', medicineInstruction: '',
  };
}

function emptyLine(): any {
  return { description: '', qty: 1, unitPrice: '', discount: '', treatmentId: null };
}

/** Local preview validation — the same shared validator the main process runs. */
function validateForPreview(input: QuickDocumentInput | null): { input: QuickDocumentInput | null; errors: string[] } {
  if (!input) return { input: null, errors: [] };
  return validateQuickDocumentInput(input);
}
