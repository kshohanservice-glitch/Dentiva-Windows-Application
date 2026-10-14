import { useEffect, useMemo, useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, Tabs, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';
import { Money } from '../components/money';
import { DocumentPreview } from '../documents/document-preview';
import { quickDocumentNode, quickDocumentTitle } from '../documents/quick-document-view';
import { Icon } from '../components/shell';
import {
  QUICK_DOCUMENT_DEFS, QUICK_DOCUMENT_KINDS, quickDocumentReference, validateQuickDocumentInput,
  type QuickDocumentInput, type QuickDocumentKind,
} from '../../shared/quick-documents';
import { formatBdt, parseBdtToPaisa, todayISO } from '../../shared/currency';
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
            cC: form.cC || null, oE: form.oE || null, rE: form.rE || null,
            diagnosis: form.diagnosis || null, treatment: form.treatment || null,
            advice: form.advice || null, followUp: form.followUp || null,
            items: form.medicines.filter((m: any) => m.medicineName.trim()).map((m: any) => ({
              medicineName: m.medicineName, generic: m.generic || null, strength: m.strength || null,
              form: m.form || null, dosage: m.dosage || null, frequency: m.frequency || null,
              duration: m.duration || null, qty: m.qty || null, instruction: m.instruction || null,
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
            <Field label="Customer name" required>{() => <Input value={form.customer.name} onChange={(v) => set(['customer', 'name'], v)} placeholder="Walk-in customer" autoFocus />}</Field>
            <Field label="Phone">{() => <Input value={form.customer.phone} onChange={(v) => set(['customer', 'phone'], v)} placeholder="01XXXXXXXXX" inputMode="tel" />}</Field>
            <Field label="Age (years)">{() => <Input type="number" min={0} max={130} value={String(form.customer.ageYears ?? '')} onChange={(v) => set(['customer', 'ageYears'], v)} />}</Field>
            <Field label="Gender">
              {() => (
                <Select value={form.customer.gender ?? ''} onChange={(v) => set(['customer', 'gender'], v)} placeholder="Not specified"
                  options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }]} />
              )}
            </Field>
            <Field label="Date" required>{() => <Input type="date" value={form.date} onChange={(v) => set(['date'], v)} />}</Field>
            {kind !== 'receipt' && (
              <>
                <Field label="Dentist" hint="Chosen from the clinic's dentist list — prints with credentials">
                  {() => (
                    <Select value={String(form.dentistId ?? '')} onChange={(v) => set(['dentistId'], v)} placeholder="Not selected"
                      options={(dentists.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))} />
                  )}
                </Field>
                <Field
                  label="Dentist name (typed)"
                  required={kind === 'prescription' && !form.dentistId}
                  hint="Used when the dentist is not in the list; a prescription must name the dentist."
                >
                  {() => <Input value={form.dentistName} onChange={(v) => set(['dentistName'], v)} disabled={!!form.dentistId} />}
                </Field>
              </>
            )}
          </div>

          {kind === 'prescription' && <PrescriptionFields form={form} set={set} />}
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
            ? <DocumentPreview key={previewKey} zoom={0.6}>{quickDocumentNode(validated.input, previewCtx)}</DocumentPreview>
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

