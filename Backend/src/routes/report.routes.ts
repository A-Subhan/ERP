/* ===========================================================================
 * Report routes — General Ledger, Trial Balance, Income Statement,
 * Balance Sheet, Aging (Customer & Supplier)
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as reportService from '../services/report.service';

export const reportRouter = Router();
reportRouter.use(requireAuth);

const glSchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  fromDate: z.string(),
  toDate: z.string(),
});

const tbSchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  fromDate: z.string(),
  toDate: z.string(),
  hideZeroRows: z.coerce.boolean().optional(),
});

reportRouter.get('/general-ledger', requirePermission('general_ledger', 'view'), validateQuery(glSchema), async (req, res, next) => {
  try {
    res.json(await reportService.generalLedger({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      fromDate: req.query.fromDate as string,
      toDate: req.query.toDate as string,
    }));
  } catch (err) { next(err); }
});

reportRouter.get('/trial-balance', requirePermission('trial_balance', 'view'), validateQuery(tbSchema), async (req, res, next) => {
  try {
    res.json(await reportService.trialBalance({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      fromDate: req.query.fromDate as string,
      toDate: req.query.toDate as string,
    }, { hideZeroRows: req.query.hideZeroRows === 'true' }));
  } catch (err) { next(err); }
});

reportRouter.get('/income-statement', requirePermission('income_statement', 'view'), validateQuery(glSchema), async (req, res, next) => {
  try {
    res.json(await reportService.incomeStatement({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      fromDate: req.query.fromDate as string,
      toDate: req.query.toDate as string,
    }));
  } catch (err) { next(err); }
});

reportRouter.get('/balance-sheet', requirePermission('balance_sheet', 'view'), async (req, res, next) => {
  try {
    const asOfDate = req.query.asOfDate as string;
    if (!asOfDate) { res.status(400).json({ error: 'asOfDate is required.' }); return; }
    res.json(await reportService.balanceSheet(asOfDate, req.query.branchId ? Number(req.query.branchId) : null));
  } catch (err) { next(err); }
});

reportRouter.get('/aging/customer', requirePermission('aging_reports', 'view'), async (req, res, next) => {
  try {
    const asOfDate = req.query.asOfDate as string;
    if (!asOfDate) { res.status(400).json({ error: 'asOfDate is required.' }); return; }
    res.json(await reportService.aging('CUSTOMER', asOfDate, req.query.branchId ? Number(req.query.branchId) : null));
  } catch (err) { next(err); }
});

reportRouter.get('/aging/supplier', requirePermission('aging_reports', 'view'), async (req, res, next) => {
  try {
    const asOfDate = req.query.asOfDate as string;
    if (!asOfDate) { res.status(400).json({ error: 'asOfDate is required.' }); return; }
    res.json(await reportService.aging('SUPPLIER', asOfDate, req.query.branchId ? Number(req.query.branchId) : null));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Export endpoint — any report can be exported to PDF / Excel / CSV / Word.
// Path:  GET /api/reports/:kind/export?format=pdf|xlsx|csv|docx&...
//   kind ∈ {general-ledger, trial-balance, income-statement, balance-sheet,
//           aging-customer, aging-supplier}
//   filters: same query string as the JSON endpoints above.
// ---------------------------------------------------------------------------

import { exportReport, ExportFormat, ExportReport } from '../services/export.service';

const SCREEN_BY_KIND: Record<string, string> = {
  'general-ledger': 'general_ledger',
  'trial-balance': 'trial_balance',
  'income-statement': 'income_statement',
  'balance-sheet': 'balance_sheet',
  'aging-customer': 'aging_reports',
  'aging-supplier': 'aging_reports',
};

function reportToExport(kind: string, data: any, filtersLabel: string): ExportReport {
  if (kind === 'general-ledger') {
    const rows: any[] = [];
    for (const acct of (data as any[])) {
      for (const t of acct.transactions) {
        rows.push({
          account: `${acct.code} — ${acct.name}`,
          date: t.entry_date || '',
          voucher: t.voucher_no || t.ref_doc_type || '',
          narration: t.narration || '',
          debit: Number(t.debit || 0),
          credit: Number(t.credit || 0),
        });
      }
    }
    return {
      title: 'General Ledger',
      filters: [{ label: 'Filters', value: filtersLabel }],
      columns: [
        { key: 'account', label: 'Account', type: 'text', width: 30 },
        { key: 'date', label: 'Date', type: 'date', width: 12 },
        { key: 'voucher', label: 'Voucher', type: 'text', width: 16 },
        { key: 'narration', label: 'Narration', type: 'text', width: 40 },
        { key: 'debit', label: 'Debit', type: 'number', width: 14 },
        { key: 'credit', label: 'Credit', type: 'number', width: 14 },
      ],
      rows,
    };
  }
  if (kind === 'trial-balance') {
    return {
      title: 'Trial Balance',
      filters: [{ label: 'Filters', value: filtersLabel }],
      columns: [
        { key: 'code', label: 'Code', type: 'text', width: 14 },
        { key: 'name', label: 'Account', type: 'text', width: 36 },
        { key: 'opening_debit', label: 'Opening Dr', type: 'number', width: 14 },
        { key: 'opening_credit', label: 'Opening Cr', type: 'number', width: 14 },
        { key: 'period_debit', label: 'Period Dr', type: 'number', width: 14 },
        { key: 'period_credit', label: 'Period Cr', type: 'number', width: 14 },
        { key: 'closing_debit', label: 'Closing Dr', type: 'number', width: 14 },
        { key: 'closing_credit', label: 'Closing Cr', type: 'number', width: 14 },
      ],
      rows: data.rows.map((r: any) => ({
        code: r.code, name: r.name,
        opening_debit: Number(r.opening_debit), opening_credit: Number(r.opening_credit),
        period_debit: Number(r.period_debit), period_credit: Number(r.period_credit),
        closing_debit: r.closing_balance >= 0 ? Number(r.closing_balance) : 0,
        closing_credit: r.closing_balance < 0 ? Number(-r.closing_balance) : 0,
      })),
      totals: {
        opening_debit: Number(data.totals.opening_debit),
        opening_credit: Number(data.totals.opening_credit),
        period_debit: Number(data.totals.period_debit),
        period_credit: Number(data.totals.period_credit),
        closing_debit: Number(data.totals.closing_debit),
        closing_credit: Number(data.totals.closing_credit),
      },
    };
  }
  if (kind === 'income-statement') {
    const rows: any[] = [];
    for (const r of data.revenue) rows.push({ code: r.code, name: r.name, type: 'Revenue', amount: Math.abs(Number(r.net_movement)) });
    for (const r of data.expenses) rows.push({ code: r.code, name: r.name, type: 'Expense', amount: Math.abs(Number(r.net_movement)) });
    return {
      title: 'Income Statement',
      filters: [{ label: 'Filters', value: filtersLabel }],
      columns: [
        { key: 'code', label: 'Code', type: 'text', width: 14 },
        { key: 'name', label: 'Account', type: 'text', width: 36 },
        { key: 'type', label: 'Type', type: 'text', width: 12 },
        { key: 'amount', label: 'Amount', type: 'number', width: 16 },
      ],
      rows,
      totals: {
        totalRevenue: Number(data.totalRevenue),
        totalExpenses: Number(data.totalExpenses),
        netProfit: Number(data.netProfit),
      },
    };
  }
  if (kind === 'balance-sheet') {
    const rows: any[] = [];
    for (const r of data.assets) rows.push({ code: r.code, name: r.name, type: 'Asset', amount: Number(r.balance) });
    for (const r of data.liabilities) rows.push({ code: r.code, name: r.name, type: 'Liability', amount: Number(-r.balance) });
    for (const r of data.equity) rows.push({ code: r.code, name: r.name, type: 'Equity', amount: Number(-r.balance) });
    return {
      title: 'Balance Sheet',
      filters: [{ label: 'Filters', value: filtersLabel }],
      columns: [
        { key: 'code', label: 'Code', type: 'text', width: 14 },
        { key: 'name', label: 'Account', type: 'text', width: 36 },
        { key: 'type', label: 'Type', type: 'text', width: 12 },
        { key: 'amount', label: 'Amount', type: 'number', width: 16 },
      ],
      rows,
      totals: {
        totalAssets: Number(data.totalAssets),
        totalLiabilities: Number(data.totalLiabilities),
        totalEquity: Number(data.totalEquity),
      },
    };
  }
  if (kind === 'aging-customer' || kind === 'aging-supplier') {
    return {
      title: `Aging — ${kind === 'aging-customer' ? 'Customers' : 'Suppliers'}`,
      filters: [{ label: 'As of', value: filtersLabel }],
      columns: [
        { key: 'accountCode', label: 'Account code', type: 'text', width: 14 },
        { key: 'accountName', label: 'Name', type: 'text', width: 36 },
        { key: 'current', label: data.buckets[0], type: 'number', width: 12 },
        { key: 'b0_30', label: data.buckets[1], type: 'number', width: 12 },
        { key: 'b31_60', label: data.buckets[2], type: 'number', width: 12 },
        { key: 'b61_90', label: data.buckets[3], type: 'number', width: 12 },
        { key: 'b90_plus', label: data.buckets[4], type: 'number', width: 12 },
        { key: 'total', label: 'Total', type: 'number', width: 14 },
      ],
      rows: data.parties.map((p: any) => ({
        accountCode: p.accountCode, accountName: p.accountName,
        current: Number(p.current), b0_30: Number(p.b0_30), b31_60: Number(p.b31_60),
        b61_90: Number(p.b61_90), b90_plus: Number(p.b90_plus), total: Number(p.total),
      })),
    };
  }
  throw new Error(`Unknown report kind: ${kind}`);
}

async function fetchReportData(kind: string, req: any) {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  if (kind === 'general-ledger') {
    return reportService.generalLedger({ branchId, fromDate: req.query.fromDate, toDate: req.query.toDate });
  }
  if (kind === 'trial-balance') {
    return reportService.trialBalance({ branchId, fromDate: req.query.fromDate, toDate: req.query.toDate }, { hideZeroRows: req.query.hideZeroRows === 'true' });
  }
  if (kind === 'income-statement') {
    return reportService.incomeStatement({ branchId, fromDate: req.query.fromDate, toDate: req.query.toDate });
  }
  if (kind === 'balance-sheet') {
    const asOfDate = req.query.asOfDate as string;
    if (!asOfDate) throw new Error('asOfDate is required.');
    return reportService.balanceSheet(asOfDate, branchId);
  }
  if (kind === 'aging-customer' || kind === 'aging-supplier') {
    const asOfDate = req.query.asOfDate as string;
    if (!asOfDate) throw new Error('asOfDate is required.');
    return reportService.aging(kind === 'aging-customer' ? 'CUSTOMER' : 'SUPPLIER', asOfDate, branchId);
  }
  throw new Error(`Unknown report kind: ${kind}`);
}

function buildFiltersLabel(req: any, kind: string): string {
  const parts: string[] = [];
  if (req.query.branchId) parts.push(`Branch: ${req.query.branchId}`);
  if (req.query.fromDate) parts.push(`From: ${req.query.fromDate}`);
  if (req.query.toDate) parts.push(`To: ${req.query.toDate}`);
  if (req.query.asOfDate) parts.push(`As of: ${req.query.asOfDate}`);
  if (req.query.hideZeroRows === 'true') parts.push('Hide zero rows');
  return parts.join('  |  ') || '(no filters)';
}

reportRouter.get('/:kind/export', async (req, res, next) => {
  try {
    const kind = req.params.kind as string;
    const screen = SCREEN_BY_KIND[kind];
    if (!screen) { res.status(400).json({ error: `Unknown report kind: ${kind}` }); return; }
    // Require Print permission on the report's screen
    const checker = requirePermission(screen, 'print');
    await new Promise<void>((resolve, reject) => {
      checker(req, res, (err?: any) => err ? reject(err) : resolve());
    });
    const format = (req.query.format as ExportFormat) || 'pdf';
    if (!['pdf', 'xlsx', 'csv', 'docx'].includes(format)) {
      res.status(400).json({ error: 'format must be one of: pdf, xlsx, csv, docx' });
      return;
    }
    const data = await fetchReportData(kind, req);
    const report = reportToExport(kind, data, buildFiltersLabel(req, kind));
    const out = await exportReport(report, format);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.body);
  } catch (err) { next(err); }
});
