import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Navigation policy for application windows (V5-004).
 *
 * The preload bridge is attached to a window, not to a page: whatever page a
 * window shows receives `window.dentiva`. A window may therefore only ever
 * display the packaged renderer entry (`dist/renderer/index.html`, any hash or
 * query). Any other URL — another local file, a remote site, a data/javascript
 * URL — is refused. In-page hash routing does not emit `will-navigate`.
 */
export function isAppEntryUrl(url: string, appHtmlPath: string, platform: NodeJS.Platform = process.platform): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'file:') return false;
  if (parsed.host && parsed.host.toLowerCase() !== 'localhost') return false;
  let filePath: string;
  try {
    filePath = fileURLToPath(new URL(`file://${parsed.pathname}`), { windows: platform === 'win32' } as never);
  } catch {
    return false;
  }
  const api = platform === 'win32' ? path.win32 : path.posix;
  const a = api.normalize(filePath);
  const b = api.normalize(appHtmlPath);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
