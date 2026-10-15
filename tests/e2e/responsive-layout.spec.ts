/**
 * Responsive layout regression — Walk-in / Quick Documents invoice lines.
 *
 * This spec asserts *rendered geometry* in the real Electron window, not CSS
 * class names. It pins the arrangement the clinic asked for at narrow panel
 * widths and the invariants that keep the line editor usable:
 *
 *   narrow panel  → row 1: Item or procedure · Qty · Unit price (৳)
 *                   row 2: Discount (৳) · Line total (৳)
 *   wide panel    → one row, only while every field still fits
 *
 * The window is 1180px minimum (src/main/index.ts), but the invoice panel is
 * much narrower than the window whenever `.quick-grid` shows the document
 * preview beside the form — that is exactly the reported defect (the panel was
 * 476px wide inside a 1366px window while five fields needed ~690px).
 *
 * Financial expectations are hard-coded integer arithmetic so the test also
 * proves the invoice maths did not change with the layout:
 *   line 1: 2 × 500.00 − 50.00            =    950.00
 *   line 2: 1 × 1,234,567.89              = 1,234,567.89
 *   line 3: 1234 × 1,234,567.89 − 99.99   = 1,523,456,676.27
 *   subtotal 1,524,692,344.15 − line discounts 149.99 = 1,524,692,194.16
 *   with an invoice-wide discount of 100.00            → total 1,524,692,094.16
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { completeFirstRun, launchApp, resizeWindow, signIn } from './support';

let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

/** Minimal geometry record for one measured element. */
interface Box { label: string; left: number; right: number; top: number; bottom: number; width: number; inputWidth: number | null }

interface LineGeometry {
  cardWidth: number;
  cardLeft: number;
  cardRight: number;
  gridLeft: number;
  gridRight: number;
  cardScrollOverflow: number;
  gridWidth: number;
  gridScrollOverflow: number;
  gridMinFieldWidth: number;
  rows: { top: number; labels: string[]; }[];
  fields: Box[];
  remove: { visible: boolean; left: number; right: number; top: number; bottom: number; overlapsGrid: boolean; insideCard: boolean } | null;
  totalValueClipped: number;
}

/** Measures the first invoice line card exactly as the browser laid it out. */
async function measureLine(page: Page, index = 0): Promise<LineGeometry> {
  return page.evaluate((lineIndex) => {
    const card = document.querySelectorAll('.quick-line-card')[lineIndex] as HTMLElement;
    if (!card) throw new Error(`Invoice line ${lineIndex + 1} is not rendered.`);
    const grid = card.querySelector('.quick-line-grid') as HTMLElement;
    const cardRect = card.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const fields = [...card.querySelectorAll('.quick-line-grid > .field')].map((field) => {
      const el = field as HTMLElement;
      const rect = el.getBoundingClientRect();
      const labelEl = el.querySelector('label, .field-label') as HTMLElement | null;
      const control = el.querySelector('input, .input') as HTMLElement | null;
      return {
        label: (labelEl?.textContent ?? '').replace(/\s+/g, ' ').replace(/\s*\*$/, '').trim(),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        inputWidth: control ? control.getBoundingClientRect().width : null,
      };
    });
    const rows = new Map<number, string[]>();
    for (const field of fields) {
      const key = Math.round(field.top);
      rows.set(key, [...(rows.get(key) ?? []), field.label]);
    }
    const removeEl = [...card.querySelectorAll('button')].find((b) =>
      /remove/i.test(b.getAttribute('aria-label') ?? b.textContent ?? '')) as HTMLElement | undefined;
    const removeRect = removeEl?.getBoundingClientRect();
    const totalValue = card.querySelector('.quick-line-total-value') as HTMLElement | null;
    return {
      cardWidth: cardRect.width,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      gridLeft: gridRect.left,
      gridRight: gridRect.right,
      cardScrollOverflow: card.scrollWidth - card.clientWidth,
      gridWidth: gridRect.width,
      gridScrollOverflow: grid.scrollWidth - grid.clientWidth,
      gridMinFieldWidth: Math.min(...fields.map((f) => f.width)),
      rows: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([top, labels]) => ({ top, labels })),
      fields,
      remove: removeEl && removeRect ? {
        visible: removeRect.width > 0 && removeRect.height > 0,
        left: removeRect.left,
        right: removeRect.right,
        top: removeRect.top,
        bottom: removeRect.bottom,
        // The Remove action must not intersect either row of fields.
        overlapsGrid: !(removeRect.bottom <= gridRect.top || removeRect.top >= gridRect.bottom),
        insideCard: removeRect.left >= cardRect.left - 0.5 && removeRect.right <= cardRect.right + 0.5,
      } : null,
      totalValueClipped: totalValue ? totalValue.scrollWidth - totalValue.clientWidth : 0,
    };
  }, index);
}

