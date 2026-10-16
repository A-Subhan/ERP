/* ===========================================================================
 * E2E smoke walk — logs in as admin and visits every route in the permission
 * registry. Fails on: console errors, page crashes, "Page not found", and
 * reports any "Coming next" panels (those are tracked stubs, listed separately).
 * Run:  npm run e2e   (starts nothing itself; backend 4000 + frontend 5173 must run)
 * ==========================================================================*/
import { chromium, Browser, Page } from 'playwright';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const USER = process.env.E2E_USER || 'admin';
const PASS = process.env.E2E_PASS || 'admin12345';

const ROUTES: Array<{ path: string; name: string }> = [
  { path: '/', name: 'overview' },
  { path: '/dashboards/sales', name: 'sales_dashboard' },
  { path: '/dashboards/purchase', name: 'purchase_dashboard' },
  { path: '/dashboards/receivables-payables', name: 'receivables_payables_dashboard' },
  { path: '/dashboards/stock', name: 'stock_dashboard' },
  { path: '/finance/cash-receipt', name: 'cash_receipt' },
  { path: '/finance/cash-payment', name: 'cash_payment' },
  { path: '/finance/bank-receipt', name: 'bank_receipt' },
  { path: '/finance/bank-payment', name: 'bank_payment' },
  { path: '/finance/journal-voucher', name: 'journal_voucher' },
  { path: '/finance/opening-trial-balance', name: 'opening_trial_balance' },
  { path: '/finance/bank-reconciliation', name: 'bank_reconciliation' },
  { path: '/finance/update-cheque-status', name: 'update_cheque_status' },
  { path: '/finance/chart-of-accounts', name: 'chart_of_accounts' },
  { path: '/finance/tax-heads', name: 'tax_heads' },
  { path: '/finance/reports/general-ledger', name: 'general_ledger' },
  { path: '/finance/reports/trial-balance', name: 'trial_balance' },
  { path: '/finance/reports/income-statement', name: 'income_statement' },
  { path: '/finance/reports/balance-sheet', name: 'balance_sheet' },
  { path: '/finance/reports/aging-customer', name: 'aging_reports' },
  { path: '/finance/reports/aging-supplier', name: 'aging_reports_supplier' },
  { path: '/sales/orders', name: 'sales_order' },
  { path: '/sales/challans', name: 'delivery_challan' },
  { path: '/sales/invoices', name: 'sales_invoice' },
  { path: '/sales/credit-notes', name: 'credit_note' },
  { path: '/sales/reports/sales', name: 'sales_report' },
  { path: '/sales/reports/return', name: 'sales_return_report' },
  { path: '/purchase/requisitions', name: 'purchase_requisition' },
  { path: '/purchase/orders', name: 'purchase_order' },
  { path: '/purchase/receiving', name: 'receiving_challan' },
  { path: '/purchase/invoices', name: 'purchase_invoice' },
  { path: '/purchase/debit-notes', name: 'debit_note' },
  { path: '/purchase/reports/purchase', name: 'purchase_report' },
  { path: '/purchase/reports/return', name: 'purchase_return_report' },
  { path: '/inventory/products', name: 'product_master' },
  { path: '/inventory/opening-stock', name: 'opening_stock' },
  { path: '/inventory/moves', name: 'move_stock' },
  { path: '/inventory/adjustments', name: 'adjust_stock' },
  { path: '/inventory/stock-ledger', name: 'stock_ledger' },
  { path: '/inventory/reports/inventory', name: 'inventory_report' },
  { path: '/inventory/reports/movement', name: 'movement_report' },
  { path: '/inventory/reports/adjustment', name: 'adjustment_report' },
  { path: '/admin/default', name: 'default_page' },
  { path: '/admin/branches', name: 'branches' },
  { path: '/admin/stores', name: 'stores' },
  { path: '/admin/users', name: 'users' },
  { path: '/admin/units', name: 'units' },
  { path: '/admin/audit-log', name: 'audit_log' },
];

interface Result {
  name: string;
  path: string;
  status: 'ok' | 'not-found' | 'stub' | 'error';
  consoleErrors: string[];
  detail?: string;
}

async function main() {
  const browser: Browser = await chromium.launch();
  const page = await browser.newPage();
  const results: Result[] = [];

  // Login once
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#u', USER);
  await page.fill('#p', PASS);
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Chart of Accounts', { timeout: 15000 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  for (const r of ROUTES) {
    const consoleErrors: string[] = [];
    const onPage: Page = page;
    const handler = (msg: any) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)); };
    onPage.on('console', handler);
    let status: Result['status'] = 'ok';
    let detail: string | undefined;
    try {
      await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(400);
      const body = (await page.textContent('body')) || '';
      if (/Page not found/i.test(body)) { status = 'not-found'; detail = 'renders Page not found'; }
      else if (/being completed next/i.test(body)) { status = 'stub'; detail = 'renders placeholder panel'; }
    } catch (e: any) {
      status = 'error';
      detail = String(e.message || e).slice(0, 200);
    }
    onPage.off('console', handler);
    results.push({ name: r.name, path: r.path, status, consoleErrors, detail });
  }

  await browser.close();

  // Report
  const bad = results.filter((r) => r.status !== 'ok' || r.consoleErrors.length > 0);
  const stubs = results.filter((r) => r.status === 'stub');
  console.log('\n=== SCREEN WALK RESULTS ===');
  for (const r of results) {
    const flag = r.status === 'ok' && r.consoleErrors.length === 0 ? 'OK  ' : r.status.toUpperCase().padEnd(5);
    console.log(`${flag} ${r.name.padEnd(32)} ${r.path}${r.detail ? '  — ' + r.detail : ''}`);
    for (const ce of r.consoleErrors) console.log(`      console: ${ce}`);
  }
  console.log(`\nTotal routes: ${results.length}`);
  console.log(`OK: ${results.length - bad.length}`);
  console.log(`Stubs (Coming next): ${stubs.length}`);
  console.log(`Broken (not-found/error/console): ${bad.filter((r) => r.status !== 'stub').length}`);
  if (bad.some((r) => r.status !== 'stub')) process.exit(1);
}

main().catch((e) => { console.error('E2E runner failed:', e); process.exit(2); });
