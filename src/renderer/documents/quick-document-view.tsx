import React from 'react';
import { computeInvoiceStatus, computeInvoiceTotals, paymentSummary } from '../../shared/billing-math';
import type {
  QuickAppointmentCardPayload, QuickDocumentInput, QuickInvoicePayload,
  QuickPrescriptionPayload, QuickReceiptPayload, QuickVisitSummaryPayload,
} from '../../shared/quick-documents';
import { QUICK_DOCUMENT_DEFS } from '../../shared/quick-documents';
import { appointmentCardDoc, invoiceDoc, prescriptionDoc, receiptDoc, visitSummaryDoc } from './print-documents';

/**
 * Maps a validated walk-in / quick-document payload onto the **same** document
 * builders that render stored documents, so both workflows print one template.
 *
 * Only presentation and mapping live here: line totals, discounts, paid/due and
 * payment status come from the shared integer arithmetic in
 * `shared/billing-math.ts`, which the stored-invoice service uses as well.
 *
 * No patient identifier is ever produced — a walk-in customer is printed with
 * the label “Walk-in” and the quick-document reference, never with a patient
 * code that could be mistaken for a registered patient.
 */
export interface QuickDocumentRenderContext {
  clinic: any;
  settings: any;
  /** Dentist record resolved in the main process when the form selected one. */
  dentist?: any | null;
}

const WALK_IN_LABEL = 'Walk-in';

export function quickDocumentNode(input: QuickDocumentInput, ctx: QuickDocumentRenderContext): React.ReactNode {
  switch (input.kind) {
    case 'prescription': {
      const p = input.payload as QuickPrescriptionPayload;
      return prescriptionDoc({
        rx: {
          id: 0,
          rxNumber: p.reference,
          rxDate: p.date,
          dentistId: p.dentistId,
          dentistName: p.dentistName,
          cC: p.cC,
          oE: p.oE,
          rE: p.rE,
          treatment: p.treatment,
          diagnosis: p.diagnosis,
          advice: p.advice,
          followUp: p.followUp,
          medicineInstruction: p.medicineInstruction,
          items: p.items.map((item, index) => ({ ...item, seq: index + 1 })),
        },
        patient: {
          name: p.customer.name,
          ageYears: p.customer.ageYears,
          gender: p.customer.gender,
          phone: p.customer.phone,
          patientCode: WALK_IN_LABEL,
        },
        clinic: ctx.clinic,
        visit: null,
        watermark: false,
        settings: ctx.settings,
        dentist: ctx.dentist ?? null,
      });
    }
    case 'invoice': {
      const p = input.payload as QuickInvoicePayload;
      const totals = computeInvoiceTotals(p.lines, p.invoiceDiscountPaisa);
      const payment = paymentSummary(totals.totalPaisa, p.amountReceivedPaisa);
      return invoiceDoc({
        invoice: {
          id: 0,
          invoiceNumber: p.reference,
          invoiceDate: p.date,
          patientName: p.customer.name,
          patientPhone: p.customer.phone,
          dentistName: null,
          status: computeInvoiceStatus(totals.totalPaisa, payment.paidPaisa),
          subtotalPaisa: totals.subtotalPaisa,
          discountPaisa: totals.lineDiscountPaisa + totals.invoiceDiscountPaisa,
          vatPaisa: 0,
          totalPaisa: totals.totalPaisa,
          paidPaisa: payment.paidPaisa,
          duePaisa: payment.duePaisa,
          footerNote: p.note,
          lines: totals.lines.map((line, index) => ({
            id: index + 1,
            description: line.description,
            toothNumber: null,
            quantity: line.qty,
            unitPricePaisa: line.unitPricePaisa,
            totalPaisa: line.totalPaisa,
          })),
        },
        payments: payment.paidPaisa > 0
          ? [{ id: 1, paidAt: p.date, method: p.method ?? '—', reference: p.reference, amountPaisa: payment.paidPaisa }]
          : [],
        clinic: ctx.clinic,
        settings: ctx.settings,
      });
    }
    case 'receipt': {
      const p = input.payload as QuickReceiptPayload;
      return receiptDoc({
        invoice: {
          patientName: p.customer.name,
          patientPhone: p.customer.phone,
          invoiceNumber: p.reference,
          totalPaisa: p.amountPaisa,
          paidPaisa: p.amountPaisa,
          duePaisa: 0,
        },
        payments: [{
          id: 1,
          paidAt: p.date,
          method: p.method ?? '—',
          reference: p.paymentReference,
          amountPaisa: p.amountPaisa,
        }],
        clinic: ctx.clinic,
      });
    }
    case 'visit-summary': {
      const p = input.payload as QuickVisitSummaryPayload;
      return visitSummaryDoc({
        patient: {
          name: p.customer.name,
          ageYears: p.customer.ageYears,
          gender: p.customer.gender,
          phone: p.customer.phone,
          patientCode: WALK_IN_LABEL,
        },
        visit: {
          id: 0,
          visitDate: p.date,
          chiefComplaint: p.chiefComplaint,
          diagnosis: p.diagnosis,
          treatmentNotes: p.treatmentNotes,
          dentistName: p.dentistName,
          nextVisitDate: p.nextVisitDate,
          nextVisitPurpose: p.nextVisitPurpose,
        },
        procedures: p.procedures.map((procedure, index) => ({
          id: index + 1,
          toothNumber: procedure.toothNumber,
          treatmentName: procedure.treatmentName,
          qty: procedure.qty,
          unitPricePaisa: procedure.unitPricePaisa,
          totalPaisa: procedure.qty * procedure.unitPricePaisa,
        })),
        rx: [],
        clinic: ctx.clinic,
      });
    }
    case 'appointment-card': {
      const p = input.payload as QuickAppointmentCardPayload;
      return appointmentCardDoc({
        appointment: {
          id: 0,
          date: p.date,
          time: p.time,
          dentistName: p.dentistName,
          purpose: p.purpose,
        },
        patient: { name: p.customer.name, phone: p.customer.phone },
        clinic: ctx.clinic,
      });
    }
  }
}

export function quickDocumentTitle(input: QuickDocumentInput): string {
  const def = QUICK_DOCUMENT_DEFS[input.kind];
  return `${def.shortLabel} — ${input.payload.customer.name || 'Walk-in'} (${input.payload.reference})`;
}
