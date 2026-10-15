#!/usr/bin/env node
/**
 * Regenerates tests/fixtures/v4.2.2/dentiva-v4.2.2.db.
 *
 * The fixture is produced by the REAL v4.2.2 database code (src/main/db at the
 * released tag, migrations 001–007 → user_version 7), then seeded with
 * representative rows that a clinic of that version would have: a dentist, two
 * patients, appointments, a visit with a procedure, a prescription whose
 * medicine carries the v4.2.2 `medicine_instruction` field, an invoice with two
 * items and a payment, and the historic print profiles (A4 + A5 + 80mm thermal)
 * plus one hand-added custom profile with an explicit millimetre size.
 *
 * It exists so `tests/integration/migration-v422.test.ts` can prove the 4.3.0
 * upgrade on a database that was really written by the published version —
 * including the A4-only print-profile rewrite. Synthetic data only; the user row
 * has no usable credential.
 *
 * Usage: node scripts/build-v422-fixture.mjs
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE = 'aa90da02a40afd35693f8d3c360caf14405c8ffe'; // tag v4.2.2
const FROZEN_NOW = '2026-10-10T09:00:00.000Z';
// The migration code stamps its audit rows with `new Date()`. Freezing the clock
// before the old code runs keeps the fixture byte-reproducible, so a rebuild can
// be compared with the committed file.
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FROZEN_NOW);
    else super(...args);
  }
  static now() { return RealDate.parse(FROZEN_NOW); }
}
globalThis.Date = FrozenDate;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests/fixtures/v4.2.2');
const outFile = path.join(outDir, 'dentiva-v4.2.2.db');
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
  if (schemaVersion !== 7) throw new Error(`expected v4.2.2 schema (user_version 7), got ${schemaVersion}`);

  const now = FROZEN_NOW;
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
  const a1 = Number(appt.run(p1, dentistId, '2026-10-09', '10:00', 'Check-up', 'completed', null, userId, now, now).lastInsertRowid);
  appt.run(p2, dentistId, '2026-10-12', '11:00', 'Extraction', 'scheduled', null, userId, now, now);

  const visitId = Number(db.prepare(
    `INSERT INTO visits (patient_id, dentist_id, datetime, chief_complaint, examination, diagnosis, advice, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'Pain in the lower right back tooth', 'Deep caries 46', 'Irreversible pulpitis 46', 'Avoid hard food', 'closed', ?, ?, ?)`,
  ).run(p1, dentistId, '2026-10-09T10:05:00.000Z', userId, now, now).lastInsertRowid);
  db.prepare(
    `INSERT INTO visit_treatments (visit_id, description, qty, unit_price_paisa, total_paisa)
     VALUES (?, 'Root canal treatment 46', 1, 1250000, 1250000)`,
  ).run(visitId);

  const rxId = Number(db.prepare(
    `INSERT INTO prescriptions (number, patient_id, visit_id, dentist_id, date, c_c, o_e, diagnosis, advice, created_by, created_at)
     VALUES ('RX-2026-0001', ?, ?, ?, '2026-10-09', 'Pain in the lower right back tooth', 'Deep caries 46', 'Irreversible pulpitis 46', 'Soft diet for 48 hours', ?, ?)`,
  ).run(p1, visitId, dentistId, userId, now).lastInsertRowid);
  const rxItem = db.prepare(
    `INSERT INTO prescription_items (prescription_id, seq, medicine_name, strength, form, dosage, frequency, timing, duration, qty, instruction, medicine_instruction)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  rxItem.run(rxId, 1, 'Amoxicillin', '500mg', 'Capsule', '1 capsule', '3 times daily', 'after', '5 days', '15', 'After food', 'Take after meals with water.');
  rxItem.run(rxId, 2, 'Ibuprofen', '400mg', 'Tablet', '1 tablet', 'Twice daily', 'after', '3 days', '6', 'Only if pain', null);

  const invoiceId = Number(db.prepare(
    `INSERT INTO invoices (number, patient_id, visit_id, date, status, subtotal_paisa, discount_paisa, total_paisa, created_by, created_at)
     VALUES ('INV-2026-0001', ?, ?, '2026-10-09', 'paid', 1350000, 50000, 1300000, ?, ?)`,
  ).run(p1, visitId, userId, now).lastInsertRowid);
  const item = db.prepare(
    `INSERT INTO invoice_items (invoice_id, description, qty, unit_price_paisa, discount_paisa, total_paisa)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  item.run(invoiceId, 'Root canal treatment 46', 1, 1250000, 0, 1250000);
  item.run(invoiceId, 'Consultation', 1, 100000, 50000, 50000);
  db.prepare(
    `INSERT INTO payments (invoice_id, patient_id, amount_paisa, method, type, received_by, paid_at, created_at)
     VALUES (?, ?, 1300000, 'cash', 'payment', ?, '2026-10-09T11:30:00.000Z', ?)`,
  ).run(invoiceId, p1, userId, now);

  // A clinic of this version could add its own profile with explicit millimetres.
  const stored = JSON.parse(db.prepare("SELECT value_json FROM settings WHERE key = 'printProfiles'").get().value_json);
  stored.push({
    id: 'rx-custom', name: 'Prescription custom 148mm', documentType: 'prescription', printerName: '',
    paperSize: 'custom', widthMm: 148, heightMm: 210, orientation: 'landscape',
    margins: { top: 5, right: 5, bottom: 5, left: 5 }, scale: 90, copies: 2,
  });
  db.prepare("UPDATE settings SET value_json = ?, updated_at = ? WHERE key = 'printProfiles'")
    .run(JSON.stringify(stored), now);

  // Make the file self-contained (no -wal/-shm sidecars) before copying it out.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.close();

  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(dbPath, outFile);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
  console.log(`wrote ${path.relative(root, outFile)} (${fs.statSync(outFile).size} bytes, sha256 ${digest})`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
