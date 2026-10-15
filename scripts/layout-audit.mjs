/**
 * Dentiva Pro — responsive layout audit harness (developer/QA tool).
 *
 * Renders the REAL built renderer (`dist/renderer`, produced by
 * `npm run build:renderer`) in a headless Chromium and measures rendered
 * geometry at several viewport sizes. The preload bridge is replaced by a
 * synthetic, in-page stub so no database, no patient record and no clinic data
 * are involved: the goal is layout verification only.
 *
 * The authoritative automated gate for the responsive layout is the Playwright
 * Electron E2E suite (tests/e2e/responsive-layout.spec.ts) which runs against
 * the real application window in CI on Windows. This script exists for fast
 * local iteration and for producing screenshots/measurements on a machine that
 * has a Chromium binary available.
 *
 * Usage:
 *   npm run build:renderer
 *   node scripts/layout-audit.mjs [--only <route>] [--screens] [--json <file>]
 *
 * Browser selection:
 *   LAYOUT_BROWSER      path to a Chromium/Chrome executable (optional;
 *                       Playwright's own browser is used when unset)
 *   LAYOUT_BROWSER_LIBS extra LD_LIBRARY_PATH for that executable (optional)
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER_DIR = path.join(ROOT, 'dist', 'renderer');
const SCREEN_DIR = path.join(ROOT, 'layout-audit');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ONLY = value('--only');

const EXPLAIN = flag('--explain');
const EXPLAIN_VIEWPORT = value('--viewport', '480x800');
const EXPLAIN_SCENARIO = value('--scenario');
/** Extra audit sizes may be passed as bare `WxH` arguments. */
const EXTRA_SIZES = args.filter((a) => /^\d+x\d+$/.test(a)).map((a) => {
  const [width, height] = a.split('x').map(Number);
  return { name: a, width, height };
});
const SCREENS = flag('--screens');
const JSON_OUT = value('--json');

/** Viewport sizes requested by the audit brief. */
const VIEWPORTS = [
  ...EXTRA_SIZES,
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '800x600', width: 800, height: 600 },
  { name: '680x900', width: 680, height: 900 },
  { name: '480x800', width: 480, height: 800 },
];

/** Screens audited. Every route is rendered inside the real app shell. */
const ROUTES = [
  { key: 'dashboard', hash: '#/', label: 'Dashboard' },
  { key: 'patients', hash: '#/patients', label: 'Patients' },
  { key: 'appointments', hash: '#/appointments', label: 'Appointments' },
  { key: 'quick-documents', hash: '#/quick-documents', label: 'Walk-in / Quick Documents' },
  { key: 'treatments', hash: '#/treatments', label: 'Treatments' },
  { key: 'prescriptions', hash: '#/prescriptions', label: 'Prescriptions' },
  { key: 'invoices', hash: '#/invoices', label: 'Invoices' },
  { key: 'payments', hash: '#/payments', label: 'Payments' },
  { key: 'inventory', hash: '#/inventory', label: 'Inventory' },
  { key: 'accounting', hash: '#/accounting', label: 'Accounting' },
  { key: 'staff', hash: '#/staff', label: 'Staff' },
  { key: 'users', hash: '#/users', label: 'Users & Roles' },
  { key: 'reports', hash: '#/reports', label: 'Reports' },
  { key: 'settings', hash: '#/settings', label: 'Settings' },
  { key: 'backup', hash: '#/backup', label: 'Backup & Restore' },
  { key: 'audit', hash: '#/audit', label: 'Audit log' },
  { key: 'about', hash: '#/about', label: 'About' },
  { key: 'patient-profile', hash: '#/patients/1', label: 'Patient profile (chart, tabs, tables)' },
  { key: 'print-preview', hash: '#/print/invoice/1', label: 'Print preview (document window)' },
];

/* ------------------------------------------------------------------ data */

/** All permission keys, read from the shared catalog so the stub stays in sync. */
function allPermissions() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'permissions.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const ALL_PERMISSIONS'), src.indexOf('] as const', src.indexOf('export const ALL_PERMISSIONS')));
  return [...block.matchAll(/'([a-z][a-z0-9.]*[a-z0-9])'/g)].map((m) => m[1]);
}

const today = new Date().toISOString().slice(0, 10);

const clinics = {
  clinicName: 'Synthetic Layout Clinic',
  clinicNameBn: 'সিন্থেটিক ক্লিনিক',
  logoPath: null,
  logoDataUrl: null,
  address: '12 Example Road, Dhaka',
  phone: '01710000000',
  email: 'clinic@example.test',
  website: null,
  operatingHours: '10:00–20:00',
  visitingDays: 'Sat–Thu',
  currency: 'BDT',
};

