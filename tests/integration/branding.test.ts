/**
 * Clinic branding persistence.
 *
 * The clinic logo lives in managed storage (`<dataDir>/branding/…`) and is
 * referenced by the `clinic` settings row. It must survive a backup → restore
 * cycle, otherwise restoring a backup silently strips the clinic's identity
 * from the login screen, the dashboard header and every printed document.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { createBackupService, type DbHolder } from '../../src/main/services/backup';
import type { DB } from '../../src/main/db/database';
import { getSettings, saveSettings, uploadLogo } from '../../src/main/services/settings';
import type { Ctx } from '../../src/main/core/context';

/** Minimal but valid PNG header + payload, so the signature check accepts it. */
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' +
    '890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082',
  'hex',
);

let env: TestEnv;
let holder: DbHolder;
let ctx: Ctx;
let dest: string;
let service: ReturnType<typeof createBackupService>;

function brandingDir(): string {
  return path.join(env.paths.dataDir, 'branding');
}

beforeEach(() => {
  env = createTestEnv('branding');
  holder = { get: () => env.db, set: (db: DB) => { env.db = db; } };
  ctx = ownerCtx(env);
  dest = path.join(env.dir, 'backup-dest');
  fs.mkdirSync(dest, { recursive: true });
  service = createBackupService({
    paths: env.paths,
    holder,
    appVersion: '1.0.0-test',
    notify: () => undefined,
  });
});

afterEach(() => {
  cleanupEnv(env);
});

describe('clinic logo upload', () => {
  it('stores a real image in managed branding storage and references it from settings', () => {
    const source = path.join(env.dir, 'logo.png');
    fs.writeFileSync(source, PNG_BYTES);

    const rel = uploadLogo(ctx, source);
    // Stored relative paths follow the same platform-native convention as
    // attachments, so compare the logical (forward-slash) form.
    expect(rel.replace(/\\/g, '/')).toMatch(/^branding\/logo-\d+\.png$/);
    expect(fs.existsSync(path.join(env.paths.dataDir, rel))).toBe(true);

    const settings = getSettings(ctx);
    expect(settings.clinic.logoPath).toBe(rel);
    expect(settings.clinic.logoDataUrl?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('rejects a file whose bytes do not match its extension', () => {
    const fake = path.join(env.dir, 'fake.png');
    fs.writeFileSync(fake, 'this is not a png at all');

    expect(() => uploadLogo(ctx, fake)).toThrow(/not a valid image/i);
    expect(fs.existsSync(brandingDir())).toBe(false);
  });

  it('rejects a truncated image', () => {
    const truncated = path.join(env.dir, 'truncated.png');
    fs.writeFileSync(truncated, PNG_BYTES.subarray(0, 4));
    expect(() => uploadLogo(ctx, truncated)).toThrow(/not a valid image/i);
  });

  it('rejects an unsupported extension and an oversized file', () => {
    const txt = path.join(env.dir, 'logo.txt');
    fs.writeFileSync(txt, 'x');
    expect(() => uploadLogo(ctx, txt)).toThrow(/PNG, JPG, WEBP or SVG/i);

    const big = path.join(env.dir, 'big.png');
    fs.writeFileSync(big, Buffer.concat([PNG_BYTES, Buffer.alloc(6 * 1024 * 1024, 0)]));
    expect(() => uploadLogo(ctx, big)).toThrow(/smaller than 5 MB/i);
  });

  it('requires the settings.manage permission', () => {
    const source = path.join(env.dir, 'logo.png');
    fs.writeFileSync(source, PNG_BYTES);
    const limited: Ctx = { ...ctx, session: { ...ctx.session, permissions: [] } };
    expect(() => uploadLogo(limited, source)).toThrow(/permission/i);
  });

  it('returns no logo data URL when the stored file has disappeared', () => {
    const source = path.join(env.dir, 'logo.png');
    fs.writeFileSync(source, PNG_BYTES);
    const rel = uploadLogo(ctx, source);
    fs.rmSync(path.join(env.paths.dataDir, rel), { force: true });

    expect(getSettings(ctx).clinic.logoDataUrl).toBeNull();
  });
});

describe('clinic branding survives backup and restore', () => {
  it('archives the branding folder and restores the logo', async () => {
    const source = path.join(env.dir, 'logo.png');
    fs.writeFileSync(source, PNG_BYTES);
    const rel = uploadLogo(ctx, source);
    saveSettings(ctx, { clinic: { clinicName: 'Rahman Dental Surgery' } as any });

    const rec = await service.runBackup(ctx, dest);
    expect(rec.status).toBe('ok');

    // The logo must be inside the archive.
    const brandingFile = path.join(env.paths.dataDir, rel);
    expect(fs.existsSync(brandingFile)).toBe(true);

    // Wipe the live branding folder, then restore: the logo must come back.
    fs.rmSync(brandingDir(), { recursive: true, force: true });
    expect(getSettings(ctx).clinic.logoDataUrl).toBeNull();

    const res = await service.restoreBackup(ctx, rec.path, 'RESTORE');
    expect(res.ok).toBe(true);
    // The restore swapped the live database handle.
    ctx = ownerCtx(env);

    expect(fs.existsSync(path.join(env.paths.dataDir, rel))).toBe(true);
    const restored = getSettings(ctx);
    expect(restored.clinic.clinicName).toBe('Rahman Dental Surgery');
    expect(restored.clinic.logoPath).toBe(rel);
    expect(restored.clinic.logoDataUrl?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('preserves the existing logo when restoring a pre-branding backup', async () => {
    // A v3.1.0-era archive contains only manifest.json + database + attachments.
    saveSettings(ctx, { clinic: { clinicName: 'Legacy Clinic' } as any });
    const rec = await service.runBackup(ctx, dest);
    expect(fs.existsSync(brandingDir())).toBe(false);

    // The clinic uploads a logo afterwards, then restores that older backup.
    const source = path.join(env.dir, 'logo.png');
    fs.writeFileSync(source, PNG_BYTES);
    const rel = uploadLogo(ctx, source);
    expect(fs.existsSync(path.join(env.paths.dataDir, rel))).toBe(true);

    const res = await service.restoreBackup(ctx, rec.path, 'RESTORE');
    expect(res.ok).toBe(true);
    ctx = ownerCtx(env);

    // The archive knows nothing about branding, so it must not delete the
    // clinic's own asset. The restored database is authoritative for settings,
    // so its (older) clinic row simply no longer references the logo.
    expect(fs.existsSync(path.join(env.paths.dataDir, rel))).toBe(true);
    const restored = getSettings(ctx);
    expect(restored.clinic.clinicName).toBe('Legacy Clinic');
    expect(restored.clinic.logoDataUrl).toBeNull();
  });
});
