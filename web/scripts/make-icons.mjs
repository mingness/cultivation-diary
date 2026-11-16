/**
 * Renders the app icons with the test browser, so no image tool is needed:
 *   node web/scripts/make-icons.mjs
 * A placeholder design: cream 修 on brown (web/public/icons/). Replace the PNGs with real artwork any time (keep the sizes; the maskable one keeps its mark inside the middle 80%, which Android
 * may crop to a circle).
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const sites = [
  { dir: '../public/icons/', glyph: '修', background: '#7A4E24', color: '#F6F2EC', scale: 1 },
];
const icons = [
  { name: 'icon-192.png', size: 192, glyph: 0.62, radius: 0.18 },
  { name: 'icon-512.png', size: 512, glyph: 0.62, radius: 0.18 },
  // Full-bleed background, smaller mark: the safe zone is the middle 80%.
  { name: 'icon-maskable-512.png', size: 512, glyph: 0.46, radius: 0 },
  { name: 'apple-touch-icon.png', size: 180, glyph: 0.62, radius: 0 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const site of sites) {
  const out = fileURLToPath(new URL(site.dir, import.meta.url));
  for (const icon of icons) {
    const font = Math.round(icon.glyph * site.scale * icon.size);
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
      <div style="width:${icon.size}px;height:${icon.size}px;background:${site.background};border-radius:${icon.radius * icon.size}px;
        display:flex;align-items:center;justify-content:center;color:${site.color};
        font:${font}px 'Noto Serif CJK TC','Songti TC',serif;line-height:1">${site.glyph}</div>
      </body></html>`);
    await page.screenshot({ path: `${out}${icon.name}`, omitBackground: true });
  }
  process.stdout.write(`Wrote ${icons.length} icons to ${out}\n`);
}
await browser.close();
