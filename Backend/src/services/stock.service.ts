/* ===========================================================================
 * Stock engine — stockIn / stockOut / transfer primitives used by every
 * stock document (opening stock, challans, invoices, returns, moves,
 * adjustments). Maintains per product+store moving average cost and the
 * stock_ledger running balance.
 *
 * All writes run inside the CALLER's transaction. The negative-stock switch
 * is enforced here and again by the TRG_stock_balances_nonneg trigger.
 *
 * Back-dated / edited / deleted documents: after any change, the affected
 * product+store ledger is recalculated forward from the document date
 * (recalculateLedger) so running quantity and moving average stay correct.
 * ==========================================================================*/
import { sql } from '../db/pool';
import type { Txc } from './ledger.service';

export interface StockMoveInput {
  productId: number;
  storeId: number;
  quantity: number;
  rate?: number | null;      // stockIn: new-in rate; stockOut: ignored (uses avg)
  docType: 'OS' | 'SI' | 'CN' | 'DC' | 'RC' | 'PI' | 'DN' | 'MV' | 'SA';
  refDocType?: string | null;
  refDocId?: number | null;
  docDate: Date;
  branchId?: number | null;
  narration?: string | null;
}

function r4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** Negative-stock allowed? Reads settings each call (cheap, always fresh). */
export async function negativeStockAllowed(txc: Txc): Promise<boolean> {
  const r = await txc.req().query(`SELECT allow_negative_stock FROM dbo.settings WHERE id = 1`);
  return !!(r.recordset[0] && r.recordset[0].allow_negative_stock);
}

async function getBalance(txc: Txc, productId: number, storeId: number): Promise<{ quantity: number; avgCost: number }> {
  const r = await txc.req()
    .input('pid', sql.Int, productId)
    .input('sid', sql.Int, storeId)
    .query(`SELECT quantity, avg_cost FROM dbo.stock_balances WITH (UPDLOCK, HOLDLOCK) WHERE product_id = @pid AND store_id = @sid`);
  if (r.recordset.length === 0) return { quantity: 0, avgCost: 0 };
  return { quantity: r.recordset[0].quantity, avgCost: r.recordset[0].avg_cost };
}

async function saveBalance(txc: Txc, productId: number, storeId: number, quantity: number, avgCost: number): Promise<void> {
  await txc.req()
    .input('pid', sql.Int, productId)
    .input('sid', sql.Int, storeId)
    .input('q', sql.Decimal(18, 4), r4(quantity))
    .input('c', sql.Decimal(18, 4), r4(avgCost))
    .query(`
      MERGE dbo.stock_balances AS t
      USING (SELECT @pid AS product_id, @sid AS store_id) AS s
        ON t.product_id = s.product_id AND t.store_id = s.store_id
      WHEN MATCHED THEN
        UPDATE SET quantity = @q, avg_cost = @c, last_updated = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (product_id, store_id, quantity, avg_cost) VALUES (@pid, @sid, @q, @c);
    `);
}

interface StockMoveResult {
  ledgerId: number;
  rate: number;          // rate the move was valued at
  avgCostAfter: number;
}

/** Stock in: increases quantity, recalculates the moving average. */
export async function stockIn(input: StockMoveInput, txc: Txc): Promise<StockMoveResult> {
  if (input.quantity <= 0) throw new Error('Stock-in quantity must be greater than zero.');
  const rate = r4(input.rate ?? 0);
  const cur = await getBalance(txc, input.productId, input.storeId);
  const newQty = r4(cur.quantity + input.quantity);
  const newAvg = newQty > 0
    ? r4((cur.quantity * cur.avgCost + input.quantity * rate) / newQty)
    : 0;

  const r = await txc.req()
    .input('dt', sql.VarChar, input.docType)
    .input('rdt', sql.VarChar, input.refDocType ?? null)
    .input('rdi', sql.BigInt, input.refDocId ?? null)
    .input('dd', sql.Date, input.docDate)
    .input('pid', sql.Int, input.productId)
    .input('sid', sql.Int, input.storeId)
    .input('qi', sql.Decimal(18, 4), r4(input.quantity))
    .input('rate', sql.Decimal(18, 4), rate)
    .input('bal', sql.Decimal(18, 4), newQty)
    .input('avg', sql.Decimal(18, 4), newAvg)
    .input('narr', sql.NVarChar, input.narration ?? null)
    .query(`
      INSERT INTO dbo.stock_ledger
        (doc_type, ref_doc_type, ref_doc_id, doc_date, product_id, store_id,
         qty_in, qty_out, rate, balance_after, avg_cost_after, narration)
      OUTPUT INSERTED.id
      VALUES (@dt, @rdt, @rdi, @dd, @pid, @sid, @qi, 0, @rate, @bal, @avg, @narr)
    `);
  await saveBalance(txc, input.productId, input.storeId, newQty, newAvg);
  return { ledgerId: r.recordset[0].id, rate, avgCostAfter: newAvg };
}

