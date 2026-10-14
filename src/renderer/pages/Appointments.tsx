import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, useAsync, useInterval } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ConfirmDialog, Modal, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { isoDate } from '../format';
import type { AppointmentDTO, AppointmentTiming } from '../../shared/types';

/**
 * Appointments: a reminder-only schedule. Booking, rescheduling and deleting an
 * appointment never create a visit, invoice, payment or clinical record.
 * Dates are local calendar dates (YYYY-MM-DD) end to end.
 */

const REASONS = [
  'Consultation', 'Check-up', 'Cleaning', 'Filling', 'Extraction', 'Root canal',
  'Orthodontics', 'Surgery', 'Follow-up', 'Emergency',
];

type View = 'today' | 'next7' | 'next30' | 'upcoming';
const VIEWS: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'next7', label: 'Next 7 days' },
  { id: 'next30', label: 'Next 30 days' },
  { id: 'upcoming', label: 'All upcoming' },
];

const TIMING_TONE: Record<AppointmentTiming, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'> = {
  expired: 'danger', today: 'brand', upcoming: 'info', closed: 'neutral',
};
const TIMING_LABEL: Record<AppointmentTiming, string> = {
  expired: 'Expired', today: 'Today', upcoming: 'Upcoming', closed: 'Closed',
};
const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled',
  no_show: 'No-show', arrived: 'Arrived (legacy)', in_queue: 'In queue (legacy)',
  in_treatment: 'In treatment (legacy)', rescheduled: 'Rescheduled (legacy)',
};

/** "Sat 17 Oct" in the local calendar; "Today" / "Tomorrow" when relevant. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const [y, m, d] = date.split('-').map(Number);
  const local = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split('-').map(Number);
  const tomorrow = new Date(ty, tm - 1, td + 1);
  if (isoDate(tomorrow) === date) return 'Tomorrow';
  return local.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

function todayLocal(): string {
  return isoDate(new Date());
}

/* ------------------------- appointment form --------------------------- */

interface FormValues {
  dentistId: string; date: string; time: string; durationMin: number; type: string; notes: string; plannedTreatments: string;
}

