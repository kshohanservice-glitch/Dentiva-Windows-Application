/**
 * Archive-entry validation for Dentiva backups (.dpv).
 *
 * Backup archives are untrusted input: a clinic may restore a file received
 * from elsewhere. Every entry name is validated against a strict grammar
 * BEFORE any byte is extracted, and every extracted byte is written only
 * below a canonical staging root. Pure functions here are unit-tested with
 * malicious fixtures (see tests/unit/archive-safety.test.ts).
 */
import path from 'node:path';
import { Transform } from 'node:stream';

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;

export const ARCHIVE_LIMITS = {
  /** Largest .dpv file accepted for restore. */
  maxArchiveBytes: 20 * GiB,
  /** Maximum number of entries (files + directories) in one archive. */
  maxEntries: 50_000,
  /** Sum of declared and actually-extracted bytes across all entries. */
  maxTotalUncompressedBytes: 20 * GiB,
  /** Single attachment ceiling (attachments are capped at 100 MB at ingest). */
  maxEntryUncompressedBytes: 4 * GiB,
  /** Relative archive path length in characters. */
  maxPathLength: 240,
  /** Maximum characters per path segment (Windows NTFS limit is 255). */
  maxSegmentLength: 180,
  /** Maximum directory depth below `attachments/`. */
  maxAttachmentDepth: 8,
  /** Compression-bomb guard: ratio above this is rejected for large entries. */
  maxCompressionRatio: 500,
  /** Ratio is only enforced for entries at least this large (small entries compress well legitimately). */
  ratioCheckMinBytes: 32 * MiB,
  /** Manifest is a small JSON document. */
  maxManifestBytes: 1 * MiB,
} as const;

export const DATABASE_ENTRY = 'database/dentiva.db';
export const MANIFEST_ENTRY = 'manifest.json';
export const ATTACHMENTS_PREFIX = 'attachments/';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Control characters and characters Windows forbids in file names.
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f<>:"|?*\\]/;
const DRIVE_PREFIX = /^[A-Za-z]:/;

export class ArchiveRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveRejectedError';
  }
}

export interface ArchiveEntryInfo {
  path: string;
  type: string;
  uncompressedSize: number;
  compressedSize: number;
  externalFileAttributes?: number;
}

export type ArchiveEntryKind = 'manifest' | 'database' | 'attachment' | 'directory';

export interface ClassifiedEntry {
  kind: ArchiveEntryKind;
  /** Canonical archive path, forward slashes, e.g. `attachments/patient/3/x.pdf`. */
  archivePath: string;
  /** For attachments: the path relative to the attachments root (`patient/3/x.pdf`). */
  relPath: string | null;
  info: ArchiveEntryInfo;
}

export interface ArchivePlan {
  manifest: ClassifiedEntry;
  database: ClassifiedEntry;
  attachments: ClassifiedEntry[];
}

/**
 * Validate a relative path that will be joined under a root directory.
 * Accepts only plain forward-slash segments. Throws ArchiveRejectedError.
 */
export function validateRelativePath(raw: unknown, opts: { maxDepth?: number } = {}): string {
  if (typeof raw !== 'string' || raw.length === 0) throw new ArchiveRejectedError('An archive entry has an empty name.');
  if (raw.length > ARCHIVE_LIMITS.maxPathLength) {
    throw new ArchiveRejectedError(`An archive entry name is too long (${raw.length} characters).`);
  }
  if (raw.includes('\\')) throw new ArchiveRejectedError(`Unsafe path separator in archive entry: ${printable(raw)}`);
  if (FORBIDDEN_CHARS.test(raw)) throw new ArchiveRejectedError(`Forbidden character in archive entry: ${printable(raw)}`);
  if (raw.startsWith('/')) throw new ArchiveRejectedError(`Absolute path in archive entry: ${printable(raw)}`);
  if (raw.startsWith('//')) throw new ArchiveRejectedError(`UNC path in archive entry: ${printable(raw)}`);
  if (DRIVE_PREFIX.test(raw)) throw new ArchiveRejectedError(`Drive-letter path in archive entry: ${printable(raw)}`);

  const trailingSlash = raw.endsWith('/');
  const body = trailingSlash ? raw.slice(0, -1) : raw;
  const segments = body.split('/');
  if (segments.length > (opts.maxDepth ?? Number.MAX_SAFE_INTEGER)) {
    throw new ArchiveRejectedError(`Archive entry is nested too deeply: ${printable(raw)}`);
  }
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new ArchiveRejectedError(`Unsafe path segment in archive entry: ${printable(raw)}`);
    }
    if (seg.length > ARCHIVE_LIMITS.maxSegmentLength) throw new ArchiveRejectedError('An archive path segment is too long.');
    if (seg.endsWith('.') || seg.endsWith(' ')) {
      throw new ArchiveRejectedError(`Windows-invalid trailing dot/space in archive entry: ${printable(raw)}`);
    }
    if (WINDOWS_RESERVED.test(seg)) {
      throw new ArchiveRejectedError(`Reserved Windows device name in archive entry: ${printable(raw)}`);
    }
  }
  return body;
}

/** Resolve `rel` under `root` and prove the result stays strictly inside `root`. */
export function resolveInside(root: string, rel: string): string {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, ...rel.split('/'));
  const relative = path.relative(rootAbs, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ArchiveRejectedError(`Archive entry escapes its destination: ${printable(rel)}`);
  }
  return target;
}

