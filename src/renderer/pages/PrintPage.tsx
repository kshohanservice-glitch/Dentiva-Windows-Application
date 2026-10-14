import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { Button, ErrorState, Spinner, useToast } from '../components/primitives';
import { useApp } from '../state/app-context';
import { Icon } from '../components/shell';
import type { PrintProfile } from '../../shared/types';
import type { DocumentStyleMap } from '../../shared/document-styles';
import { normalizeDocumentStyles } from '../../shared/document-styles';
import {
  ageFromDob, appointmentCardDoc, emptyDoc, invToDoc, invoiceDoc, prescriptionDoc,
  receiptDoc, reportDoc, rxToDoc, stockLabelDoc, visitSummaryDoc, visitToDoc,
} from '../documents/print-documents';
import { quickDocumentNode, quickDocumentTitle } from '../documents/quick-document-view';
import { DocumentStyleSheet } from '../documents/document-style-sheet';
import { WatermarkLayer } from '../documents/watermark-layer';
import { WATERMARK_DEFAULT, normalizeWatermarkSettings, type WatermarkSettings } from '../../shared/watermark';
import type { QuickDocumentInput, QuickDocumentKind } from '../../shared/quick-documents';

const DEFAULT_PRINT_PROFILES: PrintProfile[] = [
  { id: 'rx-a4', name: 'Prescription A4', documentType: 'prescription', printerName: '', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
  { id: 'rx-a5', name: 'Prescription A5', documentType: 'prescription', printerName: '', paperSize: 'a5', widthMm: 148, heightMm: 210, orientation: 'portrait', margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 100, copies: 1 },
  { id: 'inv-a4', name: 'Invoice A4', documentType: 'invoice', printerName: '', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
  { id: 'rc-a4', name: 'Receipt A4', documentType: 'receipt', printerName: '', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
];

const PAPER_DIMS_MM: Record<string, { widthMm: number; heightMm: number }> = {
  a4: { widthMm: 210, heightMm: 297 },
  a5: { widthMm: 148, heightMm: 210 },
  custom: { widthMm: 210, heightMm: 297 },
};

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
  const [profiles, setProfiles] = useState<PrintProfile[]>(DEFAULT_PRINT_PROFILES);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(query.profile ?? '');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // Stored document customizations (Settings → Customize Documents). Empty for
  // an untouched installation, in which case no stylesheet is emitted at all.
  const [docStyles, setDocStyles] = useState<DocumentStyleMap>({});
  // Clinic-logo watermark. Starts disabled and is replaced by the stored
  // setting as soon as it is loaded, so a slow or failed settings read can only
  // ever produce a *plainer* document — never a broken one.
  const [watermark, setWatermark] = useState<WatermarkSettings>(WATERMARK_DEFAULT);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const toast = useToast();
  const { locked, user } = useApp();
  const canOutput = !loading && !error && !locked && !!user;

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? profiles[0] ?? DEFAULT_PRINT_PROFILES[0],
    [profiles, selectedProfileId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const settingsOf = async () => {
      const s = await api['settings/get']();
      const storedProfiles = 'printProfiles' in s && Array.isArray(s.printProfiles) ? s.printProfiles : [];
      const loadedProfiles = storedProfiles.length > 0 ? [...storedProfiles] : [...DEFAULT_PRINT_PROFILES];
      if (!loadedProfiles.some((p: PrintProfile) => p.documentType === 'receipt')) {
        const receiptFallback = DEFAULT_PRINT_PROFILES.find((p) => p.documentType === 'receipt');
        if (receiptFallback) loadedProfiles.push(receiptFallback);
      }
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
      setDocStyles(normalizeDocumentStyles((s as { documentStyles?: unknown }).documentStyles));
      if (!cancelled) {
        setWatermark(normalizeWatermarkSettings((s as { watermark?: unknown }).watermark));
        setLogoDataUrl(((s as { clinic?: { logoDataUrl?: string | null } }).clinic?.logoDataUrl) ?? null);
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
          return { kind: `quick-${stored.kind}`, title: quickDocumentTitle(input), doc: quickDocumentNode(input, ctx), data: input };
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

  const dims = useMemo(() => {
    const base = PAPER_DIMS_MM[activeProfile.paperSize] ?? PAPER_DIMS_MM.a4;
    return {
      widthMm: activeProfile.widthMm || base.widthMm,
      heightMm: activeProfile.heightMm || base.heightMm,
    };
  }, [activeProfile]);

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

  const pageW = activeProfile.orientation === 'landscape' ? dims.heightMm : dims.widthMm;
  const pageH = activeProfile.orientation === 'landscape' ? dims.widthMm : dims.heightMm;
  // WYSIWYG contract: the preview page and the physical page share the same
  // dimensions. Profile margins are document padding, not a second @page margin.
  const profilePrintCss = '@page { size: ' + pageW + 'mm ' + pageH + 'mm; margin: 0; }';
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
      <div className="print-stage">
        {loading && <Spinner label="Loading document…" />}
        {!loading && error != null && (
          <div className="card card-pad" style={{ width: 560 }}>
            <ErrorState error={error} onRetry={() => { setState(null); setError(null); window.location.reload(); }} />
          </div>
        )}
        {(locked || !user) && !loading && <div className="card card-pad">Unlock the app to view or print this document.</div>}
        {!loading && error == null && !locked && !!user && (
          <div className="print-doc" style={docStyle}>
            {/* Page-level clinic-logo watermark: centred on the real page
                geometry and painted under the document content. Renders
                nothing unless the clinic enabled it and a logo exists. */}
            <WatermarkLayer
              settings={watermark}
              logoDataUrl={logoDataUrl}
              pageWidthMm={pageW}
              pageHeightMm={pageH}
              documentKind={state?.kind ?? kind}
            />
            {state?.doc}
          </div>
        )}
      </div>
    </div>
  );
}