const settings = {
  clinic: clinics,
  prescription: {
    footerMessage: 'Synthetic fixture for layout checks.', visitingHours: '10:00–20:00',
    labels: { cc: 'C/C', oe: 'O/E', re: 'R/E', diagnosis: 'Diagnosis', treatment: 'Treatment', advice: 'Advice', followUp: 'Follow-up' },
    signatureReserved: true,
  },
  invoice: { nextNumber: 'INV-000123', footerNote: 'Thank you.' },
  security: { autoLockMinutes: 15, minPasswordLength: 8, maxFailedLogins: 5 },
  backup: { autoFrequencyDays: 7, destination: null, retention: 10 },
  appearance: { theme: 'light', density: 'comfortable', animations: true, sidebarCollapsed: false },
  notifications: { appointments: true, lowStock: true, dues: true, backup: true },
  whatsapp: { timezone: 'Asia/Dhaka', greetingRanges: [] },
  paymentMethods: ['Cash', 'bKash', 'Card'],
  expenseCategories: ['Rent', 'Supplies'],
  printProfiles: [],
  documentStyles: {},
  documentWatermark: { enabled: false, opacity: 0.08, scalePercent: 40, position: 'center', onDocuments: 'all' },
};

const treatments = [
  { id: 1, name: 'Consultation', defaultPricePaisa: 50000, active: true, description: null, durationMin: 15 },
  { id: 2, name: 'Scaling and polishing (upper + lower arch)', defaultPricePaisa: 250000, active: true, description: null, durationMin: 30 },
  { id: 3, name: 'Root canal treatment — molar, single visit with rotary instrumentation', defaultPricePaisa: 1250000, active: true, description: null, durationMin: 60 },
  { id: 4, name: 'Extraction', defaultPricePaisa: 120000, active: true, description: null, durationMin: 30 },
  { id: 5, name: 'Artificial crown — zirconia', defaultPricePaisa: 875000, active: true, description: null, durationMin: 45 },
  { id: 6, name: 'Composite filling (anterior)', defaultPricePaisa: 300000, active: true, description: null, durationMin: 30 },
];

const dentists = [
  { id: 1, name: 'Dr. Synthetic Dentist One', phone: '01710000001', email: null, specialty: 'Endodontics', active: true, commissionPercent: 0 },
  { id: 2, name: 'Dr. Synthetic Dentist Two', phone: '01710000002', email: null, specialty: 'Orthodontics', active: true, commissionPercent: 0 },
];

const patients = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  code: `P-${String(i + 1).padStart(4, '0')}`,
  name: `Synthetic Patient ${i + 1}`,
  bengaliName: i % 2 ? 'সিন্থেটিক রোগী' : null,
  dob: null, ageYears: 30 + i, ageText: null, gender: i % 2 ? 'female' : 'male',
  bloodGroup: 'O+', phone: '01711000000', phone2: null, whatsappNumber: null, whatsappSameAsPhone: true,
  whatsappConsent: 'unknown', whatsappConsentAt: null, emergencyContact: null, emergencyPhone: null,
  address: 'Example address, Dhaka', city: 'Dhaka', chiefComplaint: 'Synthetic complaint', referredBy: null,
  preferredDentistId: 1, status: 'active', tags: ['synthetic'], registrationDate: today,
  createdAt: `${today}T09:00:00.000Z`, updatedAt: `${today}T09:00:00.000Z`, lastVisitAt: null, visitCount: i,
}));

const invoices = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  number: `INV-${String(100 + i)}`,
  patientId: patients[i].id,
  patientName: patients[i].name,
  patientCode: patients[i].code,
  date: today,
  subtotalPaisa: 1250000 + i * 250000,
  discountPaisa: 50000,
  totalPaisa: 1200000 + i * 250000,
  paidPaisa: i % 2 ? 1200000 + i * 250000 : 0,
  duePaisa: i % 2 ? 0 : 1200000 + i * 250000,
  status: i % 2 ? 'paid' : 'unpaid',
  note: null,
  createdAt: `${today}T09:00:00.000Z`,
  voidedAt: null,
  voidReason: null,
  items: [
    {
      id: 1, description: 'Root canal treatment — molar, single visit with rotary instrumentation',
      qty: 1, unitPricePaisa: 1250000, discountPaisa: 0, treatmentId: 3,
    },
  ],
}));

const appointments = [
  {
    id: 1, patientId: 1, patientName: 'Synthetic Patient 1', patientCode: 'P-0001',
    dentistId: 1, dentistName: dentists[0].name, date: today, time: '10:00', durationMin: 30,
    status: 'scheduled', type: 'Consultation', purpose: 'Synthetic purpose text', notes: null, plannedTreatments: null,
  },
  {
    id: 2, patientId: 2, patientName: 'Synthetic Patient 2', patientCode: 'P-0002',
    dentistId: 2, dentistName: dentists[1].name, date: today, time: '11:30', durationMin: 45,
    status: 'completed', type: 'Scaling', purpose: null, notes: null, plannedTreatments: null,
  },
];

