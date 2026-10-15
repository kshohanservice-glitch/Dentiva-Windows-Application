import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { Button, ErrorState, Spinner, useToast } from '../components/primitives';
import { useApp } from '../state/app-context';
import { Icon } from '../components/shell';
import type { PrintProfile } from '../../shared/types';
import { a4PageCss, a4PageSize, defaultPrintProfiles } from '../../shared/print-page';
import type { DocumentStyleMap } from '../../shared/document-styles';
import { normalizeDocumentStyles } from '../../shared/document-styles';
import {
  DEFAULT_DOCUMENT_WATERMARK, normalizeDocumentWatermark,
} from '../../shared/document-watermark';
import { ClinicLogoWatermark } from '../documents/document-preview';
import {
  ageFromDob, appointmentCardDoc, emptyDoc, invToDoc, invoiceDoc, prescriptionDoc,
  receiptDoc, reportDoc, rxToDoc, stockLabelDoc, visitSummaryDoc, visitToDoc,
} from '../documents/print-documents';
import { quickDocumentNode, quickDocumentTitle } from '../documents/quick-document-view';
import { DocumentStyleSheet } from '../documents/document-style-sheet';
import type { QuickDocumentInput, QuickDocumentKind } from '../../shared/quick-documents';

interface PrintParams { [k: string]: string }

function useQuery(): PrintParams {
  const { search } = useLocation();
  return useMemo(() => Object.fromEntries(new URLSearchParams(search)), [search]);
}

/* Print payloads are validated against main-process print document kinds. */
interface PrintState {
  kind: string;
  title: string;
  doc: React.ReactNode;
  data: any;
}

/* ----------------------------- Print page ----------------------------- */

