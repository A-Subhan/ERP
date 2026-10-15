/* ===========================================================================
 * Report service — General Ledger, Trial Balance, Income Statement,
 * Balance Sheet, Aging (Customer-wise and Supplier-wise).
 * ==========================================================================*/
import { getPool, sql } from '../db/pool';

export interface ReportFilters {
  branchId?: number | null;
  fromDate?: string | null;
  toDate?: string | null;
  accountCodes?: string[] | null;
  asOfDate?: string | null;
}

// ---------------------------------------------------------------------------
// General Ledger: per account: opening, transactions, closing
// ---------------------------------------------------------------------------
export async function generalLedger(filters: ReportFilters): Promise<any[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, filters.branchId ?? null)
    .input('fd', sql.Date, filters.fromDate ?? null)
    .input('td', sql.Date, filters.toDate ?? null)
    .query(`
      ;WITH accounts AS (
        SELECT code, name, nature FROM dbo.accounts
        WHERE is_group = 0 AND is_active = 1
      ),
      opening AS (
        SELECT a.code, a.name,
               COALESCE(SUM(g.debit), 0) AS op_debit,
               COALESCE(SUM(g.credit), 0) AS op_credit
        FROM accounts a
        LEFT JOIN dbo.gl_entries g ON g.account_code = a.code
        WHERE (@bid IS NULL OR g.branch_id = @bid)
          AND g.entry_date < @fd
        GROUP BY a.code, a.name
      ),
      period AS (
        SELECT a.code,
               COALESCE(SUM(g.debit), 0) AS p_debit,
               COALESCE(SUM(g.credit), 0) AS p_credit
        FROM accounts a
        LEFT JOIN dbo.gl_entries g ON g.account_code = a.code
        WHERE (@bid IS NULL OR g.branch_id = @bid)
          AND g.entry_date >= @fd AND g.entry_date <= @td
        GROUP BY a.code
      )
      SELECT o.code, o.name,
             o.op_debit, o.op_credit,
             ISNULL(p.p_debit, 0) AS period_debit,
             ISNULL(p.p_credit, 0) AS period_credit,
             o.op_debit - o.op_credit + ISNULL(p.p_debit, 0) - ISNULL(p.p_credit, 0) AS closing_balance,
             CASE WHEN o.op_debit - o.op_credit >= 0 THEN 'DR' ELSE 'CR' END AS opening_nature,
             CASE WHEN o.op_debit - o.op_credit + ISNULL(p.p_debit, 0) - ISNULL(p.p_credit, 0) >= 0 THEN 'DR' ELSE 'CR' END AS closing_nature
      FROM opening o
      LEFT JOIN period p ON p.code = o.code
      ORDER BY o.code
    `);
  // For each account, also pull transactions
  const accounts: any[] = [];
  for (const a of r.recordset) {
    const tx = await pool.request()
      .input('ac', sql.VarChar, a.code)
      .input('bid', sql.Int, filters.branchId ?? null)
      .input('fd', sql.Date, filters.fromDate ?? null)
      .input('td', sql.Date, filters.toDate ?? null)
      .query(`
        SELECT g.entry_date, v.voucher_no, g.ref_doc_type, g.narration, g.debit, g.credit
        FROM dbo.gl_entries g
        LEFT JOIN dbo.vouchers v ON v.id = g.voucher_id
        WHERE g.account_code = @ac
          AND (@bid IS NULL OR g.branch_id = @bid)
          AND g.entry_date >= @fd AND g.entry_date <= @td
        ORDER BY g.entry_date, g.id
      `);
    accounts.push({ ...a, transactions: tx.recordset });
  }
  return accounts;
}