const inventoryItems = [
  { id: 1, code: 'GLV-01', name: 'Nitrile examination gloves (medium)', categoryName: 'Consumables', unit: 'box', minLevel: 5, location: 'Store A', active: true, qtyAvailable: 3, lowStock: true, nearestExpiry: '2027-01-31' },
  { id: 2, code: 'ANE-02', name: 'Lignocaine 2% with adrenaline 1:80,000 cartridge', categoryName: 'Anaesthetics', unit: 'carton', minLevel: 4, location: 'Store B', active: true, qtyAvailable: 28, lowStock: false, nearestExpiry: '2026-12-01' },
];

const inventoryBatches = [
  { id: 1, itemId: 1, itemName: inventoryItems[0].name, batchNo: 'B-2291', expiryDate: '2027-01-31', qtyInitial: 10, qtyAvailable: 3, purchasePricePaisa: 85000, supplierName: 'Synthetic Supplies Ltd.', purchasedAt: today, expired: false, nearExpiry: false },
];

const suppliers = [{ id: 1, name: 'Synthetic Supplies Ltd.', phone: '01800000000', address: 'Synthetic industrial area', active: true }];

const categories = [
  { id: 1, name: 'Rent', kind: 'expense' }, { id: 2, name: 'Supplies', kind: 'expense' },
  { id: 3, name: 'Treatment', kind: 'income' }, { id: 4, name: 'Consultation', kind: 'income' },
];

const dashboard = {
  todayPatients: 9, todayAppointments: appointments.length, completedVisits: 4, noShows: 1,
  recentPatients: patients.slice(0, 6).map((p) => ({ id: p.id, name: p.name, code: p.code, at: `${today}T09:00:00.000Z` })),
  upcomingAppointments: appointments,
  financial: {
    todayRevenuePaisa: 4250000,
    outstandingDuePaisa: 12450000,
    recentPayments: [],
    outstandingInvoices: [
      { id: 9, number: 'INV-000090', patientName: 'Synthetic Patient 9', duePaisa: 8750000, date: today },
    ],
    dentistWorkload: [{ name: dentists[0].name, count: 12 }, { name: dentists[1].name, count: 7 }],
    treatmentStats: [{ name: 'Scaling', count: 22 }],
  },
  inventory: { lowStock: 4, expiringSoon: 2, expired: 0 },
  alerts: [],
};

function paged(items, payload) {
  const pageSize = payload && payload.pageSize ? payload.pageSize : 25;
  return { items, total: items.length, page: payload && payload.page ? payload.page : 1, pageSize };
}

/** Canonical (package.json) version, so the About screen matches reality. */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/**
 * Synthetic bridge. Unknown channels resolve to an empty page so a new screen
 * degrades to an empty state instead of a crash.
 */
