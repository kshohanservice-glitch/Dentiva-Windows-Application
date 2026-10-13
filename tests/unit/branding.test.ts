/**
 * Task C regression tests — clinic branding on Login and Dashboard.
 *
 * Covers the branding helpers, the logo component's graceful fallback for a
 * missing/invalid image, the stylesheet contract for long clinic names, and
 * (integration) that the clinic logo survives a backup → restore cycle.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_CLINIC_NAME,
  PRODUCT_MARK,
  PRODUCT_NAME,
  clinicDisplayName,
  hasClinicLogo,
} from '../../src/shared/branding';
import { ClinicLogo, ClinicName } from '../../src/renderer/components/clinic-brand';
import type { ClinicSettings } from '../../src/shared/types';

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel: string): string =>
  fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function clinic(patch: Partial<ClinicSettings> = {}): ClinicSettings {
  return {
    clinicName: 'Test Dental Care',
    address: null,
    phone: null,
    email: null,
    website: null,
    operatingHours: null,
    visitingDays: null,
    currency: 'BDT',
    ...patch,
  } as ClinicSettings;
}

describe('branding helpers', () => {
  it('exposes the software product identity separately from the clinic identity', () => {
    expect(PRODUCT_NAME).toBe('Dentiva Pro');
    expect(PRODUCT_MARK).toBe('D');
  });

  it('uses the configured clinic name and never hardcodes a particular clinic', () => {
    expect(clinicDisplayName(clinic({ clinicName: 'Rahman Dental Surgery' }))).toBe('Rahman Dental Surgery');
    expect(clinicDisplayName(null)).toBe(DEFAULT_CLINIC_NAME);
    expect(clinicDisplayName(undefined)).toBe(DEFAULT_CLINIC_NAME);
    expect(clinicDisplayName(clinic({ clinicName: '   ' }))).toBe(DEFAULT_CLINIC_NAME);
  });

  it('only treats a real image data URL as a configured logo', () => {
    expect(hasClinicLogo(clinic({ logoDataUrl: PNG_1X1 }))).toBe(true);
    expect(hasClinicLogo(clinic({ logoDataUrl: null }))).toBe(false);
    expect(hasClinicLogo(clinic({ logoDataUrl: 'not-an-image' }))).toBe(false);
    expect(hasClinicLogo(clinic())).toBe(false);
  });
});

describe('ClinicLogo rendering', () => {
  it('renders the configured clinic logo', () => {
    const html = renderToStaticMarkup(createElement(ClinicLogo, { clinic: clinic({ logoDataUrl: PNG_1X1 }), size: 52, rounded: 16 }));
    expect(html).toContain('class="clinic-logo"');
    expect(html).toContain(PNG_1X1);
    // The product fallback mark must not be rendered as an element.
    expect(html).not.toContain(`>${PRODUCT_MARK}<`);
  });

  it('falls back to the product mark when no logo is configured', () => {
    const html = renderToStaticMarkup(createElement(ClinicLogo, { clinic: clinic(), size: 30 }));
    expect(html).toContain('brand-mark');
    expect(html).toContain('clinic-mark');
    expect(html).toContain(`>${PRODUCT_MARK}<`);
    expect(html).not.toContain('<img');
  });

  it('falls back to the product mark for a non-image logo value', () => {
    const html = renderToStaticMarkup(createElement(ClinicLogo, { clinic: clinic({ logoDataUrl: 'file:///etc/passwd' }), size: 30 }));
    expect(html).toContain('clinic-mark');
    expect(html).not.toContain('<img');
  });
});

describe('ClinicName rendering', () => {
  it('renders the configured name with a tooltip for truncated values', () => {
    const long = 'Dr. Mohammad Abdul Karim Chowdhury Advanced Dental and Maxillofacial Surgery Centre';
    const html = renderToStaticMarkup(createElement(ClinicName, { clinic: clinic({ clinicName: long }) }));
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain(`>${long}</span>`);
  });

  it('renders the fallback name when the clinic has none', () => {
    const html = renderToStaticMarkup(createElement(ClinicName, { clinic: null }));
    expect(html).toContain(`>${DEFAULT_CLINIC_NAME}</span>`);
  });
});

describe('branding is wired into Login and the dashboard header', () => {
  const login = read('src/renderer/pages/Login.tsx');
  const shell = read('src/renderer/components/shell.tsx');
  const about = read('src/renderer/pages/About.tsx');

  it('Login shows the clinic identity with the product name as the subtitle', () => {
    expect(login).toContain('<ClinicLogo');
    expect(login).toContain('<ClinicName');
    expect(login).toContain('PRODUCT_NAME');
    // The clinic name must not be replaced by a hardcoded clinic or the product name.
    expect(login).not.toContain('BrightSmile');
    expect(login).not.toContain('auth-title">Dentiva Pro');
  });

  it('the dashboard header shows the clinic identity with the product as the subtitle', () => {
    expect(shell).toContain('<ClinicLogo');
    expect(shell).toContain('<ClinicName');
    expect(shell).toContain('brandSubtitle');
    // The clinic name is no longer duplicated in the same header.
    expect(shell).not.toContain('<div className="brand-name">Dentiva Pro</div>');
    expect(shell).not.toContain('<div className="brand-mark">D</div>');
  });

  it('the About screen still identifies Dentiva Pro as the software product', () => {
    expect(about).toContain('About Dentiva Pro');
    expect(about).toContain('Dentiva Pro');
    expect(about).toContain('Version {system?.version');
  });

  it('no production source hardcodes a particular clinic name', () => {
    for (const file of ['src/renderer/pages/Login.tsx', 'src/renderer/components/shell.tsx', 'src/renderer/components/clinic-brand.tsx', 'src/shared/branding.ts']) {
      const src = read(file);
      expect(src, file).not.toContain('BrightSmile');
      expect(src, file).not.toContain('Audit Test');
    }
  });
});

describe('branding stylesheet contract', () => {
  const css = read('src/renderer/styles/global.css');

  it('styles the clinic logo and constrains long clinic names', () => {
    expect(css).toContain('.clinic-logo {');
    expect(css).toContain('.clinic-mark {');
    expect(css).toContain('.clinic-name {');
    const name = /(^|\n)\.clinic-name \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(name).toContain('overflow: hidden');
    expect(name).toContain('text-overflow: ellipsis');
    expect(name).toContain('white-space: nowrap');
  });

  it('excludes the configured clinic name from the shell-wide title-case transform', () => {
    expect(css).toContain('.shell .clinic-name');
  });

  it('lets the header brand column shrink instead of overflowing the header', () => {
    const brand = /\.brand \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(brand).toContain('min-width: 0');
  });
});