export function PrintPage() {
  const query = useQuery();
  // Path: #print/<kind>/<id>[?query]  (main process builds this hash)
  const parts = window.location.hash.replace(/^#\/?print\//, '').split('/');
  const kind = parts[0] ?? '';
  const id = parts[1]?.split('?')[0] ?? '';
  const [state, setState] = useState<PrintState | null>(null);
  const [profiles, setProfiles] = useState<PrintProfile[]>(() => defaultPrintProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState<string>(query.profile ?? '');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // Stored document customizations (Settings → Customize Documents). Empty for
  // an untouched installation, in which case no stylesheet is emitted at all.
  const [docStyles, setDocStyles] = useState<DocumentStyleMap>({});
  const [documentWatermark, setDocumentWatermark] = useState(DEFAULT_DOCUMENT_WATERMARK);
  const toast = useToast();
  const { locked, user } = useApp();
  const canOutput = !loading && !error && !locked && !!user;

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? profiles[0] ?? defaultPrintProfiles()[0],
    [profiles, selectedProfileId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const settingsOf = async () => {
      const s = await api['settings/get']();
      const storedProfiles = 'printProfiles' in s && Array.isArray(s.printProfiles) ? s.printProfiles : [];
      // The settings service already normalizes to A4 and guarantees one profile
      // per document type; the defaults cover a first run with no stored row.
      const loadedProfiles = storedProfiles.length > 0 ? [...storedProfiles] : defaultPrintProfiles();
      if (!cancelled) {
        setProfiles(loadedProfiles);
        setSelectedProfileId((cur) => {
          if (query.profile && loadedProfiles.some((p: PrintProfile) => p.id === query.profile)) return query.profile;
          if (cur && loadedProfiles.some((p: PrintProfile) => p.id === cur)) return cur;
          const byDoc = loadedProfiles.find((p: PrintProfile) =>
            (kind.startsWith('prescription') && p.documentType === 'prescription') ||
            // Walk-in documents use the profile of the document they print.
            (kind.startsWith('quick-') && p.documentType === kind.slice('quick-'.length)) ||
            (kind === 'invoice' && p.documentType === 'invoice') ||
            (kind === 'receipt' && p.documentType === 'receipt') ||
            (kind === 'report' && p.documentType === 'report'),
          );
          return byDoc?.id ?? loadedProfiles[0].id;
        });
      }
      if (!cancelled) {
        setDocStyles(normalizeDocumentStyles((s as { documentStyles?: unknown }).documentStyles));
        setDocumentWatermark(normalizeDocumentWatermark((s as { documentWatermark?: unknown }).documentWatermark));
      }
      return s;
    };
    const clinicOf = async (): Promise<any> => (await settingsOf()).clinic;
    const load = async (): Promise<PrintState> => {
      switch (kind) {
        case 'invoice':
        case 'receipt': {
          const [invoice, clinic, pays] = await Promise.all([
            api['invoices/get'](Number(id)),
            clinicOf(),
            api['payments/list']({ invoiceId: Number(id), pageSize: 200 }),
          ]);
          const payments = pays.items;
          const docInv = invToDoc(invoice);
          try {
            const pat = await api['patients/get'](invoice.patientId);
            docInv.patientPhone = pat.phone;
          } catch { /* archived patient */ }
          const fullSettings = await settingsOf();
          const payload = { invoice: docInv, payments, clinic, settings: fullSettings };
          if (kind === 'receipt') {
            if (payments.length === 0) throw new Error('No payments recorded on this invoice — nothing to receipt.');
            return { kind, title: `Receipt — ${invoice.number}`, doc: receiptDoc(payload), data: payload };
          }
          return { kind, title: `Invoice ${invoice.number}`, doc: invoiceDoc(payload), data: payload };
        }
        case 'prescription':
        case 'prescription-duplicate': {
          const rx0 = await api['prescriptions/get'](Number(id));
          const [patient, clinic, dentists] = await Promise.all([
            api['patients/get'](rx0.patientId),
            clinicOf(),
            api['dentists/list'](),
          ]);
          const dentist = dentists.find((d) => d.id === rx0.dentistId) ?? null;
          const data = {
            rx: rxToDoc(rx0),
            patient: {
              name: patient.name, ageYears: patient.ageYears ?? ageFromDob(patient.dob),
              gender: patient.gender, phone: patient.phone, patientCode: patient.code,
            },
            clinic, dentist, dentistName: rx0.dentistName, settings: await settingsOf(),
            visit: null,
            watermark: kind === 'prescription-duplicate',
          };
          return { kind, title: `${rx0.number}${data.watermark ? ' (duplicate)' : ''}`, doc: prescriptionDoc(data), data };
        }
        case 'visit-summary': {
          const visit0 = await api['visits/get'](Number(id));
          const [patient, clinic, rxs] = await Promise.all([
            api['patients/get'](visit0.patientId),
            clinicOf(),
            api['prescriptions/list']({ patientId: visit0.patientId, pageSize: 200 }),
          ]);
          const procedures = (visit0.treatments ?? []).map((t: any, i: number) => ({
            id: t.id ?? i,
            toothNumber: t.tooth ?? null,
            treatmentName: t.description,
            qty: t.qty, unitPricePaisa: t.unitPricePaisa,
            totalPaisa: t.totalPaisa ?? t.qty * t.unitPricePaisa,
          }));
          const data = {
            patient: {
              name: patient.name, ageYears: patient.ageYears ?? ageFromDob(patient.dob),
              gender: patient.gender, phone: patient.phone, patientCode: patient.code,
            },
            visit: visitToDoc(visit0),
            procedures,
            rx: rxs.items.filter((r) => r.visitId === visit0.id),
            clinic,
            settings: await settingsOf(),
          };
          return { kind, title: 'Visit summary', doc: visitSummaryDoc(data), data };
        }
        case 'appointment-card': {
          const [list, clinic] = await Promise.all([
            api['appointments/list']({ from: '2000-01-01', to: '2100-01-01' }),
            clinicOf(),
          ]);
          const appt = list.find((a) => a.id === Number(id));
          if (!appt) throw new Error('Appointment not found.');
          const patient = await api['patients/get'](appt.patientId);
          const data = { appointment: appt, patient: { name: patient.name, phone: patient.phone }, clinic };
          return { kind, title: `Appointment card — ${patient.name}`, doc: appointmentCardDoc(data), data };
        }
        case 'stock-labels': {
          const expiringMode = query.expiring === '1' || query.report === 'expiring';
          const [items, batches, clinic] = await Promise.all([
            api['inventory/items']({ includeInactive: false }),
            api['inventory/batches'](expiringMode ? { expiringWithinDays: 90 } : {}),
            clinicOf(),
          ]);
          const itemMap = new Map(items.map((it) => [it.id, it]));
          const rows = batches.map((b) => ({
            id: b.id, name: b.itemName, batchNumber: b.batchNo, expiryDate: b.expiryDate,
            quantity: b.qtyAvailable, unit: itemMap.get(b.itemId)?.unit ?? '',
          }));
          const data = { items: rows, clinic, expiryThresholdDays: 90 };
          return { kind, title: expiringMode ? 'Expiring stock labels' : 'Stock labels', doc: stockLabelDoc(data), data };
        }
        case 'report': {
          const reportName = query.report;
          if (!reportName) throw new Error('Missing report name.');
          const reportParams: Record<string, string> = {};
          if (query.from) reportParams.from = query.from;
          if (query.to) reportParams.to = query.to;
          const [result, clinic] = await Promise.all([
            api['reports/run']({ name: reportName, params: reportParams }),
            clinicOf(),
          ]);
          const data = { report: result, clinic };
          return { kind, title: result.title, doc: reportDoc(data), data };
        }
        case 'quick': {
          // Walk-in / Quick Documents: the payload is a validated transient
          // document held by the main process — no patient record is involved.
          const stored = await api['quick-documents/payload'](id);
          const fullSettings = await settingsOf();
          const input: QuickDocumentInput = { kind: stored.kind as QuickDocumentKind, payload: stored.payload as any };
          const ctx = { clinic: fullSettings.clinic, settings: fullSettings, dentist: stored.dentist ?? null };
          return {
            kind: `quick-${stored.kind}`,
            title: quickDocumentTitle(input),
            doc: quickDocumentNode(input, ctx),
            data: { input, clinic: fullSettings.clinic, settings: fullSettings },
          };
        }
        default:
          return { kind, title: 'Unknown document', doc: emptyDoc('Unknown document'), data: {} };
      }
    };
    load()
      .then((s) => { if (!cancelled) setState(s); })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  // A4 is the only document size: the profile chooses the orientation, nothing else.
  const dims = useMemo(() => a4PageSize(activeProfile.orientation), [activeProfile.orientation]);

  const print = async () => {
    if (!canOutput) return;
    try {
      const res = await api['print/execute']({
        printerName: activeProfile.printerName || undefined,
        copies: activeProfile.copies,
        // Send the exact on-screen page dimensions; main process must not rotate them again.
        landscape: false,
        widthMm: pageW,
        heightMm: pageH,
        marginsMm: activeProfile.margins,
        scale: activeProfile.scale,
      });
      if (res.ok || res.cancelled) return;
      toast.error('Print failed', res.error || 'The document could not be printed.');
      return;
    } catch (err) {
      toast.error('Print failed', err instanceof Error ? err.message : 'The document could not be printed.');
    }
  };

  const savePdf = async () => {
    if (!canOutput) return;
    try {
      const res = await api['print/pdf']({
        suggestedName: (state?.title ?? 'dentiva-document').replace(/[^A-Za-z0-9-_ ]+/g, '').trim() || 'dentiva-document',
        widthMm: pageW,
        heightMm: pageH,
        landscape: false,
        marginsMm: activeProfile.margins,
        scale: activeProfile.scale,
      });
      if (res.ok) toast.success('PDF saved', res.path);
      else if (!res.cancelled) toast.error('PDF export failed', res.error);
    } catch (err) {
      toast.error('PDF export failed', err instanceof Error ? err.message : undefined);
    }
  };

  const pageW = dims.widthMm;
  const pageH = dims.heightMm;
  // WYSIWYG contract: the preview page and the physical page share the same A4
  // dimensions. Profile margins are document padding, not a second @page margin.
  const profilePrintCss = a4PageCss(activeProfile.orientation);
  const docStyle: React.CSSProperties = {
    width: pageW + 'mm',
    minHeight: pageH + 'mm',
    padding: activeProfile.margins.top + 'mm ' + activeProfile.margins.right + 'mm ' +
      activeProfile.margins.bottom + 'mm ' + activeProfile.margins.left + 'mm',
  };

  return (
    <div className="print-root">
      <style>{profilePrintCss}</style>
      {/* Applied before the document so the generated rules win over the base
          stylesheet for the elements the clinic customized; renders nothing
          when there are no customizations. */}
      <DocumentStyleSheet styles={docStyles} />
      <div className="print-toolbar">
        <div className="row gap-2">
          <Button variant="secondary" size="sm" icon={Icon.chevronL} onClick={async () => { try { await api['print/close'](); } finally { window.close(); } }}>Back</Button>
          <strong>{state?.title ?? 'Print document'}</strong>
          {/* Print/PDF is an intentional, permission-gated export: the document
              always carries the real amounts, never the on-screen mask. */}
          <span className="xsmall muted">Printed and saved documents show actual amounts</span>
        </div>
        <div className="row gap-2">
          <select
            className="select"
            style={{ width: 220, height: 32, fontSize: 12.5 }}
            value={activeProfile.id}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            aria-label="Print profile"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={() => window.close()}>Close</Button>
          <Button variant="secondary" size="sm" onClick={() => void savePdf()} disabled={!canOutput}>Save PDF</Button>
          <Button variant="primary" size="sm" icon={Icon.print} onClick={() => void print()} disabled={!canOutput}>
            Print
          </Button>
        </div>
      </div>
      <div className="print-stage" tabIndex={0} role="region" aria-label="Print preview">
        {loading && <Spinner label="Loading document…" />}
        {!loading && error != null && (
          <div className="card card-pad" style={{ width: 560 }}>
            <ErrorState error={error} onRetry={() => { setState(null); setError(null); window.location.reload(); }} />
          </div>
        )}
        {(locked || !user) && !loading && <div className="card card-pad">Unlock the app to view or print this document.</div>}
        {!loading && error == null && !locked && !!user && (
          <div className="print-doc" style={docStyle}>
            <ClinicLogoWatermark
              clinic={state?.data?.clinic}
              settings={documentWatermark}
              documentType={state?.kind}
              pageSize={{ widthMm: pageW, heightMm: pageH }}
            />
            {/* Content layer: paints above the logo watermark (see print.css). */}
            <div className="print-doc-content">{state?.doc}</div>
          </div>
        )}
      </div>
    </div>
  );
}