function createBridgeSource(permissions) {
  const session = {
    userId: 1, username: 'synthetic.owner', displayName: 'Synthetic Owner', roleName: 'Owner',
    roleKey: 'owner', staffId: null, permissions,
  };
  return `
    const SESSION = ${JSON.stringify(session)};
    const SETTINGS = ${JSON.stringify(settings)};
    const VERSION = ${JSON.stringify(pkg.version)};
    const TODAY = ${JSON.stringify(today)};
    const PATIENTS = ${JSON.stringify(patients)};
    const INVOICES = ${JSON.stringify(invoices)};
    const TREATMENTS = ${JSON.stringify(treatments)};
    const DENTISTS = ${JSON.stringify(dentists)};
    const DASHBOARD = ${JSON.stringify(dashboard)};
    const APPOINTMENTS = ${JSON.stringify(appointments)};
    const ITEMS = ${JSON.stringify(inventoryItems)};
    const BATCHES = ${JSON.stringify(inventoryBatches)};
    const SUPPLIERS = ${JSON.stringify(suppliers)};
    const CATEGORIES = ${JSON.stringify(categories)};

    const emptyPage = (payload) => ({ items: [], total: 0, page: 1, pageSize: payload && payload.pageSize ? payload.pageSize : 25 });
    const handlers = {
      'dashboard/get': () => DASHBOARD,
      'system/info': () => ({ version: VERSION, schemaVersion: 7, dataDir: 'C:\\\\Dentiva', platform: 'win32', demo: false }),
      'system/activity': () => null,
      'system/lock': () => null,
      'activation/status': () => ({ activated: true, activatedAt: TODAY, code: 'SYNTHETIC' }),
      'setup/status': () => ({ needsSetup: false }),
      'auth/session': () => SESSION,
      'auth/login': () => ({ ok: false, reason: 'bad_credentials' }),
      'auth/logout': () => null,
      'settings/get': () => SETTINGS,
      'settings/save': () => SETTINGS,
      'patients/list': (p) => ({ items: PATIENTS, total: PATIENTS.length, page: 1, pageSize: (p && p.pageSize) || 25 }),
      'patients/get': (id) => ({ ...PATIENTS[0], id, previousProblems: null, allergies: 'Penicillin', medications: null, medicalHistory: null, dentalHistory: null, notes: null, preferredDentistName: DENTISTS[0].name }),
      'patients/timeline': () => [],
      'patients/duplicates': () => [],
      'patients/export': () => ({ path: 'C:\\\\tmp\\\\patients.csv', count: PATIENTS.length }),
      'visits/list': () => [],
      'visits/get': () => null,
      'chart/get': () => ({ teeth: {}, updatedAt: TODAY }),
      'treatments/list': () => TREATMENTS,
      'dentists/list': () => DENTISTS,
      'appointments/list': () => emptyPage(),
      'appointments/agenda': () => APPOINTMENTS,
      'appointments/get': (id) => APPOINTMENTS.find((a) => a.id === id) || APPOINTMENTS[0],
      'invoices/list': (p) => ({ items: INVOICES, total: INVOICES.length, page: 1, pageSize: (p && p.pageSize) || 25 }),
      'invoices/get': (id) => INVOICES.find((inv) => inv.id === id) || INVOICES[0],
      'payments/list': (p) => paged(INVOICES.filter((i) => i.paidPaisa > 0).map((i) => ({
        id: i.id, invoiceId: i.id, number: i.number, patientId: i.patientId, patientName: i.patientName,
        amountPaisa: i.paidPaisa, type: 'payment', method: 'Cash', reference: null, note: null,
        paidAt: TODAY + 'T10:00:00.000Z', receivedByName: 'Synthetic Owner',
      })), p),
      'inventory/items': () => ITEMS,
      'inventory/batches': () => BATCHES,
      'inventory/suppliers': () => SUPPLIERS,
      'inventory/stock': () => ({ item: ITEMS[0], batches: BATCHES }),
      'accounting/expenses': () => emptyPage(),
      'accounting/incomes': () => emptyPage(),
      'accounting/categories': () => CATEGORIES,
      'accounting/summary': () => ({ incomePaisa: 0, expensePaisa: 0, netPaisa: 0, salariesPaisa: 0, salaries: [] }),
      'staff/list': () => [],
      'users/list': () => [],
      'roles/list': () => [],
      'reports/run': () => ({ title: 'Synthetic report', scope: '', columns: [{ key: 'a', label: 'Label' }], rows: [], generatedAt: TODAY + 'T10:00:00.000Z' }),
      'audit/list': () => emptyPage(),
      'backups/list': () => [],
      'notifications/list': () => [],
      'search/query': () => [],
      'prescriptions/list': () => emptyPage(),
      'referrals/list': () => [],
      'appointments/upcoming': () => DASHBOARD.upcomingAppointments,
      'backup/list': () => [],
      'backups': () => [],
      'prescriptions/templates': () => [],
      'clinical-templates/list': () => [],
      'quick-documents/prepare': () => ({ ok: true }),
      'documents/preview': () => ({ ok: true }),
    };

    const call = (channel, payload) => {
      const handler = handlers[channel];
      if (!handler) return emptyPage(payload);
      return handler(payload);
    };

    window.dentiva = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'onLock' || prop === 'onSessionExpired') return () => () => {};
        if (typeof prop !== 'string') return undefined;
        return (payload) => Promise.resolve().then(() => call(prop, payload));
      },
    });
    window.__LAYOUT_AUDIT__ = { synthetic: true, version: VERSION };
  `;
}

/* -------------------------------------------------------------- in-page probe */

