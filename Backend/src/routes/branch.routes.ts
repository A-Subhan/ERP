/* ===========================================================================
 * Branches routes
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as branchService from '../services/branch.service';

export const branchRouter = Router();
branchRouter.use(requireAuth);

const createSchema = z.object({
  parentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(200),
  shortName: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(100).nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  shortName: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

branchRouter.get('/', requirePermission('BRANCHES', 'view'), async (_req, res, next) => {
  try {
    res.json(await branchService.listBranches());
  } catch (err) { next(err); }
});

branchRouter.get('/:id', requirePermission('BRANCHES', 'view'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = await branchService.getBranchById(id);
    if (!b) { res.status(404).json({ error: 'Branch not found.' }); return; }
    res.json(b);
  } catch (err) { next(err); }
});

branchRouter.post('/', requirePermission('BRANCHES', 'add'), validateBody(createSchema), async (req, res, next) => {
  try {
    const b = await branchService.createBranch(req.body, req.auditCtx!);
    res.status(201).json(b);
  } catch (err) { next(err); }
});

branchRouter.put('/:id', requirePermission('BRANCHES', 'edit'), validateBody(updateSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = await branchService.updateBranch(id, req.body, req.auditCtx!);
    res.json(b);
  } catch (err) { next(err); }
});

branchRouter.delete('/:id', requirePermission('BRANCHES', 'del'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await branchService.deleteBranch(id, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
