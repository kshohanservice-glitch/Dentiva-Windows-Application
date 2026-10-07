/**
 * Installed-artifact smoke test (run by CI after `electron-builder --win nsis`).
 *
 * Silently-installs the built NSIS installer beforehand; this script attaches
 * to the installed executable and drives the critical path on a real packaged
 * build: activation → first-run setup → sign-in screen.
 *
 * Usage: node scripts/smoke-installed.mjs "C:\\path\\to\\Dentiva Pro.exe"
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const ACTIVATION_CODE = [3, 3, 5, 317, 106315593061].reduce((acc, n) => acc * n, 1).toString();
const PASSWORD = 'Passw0rd123';

const exePath = process.argv[2];
if (!exePath || !fs.existsSync(exePath)) {
  console.error(`Installed executable not found: ${exePath ?? '(missing argument)'}`);
  process.exit(1);
}

// Fresh machine profile so first-run (activation/setup) state is guaranteed.
for (const dirName of ['Dentiva Pro', 'dentiva-pro']) {
  fs.rmSync(path.join(os.homedir(), 'AppData', 'Roaming', dirName), { recursive: true, force: true });
}

const app = await electron.launch({ executablePath: exePath, args: [], timeout: 120_000 });
try {
  const page = await app.firstWindow({ timeout: 90_000 });
  await page.waitForLoadState('domcontentloaded');

  const demo = await page.getByText('BrightSmile Dental Clinic — Demo').count() > 0;
  if (demo) {
    if (await page.locator('input[placeholder="Enter activation code"]').count()) throw new Error('Demo unexpectedly showed activation screen.');
    if (await page.getByRole('heading', { name: 'Clinic information' }).count()) throw new Error('Demo unexpectedly showed setup screen.');
    await page.getByText('Patients today').waitFor({ state: 'visible', timeout: 30_000 });
    console.log('SMOKE OK: demo installed artifact bypassed activation/setup and reached dashboard.');
  } else {
    const codeInput = page.locator('input[placeholder="Enter activation code"]');
    await codeInput.waitFor({ state: 'visible', timeout: 90_000 });
    await codeInput.fill(ACTIVATION_CODE);
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.getByRole('heading', { name: 'Clinic information' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('input[placeholder="e.g. Smile Dental Care"]').fill('Artifact Smoke Clinic');
    await page.locator('input[placeholder="01XXXXXXXXX"]').fill('01722222222');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[placeholder="Dr. …"]').fill('Dr. Smoke Dentist');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input[placeholder="admin"]').fill('smokeowner');
    const pwFields = page.locator('input[type="password"][autocomplete="new-password"]');
    await pwFields.first().fill(PASSWORD);
    await pwFields.nth(1).fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await page.getByPlaceholder('e.g. admin').waitFor({ state: 'visible', timeout: 90_000 });
    console.log('SMOKE OK: installed artifact activated, set up and reached sign-in screen.');
  }
} finally {
  await app.close().catch(() => undefined);
}
