# Responsive UI audit — v4.2.3

Scope: the whole renderer (Dentiva Pro 4.2.2 → 4.2.3). The audit was run with a
rendering harness against the real built renderer plus the real Electron E2E
window, so every finding below is based on measured geometry, not on reading CSS.

## How the audit was executed

| Method | What it covers | Where it runs |
| --- | --- | --- |
| `npm run layout:audit` (`scripts/layout-audit.mjs`) | Renders the real `dist/renderer` build in headless Chromium with a synthetic, in-memory bridge (no database, no clinic data) and measures horizontal overflow, clipping, grid fit and the walk-in invoice row arrangement for 18 screens × 6 viewport sizes (1920×1080, 1366×768, 1024×768, 800×600, 680×900, 480×800) plus open dialogs and tabs. Extra sizes can be passed, e.g. `node scripts/layout-audit.mjs 1280x720`. Screenshots with `--screens` (written to `layout-audit/`, ignored by git). | Developer machine / sandbox with any Chromium (`LAYOUT_BROWSER=<path>`). |
| `tests/e2e/responsive-layout.spec.ts` (Playwright + Electron) | Real application window: resizes the window (1366×768, 1180×720 = the documented minimum), fills three invoice lines with long names and 13-digit amounts, and asserts the rendered row membership, per-field geometry, Remove visibility, calculator output, line add/remove, the saved-treatment path, validation and the printed total. | CI (`npm run test:e2e`), Windows. |
| `tests/integration/ui-layout-regressions.test.ts` (vitest) | Source-level guards: the required row arrangement, the container-query thresholds, `min-width: 0` on grid children, that no window media query re-imposes a fixed invoice/medicine template, and that labels/state bindings/read-only totals are intact. | CI (`npm test`). |
| Manual screenshots | Visual confirmation at each size (`layout-audit/*.png`). | Developer machine. |

Note: this sandbox has no Electron binary (downloads are outside the allowed
network hosts), so the Playwright spec was executed by CI, not locally. The
Chromium-based harness and the vitest suite were executed locally; results are in
the release notes.

## Confirmed defects and fixes

### 1. Walk-in invoice line fields did not fit the panel (reported defect) — High

- **Screen:** Walk-in / Quick Documents → Invoice → Invoice lines.
- **Root cause:** `.quick-line-grid` was a fixed five-column grid with column
  minimums (~690px including gaps) whose responsive variants were keyed to
  *window* media queries (`max-width: 980px`, `max-width: 680px`). The invoice
  panel, however, is `.quick-grid`'s first track and only ~450–630px wide while
  the window is 1180–1920px (the preview occupies the second track above
  1180px). The five columns were therefore compressed into a container that was
  ~230px too narrow, so `Discount (৳)` and `Line total (৳)` were clipped (the
  grid overflowed by 238px at 1366×768 and 85px at 1920×1080) and labels wrapped
  to two lines.
- **Fix:** the line card is now a size container (`container-type: inline-size`),
  and `.quick-line-grid` is laid out from that container:
  - below 690px of panel width — row 1: Item or procedure · Qty · Unit price;
    row 2: Discount · Line total (explicit `grid-template-areas`);
  - at/above 690px — the previous single row is kept, and only there.
  `Remove` stays in the card heading above the grid, so it cannot overlap either
  row. Cards remain usable down to a 342px card width.
- **Regression tests:** E2E "narrow panel keeps Item/Qty/Unit price on the first
  row…", integration "walk-in invoice lines are laid out from the panel width".

### 2. Patient-invoice line fields overflowed the invoice dialog — High

- **Screen:** Patients → patient profile → New invoice (also reached from
  Invoices → New invoice).
- **Root cause:** `.invoice-line` used a fixed five-track template with 180px+
  minimums (~700px). Its only responsive variant was a window media query, so
  inside the 860px `wide` dialog at a 1366px window the line needed 700px while
  the dialog body offered ~774px — the action column and the line total were
  pushed beyond the dialog's right edge at 800×600 and narrower.
- **Fix:** the line list is wrapped in `.invoice-lines` (a size container).
  Below 620px of dialog body width the arrangement is row 1: Description · Qty ·
  Unit price · Remove, row 2: Line total; at/above 620px the original single row
  is kept. The remove control keeps its accessible name
  (`Remove invoice line <n>`) and gained `grid-area: remove`.
- **Regression tests:** integration "keeps description, quantities and the line
  total inside the invoice dialog", E2E harness scenario `invoices:new-invoice-modal`.

### 3. Prescription medicine entry ignored its card width — Medium

- **Screen:** Walk-in / Quick Documents → Prescription, and patient
  prescriptions (shared `medicine-entry-editor`).
- **Root cause:** the same pattern — a fixed three-column grid whose collapse
  points were window media queries, so inside the 476px walk-in panel three
  130px columns were rendered while the dialog variant stayed at three columns
  as well.
- **Fix:** container queries on the medicine card: 1 column below 430px, 2
  columns from 430px, 3 columns from 680px. Field labels, ids and the
  one-line-instruction behaviour are unchanged.
- **Regression tests:** integration "scales the medicine entry grid from one to
  three columns by panel width", E2E "the prescription editor and the other
  document tabs stay inside their panel".

### 4. Dashboard / Reports / About page splits could not shrink — Medium

- **Screens:** Dashboard (stats row + appointments/recent lists), Reports
  (report library + report body), About (identity + system cards).
