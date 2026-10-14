/**
 * Dentiva Pro — free WhatsApp messaging engine (pure, shared).
 *
 * This module is deliberately free of Electron, database and network code so
 * the exact logic that builds a message can be unit-tested anywhere. It only
 * prepares official Click to Chat links (`https://wa.me/<number>?text=...`).
 * Nothing here sends a message: the doctor always reviews the text and
 * presses Send inside WhatsApp, and attaches PDFs manually.
 *
 * Language rule: every identifier, label and error in this file is English.
 * Bengali appears only inside the patient-facing template bodies below and
 * in the greeting words themselves.
 */

/* --------------------------- phone numbers --------------------------- */

export type WhatsAppNormalization =
  | { ok: true; international: string; display: string }
  | { ok: false; error: string };

const BD_MOBILE = /^01[3-9]\d{8}$/; // 01712345678

/**
 * Normalize a typed number into the digits-only international form that
 * `wa.me` requires (no `+`, no spaces). Bangladesh local numbers are the
 * common case; any other plausible international number is accepted as-is.
 * A duplicated country code (`8808801...`) and a trunk zero after the
 * country code (`+880 017...`) are repaired instead of producing a broken
 * link. Returns an English error instead of throwing so forms can show it.
 */
export function normalizeWhatsAppNumber(raw: string | null | undefined): WhatsAppNormalization {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: false, error: 'WhatsApp number is missing. Add a WhatsApp number for this patient first.' };
  }
  const text = String(raw).trim();
  if (/[A-Za-z]/.test(text)) {
    return { ok: false, error: 'WhatsApp number must contain digits only (spaces, dashes and a leading + are allowed).' };
  }
  let digits = text.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) {
    return { ok: false, error: 'WhatsApp number must contain digits only (spaces, dashes and a leading + are allowed).' };
  }

  // Bangladesh local mobile: 01XXXXXXXXX -> 8801XXXXXXXXX
  if (BD_MOBILE.test(digits)) digits = `880${digits.slice(1)}`;
  // Bangladesh mobile typed without the trunk zero: 1XXXXXXXXX
  else if (/^1[3-9]\d{8}$/.test(digits)) digits = `880${digits}`;
  // Duplicated Bangladesh country code: 8808801XXXXXXXXX
  else if (/^880880(1[3-9]\d{8})$/.test(digits)) digits = `880${digits.slice(6)}`;
  // Trunk zero kept after the country code: 88001XXXXXXXXX
  else if (/^8800(1[3-9]\d{8})$/.test(digits)) digits = `880${digits.slice(4)}`;

  if (!/^[1-9]\d{6,14}$/.test(digits)) {
    return {
      ok: false,
      error: 'Enter a valid WhatsApp number, for example 01712345678 or +8801712345678. International numbers must include the country code.',
    };
  }
  return { ok: true, international: digits, display: `+${digits}` };
}

export function isValidWhatsAppNumber(raw: string | null | undefined): boolean {
  return normalizeWhatsAppNumber(raw).ok;
}

/* ------------------------------ greetings ---------------------------- */

export interface GreetingRange {
  /** Inclusive local start time, "HH:MM". */
  start: string;
  /** Exclusive local end time, "HH:MM". May be earlier than start (wraps midnight). */
  end: string;
  /** Bengali greeting word(s) used in the patient message. */
  greeting: string;
}

/** The greeting words offered in Settings. These are message content, not UI. */
export const GREETING_OPTIONS = ['শুভ সকাল', 'শুভ দুপুর', 'শুভ বিকেল', 'শুভ সন্ধ্যা', 'শুভ রাত্রি'] as const;

export const DEFAULT_GREETING_RANGES: GreetingRange[] = [
  { start: '05:00', end: '12:00', greeting: 'শুভ সকাল' },
  { start: '12:00', end: '16:00', greeting: 'শুভ দুপুর' },
  { start: '16:00', end: '18:00', greeting: 'শুভ বিকেল' },
  { start: '18:00', end: '21:00', greeting: 'শুভ সন্ধ্যা' },
  { start: '21:00', end: '05:00', greeting: 'শুভ রাত্রি' },
];

export function isValidTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** Greeting for a minute-of-day, or null when no configured range covers it. */
export function greetingForMinutes(minutes: number, ranges: GreetingRange[] = DEFAULT_GREETING_RANGES): string | null {
  for (const range of ranges) {
    if (!isValidTimeOfDay(range.start) || !isValidTimeOfDay(range.end) || !range.greeting?.trim()) continue;
    const start = minutesOf(range.start);
    const end = minutesOf(range.end);
    const hit = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    if (hit) return range.greeting;
  }
  return null;
}

/** Minutes after midnight in `timeZone` for `date`; null when the zone is unusable. */
export function localMinutesInZone(date: Date, timeZone?: string | null): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    return null;
  }
}

