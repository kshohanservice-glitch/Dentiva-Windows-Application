/**
 * Shared bootstrap for Electron E2E specs that need their own app instance.
 *
 * The responsive-layout spec runs in a second Electron process (the first spec
 * closes its app, so the single-instance lock is free). This helper keeps the
 * first-run flow in one place: activation → setup wizard → sign-in.
 *
 * The activation code is reconstructed from factors — the literal code must
 * never appear in this repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

export const ACTIVATION_CODE = [3, 3, 5, 317, 106315593061].reduce((acc, n) => acc * n, 1).toString();
export const PASSWORD = 'Passw0rd123';

/** Dev data directory used by `DENTIVA_DEV=1` runs (see src/main/paths.ts). */
export const DATA_DIR = path.resolve('.dentiva-data');

export interface LaunchOptions {
  /** Wipe the dev data directory first — required for a fresh first run. */
  fresh?: boolean;
  /** Extra Chromium switches forwarded to Electron. */
  extraArgs?: string[];
}

export async function launchApp(options: LaunchOptions = {}): Promise<{ app: ElectronApplication; page: Page }> {
  if (options.fresh !== false) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const app = await electron.launch({
    args: ['.', ...(options.extraArgs ?? [])],
    env: { ...process.env, DENTIVA_DEV: '1' },
    timeout: 90_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  page.on('console', (m) => console.log(`[renderer ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack ?? e.message}`));
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** Activation → clinic information → dentist → administrator → sign-in screen. */
export async function completeFirstRun(page: Page): Promise<void> {
  const code = page.locator('input[placeholder="Enter activation code"]');
  await expect(code).toBeVisible({ timeout: 60_000 });
  await code.fill(ACTIVATION_CODE);
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByRole('heading', { name: 'Clinic information' })).toBeVisible({ timeout: 60_000 });

  await page.locator('input[placeholder="e.g. Smile Dental Care"]').fill('E2E Layout Dental');
  await page.locator('input[placeholder="01XXXXXXXXX"]').fill('01722222222');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.locator('input[placeholder="Dr. …"]').fill('Dr. Layout Dentist');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.locator('input[placeholder="admin"]').fill('layoutowner');
  const pwFields = page.locator('input[type="password"][autocomplete="new-password"]');
  await pwFields.first().fill(PASSWORD);
  await pwFields.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByPlaceholder('e.g. admin')).toBeVisible({ timeout: 60_000 });
}

export async function signIn(page: Page): Promise<void> {
  await page.getByPlaceholder('e.g. admin').fill('layoutowner');
  await page.getByPlaceholder('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Walk-in / Quick Docs' })).toBeVisible({ timeout: 60_000 });
}

/**
 * Resize the real application window and wait until the renderer agrees.
 * Returns the CSS-pixel width/height the page actually laid out at, which is
 * what the responsive rules are evaluated against.
 */
export async function resizeWindow(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<{ innerWidth: number; innerHeight: number }> {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No application window to resize.');
    win.setSize(size.width, size.height);
  }, { width, height });
  // The outer window size is what setSize controls; the inner (layout) size is
  // smaller by the frame, so wait for a range rather than an exact value.
  await page.waitForFunction(
    (expected) => window.innerWidth <= expected + 4 && window.innerWidth >= expected - 60,
    width,
    { timeout: 20_000 },
  );
  return page.evaluate(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }));
}
