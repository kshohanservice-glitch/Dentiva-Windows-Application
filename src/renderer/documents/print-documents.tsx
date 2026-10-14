/**
 * Printable document renderers — the single rendering path for every document
 * Dentiva Pro prints or exports.
 *
 * Used by:
 *   - the print window (`pages/PrintPage.tsx`), which loads a stored document
 *     by id and by the walk-in / quick-document route, and
 *   - the in-app previews in Settings → Customize Documents and in
 *     Walk-in / Quick Documents (`pages/QuickDocuments.tsx`).
 *
 * Layout preservation contract
 * ---------------------------
 * Every node that a clinic may customize carries a stable
 * `data-doc-el="<document>.<section>.<element>"` marker. The marker adds no
 * DOM node and no inline style, and the original classes/attributes are
 * untouched, so with no customization stored the rendered document is
 * identical to the pre-customization design. Styling is applied only by the
 * generated stylesheet for elements the user actually changed
 * (`shared/document-styles.ts`). Content, calculations and field order are
 * never altered by styling.
 */
import React from 'react';
import { formatDate } from '../format';
import { FormattedMoney } from '../components/formatted-money';
import { PrintMoney } from '../components/print-money';
import { docEl, type CustomizableDocumentType } from '../../shared/document-styles';

/** Documents that use the shared header block. */
export type HeaderScope = 'invoice' | 'receipt' | 'visit-summary' | 'appointment-card' | 'report';
/** Every document that uses the shared footer block. */
export type FooterScope = CustomizableDocumentType;

