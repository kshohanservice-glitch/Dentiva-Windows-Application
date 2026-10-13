#!/usr/bin/env node
/**
 * Regenerates tests/fixtures/v3.0.3/dentiva-v3.0.3.db.
 *
 * The fixture is produced by the REAL v3.0.3 database code (src/main/db at the
 * baseline commit, migrations 001 + 002 only), then seeded with representative
 * legacy rows: patients, appointments (including legacy statuses), queue entries,
 * an invoice and a payment. It contains a placeholder user with no usable
 * credential. Synthetic data only.
 *
 * Usage: node scripts/build-v303-fixture.mjs
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE = '705a30a161c52e2a51f5a644102589d0788b664f'; // tag v3.0.3
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests/fixtures/v3.0.3');
const outFile = path.join(outDir, 'dentiva-v3.0.3.db');
// Build inside the repo so Node resolves better-sqlite3 from the repo's node_modules.
const work = path.join(outDir, '.build');

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
try {
  execFileSync('bash', ['-c', `git archive ${BASELINE} src/main/db src/main/errors.ts src/shared | tar -x -C "${work}"`], { cwd: root, stdio: 'inherit' });
  execFileSync(
    path.join(root, 'node_modules/.bin/esbuild'),
    [path.join(work, 'src/main/db/database.ts'), '--bundle', '--platform=node', '--format=cjs',
      '--external:better-sqlite3', `--outfile=${path.join(work, 'database.cjs')}`, '--log-level=warning'],
    { cwd: root, stdio: 'inherit' },
  );
  const req = createRequire(path.join(work, 'database.cjs'));
  const { openDatabase } = req(path.join(work, 'database.cjs'));

  const dbPath = path.join(work, 'fixture.db');
  const { db, schemaVersion } = openDatabase(dbPath, { runMigrations: true });
  if (schemaVersion !== 2) throw new Error(`expected v3.0.3 schema (user_version 2), got ${schemaVersion}`);

  const now = '2026-09-27T09:00:00.000Z';
  const roleId = (db.prepare('SELECT id FROM roles ORDER BY id LIMIT 1').get()).id;
  const userId = Number(db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role_id, status, created_at, updated_at)
     VALUES ('fixture-owner', 'Fixture Owner', 'FIXTURE-NOT-A-CREDENTIAL', ?, 'active', ?, ?)`,
  ).run(roleId, now, now).lastInsertRowid);
  const dentistId = Number(db.prepare(
    `INSERT INTO dentists (name, active, created_at, updated_at) VALUES ('Dr Fixture', 1, ?, ?)`,
  ).run(now, now).lastInsertRowid);
  const p1 = Number(db.prepare(
    `INSERT INTO patients (code, name, age_years, gender, phone, registration_date, created_at, updated_at)
     VALUES ('P-0001', 'Fixture Patient One', 34, 'female', '01700000001', '2026-08-01', ?, ?)`,
  ).run(now, now).lastInsertRowid);
  const p2 = Number(db.prepare(
    `INSERT INTO patients (code, name, age_years, gender, phone, registration_date, created_at, updated_at)
     VALUES ('P-0002', 'Fixture Patient Two', 61, 'male', '01700000002', '2026-08-02', ?, ?)`,
  ).run(now, now).lastInsertRowid);

  const appt = db.prepare(
    `INSERT INTO appointments (patient_id, dentist_id, date, time, duration_min, type, status, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 30, ?, ?, ?, ?, ?, ?)`,
  );
  const a1 = Number(appt.run(p1, dentistId, '2026-09-28', '10:00', 'Check-up', 'completed', null, userId, now, now).lastInsertRowid);
  const a2 = Number(appt.run(p2, dentistId, '2026-09-29', '11:00', 'Extraction', 'arrived', 'legacy arrival', userId, now, now).lastInsertRowid);
  appt.run(p1, dentistId, '2026-10-20', '09:30', 'Consultation', 'scheduled', null, userId, now, now);
  appt.run(p2, null, '2026-09-30', '15:00', 'Follow-up', 'no_show', null, userId, now, now);

  const q = db.prepare(
    `INSERT INTO queue_entries (day, queue_no, patient_id, appointment_id, dentist_id, arrived_at, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  q.run('2026-09-28', 1, p1, a1, dentistId, '2026-09-28T10:05:00.000Z', 'completed', userId);
  q.run('2026-09-29', 1, p2, a2, dentistId, '2026-09-29T11:02:00.000Z', 'in_treatment', userId);

  const invoiceId = Number(db.prepare(
    `INSERT INTO invoices (number, patient_id, date, status, subtotal_paisa, discount_paisa, total_paisa, created_by, created_at)
     VALUES ('INV-2026-0001', ?, '2026-09-28', 'paid', 150000, 0, 150000, ?, ?)`,
  ).run(p1, userId, now).lastInsertRowid);
  db.prepare(
    `INSERT INTO invoice_items (invoice_id, description, qty, unit_price_paisa, discount_paisa, total_paisa)
     VALUES (?, 'Scaling & Polishing', 1, 150000, 0, 150000)`,
  ).run(invoiceId);
  db.prepare(
    `INSERT INTO payments (invoice_id, patient_id, amount_paisa, method, type, received_by, paid_at, created_at)
     VALUES (?, ?, 150000, 'cash', 'payment', ?, ?, ?)`,
  ).run(invoiceId, p1, userId, '2026-09-28T10:30:00.000Z', now);

  // Make the file self-contained (no -wal/-shm sidecars) before copying it out.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.close();

  fs.copyFileSync(dbPath, outFile);
  console.log(`wrote ${path.relative(root, outFile)} (${fs.statSync(outFile).size} bytes)`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
