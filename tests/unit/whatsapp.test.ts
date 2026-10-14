import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppUrl,
  DEFAULT_GREETING_RANGES,
  DEFAULT_WHATSAPP_TEMPLATES,
  FORBIDDEN_TEMPLATE_PHRASES,
  greetingForMinutes,
  hasUnresolvedPlaceholders,
  isSafeWhatsAppUrl,
  MAX_WHATSAPP_LINK_LENGTH,
  MAX_WHATSAPP_MESSAGE_LENGTH,
  normalizeWhatsAppNumber,
  placeholdersIn,
  renderWhatsAppTemplate,
  resolveGreeting,
  unknownPlaceholdersIn,
} from '../../src/shared/whatsapp';

describe('WhatsApp number normalization', () => {
  it('normalizes Bangladesh local numbers to international digits', () => {
    expect(normalizeWhatsAppNumber('01712345678')).toEqual({ ok: true, international: '8801712345678', display: '+8801712345678' });
    expect(normalizeWhatsAppNumber('01712-345 678')).toMatchObject({ ok: true, international: '8801712345678' });
    expect(normalizeWhatsAppNumber('(01712) 345678')).toMatchObject({ ok: true, international: '8801712345678' });
  });

  it('accepts Bangladesh numbers that already carry the country code', () => {
    expect(normalizeWhatsAppNumber('+8801712345678')).toMatchObject({ ok: true, international: '8801712345678' });
    expect(normalizeWhatsAppNumber('8801712345678')).toMatchObject({ ok: true, international: '8801712345678' });
    expect(normalizeWhatsAppNumber('008801712345678')).toMatchObject({ ok: true, international: '8801712345678' });
    expect(normalizeWhatsAppNumber('1712345678')).toMatchObject({ ok: true, international: '8801712345678' });
  });

  it('repairs duplicated country codes and trunk zeros instead of duplicating them', () => {
    expect(normalizeWhatsAppNumber('8808801712345678')).toMatchObject({ ok: true, international: '8801712345678' });
    expect(normalizeWhatsAppNumber('+880 01712-345678')).toMatchObject({ ok: true, international: '8801712345678' });
  });

  it('accepts valid international numbers with a country code', () => {
    expect(normalizeWhatsAppNumber('+1 (202) 555-0123')).toMatchObject({ ok: true, international: '12025550123' });
    expect(normalizeWhatsAppNumber('+44 20 7946 0958')).toMatchObject({ ok: true, international: '442079460958' });
  });

  it('rejects missing, short, and non-numeric numbers with an English message', () => {
    for (const bad of ['', '   ', null, undefined, '12345', '01712345', 'phone-number', '++8801712345678x']) {
      const result = normalizeWhatsAppNumber(bad as string);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/[A-Za-z]/);
    }
  });
});

describe('time-based greeting', () => {
  const cases: [number, string][] = [
    [4 * 60 + 59, 'শুভ রাত্রি'],
    [5 * 60, 'শুভ সকাল'],
    [11 * 60 + 59, 'শুভ সকাল'],
    [12 * 60, 'শুভ দুপুর'],
    [15 * 60 + 59, 'শুভ দুপুর'],
    [16 * 60, 'শুভ বিকেল'],
    [17 * 60 + 59, 'শুভ বিকেল'],
    [18 * 60, 'শুভ সন্ধ্যা'],
    [20 * 60 + 59, 'শুভ সন্ধ্যা'],
    [21 * 60, 'শুভ রাত্রি'],
    [0, 'শুভ রাত্রি'],
  ];
  it.each(cases)('minute %i uses the configured greeting', (minutes, expected) => {
    expect(greetingForMinutes(minutes, DEFAULT_GREETING_RANGES)).toBe(expected);
  });

  it('supports administrator-configured ranges', () => {
    const ranges = [{ start: '06:00', end: '18:00', greeting: 'শুভ সকাল' }];
    expect(greetingForMinutes(7 * 60, ranges)).toBe('শুভ সকাল');
    expect(greetingForMinutes(20 * 60, ranges)).toBeNull();
  });

  it('resolves using an explicit clinic time zone, not UTC', () => {
    // 2026-01-15 03:30 UTC is 09:30 in Asia/Dhaka (morning) but 22:30 the
    // previous day in America/New_York (night).
    const instant = new Date('2026-01-15T03:30:00Z');
    expect(resolveGreeting(instant, DEFAULT_GREETING_RANGES, 'Asia/Dhaka').greeting).toBe('শুভ সকাল');
    expect(resolveGreeting(instant, DEFAULT_GREETING_RANGES, 'America/New_York').greeting).toBe('শুভ রাত্রি');
  });

  it('flags an unusable time zone instead of silently using it', () => {
    const result = resolveGreeting(new Date(), DEFAULT_GREETING_RANGES, 'Not/AZone');
    expect(result.usedFallbackZone).toBe(true);
    expect(result.greeting).not.toBeNull();
  });
});

