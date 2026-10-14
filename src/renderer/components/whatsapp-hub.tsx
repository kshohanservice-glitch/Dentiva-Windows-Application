import { useEffect, useMemo, useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, Spinner, useToast } from './primitives';
import { Field, Input, Select, Textarea } from './forms';
import { Money } from './money';
import { formatDate } from '../format';
import { buildWhatsAppUrl, normalizeWhatsAppNumber, TEMPLATE_CATEGORY_LABELS, type WhatsAppTemplateCategory } from '../../shared/whatsapp';
import type { PatientDetailDTO, PatientDocumentDTO, WhatsAppMessageLogDTO, WhatsAppPrepareResult } from '../../shared/types';

/**
 * Patient Profile hub for free WhatsApp messaging and printable-document
 * sharing. Every control is English; Bengali appears only inside the
 * outgoing message text itself. Dentiva Pro never sends anything — it opens
 * the official WhatsApp Click to Chat link and the doctor presses Send (and
 * attaches PDFs) inside WhatsApp.
 */

const CONSENT_LABELS: Record<string, string> = {
  unknown: 'Not recorded',
  granted: 'Granted',
  declined: 'Declined',
};

function consentTone(consent: string): 'success' | 'warning' | 'danger' {
  return consent === 'granted' ? 'success' : consent === 'declined' ? 'danger' : 'warning';
}

