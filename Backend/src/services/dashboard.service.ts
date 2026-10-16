/* ===========================================================================
 * Dashboard service — read-only aggregates that mirror the report totals.
 * Each dashboard returns the same numbers as the corresponding report for
 * the same filters (verified by tests in tests/engines.test.ts when run
 * against a real SQL Server instance).
 * ==========================================================================*/
import { getPool, sql } from '../db/pool';

export interface DashFilters { branchId?: number | null; fromDate?: string; toDate?: string; }

async function getSettingsAccountCodes(): Promise<any> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT sales_account_code, sales_returns_account_code,
           output_sales_tax_account_code, input_sales_tax_account_code,
           inventory_account_code, cogs_account_code,
           default_cash_account_code, default_bank_account_code
    FROM dbo.settings WHERE id = 1
  `);
  return r.recordset[0];
}

// ---------------------------------------------------------------------------
// Sales dashboard: total sales, returns, net sales, invoice count,
// top 5 customers, top 5 products.
// ---------------------------------------------------------------------------
export async function salesDashboard(f: DashFilters): Promise<any> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('fd', sql.Date, f.fromDate ?? null)
    .input('td', sql.Date, f.toDate ?? null)
    .query(`
      SELECT
        ISNULL(SUM(s.subtotal), 0) AS total_sales,
        (SELECT ISNULL(SUM(cn.subtotal), 0) FROM dbo.credit_notes cn
          WHERE (@bid IS NULL OR cn.branch_id = @bid)
            AND (@fd IS NULL OR cn.doc_date >= @fd)
            AND (@td IS NULL OR cn.doc_date <= @td)) AS total_returns,
        COUNT(DISTINCT s.id) AS invoice_count
      FROM dbo.sales_invoices s
      WHERE (@bid IS NULL OR s.branch_id = @bid)
        AND (@fd IS NULL OR s.doc_date >= @fd)
        AND (@td IS NULL OR s.doc_date <= @td)
    `);
  const totalSales = Number(r.recordset[0].total_sales) || 0;
  const totalReturns = Number(r.recordset[0].total_returns) || 0;
  const invoiceCount = Number(r.recordset[0].invoice_count) || 0;
  const topCustR = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('fd', sql.Date, f.fromDate ?? null)
    .input('td', sql.Date, f.toDate ?? null)
    .query(`
      SELECT TOP 5 a.code, a.name, SUM(s.grand_total) AS amount
      FROM dbo.sales_invoices s
      JOIN dbo.accounts a ON a.code = s.customer_code
      WHERE (@bid IS NULL OR s.branch_id = @bid)
        AND (@fd IS NULL OR s.doc_date >= @fd) AND (@td IS NULL OR s.doc_date <= @td)
      GROUP BY a.code, a.name
      ORDER BY amount DESC
    `);
  const topProdR = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('fd', sql.Date, f.fromDate ?? null)
    .input('td', sql.Date, f.toDate ?? null)
    .query(`
      SELECT TOP 5 p.code, p.name, SUM(sil.quantity) AS qty, SUM(sil.line_amount) AS amount
      FROM dbo.sales_invoice_lines sil
      JOIN dbo.sales_invoices s ON s.id = sil.invoice_id
      JOIN dbo.products p ON p.id = sil.product_id
      WHERE (@bid IS NULL OR s.branch_id = @bid)
        AND (@fd IS NULL OR s.doc_date >= @fd) AND (@td IS NULL OR s.doc_date <= @td)
      GROUP BY p.code, p.name
      ORDER BY amount DESC
    `);
  return {
    totalSales, totalReturns, netSales: totalSales - totalReturns, invoiceCount,
    topCustomers: topCustR.recordset.map((row: any) => ({ ...row, amount: Number(row.amount) })),
    topProducts: topProdR.recordset.map((row: any) => ({ ...row, qty: Number(row.qty), amount: Number(row.amount) })),
  };
}

// ---------------------------------------------------------------------------
// Purchase dashboard
// ---------------------------------------------------------------------------
export async function purchaseDashboard(f: DashFilters): Promise<any> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('fd', sql.Date, f.fromDate ?? null)
    .input('td', sql.Date, f.toDate ?? null)
    .query(`
      SELECT
        ISNULL(SUM(p.subtotal), 0) AS total_purchases,
        (SELECT ISNULL(SUM(dn.subtotal), 0) FROM dbo.debit_notes dn
          WHERE (@bid IS NULL OR dn.branch_id = @bid)
            AND (@fd IS NULL OR dn.doc_date >= @fd)
            AND (@td IS NULL OR dn.doc_date <= @td)) AS total_returns,
        COUNT(DISTINCT p.id) AS invoice_count
      FROM dbo.purchase_invoices p
      WHERE (@bid IS NULL OR p.branch_id = @bid)
        AND (@fd IS NULL OR p.doc_date >= @fd)
        AND (@td IS NULL OR p.doc_date <= @td)
    `);
  const totalPurchases = Number(r.recordset[0].total_purchases) || 0;
  const totalReturns = Number(r.recordset[0].total_returns) || 0;
  const invoiceCount = Number(r.recordset[0].invoice_count) || 0;
  const topSupR = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('fd', sql.Date, f.fromDate ?? null)
    .input('td', sql.Date, f.toDate ?? null)
    .query(`
      SELECT TOP 5 a.code, a.name, SUM(p.grand_total) AS amount
      FROM dbo.purchase_invoices p
      JOIN dbo.accounts a ON a.code = p.supplier_code
      WHERE (@bid IS NULL OR p.branch_id = @bid)
        AND (@fd IS NULL OR p.doc_date >= @fd) AND (@td IS NULL OR p.doc_date <= @td)
      GROUP BY a.code, a.name
      ORDER BY amount DESC
    `);
  const topProdR = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('fd', sql.Date, f.fromDate ?? null)
    .input('td', sql.Date, f.toDate ?? null)
    .query(`
      SELECT TOP 5 p.code, p.name, SUM(pil.quantity) AS qty, SUM(pil.line_amount) AS amount
      FROM dbo.purchase_invoice_lines pil
      JOIN dbo.purchase_invoices pi ON pi.id = pil.invoice_id
      JOIN dbo.products p ON p.id = pil.product_id
      WHERE (@bid IS NULL OR pi.branch_id = @bid)
        AND (@fd IS NULL OR pi.doc_date >= @fd) AND (@td IS NULL OR pi.doc_date <= @td)
      GROUP BY p.code, p.name
      ORDER BY amount DESC
    `);
  return {
    totalPurchases, totalReturns, netPurchases: totalPurchases - totalReturns, invoiceCount,
    topSuppliers: topSupR.recordset.map((row: any) => ({ ...row, amount: Number(row.amount) })),
    topProducts: topProdR.recordset.map((row: any) => ({ ...row, qty: Number(row.qty), amount: Number(row.amount) })),
  };
}

// ---------------------------------------------------------------------------
// Receivables and Payables dashboard
// ---------------------------------------------------------------------------
export async function receivablesPayablesDashboard(f: { asOfDate: string; branchId?: number | null }): Promise<any> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('d', sql.Date, f.asOfDate)
    .query(`
      SELECT
        (SELECT ISNULL(SUM(net_amount - settled_amount), 0) FROM dbo.bills b
          JOIN dbo.accounts a ON a.code = b.party_account_code
          WHERE a.party_type = 'CUSTOMER' AND b.doc_date <= @d
            AND (@bid IS NULL OR b.branch_id = @bid)) AS total_receivable,
        (SELECT ISNULL(SUM(net_amount - settled_amount), 0) FROM dbo.bills b
          JOIN dbo.accounts a ON a.code = b.party_account_code
          WHERE a.party_type = 'SUPPLIER' AND b.doc_date <= @d
            AND (@bid IS NULL OR b.branch_id = @bid)) AS total_payable,
        (SELECT ISNULL(SUM(net_amount - settled_amount), 0) FROM dbo.bills b
          JOIN dbo.accounts a ON a.code = b.party_account_code
          WHERE a.party_type = 'CUSTOMER' AND b.due_date < @d AND b.settled_amount < b.net_amount
            AND (@bid IS NULL OR b.branch_id = @bid)) AS overdue_receivable,
        (SELECT ISNULL(SUM(net_amount - settled_amount), 0) FROM dbo.bills b
          JOIN dbo.accounts a ON a.code = b.party_account_code
          WHERE a.party_type = 'SUPPLIER' AND b.due_date < @d AND b.settled_amount < b.net_amount
            AND (@bid IS NULL OR b.branch_id = @bid)) AS overdue_payable
    `);
  const topDebtorsR = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('d', sql.Date, f.asOfDate)
    .query(`
      SELECT TOP 5 a.code, a.name, SUM(b.net_amount - b.settled_amount) AS outstanding
      FROM dbo.bills b JOIN dbo.accounts a ON a.code = b.party_account_code
      WHERE a.party_type = 'CUSTOMER' AND b.doc_date <= @d AND b.settled_amount < b.net_amount
        AND (@bid IS NULL OR b.branch_id = @bid)
      GROUP BY a.code, a.name ORDER BY outstanding DESC
    `);
  const topCreditorsR = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('d', sql.Date, f.asOfDate)
    .query(`
      SELECT TOP 5 a.code, a.name, SUM(b.net_amount - b.settled_amount) AS outstanding
      FROM dbo.bills b JOIN dbo.accounts a ON a.code = b.party_account_code
      WHERE a.party_type = 'SUPPLIER' AND b.doc_date <= @d AND b.settled_amount < b.net_amount
        AND (@bid IS NULL OR b.branch_id = @bid)
      GROUP BY a.code, a.name ORDER BY outstanding DESC
    `);
  return {
    totalReceivable: Number(r.recordset[0].total_receivable) || 0,
    totalPayable: Number(r.recordset[0].total_payable) || 0,
    overdueReceivable: Number(r.recordset[0].overdue_receivable) || 0,
    overduePayable: Number(r.recordset[0].overdue_payable) || 0,
    topDebtors: topDebtorsR.recordset.map((row: any) => ({ ...row, outstanding: Number(row.outstanding) })),
    topCreditors: topCreditorsR.recordset.map((row: any) => ({ ...row, outstanding: Number(row.outstanding) })),
  };
}

// ---------------------------------------------------------------------------
// Stock dashboard
// ---------------------------------------------------------------------------
export async function stockDashboard(f: { asOfDate: string; branchId?: number | null }): Promise<any> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .input('d', sql.Date, f.asOfDate)
    .query(`
      SELECT
        ISNULL(SUM(sb.quantity * sb.avg_cost), 0) AS total_value,
        ISNULL(SUM(sb.quantity), 0) AS total_qty,
        (SELECT COUNT(*) FROM dbo.products p
          WHERE p.is_group = 0 AND p.is_active = 1
            AND p.reorder_level > 0
            AND EXISTS (SELECT 1 FROM dbo.stock_balances sb2 WHERE sb2.product_id = p.id AND sb2.quantity <= p.reorder_level)) AS below_reorder_count
      FROM dbo.stock_balances sb
      JOIN dbo.products p ON p.id = sb.product_id
      JOIN dbo.stores s ON s.id = sb.store_id
      WHERE (@bid IS NULL OR EXISTS (
        SELECT 1 FROM dbo.store_branch_tags t WHERE t.store_id = s.id AND t.branch_id = @bid))
    `);
  const belowReorderR = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .query(`
      SELECT p.code, p.name, sb.quantity, p.reorder_level
      FROM dbo.products p
      JOIN dbo.stock_balances sb ON sb.product_id = p.id
      JOIN dbo.stores s ON s.id = sb.store_id
      WHERE p.is_group = 0 AND p.is_active = 1
        AND p.reorder_level > 0
        AND sb.quantity <= p.reorder_level
        AND (@bid IS NULL OR EXISTS (SELECT 1 FROM dbo.store_branch_tags t WHERE t.store_id = s.id AND t.branch_id = @bid))
      ORDER BY p.code
    `);
  const byStoreR = await pool.request()
    .input('bid', sql.Int, f.branchId ?? null)
    .query(`
      SELECT s.code AS store_code, s.name AS store_name,
             ISNULL(SUM(sb.quantity), 0) AS qty,
             ISNULL(SUM(sb.quantity * sb.avg_cost), 0) AS value
      FROM dbo.stores s
      LEFT JOIN dbo.stock_balances sb ON sb.store_id = s.id
      WHERE s.store_type = 'STOCK'
        AND (@bid IS NULL OR EXISTS (SELECT 1 FROM dbo.store_branch_tags t WHERE t.store_id = s.id AND t.branch_id = @bid))
      GROUP BY s.code, s.name
      ORDER BY value DESC
    `);
  return {
    totalValue: Number(r.recordset[0].total_value) || 0,
    totalQty: Number(r.recordset[0].total_qty) || 0,
    belowReorderCount: Number(r.recordset[0].below_reorder_count) || 0,
    belowReorder: belowReorderR.recordset.map((row: any) => ({ ...row, quantity: Number(row.quantity), reorderLevel: Number(row.reorder_level) })),
    byStore: byStoreR.recordset.map((row: any) => ({ ...row, qty: Number(row.qty), value: Number(row.value) })),
  };
}
