import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Button, Card, Modal, Pagination, Tabs, useToast } from '../components/primitives';
import { Input } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { RxFormModal } from './Patients';
import type { PrescriptionDTO } from '../../shared/types';

type RxTab = 'all' | 'today' | 'week' | 'month';

const RANGE: Record<RxTab, string | undefined> = {
  all: undefined, today: 'today', week: '7', month: '30',
};

function RxDetailModal(props: { rx: PrescriptionDTO; onClose: () => void }) {
  const { rx } = props;
  const toast = useToast();
  const print = async (kind: 'prescription' | 'prescription-duplicate') => {
    try {
      await api['reports/print']({ type: kind, id: rx.id } as any);
    } catch (err) {
      toast.fromError(err, 'Could not open print preview');
    }
  };
  return (
    <Modal
      title={`Prescription ${rx.number}`}
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Close</Button>
          <Button variant="secondary" onClick={() => void print('prescription-duplicate')}>Print duplicate (watermarked)</Button>
          <Button variant="primary" icon={Icon.print} onClick={() => void print('prescription')}>Print</Button>
        </>
      }
    >
      <div className="kv-list mb-4">
        <div className="kv"><span className="k">Patient</span><span className="v">{rx.patientName} ({rx.patientCode})</span></div>
        <div className="kv"><span className="k">Date</span><span className="v">{new Date(rx.date).toLocaleDateString()}</span></div>
        <div className="kv"><span className="k">Dentist</span><span className="v">{rx.dentistName}</span></div>
        {rx.diagnosis && <div className="kv"><span className="k">Diagnosis</span><span className="v">{rx.diagnosis}</span></div>}
        {rx.cC && <div className="kv"><span className="k">C/C</span><span className="v">{rx.cC}</span></div>}
        {rx.oE && <div className="kv"><span className="k">O/E</span><span className="v">{rx.oE}</span></div>}
        {rx.rE && <div className="kv"><span className="k">R/E</span><span className="v">{rx.rE}</span></div>}
        {rx.treatment && <div className="kv"><span className="k">Treatment</span><span className="v">{rx.treatment}</span></div>}
        {rx.advice && <div className="kv"><span className="k">Advice</span><span className="v">{rx.advice}</span></div>}
        {rx.followUp && <div className="kv"><span className="k">Follow-up</span><span className="v">{new Date(rx.followUp).toLocaleDateString()}</span></div>}
      </div>
      <table className="table">
        <thead>
          <tr><th>#</th><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr>
        </thead>
        <tbody>
          {rx.items.map((it, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td>
                <strong>{it.medicineName}</strong>
                {it.strength && <span className="muted"> ({it.strength})</span>}
                {it.generic && <div className="xsmall muted">{it.generic}</div>}
              </td>
              <td>{it.dosage ?? '—'}</td>
              <td>{it.frequency ?? '—'}</td>
              <td>{it.duration ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

export function PrescriptionsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<RxTab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1');
  const [detail, setDetail] = useState<PrescriptionDTO | null>(null);

  const filter = { range: RANGE[tab], page, pageSize: 25 };
  const { data, loading, error, reload } = useAsync(() => api['prescriptions/list'](filter), [tab, page]);

  React.useEffect(() => {
    if (params.get('new') === '1') {
      setCreateOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
    const rxId = params.get('rx');
    if (rxId) {
      void api['prescriptions/get'](Number(rxId)).then(setDetail).catch(() => undefined);
      params.delete('rx');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = (data?.items ?? []).filter((rx) =>
    !query ||
    rx.patientName.toLowerCase().includes(query.toLowerCase()) ||
    rx.number.toLowerCase().includes(query.toLowerCase()) ||
    rx.items.some((i) => i.medicineName.toLowerCase().includes(query.toLowerCase())),
  );

  const columns: Column<PrescriptionDTO>[] = [
    { key: 'number', label: 'Rx No', render: (rx) => <span className="mono strong">{rx.number}</span> },
    { key: 'date', label: 'Date', sortValue: (rx) => rx.date, render: (rx) => new Date(rx.date).toLocaleDateString() },
    {
      key: 'patient', label: 'Patient',
      render: (rx) => (<div><strong>{rx.patientName}</strong><div className="xsmall muted mono">{rx.patientCode}</div></div>),
    },
    { key: 'dentist', label: 'Dentist', render: (rx) => rx.dentistName },
    {
      key: 'meds', label: 'Medicines', clip: true,
      render: (rx) => rx.items.map((i) => i.medicineName).join(', ') || <span className="muted">—</span>,
    },
    { key: 'count', label: 'Items', align: 'right', render: (rx) => <span className="num">{rx.items.length}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (rx) => (
        <div className="row gap-2 end" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setDetail(rx)}>View</Button>
          {can('clinical.prescription.print') && (
            <Button size="sm" variant="secondary" onClick={() => void api['reports/print']({ type: 'prescription', id: rx.id }).catch((err) => toast.fromError(err))}>
              Print
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Prescriptions</h1>
          <p className="page-subtitle">{data?.total ?? 0} prescriptions · premium print layouts with signature area</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={reload}>Refresh</Button>
          {can('clinical.prescription.create') && (
            <Button variant="primary" icon={Icon.plus} onClick={() => setCreateOpen(true)}>New prescription</Button>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'all' as const, label: 'All' },
          { key: 'today' as const, label: 'Today' },
          { key: 'week' as const, label: 'Last 7 days' },
          { key: 'month' as const, label: 'Last 30 days' },
        ]}
        active={tab}
        onChange={(k) => { setTab(k); setPage(1); }}
      />

      <div className="mt-4">
        <TableToolbar>
          <div style={{ minWidth: 260, flex: '1 1 260px' }}>
            <Input value={query} onChange={setQuery} placeholder="Search patient, Rx number or medicine…" />
          </div>
        </TableToolbar>

        <Card pad={false}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(rx) => rx.id}
            loading={loading}
            error={error}
            onRetry={reload}
            onRowClick={(rx) => setDetail(rx)}
            empty={{
              title: query ? 'No matching prescriptions' : 'No prescriptions yet',
              body: query ? 'Try another patient name or medicine.' : 'Prescriptions created during visits appear here.',
              action: can('clinical.prescription.create') ? <Button variant="primary" onClick={() => setCreateOpen(true)}>New prescription</Button> : undefined,
            }}
          />
          {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
        </Card>
      </div>

      {createOpen && <RxFormModal patientId={0} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); reload(); }} />}
      {detail && <RxDetailModal rx={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