export interface GreetingResolution {
  greeting: string | null;
  /** True when the configured zone failed and the device-local time was used. */
  usedFallbackZone: boolean;
}

/**
 * Resolve the greeting for the moment the message is prepared (never for the
 * appointment time). Falls back to the device's local time when the
 * configured clinic time zone cannot be resolved, and says so via the flag
 * so the caller can warn the doctor in English instead of silently picking
 * a wrong greeting.
 */
export function resolveGreeting(
  date: Date = new Date(),
  ranges: GreetingRange[] = DEFAULT_GREETING_RANGES,
  timeZone?: string | null,
): GreetingResolution {
  let usedFallbackZone = false;
  let minutes = localMinutesInZone(date, timeZone);
  if (minutes === null && timeZone) {
    usedFallbackZone = true;
    minutes = localMinutesInZone(date, null);
  }
  if (minutes === null) minutes = date.getHours() * 60 + date.getMinutes();
  return { greeting: greetingForMinutes(minutes, ranges), usedFallbackZone };
}

/* ------------------------------ templates ---------------------------- */

export type WhatsAppTemplateCategory =
  | 'appointment_reminder'
  | 'follow_up_reminder'
  | 'appointment_confirmation'
  | 'rescheduling'
  | 'cancellation'
  | 'pdf_introduction'
  | 'custom';

export const TEMPLATE_CATEGORY_LABELS: Record<WhatsAppTemplateCategory, string> = {
  appointment_reminder: 'Appointment Reminder',
  follow_up_reminder: 'Follow-up Reminder',
  appointment_confirmation: 'Appointment Confirmation',
  rescheduling: 'Rescheduling',
  cancellation: 'Cancellation',
  pdf_introduction: 'PDF Introduction',
  custom: 'Custom Message',
};

export interface DefaultWhatsAppTemplate {
  key: string;
  name: string;
  category: WhatsAppTemplateCategory;
  body: string;
}

/**
 * Default patient-facing messages. The bodies are Bengali on purpose (they
 * are the message content); every name/label around them stays English.
 * No default body may contain a religious salutation — the greeting is the
 * time-based one resolved by `resolveGreeting`.
 */
