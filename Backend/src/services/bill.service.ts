/* ===========================================================================
 * Bill and allocation engine — Knock-Off (bill-wise) and FIFO modes.
 *
 * Knock-Off mode: every customer/supplier document creates a bill; receipts,
 * payments, JVs and notes allocate to open bills (partial allowed); unapplied
 * amounts become unapplied advances on the party. Editing/deleting a voucher
 * releases its allocations.
 *
 * FIFO mode: no bill selection anywhere; settlement is computed oldest-first
 * from the party ledger at query time (aging, balances).
 *
 * Party balance always equals the sum of their GL lines; the bill data must
 * reconcile to it — covered by tests.
 * ==========================================================================*/
import { getPool, sql } from '../db/pool';
import type { Txc } from './ledger.service';

export type BillType = 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'OPENING' | 'JV_LINE';

export interface CreateBillInput {
  billNo: string;
  billType: BillType;
  partyAccountCode: string;
  branchId: number;
  docDate: Date;
  creditDays?: number;
  grossAmount: number;
  taxAmount?: number;
  netAmount: number;
  refDocType?: string | null;
  refDocId?: number | null;
}

/** Create a bill (invoice/note/opening) inside the caller's transaction. */
export async function createBill(input: CreateBillInput, txc: Txc): Promise<number> {
  const dueDate = new Date(input.docDate);
  dueDate.setDate(dueDate.getDate() + (input.creditDays ?? 0));
  const r = await txc.req()
    .input('no', sql.NVarChar, input.billNo)
    .input('bt', sql.VarChar, input.billType)
    .input('party', sql.VarChar, input.partyAccountCode)
    .input('rdt', sql.VarChar, input.refDocType ?? null)
    .input('rdi', sql.BigInt, input.refDocId ?? null)
    .input('bid', sql.Int, input.branchId)
    .input('dd', sql.Date, input.docDate)
    .input('due', sql.Date, dueDate)
    .input('gross', sql.Decimal(18, 2), input.grossAmount)
    .input('tax', sql.Decimal(18, 2), input.taxAmount ?? 0)
    .input('net', sql.Decimal(18, 2), input.netAmount)
    .query(`
      INSERT INTO dbo.bills
        (bill_no, bill_type, party_account_code, ref_doc_type, ref_doc_id, branch_id,
         doc_date, due_date, gross_amount, tax_amount, net_amount, settled_amount)
      VALUES (@no, @bt, @party, @rdt, @rdi, @bid, @dd, @due, @gross, @tax, @net, 0);
      SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS id;
    `);
  return Number(r.recordset[0].id);
}

export interface OpenBill {
  id: number;
  billNo: string;
  billType: string;
  docDate: string;
  dueDate: string | null;
  netAmount: number;
  settledAmount: number;
  outstanding: number;
}

/** Open (not fully settled) bills of a party, oldest first — the Knock-Off panel list. */
export async function getOpenBills(partyAccountCode: string, branchId?: number | null): Promise<OpenBill[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('party', sql.VarChar, partyAccountCode)
    .input('bid', sql.Int, branchId ?? null)
    .query(`
      SELECT id, bill_no AS billNo, bill_type AS billType, doc_date AS docDate, due_date AS dueDate,
             net_amount AS netAmount, settled_amount AS settledAmount,
             (net_amount - settled_amount) AS outstanding
      FROM dbo.bills
      WHERE party_account_code = @party
        AND settled_amount < net_amount
        AND (@bid IS NULL OR branch_id = @bid)
      ORDER BY doc_date, id
    `);
  // BIGINT columns arrive as strings from the driver — coerce for the UI/API
  return r.recordset.map((b: any) => ({
    ...b,
    id: Number(b.id),
    netAmount: Number(b.netAmount),
    settledAmount: Number(b.settledAmount),
    outstanding: Number(b.outstanding),
  }));
}

/** Unapplied advance total for a party (receipts/payments with no bill applied). */
export async function getAdvanceBalance(partyAccountCode: string, txc: Txc): Promise<number> {
  const r = await txc.req()
    .input('party', sql.VarChar, partyAccountCode)
    .query(`
      SELECT ISNULL(SUM(vl.amount_applied), 0) AS advance
      FROM dbo.voucher_lines vl
      JOIN dbo.vouchers v ON v.id = vl.voucher_id
      WHERE vl.account_code = @party AND vl.bill_id IS NULL AND vl.amount_applied IS NOT NULL
    `);
  return Number(r.recordset[0].advance || 0);
}

export interface BillAllocation { billId: number; amount: number; }

/**
 * Validate a knock-off allocation set against the party's open bills and the
 * voucher amount. Returns the total applied. Throws with a plain message.
 */