function PrescriptionFields({ form, set }: { form: any; set: (p: string[], v: unknown) => void }) {
  const rows: any[] = form.medicines;
  const setRow = (index: number, patch: Record<string, unknown>) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    set(['medicines'], next);
  };
  return (
    <>
      <div className="form-grid mt-4">
        <Field label="C/C (chief complaint)">{() => <Input value={form.cC} onChange={(v) => set(['cC'], v)} />}</Field>
        <Field label="O/E (examination)">{() => <Input value={form.oE} onChange={(v) => set(['oE'], v)} />}</Field>
        <Field label="R/E (investigation)">{() => <Input value={form.rE} onChange={(v) => set(['rE'], v)} />}</Field>
        <Field label="Diagnosis">{() => <Input value={form.diagnosis} onChange={(v) => set(['diagnosis'], v)} />}</Field>
        <Field label="Treatment / procedure">{() => <Input value={form.treatment} onChange={(v) => set(['treatment'], v)} />}</Field>
        <Field label="Follow-up date">{() => <Input type="date" value={form.followUp} onChange={(v) => set(['followUp'], v)} />}</Field>
        <Field label="Advice" className="span-2">{() => <Textarea rows={2} value={form.advice} onChange={(v) => set(['advice'], v)} />}</Field>
      </div>
      <div className="row space-between mt-4">
        <strong className="small">Medicines</strong>
        <Button size="sm" variant="secondary" onClick={() => set(['medicines'], [...rows, emptyMedicine()])}>+ Add medicine</Button>
      </div>
      <div className="col gap-2 mt-2">
        {rows.map((row, i) => (
          <div className="line-editor" key={i}>
            <Input value={row.medicineName} onChange={(v) => setRow(i, { medicineName: v })} placeholder="Medicine name" />
            <Input value={row.strength} onChange={(v) => setRow(i, { strength: v })} placeholder="500mg" />
            <Input value={row.dosage} onChange={(v) => setRow(i, { dosage: v })} placeholder="1 capsule" />
            <Input value={row.frequency} onChange={(v) => setRow(i, { frequency: v })} placeholder="3× daily" />
            <Input value={row.duration} onChange={(v) => setRow(i, { duration: v })} placeholder="5 days" />
            <Input value={row.qty} onChange={(v) => setRow(i, { qty: v })} placeholder="Qty" />
            <Input value={row.generic} onChange={(v) => setRow(i, { generic: v })} placeholder="Generic (optional)" />
            <Input value={row.form} onChange={(v) => setRow(i, { form: v })} placeholder="Form e.g. Capsule" />
            <Input value={row.instruction} onChange={(v) => setRow(i, { instruction: v })} placeholder="Instruction e.g. after meals" />
            <Button size="sm" variant="ghost" title="Remove" onClick={() => set(['medicines'], rows.filter((_, x) => x !== i))}>✕</Button>
          </div>
        ))}
        {rows.length === 0 && <p className="xsmall muted" style={{ margin: 0 }}>Add at least one medicine — a prescription cannot be printed empty.</p>}
      </div>
    </>
  );
}

