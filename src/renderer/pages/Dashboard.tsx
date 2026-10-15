import { useEffect } from 'react';
import { enumLabel, formatDate } from '../format';
import { Money } from '../components/money';
import { useNavigate } from 'react-router-dom';
import { api, useAsync, useInterval } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, EmptyState, ErrorState, Spinner, StatCard, useToast } from '../components/primitives';
import { Icon } from '../components/shell';

const time = (iso: string): string => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function DashboardPage() {
  const { user, can, settings } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api['dashboard/get'](), []);
  const canFinance = can('dashboard.finance') && can('finance.view');

  useInterval(() => { void reload(); }, 1500);

  useEffect(() => {
    const refresh = () => { void reload(); }
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);

  const backupGo = async () => {
    try {
      const rec = await api['backup/run']();
      toast.success('Backup created', `${rec.path.split(/[\\/]/).pop()} · ${rec.sizeBytes.toLocaleString('en-GB')} bytes`);
    } catch (err) {
      toast.error('Backup failed', err instanceof Error ? err.message : undefined);
    }
  };

  if (loading && !data) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <EmptyState title="No data yet" body="Once the clinic starts recording visits, the dashboard fills in." />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{greeting}, {user?.displayName?.split(' ')[0] ?? 'there'}</h1>
          <p className="page-sub">
            {settings?.clinic.clinicName} · {formatDate(new Date())}
          </p>
        </div>
        <div className="row gap-2 wrap">
          <Button variant="secondary" icon={Icon.refresh} onClick={reload}>Refresh</Button>
          {can('backup.create') && <Button variant="secondary" icon={Icon.backup} onClick={() => void backupGo()}>Backup now</Button>}
          {can('appointments.manage') && <Button variant="primary" icon={Icon.plus} onClick={() => navigate('/appointments?new=1')}>New appointment</Button>}
        </div>
      </div>

      {(data.alerts ?? []).length > 0 && (
        <div className="alert-stack mb-4">
          {data.alerts.map((a, i) => (
            <div key={i} className={`alert alert-${a.severity}`}>
              <strong>{a.title}</strong> <span>{a.body}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid stats-grid">
        <StatCard label="Patients today" value={String(data.todayPatients)} foot="New and returning patients" onClick={() => navigate('/patients')} />
        <StatCard label="Appointments today" value={String(data.todayAppointments)} foot="Planned for today" onClick={() => navigate('/appointments')} />
        <StatCard label="Completed visits" value={String(data.completedVisits)} foot="Closed today" onClick={() => navigate('/reports')} />
      </div>

      {((data.financial && canFinance) || data.inventory) && (
        <div className="grid stats-grid">
          {data.financial && canFinance && (
            <>
              <StatCard label="Paid today" value={<Money paisa={data.financial.todayRevenuePaisa} />} foot="Net payments received" onClick={() => navigate('/payments')} />
              <StatCard label="Outstanding dues" value={<Money paisa={data.financial.outstandingDuePaisa} />} foot="Across all invoices" onClick={() => navigate('/invoices')} />
            </>
          )}
          {/* Stock KPIs follow inventory access, not finance access (V5-034). */}
          {data.inventory && (
            <>
              <StatCard label="Low-stock items" value={String(data.inventory.lowStock ?? 0)} foot="At or below minimum" onClick={() => navigate('/inventory')} />
              <StatCard label="Expiring ≤30 days" value={String(data.inventory.expiringSoon ?? 0)} foot="Batches" onClick={() => navigate('/inventory')} />
            </>
          )}
        </div>
      )}

      <div className="grid gap-4 dashboard-split mt-4">
        <div className="col gap-4">
          <Card title="Today's appointments" actions={<Button size="sm" variant="ghost" onClick={() => navigate('/appointments')}>View all</Button>}>
            {data.upcomingAppointments.length === 0 ? (
              <EmptyState title="No appointments today" body="Create an appointment to start the day." />
            ) : (
              <div className="list">
                {data.upcomingAppointments.slice(0, 8).map((a) => (
                  <div key={a.id} className="list-row clickable" onClick={() => navigate('/appointments')}>
                    <span className="num" style={{ width: 58 }}>{a.time}</span>
                    <span className="flex-1">
                      <strong>{a.patientName}</strong>
                      <div className="xsmall muted">{a.dentistName ?? 'Any dentist'} · {a.type || 'Consultation'}</div>
                    </span>
                    <Badge tone={a.status === 'cancelled' ? 'danger' : a.status === 'completed' ? 'success' : 'brand'}>{enumLabel(a.status)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Recent patients" actions={<Button size="sm" variant="ghost" onClick={() => navigate('/patients')}>View all</Button>}>
            {data.recentPatients.length === 0 ? (
              <EmptyState title="No patients yet" body="Register your first patient to get started." />
            ) : (
              <div className="list">
                {data.recentPatients.map((p) => (
                  <div key={p.id} className="list-row clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                    <div className="avatar xs">{p.name.slice(0, 1).toUpperCase()}</div>
                    <span className="flex-1">
                      <strong>{p.name}</strong>
                      <div className="xsmall muted mono">{p.code}</div>
                    </span>
                    <span className="xsmall muted">{formatDate(p.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="col gap-4">
          {data.financial && (
            <Card title="Outstanding invoices" actions={<Button size="sm" variant="ghost" onClick={() => navigate('/invoices')}>Billing</Button>}>
              {data.financial.outstandingInvoices.length === 0 ? (
                <EmptyState title="No outstanding dues" body="All invoices are fully paid. Excellent!" />
              ) : (
                <div className="list">
                  {data.financial.outstandingInvoices.map((inv) => (
                    <div key={inv.id} className="list-row clickable" onClick={() => navigate(`/invoices?invoice=${inv.id}`)}>
                      <span className="flex-1">
                        <strong className="mono">{inv.number}</strong>
                        <div className="xsmall muted">{inv.patientName}</div>
                      </span>
                      <span className="danger strong num"><Money paisa={inv.duePaisa} /></span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {data.financial && (
          <Card title="Recent payments" actions={<Button size="sm" variant="ghost" onClick={() => navigate('/payments')}>View all</Button>}>
            {data.financial.recentPayments.length === 0 ? (
              <EmptyState title="No payments yet" body="Payments received today will appear here." />
            ) : (
              <div className="list">
                {data.financial.recentPayments.map((payment) => (
                  <div key={payment.id} className="list-row clickable" onClick={() => navigate('/payments')}>
                    <span className="flex-1">
                      <strong>{payment.patientName}</strong>
                      <div className="xsmall muted">{payment.invoiceNumber ?? 'Walk-in payment'} · {payment.method}</div>
                    </span>
                    <span className={payment.type === 'refund' ? 'danger strong num' : 'success-text strong num'}>
                      {payment.type === 'refund' ? '−' : '+'}<Money paisa={payment.amountPaisa} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          )}

          <Card title="Dentist workload (today)">
            {data.financial && data.financial.dentistWorkload.length > 0 ? (
              <div className="col gap-2">
                {data.financial.dentistWorkload.map((d) => (
                  <div key={d.name} className="row between">
                    <span className="small">{d.name}</span>
                    <Badge tone="brand">{d.count} visit{d.count === 1 ? '' : 's'}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">No visits recorded today yet.</p>
            )}
          </Card>

          <Card title="Top treatments">
            {data.financial && data.financial.treatmentStats.length > 0 ? (
              <div className="col gap-2">
                {data.financial.treatmentStats.map((t) => (
                  <div key={t.name} className="row between">
                    <span className="small">{t.name}</span>
                    <span className="num small strong">{t.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">Treatment statistics appear after procedures are recorded.</p>
            )}
          </Card>
        </div>
      </div>
      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/reports')}>Open reports →</Button>
      </div>
      <div className="xsmall muted mt-4">Last updated {time(new Date().toISOString())}</div>
    </div>
  );
}