- **Root cause:** inline `gridTemplateColumns: '1.4fr 1fr'` / `'280px 1fr'` /
  `'1.2fr 1fr'`. `fr` tracks have an `auto` minimum, so the min-content width of
  the cards (e.g. a `.report-head` heading) forced the track wider than the
  page. Measured overflow: Dashboard +116px, About +182px, Reports +69px at
  480×800.
- **Fix:** named split classes with `minmax(0, …)` tracks, `min-width: 0` on
  children, and a single-column stack below 900px.
- **Regression tests:** integration "keeps the page-level splits shrinkable and
  stacks them when narrow"; harness reports 0 overflow for those screens at all
  six sizes.

### 5. Patient profile overview overflowed the page — Medium

- **Screen:** Patients → patient profile → Overview.
- **Root cause:** inline `gridTemplateColumns: '1fr 1fr'` where three of the
  four cards carry `span-2` but the full `.form-section` card (with
  `max-width: 100%`-free content) has a 500px min-content width; at 480×800 the
  card was 500px inside a 416px page (+100px overflow).
- **Fix:** `.patient-overview-grid` uses `repeat(auto-fit, minmax(280px, 1fr))`,
  spans the chart card across all columns, and allows all children to shrink.
- **Regression tests:** integration "keeps the patient overview grid and its
  full-width card in one column set"; harness screen `patient-profile`.

### 6. Customize Documents grid overflowed its own column — Low

- **Screen:** Settings → Customize documents.
- **Root cause:** `.customize-grid` tracks are `minmax(230px,300px)` /
  `minmax(320px,1fr)`, but its children (`.customize-elements`,
  `.customize-controls`) lacked `min-width: 0`; the Tabs row inside them
  (min-content ≈ 466px) forced the second track, so the grid needed 584px where
  only 384px existed (+83px overflow at 480×800, +67px at the page level).
- **Fix:** `.customize-grid > * { min-width: 0 }` (the tab strip already scrolls
  horizontally by design).
- **Regression tests:** integration "lets the quick-document and customize
  panels shrink inside the page"; harness scenario
  `settings:customize-documents`.

### 7. Walk-in procedure (visit summary) rows — Low

- **Screen:** Walk-in / Quick Documents → Examination report → Procedures.
- **Root cause:** fixed four-track template (Tooth 115px minimum) without
  container awareness; also subject to the same class-name collision the invoice
  grid had (`.quick-line-description` was used for the invoice item field).
- **Fix:** dedicated `quick-procedure-*` area classes, 2 columns below 560px of
  card width and one row at/above 560px. The invoice item field now uses
  `quick-line-item`.

## Audited and verified clean (no change needed)

Screens measured at all six sizes with zero overflow, zero clipped controls and
zero fields wider than their parent: Dashboard, Patients list, Appointments,
Walk-in tabs (Prescription, Invoice, Receipt, Examination report, Appointment
card), Treatments, Prescriptions, Invoices list, New-invoice dialog, Payments,
Inventory, Accounting, Staff, Users & Roles, Reports, Settings, Customize
documents, Backup & Restore, Audit log, About, Patient profile, patient
registration dialog (up to 24 fields) and the print window
(`#print/invoice/1`, paper preview unaffected — print CSS is untouched).

Tables use the shared `DataTable`/`.table-wrap` scroll container, dialogs use
`.modal` with `max-width` caps, and `html/body` keep `overflow: hidden`; none of
these needed changes.

## Deliberately not changed

- **Print/PDF output**: `print.css` and the generated document stylesheet were
  not modified. Paper sizes, margins and pagination are byte-identical to 4.2.2.
- **Business logic**: invoice arithmetic (`shared/billing-math.ts`), the
  quick-document validator, prescription medicine fields and every IPC
  signature are untouched. The layout work is CSS plus class names; the only
  markup changes are the added class hooks listed below.
- **Database schema and migrations**: unchanged.

## Known limitations / manual verification still required

- The window minimum is 1180×720 (`src/main/index.ts`). Sizes below that
  (800×600, 680×900, 480×800) were verified in the harness because the clinic
  also uses the print window (720px minimum) and browser-like window states;
  they are not reachable through normal window resizing in this release.
- Physical printer output, PDF pagination and Bengali glyph rendering cannot be
  validated in CI. They require a check on the target clinic machine.
- Windows DPI scaling other than 100% was not exercised; the layout is
  container-based and therefore width-driven, but a 125%/150% display scale
  should be eyeballed once on the clinic PC.

## Files changed

- `src/renderer/styles/global.css` — invoice + quick-line + medicine grids
  (container queries, explicit areas), page split classes, patient overview
  grid, removal of the superseded window breakpoints for those grids.
- `src/renderer/styles/documents.css` — shrinkable children of `.quick-grid` and
  `.customize-grid`.
- `src/renderer/pages/QuickDocuments.tsx` — layout class hooks only.
- `src/renderer/pages/Patients.tsx` — invoice line wrapper + class hooks,
  patient overview grid class.
- `src/renderer/pages/Dashboard.tsx`, `Reports.tsx`, `About.tsx` — split class
  hooks replace inline grid templates.
- `tests/e2e/responsive-layout.spec.ts`, `tests/e2e/support.ts` — new.
- `tests/integration/ui-layout-regressions.test.ts` — extended.
- `scripts/layout-audit.mjs`, `package.json` (`layout:audit`, `test:e2e:layout`).