// ---------------------------------------------------------------------------
// Trial Balance: opening, period debit/credit, closing per account
// ---------------------------------------------------------------------------
export async function trialBalance(filters: ReportFilters, opts: { hideZeroRows?: boolean; levelDepth?: number } = {}): Promise<any> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, filters.branchId ?? null)
    .input('fd', sql.Date, filters.fromDate ?? null)
    .input('td', sql.Date, filters.toDate ?? null)
    .query(`
      SELECT a.code, a.name, a.nature, a.level_no,
             COALESCE(SUM(CASE WHEN g.entry_date < @fd THEN g.debit END), 0) AS opening_debit,
             COALESCE(SUM(CASE WHEN g.entry_date < @fd THEN g.credit END), 0) AS opening_credit,
             COALESCE(SUM(CASE WHEN g.entry_date >= @fd AND g.entry_date <= @td THEN g.debit END), 0) AS period_debit,
             COALESCE(SUM(CASE WHEN g.entry_date >= @fd AND g.entry_date <= @td THEN g.credit END), 0) AS period_credit,
             COALESCE(SUM(g.debit), 0) AS closing_debit,
             COALESCE(SUM(g.credit), 0) AS closing_credit
      FROM dbo.accounts a
      LEFT JOIN dbo.gl_entries g ON g.account_code = a.code
        AND (@bid IS NULL OR g.branch_id = @bid)
        AND (@td IS NULL OR g.entry_date <= @td)
      WHERE a.is_group = 0
      GROUP BY a.code, a.name, a.nature, a.level_no
      HAVING ${opts.hideZeroRows ? 'COALESCE(SUM(g.debit), 0) + COALESCE(SUM(g.credit), 0) > 0' : '1 = 1'}
      ORDER BY a.code
    `);
  const rows = r.recordset.map((row: any) => ({
    ...row,
    opening_balance: row.opening_debit - row.opening_credit,
    closing_balance: row.closing_debit - row.closing_credit,
  }));
  const totals = {
    opening_debit: rows.reduce((s, r) => s + r.opening_debit, 0),
    opening_credit: rows.reduce((s, r) => s + r.opening_credit, 0),
    period_debit: rows.reduce((s, r) => s + r.period_debit, 0),
    period_credit: rows.reduce((s, r) => s + r.period_credit, 0),
    closing_debit: rows.reduce((s, r) => s + (r.closing_balance > 0 ? r.closing_balance : 0), 0),
    closing_credit: rows.reduce((s, r) => s + (r.closing_balance < 0 ? -r.closing_balance : 0), 0),
  };
  return { rows, totals };
}

// ---------------------------------------------------------------------------
// Income Statement: revenue, cost of sales, expenses, profit/loss
// ---------------------------------------------------------------------------
export async function incomeStatement(filters: ReportFilters): Promise<any> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, filters.branchId ?? null)
    .input('fd', sql.Date, filters.fromDate ?? null)
    .input('td', sql.Date, filters.toDate ?? null)
    .query(`
      SELECT a.code, a.name, a.nature, a.level_no, a.parent_code,
             COALESCE(SUM(g.debit - g.credit), 0) AS net_movement
      FROM dbo.accounts a
      LEFT JOIN dbo.gl_entries g ON g.account_code = a.code
        AND (@bid IS NULL OR g.branch_id = @bid)
        AND g.entry_date >= @fd AND g.entry_date <= @td
      WHERE a.is_group = 0
        AND a.nature IN ('REVENUE','EXPENSE')
      GROUP BY a.code, a.name, a.nature, a.level_no, a.parent_code
      ORDER BY a.code
    `);

  const revenue = r.recordset.filter((x: any) => x.nature === 'REVENUE');
  const expenses = r.recordset.filter((x: any) => x.nature === 'EXPENSE');
  const totalRevenue = revenue.reduce((s, r) => s + (r.net_movement < 0 ? -r.net_movement : 0), 0);  // revenue credits
  const totalExpenses = expenses.reduce((s, r) => s + (r.net_movement > 0 ? r.net_movement : 0), 0);  // expense debits
  const netProfit = totalRevenue - totalExpenses;

  return {
    revenue, expenses,
    totalRevenue, totalExpenses, netProfit,
  };
}