export function credentialLines(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(/[\r\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function Header({ scope, clinic, right }: { scope: HeaderScope; clinic: any; right?: React.ReactNode }) {
  return (
    <div className="print-header" {...docEl(`${scope}.header.separator`)}>
      <div className="head-main">
        {clinic?.logoDataUrl ? (
          <img className="logo" src={clinic.logoDataUrl} alt="" {...docEl(`${scope}.header.logo`)} />
        ) : (
          <div className="logo" {...docEl(`${scope}.header.logo`)}>D</div>
        )}
        <div>
          <h1 {...docEl(`${scope}.header.clinicName`)}>{clinic?.clinicName || 'Dental Clinic'}</h1>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {clinic?.address && <div {...docEl(`${scope}.header.clinicAddress`)}>{clinic.address}</div>}
            <div {...docEl(`${scope}.header.clinicContact`)}>
              {clinic?.phone ? `Phone: ${clinic.phone}` : ''}
              {clinic?.phone && clinic?.email ? ' · ' : ''}
              {clinic?.email ?? ''}
            </div>
            {clinic?.website && <div>{clinic.website}</div>}
          </div>
        </div>
      </div>
      <div className="clinic-meta" {...docEl(`${scope}.header.meta`)}>{right}</div>
    </div>
  );
}

export function Footer({ scope, text }: { scope: FooterScope; text?: string | null }) {
  return (
    <div className="print-footer" {...docEl(`${scope}.footer.separator`)}>
      <span {...docEl(`${scope}.footer.text`)}>{text || ''}</span>
      <span className="print-generated" {...docEl(`${scope}.footer.generated`)}>Computer-generated document</span>
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
      <Header scope="invoice" clinic={clinic} right={<>
        <div><b>Invoice</b></div>
        <div className="mono">{invoice.invoiceNumber}</div>
        <div>{formatDate(invoice.invoiceDate)}</div>
      </>} />
      <div className="doc-title" {...docEl('invoice.body.title')}>Invoice</div>
      <div className="print-kv">
        <div><span className="k" {...docEl('invoice.body.infoLabel')}>Patient</span><span className="v" {...docEl('invoice.body.infoValue')}>{invoice.patientName}</span></div>
        <div><span className="k" {...docEl('invoice.body.infoLabel')}>Phone</span><span className="v" {...docEl('invoice.body.infoValue')}>{invoice.patientPhone || '—'}</span></div>
        <div><span className="k" {...docEl('invoice.body.infoLabel')}>Invoice No</span><span className="v mono" {...docEl('invoice.body.infoValue')}>{invoice.invoiceNumber}</span></div>
        <div><span className="k" {...docEl('invoice.body.infoLabel')}>Date</span><span className="v" {...docEl('invoice.body.infoValue')}>{formatDate(invoice.invoiceDate)}</span></div>
        <div><span className="k" {...docEl('invoice.body.infoLabel')}>Dentist</span><span className="v" {...docEl('invoice.body.infoValue')}>{invoice.dentistName || '—'}</span></div>
        <div><span className="k" {...docEl('invoice.body.infoLabel')}>Status</span><span className="v" {...docEl('invoice.body.infoValue')}>{invoice.status}</span></div>
      </div>
      <table>
        <thead {...docEl('invoice.tables.head')}>
          <tr><th style={{ width: '52%' }} {...docEl('invoice.tables.colDescription')}>Description</th><th className="right" {...docEl('invoice.tables.colQty')}>Qty</th><th className="right" {...docEl('invoice.tables.colUnit')}>Unit</th><th className="right" {...docEl('invoice.tables.colTotal')}>Total</th></tr>
        </thead>
        <tbody {...docEl('invoice.tables.cell')}>
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
          <tr><td className="muted" {...docEl('invoice.tables.totalsLabel')}>Subtotal</td><td className="right mono" {...docEl('invoice.tables.totalsValue')}><PrintMoney paisa={subtotal} /></td></tr>
          {discount > 0 && <tr><td className="muted" {...docEl('invoice.tables.totalsLabel')}>Discount</td><td className="right mono" {...docEl('invoice.tables.totalsValue')}>−<PrintMoney paisa={discount} /></td></tr>}
          <tr><td className="muted" {...docEl('invoice.tables.totalsLabel')}>VAT</td><td className="right mono" {...docEl('invoice.tables.totalsValue')}><PrintMoney paisa={invoice.vatPaisa ?? 0} /></td></tr>
          <tr><td className="muted" {...docEl('invoice.tables.totalsLabel')}>Total</td><td className="right mono" {...docEl('invoice.tables.totalsValue')}><PrintMoney paisa={invoice.totalPaisa} /></td></tr>
          <tr><td className="muted" {...docEl('invoice.tables.totalsLabel')}>Paid</td><td className="right mono" {...docEl('invoice.tables.totalsValue')}><PrintMoney paisa={invoice.paidPaisa ?? 0} /></td></tr>
          <tr className="grand" {...docEl('invoice.tables.grandTotal')}><td>Balance due</td><td className="right mono" {...docEl('invoice.tables.totalsValue')}><PrintMoney paisa={invoice.duePaisa ?? 0} /></td></tr>
        </tbody>
      </table>
      {payments?.length > 0 && (
        <>
          <h2 {...docEl('invoice.tables.paymentHeading')}>Payment history</h2>
          <table className="compact">
            <thead {...docEl('invoice.tables.paymentHead')}><tr><th>Date</th><th>Method</th><th>Reference</th><th className="right">Amount</th></tr></thead>
            <tbody {...docEl('invoice.tables.paymentCell')}>
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
      <Footer scope="invoice" text={invoice.footerNote || settings?.invoice?.footerNote || 'Thank you for your visit.'} />
    </>
  );
}

export function receiptDoc(data: any): React.ReactNode {
  const { invoice, payments, clinic } = data;
  const lastPayment = payments?.[payments.length - 1];
  return (
    <>
      <Header scope="receipt" clinic={clinic} right={<><div><b>Receipt</b></div><div>{formatDate(new Date())}</div></>} />
      <div className="doc-title" {...docEl('receipt.body.title')}>Payment Receipt</div>
      <div className="print-kv">
        <div><span className="k" {...docEl('receipt.body.infoLabel')}>Received from</span><span className="v" {...docEl('receipt.body.infoValue')}>{invoice.patientName}</span></div>
        <div><span className="k" {...docEl('receipt.body.infoLabel')}>Phone</span><span className="v" {...docEl('receipt.body.infoValue')}>{invoice.patientPhone || '—'}</span></div>
        <div><span className="k" {...docEl('receipt.body.infoLabel')}>Invoice</span><span className="v mono" {...docEl('receipt.body.infoValue')}>{invoice.invoiceNumber}</span></div>
        <div><span className="k" {...docEl('receipt.body.infoLabel')}>Payment date</span><span className="v" {...docEl('receipt.body.infoValue')}>{lastPayment ? formatDate(lastPayment.paidAt) : '—'}</span></div>
      </div>
      <table>
        <tbody>
          <tr><td className="muted" {...docEl('receipt.tables.totalsLabel')}>Amount received</td><td className="right mono" {...docEl('receipt.tables.totalsValue')}><b><PrintMoney paisa={lastPayment?.amountPaisa ?? 0} /></b></td></tr>
          <tr><td className="muted" {...docEl('receipt.tables.totalsLabel')}>Method</td><td className="right">{lastPayment?.method ?? '—'}</td></tr>
          <tr><td className="muted" {...docEl('receipt.tables.totalsLabel')}>Invoice total</td><td className="right mono" {...docEl('receipt.tables.totalsValue')}><PrintMoney paisa={invoice.totalPaisa} /></td></tr>
          <tr><td className="muted" {...docEl('receipt.tables.totalsLabel')}>Total paid to date</td><td className="right mono" {...docEl('receipt.tables.totalsValue')}><PrintMoney paisa={invoice.paidPaisa ?? 0} /></td></tr>
          <tr className="grand" {...docEl('receipt.tables.grandTotal')}><td>Balance due</td><td className="right mono" {...docEl('receipt.tables.totalsValue')}><PrintMoney paisa={invoice.duePaisa ?? 0} /></td></tr>
        </tbody>
      </table>
      <div style={{ marginTop: 30 }}>
        <div className="sig-line" {...docEl('receipt.footer.signatureLine')} />
        <div className="muted small" {...docEl('receipt.footer.signatureLabel')}>Authorised signature</div>
      </div>
      <Footer scope="receipt" text="This receipt confirms payment received by Dentiva Pro-managed clinic records." />
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

      <div className="prescription-header" {...docEl('prescription.header.separator')}>
        <div className="prescription-clinic">
          {clinic?.logoDataUrl ? (
            <img className="prescription-logo" src={clinic.logoDataUrl} alt="" {...docEl('prescription.header.logo')} />
          ) : (
            <div className="prescription-logo prescription-logo-fallback" {...docEl('prescription.header.logo')}>D</div>
          )}
          <div className="prescription-clinic-copy">
            <div className="prescription-clinic-name" {...docEl('prescription.header.clinicName')}>{clinic?.clinicName || 'Dental Clinic'}</div>
            {clinic?.clinicNameBn && <div className="prescription-clinic-bn" {...docEl('prescription.header.clinicNameBn')}>{clinic.clinicNameBn}</div>}
            {clinic?.address && <div {...docEl('prescription.header.clinicAddress')}>{clinic.address}</div>}
            <div className="prescription-contact" {...docEl('prescription.header.clinicContact')}>
              {clinic?.phone && <span>{clinic.phone}</span>}
              {clinic?.email && <span>{clinic.email}</span>}
              {clinic?.website && <span>{clinic.website}</span>}
            </div>
          </div>
        </div>

        <div className="prescription-dentist">
          <div className="prescription-dentist-label" {...docEl('prescription.header.dentistLabel')}>DENTIST</div>
          <div className="prescription-dentist-name" {...docEl('prescription.header.dentistName')}>{dentistName}</div>
          {designations.map((d, i) => <div key={`des-${i}`} className="prescription-dentist-designation" {...docEl('prescription.header.dentistDesignation')}>{d}</div>)}
          {qualifications.map((q, i) => <div key={`qual-${i}`} className="prescription-dentist-qualification" {...docEl('prescription.header.dentistQualification')}>{q}</div>)}
          {otherDentistInfo.length > 0 && (
            <div className="prescription-dentist-other" {...docEl('prescription.header.dentistOther')}>
              {otherDentistInfo.map((v, i) => <div key={i}>{v}</div>)}
            </div>
          )}
        </div>
      </div>

      <div className="prescription-patient-strip" {...docEl('prescription.body.patientStrip')}>
        <div><span {...docEl('prescription.body.patientLabel')}>Patient Name</span><strong {...docEl('prescription.body.patientValue')}>{patient.name}</strong></div>
        <div><span {...docEl('prescription.body.patientLabel')}>Age</span><strong {...docEl('prescription.body.patientValue')}>{patient.ageYears != null ? `${patient.ageYears}` : '—'}</strong></div>
        <div><span {...docEl('prescription.body.patientLabel')}>Gender</span><strong {...docEl('prescription.body.patientValue')}>{patient.gender || '—'}</strong></div>
        <div className="prescription-patient-phone"><span {...docEl('prescription.body.patientLabel')}>Phone</span><strong {...docEl('prescription.body.patientValue')}>{patient.phone || '—'}</strong></div>
        <div><span {...docEl('prescription.body.patientLabel')}>Date</span><strong {...docEl('prescription.body.patientValue')}>{formatDate(rx.rxDate)}</strong></div>
        <div><span {...docEl('prescription.body.patientLabel')}>Patient ID</span><strong className="mono" {...docEl('prescription.body.patientValue')}>{patient.patientCode}</strong></div>
        <div><span {...docEl('prescription.body.patientLabel')}>Rx No.</span><strong className="mono" {...docEl('prescription.body.patientValue')}>{rx.rxNumber}</strong></div>
      </div>

      {settings?.prescription?.visitingHours && (
        <div className="prescription-visiting-hours" {...docEl('prescription.body.visitingHours')}>{settings.prescription.visitingHours}</div>
      )}

      <div className="prescription-body">
        <aside className="prescription-clinical">
          <div className="prescription-column-title" {...docEl('prescription.body.clinicalTitle')}>Clinical Notes</div>
          {clinicalFields.map((field, i) => (
            <div className={`clinical-field ${i < 3 ? 'clinical-primary' : ''}`} key={field.label}>
              <div className="clinical-label" {...docEl('prescription.body.clinicalLabel')}>{field.label}</div>
              <div className="clinical-value" {...docEl('prescription.body.clinicalValue')}>{field.value || '—'}</div>
            </div>
          ))}
        </aside>

        <section className="prescription-medications">
          <div className="rx-heading">
            <span className="rx-symbol" {...docEl('prescription.body.rxSymbol')}>Rx</span>
            <span className="rx-heading-text" {...docEl('prescription.body.rxHeading')}>Prescription</span>
          </div>

          <div className="medication-list">
            {rx.items.length > 0 ? rx.items.map((it: any, i: number) => (
              <div className="prescription-medication" key={i}>
                <div className="medication-index" {...docEl('prescription.body.medicationIndex')}>{i + 1}</div>
                <div className="medication-content">
                  <div className="medication-title" {...docEl('prescription.body.medicationTitle')}>
                    {it.form ? `${it.form} ` : ''}{it.medicineName}
                    {it.strength && <span className="medication-strength" {...docEl('prescription.body.medicationStrength')}> {it.strength}</span>}
                  </div>
                  <div className="medication-instructions" {...docEl('prescription.body.medicationInstructions')}>
                    {it.medicineInstruction?.trim() ? (
                      <span className="medication-single-instruction">{it.medicineInstruction}</span>
                    ) : (
                      <>
                        {it.dosage && <span>{it.dosage}</span>}
                        {it.frequency && <span>{it.frequency}</span>}
                        {it.route && <span>{it.route}</span>}
                        {it.duration && <span>{it.duration}</span>}
                        {it.qty && <span>Qty: {it.qty}</span>}
                        {it.instruction && <span>{it.instruction}</span>}
                      </>
                    )}
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
              <div className="prescription-section-label" {...docEl('prescription.body.adviceLabel')}>{labels.advice || 'Advice'}</div>
              <div className="prescription-section-value" {...docEl('prescription.body.adviceValue')}>{rx.advice || '—'}</div>
            </div>
            <div className="prescription-follow-up">
              <div className="prescription-section-label" {...docEl('prescription.body.followUpLabel')}>{labels.followUp || 'Follow-up'}</div>
              <div className="prescription-section-value" {...docEl('prescription.body.followUpValue')}>{rx.followUp ? formatDate(rx.followUp) : '—'}</div>
            </div>
          </div>

          {sigReserved ? (
            <div className="prescription-signature">
              <div className="prescription-signature-note muted small" {...docEl('prescription.footer.signatureNote')}>
                {watermark ? 'Duplicate copy — valid only with signature and seal.' : 'Please complete the full course as directed.'}
              </div>
              <div className="prescription-signature-box">
                <div className="sig-line" {...docEl('prescription.footer.signatureLine')} />
                <div className="prescription-signature-name" {...docEl('prescription.footer.signatureName')}>Signature</div>
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

      <Footer scope="prescription" text={settings?.prescription?.footerMessage || clinic?.clinicName || ''} />
    </>
  );
}
export function visitSummaryDoc(data: any): React.ReactNode {
  const { patient, visit, procedures, rx, clinic } = data;
  const ageGender = `${patient.ageYears != null ? `${patient.ageYears}y ` : ''}${patient.gender || ''}`.trim() || '—';
  return (
    <>
      <Header scope="visit-summary" clinic={clinic} right={<><div><b>Visit summary</b></div><div>{formatDate(visit.visitDate)}</div></>} />
      <div className="doc-title" {...docEl('visit-summary.body.title')}>Visit Summary</div>
      <div className="print-kv">
        <div><span className="k" {...docEl('visit-summary.body.infoLabel')}>Patient</span><span className="v" {...docEl('visit-summary.body.infoValue')}>{patient.name}</span></div>
        <div><span className="k" {...docEl('visit-summary.body.infoLabel')}>Patient ID</span><span className="v mono" {...docEl('visit-summary.body.infoValue')}>{patient.patientCode}</span></div>
        <div><span className="k" {...docEl('visit-summary.body.infoLabel')}>Age / Sex</span><span className="v" {...docEl('visit-summary.body.infoValue')}>{ageGender}</span></div>
        <div><span className="k" {...docEl('visit-summary.body.infoLabel')}>Phone</span><span className="v" {...docEl('visit-summary.body.infoValue')}>{patient.phone || '—'}</span></div>
        <div><span className="k" {...docEl('visit-summary.body.infoLabel')}>Visit date</span><span className="v" {...docEl('visit-summary.body.infoValue')}>{formatDate(visit.visitDate)}</span></div>
        <div><span className="k" {...docEl('visit-summary.body.infoLabel')}>Dentist</span><span className="v" {...docEl('visit-summary.body.infoValue')}>{visit.dentistName || '—'}</span></div>
      </div>
      <h2 {...docEl('visit-summary.body.sectionHeading')}>Presenting complaint</h2>
      <div {...docEl('visit-summary.body.sectionText')}>{visit.chiefComplaint || '—'}</div>
      <h2 {...docEl('visit-summary.body.sectionHeading')}>Diagnosis</h2>
      <div {...docEl('visit-summary.body.sectionText')}>{visit.diagnosis || '—'}</div>
      <h2 {...docEl('visit-summary.body.sectionHeading')}>Treatment done</h2>
      <div {...docEl('visit-summary.body.sectionText')}>{visit.treatmentNotes || '—'}</div>
      {procedures?.length > 0 && (
        <>
          <h2 {...docEl('visit-summary.body.sectionHeading')}>Procedures</h2>
          <table className="compact">
            <thead {...docEl('visit-summary.tables.head')}><tr><th>Tooth</th><th>Procedure</th><th>Details</th></tr></thead>
            <tbody {...docEl('visit-summary.tables.cell')}>
              {procedures.map((p: any) => (
                <tr key={p.id}><td className="mono">{p.toothNumber ?? '—'}</td><td>{p.treatmentName}</td><td>{p.qty} × <PrintMoney paisa={p.unitPricePaisa} /> = <PrintMoney paisa={p.totalPaisa} /></td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h2 {...docEl('visit-summary.body.sectionHeading')}>Prescriptions</h2>
      {rx?.length ? rx.map((r: any) => (
        <div key={r.id} style={{ marginBottom: 6 }} {...docEl('visit-summary.body.sectionText')}>
          <b>{r.rxNumber}</b>: {r.items?.map((i: any) => `${i.medicineName} ${i.strength ?? ''} ${i.dosage ?? ''}`).join('; ') || '—'}
        </div>
      )) : <div className="muted">No prescriptions for this visit.</div>}
      <h2 {...docEl('visit-summary.body.sectionHeading')}>Next appointment</h2>
      <div {...docEl('visit-summary.body.sectionText')}>{visit.nextVisitDate ? formatDate(visit.nextVisitDate) + (visit.nextVisitPurpose ? ` — ${visit.nextVisitPurpose}` : '') : 'None scheduled'}</div>
      <Footer scope="visit-summary" text="Computer-generated visit summary" />
    </>
  );
}

export function appointmentCardDoc(data: any): React.ReactNode {
  const { appointment, patient, clinic } = data;
  const start = new Date(`${appointment.date}T${appointment.time || '00:00'}`);
  return (
    <>
      <Header scope="appointment-card" clinic={clinic} right={<div><b>Appointment card</b></div>} />
      <div className="doc-title" {...docEl('appointment-card.body.title')}>Appointment Card</div>
      <div className="print-kv">
        <div><span className="k" {...docEl('appointment-card.body.infoLabel')}>Patient</span><span className="v" {...docEl('appointment-card.body.infoValue')}>{patient.name}</span></div>
        <div><span className="k" {...docEl('appointment-card.body.infoLabel')}>Phone</span><span className="v" {...docEl('appointment-card.body.infoValue')}>{patient.phone || '—'}</span></div>
        <div><span className="k" {...docEl('appointment-card.body.infoLabel')}>Date</span><span className="v" {...docEl('appointment-card.body.infoValue')}>{formatDate(start)}</span></div>
        <div><span className="k" {...docEl('appointment-card.body.infoLabel')}>Time</span><span className="v" {...docEl('appointment-card.body.infoValue')}>{start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div><span className="k" {...docEl('appointment-card.body.infoLabel')}>Dentist</span><span className="v" {...docEl('appointment-card.body.infoValue')}>{appointment.dentistName || '—'}</span></div>
        <div><span className="k" {...docEl('appointment-card.body.infoLabel')}>Purpose</span><span className="v" {...docEl('appointment-card.body.infoValue')}>{appointment.purpose || '—'}</span></div>
      </div>
      <p className="muted" {...docEl('appointment-card.body.note')}>
        Please arrive 10 minutes early and bring any previous prescriptions or reports.
        If you need to reschedule, call the clinic as soon as possible.
      </p>
      <Footer scope="appointment-card" text="Keep this card for your records" />
    </>
  );
}

export function stockLabelDoc(data: any): React.ReactNode {
  const { items, clinic, expiryThresholdDays } = data;
  const today = Date.now();
  return (
    <>
      <div className="doc-title" {...docEl('stock-labels.body.title')}>Stock &amp; Expiry Labels</div>
      <table className="compact">
        <thead {...docEl('stock-labels.tables.head')}><tr><th>Item</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Status</th></tr></thead>
        <tbody {...docEl('stock-labels.tables.cell')}>
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
                <td {...docEl('stock-labels.tables.status')}><b>{state}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Footer scope="stock-labels" text={`${clinic?.clinicName ?? ''} · inventory label sheet`} />
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
      qty: it.qty, instruction: it.instruction, medicineInstruction: it.medicineInstruction ?? null,
      route: null as string | null,
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
      <Header scope="report" clinic={data.clinic} right={<>
        <div><b>Report</b></div>
        <div>{formatDate(r.generatedAt)}</div>
      </>} />
      <div className="doc-title" {...docEl('report.body.title')}>{r.title}</div>
      <div className="muted" style={{ marginBottom: 8 }} {...docEl('report.body.scope')}>{r.scope}</div>
      <table className="compact">
        <thead {...docEl('report.tables.head')}>
          <tr>{r.columns.map((c: any) => (
            <th key={c.key} className={c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : ''}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody {...docEl('report.tables.cell')}>
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
                <td key={c.key} className={c.align === 'right' ? 'right mono' : ''}
                  {...docEl(i === 0 ? 'report.tables.totalsLabel' : 'report.tables.totalsValue')}>
                  {i === 0 ? 'Total' : <FormattedMoney value={r.totals[c.key]} printable />}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      <Footer scope="report" text={`${r.rows.length} rows`} />
    </>
  );
}
