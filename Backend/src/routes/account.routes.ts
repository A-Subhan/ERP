/* ===========================================================================
 * Chart of Accounts routes — uses code as PK.
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as accountService from '../services/account.service';
import * as detailsService from '../services/accountDetails.service';

export const accountRouter = Router();
accountRouter.use(requireAuth);

const createSchema = z.object({
  parentCode: z.string().max(40).nullable().optional(),
  name: z.string().min(1).max(200),
  nature: z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']),
  isGroup: z.boolean(),
  isCash: z.boolean().optional(),
  isBank: z.boolean().optional(),
  partyType: z.enum(['NONE','CUSTOMER','SUPPLIER']).optional(),
});

const updateSchema = createSchema.partial().omit({ nature: true, isGroup: true, parentCode: true });

accountRouter.get('/', requirePermission('chart_of_accounts', 'view'), async (_req, res, next) => {
  try { res.json(await accountService.listAccounts()); }
  catch (err) { next(err); }
});

accountRouter.get('/:code', requirePermission('chart_of_accounts', 'view'), async (req, res, next) => {
  try {
    const a = await accountService.getAccountByCode(req.params.code);
    if (!a) { res.status(404).json({ error: 'Account not found.' }); return; }
    res.json(a);
  } catch (err) { next(err); }
});

accountRouter.post('/', requirePermission('chart_of_accounts', 'add'), validateBody(createSchema), async (req, res, next) => {
  try { res.status(201).json(await accountService.createAccount(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

accountRouter.put('/:code', requirePermission('chart_of_accounts', 'edit'), validateBody(updateSchema), async (req, res, next) => {
  try { res.json(await accountService.updateAccount(req.params.code, req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

accountRouter.delete('/:code', requirePermission('chart_of_accounts', 'del'), async (req, res, next) => {
  try {
    await accountService.deleteAccount(req.params.code, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Account details
accountRouter.get('/:code/details', requirePermission('chart_of_accounts', 'view'), async (req, res, next) => {
  try {
    const d = await detailsService.getDetails(req.params.code);
    const tags = await detailsService.getBranchTags(req.params.code);
    res.json({ details: d, branchTags: tags });
  } catch (err) { next(err); }
});

accountRouter.put('/:code/details', requirePermission('chart_of_accounts', 'edit'), async (req, res, next) => {
  try {
    // Accept partial details object + branchTags
    const { branchTags, ...detailsFields } = req.body;
    const updated = await detailsService.upsertDetails(req.params.code, detailsFields, req.auditCtx!);
    if (Array.isArray(branchTags)) {
      await detailsService.setBranchTags(req.params.code, branchTags, req.auditCtx!);
    }
    res.json(updated);
  } catch (err) { next(err); }
});

// Branch tags separately
accountRouter.put('/:code/branch-tags', requirePermission('chart_of_accounts', 'edit'), async (req, res, next) => {
  try {
    const ids: number[] = Array.isArray(req.body.branchIds) ? req.body.branchIds : [];
    await detailsService.setBranchTags(req.params.code, ids, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
