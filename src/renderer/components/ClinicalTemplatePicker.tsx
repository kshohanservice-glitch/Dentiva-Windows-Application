import { useId, useRef, useState } from 'react';
import { api, useAsync } from '../api';
import { Button, ConfirmDialog, useToast } from './primitives';
import { Input, Select } from './forms';
import type { ClinicalTemplateBody, ClinicalTemplateKind } from '../../shared/clinical-templates';

/** Reusable authoring control. Applying a template only fills the draft: it never saves a patient record. */
export function ClinicalTemplatePicker(props: {
  kind: ClinicalTemplateKind; label: string;
  getBody: () => ClinicalTemplateBody;
  onApply: (body: ClinicalTemplateBody) => void;
}) {
  const { data, reload, loading } = useAsync(() => api['clinical-templates/list'](props.kind), [props.kind]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [confirm, setConfirm] = useState<'delete' | 'replace' | null>(null);
  const id = useId();
  const toast = useToast();
  const item = data?.find((t) => String(t.id) === selected);

  const save = async () => {
    if (!name.trim()) { toast.warning('Enter a template name'); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const result = await api['clinical-templates/save']({ kind: props.kind, name: name.trim(), body: props.getBody() });
      toast.success('Template saved', result.name);
      setSelected(String(result.id));
      reload();
    } catch (error) { toast.fromError(error, 'Template could not be saved'); }
    finally { inFlight.current = false; setPending(false); setConfirm(null); }
  };
  const remove = async () => {
    if (!item || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await api['clinical-templates/delete'](item.id);
      toast.success('Template deleted', item.name);
      setName(''); setSelected(''); reload();
    } catch (error) { toast.fromError(error, 'Template could not be deleted'); }
    finally { inFlight.current = false; setPending(false); setConfirm(null); }
  };

  return (
    <div className="form-section mt-4">
      <label htmlFor={id} className="strong small">{props.label} templates</label>
      <div className="row gap-2 wrap mt-2">
        <Select id={id} value={selected} onChange={(value) => {
          setSelected(value);
          setName(data?.find((t) => String(t.id) === value)?.name ?? '');
        }} placeholder={loading ? 'Loading templates…' : 'Select a template…'}
          options={(data ?? []).map((t) => ({ value: String(t.id), label: t.name }))} />
        <Button size="sm" variant="secondary" disabled={!item || pending} onClick={() => {
          if (!item) return;
          props.onApply(item.body);
          toast.success('Template applied', item.name);
        }}>Apply to draft</Button>
        <Button size="sm" variant="ghost" disabled={!item || pending} onClick={() => setConfirm('delete')}>Delete</Button>
      </div>
      <div className="row gap-2 wrap mt-2">
        <Input value={name} onChange={setName} placeholder="New template name" />
        <Button size="sm" loading={pending} onClick={() => {
          if (!name.trim()) { toast.warning('Enter a template name'); return; }
          if (data?.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) setConfirm('replace');
          else void save();
        }}>Save current draft</Button>
      </div>
      <div className="xsmall muted mt-2">Templates are shared with staff who can create this kind of record. Do not save patient-specific details.</div>
      {confirm && <ConfirmDialog
        title={confirm === 'delete' ? 'Delete template?' : 'Replace saved template?'}
        body={confirm === 'delete' ? `Delete “${item?.name}”? Existing clinical records remain unchanged.` : `Replace the saved “${name}” template with the current draft? Existing records remain unchanged.`}
        confirmLabel={confirm === 'delete' ? 'Delete template' : 'Replace template'}
        danger={confirm === 'delete'} pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void (confirm === 'delete' ? remove() : save())}
      />}
    </div>
  );
}
