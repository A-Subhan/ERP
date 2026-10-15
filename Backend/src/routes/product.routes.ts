/* ===========================================================================
 * Products routes
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as productService from '../services/product.service';

export const productRouter = Router();
productRouter.use(requireAuth);

const createSchema = z.object({
  parentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(200),
  unitId: z.number().int().positive().nullable().optional(),
  salesTaxPct: z.number().min(0).max(100).optional(),
  reorderLevel: z.number().nonnegative().optional(),
  purchasePrice: z.number().nonnegative().optional(),
  salesPrice: z.number().nonnegative().optional(),
  isGroup: z.boolean(),
});

const updateSchema = createSchema.partial().omit({ isGroup: true, parentId: true });

productRouter.get('/', requirePermission('product_master', 'view'), async (_req, res, next) => {
  try { res.json(await productService.listProducts()); }
  catch (err) { next(err); }
});

productRouter.get('/:id', requirePermission('product_master', 'view'), async (req, res, next) => {
  try {
    const p = await productService.getProductById(parseInt(req.params.id, 10));
    if (!p) { res.status(404).json({ error: 'Product not found.' }); return; }
    res.json(p);
  } catch (err) { next(err); }
});

productRouter.post('/', requirePermission('product_master', 'add'), validateBody(createSchema), async (req, res, next) => {
  try { res.status(201).json(await productService.createProduct(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

productRouter.put('/:id', requirePermission('product_master', 'edit'), validateBody(updateSchema), async (req, res, next) => {
  try { res.json(await productService.updateProduct(parseInt(req.params.id, 10), req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

productRouter.delete('/:id', requirePermission('product_master', 'del'), async (req, res, next) => {
  try {
    await productService.deleteProduct(parseInt(req.params.id, 10), req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
