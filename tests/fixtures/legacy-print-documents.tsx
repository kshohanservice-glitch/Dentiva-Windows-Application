/**
 * FROZEN COPY — original printable-document renderers, before the
 * document-customization feature.
 *
 * Generated from `src/renderer/pages/PrintPage.tsx` at commit 58375e0
 * (git blob d161b9609b0b9a600d0c28a4e8d29e6bdaf9309f); everything below this comment is byte-identical to that
 * file's document region except that `function` was changed to `export
 * function` so the tests can call it. It exists solely as the reference
 * implementation for the layout-preservation test in
 * `tests/unit/document-layout.test.ts`: rendering the same document through
 * this copy and through the current renderer must produce the same markup.
 *
 * Do not edit. Do not import from application code.
 */
import { formatDate } from '../../src/renderer/format';
import { FormattedMoney } from '../../src/renderer/components/formatted-money';
import { PrintMoney } from '../../src/renderer/components/print-money';

export function credentialLines(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(/[\r\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function Header({ clinic, right }: { clinic: any; right?: React.ReactNode }) {
  return (
    <div className="print-header">
      <div className="head-main">
        {clinic?.logoDataUrl ? (
          <img className="logo" src={clinic.logoDataUrl} alt="" />
        ) : (
          <div className="logo">D</div>
        )}
        <div>
          <h1>{clinic?.clinicName || 'Dental Clinic'}</h1>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {clinic?.address && <div>{clinic.address}</div>}
            <div>
              {clinic?.phone ? `Phone: ${clinic.phone}` : ''}
              {clinic?.phone && clinic?.email ? ' · ' : ''}
              {clinic?.email ?? ''}
            </div>
            {clinic?.website && <div>{clinic.website}</div>}
          </div>
        </div>
      </div>
      <div className="clinic-meta">{right}</div>
    </div>
  );
}

export function Footer({ text }: { text?: string | null }) {
  return (
    <div className="print-footer">
      <span>{text || ''}</span>
      <span className="print-generated">Computer-generated document</span>
    </div>
  );
}

export function invoiceDoc(data: any): React.ReactNode {
  const { invoice, payments, clinic, settings } = data;
  const lines: any[] = invoice.lines ?? [];
  const discount = invoice.discountPaisa ?? 0;
  const subtotal = lines.reduce((s: number, l: any) => s + l.totalPaisa, 0);
  return (
    <>
      <Header clinic={clinic} right={<>
        <div><b>Invoice</b></div>
        <div className="mono">{invoice.invoiceNumber}</div>
        <div>{formatDate(invoice.invoiceDate)}</div>
      </>} />
      <div className="doc-title">Invoice</div>
      <div className="print-kv">
        <div><span className="k">Patient</span><span className="v">{invoice.patientName}</span></div>
        <div><span className="k">Phone</span><span className="v">{invoice.patientPhone || '—'}</span></div>
        <div><span className="k">Invoice No</span><span className="v mono">{invoice.invoiceNumber}</span></div>
        <div><span className="k">Date</span><span className="v">{formatDate(invoice.invoiceDate)}</span></div>
        <div><span className="k">Dentist</span><span className="v">{invoice.dentistName || '—'}</span></div>
        <div><span className="k">Status</span><span className="v">{invoice.status}</span></div>
      </div>
      <table>
        <thead>
          <tr><th style={{ width: '52%' }}>Description</th><th className="right">Qty</th><th className="right">Unit</th><th className="right">Total</th></tr>
        </thead>
        <tbody>
          {lines.map((l: any) => (
            <tr key={l.id}>
              <td>{l.description}{l.toothNumber ? ` (Tooth ${l.toothNumber})` : ''}</td>
              <td className="right mono">{l.quantity}</td>
              <td className="right mono"><PrintMoney paisa={l.unitPricePaisa} /></td>
              <td className="right mono"><PrintMoney paisa={l.totalPaisa} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="totals">
        <tbody>
          <tr><td className="muted">Subtotal</td><td className="right mono"><PrintMoney paisa={subtotal} /></td></tr>
          {discount > 0 && <tr><td className="muted">Discount</td><td className="right mono">−<PrintMoney paisa={discount} /></td></tr>}
          <tr><td className="muted">VAT</td><td className="right mono"><PrintMoney paisa={invoice.vatPaisa ?? 0} /></td></tr>
          <tr><td className="muted">Total</td><td className="right mono"><PrintMoney paisa={invoice.totalPaisa} /></td></tr>
          <tr><td className="muted">Paid</td><td className="right mono"><PrintMoney paisa={invoice.paidPaisa ?? 0} /></td></tr>
          <tr className="grand"><td>Balance due</td><td className="right mono"><PrintMoney paisa={invoice.duePaisa ?? 0} /></td></tr>
        </tbody>
      </table>
      {payments?.length > 0 && (
        <>
          <h2>Payment history</h2>
          <table className="compact">
            <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th className="right">Amount</th></tr></thead>
            <tbody>
              {payments.map((p: any) => (
                <tr key={p.id}>
                  <td>{formatDate(p.paidAt)}</td>
                  <td>{p.method}</td>
                  <td className="mono">{p.reference || '—'}</td>
                  <td className="right mono"><PrintMoney paisa={p.amountPaisa} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <Footer text={invoice.footerNote || settings?.invoice?.footerNote || 'Thank you for your visit.'} />
    </>
  );
}

export function receiptDoc(data: any): React.ReactNode {
  const { invoice, payments, clinic } = data;
  const lastPayment = payments?.[payments.length - 1];
  return (
    <>
      <Header clinic={clinic} right={<><div><b>Receipt</b></div><div>{formatDate(new Date())}</div></>} />
      <div className="doc-title">Payment Receipt</div>
      <div className="print-kv">
        <div><span className="k">Received from</span><span className="v">{invoice.patientName}</span></div>
        <div><span className="k">Phone</span><span className="v">{invoice.patientPhone || '—'}</span></div>
        <div><span className="k">Invoice</span><span className="v mono">{invoice.invoiceNumber}</span></div>
        <div><span className="k">Payment date</span><span className="v">{lastPayment ? formatDate(lastPayment.paidAt) : '—'}</span></div>
      </div>
      <table>
        <tbody>
          <tr><td className="muted">Amount received</td><td className="right mono"><b><PrintMoney paisa={lastPayment?.amountPaisa ?? 0} /></b></td></tr>
          <tr><td className="muted">Method</td><td className="right">{lastPayment?.method ?? '—'}</td></tr>
          <tr><td className="muted">Invoice total</td><td className="right mono"><PrintMoney paisa={invoice.totalPaisa} /></td></tr>
          <tr><td className="muted">Total paid to date</td><td className="right mono"><PrintMoney paisa={invoice.paidPaisa ?? 0} /></td></tr>
          <tr className="grand"><td>Balance due</td><td className="right mono"><PrintMoney paisa={invoice.duePaisa ?? 0} /></td></tr>
        </tbody>
      </table>
      <div style={{ marginTop: 30 }}>
        <div className="sig-line" />
        <div className="muted small">Authorised signature</div>
      </div>
      <Footer text="This receipt confirms payment received by Dentiva Pro-managed clinic records." />
    </>
  );
}

export function prescriptionDoc(data: any): React.ReactNode {
  const { rx, patient, clinic, visit, watermark, settings, dentist } = data;
  const diagnosisText = rx.diagnosis || visit?.diagnosis || null;
  const labels = settings?.prescription?.labels ?? {};
  const sigReserved = settings?.prescription?.signatureReserved !== false;
  const dentistName = dentist?.name ?? rx.dentistName ?? 'Dentist';
  const qualifications = credentialLines(dentist?.qualifications);
  const designations = credentialLines(dentist?.designations);
  const otherDentistInfo = [
    dentist?.regNo ? `Reg. ${dentist.regNo}` : '',
    dentist?.phone ? dentist.phone : '',
    dentist?.email ? dentist.email : '',
  ].filter(Boolean);

  const clinicalFields = [
    { label: labels.cc || 'C/C', value: rx.cC },
    { label: labels.oe || 'O/E', value: rx.oE },
    { label: labels.re || 'R/E', value: rx.rE },
    ...(diagnosisText ? [{ label: labels.diagnosis || 'Diagnosis', value: diagnosisText }] : []),
    ...(rx.treatment ? [{ label: labels.treatment || 'Treatment', value: rx.treatment }] : []),
  ];

  return (
    <>
      {watermark && <div className="print-watermark"><span>Specimen</span></div>}

      <div className="prescription-header">
        <div className="prescription-clinic">
          {clinic?.logoDataUrl ? (
            <img className="prescription-logo" src={clinic.logoDataUrl} alt="" />
          ) : (
            <div className="prescription-logo prescription-logo-fallback">D</div>
          )}
          <div className="prescription-clinic-copy">
            <div className="prescription-clinic-name">{clinic?.clinicName || 'Dental Clinic'}</div>
            {clinic?.clinicNameBn && <div className="prescription-clinic-bn">{clinic.clinicNameBn}</div>}
            {clinic?.address && <div>{clinic.address}</div>}
            <div className="prescription-contact">
              {clinic?.phone && <span>{clinic.phone}</span>}
              {clinic?.email && <span>{clinic.email}</span>}
              {clinic?.website && <span>{clinic.website}</span>}
            </div>
          </div>
        </div>

        <div className="prescription-dentist">
          <div className="prescription-dentist-label">DENTIST</div>
          <div className="prescription-dentist-name">{dentistName}</div>
          {designations.map((d, i) => <div key={`des-${i}`} className="prescription-dentist-designation">{d}</div>)}
          {qualifications.map((q, i) => <div key={`qual-${i}`} className="prescription-dentist-qualification">{q}</div>)}
          {otherDentistInfo.length > 0 && (
            <div className="prescription-dentist-other">
              {otherDentistInfo.map((v, i) => <div key={i}>{v}</div>)}
            </div>
          )}
        </div>
      </div>

      <div className="prescription-patient-strip">
        <div><span>Patient Name</span><strong>{patient.name}</strong></div>
        <div><span>Age</span><strong>{patient.ageYears != null ? `${patient.ageYears}` : '—'}</strong></div>
        <div><span>Gender</span><strong>{patient.gender || '—'}</strong></div>
        <div className="prescription-patient-phone"><span>Phone</span><strong>{patient.phone || '—'}</strong></div>
        <div><span>Date</span><strong>{formatDate(rx.rxDate)}</strong></div>
        <div><span>Patient ID</span><strong className="mono">{patient.patientCode}</strong></div>
        <div><span>Rx No.</span><strong className="mono">{rx.rxNumber}</strong></div>
      </div>

      {settings?.prescription?.visitingHours && (
        <div className="prescription-visiting-hours">{settings.prescription.visitingHours}</div>
      )}

      <div className="prescription-body">
        <aside className="prescription-clinical">
          <div className="prescription-column-title">Clinical Notes</div>
          {clinicalFields.map((field, i) => (
            <div className={`clinical-field ${i < 3 ? 'clinical-primary' : ''}`} key={field.label}>
              <div className="clinical-label">{field.label}</div>
              <div className="clinical-value">{field.value || '—'}</div>
            </div>
          ))}
        </aside>

        <section className="prescription-medications">
          <div className="rx-heading">
            <span className="rx-symbol">Rx</span>
            <span className="rx-heading-text">Prescription</span>
          </div>

          <div className="medication-list">
            {rx.items.length > 0 ? rx.items.map((it: any, i: number) => (
              <div className="prescription-medication" key={i}>
                <div className="medication-index">{i + 1}</div>
                <div className="medication-content">
                  <div className="medication-title">
                    {it.form ? `${it.form} ` : ''}{it.medicineName}
                    {it.strength && <span className="medication-strength"> {it.strength}</span>}
                  </div>
                  <div className="medication-instructions">
                    {it.dosage && <span>{it.dosage}</span>}
                    {it.frequency && <span>{it.frequency}</span>}
                    {it.route && <span>{it.route}</span>}
                    {it.duration && <span>{it.duration}</span>}
                    {it.qty && <span>Qty: {it.qty}</span>}
                    {it.instruction && <span>{it.instruction}</span>}
                    {it.generic && <span className="muted">{it.generic}</span>}
                  </div>
                </div>
              </div>
            )) : (
              <div className="muted">No medicines recorded.</div>
            )}
          </div>

          <div className="prescription-bottom">
            <div className="prescription-advice">
              <div className="prescription-section-label">{labels.advice || 'Advice'}</div>
              <div className="prescription-section-value">{rx.advice || '—'}</div>
            </div>
            <div className="prescription-follow-up">
              <div className="prescription-section-label">{labels.followUp || 'Follow-up'}</div>
              <div className="prescription-section-value">{rx.followUp ? formatDate(rx.followUp) : '—'}</div>
            </div>
          </div>

          {sigReserved ? (
            <div className="prescription-signature">
              <div className="prescription-signature-note muted small">
                {watermark ? 'Duplicate copy — valid only with signature and seal.' : 'Please complete the full course as directed.'}
              </div>
              <div className="prescription-signature-box">
                <div className="sig-line" />
                <div className="prescription-signature-name">Signature</div>
              </div>
            </div>
          ) : (
            <div className="prescription-signature-compact">
              <div><b>{dentistName}</b></div>
              {designations.map((d, i) => <div key={`compact-des-${i}`} className="muted small">{d}</div>)}
              {qualifications.map((q, i) => <div key={`compact-qual-${i}`} className="muted small">{q}</div>)}
              {dentist?.regNo && <div className="muted small">Reg. {dentist.regNo}</div>}
            </div>
          )}
        </section>
      </div>

      <Footer text={settings?.prescription?.footerMessage || clinic?.clinicName || ''} />
    </>
  );
}
export function visitSummaryDoc(data: any): React.ReactNode {
  const { patient, visit, procedures, rx, clinic } = data;
  const ageGender = `${patient.ageYears != null ? `${patient.ageYears}y ` : ''}${patient.gender || ''}`.trim() || '—';
  return (
    <>
      <Header clinic={clinic} right={<><div><b>Visit summary</b></div><div>{formatDate(visit.visitDate)}</div></>} />
      <div className="doc-title">Visit Summary</div>
      <div className="print-kv">
        <div><span className="k">Patient</span><span className="v">{patient.name}</span></div>
        <div><span className="k">Patient ID</span><span className="v mono">{patient.patientCode}</span></div>
        <div><span className="k">Age / Sex</span><span className="v">{ageGender}</span></div>
        <div><span className="k">Phone</span><span className="v">{patient.phone || '—'}</span></div>
        <div><span className="k">Visit date</span><span className="v">{formatDate(visit.visitDate)}</span></div>
        <div><span className="k">Dentist</span><span className="v">{visit.dentistName || '—'}</span></div>
      </div>
      <h2>Presenting complaint</h2>
      <div>{visit.chiefComplaint || '—'}</div>
      <h2>Diagnosis</h2>
      <div>{visit.diagnosis || '—'}</div>
      <h2>Treatment done</h2>
      <div>{visit.treatmentNotes || '—'}</div>
      {procedures?.length > 0 && (
        <>
          <h2>Procedures</h2>
          <table className="compact">
            <thead><tr><th>Tooth</th><th>Procedure</th><th>Details</th></tr></thead>
            <tbody>
              {procedures.map((p: any) => (
                <tr key={p.id}><td className="mono">{p.toothNumber ?? '—'}</td><td>{p.treatmentName}</td><td>{p.qty} × <PrintMoney paisa={p.unitPricePaisa} /> = <PrintMoney paisa={p.totalPaisa} /></td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h2>Prescriptions</h2>
      {rx?.length ? rx.map((r: any) => (
        <div key={r.id} style={{ marginBottom: 6 }}>
          <b>{r.rxNumber}</b>: {r.items?.map((i: any) => `${i.medicineName} ${i.strength ?? ''} ${i.dosage ?? ''}`).join('; ') || '—'}
        </div>
      )) : <div className="muted">No prescriptions for this visit.</div>}
      <h2>Next appointment</h2>
      <div>{visit.nextVisitDate ? formatDate(visit.nextVisitDate) + (visit.nextVisitPurpose ? ` — ${visit.nextVisitPurpose}` : '') : 'None scheduled'}</div>
      <Footer text="Computer-generated visit summary" />
    </>
  );
}

export function appointmentCardDoc(data: any): React.ReactNode {
  const { appointment, patient, clinic } = data;
  const start = new Date(`${appointment.date}T${appointment.time || '00:00'}`);
  return (
    <>
      <Header clinic={clinic} right={<div><b>Appointment card</b></div>} />
      <div className="doc-title">Appointment Card</div>
      <div className="print-kv">
        <div><span className="k">Patient</span><span className="v">{patient.name}</span></div>
        <div><span className="k">Phone</span><span className="v">{patient.phone || '—'}</span></div>
        <div><span className="k">Date</span><span className="v">{formatDate(start)}</span></div>
        <div><span className="k">Time</span><span className="v">{start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div><span className="k">Dentist</span><span className="v">{appointment.dentistName || '—'}</span></div>
        <div><span className="k">Purpose</span><span className="v">{appointment.purpose || '—'}</span></div>
      </div>
      <p className="muted">
        Please arrive 10 minutes early and bring any previous prescriptions or reports.
        If you need to reschedule, call the clinic as soon as possible.
      </p>
      <Footer text="Keep this card for your records" />
    </>
  );
}

export function stockLabelDoc(data: any): React.ReactNode {
  const { items, clinic, expiryThresholdDays } = data;
  const today = Date.now();
  return (
    <>
      <div className="doc-title">Stock &amp; Expiry Labels</div>
      <table className="compact">
        <thead><tr><th>Item</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Status</th></tr></thead>
        <tbody>
          {items.map((it: any) => {
            const exp = it.expiryDate ? new Date(it.expiryDate).getTime() : null;
            const days = exp ? Math.round((exp - today) / 86_400_000) : null;
            const state = days === null ? '—' : days < 0 ? 'EXPIRED' : days <= expiryThresholdDays ? `EXPIRES IN ${days}d` : 'OK';
            return (
              <tr key={it.id}>
                <td>{it.name}</td>
                <td className="mono">{it.batchNumber || '—'}</td>
                <td className="mono">{it.expiryDate ? formatDate(it.expiryDate) : '—'}</td>
                <td className="mono">{it.quantity}{it.unit ? ` ${it.unit}` : ''}</td>
                <td><b>{state}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Footer text={`${clinic?.clinicName ?? ''} · inventory label sheet`} />
    </>
  );
}

export function emptyDoc(title: string): React.ReactNode {
  return (
    <>
      <div className="doc-title">{title}</div>
      <p className="muted">There is nothing to print for this selection.</p>
    </>
  );
}


/* -------- adapters from API DTOs to document shapes -------- */

export function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob).getTime();
  if (Number.isNaN(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d) / (365.25 * 86_400_000)));
}

export function invToDoc(inv: any) {
  return {
    id: inv.id, invoiceNumber: inv.number, invoiceDate: inv.date, patientId: inv.patientId,
    patientName: inv.patientName, patientCode: inv.patientCode, patientPhone: null as string | null,
    dentistName: null as string | null, status: inv.status, subtotalPaisa: inv.subtotalPaisa,
    discountPaisa: inv.discountPaisa, vatPaisa: 0, totalPaisa: inv.totalPaisa,
    paidPaisa: inv.paidPaisa, duePaisa: inv.duePaisa, footerNote: inv.note,
    lines: (inv.items ?? []).map((l: any) => ({
      id: l.id, description: l.description, toothNumber: null as number | null,
      quantity: l.qty, unitPricePaisa: l.unitPricePaisa, totalPaisa: l.totalPaisa,
    })),
  };
}

export function rxToDoc(rx: any) {
  return {
    id: rx.id, rxNumber: rx.number, rxDate: rx.date,
    dentistId: rx.dentistId, dentistName: rx.dentistName,
    cC: rx.cC, oE: rx.oE, rE: rx.rE, treatment: rx.treatment,
    diagnosis: rx.diagnosis, advice: rx.advice, followUp: rx.followUp,
    items: (rx.items ?? []).map((it: any, i: number) => ({
      seq: i + 1, medicineName: it.medicineName, generic: it.generic, strength: it.strength,
      form: it.form, dosage: it.dosage, frequency: it.frequency, duration: it.duration,
      qty: it.qty, instruction: it.instruction, route: null as string | null,
    })),
  };
}

export function visitToDoc(v: any) {
  return {
    id: v.id, visitDate: v.datetime, chiefComplaint: v.chiefComplaint, diagnosis: v.diagnosis,
    treatmentNotes: v.treatmentPlan ?? v.notes, dentistName: v.dentistName,
    nextVisitDate: v.followUpDate, nextVisitPurpose: v.advice,
  };
}

export function reportDoc(data: any): React.ReactNode {
  const r = data.report;
  return (
    <>
      <Header clinic={data.clinic} right={<>
        <div><b>Report</b></div>
        <div>{formatDate(r.generatedAt)}</div>
      </>} />
      <div className="doc-title">{r.title}</div>
      <div className="muted" style={{ marginBottom: 8 }}>{r.scope}</div>
      <table className="compact">
        <thead>
          <tr>{r.columns.map((c: any) => (
            <th key={c.key} className={c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : ''}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {r.rows.map((row: any, i: number) => (
            <tr key={i}>
              {r.columns.map((c: any) => (
                <td key={c.key} className={c.align === 'right' ? 'right mono' : ''}><FormattedMoney value={row[c.key]} printable /></td>
              ))}
            </tr>
          ))}
        </tbody>
        {r.totals && (
          <tfoot>
            <tr>
              {r.columns.map((c: any, i: number) => (
                <td key={c.key} className={c.align === 'right' ? 'right mono' : ''}>
                  {i === 0 ? 'Total' : <FormattedMoney value={r.totals[c.key]} printable />}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      <Footer text={`${r.rows.length} rows`} />
    </>
  );
}