export const DEFAULT_WHATSAPP_TEMPLATES: DefaultWhatsAppTemplate[] = [
  {
    key: 'appointment_reminder',
    name: 'Appointment Reminder',
    category: 'appointment_reminder',
    body: `{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}।

আপনার নির্ধারিত ডেন্টাল অ্যাপয়েন্টমেন্টের কথা স্মরণ করিয়ে দেওয়া হচ্ছে।

ক্লিনিক: {{ক্লিনিকের_নাম}}
তারিখ: {{অ্যাপয়েন্টমেন্টের_তারিখ}}
সময়: {{অ্যাপয়েন্টমেন্টের_সময়}}
ডেন্টিস্ট: {{ডেন্টিস্টের_নাম}}
অ্যাপয়েন্টমেন্টের কারণ: {{অ্যাপয়েন্টমেন্টের_কারণ}}

প্রয়োজনে সময় পরিবর্তন বা বিস্তারিত জানার জন্য অনুগ্রহ করে আমাদের সঙ্গে যোগাযোগ করুন।

ধন্যবাদান্তে,
{{ক্লিনিকের_নাম}}
{{ক্লিনিকের_ফোন}}`,
  },
  {
    key: 'follow_up_reminder',
    name: 'Follow-up Reminder',
    category: 'follow_up_reminder',
    body: `{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}।

আপনার নির্ধারিত ডেন্টাল ফলো-আপের জন্য এই স্মরণবার্তা পাঠানো হচ্ছে।

ক্লিনিক: {{ক্লিনিকের_নাম}}
তারিখ: {{ফলোআপের_তারিখ}}
সময়: {{ফলোআপের_সময়}}
ডেন্টিস্ট: {{ডেন্টিস্টের_নাম}}
ফলো-আপের কারণ: {{ফলোআপের_কারণ}}

নির্ধারিত সময়ে উপস্থিত হতে না পারলে অনুগ্রহ করে ক্লিনিকের সঙ্গে যোগাযোগ করুন।

ধন্যবাদান্তে,
{{ক্লিনিকের_নাম}}
{{ক্লিনিকের_ফোন}}`,
  },
  {
    key: 'appointment_confirmation',
    name: 'Appointment Confirmation',
    category: 'appointment_confirmation',
    body: `{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}।

আপনার ডেন্টাল অ্যাপয়েন্টমেন্টটি নির্ধারণ করা হয়েছে।

ক্লিনিক: {{ক্লিনিকের_নাম}}
তারিখ: {{অ্যাপয়েন্টমেন্টের_তারিখ}}
সময়: {{অ্যাপয়েন্টমেন্টের_সময়}}
ডেন্টিস্ট: {{ডেন্টিস্টের_নাম}}
কারণ: {{অ্যাপয়েন্টমেন্টের_কারণ}}

প্রয়োজনে সময় পরিবর্তনের জন্য আমাদের সঙ্গে যোগাযোগ করুন।

ধন্যবাদান্তে,
{{ক্লিনিকের_নাম}}`,
  },
  {
    key: 'rescheduling',
    name: 'Rescheduling Message',
    category: 'rescheduling',
    body: `{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}।

আপনার ডেন্টাল অ্যাপয়েন্টমেন্টের সময়সূচিতে পরিবর্তন করা হয়েছে।

ক্লিনিক: {{ক্লিনিকের_নাম}}
আগের তারিখ: {{পুরোনো_তারিখ}}
আগের সময়: {{পুরোনো_সময়}}
নতুন তারিখ: {{নতুন_তারিখ}}
নতুন সময়: {{নতুন_সময়}}
ডেন্টিস্ট: {{ডেন্টিস্টের_নাম}}

কোনো প্রশ্ন থাকলে অনুগ্রহ করে আমাদের সঙ্গে যোগাযোগ করুন।

ধন্যবাদান্তে,
{{ক্লিনিকের_নাম}}`,
  },
  {
    key: 'cancellation',
    name: 'Cancellation Message',
    category: 'cancellation',
    body: `{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}।

আপনার নির্ধারিত ডেন্টাল অ্যাপয়েন্টমেন্টটি বাতিল করা হয়েছে।

ক্লিনিক: {{ক্লিনিকের_নাম}}
তারিখ: {{অ্যাপয়েন্টমেন্টের_তারিখ}}
সময়: {{অ্যাপয়েন্টমেন্টের_সময়}}
ডেন্টিস্ট: {{ডেন্টিস্টের_নাম}}

নতুন সময় নির্ধারণের জন্য অনুগ্রহ করে আমাদের সঙ্গে যোগাযোগ করুন।

ধন্যবাদান্তে,
{{ক্লিনিকের_নাম}}`,
  },
  {
    key: 'pdf_introduction',
    name: 'PDF Introduction',
    category: 'pdf_introduction',
    body: `{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}।

আপনার জন্য নির্ধারিত ডেন্টাল ডকুমেন্টটি সংযুক্ত করার জন্য প্রস্তুত করা হয়েছে।

ডকুমেন্ট: {{ডকুমেন্টের_নাম}}
তারিখ: {{ডকুমেন্টের_তারিখ}}
ক্লিনিক: {{ক্লিনিকের_নাম}}

প্রয়োজনে বিস্তারিত জানার জন্য আমাদের সঙ্গে যোগাযোগ করুন।

ধন্যবাদান্তে,
{{ক্লিনিকের_নাম}}`,
  },
  {
    key: 'custom_message',
    name: 'General Custom Message',
    category: 'custom',
    body: `{{সময়ের_গ্রিটিং}}, {{রোগীর_নাম}}।

{{বার্তার_মূল_বিষয়}}

ধন্যবাদান্তে,
{{ক্লিনিকের_নাম}}
{{ক্লিনিকের_ফোন}}`,
  },
];

/** Phrases that must never appear in a default template body. */
export const FORBIDDEN_TEMPLATE_PHRASES = ['প্রিয়', 'প্রিয়', 'আসসালামু আলাইকুম'] as const;

/* ----------------------------- placeholders -------------------------- */

export interface WhatsAppPlaceholder {
  /** Inner name used inside {{...}} in template bodies. */
  key: string;
  /** English label shown in the template manager. */
  label: string;
  required: boolean;
}

export const WHATSAPP_PLACEHOLDERS: WhatsAppPlaceholder[] = [
  { key: 'সময়ের_গ্রিটিং', label: 'Time-based greeting', required: true },
  { key: 'রোগীর_নাম', label: 'Patient name', required: true },
  { key: 'রোগীর_আইডি', label: 'Patient ID', required: false },
  { key: 'হোয়াটসঅ্যাপ_নম্বর', label: 'WhatsApp number', required: false },
  { key: 'ক্লিনিকের_নাম', label: 'Clinic name', required: true },
  { key: 'ক্লিনিকের_ফোন', label: 'Clinic phone', required: false },
  { key: 'ক্লিনিকের_ঠিকানা', label: 'Clinic address', required: false },
  { key: 'ডেন্টিস্টের_নাম', label: 'Dentist name', required: false },
  { key: 'অ্যাপয়েন্টমেন্টের_তারিখ', label: 'Appointment date', required: false },
  { key: 'অ্যাপয়েন্টমেন্টের_সময়', label: 'Appointment time', required: false },
  { key: 'অ্যাপয়েন্টমেন্টের_কারণ', label: 'Appointment reason', required: false },
  { key: 'ফলোআপের_তারিখ', label: 'Follow-up date', required: false },
  { key: 'ফলোআপের_সময়', label: 'Follow-up time', required: false },
  { key: 'ফলোআপের_কারণ', label: 'Follow-up reason', required: false },
  { key: 'পুরোনো_তারিখ', label: 'Previous date', required: false },
  { key: 'পুরোনো_সময়', label: 'Previous time', required: false },
  { key: 'নতুন_তারিখ', label: 'New date', required: false },
  { key: 'নতুন_সময়', label: 'New time', required: false },
  { key: 'ডকুমেন্টের_নাম', label: 'Document name', required: false },
  { key: 'ডকুমেন্টের_তারিখ', label: 'Document date', required: false },
  { key: 'বার্তার_মূল_বিষয়', label: 'Custom message body', required: false },
];