describe('default Bengali templates', () => {
  it('cover every required message category', () => {
    expect(DEFAULT_WHATSAPP_TEMPLATES.map((t) => t.category).sort()).toEqual([
      'appointment_confirmation', 'appointment_reminder', 'cancellation', 'custom',
      'follow_up_reminder', 'pdf_introduction', 'rescheduling',
    ]);
  });

  it('contain no religious salutation or forbidden phrase', () => {
    for (const tpl of DEFAULT_WHATSAPP_TEMPLATES) {
      for (const phrase of FORBIDDEN_TEMPLATE_PHRASES) {
        expect(tpl.body, `${tpl.key} must not contain ${phrase}`).not.toContain(phrase);
      }
      expect(tpl.body).not.toContain('প্রিয়');
      expect(tpl.body).not.toContain('প্রিয়');
    }
  });

  it('every default template starts from the time-based greeting and patient name', () => {
    for (const tpl of DEFAULT_WHATSAPP_TEMPLATES) {
      expect(placeholdersIn(tpl.body)).toContain('সময়ের_গ্রিটিং');
      expect(placeholdersIn(tpl.body)).toContain('রোগীর_নাম');
      expect(unknownPlaceholdersIn(tpl.body)).toEqual([]);
    }
  });
});

describe('placeholder rendering', () => {
  const context = {
    'সময়ের_গ্রিটিং': 'শুভ সকাল',
    'রোগীর_নাম': 'রহিমা আক্তার',
    'ক্লিনিকের_নাম': 'BrightSmile Dental Clinic',
    'ক্লিনিকের_ফোন': '01712345678',
    'অ্যাপয়েন্টমেন্টের_তারিখ': '20 Oct 2026',
    'অ্যাপয়েন্টমেন্টের_সময়': '10:30 AM',
  };

  it('substitutes patient, clinic and appointment data and keeps Bengali Unicode', () => {
    const tpl = DEFAULT_WHATSAPP_TEMPLATES.find((t) => t.key === 'appointment_reminder')!;
    const rendered = renderWhatsAppTemplate(tpl.body, context);
    expect(rendered.text.startsWith('শুভ সকাল, রহিমা আক্তার।')).toBe(true);
    expect(rendered.text).toContain('BrightSmile Dental Clinic');
    expect(rendered.text).toContain('20 Oct 2026');
    expect(rendered.text).toContain('10:30 AM');
    expect(rendered.text).not.toContain('{{');
    expect(rendered.missingRequired).toEqual([]);
  });

  it('never renders undefined, null, objects, or unresolved placeholders', () => {
    const rendered = renderWhatsAppTemplate('{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}। {{অজানা_জিনিস}} {{ডেন্টিস্টের_নাম}}', {
      'সময়ের_গ্রিটিং': 'শুভ দুপুর',
      'রোগীর_নাম': 'Karim',
      'ডেন্টিস্টের_নাম': undefined,
    });
    expect(rendered.text).not.toMatch(/undefined|null|\[object Object\]|\{\{/);
    expect(rendered.missing).toContain('ডেন্টিস্টের_নাম');
    expect(rendered.unknown).toContain('অজানা_জিনিস');
    expect(hasUnresolvedPlaceholders(rendered.text)).toBe(false);
  });

  it('reports missing required fields instead of fabricating them', () => {
    const tpl = DEFAULT_WHATSAPP_TEMPLATES.find((t) => t.key === 'appointment_reminder')!;
    const rendered = renderWhatsAppTemplate(tpl.body, {});
    expect(rendered.missingRequired).toContain('রোগীর_নাম');
    expect(rendered.missingRequired).toContain('ক্লিনিকের_নাম');
    expect(rendered.text).not.toContain('{{');
  });

  it('drops label lines left empty by missing optional data', () => {
    const rendered = renderWhatsAppTemplate('ক্লিনিক: {{ক্লিনিকের_নাম}}\nডেন্টিস্ট: {{ডেন্টিস্টের_নাম}}\nশেষ।', {
      'ক্লিনিকের_নাম': 'BrightSmile Dental Clinic',
    });
    expect(rendered.text).toContain('ক্লিনিক: BrightSmile Dental Clinic');
    expect(rendered.text).not.toContain('ডেন্টিস্ট:');
  });
});

describe('Click to Chat URLs', () => {
  it('builds a wa.me URL with Bengali text, punctuation and line breaks encoded', () => {
    const message = 'শুভ সকাল, রহিমা আক্তার।\nতারিখ: 20 Oct 2026';
    const url = buildWhatsAppUrl('8801712345678', message);
    expect(url.startsWith('https://wa.me/8801712345678?text=')).toBe(true);
    const encoded = url.split('?text=')[1];
    expect(decodeURIComponent(encoded)).toBe(message);
    expect(encoded).not.toContain(' ');
    expect(encoded).not.toContain('\n');
  });

  it('omits the text parameter for an empty message', () => {
    expect(buildWhatsAppUrl('8801712345678', '')).toBe('https://wa.me/8801712345678');
    expect(buildWhatsAppUrl('8801712345678')).toBe('https://wa.me/8801712345678');
  });

  it('rejects invalid destinations', () => {
    expect(() => buildWhatsAppUrl('123', 'hello')).toThrow(/invalid/i);
    expect(() => buildWhatsAppUrl('+8801712345678', 'hello')).toThrow(/invalid/i);
    expect(() => buildWhatsAppUrl('', 'hello')).toThrow(/invalid/i);
  });

  it('never lets the message limit produce a link the open guard would refuse', () => {
    // The main process refuses links longer than MAX_WHATSAPP_LINK_LENGTH, so
    // the longest message the app accepts must still fit inside that ceiling.
    const longestAllowed = buildWhatsAppUrl('8801712345678', 'ক'.repeat(MAX_WHATSAPP_MESSAGE_LENGTH));
    expect(longestAllowed.length).toBeLessThanOrEqual(MAX_WHATSAPP_LINK_LENGTH);
    // Bengali costs nine encoded characters per letter (3 UTF-8 bytes).
    expect(longestAllowed.length).toBeGreaterThan(MAX_WHATSAPP_MESSAGE_LENGTH * 8);
  });

  it('only accepts strict https wa.me URLs for opening', () => {
    expect(isSafeWhatsAppUrl('https://wa.me/8801712345678?text=hello')).toBe(true);
    expect(isSafeWhatsAppUrl('https://wa.me/8801712345678')).toBe(true);
    for (const bad of [
      'http://wa.me/8801712345678',
      'https://wa.me.evil.example/8801712345678',
      'https://evil.example/8801712345678',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://user:pass@wa.me/8801712345678',
      'https://wa.me/not-a-number',
      'wa.me/8801712345678',
      '',
    ]) {
      expect(isSafeWhatsAppUrl(bad), bad).toBe(false);
    }
  });
});
