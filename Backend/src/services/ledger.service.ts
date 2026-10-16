/* ===========================================================================
 * Ledger engine — single postEntry function used by every voucher / invoice /
 * adjustment. Writes one voucher + its lines + matching GL entries in a single
 * transaction (caller passes its own transaction context).
 *
 * Balance is enforced by the database trigger TRG_voucher_lines_balanced and
 * TRG_gl_voucher_balanced — both RAISERROR + ROLLBACK on unbalanced entries.
 * ==========================================================================*/
import { sql } from '../db/pool';
import type { beginTx } from '../db/pool';

export interface LedgerLine {
  accountCode: string;
  debit: number;
  credit: number;
  narration?: string | null;
  billId?: number | null;
}

export interface PostEntryInput {
  voucherNo: string;
  voucherType: 'CRV' | 'CPV' | 'BRV' | 'BPV' | 'JV';
  docDate: Date;
  fiscalYearId: number;
  branchId: number;
  cashAccountCode?: string | null;
  bankAccountCode?: string | null;
  paymentType?: 'CHEQUE' | 'ONLINE' | null;
  chequeNo?: string | null;
  chequeDate?: Date | null;
  chequeBankName?: string | null;
  chequeStatus?: 'ISSUED' | 'CLEARED' | 'BOUNCED' | 'CANCELLED' | null;
  reference?: string | null;
  narration?: string | null;
  taxHeadId?: number | null;
  taxPercentage?: number | null;
  grossAmount?: number | null;
  taxAmount?: number | null;
  netAmount?: number | null;
  counterAccountCode?: string | null;
  createdBy: number;
  lines: LedgerLine[];
  // For non-voucher postings (sales invoice, etc.) caller can pass refDoc info
  refDocType?: string | null;
  refDocId?: number | null;
}

