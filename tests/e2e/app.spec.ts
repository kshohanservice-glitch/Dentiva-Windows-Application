/**
 * End-to-end smoke of the real Dentiva Pro application.
 *
 * Runs against the dev build (`npm run test:e2e` = build + playwright test):
 * activation → first-run setup → login → dashboard → patient registration →
 * invoice + payment → about → backup. The packaged installer is validated
 * separately by scripts/smoke-installed.mjs in CI.
 *
 * The activation code is reconstructed from factors — the literal code must
 * never appear in this repository.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACTIVATION_CODE = [3, 3, 5, 317, 106315593061].reduce((acc, n) => acc * n, 1).toString();
const PASSWORD = 'Passw0rd123';

let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Dev mode stores data in <repo>/.dentiva-data — start from a clean slate.
  fs.rmSync(path.resolve('.dentiva-data'), { recursive: true, force: true });
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, DENTIVA_DEV: '1' },
    timeout: 90_000,
  });
  page = await app.firstWindow({ timeout: 60_000 });
  // Forward renderer diagnostics to stdout so CI annotations can show them.
  page.on('console', (m) => console.log(`[renderer ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e.message}`));
  await page.waitForLoadState('domcontentloaded');
});

/** Dump whatever the window actually shows — used when a selector never appears. */
async function dumpWindowState(label: string): Promise<void> {
  try {
    console.log(`[diag:${label}] title=${await page.title()}`);
    console.log(`[diag:${label}] url=${page.url()}`);
    const html = await page.content();
    console.log(`[diag:${label}] html=${html.slice(0, 2500)}`);
    const text = await page.locator('body').innerText();
    console.log(`[diag:${label}] bodyText=${text.slice(0, 1200)}`);
  } catch (err) {
    console.log(`[diag:${label}] dump failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

test.afterAll(async () => {
  await app?.close();
});

test('activates offline and completes first-run setup', async () => {
  const code = page.locator('input[placeholder="Enter activation code"]');
  try {
    await expect(code).toBeVisible({ timeout: 60_000 });
  } catch (err) {
    await dumpWindowState('activation');
    throw err;
  }

  await code.fill(ACTIVATION_CODE);
  await page.getByRole('button', { name: 'Activate' }).click();
  try {
    await expect(page.getByRole('heading', { name: 'Clinic information' })).toBeVisible();
  } catch (err) {
    await dumpWindowState('post-activate');
    throw err;
  }

  await page.locator('input[placeholder="e.g. Smile Dental Care"]').fill('E2E Test Dental');
  await page.locator('input[placeholder="01XXXXXXXXX"]').fill('01711111111');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.locator('input[placeholder="Dr. …"]').fill('Dr. E2E Dentist');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.locator('input[placeholder="admin"]').fill('e2eowner');
  const pwFields = page.locator('input[type="password"][autocomplete="new-password"]');
  await pwFields.first().fill(PASSWORD);
  await pwFields.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Finish setup' }).click();
  // Setup ends on the sign-in screen.
  await expect(page.getByPlaceholder('e.g. admin')).toBeVisible({ timeout: 60_000 });
});

test('signs in and renders the dashboard', async () => {
  await page.getByPlaceholder('e.g. admin').fill('e2eowner');
  await page.getByPlaceholder('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Backup now' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible();
});

test('registers a patient with Bengali-capable data entry', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Register patient' }).first().click();
  const modal = page.locator('.modal[role="dialog"]');
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('Patient name').fill('E2E Test Patient');
  await modal.getByPlaceholder('বাংলায় নাম').fill('ইউটিই টেস্ট রোগী');
  await modal.getByLabel('Gender').selectOption('male');
  await modal.getByLabel('Age (years)').fill('34');
  await modal.getByPlaceholder('01XXXXXXXXX').fill('01799999999');
  await modal.getByRole('button', { name: 'Register patient' }).click();

  // Saved → navigated to the patient profile.
  await expect(page.getByRole('heading', { name: 'E2E Test Patient' })).toBeVisible({ timeout: 30_000 });

  // Search finds them from the list too.
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await expect(page.getByRole('cell', { name: 'E2E Test Patient' })).toBeVisible();
});

test('selects and updates the dental chart reliably', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await page.getByRole('cell', { name: 'E2E Test Patient' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Patient' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Dental chart', exact: true }).click();

  const chart = page.locator('.tooth-chart');
  await expect(chart).toBeVisible({ timeout: 30_000 });
  const tooth = chart.locator('.tooth-body', { hasText: '11' }).first();
  await tooth.click();
  await expect(tooth).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.getByText('11', { exact: false }).first()).toBeVisible();

  await chart.getByRole('button', { name: /Apply “Caries”/ }).click();
  await expect(page.locator('.toast-title', { hasText: 'Chart updated' })).toBeVisible({ timeout: 30_000 });
  await expect(tooth).toHaveClass(/marked/);
});

test('creates an invoice and receives full payment', async () => {
  await page.getByRole('link', { name: 'Invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New invoice' }).first().click();

  const modal = page.locator('.modal[role="dialog"]', { hasText: 'Create invoice' });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('Search patient by name, phone or ID…').fill('E2E Test Patient');
  await modal.locator('.list-row', { hasText: 'E2E Test Patient' }).first().click();

  // The form starts with one empty line.
  await modal.getByPlaceholder('Treatment or item').fill('Scaling and polishing');
  await modal.getByLabel('Unit price (৳)').fill('500');
  await modal.getByRole('button', { name: 'Create invoice' }).click();

  // onSaved opens the invoice detail modal.
  const detail = page.locator('.modal[role="dialog"]', { hasText: 'Invoice INV-' });
  await expect(detail).toBeVisible({ timeout: 30_000 });
  // Financial amounts are private by default, but this amount can be revealed locally.
  await expect(detail.locator('[data-masked="true"]').first()).toContainText('****');
  await detail.getByRole('button', { name: 'Show this amount' }).first().click();
  await expect(detail.getByText('৳500.00').first()).toBeVisible();

  await detail.getByRole('button', { name: 'Receive payment' }).click();
  const pay = page.locator('.modal[role="dialog"]', { hasText: 'Receive payment' }).last();
  await expect(pay).toBeVisible();
  await pay.getByLabel('Method').selectOption('cash');
  await pay.getByRole('button', { name: 'Record payment' }).click();

  await expect(page.locator('.toast-title', { hasText: 'Payment recorded' })).toBeVisible({ timeout: 30_000 });
  // The status badge (enum shown as "Paid" since v5) — not the "Paid" amount label.
  await expect(detail.locator('.kv', { hasText: 'Status' }).locator('.badge', { hasText: /^Paid$/ })).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('cell', { name: 'INV-', exact: false }).first()).toBeVisible();

  // Dashboard is live: the same payment must be reflected without a manual refresh.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  const paidCard = page.locator('.stat-card', { hasText: 'Paid Today' });
  await expect(paidCard).toContainText('****', { timeout: 10_000 });
  await page.getByRole('button', { name: /Show amounts/ }).click();
  await expect(paidCard).toContainText('৳500.00', { timeout: 10_000 });
  await page.getByRole('button', { name: /Hide amounts/ }).click();
});

test('clinician templates fill visit and invoice drafts without creating records', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await page.getByRole('cell', { name: 'E2E Test Patient' }).click();
  await page.getByRole('button', { name: 'New visit', exact: true }).first().click();
  const visit = page.locator('.modal[role="dialog"]', { hasText: 'Record visit' });
  await visit.getByLabel('Treatment plan', { exact: true }).fill('Review options at next visit');
  const plan = visit.locator('.form-section', { hasText: 'Treatment plan templates' });
  await plan.getByLabel('Template name', { exact: true }).fill('E2E reusable plan');
  await plan.getByRole('button', { name: 'Save current draft' }).click();
  await expect(plan.getByRole('option', { name: 'E2E reusable plan' })).toBeAttached();
  await visit.getByLabel('Treatment plan', { exact: true }).fill('');
  await plan.getByLabel('Treatment plan templates').selectOption({ label: 'E2E reusable plan' });
  await plan.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(visit.getByLabel('Treatment plan', { exact: true })).toHaveValue('Review options at next visit');
  await visit.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();

  await page.getByRole('button', { name: 'New prescription' }).first().click();
  const rx = page.locator('.modal[role="dialog"]', { hasText: 'New prescription' });
  await rx.getByLabel('Advice', { exact: true }).fill('Routine post-op advice');
  const instructions = rx.locator('.form-section', { hasText: 'Prescription instructions templates' });
  await instructions.getByLabel('Template name', { exact: true }).fill('E2E reusable advice');
  await instructions.getByRole('button', { name: 'Save current draft' }).click();
  await expect(instructions.getByRole('option', { name: 'E2E reusable advice' })).toBeAttached();
  await rx.getByLabel('Advice', { exact: true }).fill('');
  await instructions.getByLabel('Prescription instructions templates').selectOption({ label: 'E2E reusable advice' });
  await instructions.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(rx.getByLabel('Advice', { exact: true })).toHaveValue('Routine post-op advice');
  await rx.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();

  await page.getByRole('link', { name: 'Invoice', exact: true }).click();
  await page.getByRole('button', { name: 'New invoice' }).first().click();
  const invoice = page.locator('.modal[role="dialog"]', { hasText: 'Create invoice' });
  await invoice.getByPlaceholder('Treatment or item').fill('Template consultation');
  await invoice.getByLabel('Unit price (৳)').fill('125');
  const items = invoice.locator('.form-section', { hasText: 'Invoice item templates' });
  await items.getByLabel('Template name', { exact: true }).fill('E2E invoice items');
  await items.getByRole('button', { name: 'Save current draft' }).click();
  await expect(items.getByRole('option', { name: 'E2E invoice items' })).toBeAttached();
  await invoice.getByPlaceholder('Treatment or item').fill('');
  await items.getByLabel('Invoice item templates').selectOption({ label: 'E2E invoice items' });
  await items.getByRole('button', { name: 'Apply to draft' }).click();
  await page.getByRole('button', { name: 'Replace draft fields' }).click();
  await expect(invoice.getByPlaceholder('Treatment or item')).toHaveValue('Template consultation');
  await invoice.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
});

test('shows developer credit on the About page', async () => {
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page.getByText('Shohan Khan')).toBeVisible();
  await expect(page.getByText('helloiamshohan@gmail.com')).toBeVisible();
});

test('runs a manual backup from the dashboard', async () => {
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Backup now' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Backup created' })).toBeVisible({ timeout: 60_000 });
});

/* ---------------------------------------------------------------------------
 * Phase B journey expansion (ISS-005): appointment lifecycle (reminder-only),
 * prescription → print window, and the Reports UI contract (ISS-020 guard).
 * --------------------------------------------------------------------------- */

test('books an appointment, reschedules it with confirmation, and keeps it on the schedule', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole('link', { name: 'Appointments' }).click();
  await expect(page.getByRole('heading', { name: 'Appointments', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'New appointment' }).first().click();
  const modal = page.locator('.modal[role="dialog"]', { hasText: 'New appointment' });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('Search by name, phone or patient ID…').fill('E2E Test Patient');
  await modal.locator('.list-row', { hasText: 'E2E Test Patient' }).first().click();
  await modal.getByLabel('Dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await modal.getByLabel('Date').fill(today);
  await modal.getByLabel('Time').fill('15:30');
  await modal.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Appointment booked' })).toBeVisible({ timeout: 30_000 });

  // Reschedule: the move must be confirmed explicitly before it is saved.
  const row = page.locator('tr', { hasText: 'E2E Test Patient' }).filter({ hasText: '15:30' }).first();
  await row.getByRole('button', { name: 'Reschedule' }).click();
  const resModal = page.locator('.modal[role="dialog"]', { hasText: 'Reschedule appointment' });
  await expect(resModal).toBeVisible();
  await resModal.getByLabel('Time').fill('15:45');
  await resModal.getByRole('button', { name: 'Save new time' }).click();
  await page.getByRole('button', { name: 'Confirm move' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Appointment rescheduled' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('tr', { hasText: 'E2E Test Patient' }).filter({ hasText: '15:45' }).first()).toBeVisible();
});

test('blocks double-booking with a conflict alert and honours override permission', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole('link', { name: 'Appointments' }).click();

  // First book an active scheduled appointment at 17:00 (the earlier 15:45 appointment ends before this slot).
  await page.getByRole('button', { name: 'New appointment' }).first().click();
  const firstModal = page.locator('.modal[role="dialog"]', { hasText: 'New appointment' });
  await expect(firstModal).toBeVisible();
  await firstModal.getByPlaceholder('Search by name, phone or patient ID…').fill('E2E Test Patient');
  await firstModal.locator('.list-row', { hasText: 'E2E Test Patient' }).first().click();
  await firstModal.getByLabel('Dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await firstModal.getByLabel('Date').fill(today);
  await firstModal.getByLabel('Time').fill('17:00');
  await firstModal.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Appointment booked' }).last()).toBeVisible({ timeout: 30_000 });

  // Now attempt an overlapping appointment at 17:15 for the same dentist.
  await page.getByRole('button', { name: 'New appointment' }).first().click();
  const modal = page.locator('.modal[role="dialog"]', { hasText: 'New appointment' });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('Search by name, phone or patient ID…').fill('E2E Test Patient');
  await modal.locator('.list-row', { hasText: 'E2E Test Patient' }).first().click();
  await modal.getByLabel('Dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await modal.getByLabel('Date').fill(today);
  await modal.getByLabel('Time').fill('17:15'); // overlaps the 17:00 appointment
  await modal.getByRole('button', { name: 'Book appointment' }).click();
  // Conflict detected (owner holds appointments.override → inline alert, not a silent double-book).
  await expect(modal.getByText('Scheduling conflict')).toBeVisible({ timeout: 30_000 });
  await modal.getByRole('button', { name: 'Book anyway (override)' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Appointment booked' }).last()).toBeVisible({ timeout: 30_000 });
});

test('creates a prescription and opens the print window', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await page.getByRole('cell', { name: 'E2E Test Patient' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Patient' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New prescription' }).first().click();
  const rxModal = page.locator('.modal[role="dialog"]', { hasText: 'Save prescription' });
  await expect(rxModal).toBeVisible();
  await page.getByLabel('Prescribing dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await page.getByPlaceholder('e.g. Amoxicillin').first().fill('Amoxicillin 500 mg');
  await page.getByRole('button', { name: 'Save prescription' }).click();
  await expect(page.getByText('Amoxicillin 500 mg').first()).toBeVisible({ timeout: 30_000 });

  // Open the saved prescription and print — a separate sandboxed print window must open.
  await page.getByText('Amoxicillin 500 mg').first().click();
  const detail = page.locator('.modal[role="dialog"]', { hasText: 'Patient' }).last();
  await expect(detail.getByRole('button', { name: 'Print', exact: true })).toBeVisible({ timeout: 30_000 });
  const [printWin] = await Promise.all([
    app.waitForEvent('window', { timeout: 60_000 }),
    detail.getByRole('button', { name: 'Print', exact: true }).click(),
  ]);
  await printWin.waitForLoadState('domcontentloaded');
  expect(printWin.url()).toContain('#print/prescription');
  await expect(printWin.getByText('Amoxicillin 500 mg').first()).toBeVisible({ timeout: 60_000 });

  const geometry = await printWin.locator('.print-doc').evaluate((el) => {
    const style = getComputedStyle(el as HTMLElement);
    const pageRule = [...document.styleSheets].flatMap((sheet) => {
      try { return [...sheet.cssRules]; } catch { return []; }
    }).find((rule) => rule.cssText.startsWith('@page'));
    return {
      width: parseFloat(style.width),
      minHeight: parseFloat(style.minHeight),
      paddingTop: parseFloat(style.paddingTop),
      paddingRight: parseFloat(style.paddingRight),
      paddingBottom: parseFloat(style.paddingBottom),
      paddingLeft: parseFloat(style.paddingLeft),
      pageRule: pageRule?.cssText ?? '',
    };
  });
  // Chromium exposes CSS mm as fractional CSS pixels and may round computed
  // dimensions slightly. Keep the WYSIWYG contract strict at sub-pixel level
  // without making the test depend on a particular rounding implementation.
  const mmToCssPx = (mm: number) => mm * 96 / 25.4;
  const expectNearCssMm = (actual: number, mm: number) => expect(Math.abs(actual - mmToCssPx(mm))).toBeLessThan(0.1);
  expectNearCssMm(geometry.width, 210);
  expectNearCssMm(geometry.minHeight, 297);
  expectNearCssMm(geometry.paddingTop, 12);
  expectNearCssMm(geometry.paddingRight, 12);
  expectNearCssMm(geometry.paddingBottom, 12);
  expectNearCssMm(geometry.paddingLeft, 12);
  expect(geometry.pageRule).toContain('margin: 0px');
  await printWin.close();
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(detail).toBeHidden();
});

test('invoice print window uses standard profiles and closes with Back', async () => {
  await page.getByRole('link', { name: 'Invoice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  const row = page.getByRole('cell', { name: 'INV-', exact: false }).first();
  await row.click();
  const detail = page.locator('.modal[role="dialog"]', { hasText: 'Invoice INV-' }).last();
  await expect(detail).toBeVisible({ timeout: 30_000 });

  const [printWin] = await Promise.all([
    app.waitForEvent('window', { timeout: 60_000 }),
    detail.getByRole('button', { name: 'Print invoice', exact: true }).click(),
  ]);
  await printWin.waitForLoadState('domcontentloaded');
  const profile = printWin.getByRole('combobox', { name: 'Print profile' });
  await expect(profile).toHaveValue('inv-a4');
  // A4 is the only document size: one profile per document type, no A5/thermal.
  await expect(profile.locator('option')).toHaveCount(4);
  await expect(profile.locator('option')).toHaveText([
    'Prescription A4',
    'Invoice A4',
    'Receipt A4',
    'Report A4',
  ]);
  await expect(printWin.locator('.print-doc .doc-title', { hasText: 'Invoice' })).toBeVisible({ timeout: 60_000 });
  const printedAmount = printWin.locator('.print-doc .print-money').first();
  // A printable document is a deliberate, permission-gated export: it carries the
  // real amount on the preview screen AND in print media, never the UI mask.
  await expect(printedAmount).toContainText('৳500.00');
  await expect(printedAmount).not.toContainText('****');
  await printWin.emulateMedia({ media: 'print' });
  await expect(printedAmount).toContainText('৳500.00');
  await expect(printedAmount).not.toContainText('****');
  await printWin.emulateMedia({ media: 'screen' });
  // No masking artifact may remain anywhere in the document.
  await expect(printWin.locator('.print-doc')).not.toContainText('****');

  await Promise.all([
    printWin.waitForEvent('close'),
    printWin.getByRole('button', { name: 'Back', exact: true }).click(),
  ]);
  await detail.getByRole('button', { name: 'Close' }).click();
});

test('walk-in / quick documents print a real document without registering a patient', async () => {
  await page.getByRole('link', { name: 'Walk-in / Quick Docs' }).click();
  await expect(page.getByRole('heading', { name: 'Walk-in / Quick Documents', level: 1 })).toBeVisible();

  // Prescription is the default document type for this workflow.
  await page.getByLabel('Customer name').fill('E2E Walk-in Customer');
  await page.getByLabel('Dentist name (typed)').fill('Dr. E2E Dentist');
  await page.locator('.medicine-entry-editor input').first().fill('Amoxicillin');
  await page.getByLabel('Strength').first().fill('500mg');

  // The preview is the real document renderer, so it must show the same content
  // the print window will show.
  const preview = page.locator('.doc-preview-frame .print-doc');
  await expect(preview.locator('.prescription-medication')).toContainText('Amoxicillin');
  await expect(preview).toContainText('E2E Walk-in Customer');

  const [printWin] = await Promise.all([
    app.waitForEvent('window', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Preview & print' }).click(),
  ]);
  await printWin.waitForLoadState('domcontentloaded');
  expect(printWin.url()).toContain('#print/quick/');
  await expect(printWin.locator('.print-doc')).toContainText('Amoxicillin', { timeout: 60_000 });
  await expect(printWin.locator('.print-doc .prescription-patient-strip')).toContainText('E2E Walk-in Customer');
  // The walk-in path prints the same template as a stored prescription.
  await expect(printWin.locator('.print-doc .prescription-header')).toBeVisible();
  // The document body sits in its own raised layer, and the clinic-logo
  // watermark is off until a clinic enables it (fresh install = default).
  await expect(printWin.locator('.print-doc > .print-doc-content')).toBeAttached();
  await expect(printWin.locator('.print-doc .print-logo-watermark')).toHaveCount(0);
  await Promise.all([
    printWin.waitForEvent('close'),
    printWin.getByRole('button', { name: 'Back', exact: true }).click(),
  ]);

  // Nothing was written to the patient table by the walk-in workflow.
  await page.getByRole('link', { name: 'Patients', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Walk-in Customer');
  await expect(page.getByRole('cell', { name: 'E2E Walk-in Customer' })).toHaveCount(0);
});

test('runs reports from the UI — the full catalogue contract (ISS-020 guard)', async () => {
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

  // Daily summary (default selection).
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByText('Collections (net)')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.toast-title', { hasText: 'Unknown report' })).toHaveCount(0);

  // Range report with totals.
  await page.getByText('Collection report', { exact: true }).click();
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByText('By method')).toBeVisible({ timeout: 30_000 });

  // Profit & loss.
  await page.getByText('Profit & loss', { exact: true }).click();
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByText('Net', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.toast-title', { hasText: 'Unknown report' })).toHaveCount(0);
});

test('global search keeps category labels and result titles in separate columns', async () => {
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.keyboard.press('Control+k');
  const modal = page.locator('.search-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('aria-label', 'Global search');

  await page.getByPlaceholder('Search patients, invoices, prescriptions, staff…').fill('E2E');
  const rows = page.locator('.search-hit');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);

  // DOM labels (the badge is presented in small caps by CSS, so read the DOM
  // value rather than the rendered text).
  const knownLabels = ['Patient', 'Appointment', 'Invoice', 'Payment', 'Prescription', 'Treatment', 'Staff', 'Dentist', 'Inventory', 'Expense', 'Visit', 'Result'];
  const modalBox = (await modal.boundingBox())!;

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    // Exactly two layout columns: the category label and the result content.
    const columns = await row.evaluate((el) =>
      Array.from(el.children).map((c) => (c as HTMLElement).className),
    );
    expect(columns).toEqual(['kind', 'hit-body']);

    const label = ((await row.locator('.kind').textContent()) ?? '').trim();
    expect(knownLabels).toContain(label);

    // The label column and the content column must not overlap.
    const labelBox = (await row.locator('.kind').boundingBox())!;
    const bodyBox = (await row.locator('.hit-body').boundingBox())!;
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(bodyBox.x + 0.5);

    // The badge must never be ellipsised: the fixed column is wide enough for
    // the longest category label.
    const labelClipped = await row.evaluate((el) => {
      const kind = el.querySelector('.kind') as HTMLElement;
      return kind.scrollWidth <= kind.clientWidth + 1;
    });
    expect(labelClipped).toBe(true);

    // Nothing may be clipped horizontally out of the modal.
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(modalBox.x + modalBox.width + 0.5);

    // Long titles/subtitles must be constrained inside their own column, not
    // push the row wider than the modal.
    const clipped = await row.evaluate((el) => {
      const title = el.querySelector('.title') as HTMLElement;
      const sub = el.querySelector('.sub') as HTMLElement;
      return [title, sub].every((n) => n.scrollWidth <= n.clientWidth + 1);
    });
    expect(clipped).toBe(true);
  }

  // Keyboard navigation, selection highlighting and Enter-to-open still work.
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveClass(/selected/);
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(0)).toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('completes a patient visit from the profile and supports patient deletion', async () => {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByPlaceholder('Search name, phone, patient ID, tag…').fill('E2E Test Patient');
  await page.getByRole('cell', { name: 'E2E Test Patient' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Patient' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'New visit', exact: true }).first().click();
  const visit = page.locator('.modal[role="dialog"]', { hasText: 'Record visit' });
  await expect(visit).toBeVisible();
  await visit.getByLabel('Dentist').selectOption({ label: 'Dr. E2E Dentist' });
  await visit.getByLabel('Chief complaint').fill('E2E completion check');
  await visit.getByRole('button', { name: 'Save visit' }).click();
  await expect(page.locator('.toast-title', { hasText: 'Visit recorded' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('tab', { name: 'Visits', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete visit', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Complete visit', exact: true }).click();
  await expect(page.locator('.toast-title', { hasText: 'Visit completed' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.locator('.modal[role="dialog"]', { hasText: 'Delete patient record?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete patient', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible({ timeout: 30_000 });
});

test('adapts cleanly across 1280×720 and 1920×1080 viewports without horizontal overflow', async () => {
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    for (const nav of ['Dashboard', 'Patients', 'Appointments', 'Walk-in / Quick Docs', 'Invoice', 'Inventory', 'Settings']) {
      await page.getByRole('link', { name: nav, exact: true }).click();
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(2);
    }
  }
});