export function WhatsAppHub(props: { patient: PatientDetailDTO; onPatientChanged: () => void }) {
  const { patient } = props;
  const { can } = useApp();
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composer, setComposer] = useState<{
    category: WhatsAppTemplateCategory;
    documents?: PatientDocumentDTO[];
  } | null>(null);
  const [shareDocs, setShareDocs] = useState<PatientDocumentDTO[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openingChat, setOpeningChat] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);

  const docs = useAsync(() => api['whatsapp/documents'](patient.id), [patient.id]);
  const history = useAsync(() => api['whatsapp/history'](patient.id), [patient.id]);

  const documents = useMemo(() => docs.data ?? [], [docs.data]);
  const selectedDocuments = documents.filter((d) => selected.has(d.key));

  const toggleDoc = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const previewDoc = async (doc: PatientDocumentDTO) => {
    try {
      await api['reports/print']({ type: doc.kind, id: doc.documentId });
    } catch (err) {
      toast.fromError(err, 'Could not open print preview');
    }
  };

  const openPlainChat = async () => {
    setOpeningChat(true);
    try {
      const prepared = await api['whatsapp/prepare']({ patientId: patient.id, category: 'custom', dryRun: true });
      await api['whatsapp/open'](prepared.url);
      toast.push({ kind: 'info', title: 'WhatsApp opened', message: 'Review the message and press Send in WhatsApp. Dentiva Pro cannot confirm delivery.' });
    } catch (err) {
      toast.fromError(err, 'Could not open WhatsApp chat');
    } finally {
      setOpeningChat(false);
    }
  };

  // Recovery path: the same prepared link, placed on the clipboard so it can
  // be pasted into a browser or WhatsApp when Windows cannot open it.
  const copyPlainChatLink = async () => {
    setCopyingLink(true);
    try {
      const prepared = await api['whatsapp/prepare']({ patientId: patient.id, category: 'custom', dryRun: true });
      await api['whatsapp/copy-link'](prepared.url);
      toast.push({ kind: 'info', title: 'Link copied', message: 'Paste it into your browser or WhatsApp to continue.' });
    } catch (err) {
      toast.fromError(err, 'Could not copy the WhatsApp link');
    } finally {
      setCopyingLink(false);
    }
  };

  return (
    <div className="col gap-4">
      <Card
        title="WhatsApp & Documents"
        actions={<Button size="sm" variant="ghost" onClick={() => { docs.reload(); history.reload(); }}>Refresh Documents</Button>}
      >
        <div className="col gap-3">
          <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
            <span className="small muted">WhatsApp Number</span>
            <strong className="mono">{patient.whatsappNumber ? `+${patient.whatsappNumber}` : 'Not recorded'}</strong>
            <Badge tone={consentTone(patient.whatsappConsent)}>Consent: {CONSENT_LABELS[patient.whatsappConsent]}</Badge>
            {can('patients.edit') && (
              <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>Edit WhatsApp Number</Button>
            )}
          </div>
          <p className="xsmall muted" style={{ margin: 0 }}>
            Messages are prepared here and opened in WhatsApp with the official Click to Chat link. Nothing is sent
            automatically — you review the message, attach any PDF by hand, and press Send in WhatsApp. Opening a chat
            is not proof of delivery. WhatsApp Desktop is not required: the link opens in the default browser, which
            shows WhatsApp Web. If Windows cannot open it, use Copy link and paste it into the browser yourself.
          </p>
          <div className="row gap-2 wrap">
            <Button variant="primary" loading={openingChat} onClick={() => void openPlainChat()}>Open WhatsApp Chat</Button>
            <Button variant="ghost" loading={copyingLink} onClick={() => void copyPlainChatLink()}>Copy link</Button>
            <Button variant="secondary" onClick={() => setComposer({ category: 'appointment_reminder' })}>Send Reminder</Button>
            <Button variant="secondary" onClick={() => setComposer({ category: 'follow_up_reminder' })}>Send Follow-up Reminder</Button>
            <Button variant="secondary" onClick={() => setComposer({ category: 'custom' })}>Send Custom Message</Button>
            <Button
              variant="secondary"
              disabled={selectedDocuments.length === 0}
              onClick={() => setShareDocs(selectedDocuments)}
            >
              Share PDF{selectedDocuments.length > 0 ? ` (${selectedDocuments.length} selected)` : ''}
            </Button>
            <Button variant="ghost" onClick={() => setHistoryOpen((v) => !v)}>View Message History</Button>
          </div>
          {historyOpen && (
            <MessageHistory
              entries={history.data ?? []}
              loading={history.loading}
              error={history.error}
              onRetry={history.reload}
              onStatus={async (id, status) => {
                try {
                  await api['whatsapp/history/status']({ id, status });
                  toast.success('Message status recorded', 'This is your own report, not an official delivery receipt.');
                  history.reload();
                } catch (err) {
                  toast.fromError(err, 'Could not record status');
                }
              }}
            />
          )}
        </div>
      </Card>

      <Card title="Printable Documents" actions={<span className="xsmall muted">Only this patient&apos;s documents are listed</span>}>
        {docs.loading && !docs.data && <Spinner label="Loading documents…" />}
        {docs.error && <ErrorState error={docs.error} onRetry={docs.reload} />}
        {docs.data && documents.length === 0 && (
          <EmptyState title="No printable documents yet" body="Prescriptions, invoices, receipts, visit summaries and appointment cards for this patient will appear here." />
        )}
        {documents.length > 0 && (
          <div className="col gap-2">
            {selectedDocuments.length > 0 && (
              <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
                <Badge tone="brand">{selectedDocuments.length} document{selectedDocuments.length === 1 ? '' : 's'} selected</Badge>
                <span className="xsmall muted">{selectedDocuments.map((d) => d.typeLabel).join(', ')}</span>
                <Button size="sm" variant="primary" onClick={() => setShareDocs(selectedDocuments)}>Share selected PDFs</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
              </div>
            )}
            {documents.map((doc) => (
              <div key={doc.key} className="list-row">
                <label className="checkbox" style={{ marginRight: 4 }}>
                  <input type="checkbox" checked={selected.has(doc.key)} onChange={() => toggleDoc(doc.key)} />
                  <span className="sr-only">Select document</span>
                </label>
                <div className="flex-1">
                  <div className="row gap-2 wrap">
                    <strong>{doc.typeLabel}</strong>
                    {doc.reference && <span className="mono small">{doc.reference}</span>}
                    {doc.status && <Badge tone="neutral">{doc.status}</Badge>}
                  </div>
                  <div className="xsmall muted">
                    {formatDate(doc.date)}
                    {doc.relatedLabel ? ` · ${doc.relatedLabel}` : ''}
                    {doc.amountPaisa != null ? <> · <Money paisa={doc.amountPaisa} /></> : null}
                  </div>
                </div>
                <div className="row gap-2 end">
                  <Button size="sm" variant="ghost" onClick={() => void previewDoc(doc)}>Preview</Button>
                  <Button size="sm" variant="secondary" onClick={() => setShareDocs([doc])}>Share PDF</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editOpen && (
        <EditWhatsAppNumberModal
          patient={patient}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); props.onPatientChanged(); }}
        />
      )}
      {composer && (
        <MessageComposerModal
          patient={patient}
          category={composer.category}
          documents={composer.documents}
          onClose={() => setComposer(null)}
          onDone={() => history.reload()}
        />
      )}
      {shareDocs && (
        <ShareDocumentsModal
          patient={patient}
          documents={shareDocs}
          onClose={() => setShareDocs(null)}
          onPreview={(doc) => void previewDoc(doc)}
          onDone={() => history.reload()}
        />
      )}
    </div>
  );
}

