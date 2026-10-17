// Renders scripts/og/og.html to public/og.jpg (1200x630), the site's social share image.
// Usage: node scripts/og/render.mjs   (needs Playwright with Chromium installed)
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const html = new URL('./og.html', import.meta.url);
const out = fileURLToPath(new URL('../../public/og.jpg', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(html.href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
await browser.close();
console.log(`Wrote ${out}`);
