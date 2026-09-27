/**
 * Generates Windows app icons from assets/icon-source.png.
 *  - build/icon.png  (512×512, used by electron-builder for win/nsis)
 *  - build/icon.ico  (16/32/48/64/128/256 multi-resolution, NSIS installer + exe)
 * Run: npm run icons
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import pngToIco from 'png-to-ico';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'assets', 'icon-source.png');
const outDir = path.join(root, 'build');

if (!fs.existsSync(src)) {
  console.error(`Missing source icon: ${src}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 32, 48, 64, 128, 256];
const image = await Jimp.read(src);

// 512 PNG (electron-builder fallback + Linux/mac targets)
const png512 = image.clone().resize({ w: 512, h: 512 });
await png512.write(path.join(outDir, 'icon.png'));

// Multi-resolution .ico
const pngs = [];
for (const size of sizes) {
  const buf = await image
    .clone()
    .resize({ w: size, h: size })
    .getBuffer('image/png');
  pngs.push(Buffer.from(buf));
}
const ico = await pngToIco(pngs);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

console.log(`icons written: build/icon.png (512), build/icon.ico (${sizes.join(', ')})`);
