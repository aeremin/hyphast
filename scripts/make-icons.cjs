// Renders the PWA icons in public/ from favicon.svg and icon-maskable.svg.
// Run with `node scripts/make-icons.cjs` (needs Playwright with Chromium).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const pub = path.join(__dirname, '..', 'public');
const icons = [
  ['favicon.svg', 'icon-192.png', 192],
  ['favicon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
];

(async () => {
  const browser = await chromium.launch();
  for (const [src, out, size] of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = fs.readFileSync(path.join(pub, src), 'utf8');
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: path.join(pub, out), omitBackground: true });
    await page.close();
  }
  await browser.close();
})();