/** Stock out: values at the current moving average; enforces the negative switch. */
export async function stockOut(input: StockMoveInput, txc: Txc): Promise<StockMoveResult> {
  if (input.quantity <= 0) throw new Error('Stock-out quantity must be greater than zero.');
  const cur = await getBalance(txc, input.productId, input.storeId);
  const newQty = r4(cur.quantity - input.quantity);
  if (newQty < 0) {
    const allowed = await negativeStockAllowed(txc);
    if (!allowed) {
      throw new Error(`Not enough stock for this product in this store (available ${cur.quantity}, required ${input.quantity}). Negative stock is not allowed.`);
    }
  }
  const rate = cur.avgCost;

  const r = await txc.req()
    .input('dt', sql.VarChar, input.docType)
    .input('rdt', sql.VarChar, input.refDocType ?? null)
    .input('rdi', sql.BigInt, input.refDocId ?? null)
    .input('dd', sql.Date, input.docDate)
    .input('pid', sql.Int, input.productId)
    .input('sid', sql.Int, input.storeId)
    .input('qo', sql.Decimal(18, 4), r4(input.quantity))
    .input('rate', sql.Decimal(18, 4), rate)
    .input('bal', sql.Decimal(18, 4), newQty)
    .input('avg', sql.Decimal(18, 4), cur.avgCost)
    .input('narr', sql.NVarChar, input.narration ?? null)
    .query(`
      INSERT INTO dbo.stock_ledger
        (doc_type, ref_doc_type, ref_doc_id, doc_date, product_id, store_id,
         qty_in, qty_out, rate, balance_after, avg_cost_after, narration)
      OUTPUT INSERTED.id
      VALUES (@dt, @rdt, @rdi, @dd, @pid, @sid, 0, @qo, @rate, @bal, @avg, @narr)
    `);
  await saveBalance(txc, input.productId, input.storeId, newQty, cur.avgCost);
  return { ledgerId: r.recordset[0].id, rate, avgCostAfter: cur.avgCost };
}

/** Move stock between two stores of the same branch; carries the source average. */
export async function transfer(
  input: StockMoveInput & { toStoreId: number },
  txc: Txc,
): Promise<{ outLedgerId: number; inLedgerId: number; rate: number }> {
  if (input.toStoreId === input.storeId) throw new Error('Source and destination stores must be different.');
  const out = await stockOut(input, txc);
  const inn = await stockIn({
    ...input,
    storeId: input.toStoreId,
    rate: out.rate,             // carry the source average
    narration: input.narration ?? null,
  }, txc);
  // Link the two ledger rows
  await txc.req()
    .input('a', sql.BigInt, out.ledgerId)
    .input('b', sql.BigInt, inn.ledgerId)
    .query(`
      UPDATE dbo.stock_ledger SET paired_ledger_id = @b WHERE id = @a;
      UPDATE dbo.stock_ledger SET paired_ledger_id = @a WHERE id = @b;
    `);
  return { outLedgerId: out.ledgerId, inLedgerId: inn.ledgerId, rate: out.rate };
}

/**
 * Recalculate one product+store ledger forward from a date, rebuilding
 * running quantity / moving average. Call after back-dated inserts, edits
 * or deletes. Returns the corrected final quantity and average.
 */
export async function recalculateLedger(
  productId: number,
  storeId: number,
  fromDate: Date,
  txc: Txc,
): Promise<{ quantity: number; avgCost: number }> {
  // Ledger rows strictly before the recalculation point define the opening state
  const openR = await txc.req()
    .input('pid', sql.Int, productId)
    .input('sid', sql.Int, storeId)
    .input('d', sql.Date, fromDate)
    .query(`
      SELECT TOP 1 balance_after, avg_cost_after
      FROM dbo.stock_ledger
      WHERE product_id = @pid AND store_id = @sid AND doc_date < @d
      ORDER BY doc_date DESC, id DESC
    `);
  let qty = openR.recordset.length ? openR.recordset[0].balance_after : 0;
  let avg = openR.recordset.length ? openR.recordset[0].avg_cost_after : 0;

  const rowsR = await txc.req()
    .input('pid', sql.Int, productId)
    .input('sid', sql.Int, storeId)
    .input('d', sql.Date, fromDate)
    .query(`
      SELECT id, qty_in, qty_out, rate
      FROM dbo.stock_ledger
      WHERE product_id = @pid AND store_id = @sid AND doc_date >= @d
      ORDER BY doc_date, id
    `);

  for (const row of rowsR.recordset) {
    const qi = Number(row.qty_in);
    const qo = Number(row.qty_out);
    if (qi > 0) {
      avg = r4((qty * avg + qi * Number(row.rate)) / (qty + qi));
      qty = r4(qty + qi);
    } else {
      qty = r4(qty - qo);
      // average unchanged on an outbound move
    }
    await txc.req()
      .input('id', sql.BigInt, row.id)
      .input('bal', sql.Decimal(18, 4), qty)
      .input('avg', sql.Decimal(18, 4), avg)
      .query(`UPDATE dbo.stock_ledger SET balance_after = @bal, avg_cost_after = @avg WHERE id = @id`);
  }

  await saveBalance(txc, productId, storeId, qty, avg);
  return { quantity: qty, avgCost: avg };
}

/** Current quantity of a product in a store (no locks; for display). */
export async function currentQuantity(productId: number, storeId: number): Promise<number> {
  const { getPool } = await import('../db/pool');
  const pool = await getPool();
  const r = await pool.request()
    .input('pid', sql.Int, productId)
    .input('sid', sql.Int, storeId)
    .query(`SELECT quantity FROM dbo.stock_balances WHERE product_id = @pid AND store_id = @sid`);
  return r.recordset.length ? Number(r.recordset[0].quantity) : 0;
}