/** Measures horizontal overflow / clipping inside the shell for the current page. */
const PROBE = `(() => {
  const de = document.documentElement;
  const main = document.querySelector('.main') || de;
  const page = document.querySelector('.main .page') || main;
  const rect = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const r = rect(el);
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return true;
  };
  const label = (el) => {
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
    const name = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name'));
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (name ? '[' + name + ']' : '');
  };
  const hasScrollableAncestor = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
      p = p.parentElement;
    }
    return false;
  };
  const pageRect = rect(page);
  const spills = [];
  const clipped = [];
  const overflowingControls = '.field, input, select, textarea, .input, .btn, button, .quick-line-grid, .invoice-line, .medicine-entry-grid';
  for (const el of page.querySelectorAll('*')) {
    if (!visible(el)) continue;
    if (el.closest('.modal-backdrop, .toast-stack, .doc-preview-frame, .popover, .tooltip')) continue;
    const r = rect(el);
    if (el.matches(overflowingControls) && el.parentElement) {
      const parent = el.parentElement;
      const pr = rect(parent);
      const parentOverflow = getComputedStyle(parent).overflowX;
      const overRight = r.right - pr.right;
      const overLeft = pr.left - r.left;
      if (parentOverflow !== 'auto' && parentOverflow !== 'scroll' && (overRight > 1.5 || overLeft > 1.5)) {
        spills.push({ el: label(el), over: Math.round(Math.max(overRight, overLeft)), w: Math.round(r.width) });
      }
    }
    if (!hasScrollableAncestor(el)) {
      const overRight = r.right - pageRect.right;
      const overLeft = pageRect.left - r.left;
      if (overRight > 1.5 || overLeft > 1.5) {
        spills.push({ el: label(el), over: Math.round(Math.max(overRight, overLeft)), w: Math.round(r.width) });
      }
    }
    const cs = getComputedStyle(el);
    const ox = cs.overflowX;
    if ((ox === 'hidden' || ox === 'clip') && cs.textOverflow !== 'ellipsis' && !el.classList.contains('truncate')) {
      const hidden = el.scrollWidth - el.clientWidth;
      if (hidden > 2) clipped.push({ el: label(el), hidden: Math.round(hidden), w: Math.round(r.width) });
    }
  }
  const top = (arr) => arr.sort((a, b) => (b.over || b.hidden) - (a.over || a.hidden)).slice(0, 6);
  return {
    docOverflow: de.scrollWidth - de.clientWidth,
    mainOverflow: main.scrollWidth - main.clientWidth,
    pageWidth: Math.round(pageRect.width),
    spills: top(spills),
    spilled: spills.length,
    clipped: top(clipped),
    clippedCount: clipped.length,
  };
})()`;

/** Geometry of the walk-in invoice line grid: which fields share the first row. */
const INVOICE_PROBE = `(() => {
  const cards = [...document.querySelectorAll('.quick-line-card')];
  if (!cards.length) return { found: false };
  const readField = (card, fieldName) => {
    const fields = [...card.querySelectorAll('.quick-line-grid > .field')];
    const field = fields.find((f) => {
      const el = f.querySelector('label, .field-label');
      return el && el.textContent.replace(/\\s+/g, ' ').trim().toLowerCase().startsWith(fieldName);
    });
    if (!field) return null;
    const box = field.getBoundingClientRect();
    const control = field.querySelector('input, .input');
    return {
      label: (field.querySelector('label, .field-label') || {}).textContent.replace(/\\s+/g, ' ').trim(),
      left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom),
      width: Math.round(box.width), inputWidth: control ? Math.round(control.getBoundingClientRect().width) : null,
    };
  };
  const card = cards[0];
  const grid = card.querySelector('.quick-line-grid');
  const gridRect = grid.getBoundingClientRect();
  const fields = ['item or procedure', 'qty', 'unit price', 'discount', 'line total'].map((k) => readField(card, k));
  const remove = [...card.querySelectorAll('button')].find((b) => /remove/i.test(b.textContent || b.getAttribute('aria-label') || ''));
  const removeRect = remove ? remove.getBoundingClientRect() : null;
  const cardRect = card.getBoundingClientRect();
  const rows = new Map();
  for (const f of fields) {
    if (!f) continue;
    const key = Math.round(f.top / 4) * 4;
    rows.set(key, [...(rows.get(key) || []), f.label]);
  }
  return {
    found: true,
    gridWidth: Math.round(gridRect.width),
    gridScroll: grid.scrollWidth - grid.clientWidth,
    cardWidth: Math.round(cardRect.width),
    rows: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([top, labels]) => ({ top, labels })),
    fields,
    remove: removeRect ? {
      text: (remove.textContent || '').trim(),
      visible: removeRect.width > 0 && removeRect.height > 0 && removeRect.right <= cardRect.right + 1,
      top: Math.round(removeRect.top), bottom: Math.round(removeRect.bottom),
      width: Math.round(removeRect.width),
    } : null,
    lineTops: fields.map((f) => (f ? f.top : null)),
    cardOverflow: card.scrollWidth - card.clientWidth,
  };
})()`;

