import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

let app: ElectronApplication;
let page: Page;

const blockedChannels = [
  'activation/verify','auth/login','auth/logout','auth/change-password','auth/unlock','setup/complete','system/lock',
  'patients/create','patients/update','patients/archive','patients/delete','patients/export',
  'visits/create','visits/update','visits/delete','chart/set','chart/delete',
  'treatments/save','treatments/set-active','treatments/delete',
  'prescriptions/create','prescriptions/delete','prescriptions/save-template','prescriptions/delete-template',
  'appointments/create','appointments/update','appointments/cancel','appointments/delete','appointments/no-show','appointments/arrive',
  'queue/add','queue/action','queue/delete','queue/reorder',
  'invoices/create','invoices/void','invoices/delete','payments/create','payments/delete',
  'inventory/save-item','inventory/delete-item','inventory/delete-batch','inventory/stock','inventory/save-supplier','inventory/delete-supplier',
  'accounting/add-expense','accounting/delete-expense','accounting/add-income','accounting/delete-income','accounting/save-category','accounting/delete-category',
  'staff/save','staff/delete','dentists/save','dentists/delete',
  'users/save','users/reset-password','users/delete','roles/save','roles/remove',
  'attachments/add','attachments/rename','attachments/remove','attachments/export',
  'backup/run','backup/restore','backup/set-auto',
  'settings/save','settings/upload-logo','settings/reset-business',
  'referrals/save','referrals/delete','notifications/mark-read',
  'reports/export','reports/print','reports/save-pdf','print/execute','print/pdf','print/close',
];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fs.rmSync(path.resolve('.dentiva-data'), { recursive: true, force: true });
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, DENTIVA_DEV: '1' },
    timeout: 90_000,
  });
  page = await app.firstWindow({ timeout: 60_000 });
  page.on('console', (m) => console.log(`[renderer ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e.message}`));
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
});

test('starts directly on the demo dashboard without activation or setup', async () => {
  const info = await page.evaluate(async () => {
    const api = (window as any).dentiva;
    return {
      system: await api['system/info'](),
      activation: await api['activation/status'](),
      setup: await api['setup/status'](),
      session: await api['auth/session'](),
    };
  });
  expect(info.system.demo).toBe(true);
  expect(info.system.version).toBe('3.0.3-demo.1');
  expect(info.activation.activated).toBe(true);
  expect(info.setup.needsSetup).toBe(false);
  expect(info.session.username).toBe('demo');
  await expect(page.getByText('BrightSmile Dental Clinic — Demo')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Patients today')).toBeVisible({ timeout: 30_000 });
});

test('preloaded demo data exposes all ten patients and core records', async () => {
  const counts = await page.evaluate(async () => {
    const api = (window as any).dentiva;
    const patients = await api['patients/list']({ page: 1, pageSize: 50 });
    const visits = await api['visits/list']({ page: 1, pageSize: 50 });
    const prescriptions = await api['prescriptions/list']({ page: 1, pageSize: 50 });
    const invoices = await api['invoices/list']({ page: 1, pageSize: 50 });
    const payments = await api['payments/list']({ page: 1, pageSize: 50 });
    const appointments = await api['appointments/list']({ from: '2000-01-01', to: '2099-12-31' });
    const inventory = await api['inventory/items']({});
    const staff = await api['staff/list']();
    const dentists = await api['dentists/list'](true);
    const expenses = await api['accounting/expenses']({ page: 1, pageSize: 50 });
    const incomes = await api['accounting/incomes']({ page: 1, pageSize: 50 });
    const referrals = await api['referrals/list'](patients.data[0].id);
    return {
      patients: patients.total, visits: visits.total, prescriptions: prescriptions.total,
      invoices: invoices.total, payments: payments.total, appointments: appointments.length,
      inventory: inventory.length, staff: staff.length, dentists: dentists.length,
      expenses: expenses.total, incomes: incomes.total, referrals: referrals.length,
    };
  });
  expect(counts.patients).toBe(10);
  expect(counts.visits).toBeGreaterThanOrEqual(8);
  expect(counts.prescriptions).toBeGreaterThanOrEqual(5);
  expect(counts.invoices).toBeGreaterThanOrEqual(8);
  expect(counts.payments).toBeGreaterThanOrEqual(5);
  expect(counts.appointments).toBeGreaterThanOrEqual(8);
  expect(counts.inventory).toBeGreaterThanOrEqual(2);
  expect(counts.staff).toBeGreaterThanOrEqual(3);
  expect(counts.dentists).toBeGreaterThanOrEqual(2);
  expect(counts.expenses).toBeGreaterThanOrEqual(1);
  expect(counts.incomes).toBeGreaterThanOrEqual(2);
  expect(counts.referrals).toBeGreaterThanOrEqual(1);
});

test('read-only enforcement blocks every exposed mutating IPC channel', async () => {
  const results = await page.evaluate(async (channels) => {
    const api = (window as any).dentiva;
    const out: Record<string, string> = {};
    for (const channel of channels) {
      try {
        await api[channel](null);
        out[channel] = 'ALLOWED';
      } catch (e) {
        out[channel] = String((e as Error)?.message ?? e);
      }
    }
    return out;
  }, blockedChannels);
  for (const channel of blockedChannels) {
    expect(results[channel], channel).toContain('Demo mode is read-only');
  }
});

test('can explore the major read-only views', async () => {
  for (const name of ['Dashboard', 'Patients', 'Appointments', 'Queue', 'Invoice', 'Inventory', 'Accounting', 'Staff', 'Reports', 'Settings', 'About']) {
    const link = page.getByRole('link', { name, exact: true });
    if (await link.count()) {
      await link.click();
      await expect(link).toBeVisible();
    }
  }
});
