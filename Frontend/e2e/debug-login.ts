import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)));
  page.on('response', (r) => { if (r.url().includes('/api/')) console.log('[api]', r.status(), r.request().method(), r.url()); });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  console.log('URL after goto:', page.url());
  const u = await page.$('#u'); const p = await page.$('#p');
  console.log('inputs found:', !!u, !!p);
  if (u && p) {
    await u.fill('admin'); await p.fill('admin12345');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/login'), { timeout: 8000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ]);
    console.log('login response:', resp ? resp.status() : 'none');
    await page.waitForTimeout(2500);
    console.log('URL now:', page.url());
    console.log('body snippet:', ((await page.textContent('body')) || '').slice(0, 300).replace(/\s+/g, ' '));
  }
  await page.screenshot({ path: 'e2e/debug-login.png' });
  await browser.close();
})();
