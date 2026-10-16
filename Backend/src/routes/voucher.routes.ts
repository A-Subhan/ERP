/* ===========================================================================
 * Voucher routes — CRV, CPV, BRV, BPV, JV
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate';
import { requireAuth, requirePermission } from '../middleware/auth';
import * as voucherService from '../services/voucher.service';

export const voucherRouter = Router();
voucherRouter.use(requireAuth);

const SCREEN_MAP: Record<string, string> = {
  CRV: 'cash_receipt', CPV: 'cash_payment', BRV: 'bank_receipt', BPV: 'bank_payment', JV: 'journal_voucher',
};

const lineSchema = z.object({
  accountCode: z.string().min(1).max(40),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
  narration: z.string().max(500).nullable().optional(),
  billId: z.number().int().positive().nullable().optional(),
});

const createSchema = z.object({
  voucherType: z.enum(['CRV','CPV','BRV','BPV','JV']),
  docDate: z.string().min(1),
  branchId: z.number().int().positive(),
  cashAccountCode: z.string().max(40).nullable().optional(),
  bankAccountCode: z.string().max(40).nullable().optional(),
  paymentType: z.enum(['CHEQUE','ONLINE']).nullable().optional(),
  chequeNo: z.string().max(50).nullable().optional(),
  chequeDate: z.string().nullable().optional(),
  chequeBankName: z.string().max(200).nullable().optional(),
  reference: z.string().max(200).nullable().optional(),
  narration: z.string().max(1000).nullable().optional(),
  counterAccountCode: z.string().max(40).nullable().optional(),
  grossAmount: z.number().nonnegative().nullable().optional(),
  taxHeadId: z.number().int().positive().nullable().optional(),
  taxPercentage: z.number().nonnegative().nullable().optional(),
  lines: z.array(lineSchema).optional(),
});

const listSchema = z.object({
  voucherType: z.string().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  chequeStatus: z.string().optional(),
});

voucherRouter.get('/', validateQuery(listSchema), async (req, res, next) => {
  try {
    const vt = req.query.voucherType as string | undefined;
    const screen = vt ? SCREEN_MAP[vt] : null;
    if (screen) {
      // require view permission on that screen
      const checker = requirePermission(screen, 'view');
      await new Promise<void>((resolve, reject) => {
        checker(req, res, (err?: any) => err ? reject(err) : resolve());
      });
    }
    const rows = await voucherService.listVouchers({
      voucherType: (req.query.voucherType as any) ?? null,
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      fromDate: (req.query.fromDate as string) ?? null,
      toDate: (req.query.toDate as string) ?? null,
      chequeStatus: (req.query.chequeStatus as string) ?? null,
    });
    res.json(rows);
  } catch (err) { next(err); }
});

voucherRouter.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const v = await voucherService.getVoucher(id);
    if (!v) { res.status(404).json({ error: 'Voucher not found.' }); return; }
    const screen = SCREEN_MAP[v.voucher_type];
    if (screen) {
      const checker = requirePermission(screen, 'view');
      await new Promise<void>((resolve, reject) => {
        checker(req, res, (err?: any) => err ? reject(err) : resolve());
      });
    }
    res.json(v);
  } catch (err) { next(err); }
});

voucherRouter.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const screen = SCREEN_MAP[req.body.voucherType];
    if (screen) {
      const checker = requirePermission(screen, 'add');
      await new Promise<void>((resolve, reject) => {
        checker(req, res, (err?: any) => err ? reject(err) : resolve());
      });
    }
    const r = await voucherService.createVoucher(req.body, req.auditCtx!);
    res.status(201).json(r);
  } catch (err) { next(err); }
});

voucherRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const v = await voucherService.getVoucher(id);
    if (!v) { res.status(404).json({ error: 'Voucher not found.' }); return; }
    const screen = SCREEN_MAP[v.voucher_type];
    if (screen) {
      const checker = requirePermission(screen, 'del');
      await new Promise<void>((resolve, reject) => {
        checker(req, res, (err?: any) => err ? reject(err) : resolve());
      });
    }
    await voucherService.deleteVoucher(id, req.auditCtx!);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