// ---------------------------------------------------------------------------
// Balance Sheet: assets, liabilities, equity + accumulated profit
// ---------------------------------------------------------------------------
export async function balanceSheet(asOfDate: string, branchId: number | null): Promise<any> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, branchId ?? null)
    .input('td', sql.Date, asOfDate)
    .query(`
      SELECT a.code, a.name, a.nature, a.level_no, a.parent_code,
             COALESCE(SUM(g.debit - g.credit), 0) AS balance
      FROM dbo.accounts a
      LEFT JOIN dbo.gl_entries g ON g.account_code = a.code
        AND (@bid IS NULL OR g.branch_id = @bid)
        AND g.entry_date <= @td
      WHERE a.is_group = 0
        AND a.nature IN ('ASSET','LIABILITY','EQUITY')
      GROUP BY a.code, a.name, a.nature, a.level_no, a.parent_code
      HAVING COALESCE(SUM(g.debit - g.credit), 0) <> 0
      ORDER BY a.code
    `);

  // Compute current-year profit (revenue - expenses up to asOfDate)
  const pR = await pool.request()
    .input('bid', sql.Int, branchId ?? null)
    .input('td', sql.Date, asOfDate)
    .query(`
      SELECT
        ISNULL(SUM(CASE WHEN a.nature = 'REVENUE' THEN g.credit - g.debit ELSE 0 END), 0) -
        ISNULL(SUM(CASE WHEN a.nature = 'EXPENSE' THEN g.debit - g.credit ELSE 0 END), 0) AS profit_for_year
      FROM dbo.accounts a
      JOIN dbo.gl_entries g ON g.account_code = a.code
      WHERE a.is_group = 0
        AND a.nature IN ('REVENUE','EXPENSE')
        AND (@bid IS NULL OR g.branch_id = @bid)
        AND g.entry_date <= @td
    `);
  const profitForYear = pR.recordset[0].profit_for_year || 0;

  const assets = r.recordset.filter((x: any) => x.nature === 'ASSET' && x.balance !== 0);
  const liabilities = r.recordset.filter((x: any) => x.nature === 'LIABILITY' && x.balance !== 0);
  const equity = r.recordset.filter((x: any) => x.nature === 'EQUITY' && x.balance !== 0);
  // Add profit-for-year to equity
  if (Math.abs(profitForYear) > 0.01) {
    equity.push({
      code: '_PROFIT_YEAR', name: 'Profit for the year', nature: 'EQUITY', level_no: 0, parent_code: null,
      balance: -profitForYear,  // profit is a credit to equity
    });
  }
  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s - r.balance, 0);  // liabilities are credits
  const totalEquity = equity.reduce((s, r) => s - r.balance, 0);  // equity is credit
  return {
    assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity,
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
  };
}

// ---------------------------------------------------------------------------
// Aging (Customer-wise and Supplier-wise)
// ---------------------------------------------------------------------------
export async function aging(partyType: 'CUSTOMER' | 'SUPPLIER', asOfDate: string, branchId: number | null): Promise<any> {
  const pool = await getPool();
  // Get aging bucket config from settings
  const sR = await pool.request().query(`SELECT aging_bucket_1, aging_bucket_2, aging_bucket_3 FROM dbo.settings WHERE id = 1`);
  const b1 = sR.recordset[0].aging_bucket_1;
  const b2 = sR.recordset[0].aging_bucket_2;
  const b3 = sR.recordset[0].aging_bucket_3;

  const r = await pool.request()
    .input('pt', sql.VarChar, partyType)
    .input('td', sql.Date, asOfDate)
    .input('bid', sql.Int, branchId ?? null)
    .query(`
      SELECT a.code AS account_code, a.name AS account_name,
             b.id AS bill_id, b.bill_no, b.doc_date, b.due_date,
             b.net_amount, b.settled_amount,
             (b.net_amount - b.settled_amount) AS outstanding
      FROM dbo.accounts a
      JOIN dbo.bills b ON b.party_account_code = a.code
      WHERE a.party_type = @pt
        AND (@bid IS NULL OR b.branch_id = @bid)
        AND b.settled_amount < b.net_amount
        AND b.doc_date <= @td
      ORDER BY a.code, b.doc_date
    `);
  // Bucket each open bill by DATEDIFF(day, due_date, @td)
  const parties: any[] = [];
  const partyMap = new Map<string, any>();
  for (const row of r.recordset) {
    if (!partyMap.has(row.account_code)) {
      partyMap.set(row.account_code, {
        accountCode: row.account_code,
        accountName: row.account_name,
        current: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0,
        total: 0,
        bills: [],
      });
    }
    const p = partyMap.get(row.account_code);
    const daysOverdue = Math.max(0, Math.floor((new Date(asOfDate).getTime() - new Date(row.due_date ?? row.doc_date).getTime()) / (1000 * 60 * 60 * 24)));
    const amount = row.outstanding;
    p.total += amount;
    if (daysOverdue === 0) p.current += amount;
    else if (daysOverdue <= b1) p.b0_30 += amount;
    else if (daysOverdue <= b2) p.b31_60 += amount;
    else if (daysOverdue <= b3) p.b61_90 += amount;
    else p.b90_plus += amount;
    p.bills.push({ billNo: row.bill_no, docDate: row.doc_date, dueDate: row.due_date, amount, outstanding: amount });
  }
  for (const v of partyMap.values()) parties.push(v);
  return {
    buckets: [`Current`, `0-${b1}`, `${b1+1}-${b2}`, `${b2+1}-${b3}`, `${b3}+`],
    parties,
  };
}