/** Horizontal overflow of the whole page (must stay 0). */
async function pageOverflow(page: Page): Promise<{ doc: number; main: number }> {
  return page.evaluate(() => {
    const main = document.querySelector('.main');
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
}

function labelSet(geometry: LineGeometry, rowIndex: number): string[] {
  return geometry.rows[rowIndex]?.labels ?? [];
}

/** Reveal every amount (the header toggle) when the UI is masking values. */
async function revealAmounts(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /Show amounts/ });
  if (await toggle.count()) await toggle.first().click();
}

test.beforeAll(async () => {
  const launched = await launchApp({ fresh: true });
  app = launched.app;
  page = launched.page;
  await completeFirstRun(page);
  await signIn(page);
});

test.afterAll(async () => {
  await app?.close();
});

test('opens the walk-in invoice editor', async () => {
  await page.getByRole('link', { name: 'Walk-in / Quick Docs' }).click();
  await expect(page.getByRole('heading', { name: 'Walk-in / Quick Documents', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: /Quick invoice/i }).click();
  await expect(page.locator('.quick-line-card').first()).toBeVisible();
});

test('narrow panel keeps Item/Qty/Unit price on the first row and Discount/Line total on the second', async () => {
  // 1366×768 is the reported defect size: the form panel is ~476px inside a
  // 1366px window because the document preview shares the row.
  const size = await resizeWindow(app, page, 1366, 768);
  expect(size.innerWidth).toBeLessThanOrEqual(1370);

  const addLine = page.getByRole('button', { name: '+ Add line' });
  await addLine.click();
  await addLine.click();
  await expect(page.locator('.quick-line-card')).toHaveCount(3);

  const descriptions = [
    'Root canal treatment — molar, single visit with rotary instrumentation and review',
    'Scaling and polishing (upper + lower arch)',
    'Consultation with panoramic radiograph review and treatment planning session',
  ];
  const values = [
    { qty: '2', unit: '500', discount: '50' },
    { qty: '1', unit: '1234567.89', discount: '0' },
    { qty: '1234', unit: '1234567.89', discount: '99.99' },
  ];
  for (let i = 0; i < 3; i += 1) {
    const card = page.locator('.quick-line-card').nth(i);
    await card.getByLabel('Item or procedure').fill(descriptions[i]);
    await card.getByLabel('Qty').fill(values[i].qty);
    await card.getByLabel('Unit price (৳)').fill(values[i].unit);
    await card.getByLabel('Discount (৳)').fill(values[i].discount);
  }
  await page.getByLabel('Invoice discount (৳)').fill('100');

  // Every line must use the required two-row arrangement in this panel.
  const panelWidth = (await measureLine(page, 0)).gridWidth;
  expect(panelWidth).toBeLessThan(690);

  for (let i = 0; i < 3; i += 1) {
    const geometry = await measureLine(page, i);
    expect(labelSet(geometry, 0)).toEqual(['Item or procedure', 'Qty', 'Unit price (৳)']);
    expect(labelSet(geometry, 1)).toEqual(['Discount (৳)', 'Line total (৳)']);
    expect(geometry.rows).toHaveLength(2);

    // Row 1 fields share a baseline; row 2 starts strictly below it.
    const [firstRow, secondRow] = geometry.rows;
    const firstRowTops = geometry.fields.slice(0, 3).map((f) => f.top);
    expect(Math.max(...firstRowTops) - Math.min(...firstRowTops)).toBeLessThanOrEqual(1.5);
    expect(secondRow.top).toBeGreaterThan(firstRow.top + 20);

    // Nothing is clipped, squeezed below a usable width, or pushed outside the card.
    expect(geometry.gridScrollOverflow).toBeLessThanOrEqual(1);
    expect(geometry.cardScrollOverflow).toBeLessThanOrEqual(1);
    expect(geometry.gridMinFieldWidth).toBeGreaterThanOrEqual(60);
    for (const field of geometry.fields) {
      // Every field sits inside its grid, which sits inside the card.
      expect(field.left).toBeGreaterThanOrEqual(geometry.gridLeft - 0.5);
      expect(field.right).toBeLessThanOrEqual(geometry.gridRight + 0.5);
      expect(field.left).toBeGreaterThanOrEqual(geometry.cardLeft - 0.5);
      expect(field.right).toBeLessThanOrEqual(geometry.cardRight + 0.5);
      expect(field.inputWidth ?? 0).toBeGreaterThan(0);
    }
  }

  // The Remove action stays visible, inside its card and clear of both rows.
  const geometry = await measureLine(page, 0);
  expect(geometry.remove?.visible).toBe(true);
  expect(geometry.remove?.insideCard).toBe(true);
  expect(geometry.remove?.overlapsGrid).toBe(false);

  // No horizontal scrolling of the page is needed with three lines filled.
  const overflow = await pageOverflow(page);
  expect(overflow.doc).toBe(0);
  expect(overflow.main).toBe(0);

  // Amounts: reveal them and verify the large money values render without clipping.
  await revealAmounts(page);
  await expect(page.locator('.quick-line-total-value').first()).toContainText('৳950.00');
  await expect(page.locator('.quick-line-total-value').nth(2)).toContainText('৳1,523,456,676.27');

  const summary = page.locator('.quick-invoice-summary');
  await expect(summary).toContainText('৳1,524,692,344.15'); // gross subtotal
  await expect(summary).toContainText('৳149.99'); // line discounts
  await expect(summary).toContainText('৳1,524,692,194.16'); // after line discounts
  await expect(summary).toContainText('৳1,524,692,094.16'); // total after the invoice-wide discount

  for (let i = 0; i < 3; i += 1) {
    expect((await measureLine(page, i)).totalValueClipped).toBeLessThanOrEqual(1);
  }
});

test('removing a line keeps the arrangement and removes the intended line', async () => {
  const secondCard = page.locator('.quick-line-card').nth(1);
  await secondCard.getByRole('button', { name: 'Remove invoice line 2' }).click();
  await expect(page.locator('.quick-line-card')).toHaveCount(2);

  // Line 1 and the last line survive; the middle one is gone.
  await expect(page.locator('.quick-line-card').nth(0).getByLabel('Item or procedure')).toHaveValue(/Root canal treatment/);
  await expect(page.locator('.quick-line-card').nth(1).getByLabel('Item or procedure')).toHaveValue(/Consultation with panoramic/);

  const geometry = await measureLine(page, 0);
  expect(labelSet(geometry, 0)).toEqual(['Item or procedure', 'Qty', 'Unit price (৳)']);
  expect(labelSet(geometry, 1)).toEqual(['Discount (৳)', 'Line total (৳)']);
  expect(geometry.gridScrollOverflow).toBeLessThanOrEqual(1);
  expect(geometry.remove?.visible).toBe(true);

  // The removed line's amount is gone from the totals.
  const summary = page.locator('.quick-invoice-summary');
  await expect(summary).toContainText('৳1,523,457,776.26'); // 2×500 + 1234×1234567.89
  await expect(summary).toContainText('৳1,523,457,526.27'); // − 149.99 line discounts − 100 invoice discount
  await expect(summary).not.toContainText('৳1,234,567.89'); // the removed line's amount
});

test('a line added from saved treatments keeps the same layout', async () => {
  // Create a treatment first so the picker has a real option (this is the
  // documented "add from saved treatments" path).
  await page.getByRole('link', { name: 'Treatments' }).click();
  await page.getByRole('button', { name: 'New treatment' }).first().click();
  const modal = page.locator('.modal[role="dialog"]').last();
  await modal.getByLabel('Code').fill('E2ELAYOUT');
  await modal.getByLabel('Name').fill('E2E Layout Treatment');
  await modal.getByLabel('Default price (৳)').fill('1250');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast-title', { hasText: 'Treatment created' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('link', { name: 'Walk-in / Quick Docs' }).click();
  await page.getByRole('tab', { name: /Quick invoice/i }).click();
  await page.getByLabel('Add an invoice line from saved treatments').selectOption({ label: 'E2E Layout Treatment · ৳1,250.00' });
  await expect(page.locator('.quick-line-card')).toHaveCount(2);

  const geometry = await measureLine(page, 1);
  expect(labelSet(geometry, 0)).toEqual(['Item or procedure', 'Qty', 'Unit price (৳)']);
  expect(labelSet(geometry, 1)).toEqual(['Discount (৳)', 'Line total (৳)']);
  expect(geometry.gridScrollOverflow).toBeLessThanOrEqual(1);
  await expect(page.locator('.quick-line-card').nth(1).getByLabel('Item or procedure')).toHaveValue('E2E Layout Treatment');
  await expect(page.locator('.quick-line-card').nth(1).getByLabel('Unit price (৳)')).toHaveValue('1250');
  expect((await pageOverflow(page)).main).toBe(0);
});

test('validation and keyboard access still work in the invoice editor', async () => {
  const card = page.locator('.quick-line-card').first();

  // Required-field validation is unchanged: an incomplete document is refused
  // and the reason is shown in the form's alert.
  await page.getByLabel('Customer name').fill('');
  await page.getByRole('button', { name: /Preview & print/i }).click();
  const alert = page.locator('.callout[role="alert"]');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/Customer name is required/i);

  // Financial guard: a line discount larger than its line amount is refused.
  await page.getByLabel('Customer name').fill('E2E Walk-in Layout Customer');
  await card.getByLabel('Item or procedure').fill('Filling');
  await card.getByLabel('Qty').fill('1');
  await card.getByLabel('Unit price (৳)').fill('10');
  await card.getByLabel('Discount (৳)').fill('50');
  await page.getByRole('button', { name: /Preview & print/i }).click();
  await expect(alert).toContainText(/Line #1 discount exceeds the line total/i);

  // Keyboard entry still drives the calculation: type into Qty, then the line
  // total follows the same integer arithmetic as the invoice form.
  await card.getByLabel('Discount (৳)').fill('0');
  await card.getByLabel('Qty').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('3');
  await card.getByLabel('Unit price (৳)').fill('1000');
  await revealAmounts(page);
  await expect(card.locator('.quick-line-total-value')).toContainText('৳3,000.00');
  await expect(card.getByLabel('Item or procedure')).toHaveAttribute('required', '');
});

test('the widest supported panel may use one row, and it still fits', async () => {
  // 1180×720 is the smallest supported window: the preview and the form stack,
  // so the invoice panel is at its widest and the compact single row is used.
  const size = await resizeWindow(app, page, 1180, 720);
  expect(size.innerWidth).toBeLessThanOrEqual(1185);

  const geometry = await measureLine(page, 0);
  expect(geometry.gridScrollOverflow).toBeLessThanOrEqual(1);
  expect(geometry.cardScrollOverflow).toBeLessThanOrEqual(1);
  expect(geometry.remove?.visible).toBe(true);
  expect(geometry.remove?.insideCard).toBe(true);

  const labels = geometry.fields.map((f) => f.label);
  if (geometry.rows.length === 1) {
    // Single row: every field present and none squeezed below its minimum.
    expect(labels).toEqual(['Item or procedure', 'Qty', 'Unit price (৳)', 'Discount (৳)', 'Line total (৳)']);
    const minimums: Record<string, number> = { 'Qty': 80, 'Unit price (৳)': 115, 'Discount (৳)': 120, 'Line total (৳)': 145, 'Item or procedure': 180 };
    for (const field of geometry.fields) expect(field.width).toBeGreaterThanOrEqual(minimums[field.label] - 1);
  } else {
    expect(labelSet(geometry, 0)).toEqual(['Item or procedure', 'Qty', 'Unit price (৳)']);
    expect(labelSet(geometry, 1)).toEqual(['Discount (৳)', 'Line total (৳)']);
    expect(geometry.gridWidth).toBeLessThan(690);
  }
  expect((await pageOverflow(page)).main).toBe(0);
});

test('the prescription editor and the other document tabs stay inside their panel', async () => {
  const size = await resizeWindow(app, page, 1366, 768);
  expect(size.innerWidth).toBeLessThanOrEqual(1370);

  await page.getByRole('tab', { name: /Quick prescription/i }).click();
  const medicine = page.locator('.medicine-entry-grid').first();
  await expect(medicine).toBeVisible();
  const medicineGeometry = await medicine.evaluate((el) => {
    const grid = el as HTMLElement;
    const fields = [...grid.querySelectorAll(':scope > .field')].map((f) => f.getBoundingClientRect());
    const card = grid.closest('.medicine-entry-card') as HTMLElement;
    const cardRect = card.getBoundingClientRect();
    return {
      scrollOverflow: grid.scrollWidth - grid.clientWidth,
      minFieldWidth: Math.min(...fields.map((f) => f.width)),
      exceedsCard: fields.some((f) => f.right > cardRect.right + 0.5 || f.left < cardRect.left - 0.5),
      cardOverflow: card.scrollWidth - card.clientWidth,
    };
  });
  expect(medicineGeometry.scrollOverflow).toBeLessThanOrEqual(1);
  expect(medicineGeometry.cardOverflow).toBeLessThanOrEqual(1);
  expect(medicineGeometry.exceedsCard).toBe(false);
  expect(medicineGeometry.minFieldWidth).toBeGreaterThanOrEqual(100);

  for (const tab of [/Quick receipt/i, /Quick examination report/i, /Quick appointment card/i]) {
    await page.getByRole('tab', { name: tab }).click();
    const overflow = await pageOverflow(page);
    expect(overflow.doc).toBe(0);
    expect(overflow.main).toBe(0);
  }
  expect((await pageOverflow(page)).main).toBe(0);
});

test('the printed walk-in invoice carries the same total as the screen', async () => {
  // Switching tabs clears the editor, so the invoice tab starts with one empty
  // line: 1 × 1,200.00 − 200.00 line discount − 100.00 invoice discount = 900.00.
  await page.getByRole('tab', { name: /Quick invoice/i }).click();
  await expect(page.locator('.quick-line-card')).toHaveCount(1);
  await page.getByLabel('Customer name').fill('E2E Walk-in Layout Customer');
  const card = page.locator('.quick-line-card').first();
  await card.getByLabel('Item or procedure').fill('Extraction');
  await card.getByLabel('Qty').fill('1');
  await card.getByLabel('Unit price (৳)').fill('1200');
  await card.getByLabel('Discount (৳)').fill('200');
  await page.getByLabel('Invoice discount (৳)').fill('100');

  await revealAmounts(page);
  await expect(page.locator('.quick-invoice-summary')).toContainText('৳900.00');

  const [printWin] = await Promise.all([
    app.waitForEvent('window', { timeout: 60_000 }),
    page.getByRole('button', { name: /Preview & print/i }).click(),
  ]);
  await printWin.waitForLoadState('domcontentloaded');
  // The main process routes every walk-in document through `#print/quick/<token>`.
  expect(printWin.url()).toContain('#print/quick/');
  const printed = printWin.locator('.print-doc');
  await expect(printed).toBeVisible({ timeout: 60_000 });
  await expect(printed).toContainText('৳900.00');
  await expect(printed).toContainText('Extraction');
  // Printed documents always show real amounts — never the on-screen mask.
  await expect(printed).not.toContainText('****');
  await printWin.close();
});
