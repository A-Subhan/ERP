/* ===========================================================================
 * Chart of Accounts routes
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as accountService from '../services/account.service';

export const accountRouter = Router();
accountRouter.use(requireAuth);

const createSchema = z.object({
  parentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(200),
  nature: z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']),
  isGroup: z.boolean(),
  isCash: z.boolean().optional(),
  isBank: z.boolean().optional(),
  partyType: z.enum(['NONE','CUSTOMER','SUPPLIER']).optional(),
  contactPerson: z.string().max(200).nullable().optional(),
  partyAddress: z.string().max(500).nullable().optional(),
  partyPhone: z.string().max(50).nullable().optional(),
  partyEmail: z.string().max(100).nullable().optional(),
  partyNtnCnic: z.string().max(50).nullable().optional(),
  creditDays: z.number().int().nonnegative().nullable().optional(),
  creditLimit: z.number().nonnegative().nullable().optional(),
  bankName: z.string().max(200).nullable().optional(),
  bankAccountNo: z.string().max(50).nullable().optional(),
  bankBranch: z.string().max(200).nullable().optional(),
});

const updateSchema = createSchema.partial().omit({ nature: true, isGroup: true, parentId: true });

accountRouter.get('/', requirePermission('COA', 'view'), async (_req, res, next) => {
  try { res.json(await accountService.listAccounts()); }
  catch (err) { next(err); }
});

accountRouter.get('/:id', requirePermission('COA', 'view'), async (req, res, next) => {
  try {
    const a = await accountService.getAccountById(parseInt(req.params.id, 10));
    if (!a) { res.status(404).json({ error: 'Account not found.' }); return; }
    res.json(a);
  } catch (err) { next(err); }
});

accountRouter.post('/', requirePermission('COA', 'add'), validateBody(createSchema), async (req, res, next) => {
  try {
    res.status(201).json(await accountService.createAccount(req.body, req.auditCtx!));
  } catch (err) { next(err); }
});

accountRouter.put('/:id', requirePermission('COA', 'edit'), validateBody(updateSchema), async (req, res, next) => {
  try {
    res.json(await accountService.updateAccount(parseInt(req.params.id, 10), req.body, req.auditCtx!));
  } catch (err) { next(err); }
});

accountRouter.delete('/:id', requirePermission('COA', 'del'), async (req, res, next) => {
  try {
    await accountService.deleteAccount(parseInt(req.params.id, 10), req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