/** Geometry probe for a dialog/panel: its own grid fit and its field rows. */
const BOX_PROBE = (selector) => {
  const host = document.querySelector(selector);
  if (!host) return { missing: selector };
  const rect = (el) => el.getBoundingClientRect();
  const box = rect(host);
  const rows = new Map();
  const fields = [];
  for (const field of host.querySelectorAll(':scope > .field, :scope > .row')) {
    const r = rect(field);
    const labelEl = field.querySelector('label, .field-label');
    const control = field.querySelector('input, select, textarea, .input, button');
    const name = (labelEl && labelEl.textContent.replace(/\s+/g, ' ').trim()) || (field.className || 'row');
    const key = Math.round(r.top / 4) * 4;
    rows.set(key, [...(rows.get(key) || []), name]);
    fields.push({
      label: name.slice(0, 44), width: Math.round(r.width), top: Math.round(r.top), right: Math.round(r.right),
      inputWidth: control ? Math.round(rect(control).width) : null,
      overhang: Math.round(r.right - box.right),
    });
  }
  const fieldsBeyond = fields.filter((f) => Math.abs(f.top - Math.round(box.top)) < 100000 && f.right > box.right + 1.5).length;
  return {
    selector,
    hostWidth: Math.round(box.width),
    hostScroll: host.scrollWidth - host.clientWidth,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([top, labels]) => ({ top, labels })),
    fields,
    fieldsBeyond,
    spills: fields.filter((f) => f.overhang > 1.5).map((f) => `${f.label}+${f.overhang}`),
  };
};

/** Scenarios that open dialogs/tabs so their layout is measured too. */
const SCENARIOS = {
  'quick-documents': [
    {
      key: 'prescription-tab',
      selector: '.medicine-entry-grid',
      run: async (page) => {
        await page.getByRole('tab', { name: /Quick prescription/i }).click({ timeout: 8000 });
        await page.waitForTimeout(200);
        const add = page.getByRole('button', { name: '+ Add medicine' });
        if (await add.count()) await add.click({ timeout: 8000 });
      },
    },
    {
      key: 'visit-tab',
      selector: '.quick-procedure-grid, .quick-procedure-empty',
      run: async (page) => {
        await page.getByRole('tab', { name: /Quick examination report/i }).click({ timeout: 8000 });
        const add = page.getByRole('button', { name: '+ Add procedure' });
        if (await add.count()) await add.click({ timeout: 8000 });
      },
    },
  ],
  invoices: [
    {
      key: 'new-invoice-modal',
      selector: '.invoice-line',
      run: async (page) => {
        await page.getByRole('button', { name: 'New invoice' }).first().click({ timeout: 8000 });
        await page.waitForSelector('.modal[role="dialog"]', { timeout: 10000 });
        const addLine = page.getByRole('button', { name: '+ Add line' });
        if (await addLine.count()) await addLine.click({ timeout: 8000 });
      },
    },
  ],
  patients: [
    {
      key: 'register-modal',
      selector: '.modal .form-grid',
      run: async (page) => {
        await page.getByRole('button', { name: 'Register patient' }).first().click({ timeout: 8000 });
        await page.waitForSelector('.modal[role="dialog"]', { timeout: 10000 });
      },
    },
  ],
  settings: [
    {
      key: 'customize-documents',
      selector: '.customize-grid',
      run: async (page) => {
        await page.getByRole('tab', { name: /Customize/i }).click({ timeout: 8000 });
        await page.waitForSelector('.customize-grid', { timeout: 10000 });
      },
    },
  ],
};

/** Walks the page and explains the widest offenders: what is forcing width. */
const EXPLAIN_PROBE = `(() => {
  const main = document.querySelector('.main');
  if (!main) return { error: 'no .main' };
  const mainRect = main.getBoundingClientRect();
  const path = (el) => {
    const parts = [];
    let node = el;
    while (node && node !== main.parentElement && parts.length < 6) {
      const cls = (node.className && typeof node.className === 'string') ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      parts.unshift(node.tagName.toLowerCase() + cls);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const offenders = [];
  for (const el of main.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0) continue;
    const cs = getComputedStyle(el);
    const overflowRight = Math.round(r.right - mainRect.right);
    const scrollOver = el.scrollWidth - el.clientWidth;
    const minContent = el.scrollWidth;
    const parent = el.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : null;
    const widerThanParent = parentRect ? Math.round(r.width - parentRect.width) : 0;
    if (overflowRight > 1.5 || (scrollOver > 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') || widerThanParent > 1.5) {
      offenders.push({
        el: path(el), w: Math.round(r.width), right: Math.round(r.right),
        overflowRight, scrollOver, widerThanParent,
        display: cs.display, columns: cs.gridTemplateColumns, minWidth: cs.minWidth, overflowX: cs.overflowX,
      });
    }
  }
  offenders.sort((a, b) => Math.max(b.overflowRight, b.scrollOver, b.widerThanParent) - Math.max(a.overflowRight, a.scrollOver, a.widerThanParent));
  return { mainWidth: Math.round(mainRect.width), mainScroll: main.scrollWidth - main.clientWidth, offenders: offenders.slice(0, 14) };
})()`;

