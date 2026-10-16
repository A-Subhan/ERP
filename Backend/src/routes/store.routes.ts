/* ===========================================================================
 * Stores routes
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as storeService from '../services/store.service';

export const storeRouter = Router();
storeRouter.use(requireAuth);

const createSchema = z.object({
  parentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(200),
  storeType: z.enum(['GROUP','STOCK']),
  taggedBranches: z.array(z.number().int().positive()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  storeType: z.enum(['GROUP','STOCK']).optional(),
  isActive: z.boolean().optional(),
  taggedBranches: z.array(z.number().int().positive()).optional(),
});

storeRouter.get('/', requirePermission('stores', 'view'), async (_req, res, next) => {
  try { res.json(await storeService.listStores()); }
  catch (err) { next(err); }
});

storeRouter.get('/:id', requirePermission('stores', 'view'), async (req, res, next) => {
  try {
    const s = await storeService.getStoreById(parseInt(req.params.id, 10));
    if (!s) { res.status(404).json({ error: 'Store not found.' }); return; }
    res.json(s);
  } catch (err) { next(err); }
});

storeRouter.post('/', requirePermission('stores', 'add'), validateBody(createSchema), async (req, res, next) => {
  try { res.status(201).json(await storeService.createStore(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

storeRouter.put('/:id', requirePermission('stores', 'edit'), validateBody(updateSchema), async (req, res, next) => {
  try { res.json(await storeService.updateStore(parseInt(req.params.id, 10), req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

storeRouter.delete('/:id', requirePermission('stores', 'del'), async (req, res, next) => {
  try {
    await storeService.deleteStore(parseInt(req.params.id, 10), req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
