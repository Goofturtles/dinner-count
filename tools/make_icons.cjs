// Rasterise public/app/icons/icon.svg into the PNGs iOS and Android need.
// node tools/make_icons.cjs   (uses the installed Chrome via Playwright; headless, no window)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dir = path.join(__dirname, '..', 'public', 'app', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
// Full-bleed variants: iOS rounds corners itself; maskable needs a safe zone.
const square = svg.replace('rx="112"', 'rx="0"');
const maskable = square.replace('<circle cx="256" cy="268" r="150"', '<g transform="translate(256 268) scale(.8) translate(-256 -268)"><circle cx="256" cy="268" r="150"').replace('</svg>', '</g></svg>');
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="50" r="30" fill="none" stroke="#000" stroke-width="8"/><path d="M48 50V32M48 50l12 7" stroke="#000" stroke-width="8" stroke-linecap="round"/></svg>`;

const jobs = [
  ['apple-touch-icon.png', square, 180], ['icon-192.png', svg, 192], ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', maskable, 512], ['badge-96.png', badge, 96],
];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  for (const [name, src, size] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(dir, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', name);
  }
  await browser.close();
})();