/* ------------------------------------------------------------------- server */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveRenderer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.join(RENDERER_DIR, rel);
    if (!file.startsWith(RENDERER_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/* --------------------------------------------------------------------- main */

async function main() {
  if (!fs.existsSync(path.join(RENDERER_DIR, 'index.html'))) {
    console.error('dist/renderer/index.html is missing — run `npm run build:renderer` first.');
    process.exit(1);
  }

  const { chromium } = await import('playwright-core').catch(() => ({ chromium: null }));
  if (!chromium) {
    console.error('playwright-core is not installed — run `npm ci` first. (Audit harness skipped.)');
    process.exit(1);
  }

  const executablePath = process.env.LAYOUT_BROWSER || undefined;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      env: { ...process.env, ...(process.env.LAYOUT_BROWSER_LIBS ? { LD_LIBRARY_PATH: process.env.LAYOUT_BROWSER_LIBS } : {}) },
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
  } catch (err) {
    console.error('No usable Chromium for the layout harness:', err instanceof Error ? err.message : String(err));
    console.error('Set LAYOUT_BROWSER (and LAYOUT_BROWSER_LIBS if needed) to a Chromium/Chrome executable.');
    process.exit(1);
  }

  const routes = ONLY ? ROUTES.filter((r) => r.key === ONLY || r.key.includes(ONLY)) : ROUTES;
  const results = [];
  const invoiceMatrix = [];

  if (EXPLAIN) {
    const vp = VIEWPORTS.find((v) => v.name === EXPLAIN_VIEWPORT) || VIEWPORTS[0];
    const { server, port } = await serveRenderer();
    const base = `http://127.0.0.1:${port}/`;
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    await context.addInitScript(createBridgeSource(allPermissions()));
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));
    for (const route of routes) {
      await page.goto(`${base}${route.hash}`, { waitUntil: 'load' });
      await page.waitForSelector('.shell', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(300);
      const scenario = EXPLAIN_SCENARIO ? (SCENARIOS[route.key] || []).find((s) => s.key === EXPLAIN_SCENARIO) : null;
      if (scenario) { await scenario.run(page).catch((err) => console.error(`[scenario] ${err.message}`)); await page.waitForTimeout(200); }
      const data = await page.evaluate(EXPLAIN_PROBE);
      console.log(`\n--- ${route.key} @ ${vp.name} ---`);
      if (data.error) { console.log(data.error); continue; }
      console.log(`main=${data.mainWidth} mainScroll+${data.mainScroll}`);
      for (const o of data.offenders) {
        console.log(`  w=${String(o.w).padStart(5)} over-right=${String(o.overflowRight).padStart(5)} scrollOver=${String(o.scrollOver).padStart(5)} widerThanParent=${String(o.widerThanParent).padStart(4)} minWidth=${o.minWidth} cols=${o.columns} :: ${o.el}`);
      }
    }
    await context.close();
    await browser.close();
    server.close();
    return;
  }

  const { server, port } = await serveRenderer();
  const base = `http://127.0.0.1:${port}/`;
  const permissions = allPermissions();
  const bridgeSource = createBridgeSource(permissions);

  if (SCREENS) fs.mkdirSync(SCREEN_DIR, { recursive: true });

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    await context.addInitScript(bridgeSource);
    const page = await context.newPage();
    let currentRoute = '(boot)';
    page.on('pageerror', (err) => console.error(`[pageerror ${viewport.name} ${currentRoute}] ${err.message}`));

    for (const route of routes) {
      currentRoute = route.key;
      // Full reload per route: a render error on one screen must not corrupt the
      // measurements taken for the next one.
      await page.goto(`${base}${route.hash}`, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.shell, .auth-screen, .setup-screen, .lock-overlay, .print-stage, .print-toolbar', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(350);

      const probe = await page.evaluate(PROBE);
      results.push({ route: route.key, viewport: viewport.name, ...probe });

      const scenario = SCENARIOS[route.key];
      if (scenario) {
        for (const step of scenario) {
          await step.run(page).catch((err) => console.error(`[scenario ${route.key}/${step.key}] ${err.message}`));
          await page.waitForTimeout(200);
          const probe = await page.evaluate(BOX_PROBE, step.selector);
          results.push({ route: `${route.key}:${step.key}`, viewport: viewport.name, ...probe });
          if (SCREENS) await page.screenshot({ path: path.join(SCREEN_DIR, `${route.key}-${step.key}-${viewport.name}.png`) });
        }
      }

      if (route.key === 'quick-documents') {
        // Walk-in invoice: the reported defect. Fill three lines (one from saved
        // treatments, one long description, one large currency value).
        await page.getByRole('tab', { name: /Quick invoice/i }).click();
        await page.waitForTimeout(200);
        const addLine = page.getByRole('button', { name: '+ Add line' });
        await addLine.click();
        await addLine.click();
        const lines = page.locator('.quick-line-card');
        const count = await lines.count();
        const descriptions = [
          'Root canal treatment — molar, single visit with rotary instrumentation and post-operative review',
          'Scaling and polishing (upper + lower arch)',
          'Consultation with panoramic radiograph review and treatment planning session',
        ];
        for (let i = 0; i < count; i += 1) {
          const card = lines.nth(i);
          await card.getByLabel('Item or procedure').fill(descriptions[i % descriptions.length]);
          // Line 2: a large unit price. Line 3: an extreme line total (1.5 billion)
          // so the money column is tested with the widest realistic output.
          await card.getByLabel('Unit price (৳)').fill(i === 1 ? '1234567.89' : i === 2 ? '1234567.89' : '1250');
          await card.getByLabel('Qty').fill(i === 2 ? '1234' : i === 1 ? '2' : '1');
          await card.getByLabel('Discount (৳)').fill(i === 2 ? '99.99' : '50');
        }
        await page.waitForTimeout(150);
        const geometry = await page.evaluate(INVOICE_PROBE);
        const overflow = await page.evaluate(PROBE);
        invoiceMatrix.push({ viewport: viewport.name, geometry, overflow });

        // Also add a line from the saved-treatments picker to prove the workflow.
        const picker = page.getByLabel('Add an invoice line from saved treatments');
        if (await picker.count()) {
          await picker.selectOption({ index: 1 });
          await page.waitForTimeout(150);
          const after = await page.evaluate(INVOICE_PROBE);
          invoiceMatrix.push({ viewport: viewport.name, afterTreatmentLine: after, overflow: await page.evaluate(PROBE) });
        }
      }

      if (SCREENS) {
        await page.screenshot({ path: path.join(SCREEN_DIR, `${route.key}-${viewport.name}.png`), fullPage: false });
      }
    }
    await context.close();
  }

  await browser.close();
  server.close();

  const failures = results.filter((r) =>
    (r.docOverflow ?? 0) > 0 || (r.mainOverflow ?? 0) > 0 || (r.spilled ?? 0) > 0 ||
    (r.clippedCount ?? 0) > 0 || (r.fieldsBeyond ?? 0) > 0 || (r.hostScroll ?? 0) > 0 || r.missing);
  console.log('\n=== Horizontal overflow / clipping by screen and viewport ===');
  for (const r of failures.length ? failures : results) {
    console.log(
      `${r.missing ? '?' : failures.includes(r) ? 'x' : 'ok'} ${r.route.padEnd(26)} ${r.viewport.padEnd(9)} ` +
      `page=${String(r.pageWidth ?? r.hostWidth ?? '?').padStart(5)} doc+${r.docOverflow ?? 0} main+${r.mainOverflow ?? 0} ` +
      `spills=${r.spilled ?? 'n/a'} clipped=${r.clippedCount ?? 'n/a'} hostScroll+${r.hostScroll ?? 'n/a'} fieldsBeyond=${r.fieldsBeyond ?? 'n/a'}` +
      `${(r.spills ?? []).length ? ' → ' + JSON.stringify((r.spills ?? []).slice(0, 3)) : ''}` +
      `${(r.clipped ?? []).length ? ' clip→ ' + JSON.stringify((r.clipped ?? []).slice(0, 3)) : ''}`,
    );
  }

  console.log('\n=== Walk-in invoice line geometry ===');
  for (const entry of invoiceMatrix) {
    const g = entry.geometry || {};
    const a = entry.afterTreatmentLine;
    const rowText = (probe) => (probe && probe.rows ? probe.rows.map((r) => `[${r.labels.join(' | ')}]`).join(' ') : 'n/a');
    console.log(
      `${entry.viewport.padEnd(9)} grid=${String(g.gridWidth).padStart(5)} card=${String(g.cardWidth).padStart(5)} ` +
      `gridScroll+${g.gridScroll} ${rowText(g)} removeVisible=${g.remove ? g.remove.visible : 'n/a'}` +
      (a ? ` | afterTreatmentLine gridScroll+${a.gridScroll} overflow+${(entry.overflow && entry.overflow.docOverflow) || 0}` : ''),
    );
    if (g.fields) {
      console.log(`           widths: ${g.fields.filter(Boolean).map((f) => `${f.label}=${f.width}(input ${f.inputWidth})`).join(' ')}`);
    }
  }

  const summary = { generatedAt: new Date().toISOString(), viewports: VIEWPORTS.map((v) => v.name), results, invoiceMatrix };
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));
  console.log(`\nScreens: ${SCREENS ? SCREEN_DIR : '(disabled — pass --screens)'}`);
  console.log(`Violations: ${failures.length} of ${results.length} screen/viewport pairs`);
  process.exit(failures.length ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