const PLACEHOLDER_KEYS = new Set(WHATSAPP_PLACEHOLDERS.map((p) => p.key));
const PLACEHOLDER_LABELS = new Map(WHATSAPP_PLACEHOLDERS.map((p) => [p.key, p.label]));
const REQUIRED_KEYS = new Set(WHATSAPP_PLACEHOLDERS.filter((p) => p.required).map((p) => p.key));

export function placeholderLabel(key: string): string {
  return PLACEHOLDER_LABELS.get(key) ?? key;
}

/** All {{placeholder}} inner names used in a body, in order of appearance. */
export function placeholdersIn(body: string): string[] {
  const found: string[] = [];
  for (const match of String(body ?? '').matchAll(/\{\{([^{}]+)\}\}/g)) {
    const key = match[1].trim();
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

export function unknownPlaceholdersIn(body: string): string[] {
  return placeholdersIn(body).filter((key) => !PLACEHOLDER_KEYS.has(key));
}

export interface RenderedWhatsAppMessage {
  text: string;
  /** Known placeholders with no value (English-labelled by the caller). */
  missing: string[];
  /** Placeholders this engine does not know. */
  unknown: string[];
  /** Subset of `missing` that a template cannot sensibly be sent without. */
  missingRequired: string[];
}

/**
 * Substitute real values into a template body. A placeholder with no value
 * is removed (never rendered as "undefined"/"null" or left as {{...}}),
 * lines left holding only an empty "label:" are dropped, and every gap is
 * reported so the UI can warn in English and let the doctor fix it. A
 * non-string value is treated as missing rather than stringified, so an
 * object can never leak as "[object Object]".
 */
export function renderWhatsAppTemplate(
  body: string,
  context: Record<string, string | null | undefined>,
): RenderedWhatsAppMessage {
  const missing: string[] = [];
  const unknown: string[] = [];
  const replaced = String(body ?? '').replace(/\{\{([^{}]+)\}\}/g, (_whole, rawKey: string) => {
    const key = rawKey.trim();
    const value = context[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (!PLACEHOLDER_KEYS.has(key)) {
      if (!unknown.includes(key)) unknown.push(key);
    } else if (!missing.includes(key)) {
      missing.push(key);
    }
    return '';
  });
  const lines = replaced
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .filter((line) => !/^[^\s:：][^:：]*[:：]\s*$/.test(line));
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text,
    missing,
    unknown,
    missingRequired: missing.filter((key) => REQUIRED_KEYS.has(key)),
  };
}

/** True when a doctor-edited message still contains an unresolved {{...}}. */
export function hasUnresolvedPlaceholders(text: string): boolean {
  return /\{\{[^{}]+\}\}/.test(text ?? '');
}

/* ------------------------------ wa.me links -------------------------- */

/**
 * Build the official Click to Chat URL. Throws an English Error for an
 * invalid destination so callers can surface it; Bengali text, punctuation
 * and line breaks are percent-encoded by encodeURIComponent.
 */
export function buildWhatsAppUrl(internationalDigits: string, message?: string | null): string {
  const digits = String(internationalDigits ?? '').replace(/\D/g, '');
  if (!/^[1-9]\d{6,14}$/.test(digits) || digits !== String(internationalDigits ?? '').trim()) {
    throw new Error('WhatsApp number is invalid. Check the number and try again.');
  }
  const base = `https://wa.me/${digits}`;
  const text = (message ?? '').trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * The only URL shape the main process will hand to the operating system:
 * https, host exactly `wa.me`, digits-only path, no credentials. Anything
 * else (other hosts, http, custom protocols) is rejected.
 */
export function isSafeWhatsAppUrl(value: string): boolean {
  try {
    const url = new URL(String(value ?? ''));
    return (
      url.protocol === 'https:' &&
      url.hostname === 'wa.me' &&
      url.username === '' &&
      url.password === '' &&
      /^\/[1-9]\d{6,14}$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
