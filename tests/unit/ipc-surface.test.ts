// K-01 (feature parity): the IPC surface is closed. Every invoke channel the
// preload exposes (`IPC`, minus `event/*` push channels) has exactly one
// handler in the main process, every handler serves a declared channel, and
// nothing registers a raw string channel outside the shared map.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '../../src/shared/ipc';

const mainDir = path.resolve(__dirname, '..', '..', 'src', 'main');

function sources(dir: string): { file: string; text: string }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return e.name.endsWith('.ts') ? [{ file: path.relative(mainDir, p), text: fs.readFileSync(p, 'utf8') }] : [];
  });
}

describe('K-01 IPC surface', () => {
  const files = sources(mainDir);
  const handled = new Map<string, number>();
  for (const { text } of files) {
    for (const m of text.matchAll(/\bhandle\(IPC\.(\w+)/g)) handled.set(m[1], (handled.get(m[1]) ?? 0) + 1);
  }
  const invokeKeys = Object.entries(IPC).filter(([, ch]) => !String(ch).startsWith('event/')).map(([k]) => k);

  it('every invoke channel has exactly one handler', () => {
    const missing = invokeKeys.filter((k) => !handled.has(k));
    const duplicated = [...handled].filter(([, n]) => n > 1).map(([k]) => k);
    expect(missing).toEqual([]);
    expect(duplicated).toEqual([]);
  });

  it('every handler serves a declared, non-event channel', () => {
    const declared = new Set(invokeKeys);
    // Pre-existing (baseline 303712e): a no-op invoke handler on the
    // session-expired push channel. Unreachable — the preload never invokes
    // `event/*` channels — and kept for parity. It must stay a no-op.
    const legacyEventHandlers = ['onSessionExpired'];
    expect([...handled.keys()].filter((k) => !declared.has(k))).toEqual(legacyEventHandlers);
    const router = files.find(({ file }) => file === path.join('ipc', 'router.ts'))!.text;
    expect(router).toContain('handle(IPC.onSessionExpired, { auth: false, fn: () => null });');
  });

  it('ipcMain is used only by the router dispatcher (no raw string channels)', () => {
    const users = files.filter(({ text }) => /ipcMain\.(handle|on|once)\(/.test(text)).map(({ file }) => file);
    expect(users).toEqual([path.join('ipc', 'router.ts')]);
    const router = files.find(({ file }) => file === path.join('ipc', 'router.ts'))!.text;
    expect(router.match(/ipcMain\.(handle|on|once)\(/g)).toHaveLength(1);
    expect(router).not.toMatch(/ipcMain\.(handle|on|once)\(\s*['"`]/);
  });

  it('channel names are unique', () => {
    const values = Object.values(IPC).map(String);
    expect(new Set(values).size).toBe(values.length);
  });
});