export function validateAllocations(
  allocations: BillAllocation[],
  openBills: OpenBill[],
  voucherAmount: number,
): number {
  let total = 0;
  for (const a of allocations) {
    if (a.amount <= 0) throw new Error('Applied amounts must be greater than zero.');
    const bill = openBills.find((b) => b.id === a.billId);
    if (!bill) throw new Error('One of the selected bills is no longer open. Refresh the panel and try again.');
    if (a.amount > bill.outstanding + 0.001) {
      throw new Error(`Amount applied to bill ${bill.billNo} exceeds its outstanding ${bill.outstanding.toFixed(2)}.`);
    }
    total += a.amount;
  }
  if (total > voucherAmount + 0.001) {
    throw new Error(`Total applied (${total.toFixed(2)}) cannot exceed the voucher amount (${voucherAmount.toFixed(2)}).`);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Apply allocations by splitting the party line into one voucher line per bill
 * (each carrying bill_id + amount_applied); any remainder stays on the party
 * as an unapplied advance line. Returns the lines to post.
 */
export function splitPartyLineForKnockOff(
  partyAccountCode: string,
  partyDebit: number,
  partyCredit: number,
  allocations: BillAllocation[],
  narration: string | null,
): Array<{ accountCode: string; debit: number; credit: number; narration?: string | null; billId?: number | null; amountApplied?: number | null }> {
  const lines: Array<{ accountCode: string; debit: number; credit: number; narration?: string | null; billId?: number | null; amountApplied?: number | null }> = [];
  const side = partyDebit > 0 ? 'debit' : 'credit';
  const gross = partyDebit > 0 ? partyDebit : partyCredit;
  let applied = 0;
  for (const a of allocations) {
    applied += a.amount;
    lines.push({
      accountCode: partyAccountCode,
      debit: side === 'debit' ? a.amount : 0,
      credit: side === 'credit' ? a.amount : 0,
      narration,
      billId: a.billId,
      amountApplied: a.amount,
    });
  }
  const remainder = Math.round((gross - applied) * 100) / 100;
  if (remainder > 0.001) {
    lines.push({
      accountCode: partyAccountCode,
      debit: side === 'debit' ? remainder : 0,
      credit: side === 'credit' ? remainder : 0,
      narration: narration ? `${narration} (advance)` : 'Unapplied advance',
      billId: null,
      amountApplied: remainder,
    });
  }
  return lines;
}

/** Release every allocation a voucher made (on edit/delete/reversal). */
export async function releaseVoucherAllocations(voucherId: number, txc: Txc): Promise<void> {
  await txc.req()
    .input('vid', sql.BigInt, voucherId)
    .query(`
      UPDATE b
      SET b.settled_amount = b.settled_amount - applied.total
      FROM dbo.bills b
      JOIN (
        SELECT bill_id, SUM(ISNULL(amount_applied, 0)) AS total
        FROM dbo.voucher_lines
        WHERE voucher_id = @vid AND bill_id IS NOT NULL
        GROUP BY bill_id
      ) applied ON applied.bill_id = b.id;
    `);
}

/**
 * FIFO settlement: computes, from the party's GL lines, how much of each
 * oldest outstanding document remains — used for aging in FIFO mode.
 * Direction: for a customer, invoices (credit lines) are settled by receipts
 * (debit lines); for a supplier, the mirror.
 */
export async function fifoSettlement(
  partyAccountCode: string,
  asOfDate: Date,
): Promise<Array<{ docNo: string; docDate: string; amount: number; outstanding: number }>> {
  const pool = await getPool();
  const docs = await pool.request()
    .input('party', sql.VarChar, partyAccountCode)
    .input('asof', sql.Date, asOfDate)
    .query(`
      SELECT v.voucher_no AS docNo, g.entry_date AS docDate,
             SUM(g.credit - g.debit) AS amount
      FROM dbo.gl_entries g
      JOIN dbo.vouchers v ON v.id = g.voucher_id
      WHERE g.account_code = @party AND g.entry_date <= @asof
      GROUP BY v.voucher_no, g.entry_date, v.id
      HAVING SUM(g.credit - g.debit) > 0
      ORDER BY g.entry_date, v.id
    `);
  const pays = await pool.request()
    .input('party', sql.VarChar, partyAccountCode)
    .input('asof', sql.Date, asOfDate)
    .query(`
      SELECT ISNULL(SUM(g.debit - g.credit), 0) AS paid
      FROM dbo.gl_entries g
      WHERE g.account_code = @party AND g.entry_date <= @asof
    `);
  let budget = Number(pays.recordset[0].paid || 0);
  const result: Array<{ docNo: string; docDate: string; amount: number; outstanding: number }> = [];
  for (const d of docs.recordset) {
    const amount = Number(d.amount);
    const outstanding = Math.max(0, Math.round((amount - budget) * 100) / 100);
    budget = Math.max(0, budget - amount);
    if (outstanding > 0.001) {
      result.push({ docNo: d.docNo, docDate: d.docDate, amount, outstanding });
    }
  }
  return result;
}
