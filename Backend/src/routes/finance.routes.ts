/* ===========================================================================
 * Finance module routes — Opening Trial Balance, Update Cheque Status,
 * Bank Reconciliation.
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as fin from '../services/finance.service';

export const financeRouter = Router();
financeRouter.use(requireAuth);

// --- Opening Trial Balance ---

financeRouter.get('/opening-trial-balance/:branchId', requirePermission('opening_trial_balance', 'view'), async (req, res, next) => {
  try {
    res.json(await fin.getOpeningBalances(parseInt(req.params.branchId, 10)));
  } catch (err) { next(err); }
});

financeRouter.post('/opening-trial-balance', requirePermission('opening_trial_balance', 'edit'), validateBody(z.object({
  branchId: z.number().int().positive(),
  lines: z.array(z.object({
    accountCode: z.string().min(1),
    debit: z.number(),
    credit: z.number(),
    bills: z.array(z.object({ billNo: z.string(), billDate: z.string(), amount: z.number() })).nullable().optional(),
  })),
})), async (req, res, next) => {
  try { res.json(await fin.saveOpeningBalances(req.body, req.auditCtx!)); }
  catch (err) { next(err); }
});

// --- Update Cheque Status ---

financeRouter.get('/cheques', requirePermission('update_cheque_status', 'view'), validateQuery(z.object({
  bankAccountCode: z.string().optional(),
  direction: z.string().optional(),
  status: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  chequeNo: z.string().optional(),
})), async (req, res, next) => {
  try {
    res.json(await fin.listCheques({
      bankAccountCode: (req.query.bankAccountCode as string) || null,
      direction: (req.query.direction as 'RECEIPT' | 'PAYMENT') || null,
      status: (req.query.status as string) || null,
      fromDate: (req.query.fromDate as string) || null,
      toDate: (req.query.toDate as string) || null,
      chequeNo: (req.query.chequeNo as string) || null,
    }));
  } catch (err) { next(err); }
});

financeRouter.post('/cheques/:id/status', requirePermission('update_cheque_status', 'edit'), validateBody(z.object({
  newStatus: z.enum(['CLEARED', 'BOUNCED', 'CANCELLED']),
  statusDate: z.string(),
  reason: z.string().nullable().optional(),
})), async (req, res, next) => {
  try {
    await fin.updateChequeStatus({ voucherId: parseInt(req.params.id, 10), ...req.body }, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --- Bank Reconciliation ---

financeRouter.get('/bank-reconciliation', requirePermission('bank_reconciliation', 'view'), validateQuery(z.object({
  bankAccountCode: z.string(),
  statementDate: z.string(),
})), async (req, res, next) => {
  try {
    res.json(await fin.getBankReconciliationData({
      bankAccountCode: req.query.bankAccountCode as string,
      statementDate: req.query.statementDate as string,
    }));
  } catch (err) { next(err); }
});

financeRouter.post('/bank-reconciliation', requirePermission('bank_reconciliation', 'edit'), validateBody(z.object({
  bankAccountCode: z.string(),
  statementDate: z.string(),
  closingBalance: z.number(),
  tickedGlEntryIds: z.array(z.number().int().positive()),
})), async (req, res, next) => {
  try {
    await fin.saveBankReconciliation(req.body, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
