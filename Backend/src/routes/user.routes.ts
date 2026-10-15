/* ===========================================================================
 * Users routes
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requireAdmin } from '../middleware/auth';
import * as userService from '../services/user.service';

export const userRouter = Router();
userRouter.use(requireAuth, requireAdmin);

const permissionSchema = z.object({
  screenCode: z.string().max(60),
  view: z.boolean(),
  add: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  print: z.boolean(),
});

const createSchema = z.object({
  username: z.string().min(1).max(100),
  fullName: z.string().min(1).max(200),
  password: z.string().min(8).max(128),
  isAdmin: z.boolean().optional(),
  allowedBranchesCsv: z.string().max(500).nullable().optional(),
  allowedStoresCsv: z.string().max(500).nullable().optional(),
});

const updateSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  isAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
  allowedBranchesCsv: z.string().max(500).nullable().optional(),
  allowedStoresCsv: z.string().max(500).nullable().optional(),
  resetPassword: z.string().min(8).max(128).nullable().optional(),
  permissions: z.array(permissionSchema).optional(),
});

userRouter.get('/', async (_req, res, next) => {
  try { res.json(await userService.listUsers()); }
  catch (err) { next(err); }
});

userRouter.get('/:id', async (req, res, next) => {
  try {
    const u = await userService.getUserById(parseInt(req.params.id, 10));
    if (!u) { res.status(404).json({ error: 'User not found.' }); return; }
    res.json(u);
  } catch (err) { next(err); }
});

userRouter.post('/', validateBody(createSchema), async (req, res, next) => {
  try { res.status(201).json(await userService.createUser(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

userRouter.put('/:id', validateBody(updateSchema), async (req, res, next) => {
  try {
    res.json(await userService.updateUser(parseInt(req.params.id, 10), req.body, req.auditCtx!));
  } catch (err) { next(err); }
});

userRouter.delete('/:id', async (req, res, next) => {
  try {
    await userService.deleteUser(parseInt(req.params.id, 10), req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
