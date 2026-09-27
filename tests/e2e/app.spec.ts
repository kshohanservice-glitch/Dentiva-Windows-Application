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
  await expect(detail.getByText('৳500.00').first()).toBeVisible();

  await detail.getByRole('button', { name: 'Receive payment' }).click();
  const pay = page.locator('.modal[role="dialog"]', { hasText: 'Receive payment' });
  await expect(pay).toBeVisible();
  await pay.getByLabel('Method').selectOption('cash');
  await pay.getByRole('button', { name: 'Record payment' }).click();

  await expect(page.locator('.toast-title', { hasText: 'Payment recorded' })).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByText('paid', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('cell', { name: 'INV-', exact: false }).first()).toBeVisible();
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
