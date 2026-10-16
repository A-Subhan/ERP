/* ===========================================================================
 * Tax Heads routes
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as taxHeadService from '../services/taxHead.service';

export const taxHeadRouter = Router();
taxHeadRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  accountCode: z.string().min(1).max(40),
  percentage: z.number().min(0).max(100),
});

const updateSchema = createSchema.partial();

taxHeadRouter.get('/', requirePermission('tax_heads', 'view'), async (_req, res, next) => {
  try { res.json(await taxHeadService.listTaxHeads()); }
  catch (err) { next(err); }
});

taxHeadRouter.get('/:id', requirePermission('tax_heads', 'view'), async (req, res, next) => {
  try {
    const t = await taxHeadService.getTaxHeadById(parseInt(req.params.id, 10));
    if (!t) { res.status(404).json({ error: 'Tax head not found.' }); return; }
    res.json(t);
  } catch (err) { next(err); }
});

taxHeadRouter.post('/', requirePermission('tax_heads', 'add'), validateBody(createSchema), async (req, res, next) => {
  try { res.status(201).json(await taxHeadService.createTaxHead(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

taxHeadRouter.put('/:id', requirePermission('tax_heads', 'edit'), validateBody(updateSchema), async (req, res, next) => {
  try { res.json(await taxHeadService.updateTaxHead(parseInt(req.params.id, 10), req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

taxHeadRouter.delete('/:id', requirePermission('tax_heads', 'del'), async (req, res, next) => {
  try {
    await taxHeadService.deleteTaxHead(parseInt(req.params.id, 10), req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