function AppointmentFormModal(props: {
  open: boolean;
  mode: 'create' | 'edit' | 'reschedule';
  initial?: AppointmentDTO | null;
  defaultDate?: string;
  defaultPatientId?: number;
  onClose: () => void;
  canOverride: boolean;
  onSaved: (a: AppointmentDTO) => void;
}) {
  const { data: dentists } = useAsync(() => api['dentists/list'](), []);
  const [values, setValues] = useState<FormValues>({
    dentistId: '', date: todayLocal(), time: '10:00', durationMin: 30, type: 'Consultation', notes: '', plannedTreatments: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [patientQuery, setPatientQuery] = useState('');
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState('');
  const [matches, setMatches] = useState<{ id: number; name: string; code: string; phone: string | null }[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const toast = useToast();
  const editingExisting = !!props.initial;
  const isReschedule = props.mode === 'reschedule';

  useEffect(() => {
    if (!props.open) return;
    setConflict(null);
    setConfirmMove(false);
    setErrors({});
    const init = props.initial;
    setValues({
      dentistId: init?.dentistId ? String(init.dentistId) : '',
      date: init?.date ?? props.defaultDate ?? todayLocal(),
      time: init?.time ?? '10:00',
      durationMin: init?.durationMin ?? 30,
      type: init?.type || 'Consultation',
      notes: init?.notes ?? '',
      plannedTreatments: init?.plannedTreatments ?? '',
    });
    setPatientId(init?.patientId ?? props.defaultPatientId ?? null);
    setPatientName(init?.patientName ?? '');
    setPatientQuery(init ? `${init.patientName} · ${init.patientCode}` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial?.id, props.defaultDate, props.defaultPatientId]);

  useEffect(() => {
    if (!props.open || editingExisting || patientId || patientQuery.trim().length < 2) { setMatches([]); return; }
    const t = setTimeout(() => {
      api['patients/list']({ query: patientQuery, pageSize: 8, status: 'active' })
        .then((res) => setMatches(res.items.map((p) => ({ id: p.id, name: p.name, code: p.code, phone: p.phone }))))
        .catch(() => setMatches([]));
    }, 220);
    return () => clearTimeout(t);
  }, [patientQuery, patientId, props.open, editingExisting]);

  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const movesSchedule = !!props.initial && (values.date !== props.initial.date || values.time !== props.initial.time);

  const buildPayload = (allowConflict: boolean) => ({
    patientId: patientId as number,
    dentistId: values.dentistId ? Number(values.dentistId) : null,
    date: values.date,
    time: values.time,
    durationMin: Number(values.durationMin),
    type: values.type,
    notes: values.notes.trim() || null,
    plannedTreatments: values.plannedTreatments.trim() || null,
    ...(allowConflict ? { allowConflict: true } : {}),
  });

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    if (!values.date) errs.date = 'Choose a date.';
    else if (!editingExisting && values.date < todayLocal()) errs.date = 'Choose today or a later date.';
    if (!values.time) errs.time = 'Choose a time.';
    if (!(values.durationMin >= 5 && values.durationMin <= 480)) errs.durationMin = 'Duration must be 5–480 minutes.';
    setErrors(errs);
    if (!patientId) toast.warning('Select a patient', 'Search and choose the patient this appointment is for.');
    return Object.keys(errs).length === 0 && !!patientId;
  };

  const save = async (allowConflict: boolean) => {
    setPending(true);
    setConflict(null);
    try {
      const payload = buildPayload(allowConflict);
      const saved = props.initial
        ? await api['appointments/update']({
            id: props.initial.id, ...payload, confirmReschedule: movesSchedule ? true : undefined,
          })
        : await api['appointments/create'](payload);
      if (props.mode === 'reschedule' || movesSchedule) {
        toast.success('Appointment rescheduled', `Now ${dayLabel(saved.date, todayLocal())} ${saved.time}. Reminders updated.`);
      } else {
        toast.success(props.initial ? 'Appointment updated' : 'Appointment booked', `${dayLabel(saved.date, todayLocal())} ${saved.time}`);
      }
      props.onSaved(saved);
      props.onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      if (/conflict|overlap|already booked|double/i.test(msg) && !allowConflict) setConflict(msg);
      else toast.fromError(err, 'Save failed');
    } finally {
      setPending(false);
      setConfirmMove(false);
    }
  };

  const submit = () => {
    if (!validateForm()) return;
    if (movesSchedule) { setConfirmMove(true); return; }
    void save(false);
  };

  if (!props.open) return null;

  const title = props.mode === 'create' ? 'New appointment' : isReschedule ? 'Reschedule appointment' : 'Edit appointment';

  return (
    <>
      <Modal
        title={title}
        onClose={props.onClose}
        width="wide"
        footer={
          <>
            <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>
              {props.mode === 'create' ? 'Book appointment' : isReschedule ? 'Save new time' : 'Save changes'}
            </Button>
          </>
        }
      >
        {props.initial && (
          <div className="small muted mb-4">
            Currently {dayLabel(props.initial.date, todayLocal())} at {props.initial.time}
            {props.initial.timing === 'expired' && ' · this appointment has expired — saving a current or future date reactivates it.'}
          </div>
        )}
        {conflict && (
          <div className="alert alert-warning mb-4" role="alert">
            <div className="col" style={{ width: '100%', gap: 8 }}>
              <strong>Scheduling conflict</strong>
              <span className="small">{conflict}</span>
              {props.canOverride && (
                <div className="row gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setConflict(null)}>Change time instead</Button>
                  <Button size="sm" variant="danger" loading={pending} onClick={() => void save(true)}>Book anyway (override)</Button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="form-grid">
          <Field label="Patient" required className="span-2" error={errors.patient}>
            {() => (
              <div className="col" style={{ gap: 6 }}>
                <Input
                  value={patientQuery}
                  onChange={(v) => { setPatientQuery(v); setPatientId(null); setPatientName(''); }}
                  placeholder="Search by name, phone or patient ID…"
                  disabled={editingExisting}
                  aria-label="Search patient"
                />
                {matches.length > 0 && !patientId && (
                  <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 6, maxHeight: 160, overflowY: 'auto' }}>
                    {matches.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="list-row clickable"
                        style={{ padding: '8px 10px', width: '100%', textAlign: 'left' }}
                        onClick={() => { setPatientId(m.id); setPatientName(m.name); setPatientQuery(`${m.name} · ${m.code}`); }}
                      >
                        <span className="flex-1"><strong>{m.name}</strong> <span className="xsmall muted mono">{m.code}</span></span>
                        <span className="xsmall muted mono">{m.phone ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                {patientId && <div className="xsmall success-text">Selected: {patientName || `patient #${patientId}`}</div>}
              </div>
            )}
          </Field>
          <Field label="Reason for visit" required>
            {(id) => (
              <Select id={id} value={values.type} onChange={(v) => set('type', v)} options={REASONS.map((r) => ({ value: r, label: r }))} />
            )}
          </Field>
          <Field label="Dentist">
            {(id) => (
              <Select
                id={id}
                value={values.dentistId}
                onChange={(v) => set('dentistId', v)}
                placeholder="Any dentist"
                options={(dentists ?? []).filter((d) => d.active).map((d) => ({ value: String(d.id), label: d.name }))}
              />
            )}
          </Field>
          <Field label="Date" required error={errors.date}>
            {(id) => <Input id={id} type="date" value={values.date} onChange={(v) => set('date', v)} invalid={!!errors.date} />}
          </Field>
          <Field label="Time" required error={errors.time}>
            {(id) => <Input id={id} type="time" value={values.time} onChange={(v) => set('time', v)} invalid={!!errors.time} />}
          </Field>
          <Field label="Duration (minutes, optional)" error={errors.durationMin}>
            {(id) => (
              <Input id={id} type="number" min={5} max={480} step={5} value={String(values.durationMin)}
                onChange={(v) => set('durationMin', Number(v) || 0)} invalid={!!errors.durationMin} />
            )}
          </Field>
          <Field label="Planned treatments or tasks" className="span-2" hint="For the front desk to prepare. Not a treatment record.">
            {(id) => <Textarea id={id} rows={2} value={values.plannedTreatments} onChange={(v) => set('plannedTreatments', v)} />}
          </Field>
          <Field label="Preparation notes" className="span-2">
            {(id) => <Textarea id={id} rows={2} value={values.notes} onChange={(v) => set('notes', v)} />}
          </Field>
        </div>
      </Modal>

      {confirmMove && props.initial && (
        <ConfirmDialog
          title="Move this appointment?"
          body={`${props.initial.patientName} moves from ${dayLabel(props.initial.date, todayLocal())} ${props.initial.time} to ${dayLabel(values.date, todayLocal())} ${values.time}. Reminders will follow the new time.`}
          confirmLabel="Confirm move"
          onConfirm={() => void save(false)}
          onCancel={() => setConfirmMove(false)}
        />
      )}
    </>
  );
}

/* ------------------------------ page ---------------------------------- */

export function AppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useApp();
  const toast = useToast();
  const [view, setView] = useState<View>((params.get('view') as View) || 'next7');
  const [dentistId, setDentistId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [formMode, setFormMode] = useState<'create' | 'edit' | 'reschedule' | null>(params.get('new') === '1' ? 'create' : null);
  const [editing, setEditing] = useState<AppointmentDTO | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppointmentDTO | null>(null);
  const [selected, setSelected] = useState<AppointmentDTO | null>(null);
  const [highlightId] = useState<number | null>(Number(params.get('appointment')) || null);

  const { data: dentists } = useAsync(() => api['dentists/list'](), []);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filter = useMemo(
    () => ({
      view,
      dentistId: dentistId ? Number(dentistId) : undefined,
      status: statusFilter || undefined,
      reason: reasonFilter || undefined,
      search: search || undefined,
    }),
    [view, dentistId, statusFilter, reasonFilter, search],
  );
  const { data, loading, error, reload } = useAsync(() => api['appointments/agenda'](filter), [JSON.stringify(filter)]);

  // Keep the URL in step with the view so links and back navigation are predictable.
  useEffect(() => {
    const next = new URLSearchParams(params);
    next.set('view', view);
    next.delete('new');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useInterval(() => reload(), 60_000);

  const today = todayLocal();
  const statusAction = async (a: AppointmentDTO, action: 'complete' | 'noshow' | 'confirm') => {
    try {
      if (action === 'noshow') await api['appointments/no-show'](a.id);
      else if (action === 'confirm') await api['appointments/update']({ id: a.id, status: 'confirmed' });
      else await api['appointments/update']({ id: a.id, status: 'completed' });
      toast.success(`Appointment ${action === 'complete' ? 'completed' : action === 'noshow' ? 'marked no-show' : 'confirmed'}`);
      reload();
    } catch (err) {
      toast.fromError(err, 'Update failed');
    }
  };

  const columns: Column<AppointmentDTO>[] = [
    {
      key: 'when', label: 'Date & time', sortValue: (r) => `${r.date} ${r.time}`,
      render: (r) => (
        <div>
          <strong className="num">{dayLabel(r.date, today)}</strong>
          <div className="xsmall muted num">{r.time}{r.durationMin ? ` · ${r.durationMin} min` : ''}</div>
        </div>
      ),
    },
    {
      key: 'patient', label: 'Patient', sortValue: (r) => r.patientName,
      render: (r) => (
        <button
          type="button"
          className="link-button"
          onClick={(e) => { e.stopPropagation(); navigate(`/patients/${r.patientId}`); }}
          aria-label={`Open profile of ${r.patientName} (${r.patientCode})`}
          title="Open patient profile"
        >
          <strong>{r.patientName}</strong>
          <div className="xsmall muted mono">{r.patientCode}{r.phone ? ` · ${r.phone}` : ''}</div>
        </button>
      ),
    },
    { key: 'reason', label: 'Reason', render: (r) => r.type || 'Consultation' },
    { key: 'dentist', label: 'Dentist', render: (r) => r.dentistName ?? <span className="muted">Any</span> },
    {
      key: 'planned', label: 'Planned',
      render: (r) => (r.plannedTreatments ? <span className="xsmall" title={r.plannedTreatments}>{r.plannedTreatments.length > 60 ? `${r.plannedTreatments.slice(0, 60)}…` : r.plannedTreatments}</span> : <span className="muted">—</span>),
    },
    {
      key: 'timing', label: 'Status',
      render: (r) => (
        <div className="col" style={{ gap: 4 }}>
          <Badge tone={TIMING_TONE[r.timing]}>{TIMING_LABEL[r.timing]}</Badge>
          <span className="xsmall muted">{STATUS_LABEL[r.status] ?? r.status}</span>
        </div>
      ),
    },
    {
      key: 'actions', label: 'Actions', align: 'right',
      render: (r) => (
        <div className="row gap-2 end" onClick={(e) => e.stopPropagation()}>
          {can('appointments.manage') && (r.status === 'scheduled' || r.status === 'confirmed') && r.timing !== 'expired' && (
            <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setFormMode('reschedule'); }}>Reschedule</Button>
          )}
          {can('appointments.manage') && (r.status === 'scheduled' || r.status === 'confirmed' || r.timing === 'expired') && (
            <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setFormMode('edit'); }}>Edit</Button>
          )}
          {can('appointments.manage') && (r.status === 'scheduled' || r.status === 'confirmed') && r.timing !== 'expired' && (
            <Button size="sm" variant="ghost" onClick={() => void statusAction(r, 'confirm')}>Confirm</Button>
          )}
          {can('appointments.manage') && (r.status === 'scheduled' || r.status === 'confirmed') && (
            <Button size="sm" variant="ghost" onClick={() => void statusAction(r, 'noshow')}>No-show</Button>
          )}
          {can('appointments.manage') && (r.status === 'scheduled' || r.status === 'confirmed') && (
            <Button size="sm" variant="ghost" onClick={() => setCancelTarget(r)}>Cancel</Button>
          )}
          {can('appointments.manage') && (
            <Button size="sm" variant="danger" onClick={() => setDeleteTarget(r)}>Delete</Button>
          )}
        </div>
      ),
    },
  ];

  const rows = data ?? [];
  const expiredCount = rows.filter((r) => r.timing === 'expired').length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Appointments</h1>
          <p className="page-subtitle">
            {loading ? 'Loading schedule…' : `${rows.length} ${rows.length === 1 ? 'appointment' : 'appointments'} in this view`}
            {expiredCount > 0 && ` · ${expiredCount} expired`}
            {' · reminders only — visits and billing are recorded separately'}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={reload}>Refresh</Button>
          {can('appointments.manage') && (
            <Button variant="primary" icon={Icon.plus} onClick={() => { setEditing(null); setFormMode('create'); }}>New appointment</Button>
          )}
        </div>
      </div>

      <Card>
        <div className="seg mb-4" role="tablist" aria-label="Appointment range">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? 'active' : ''}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <TableToolbar>
          <input
            className="input"
            style={{ width: 260 }}
            type="search"
            placeholder="Search patient name or ID…"
            aria-label="Search appointments by patient"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select value={dentistId} onChange={setDentistId} ariaLabel="Filter by dentist"
          placeholder="All dentists"
            options={(dentists ?? []).map((d) => ({ value: String(d.id), label: d.name }))} />
          <Select value={reasonFilter} onChange={setReasonFilter} ariaLabel="Filter by reason"
          placeholder="Any reason"
            options={REASONS.map((r) => ({ value: r, label: r }))} />
          <Select value={statusFilter} onChange={setStatusFilter} ariaLabel="Filter by status"
          placeholder="Open & upcoming"
            options={[
              { value: 'scheduled', label: 'Scheduled' }, { value: 'confirmed', label: 'Confirmed' },
              { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' },
              { value: 'no_show', label: 'No-show' },
            ]} />
        </TableToolbar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={reload}
          onRowClick={(r) => setSelected(r)}
          rowClass={(r) => (r.id === highlightId ? 'row-highlight' : r.timing === 'expired' ? 'row-expired' : '')}
          empty={{
            title: search ? 'No appointments match this search' : 'No appointments in this view',
            body: search ? 'Check the spelling or clear the search.' : 'Book an appointment, or choose another range.',
            action: can('appointments.manage') ? <Button variant="primary" onClick={() => setFormMode('create')}>New appointment</Button> : undefined,
          }}
          initialSort={{ key: 'when', dir: 'asc' }}
        />
      </Card>

      <AppointmentFormModal
        open={formMode !== null}
        mode={formMode ?? 'create'}
        initial={formMode === 'create' ? null : editing}
        defaultPatientId={Number(params.get('patient')) || undefined}
        canOverride={can('appointments.override')}
        onClose={() => {
          setFormMode(null);
          setEditing(null);
          if (params.get('patient')) { params.delete('patient'); setParams(params, { replace: true }); }
        }}
        onSaved={() => reload()}
      />

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this appointment?"
          body={`${deleteTarget.patientName} · ${dayLabel(deleteTarget.date, today)} ${deleteTarget.time}. Its reminders will be removed. The patient record, visits and invoices are not affected.`}
          confirmLabel="Delete appointment"
          danger
          onConfirm={async () => {
            try {
              await api['appointments/delete'](deleteTarget.id);
              toast.success('Appointment deleted', 'Reminders were removed.');
              setDeleteTarget(null);
              reload();
            } catch (err) {
              toast.fromError(err, 'Delete failed');
            }
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="Cancel this appointment?"
          body={`${cancelTarget.patientName} · ${dayLabel(cancelTarget.date, today)} ${cancelTarget.time}. It stays in the record as cancelled.`}
          confirmLabel="Cancel appointment"
          danger
          onConfirm={async () => {
            try {
              await api['appointments/cancel']({ id: cancelTarget.id, reason: 'Cancelled from schedule' });
              toast.success('Appointment cancelled', 'Reminders were removed.');
              setCancelTarget(null);
              reload();
            } catch (err) {
              toast.fromError(err, 'Cancel failed');
            }
          }}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {selected && (
        <Modal title={`Appointment #${selected.id}`} onClose={() => setSelected(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
              <Button variant="ghost" onClick={() => { setSelected(null); navigate(`/patients/${selected.patientId}`); }}>Open patient profile</Button>
              {can('appointments.manage') && (
                <Button variant="primary" onClick={() => { setEditing(selected); setFormMode('reschedule'); setSelected(null); }}>Reschedule</Button>
              )}
            </>
          }>
          <div className="kv-list">
            <div className="kv"><span className="k">Patient</span><span className="v">{selected.patientName} ({selected.patientCode})</span></div>
            <div className="kv"><span className="k">When</span><span className="v">{dayLabel(selected.date, today)} · {selected.time}{selected.durationMin ? ` · ${selected.durationMin} min` : ''}</span></div>
            <div className="kv"><span className="k">Reason</span><span className="v">{selected.type}</span></div>
            <div className="kv"><span className="k">Dentist</span><span className="v">{selected.dentistName ?? 'Any'}</span></div>
            <div className="kv"><span className="k">Timing</span><span className="v">{TIMING_LABEL[selected.timing]}{selected.expiredAt ? ` (expired ${selected.expiredAt.slice(0, 10)})` : ''}</span></div>
            <div className="kv"><span className="k">Status</span><span className="v">{STATUS_LABEL[selected.status] ?? selected.status}</span></div>
            <div className="kv"><span className="k">Planned</span><span className="v">{selected.plannedTreatments ?? '—'}</span></div>
            <div className="kv"><span className="k">Preparation notes</span><span className="v">{selected.notes ?? '—'}</span></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
