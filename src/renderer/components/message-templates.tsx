import { useEffect, useMemo, useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Spinner, useToast } from './primitives';
import { Field, Input, Select, Textarea } from './forms';
import {
  DEFAULT_GREETING_RANGES,
  GREETING_OPTIONS,
  MAX_WHATSAPP_MESSAGE_LENGTH,
  placeholdersIn,
  placeholderLabel,
  TEMPLATE_CATEGORY_LABELS,
  unknownPlaceholdersIn,
  WHATSAPP_PLACEHOLDERS,
  type GreetingRange,
  type WhatsAppTemplateCategory,
} from '../../shared/whatsapp';
import type { WhatsAppTemplateDTO } from '../../shared/types';

/**
 * Message Templates manager (Settings). All controls are English; Bengali
 * appears only inside the editable message bodies and their preview, which
 * is the actual patient-facing content. Templates are stored locally in the
 * clinic database — no external template, AI or translation service.
 */
export function MessageTemplatesPanel() {
  const toast = useToast();
  const { refreshSettings } = useApp();
  const templatesState = useAsync(() => api['whatsapp/templates/list'](), []);
  const templates = useMemo(() => templatesState.data ?? [], [templatesState.data]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<WhatsAppTemplateCategory>('custom');
  const [body, setBody] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  // Greeting configuration
  const [timezone, setTimezone] = useState('');
  const [ranges, setRanges] = useState<GreetingRange[]>(DEFAULT_GREETING_RANGES);
  const [greetingDirty, setGreetingDirty] = useState(false);

  // Preview
  const [previewPatientId, setPreviewPatientId] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const patientsState = useAsync(() => api['patients/list']({ page: 1, pageSize: 100, range: 'all' }), []);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await api['settings/get']();
        if ('whatsapp' in settings && settings.whatsapp) {
          setTimezone(settings.whatsapp.timezone ?? '');
          setRanges(settings.whatsapp.greetingRanges?.length ? settings.whatsapp.greetingRanges : DEFAULT_GREETING_RANGES);
        }
      } catch { /* defaults stay in place; saving reports any real error */ }
    })();
  }, []);

  const selectTemplate = (tpl: WhatsAppTemplateDTO) => {
    setSelectedId(tpl.id);
    setName(tpl.name);
    setCategory(tpl.category);
    setBody(tpl.body);
    setEnabled(tpl.enabled);
    setIsDefault(tpl.isDefault);
    setPreviewText('');
    setPreviewWarnings([]);
  };

  useEffect(() => {
    if (selectedId === null && templates.length > 0) selectTemplate(templates[0]);
    // Select the first template once the list arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length]);

  const unknown = useMemo(() => unknownPlaceholdersIn(body), [body]);
  const used = useMemo(() => placeholdersIn(body), [body]);

  const reloadKeeping = async (keepId?: number) => {
    await templatesState.reload();
    if (keepId) {
      const fresh = await api['whatsapp/templates/list']();
      const tpl = fresh.find((t) => t.id === keepId);
      if (tpl) selectTemplate(tpl);
    }
  };

  const save = async () => {
    if (unknown.length > 0) {
      toast.error('Unknown placeholders', `Remove or correct: ${unknown.map((k) => `{{${k}}}`).join(', ')}`);
      return;
    }
    setPending(true);
    try {
      const saved = await api['whatsapp/templates/save']({
        ...(selectedId ? { id: selectedId } : {}),
        name, category, body, enabled,
      });
      toast.success('Template saved', saved.name);
      await reloadKeeping(saved.id);
    } catch (err) {
      toast.fromError(err, 'Could not save template');
    } finally {
      setPending(false);
    }
  };

  const startNew = () => {
    setSelectedId(null);
    setName('');
    setCategory('custom');
    setBody('');
    setEnabled(true);
    setIsDefault(false);
    setPreviewText('');
    setPreviewWarnings([]);
  };

  const duplicate = async () => {
    if (!selectedId) return;
    setPending(true);
    try {
      const copy = await api['whatsapp/templates/duplicate'](selectedId);
      toast.success('Template duplicated', copy.name);
      await reloadKeeping(copy.id);
    } catch (err) {
      toast.fromError(err, 'Could not duplicate template');
    } finally {
      setPending(false);
    }
  };

  const toggleEnabled = async () => {
    if (!selectedId) return;
    try {
      const updated = await api['whatsapp/templates/set-enabled']({ id: selectedId, enabled: !enabled });
      setEnabled(updated.enabled);
      toast.success(updated.enabled ? 'Template enabled' : 'Template disabled', updated.name);
      await templatesState.reload();
    } catch (err) {
      toast.fromError(err, 'Could not update template');
    }
  };

  const doRestore = async () => {
    if (!selectedId) return;
    setPending(true);
    try {
      const restored = await api['whatsapp/templates/restore'](selectedId);
      toast.success('Default template restored', restored.name);
      setRestoreOpen(false);
      await reloadKeeping(restored.id);
    } catch (err) {
      toast.fromError(err, 'Could not restore template');
    } finally {
      setPending(false);
    }
  };

  const doDelete = async () => {
    if (!selectedId) return;
    setPending(true);
    try {
      await api['whatsapp/templates/delete'](selectedId);
      toast.success('Template deleted');
      setDeleteOpen(false);
      setSelectedId(null);
      await templatesState.reload();
    } catch (err) {
      toast.fromError(err, 'Could not delete template');
    } finally {
      setPending(false);
    }
  };

  const preview = async () => {
    if (!previewPatientId) {
      toast.warning('Select a patient', 'Choose a patient to preview the final message with real data.');
      return;
    }
    if (!selectedId) {
      toast.warning('Save the template first', 'Preview uses the saved template so the preview matches what will be sent.');
      return;
    }
    try {
      const result = await api['whatsapp/prepare']({
        patientId: Number(previewPatientId),
        templateId: selectedId,
        dryRun: true,
      });
      setPreviewText(result.message);
      setPreviewWarnings(result.warnings);
    } catch (err) {
      toast.fromError(err, 'Could not preview the message');
    }
  };

  const saveGreetings = async () => {
    setPending(true);
    try {
      await api['settings/save']({ whatsapp: { timezone: timezone.trim() ? timezone.trim() : null, greetingRanges: ranges } } as any);
      await refreshSettings();
      setGreetingDirty(false);
      toast.success('Greeting settings saved', 'The greeting is chosen from the current clinic-local time when a message is prepared.');
    } catch (err) {
      toast.fromError(err, 'Could not save greeting settings');
    } finally {
      setPending(false);
    }
  };

  const setRange = (index: number, patch: Partial<GreetingRange>) => {
    setRanges((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setGreetingDirty(true);
  };

  return (
    <div className="col gap-4">
      <Card title="Message Templates" actions={<Button size="sm" variant="primary" onClick={startNew}>Create template</Button>}>
        {templatesState.loading && templates.length === 0 && <Spinner label="Loading templates…" />}
        {templates.length === 0 && !templatesState.loading && (
          <EmptyState title="No templates found" body="Default templates are created automatically. Create a custom template to get started." />
        )}
        {templates.length > 0 && (
          <div className="col gap-3">
            <Field label="Template">
              {(id) => (
                <Select
                  id={id}
                  value={selectedId ? String(selectedId) : ''}
                  onChange={(v) => {
                    const tpl = templates.find((t) => String(t.id) === v);
                    if (tpl) selectTemplate(tpl);
                  }}
                  placeholder="Select a template"
                  options={templates.map((t) => ({
                    value: String(t.id),
                    label: `${t.name} — ${TEMPLATE_CATEGORY_LABELS[t.category]}${t.isDefault ? ' (default)' : ''}${t.enabled ? '' : ' (disabled)'}`,
                  }))}
                />
              )}
            </Field>
            <div className="row gap-2 wrap">
              {isDefault && <Badge tone="brand">Default template</Badge>}
              <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
              {selectedId && <Button size="sm" variant="ghost" onClick={() => void toggleEnabled()}>{enabled ? 'Disable template' : 'Enable template'}</Button>}
              {selectedId && <Button size="sm" variant="ghost" onClick={() => void duplicate()}>Duplicate template</Button>}
              {selectedId && isDefault && <Button size="sm" variant="ghost" onClick={() => setRestoreOpen(true)}>Restore default template</Button>}
              {selectedId && !isDefault && <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>Delete template</Button>}
            </div>
            <div className="form-grid">
              <Field label="Template name" required>
                {(id) => <Input id={id} value={name} onChange={setName} placeholder="Template name" />}
              </Field>
              <Field label="Template category">
                {(id) => (
                  <Select
                    id={id}
                    value={category}
                    onChange={(v) => setCategory(v as WhatsAppTemplateCategory)}
                    options={(Object.keys(TEMPLATE_CATEGORY_LABELS) as WhatsAppTemplateCategory[]).map((key) => ({
                      value: key,
                      label: TEMPLATE_CATEGORY_LABELS[key],
                    }))}
                  />
                )}
              </Field>
            </div>
            <Field label="Message content (Bengali)" hint="This is the patient-facing message text. Placeholders are filled with real patient, clinic, appointment and document data.">
              {(id) => <Textarea id={id} rows={12} value={body} maxLength={MAX_WHATSAPP_MESSAGE_LENGTH} onChange={setBody} />}
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>Template enabled</span>
            </label>
            {unknown.length > 0 && (
              <div className="small" style={{ color: 'var(--danger)' }}>
                Unknown placeholders: {unknown.map((k) => `{{${k}}}`).join(', ')} — these cannot be filled and must be corrected before saving.
              </div>
            )}
            {used.length > 0 && (
              <div className="xsmall muted">
                Placeholders in this template: {used.map((k) => `${placeholderLabel(k)} {{${k}}}`).join(' · ')}
              </div>
            )}
            <div className="row gap-2">
              <Button variant="primary" loading={pending} onClick={() => void save()}>{selectedId ? 'Save template' : 'Create template'}</Button>
            </div>
            <div className="divider" />
            <h4 className="small">Available placeholders</h4>
            <div className="col gap-1">
              {WHATSAPP_PLACEHOLDERS.map((p) => (
                <div key={p.key} className="xsmall">
                  <span className="mono">{`{{${p.key}}}`}</span> — {p.label}{p.required ? ' (required)' : ''}
                </div>
              ))}
            </div>
            <div className="divider" />
            <h4 className="small">Preview with a patient</h4>
            <div className="form-grid">
              <Field label="Preview patient">
                {(id) => (
                  <Select
                    id={id}
                    value={previewPatientId}
                    onChange={setPreviewPatientId}
                    placeholder="Select a patient"
                    options={(patientsState.data?.items ?? []).map((p) => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
                  />
                )}
              </Field>
              <Field label="Preview">
                {() => <Button variant="secondary" onClick={() => void preview()}>Preview message</Button>}
              </Field>
            </div>
            {previewWarnings.map((w) => <div key={w} className="xsmall" style={{ color: 'var(--warning, #8a6d00)' }}>{w}</div>)}
            {previewText && (
              <Field label="Message Preview">
                {(id) => <Textarea id={id} rows={10} value={previewText} onChange={() => undefined} />}
              </Field>
            )}
          </div>
        )}
      </Card>

      <Card title="Time-based greeting" actions={greetingDirty ? <Badge tone="warning">unsaved changes</Badge> : undefined}>
        <p className="xsmall muted" style={{ marginTop: 0 }}>
          The greeting at the start of every patient message is selected from the clinic-local time at the moment the
          message is prepared — never from the appointment time. Times use the clinic time zone below, or this
          computer&apos;s time zone when it is empty. Ranges may wrap past midnight.
        </p>
        <div className="col gap-3">
          <Field label="Clinic time zone" hint="IANA name such as Asia/Dhaka. Leave empty to use this computer's time zone.">
            {(id) => <Input id={id} value={timezone} onChange={(v) => { setTimezone(v); setGreetingDirty(true); }} placeholder="Asia/Dhaka" />}
          </Field>
          {ranges.map((range, i) => (
            <div key={i} className="form-grid">
              <Field label={`Range ${i + 1} start`}>
                {(id) => <Input id={id} type="time" value={range.start} onChange={(v) => setRange(i, { start: v })} />}
              </Field>
              <Field label={`Range ${i + 1} end`}>
                {(id) => <Input id={id} type="time" value={range.end} onChange={(v) => setRange(i, { end: v })} />}
              </Field>
              <Field label={`Range ${i + 1} greeting`}>
                {(id) => (
                  <Select
                    id={id}
                    value={range.greeting}
                    onChange={(v) => setRange(i, { greeting: v })}
                    options={GREETING_OPTIONS.map((g) => ({ value: g, label: g }))}
                  />
                )}
              </Field>
            </div>
          ))}
          <div className="row gap-2">
            <Button
              variant="secondary"
              onClick={() => setRanges((prev) => [...prev, { start: '00:00', end: '00:00', greeting: GREETING_OPTIONS[0] }])}
              disabled={ranges.length >= 8}
            >
              Add greeting range
            </Button>
            <Button
              variant="ghost"
              onClick={() => setRanges((prev) => prev.slice(0, -1))}
              disabled={ranges.length <= 1}
            >
              Remove last range
            </Button>
            <Button variant="primary" loading={pending} onClick={() => void saveGreetings()}>Save greeting settings</Button>
          </div>
        </div>
      </Card>

      {deleteOpen && (
        <ConfirmDialog
          title="Delete template?"
          body={`The custom template "${name}" will be permanently deleted. Default templates are never deleted.`}
          confirmLabel="Delete template"
          danger
          pending={pending}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => void doDelete()}
        />
      )}
      {restoreOpen && (
        <ConfirmDialog
          title="Restore default template?"
          body={`"${name}" will be reset to its original default message. Your edits to this template will be lost. Custom templates are not affected.`}
          confirmLabel="Restore default"
          pending={pending}
          onCancel={() => setRestoreOpen(false)}
          onConfirm={() => void doRestore()}
        />
      )}
    </div>
  );
}