/** Unix file-type bits stored in the high 16 bits of external attributes (zip "made by unix" hosts). */
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

export function classifySpecialEntry(info: ArchiveEntryInfo): void {
  const mode = info.externalFileAttributes !== undefined ? (info.externalFileAttributes >>> 16) & 0xffff : 0;
  if (mode === 0) return; // no unix mode recorded (typical for Windows-created zips)
  const kind = mode & S_IFMT;
  if (kind === 0 || kind === S_IFREG || kind === S_IFDIR) return;
  if (kind === 0o120000) throw new ArchiveRejectedError(`Symbolic links are not allowed in backups: ${printable(info.path)}`);
  throw new ArchiveRejectedError(`Unsupported special file in backup: ${printable(info.path)}`);
}

/**
 * Validate the complete entry listing of a backup archive before extraction.
 * Enforces: entry count, declared sizes, compression ratio, canonical names,
 * case-insensitive uniqueness, no links/special files, and the exact set of
 * allowed top-level entries.
 */
export function planArchive(entries: ArchiveEntryInfo[]): ArchivePlan {
  if (entries.length > ARCHIVE_LIMITS.maxEntries) {
    throw new ArchiveRejectedError(`Backup contains too many entries (${entries.length}; maximum ${ARCHIVE_LIMITS.maxEntries}).`);
  }
  let total = 0;
  const seen = new Set<string>();
  let manifest: ClassifiedEntry | null = null;
  let database: ClassifiedEntry | null = null;
  const attachments: ClassifiedEntry[] = [];

  for (const info of entries) {
    classifySpecialEntry(info);
    const isDir = info.type === 'Directory';
    const size = Number(info.uncompressedSize) || 0;
    const packed = Number(info.compressedSize) || 0;
    if (size > ARCHIVE_LIMITS.maxEntryUncompressedBytes) {
      throw new ArchiveRejectedError(`An archive entry is too large: ${printable(info.path)}`);
    }
    if (!isDir && size >= ARCHIVE_LIMITS.ratioCheckMinBytes && size > packed * ARCHIVE_LIMITS.maxCompressionRatio) {
      throw new ArchiveRejectedError(`Suspicious compression ratio in archive entry: ${printable(info.path)}`);
    }
    total += size;
    if (total > ARCHIVE_LIMITS.maxTotalUncompressedBytes) {
      throw new ArchiveRejectedError('Backup expands beyond the supported size limit.');
    }

    const rel = validateRelativePath(info.path, { maxDepth: ARCHIVE_LIMITS.maxAttachmentDepth + 2 });
    const normalized = isDir ? rel.replace(/\/$/, '') : rel;
    const key = normalized.toLowerCase();
    if (seen.has(key)) throw new ArchiveRejectedError(`Duplicate or conflicting archive entry: ${printable(info.path)}`);
    seen.add(key);

    if (isDir) {
      if (normalized !== 'database' && normalized !== 'attachments' && !normalized.startsWith(ATTACHMENTS_PREFIX)) {
        throw new ArchiveRejectedError(`Unexpected directory in backup: ${printable(info.path)}`);
      }
      continue;
    }

    if (normalized === MANIFEST_ENTRY) {
      if (size > ARCHIVE_LIMITS.maxManifestBytes) throw new ArchiveRejectedError('Backup manifest is too large.');
      manifest = { kind: 'manifest', archivePath: normalized, relPath: null, info };
    } else if (normalized.toLowerCase() === DATABASE_ENTRY) {
      // Case-insensitive match is intentional for Windows-created archives, but the
      // canonical name must be exact to avoid two databases with different casing.
      if (normalized !== DATABASE_ENTRY) throw new ArchiveRejectedError('Database entry name is not canonical.');
      database = { kind: 'database', archivePath: normalized, relPath: null, info };
    } else if (normalized.startsWith(ATTACHMENTS_PREFIX)) {
      const attRel = normalized.slice(ATTACHMENTS_PREFIX.length);
      const check = validateRelativePath(attRel, { maxDepth: ARCHIVE_LIMITS.maxAttachmentDepth });
      attachments.push({ kind: 'attachment', archivePath: normalized, relPath: check, info });
    } else {
      throw new ArchiveRejectedError(`Unexpected file in backup: ${printable(info.path)}`);
    }
  }

  if (!manifest) throw new ArchiveRejectedError('Backup is incomplete: manifest.json is missing.');
  if (!database) throw new ArchiveRejectedError('Backup is incomplete: database file is missing.');
  return { manifest, database, attachments };
}

/** Counts bytes flowing through a stream and aborts when a byte limit is exceeded. */
export function byteLimiter(maxBytes: number, label: string): { stream: Transform; bytes: () => number } {
  let seen = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) {
        cb(new ArchiveRejectedError(`${label} is larger than its declared size; the backup is corrupt.`));
        return;
      }
      cb(null, chunk);
    },
  });
  return { stream, bytes: () => seen };
}

function printable(s: string): string {
  // Never echo control characters back into UI messages.
  // eslint-disable-next-line no-control-regex -- sanitising for display
  return `"${String(s).replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 120)}"`;
}
