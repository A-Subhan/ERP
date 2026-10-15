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