export interface Txc {
  tx: sql.Transaction;
  req: () => sql.Request;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

export async function postEntry(input: PostEntryInput, txc: Txc): Promise<{ voucherId: number }> {
  // Pre-checks: lines must total balance (defensive — DB trigger also enforces)
  const totalDebit = input.lines.reduce((s, l) => s + round2(l.debit), 0);
  const totalCredit = input.lines.reduce((s, l) => s + round2(l.credit), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Voucher is not balanced. Debit total ${totalDebit.toFixed(2)} does not equal credit total ${totalCredit.toFixed(2)}.`);
  }
  if (input.lines.length < 2) {
    throw new Error('A voucher must have at least two lines.');
  }
  for (const l of input.lines) {
    if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
      throw new Error('Each line must have exactly one of debit or credit.');
    }
    if (l.debit < 0 || l.credit < 0) {
      throw new Error('Debit and credit amounts must not be negative.');
    }
  }

  // Insert voucher header
  const vR = await txc.req()
    .input('vno', sql.VarChar, input.voucherNo)
    .input('vtype', sql.VarChar, input.voucherType)
    .input('ddate', sql.Date, input.docDate)
    .input('fyid', sql.Int, input.fiscalYearId)
    .input('bid', sql.Int, input.branchId)
    .input('cash', sql.VarChar, input.cashAccountCode ?? null)
    .input('bank', sql.VarChar, input.bankAccountCode ?? null)
    .input('pt', sql.VarChar, input.paymentType ?? null)
    .input('cno', sql.VarChar, input.chequeNo ?? null)
    .input('cdate', sql.Date, input.chequeDate ?? null)
    .input('cbn', sql.NVarChar, input.chequeBankName ?? null)
    .input('cstat', sql.VarChar, input.chequeStatus ?? null)
    .input('ref', sql.NVarChar, input.reference ?? null)
    .input('narr', sql.NVarChar, input.narration ?? null)
    .input('thid', sql.Int, input.taxHeadId ?? null)
    .input('tpct', sql.Decimal(7,4), input.taxPercentage ?? null)
    .input('gross', sql.Decimal(18,2), input.grossAmount ?? null)
    .input('tax', sql.Decimal(18,2), input.taxAmount ?? null)
    .input('net', sql.Decimal(18,2), input.netAmount ?? null)
    .input('cacct', sql.VarChar, input.counterAccountCode ?? null)
    .input('cb', sql.Int, input.createdBy)
    .query(`
      INSERT INTO dbo.vouchers
        (voucher_no, voucher_type, doc_date, fiscal_year_id, branch_id,
         cash_account_code, bank_account_code, payment_type, cheque_no, cheque_date, cheque_bank_name, cheque_status,
         reference, narration, tax_head_id, tax_percentage, gross_amount, tax_amount, net_amount,
         counter_account_code, status, created_by)
      OUTPUT INSERTED.id
      VALUES (@vno, @vtype, @ddate, @fyid, @bid,
              @cash, @bank, @pt, @cno, @cdate, @cbn, @cstat,
              @ref, @narr, @thid, @tpct, @gross, @tax, @net,
              @cacct, 'POSTED', @cb)
    `);
  const voucherId = vR.recordset[0].id;

  // Insert voucher lines
  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i];
    await txc.req()
      .input('vid', sql.BigInt, voucherId)
      .input('ln', sql.Int, i + 1)
      .input('ac', sql.VarChar, l.accountCode)
      .input('d', sql.Decimal(18,2), round2(l.debit))
      .input('c', sql.Decimal(18,2), round2(l.credit))
      .input('lnarr', sql.NVarChar, l.narration ?? null)
      .input('bid', sql.BigInt, l.billId ?? null)
      .input('aa', sql.Decimal(18,2), l.billId ? round2(Math.min(l.debit, l.credit)) : null)
      .query(`
        INSERT INTO dbo.voucher_lines (voucher_id, line_no, account_code, debit, credit, line_narration, bill_id, amount_applied)
        VALUES (@vid, @ln, @ac, @d, @c, @lnarr, @bid, @aa)
      `);
  }

  // Insert GL entries (mirror the lines)
  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i];
    await txc.req()
      .input('vid', sql.BigInt, voucherId)
      .input('rdt', sql.VarChar, input.refDocType ?? null)
      .input('rdi', sql.BigInt, input.refDocId ?? null)
      .input('ed', sql.Date, input.docDate)
      .input('fyid', sql.Int, input.fiscalYearId)
      .input('bid', sql.Int, input.branchId)
      .input('ac', sql.VarChar, l.accountCode)
      .input('d', sql.Decimal(18,2), round2(l.debit))
      .input('c', sql.Decimal(18,2), round2(l.credit))
      .input('narr', sql.NVarChar, l.narration ?? input.narration ?? null)
      .input('blid', sql.BigInt, l.billId ?? null)
      .query(`
        INSERT INTO dbo.gl_entries
          (voucher_id, ref_doc_type, ref_doc_id, entry_date, fiscal_year_id, branch_id,
           account_code, debit, credit, narration, bill_id, is_opening)
        VALUES (@vid, @rdt, @rdi, @ed, @fyid, @bid, @ac, @d, @c, @narr, @blid, 0)
      `);
  }

  return { voucherId };
}

/** Reverse a voucher's GL entries by posting mirrored lines (debit↔credit). */
export async function reverseVoucher(voucherId: number, txc: Txc): Promise<void> {
  const r = await txc.req()
    .input('vid', sql.BigInt, voucherId)
    .query(`SELECT id, voucher_no, voucher_type, doc_date, fiscal_year_id, branch_id, narration, created_by FROM dbo.vouchers WHERE id = @vid`);
  if (r.recordset.length === 0) throw new Error('Voucher not found.');
  const v = r.recordset[0];

  const linesR = await txc.req()
    .input('vid', sql.BigInt, voucherId)
    .query(`SELECT account_code, debit, credit, line_narration, bill_id FROM dbo.voucher_lines WHERE voucher_id = @vid ORDER BY line_no`);

  // Reverse: debit becomes credit, credit becomes debit
  const reversedLines: LedgerLine[] = linesR.recordset.map((row: any) => ({
    accountCode: row.account_code,
    debit: row.credit,
    credit: row.debit,
    narration: `Reversal: ${v.voucher_no}. ${row.line_narration ?? ''}`.trim(),
    billId: row.bill_id ?? null,
  }));

  // Mark the original voucher as REVERSED
  await txc.req()
    .input('vid', sql.BigInt, voucherId)
    .query(`UPDATE dbo.vouchers SET status = 'REVERSED' WHERE id = @vid`);

  // Release any allocations on the bills — per bill, not the voucher total
  await txc.req()
    .input('vid', sql.BigInt, voucherId)
    .query(`
      UPDATE b
      SET b.settled_amount = b.settled_amount - applied.total
      FROM dbo.bills b
      JOIN (
        SELECT bill_id, SUM(amount_applied) AS total
        FROM dbo.voucher_lines
        WHERE voucher_id = @vid AND bill_id IS NOT NULL
        GROUP BY bill_id
      ) applied ON applied.bill_id = b.id
    `);

  // Post the reversing entry
  await postEntry({
    voucherNo: `${v.voucher_no}-REV`,
    voucherType: v.voucher_type,
    docDate: new Date(v.doc_date),
    fiscalYearId: v.fiscal_year_id,
    branchId: v.branch_id,
    narration: `Reversal of ${v.voucher_no}. ${(v.narration ?? '').trim()}`,
    createdBy: v.created_by,
    lines: reversedLines,
  }, txc);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type { beginTx };
