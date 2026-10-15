/* ===========================================================================
 * Voucher service — Cash Receipt (CRV), Cash Payment (CPV),
 * Bank Receipt (BRV), Bank Payment (BPV), Journal Voucher (JV).
 *
 * Uses the shared ledger engine (postEntry). All money writes happen inside
 * a single SQL transaction.
 *
 * Tax rule (per spec):
 *   Payment (CPV/BPV): Dr counter (gross), Cr cash/bank (gross − tax), Cr tax (tax).
 *   Receipt (CRV/BRV): Dr cash/bank (gross − tax), Dr tax (tax), Cr counter (gross).
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { postEntry, LedgerLine, reverseVoucher } from './ledger.service';
import { nextDocNumber, fiscalYearForDate, DocType } from '../utils/docNumber';
import { audit, AuditContext } from '../utils/audit';

export type VoucherType = 'CRV' | 'CPV' | 'BRV' | 'BPV' | 'JV';

export interface VoucherInput {
  voucherType: VoucherType;
  docDate: string;            // YYYY-MM-DD
  branchId: number;
  cashAccountCode?: string | null;
  bankAccountCode?: string | null;
  paymentType?: 'CHEQUE' | 'ONLINE' | null;
  chequeNo?: string | null;
  chequeDate?: string | null;
  chequeBankName?: string | null;
  reference?: string | null;
  narration?: string | null;
  // For CRV/CPV/BRV/BPV: a single counter account + gross amount (+ optional tax)
  counterAccountCode?: string | null;
  grossAmount?: number | null;
  taxHeadId?: number | null;
  taxPercentage?: number | null;
  // For JV: many lines
  lines?: LedgerLine[];
}

export async function createVoucher(input: VoucherInput, auditCtx: AuditContext): Promise<{ id: number; voucherNo: string }> {
  const docDate = new Date(input.docDate);
  if (Number.isNaN(docDate.getTime())) throw new Error('Voucher date is not valid.');

  const fyInfo = await fiscalYearForDate(docDate);

  const txc = await beginTx();
  try {
    // Resolve branch short name from branch id
    const brR = await txc.req()
      .input('bid', sql.Int, input.branchId)
      .query(`SELECT short_name FROM dbo.branches WHERE id = @bid`);
    if (brR.recordset.length === 0) throw new Error('Branch not found.');
    const branchShort = brR.recordset[0].short_name;

    const docType: DocType = input.voucherType as DocType;
    const voucherNo = await nextDocNumber(branchShort, docType, fyInfo.fyId, fyInfo.fyEndYY);

    // Build the ledger lines for this voucher
    const lines: LedgerLine[] = [];
    let grossAmount: number | null = null;
    let taxAmount: number | null = null;
    let netAmount: number | null = null;
    let taxPct: number | null = null;

    if (input.voucherType === 'JV') {
      if (!input.lines || input.lines.length < 2) {
        throw new Error('A Journal Voucher must have at least two lines.');
      }
      for (const l of input.lines) lines.push({ ...l });
    } else {
      // Cash/Bank voucher with single counter account + optional tax
      if (!input.counterAccountCode) throw new Error('Counter account is required.');
      if (!input.grossAmount || input.grossAmount <= 0) throw new Error('Gross amount must be greater than zero.');

      const isCash = input.voucherType === 'CRV' || input.voucherType === 'CPV';
      const isBank = input.voucherType === 'BRV' || input.voucherType === 'BPV';
      const isReceipt = input.voucherType === 'CRV' || input.voucherType === 'BRV';
      const isPayment = !isReceipt;

      if (isCash && !input.cashAccountCode) throw new Error('A cash account is required for cash vouchers.');
      if (isBank && !input.bankAccountCode) throw new Error('A bank account is required for bank vouchers.');
      if (isBank && input.paymentType === 'CHEQUE' && !input.chequeNo) {
        throw new Error('Cheque number is required for cheque-type bank vouchers.');
      }

      grossAmount = round2(input.grossAmount);
      if (input.taxHeadId) {
        taxPct = input.taxPercentage ?? (await getTaxPercentage(input.taxHeadId, txc));
        taxAmount = round2(grossAmount * (taxPct / 100));
        netAmount = round2(grossAmount - taxAmount);
      } else {
        netAmount = grossAmount;
        taxAmount = 0;
      }

      const mainAccountCode = isCash ? input.cashAccountCode! : input.bankAccountCode!;
      const counterCode = input.counterAccountCode;

      if (isPayment) {
        // Dr counter (gross), Cr cash/bank (net), Cr tax (tax)
        lines.push({ accountCode: counterCode, debit: grossAmount, credit: 0, narration: input.narration ?? null });
        if (taxAmount && taxAmount > 0) {
          // Resolve tax account from tax head
          const taxAcctCode = await getTaxAccountCode(input.taxHeadId!, txc);
          lines.push({ accountCode: taxAcctCode, debit: 0, credit: taxAmount, narration: `Tax @ ${taxPct}% on ${voucherNo}` });
        }
        lines.push({ accountCode: mainAccountCode, debit: 0, credit: netAmount, narration: input.narration ?? null });
      } else {
        // Receipt: Dr cash/bank (net), Dr tax (tax), Cr counter (gross)
        lines.push({ accountCode: mainAccountCode, debit: netAmount, credit: 0, narration: input.narration ?? null });
        if (taxAmount && taxAmount > 0) {
          const taxAcctCode = await getTaxAccountCode(input.taxHeadId!, txc);
          lines.push({ accountCode: taxAcctCode, debit: taxAmount, credit: 0, narration: `Tax @ ${taxPct}% on ${voucherNo}` });
        }
        lines.push({ accountCode: counterCode, debit: 0, credit: grossAmount, narration: input.narration ?? null });
      }
    }

    const { voucherId } = await postEntry({
      voucherNo,
      voucherType: input.voucherType,
      docDate,
      fiscalYearId: fyInfo.fyId,
      branchId: input.branchId,
      cashAccountCode: input.cashAccountCode ?? null,
      bankAccountCode: input.bankAccountCode ?? null,
      paymentType: input.paymentType ?? null,
      chequeNo: input.chequeNo ?? null,
      chequeDate: input.chequeDate ? new Date(input.chequeDate) : null,
      chequeBankName: input.chequeBankName ?? null,
      chequeStatus: input.paymentType === 'CHEQUE' ? 'ISSUED' : null,
      reference: input.reference ?? null,
      narration: input.narration ?? null,
      taxHeadId: input.taxHeadId ?? null,
      taxPercentage: taxPct,
      grossAmount: grossAmount,
      taxAmount: taxAmount,
      netAmount: netAmount,
      counterAccountCode: input.counterAccountCode ?? null,
      createdBy: auditCtx.userId!,
      lines,
    }, txc);

    await audit(auditCtx, input.voucherType, 'CREATE', 'Voucher', String(voucherId), voucherNo, null, {
      voucherNo, voucherType: input.voucherType, docDate: input.docDate, branchId: input.branchId,
      counterAccountCode: input.counterAccountCode, grossAmount, taxAmount, netAmount,
    }, txc.tx);

    await txc.commit();
    return { id: voucherId, voucherNo };
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function deleteVoucher(voucherId: number, auditCtx: AuditContext): Promise<void> {
  const txc = await beginTx();
  try {
    await reverseVoucher(voucherId, txc);
    await audit(auditCtx, 'VOUCHER', 'DELETE', 'Voucher', String(voucherId), null, null, { reversed: true }, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function listVouchers(filter: {
  voucherType?: VoucherType | null;
  branchId?: number | null;
  fromDate?: string | null;
  toDate?: string | null;
  chequeStatus?: string | null;
}): Promise<any[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('vt', sql.VarChar, filter.voucherType ?? null)
    .input('bid', sql.Int, filter.branchId ?? null)
    .input('fd', sql.Date, filter.fromDate ?? null)
    .input('td', sql.Date, filter.toDate ?? null)
    .input('cs', sql.VarChar, filter.chequeStatus ?? null)
    .query(`
      SELECT v.id, v.voucher_no, v.voucher_type, v.doc_date, v.branch_id, b.short_name AS branch_short,
             v.cash_account_code, v.bank_account_code, v.counter_account_code,
             v.payment_type, v.cheque_no, v.cheque_date, v.cheque_status,
             v.reference, v.narration, v.gross_amount, v.tax_amount, v.net_amount,
             v.status
      FROM dbo.vouchers v
      JOIN dbo.branches b ON b.id = v.branch_id
      WHERE (@vt IS NULL OR v.voucher_type = @vt)
        AND (@bid IS NULL OR v.branch_id = @bid)
        AND (@fd IS NULL OR v.doc_date >= @fd)
        AND (@td IS NULL OR v.doc_date <= @td)
        AND (@cs IS NULL OR v.cheque_status = @cs)
      ORDER BY v.doc_date DESC, v.id DESC
    `);
  return r.recordset;
}

export async function getVoucher(id: number): Promise<any | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.BigInt, id)
    .query(`
      SELECT v.id, v.voucher_no, v.voucher_type, v.doc_date, v.fiscal_year_id, v.branch_id,
             b.short_name AS branch_short,
             v.cash_account_code, v.bank_account_code, v.counter_account_code,
             v.payment_type, v.cheque_no, v.cheque_date, v.cheque_bank_name, v.cheque_status, v.cheque_status_date,
             v.reference, v.narration, v.tax_head_id, v.tax_percentage,
             v.gross_amount, v.tax_amount, v.net_amount, v.status,
             v.created_by, v.created_at
      FROM dbo.vouchers v
      JOIN dbo.branches b ON b.id = v.branch_id
      WHERE v.id = @id
    `);
  if (r.recordset.length === 0) return null;
  const v = r.recordset[0];
  const linesR = await pool.request()
    .input('id', sql.BigInt, id)
    .query(`
      SELECT vl.line_no, vl.account_code, a.name AS account_name, vl.debit, vl.credit,
             vl.line_narration, vl.bill_id, vl.amount_applied
      FROM dbo.voucher_lines vl
      JOIN dbo.accounts a ON a.code = vl.account_code
      WHERE vl.voucher_id = @id
      ORDER BY vl.line_no
    `);
  return { ...v, lines: linesR.recordset };
}

// --- Helpers ---

async function getTaxPercentage(taxHeadId: number, txc: any): Promise<number> {
  const r = await txc.req()
    .input('tid', sql.Int, taxHeadId)
    .query(`SELECT percentage FROM dbo.tax_heads WHERE id = @tid`);
  if (r.recordset.length === 0) throw new Error('Tax head not found.');
  return r.recordset[0].percentage;
}

async function getTaxAccountCode(taxHeadId: number, txc: any): Promise<string> {
  const r = await txc.req()
    .input('tid', sql.Int, taxHeadId)
    .query(`SELECT account_code FROM dbo.tax_heads WHERE id = @tid`);
  if (r.recordset.length === 0) throw new Error('Tax head not found.');
  return r.recordset[0].account_code;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
