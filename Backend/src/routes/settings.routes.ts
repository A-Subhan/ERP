/* ===========================================================================
 * Settings routes — Default Page (admin-only)
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requireAdmin } from '../middleware/auth';
import * as settingsService from '../services/settings.service';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireAdmin);

settingsRouter.get('/', async (_req, res, next) => {
  try { res.json(await settingsService.getSettings()); }
  catch (err) { next(err); }
});

const updateSchema = z.object({
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(100).nullable().optional(),
  ntn: z.string().max(50).nullable().optional(),
  strn: z.string().max(50).nullable().optional(),
  logoPath: z.string().max(500).nullable().optional(),
  defaultBranchId: z.number().int().positive().nullable().optional(),
  defaultStoreId: z.number().int().positive().nullable().optional(),
  decimalsAmount: z.number().int().min(0).max(4).optional(),
  decimalsQuantity: z.number().int().min(0).max(4).optional(),
  decimalsRate: z.number().int().min(0).max(4).optional(),
  allowNegativeStock: z.boolean().optional(),
  branchDigitsPerLevel: z.string().max(20).optional(),
  storeDigitsPerLevel: z.string().max(20).optional(),
  productDigitsPerLevel: z.string().max(20).optional(),
  accountingType: z.enum(['KNOCK_OFF','FIFO']).optional(),
  coaDigitsPerLevel: z.string().max(40).optional(),
  agingBucket1: z.number().int().positive().optional(),
  agingBucket2: z.number().int().positive().optional(),
  agingBucket3: z.number().int().positive().optional(),
  defaultCashAccountCode: z.string().max(40).nullable().optional(),
  defaultBankAccountCode: z.string().max(40).nullable().optional(),
  salesAccountCode: z.string().max(40).nullable().optional(),
  salesReturnsAccountCode: z.string().max(40).nullable().optional(),
  outputSalesTaxAccountCode: z.string().max(40).nullable().optional(),
  inputSalesTaxAccountCode: z.string().max(40).nullable().optional(),
  inventoryAccountCode: z.string().max(40).nullable().optional(),
  cogsAccountCode: z.string().max(40).nullable().optional(),
  grnClearingAccountCode: z.string().max(40).nullable().optional(),
  purchasePriceVarianceAccountCode: z.string().max(40).nullable().optional(),
  stockAdjustmentAccountCode: z.string().max(40).nullable().optional(),
  printSettings: z.any().optional(),
});

settingsRouter.put('/', validateBody(updateSchema), async (req, res, next) => {
  try { res.json(await settingsService.updateSettings(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

// Fiscal years
settingsRouter.get('/fiscal-years', async (_req, res, next) => {
  try { res.json(await settingsService.listFiscalYears()); }
  catch (err) { next(err); }
});

const fySchema = z.object({
  name: z.string().min(1).max(50),
  startDate: z.string(),
  endDate: z.string(),
});

settingsRouter.post('/fiscal-years', validateBody(fySchema), async (req, res, next) => {
  try { res.status(201).json(await settingsService.createFiscalYear(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

settingsRouter.delete('/fiscal-years/:id', async (req, res, next) => {
  try {
    await settingsService.deleteFiscalYear(parseInt(req.params.id, 10), req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
