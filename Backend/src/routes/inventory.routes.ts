/* ===========================================================================
 * Inventory routes — Opening Stock, Move Stock, Adjust Stock, Stock Ledger,
 * Inventory Report.
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as inv from '../services/inventory.service';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

const lineSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number(),
});

// --- Opening Stock ---

inventoryRouter.get('/opening-stock', requirePermission('opening_stock', 'view'), validateQuery(z.object({
  branchId: z.coerce.number().int().positive().optional(),
  storeId: z.coerce.number().int().positive().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
})), async (req, res, next) => {
  try {
    res.json(await inv.listOpeningStock({
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      storeId: req.query.storeId ? Number(req.query.storeId) : undefined,
      fromDate: (req.query.fromDate as string) || undefined,
      toDate: (req.query.toDate as string) || undefined,
    }));
  } catch (err) { next(err); }
});

inventoryRouter.post('/opening-stock', requirePermission('opening_stock', 'add'), validateBody(z.object({
  docDate: z.string(),
  branchId: z.number().int().positive(),
  storeId: z.number().int().positive(),
  lines: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number(),
    costPrice: z.number().nullable().optional(),
    salesPrice: z.number().nullable().optional(),
    wholesalePrice: z.number().nullable().optional(),
    resalePrice: z.number().nullable().optional(),
  })).min(1),
  reference: z.string().nullable().optional(),
})), async (req, res, next) => {
  try { res.status(201).json(await inv.createOpeningStock(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

// --- Move Stock ---

inventoryRouter.get('/move-stock', requirePermission('move_stock', 'view'), validateQuery(z.object({
  branchId: z.coerce.number().int().positive().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
})), async (req, res, next) => {
  try {
    res.json(await inv.listMoveStock({
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      fromDate: (req.query.fromDate as string) || undefined,
      toDate: (req.query.toDate as string) || undefined,
    }));
  } catch (err) { next(err); }
});

inventoryRouter.post('/move-stock', requirePermission('move_stock', 'add'), validateBody(z.object({
  docDate: z.string(),
  branchId: z.number().int().positive(),
  fromStoreId: z.number().int().positive(),
  toStoreId: z.number().int().positive(),
  lines: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number() })).min(1),
  reference: z.string().nullable().optional(),
})), async (req, res, next) => {
  try { res.status(201).json(await inv.createMoveStock(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

// --- Adjust Stock ---

inventoryRouter.get('/adjust-stock', requirePermission('adjust_stock', 'view'), validateQuery(z.object({
  branchId: z.coerce.number().int().positive().optional(),
  storeId: z.coerce.number().int().positive().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
})), async (req, res, next) => {
  try {
    res.json(await inv.listAdjustStock({
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      storeId: req.query.storeId ? Number(req.query.storeId) : undefined,
      fromDate: (req.query.fromDate as string) || undefined,
      toDate: (req.query.toDate as string) || undefined,
    }));
  } catch (err) { next(err); }
});

inventoryRouter.post('/adjust-stock', requirePermission('adjust_stock', 'add'), validateBody(z.object({
  docDate: z.string(),
  branchId: z.number().int().positive(),
  storeId: z.number().int().positive(),
  lines: z.array(z.object({
    productId: z.number().int().positive(),
    systemQty: z.number(),
    physicalQty: z.number(),
    reason: z.string().min(1),
  })).min(1),
  reference: z.string().nullable().optional(),
})), async (req, res, next) => {
  try { res.status(201).json(await inv.createAdjustStock(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

// --- Stock / Product Ledger ---

inventoryRouter.get('/stock-ledger', requirePermission('stock_ledger', 'view'), validateQuery(z.object({
  productId: z.coerce.number().int().positive(),
  storeId: z.coerce.number().int().positive().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
})), async (req, res, next) => {
  try {
    res.json(await inv.stockLedger({
      productId: Number(req.query.productId),
      storeId: req.query.storeId ? Number(req.query.storeId) : null,
      fromDate: (req.query.fromDate as string) || undefined,
      toDate: (req.query.toDate as string) || undefined,
    }));
  } catch (err) { next(err); }
});

// --- Inventory Report ---

inventoryRouter.get('/inventory-report', requirePermission('inventory_report', 'view'), validateQuery(z.object({
  asOfDate: z.string(),
  branchId: z.coerce.number().int().positive().optional(),
  storeId: z.coerce.number().int().positive().optional(),
})), async (req, res, next) => {
  try {
    res.json(await inv.inventoryReport({
      asOfDate: req.query.asOfDate as string,
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      storeId: req.query.storeId ? Number(req.query.storeId) : null,
    }));
  } catch (err) { next(err); }
});
