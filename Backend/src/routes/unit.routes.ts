/* ===========================================================================
 * Units routes
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as unitService from '../services/unit.service';

export const unitRouter = Router();
unitRouter.use(requireAuth);

const createSchema = z.object({
  code: z.string().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(50),
});

const updateSchema = z.object({
  code: z.string().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/).optional(),
  name: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
});

unitRouter.get('/', requirePermission('UNITS', 'view'), async (_req, res, next) => {
  try { res.json(await unitService.listUnits()); }
  catch (err) { next(err); }
});

unitRouter.get('/:id', requirePermission('UNITS', 'view'), async (req, res, next) => {
  try {
    const u = await unitService.getUnitById(parseInt(req.params.id, 10));
    if (!u) { res.status(404).json({ error: 'Unit not found.' }); return; }
    res.json(u);
  } catch (err) { next(err); }
});

unitRouter.post('/', requirePermission('UNITS', 'add'), validateBody(createSchema), async (req, res, next) => {
  try {
    res.status(201).json(await unitService.createUnit(req.body, req.auditCtx!));
  } catch (err) { next(err); }
});

unitRouter.put('/:id', requirePermission('UNITS', 'edit'), validateBody(updateSchema), async (req, res, next) => {
  try {
    res.json(await unitService.updateUnit(parseInt(req.params.id, 10), req.body, req.auditCtx!));
  } catch (err) { next(err); }
});

unitRouter.delete('/:id', requirePermission('UNITS', 'del'), async (req, res, next) => {
  try {
    await unitService.deleteUnit(parseInt(req.params.id, 10), req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