function InvoiceFields({ form, set, treatments }: { form: any; set: (p: string[], v: unknown) => void; treatments: TreatmentDTO[] }) {
  const rows: any[] = form.lines;
  const setRow = (index: number, patch: Record<string, unknown>) => set(['lines'], rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const subtotal = rows.reduce((sum, r) => sum + (Number(r.qty) || 0) * (parseBdtToPaisa(r.unitPrice) ?? 0) - (parseBdtToPaisa(r.discount) ?? 0), 0);
  const invoiceDiscount = parseBdtToPaisa(form.invoiceDiscount) ?? 0;
  const total = Math.max(0, subtotal - invoiceDiscount);
  const received = parseBdtToPaisa(form.amountReceived) ?? 0;
  return (
    <>
      <div className="row space-between mt-4">
        <strong className="small">Lines</strong>
        <div className="row gap-2">
          <Select
            value="" placeholder="+ Add from treatments"
            onChange={(v) => {
              const t = treatments.find((x) => String(x.id) === v);
              if (t) set(['lines'], [...rows, { description: t.name, qty: 1, unitPrice: String(t.defaultPricePaisa / 100), discount: '', treatmentId: t.id }]);
            }}
            options={treatments.map((t) => ({ value: String(t.id), label: `${t.name} · ${formatBdt(t.defaultPricePaisa)}` }))}
          />
          <Button size="sm" variant="secondary" onClick={() => set(['lines'], [...rows, emptyLine()])}>+ Add line</Button>
        </div>
      </div>
      <div className="col gap-2 mt-2">
        {rows.map((row, i) => (
          <div className="line-editor" key={i}>
            <Input value={row.description} onChange={(v) => setRow(i, { description: v })} placeholder="Description" />
            <Input type="number" min={1} value={String(row.qty)} onChange={(v) => setRow(i, { qty: v })} placeholder="Qty" />
            <Input type="number" min={0} step="0.01" value={String(row.unitPrice)} onChange={(v) => setRow(i, { unitPrice: v })} placeholder="Unit price" />
            <Input type="number" min={0} step="0.01" value={String(row.discount)} onChange={(v) => setRow(i, { discount: v })} placeholder="Line discount" />
            <span className="num small muted" style={{ minWidth: 96, textAlign: 'right' }}>
              <Money paisa={(Number(row.qty) || 0) * (parseBdtToPaisa(row.unitPrice) ?? 0) - (parseBdtToPaisa(row.discount) ?? 0)} />
            </span>
            <Button size="sm" variant="ghost" title="Remove" onClick={() => set(['lines'], rows.filter((_, x) => x !== i))}>✕</Button>
          </div>
        ))}
        {rows.length === 0 && <p className="xsmall muted" style={{ margin: 0 }}>Add at least one line.</p>}
      </div>
      <div className="form-grid mt-4">
        <Field label="Invoice discount">{() => <Input type="number" min={0} step="0.01" value={String(form.invoiceDiscount)} onChange={(v) => set(['invoiceDiscount'], v)} />}</Field>
        <Field label="Amount received now">{() => <Input type="number" min={0} step="0.01" value={String(form.amountReceived)} onChange={(v) => set(['amountReceived'], v)} />}</Field>
        <Field label="Payment method" hint="Shown on the invoice when an amount is received">
          {() => (
            <Select value={form.method || 'Cash'} onChange={(v) => set(['method'], v)}
              options={QUICK_PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
          )}
        </Field>
        <Field label="Note (printed on the invoice)">{() => <Input value={form.note} onChange={(v) => set(['note'], v)} />}</Field>
      </div>
      <div className="row gap-4 mt-2 small">
        <span>Subtotal <strong className="num"><Money paisa={subtotal} /></strong></span>
        <span>Discount <strong className="num"><Money paisa={invoiceDiscount} /></strong></span>
        <span>Total <strong className="num"><Money paisa={total} /></strong></span>
        <span>Due <strong className="num"><Money paisa={Math.max(0, total - received)} /></strong></span>
      </div>
    </>
  );
}

function ReceiptFields({ form, set }: { form: any; set: (p: string[], v: unknown) => void }) {
  return (
    <div className="form-grid mt-4">
      <Field label="Amount received" required hint="The amount this receipt acknowledges">
        {() => <Input type="number" min={0} step="0.01" value={String(form.amount)} onChange={(v) => set(['amount'], v)} />}
      </Field>
      <Field label="Method">
        {() => (
          <Select value={form.method || 'Cash'} onChange={(v) => set(['method'], v)}
            options={QUICK_PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
        )}
      </Field>
      <Field label="Payment reference" hint="Optional — mobile-wallet or bank reference">
        {() => <Input value={form.paymentReference} onChange={(v) => set(['paymentReference'], v)} />}
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
        <Field label="Chief complaint">{() => <Input value={form.chiefComplaint} onChange={(v) => set(['chiefComplaint'], v)} />}</Field>
        <Field label="Diagnosis">{() => <Input value={form.diagnosis} onChange={(v) => set(['diagnosis'], v)} />}</Field>
        <Field label="Treatment notes" className="span-2">{() => <Textarea rows={3} value={form.treatmentNotes} onChange={(v) => set(['treatmentNotes'], v)} />}</Field>
        <Field label="Next visit date">{() => <Input type="date" value={form.nextVisitDate} onChange={(v) => set(['nextVisitDate'], v)} />}</Field>
        <Field label="Next visit purpose">{() => <Input value={form.nextVisitPurpose} onChange={(v) => set(['nextVisitPurpose'], v)} />}</Field>
      </div>
      <div className="row space-between mt-4">
        <strong className="small">Procedures</strong>
        <div className="row gap-2">
          <Select value="" placeholder="+ Add from treatments"
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
          <div className="line-editor" key={i}>
            <Input value={row.toothNumber} onChange={(v) => setRow(i, { toothNumber: v })} placeholder="Tooth" />
            <Input value={row.treatmentName} onChange={(v) => setRow(i, { treatmentName: v })} placeholder="Procedure" />
            <Input type="number" min={1} value={String(row.qty)} onChange={(v) => setRow(i, { qty: v })} placeholder="Qty" />
            <Input type="number" min={0} step="0.01" value={String(row.unitPrice)} onChange={(v) => setRow(i, { unitPrice: v })} placeholder="Unit price" />
            <Button size="sm" variant="ghost" title="Remove" onClick={() => set(['procedures'], rows.filter((_, x) => x !== i))}>✕</Button>
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
      <Field label="Time" required hint="24-hour clock">
        {() => <Input type="time" value={form.time} onChange={(v) => set(['time'], v)} />}
      </Field>
      <Field label="Purpose">{() => <Input value={form.purpose} onChange={(v) => set(['purpose'], v)} placeholder="e.g. Scaling" />}</Field>
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
    cC: '', oE: '', rE: '', diagnosis: '', treatment: '', advice: '', followUp: '',
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
    duration: '', qty: '', instruction: '',
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