function MessageHistory(props: {
  entries: WhatsAppMessageLogDTO[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onStatus: (id: number, status: 'sent' | 'not_sent' | 'unknown') => Promise<void>;
}) {
  if (props.loading && props.entries.length === 0) return <Spinner label="Loading message history…" />;
  if (props.error) return <ErrorState error={props.error} onRetry={props.onRetry} />;
  if (props.entries.length === 0) {
    return <EmptyState title="No messages prepared yet" body="Prepared WhatsApp messages for this patient will appear here with the outcome you report." />;
  }
  return (
    <div className="col gap-2">
      <p className="xsmall muted" style={{ margin: 0 }}>
        Status values are reported by you after using WhatsApp. They are not official delivery or read receipts.
      </p>
      {props.entries.map((entry) => (
        <div key={entry.id} className="list-row">
          <div className="flex-1">
            <div className="row gap-2 wrap">
              <strong>{entry.category ? TEMPLATE_CATEGORY_LABELS[entry.category as WhatsAppTemplateCategory] ?? entry.category : 'Message'}</strong>
              <Badge tone={entry.status === 'sent' ? 'success' : entry.status === 'not_sent' ? 'danger' : 'warning'}>
                {entry.status === 'prepared' ? 'Prepared' : entry.status === 'sent' ? 'Sent (reported)' : entry.status === 'not_sent' ? 'Not sent (reported)' : 'Unknown'}
              </Badge>
            </div>
            <div className="xsmall muted">
              {formatDate(entry.createdAt)} · {entry.destinationNumber ? `+${entry.destinationNumber}` : 'No destination'}
              {entry.documents.length > 0 ? ` · ${entry.documents.length} document(s)` : ''}
            </div>
            {entry.messagePreview && <div className="xsmall" style={{ whiteSpace: 'pre-wrap' }}>{entry.messagePreview}</div>}
          </div>
          <div className="row gap-2 end">
            <Button size="sm" variant="ghost" onClick={() => void props.onStatus(entry.id, 'sent')}>Sent</Button>
            <Button size="sm" variant="ghost" onClick={() => void props.onStatus(entry.id, 'not_sent')}>Not Sent</Button>
            <Button size="sm" variant="ghost" onClick={() => void props.onStatus(entry.id, 'unknown')}>Unknown</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function EditWhatsAppNumberModal(props: { patient: PatientDetailDTO; onClose: () => void; onSaved: () => void }) {
  const { patient } = props;
  const toast = useToast();
  const [number, setNumber] = useState(patient.whatsappNumber ? `+${patient.whatsappNumber}` : '');
  const [same, setSame] = useState(patient.whatsappSameAsPhone);
  const [consent, setConsent] = useState(patient.whatsappConsent);
  const [validation, setValidation] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const validateNumber = () => {
    const result = normalizeWhatsAppNumber(same ? (patient.phone ?? '') : number);
    setValidation(result.ok ? `Valid WhatsApp number: ${result.display}` : result.error);
    return result;
  };

  const save = async () => {
    const result = normalizeWhatsAppNumber(same ? (patient.phone ?? '') : number);
    if (number.trim() !== '' || same) {
      if (!result.ok) { setValidation(result.error); return; }
    }
    setPending(true);
    try {
      await api['patients/update']({
        id: patient.id,
        name: patient.name,
        gender: patient.gender,
        whatsappNumber: same ? (patient.phone ?? '') : (number.trim() === '' ? null : number),
        whatsappSameAsPhone: same,
        whatsappConsent: consent,
      });
      toast.success('WhatsApp number saved', patient.name);
      props.onSaved();
    } catch (err) {
      toast.fromError(err, 'Could not save WhatsApp number');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="Edit WhatsApp Number"
      onClose={props.onClose}
      footer={<>
        <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={() => void save()}>Save Patient</Button>
      </>}
    >
      <div className="col gap-3">
        <div className="kv-list">
          <div className="kv"><span className="k">Patient</span><span className="v">{patient.name} ({patient.code})</span></div>
          <div className="kv"><span className="k">Phone Number</span><span className="v mono">{patient.phone ?? '—'}</span></div>
        </div>
        <Field label="WhatsApp Number" hint="Bangladesh or international format, for example 01712345678 or +8801712345678">
          {(id) => (
            <Input
              id={id}
              value={same ? (patient.phone ?? '') : number}
              onChange={(v) => { setNumber(v); setValidation(null); }}
              placeholder="01XXXXXXXXX"
              disabled={same}
            />
          )}
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={same}
            onChange={(e) => {
              setSame(e.target.checked);
              setValidation(null);
              if (e.target.checked && patient.phone) setNumber(patient.phone);
            }}
          />
          <span>Same as Phone Number</span>
        </label>
        <Field label="WhatsApp consent" hint="A phone number alone is not consent. Record what the patient agreed to.">
          {(id) => (
            <Select
              id={id}
              value={consent}
              onChange={(v) => setConsent(v as PatientDetailDTO['whatsappConsent'])}
              options={[
                { value: 'unknown', label: 'Not recorded' },
                { value: 'granted', label: 'Granted — patient agreed to WhatsApp messages' },
                { value: 'declined', label: 'Declined — do not send WhatsApp messages' },
              ]}
            />
          )}
        </Field>
        <div className="row gap-2">
          <Button variant="secondary" onClick={validateNumber}>Validate Number</Button>
          {validation && <span className="small">{validation}</span>}
        </div>
      </div>
    </Modal>
  );
}

interface ComposerProps {
  patient: PatientDetailDTO;
  category: WhatsAppTemplateCategory;
  documents?: PatientDocumentDTO[];
  onClose: () => void;
  onDone: () => void;
}

function MessageComposerModal(props: ComposerProps) {
  const { patient } = props;
  const toast = useToast();
  const [category, setCategory] = useState<WhatsAppTemplateCategory>(props.category);
  const [templateId, setTemplateId] = useState<string>('');
  const [appointmentId, setAppointmentId] = useState<string>('');
  const [previousAppointmentId, setPreviousAppointmentId] = useState<string>('');
  const [visitId, setVisitId] = useState<string>('');
  const [customBody, setCustomBody] = useState('');
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<WhatsAppPrepareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [lastLogId, setLastLogId] = useState<number | null>(null);

  const templates = useAsync(() => api['whatsapp/templates/list'](), []);
  const appointments = useAsync(
    () => api['appointments/list']({ from: '2000-01-01', to: '2100-01-01' }),
    [],
  );
  const visits = useAsync(
    () => api['visits/list']({ patientId: patient.id, pageSize: 100 }),
    [patient.id],
  );

  const patientAppointments = useMemo(
    () => (appointments.data ?? []).filter((a) => a.patientId === patient.id),
    [appointments.data, patient.id],
  );
  const followUpVisits = useMemo(
    () => (visits.data?.items ?? []).filter((v) => v.followUpDate),
    [visits.data],
  );
  const enabledTemplates = useMemo(
    () => (templates.data ?? []).filter((t) => t.enabled),
    [templates.data],
  );

  const generate = async (overrides?: { templateId?: string; appointmentId?: string; previousAppointmentId?: string; visitId?: string; category?: WhatsAppTemplateCategory }) => {
    setBusy(true);
    try {
      const result = await api['whatsapp/prepare']({
        patientId: patient.id,
        templateId: (overrides?.templateId ?? templateId) ? Number(overrides?.templateId ?? templateId) : null,
        category: overrides?.category ?? category,
        appointmentId: (overrides?.appointmentId ?? appointmentId) ? Number(overrides?.appointmentId ?? appointmentId) : null,
        previousAppointmentId: (overrides?.previousAppointmentId ?? previousAppointmentId) ? Number(overrides?.previousAppointmentId ?? previousAppointmentId) : null,
        visitId: (overrides?.visitId ?? visitId) ? Number(overrides?.visitId ?? visitId) : null,
        documents: (props.documents ?? []).map((d) => ({ kind: d.kind, documentId: d.documentId })),
        customBody: customBody || null,
        dryRun: true,
      });
      setPrepared(result);
      setMessage(result.message);
      setWarnings(result.warnings);
      setEdited(false);
    } catch (err) {
      toast.fromError(err, 'Could not prepare the message');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void generate();
    // Generate once when the composer opens; later changes regenerate explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestRegenerate = () => {
    if (edited) setRegenerateOpen(true);
    else void generate();
  };

  const preparePayload = (overrides: { dryRun: boolean; messageOverride?: boolean }) => ({
    patientId: patient.id,
    templateId: templateId ? Number(templateId) : null,
    category,
    appointmentId: appointmentId ? Number(appointmentId) : null,
    previousAppointmentId: previousAppointmentId ? Number(previousAppointmentId) : null,
    visitId: visitId ? Number(visitId) : null,
    documents: (props.documents ?? []).map((d) => ({ kind: d.kind, documentId: d.documentId })),
    customBody: customBody || null,
    messageOverride: overrides.messageOverride && edited ? message : null,
    dryRun: overrides.dryRun,
  });

  const openWhatsApp = async () => {
    setBusy(true);
    try {
      const result = await api['whatsapp/prepare'](preparePayload({ dryRun: false, messageOverride: true }));
      setWarnings(result.warnings);
      setLastLogId(result.logId);
      await api['whatsapp/open'](result.url);
      toast.push({ kind: 'info', title: 'WhatsApp opened', message: 'Review the message in WhatsApp and press Send there. Dentiva Pro cannot confirm delivery.' });
      props.onDone();
    } catch (err) {
      toast.fromError(err, 'Could not open WhatsApp');
    } finally {
      setBusy(false);
    }
  };

  // Recovery path: copy the same prepared link so it can be pasted into a
  // browser or WhatsApp when Windows cannot open it.
  const copyWhatsAppLink = async () => {
    setBusy(true);
    try {
      const result = await api['whatsapp/prepare'](preparePayload({ dryRun: true, messageOverride: true }));
      await api['whatsapp/copy-link'](result.url);
      toast.push({ kind: 'info', title: 'Link copied', message: 'Paste it into your browser or WhatsApp to continue.' });
    } catch (err) {
      toast.fromError(err, 'Could not copy the WhatsApp link');
    } finally {
      setBusy(false);
    }
  };

  const reportStatus = async (status: 'sent' | 'not_sent' | 'unknown') => {
    if (!lastLogId) return;
    try {
      await api['whatsapp/history/status']({ id: lastLogId, status });
      toast.success('Status recorded', 'This is your own report, not an official delivery receipt.');
      props.onDone();
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Could not record status');
    }
  };

  if (regenerateOpen) {
    return (
      <ConfirmDialog
        title="Regenerate message?"
        body="Regenerating replaces your manual edits with a freshly generated message, including the greeting for the current time."
        confirmLabel="Regenerate message"
        onCancel={() => setRegenerateOpen(false)}
        onConfirm={() => { setRegenerateOpen(false); void generate(); }}
      />
    );
  }

  return (
    <Modal
      title={category === 'follow_up_reminder' ? 'Send Follow-up Reminder' : category === 'custom' ? 'Send Custom Message' : 'Send Reminder'}
      onClose={props.onClose}
      width="wide"
      footer={<>
        <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
        <Button variant="ghost" loading={busy} onClick={() => void copyWhatsAppLink()}>Copy link</Button>
        {lastLogId ? (
          <>
            <span className="small muted">After sending in WhatsApp, record the outcome:</span>
            <Button variant="secondary" onClick={() => void reportStatus('sent')}>Sent</Button>
            <Button variant="secondary" onClick={() => void reportStatus('not_sent')}>Not Sent</Button>
            <Button variant="secondary" onClick={() => void reportStatus('unknown')}>Unknown</Button>
          </>
        ) : (
          <Button variant="primary" loading={busy} onClick={() => void openWhatsApp()}>Open WhatsApp</Button>
        )}
      </>}
    >
      <div className="col gap-3">
        <div className="kv-list">
          <div className="kv"><span className="k">Patient</span><span className="v">{patient.name} ({patient.code})</span></div>
          <div className="kv"><span className="k">WhatsApp Number</span><span className="v mono">{prepared?.destinationDisplay ?? (patient.whatsappNumber ? `+${patient.whatsappNumber}` : 'Not recorded')}</span></div>
          <div className="kv"><span className="k">Consent</span><span className="v">{CONSENT_LABELS[patient.whatsappConsent]}</span></div>
        </div>

        <div className="form-grid">
          <Field label="Message template">
            {(id) => (
              <Select
                id={id}
                value={templateId}
                onChange={(v) => {
                  setTemplateId(v);
                  const tpl = enabledTemplates.find((t) => String(t.id) === v);
                  if (tpl) setCategory(tpl.category);
                  if (!edited) void generate({ templateId: v, category: tpl?.category ?? category });
                  else toast.push({ kind: 'info', title: 'Template changed', message: 'Choose Refresh message and greeting to regenerate, or keep your edited text.' });
                }}
                placeholder="Automatic for the selected type"
                options={enabledTemplates.map((t) => ({ value: String(t.id), label: `${t.name} (${TEMPLATE_CATEGORY_LABELS[t.category]})` }))}
              />
            )}
          </Field>
          <Field label="Message type">
            {(id) => (
              <Select
                id={id}
                value={category}
                onChange={(v) => {
                  setCategory(v as WhatsAppTemplateCategory);
                  setTemplateId('');
                  if (!edited) void generate({ templateId: '', category: v as WhatsAppTemplateCategory });
                }}
                options={(Object.keys(TEMPLATE_CATEGORY_LABELS) as WhatsAppTemplateCategory[]).map((key) => ({
                  value: key,
                  label: TEMPLATE_CATEGORY_LABELS[key],
                }))}
              />
            )}
          </Field>
          <Field label="Appointment">
            {(id) => (
              <Select
                id={id}
                value={appointmentId}
                onChange={(v) => {
                  setAppointmentId(v);
                  if (!edited) void generate({ appointmentId: v });
                }}
                placeholder="No appointment selected"
                options={patientAppointments.map((a) => ({
                  value: String(a.id),
                  label: `${formatDate(a.date)} ${a.time} — ${a.type}${a.dentistName ? ` · ${a.dentistName}` : ''}`,
                }))}
              />
            )}
          </Field>
          {category === 'rescheduling' && (
            <Field label="Previous appointment">
              {(id) => (
                <Select
                  id={id}
                  value={previousAppointmentId}
                  onChange={(v) => {
                    setPreviousAppointmentId(v);
                    if (!edited) void generate({ previousAppointmentId: v });
                  }}
                  placeholder="No previous appointment selected"
                  options={patientAppointments.map((a) => ({
                    value: String(a.id),
                    label: `${formatDate(a.date)} ${a.time} — ${a.type}${a.dentistName ? ` · ${a.dentistName}` : ''}`,
                  }))}
                />
              )}
            </Field>
          )}
          {category === 'follow_up_reminder' && (
            <Field label="Follow-up visit">
              {(id) => (
                <Select
                  id={id}
                  value={visitId}
                  onChange={(v) => {
                    setVisitId(v);
                    if (!edited) void generate({ visitId: v });
                  }}
                  placeholder="No follow-up visit selected"
                  options={followUpVisits.map((v) => ({
                    value: String(v.id),
                    label: `Visit ${formatDate(v.datetime)} — follow-up ${v.followUpDate ? formatDate(v.followUpDate) : ''}`,
                  }))}
                />
              )}
            </Field>
          )}
        </div>

        {category === 'custom' && (
          <Field label="Custom message body" hint="Written into the Bengali message where the body placeholder appears.">
            {(id) => <Textarea id={id} rows={3} value={customBody} onChange={setCustomBody} />}
          </Field>
        )}

        {props.documents && props.documents.length > 0 && (
          <div className="col gap-1">
            <span className="small muted">Documents for this message</span>
            {props.documents.map((d) => (
              <span key={d.key} className="small">{d.typeLabel}{d.reference ? ` — ${d.reference}` : ''} ({formatDate(d.date)})</span>
            ))}
            <span className="xsmall muted">The WhatsApp link carries text only. Attach the PDF files manually in WhatsApp.</span>
          </div>
        )}

        <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
          <strong className="small">Message Preview</strong>
          {prepared?.greeting && <Badge tone="info">Greeting for the current time is included</Badge>}
          {edited && <Badge tone="warning">Edited manually</Badge>}
          <Button size="sm" variant="ghost" loading={busy} onClick={requestRegenerate}>Refresh message and greeting</Button>
        </div>
        <Field label="Message text (Bengali) — editable before opening WhatsApp">
          {(id) => (
            <Textarea
              id={id}
              rows={12}
              value={message}
              onChange={(v) => { setMessage(v); setEdited(true); }}
            />
          )}
        </Field>
        {warnings.length > 0 && (
          <div className="col gap-1">
            {warnings.map((w) => <div key={w} className="xsmall" style={{ color: 'var(--warning, #8a6d00)' }}>{w}</div>)}
          </div>
        )}
        <p className="xsmall muted" style={{ margin: 0 }}>
          The greeting is chosen from the current clinic-local time when the message is generated or refreshed — never
          from the appointment time. Opening WhatsApp does not confirm that anything was sent.
        </p>
      </div>
    </Modal>
  );
}

function ShareDocumentsModal(props: {
  patient: PatientDetailDTO;
  documents: PatientDocumentDTO[];
  onClose: () => void;
  onPreview: (doc: PatientDocumentDTO) => void;
  onDone: () => void;
}) {
  const { patient, documents } = props;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [shareFolder, setShareFolder] = useState<string | null>(null);
  const [intro, setIntro] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [prepared, setPrepared] = useState(false);

  const prepareShare = async () => {
    setBusy(true);
    try {
      const result = await api['whatsapp/prepare-documents']({
        patientId: patient.id,
        documents: documents.map((d) => ({ kind: d.kind, documentId: d.documentId })),
      });
      setShareFolder(result.shareFolder);
      setIntro(result.introMessage);
      setWarnings(result.warnings);
      setPrepared(true);
      props.onDone();
    } catch (err) {
      toast.fromError(err, 'Could not prepare the documents');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void prepareShare();
    // Prepare once for the confirmed selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The one link both actions use; never built when the number is unusable. */
  const chatUrl = (): string | null => {
    const digits = (patient.whatsappNumber ?? '').replace(/\D/g, '');
    if (!digits) {
      toast.error('Could not open WhatsApp', 'Add a WhatsApp number for this patient first, then try again.');
      return null;
    }
    try {
      return buildWhatsAppUrl(digits, intro);
    } catch (err) {
      toast.fromError(err, 'Could not open WhatsApp');
      return null;
    }
  };

  const openWhatsApp = async () => {
    const url = chatUrl();
    if (!url) return;
    try {
      await api['whatsapp/open'](url);
      toast.push({ kind: 'info', title: 'WhatsApp opened', message: 'Attach the PDF files manually in WhatsApp, then press Send. Dentiva Pro does not attach files automatically.' });
    } catch (err) {
      toast.fromError(err, 'Could not open WhatsApp');
    }
  };

  // Recovery path when Windows cannot open the link.
  const copyWhatsAppLink = async () => {
    const url = chatUrl();
    if (!url) return;
    try {
      await api['whatsapp/copy-link'](url);
      toast.push({ kind: 'info', title: 'Link copied', message: 'Paste it into your browser or WhatsApp to continue.' });
    } catch (err) {
      toast.fromError(err, 'Could not copy the WhatsApp link');
    }
  };

  return (
    <Modal
      title="Share PDF"
      onClose={props.onClose}
      width="wide"
      footer={<>
        <Button variant="secondary" onClick={props.onClose}>Close</Button>
        <Button variant="ghost" disabled={!prepared} onClick={() => void copyWhatsAppLink()}>Copy link</Button>
        <Button variant="primary" disabled={!prepared} onClick={() => void openWhatsApp()}>Open WhatsApp Chat</Button>
      </>}
    >
      <div className="col gap-3">
        <div className="kv-list">
          <div className="kv"><span className="k">Patient</span><span className="v">{patient.name} ({patient.code})</span></div>
          <div className="kv"><span className="k">WhatsApp Number</span><span className="v mono">{patient.whatsappNumber ? `+${patient.whatsappNumber}` : 'Not recorded'}</span></div>
          <div className="kv"><span className="k">Selected documents</span><span className="v">{documents.length}</span></div>
        </div>

        <div className="col gap-1">
          {documents.map((d) => (
            <div key={d.key} className="row gap-2 wrap" style={{ alignItems: 'center' }}>
              <span className="small flex-1">{d.typeLabel}{d.reference ? ` — ${d.reference}` : ''} ({formatDate(d.date)})</span>
              <span className="xsmall muted mono">{d.suggestedFileName}</span>
              <Button size="sm" variant="secondary" onClick={() => props.onPreview(d)}>Preview / Save PDF</Button>
            </div>
          ))}
        </div>

        <p className="small" style={{ margin: 0 }}>
          Privacy check: confirm this is the correct patient and WhatsApp number before sharing. These documents contain
          private clinical or financial information. Financial values in the PDFs are the real recorded amounts.
        </p>
        <ol className="small" style={{ margin: 0, lineHeight: 1.7 }}>
          <li>For each document, choose Preview / Save PDF and save the PDF (suggested names above).</li>
          <li>Choose Open WhatsApp Chat to open this patient&apos;s conversation with the introduction below.</li>
          <li>In WhatsApp, attach the saved PDF file{documents.length > 1 ? 's' : ''} manually, review, and press Send.</li>
        </ol>
        {shareFolder && (
          <p className="xsmall muted" style={{ margin: 0 }}>
            Share folder prepared by Dentiva Pro: <span className="mono">{shareFolder}</span> — it contains a
            SHARE-MANIFEST.txt listing these documents. Temporary share folders are removed automatically after 24 hours;
            original clinic documents are never deleted.
          </p>
        )}

        <Field label="Message Preview">
          {(id) => <Textarea id={id} rows={9} value={intro} onChange={setIntro} />}
        </Field>
        {warnings.map((w) => <div key={w} className="xsmall" style={{ color: 'var(--warning, #8a6d00)' }}>{w}</div>)}
        {busy && <Spinner label="Preparing documents…" />}
      </div>
    </Modal>
  );
}
