import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_LIMITS,
  ArchiveRejectedError,
  planArchive,
  resolveInside,
  validateRelativePath,
  type ArchiveEntryInfo,
} from '../../src/main/services/archive-safety';
import path from 'node:path';

const file = (p: string, size = 10, extra: Partial<ArchiveEntryInfo> = {}): ArchiveEntryInfo => ({
  path: p, type: 'File', uncompressedSize: size, compressedSize: size, ...extra,
});
const dir = (p: string): ArchiveEntryInfo => ({ path: p, type: 'Directory', uncompressedSize: 0, compressedSize: 0 });
const base = (): ArchiveEntryInfo[] => [file('manifest.json', 100), file('database/dentiva.db', 4096)];

function rejects(entries: ArchiveEntryInfo[], pattern: RegExp): void {
  let caught: unknown = null;
  try { planArchive(entries); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(ArchiveRejectedError);
  expect((caught as Error).message).toMatch(pattern);
}

describe('planArchive — accepted archives', () => {
  it('accepts manifest, database and nested attachments', () => {
    const plan = planArchive([
      ...base(),
      dir('attachments/'),
      file('attachments/patient/3/1700000000000-abcdef-scan.pdf', 2048),
      file('attachments/invoice/9/note.txt', 12),
    ]);
    expect(plan.manifest.archivePath).toBe('manifest.json');
    expect(plan.database.archivePath).toBe('database/dentiva.db');
    expect(plan.attachments.map((a) => a.relPath)).toEqual([
      'patient/3/1700000000000-abcdef-scan.pdf',
      'invoice/9/note.txt',
    ]);
  });

  it('accepts an archive with no attachments folder at all', () => {
    expect(planArchive(base()).attachments).toEqual([]);
  });
});

describe('planArchive — malicious or malformed archives are rejected', () => {
  it.each([
    ['relative traversal', 'attachments/../../escape.txt'],
    ['leading traversal', '../escape.txt'],
    ['dot segment', 'attachments/./x.txt'],
    ['absolute POSIX path', '/etc/passwd'],
    ['absolute path inside attachments', 'attachments//etc/x'],
    ['drive-letter path', 'C:/Windows/evil.txt'],
    ['drive-relative path', 'D:evil.txt'],
    ['UNC path', '//server/share/evil.txt'],
    ['backslash separator', 'attachments\\..\\evil.txt'],
    ['control character', 'attachments/bad\u0001name.txt'],
    ['reserved device name', 'attachments/CON'],
    ['reserved device with extension', 'attachments/lpt1.txt'],
    ['trailing dot', 'attachments/evil.'],
    ['trailing space', 'attachments/evil.txt '],
    ['forbidden colon (alternate data stream)', 'attachments/file.txt:hidden'],
    ['empty segment', 'attachments//x.txt'],
  ])('rejects %s', (_label, name) => {
    rejects([...base(), file(name)], /./);
  });

  it('rejects an entry name that exceeds the length cap', () => {
    const long = `attachments/${'a'.repeat(ARCHIVE_LIMITS.maxPathLength)}`;
    rejects([...base(), file(long)], /too long/);
  });

  it('rejects attachment paths nested beyond the depth limit', () => {
    const deep = `attachments/${Array.from({ length: ARCHIVE_LIMITS.maxAttachmentDepth + 1 }, (_, i) => `d${i}`).join('/')}/x.txt`;
    rejects([...base(), file(deep)], /nested too deeply|too deeply/);
  });

  it('rejects case-insensitive duplicate entries (Windows collision)', () => {
    rejects([...base(), file('attachments/A.txt'), file('attachments/a.txt')], /Duplicate or conflicting/);
  });

  it('rejects exact duplicate entries', () => {
    rejects([...base(), file('attachments/x.txt'), file('attachments/x.txt')], /Duplicate/);
  });

  it('rejects a second manifest/database that differs only by case', () => {
    rejects([...base(), file('Database/DENTIVA.DB', 10)], /Duplicate|not canonical|Unexpected/);
  });

  it('rejects symbolic links', () => {
    rejects([...base(), file('attachments/link', 5, { externalFileAttributes: (0o120777 << 16) >>> 0 })], /Symbolic links/);
  });

  it('rejects FIFOs and device nodes', () => {
    rejects([...base(), file('attachments/pipe', 0, { externalFileAttributes: (0o010644 << 16) >>> 0 })], /special file/);
    rejects([...base(), file('attachments/dev', 0, { externalFileAttributes: (0o020644 << 16) >>> 0 })], /special file/);
  });

  it('accepts regular files with unix mode bits', () => {
    expect(() => planArchive([...base(), file('attachments/ok.txt', 5, { externalFileAttributes: (0o100644 << 16) >>> 0 })])).not.toThrow();
  });

  it('rejects unexpected top-level files and directories', () => {
    rejects([...base(), file('evil.sh')], /Unexpected file/);
    rejects([...base(), file('startup/run.bat')], /Unexpected file/);
    rejects([...base(), dir('etc/')], /Unexpected directory/);
  });

  it('rejects archives missing the manifest or database', () => {
    rejects([file('database/dentiva.db', 10)], /manifest/);
    rejects([file('manifest.json', 10)], /database file is missing/);
  });

  it('rejects too many entries', () => {
    const many: ArchiveEntryInfo[] = [...base()];
    for (let i = 0; i <= ARCHIVE_LIMITS.maxEntries; i++) many.push(file(`attachments/f${i}.txt`, 1));
    rejects(many, /too many entries/);
  });

  it('rejects a compression bomb (huge expansion ratio)', () => {
    const bomb = file('attachments/bomb.bin', ARCHIVE_LIMITS.ratioCheckMinBytes * 4, { compressedSize: 1024 });
    rejects([...base(), bomb], /compression ratio/);
  });

  it('rejects an entry declared larger than the single-entry ceiling', () => {
    rejects([...base(), file('attachments/huge.bin', ARCHIVE_LIMITS.maxEntryUncompressedBytes + 1, { compressedSize: ARCHIVE_LIMITS.maxEntryUncompressedBytes })], /too large/);
  });

  it('rejects a total expansion above the aggregate limit', () => {
    const big = Array.from({ length: 6 }, (_, i) => file(`attachments/big${i}.bin`, ARCHIVE_LIMITS.maxEntryUncompressedBytes, { compressedSize: ARCHIVE_LIMITS.maxEntryUncompressedBytes }));
    rejects([...base(), ...big], /size limit|too large/);
  });

  it('rejects an oversized manifest', () => {
    rejects([file('manifest.json', ARCHIVE_LIMITS.maxManifestBytes + 1), file('database/dentiva.db', 10)], /manifest is too large/);
  });
});

describe('path containment helpers', () => {
  const root = path.resolve('/tmp/staging-root');

  it('resolves ordinary nested relative paths inside the root', () => {
    expect(resolveInside(root, 'patient/3/scan.pdf')).toBe(path.join(root, 'patient', '3', 'scan.pdf'));
  });

  it.each(['../x', 'a/../../x', '..', '/etc/passwd'])('refuses escaping path %s', (rel) => {
    expect(() => {
      const safe = validateRelativePath(rel);
      resolveInside(root, safe);
    }).toThrow(ArchiveRejectedError);
  });

  it('refuses the root itself', () => {
    expect(() => resolveInside(root, '')).toThrow(ArchiveRejectedError);
  });
});
