/* ===========================================================================
 * Dashboard routes — Sales, Purchase, Receivables/Payables, Stock
 * ==========================================================================*/
import { Router } from 'express';
import { validateQuery } from '../middleware/validate';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as dashService from '../services/dashboard.service';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const salesSchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

dashboardRouter.get('/sales', requirePermission('sales_dashboard', 'view'), validateQuery(salesSchema), async (req, res, next) => {
  try {
    res.json(await dashService.salesDashboard({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      fromDate: (req.query.fromDate as string) ?? null,
      toDate: (req.query.toDate as string) ?? null,
    }));
  } catch (err) { next(err); }
});

dashboardRouter.get('/purchase', requirePermission('purchase_dashboard', 'view'), validateQuery(salesSchema), async (req, res, next) => {
  try {
    res.json(await dashService.purchaseDashboard({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      fromDate: (req.query.fromDate as string) ?? null,
      toDate: (req.query.toDate as string) ?? null,
    }));
  } catch (err) { next(err); }
});

const asOfSchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  asOfDate: z.string(),
});

dashboardRouter.get('/receivables-payables', requirePermission('receivables_payables_dashboard', 'view'), validateQuery(asOfSchema), async (req, res, next) => {
  try {
    res.json(await dashService.receivablesPayablesDashboard({
      asOfDate: req.query.asOfDate as string,
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
    }));
  } catch (err) { next(err); }
});

dashboardRouter.get('/stock', requirePermission('stock_dashboard', 'view'), validateQuery(asOfSchema), async (req, res, next) => {
  try {
    res.json(await dashService.stockDashboard({
      asOfDate: req.query.asOfDate as string,
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
    }));
  } catch (err) { next(err); }
});
