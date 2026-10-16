/* ===========================================================================
 * Inventory document service — Opening Stock, Move Stock, Adjust Stock.
 * Wraps the primitives in stock.service.ts and adds GL postings where the
 * spec requires them.
 *
 * Opening Stock (OS): no GL effect; sets the starting moving-average cost
 *   per product+store and stores the four price types on the line.
 * Move Stock (MV): no GL effect; stock-out from source store and stock-in
 *   to target store at source store's average cost.
 * Adjust Stock (SA): GL effect — Dr Inventory, Cr Stock Adjustment for a
 *   gain; reverse for a loss. Posts via the ledger engine.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { stockIn, stockOut, transfer, currentQuantity, negativeStockAllowed } from './stock.service';
import { postEntry, LedgerLine, reverseVoucher } from './ledger.service';
import { nextDocNumber, fiscalYearForDate, DocType } from '../utils/docNumber';
import { audit, AuditContext } from '../utils/audit';
import type { Txc } from './ledger.service';

// ---------------------------------------------------------------------------
// Opening Stock
// ---------------------------------------------------------------------------
export interface OpeningStockLine {
  productId: number;
  quantity: number;
  costPrice?: number | null;
  salesPrice?: number | null;
  wholesalePrice?: number | null;
  resalePrice?: number | null;
}

export async function createOpeningStock(input: {
  docDate: string;
  branchId: number;
  storeId: number;
  lines: OpeningStockLine[];
  reference?: string | null;
}, auditCtx: AuditContext): Promise<{ docNo: string; lineCount: number }> {
  if (!input.lines.length) throw new Error('At least one line is required.');
  const docDate = new Date(input.docDate);
  const fyInfo = await fiscalYearForDate(docDate);

  const txc = await beginTx();
  try {
    const brR = await txc.req()
      .input('bid', sql.Int, input.branchId)
      .query(`SELECT short_name FROM dbo.branches WHERE id = @bid`);
    if (brR.recordset.length === 0) throw new Error('Branch not found.');
    const branchShort = brR.recordset[0].short_name;

    const docNo = await nextDocNumber(branchShort, 'OS' as DocType, fyInfo.fyId, fyInfo.fyEndYY);

    let lineNo = 0;
    for (const line of input.lines) {
      lineNo++;
      // Generate a unique doc_no per opening-stock line (the schema has
      // a UNIQUE constraint on doc_no per opening_stock_lines row).
      const lineDocNo = `${docNo}/${lineNo}`;
      // stockIn updates the moving average using costPrice (or 0 if blank)
      await stockIn({
        productId: line.productId,
        storeId: input.storeId,
        quantity: line.quantity,
        rate: line.costPrice ?? 0,
        docType: 'OS',
        refDocType: 'OS',
        refDocId: null,
        docDate,
        branchId: input.branchId,
        narration: `Opening stock ${lineDocNo}`,
      }, txc);

      // Insert the opening_stock_lines row (stores the price types)
      await txc.req()
        .input('dn', sql.VarChar, lineDocNo)
        .input('dd', sql.Date, docDate)
        .input('fy', sql.Int, fyInfo.fyId)
        .input('bid', sql.Int, input.branchId)
        .input('sid', sql.Int, input.storeId)
        .input('pid', sql.Int, line.productId)
        .input('q', sql.Decimal(18,4), line.quantity)
        .input('cp', sql.Decimal(18,4), line.costPrice ?? null)
        .input('sp', sql.Decimal(18,4), line.salesPrice ?? null)
        .input('wp', sql.Decimal(18,4), line.wholesalePrice ?? null)
        .input('rp', sql.Decimal(18,4), line.resalePrice ?? null)
        .input('cb', sql.Int, auditCtx.userId!)
        .query(`
          INSERT INTO dbo.opening_stock_lines (doc_no, doc_date, fiscal_year_id, branch_id, store_id, product_id, quantity, cost_price, sales_price, wholesale_price, resale_price, created_by)
          VALUES (@dn, @dd, @fy, @bid, @sid, @pid, @q, @cp, @sp, @wp, @rp, @cb)
        `);
    }

    await audit(auditCtx, 'opening_stock', 'CREATE', 'OpeningStock', null, docNo, null, input, txc.tx);
    await txc.commit();
    return { docNo, lineCount: lineNo };
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function listOpeningStock(filter: { branchId?: number; storeId?: number; fromDate?: string; toDate?: string }): Promise<any[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, filter.branchId ?? null)
    .input('sid', sql.Int, filter.storeId ?? null)
    .input('fd', sql.Date, filter.fromDate ?? null)
    .input('td', sql.Date, filter.toDate ?? null)
    .query(`
      SELECT osl.doc_no, osl.doc_date, osl.branch_id, b.short_name AS branch_short,
             osl.store_id, s.code AS store_code, s.name AS store_name,
             osl.product_id, p.code AS product_code, p.name AS product_name,
             osl.quantity, osl.cost_price, osl.sales_price, osl.wholesale_price, osl.resale_price
      FROM dbo.opening_stock_lines osl
      JOIN dbo.branches b ON b.id = osl.branch_id
      JOIN dbo.stores s ON s.id = osl.store_id
      JOIN dbo.products p ON p.id = osl.product_id
      WHERE (@bid IS NULL OR osl.branch_id = @bid)
        AND (@sid IS NULL OR osl.store_id = @sid)
        AND (@fd IS NULL OR osl.doc_date >= @fd)
        AND (@td IS NULL OR osl.doc_date <= @td)
      ORDER BY osl.doc_date DESC, osl.doc_no
    `);
  return r.recordset;
}

// ---------------------------------------------------------------------------
// Move Stock
// ---------------------------------------------------------------------------
export interface MoveStockLine { productId: number; quantity: number; }

export async function createMoveStock(input: {
  docDate: string;
  branchId: number;
  fromStoreId: number;
  toStoreId: number;
  lines: MoveStockLine[];
  reference?: string | null;
}, auditCtx: AuditContext): Promise<{ docNo: string }> {
  if (input.fromStoreId === input.toStoreId) throw new Error('From and to stores must be different.');
  if (!input.lines.length) throw new Error('At least one line is required.');
  const docDate = new Date(input.docDate);
  const fyInfo = await fiscalYearForDate(docDate);

  const txc = await beginTx();
  try {
    const brR = await txc.req().input('bid', sql.Int, input.branchId).query(`SELECT short_name FROM dbo.branches WHERE id = @bid`);
    if (brR.recordset.length === 0) throw new Error('Branch not found.');
    const branchShort = brR.recordset[0].short_name;
    const docNo = await nextDocNumber(branchShort, 'MV' as DocType, fyInfo.fyId, fyInfo.fyEndYY);

    const moveR = await txc.req()
      .input('dn', sql.VarChar, docNo)
      .input('dd', sql.Date, docDate)
      .input('fy', sql.Int, fyInfo.fyId)
      .input('bid', sql.Int, input.branchId)
      .input('fsid', sql.Int, input.fromStoreId)
      .input('tsid', sql.Int, input.toStoreId)
      .input('ref', sql.NVarChar, input.reference ?? null)
      .input('cb', sql.Int, auditCtx.userId!)
      .query(`
        INSERT INTO dbo.stock_moves (doc_no, doc_date, fiscal_year_id, branch_id, from_store_id, to_store_id, reference, created_by)
        OUTPUT INSERTED.id
        VALUES (@dn, @dd, @fy, @bid, @fsid, @tsid, @ref, @cb)
      `);
    const moveId = moveR.recordset[0].id;

    let lineNo = 0;
    for (const line of input.lines) {
      lineNo++;
      // transfer() writes stock-out at source and stock-in at target
      // at source store's current average cost; no GL effect.
      const { rate: avgCostAtMove } = await transfer({
        productId: line.productId,
        storeId: input.fromStoreId,
        toStoreId: input.toStoreId,
        quantity: line.quantity,
        docType: 'MV',
        docDate,
        branchId: input.branchId,
        refDocType: 'MV',
        refDocId: moveId,
      }, txc);
      await txc.req()
        .input('mid', sql.BigInt, moveId)
        .input('ln', sql.Int, lineNo)
        .input('pid', sql.Int, line.productId)
        .input('q', sql.Decimal(18,4), line.quantity)
        .input('ac', sql.Decimal(18,4), avgCostAtMove)
        .query(`
          INSERT INTO dbo.stock_move_lines (move_id, line_no, product_id, quantity, avg_cost_at_post)
          VALUES (@mid, @ln, @pid, @q, @ac)
        `);
    }

    await audit(auditCtx, 'move_stock', 'CREATE', 'MoveStock', String(moveId), docNo, null, input, txc.tx);
    await txc.commit();
    return { docNo };
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function listMoveStock(filter: { branchId?: number; fromDate?: string; toDate?: string }): Promise<any[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, filter.branchId ?? null)
    .input('fd', sql.Date, filter.fromDate ?? null)
    .input('td', sql.Date, filter.toDate ?? null)
    .query(`
      SELECT m.id, m.doc_no, m.doc_date, m.branch_id, b.short_name AS branch_short,
             m.from_store_id, fs.code AS from_store_code, fs.name AS from_store_name,
             m.to_store_id, ts.code AS to_store_code, ts.name AS to_store_name,
             m.reference, m.created_at
      FROM dbo.stock_moves m
      JOIN dbo.branches b ON b.id = m.branch_id
      JOIN dbo.stores fs ON fs.id = m.from_store_id
      JOIN dbo.stores ts ON ts.id = m.to_store_id
      WHERE (@bid IS NULL OR m.branch_id = @bid)
        AND (@fd IS NULL OR m.doc_date >= @fd)
        AND (@td IS NULL OR m.doc_date <= @td)
      ORDER BY m.doc_date DESC, m.id DESC
    `);
  return r.recordset;
}

// ---------------------------------------------------------------------------
// Adjust Stock
// ---------------------------------------------------------------------------
export interface AdjustStockLine {
  productId: number;
  systemQty: number;
  physicalQty: number;
  reason: string;
}

export async function createAdjustStock(input: {
  docDate: string;
  branchId: number;
  storeId: number;
  lines: AdjustStockLine[];
  reference?: string | null;
}, auditCtx: AuditContext): Promise<{ docNo: string }> {
  if (!input.lines.length) throw new Error('At least one line is required.');
  // Validate reason on every line
  for (const l of input.lines) {
    if (!l.reason || l.reason.trim() === '') throw new Error('A reason is required on every adjustment line.');
  }
  const docDate = new Date(input.docDate);
  const fyInfo = await fiscalYearForDate(docDate);

  // Read mapped accounts from settings
  const pool = await getPool();
  const acctR = await pool.request().query(`SELECT inventory_account_code, stock_adjustment_account_code FROM dbo.settings WHERE id = 1`);
  if (!acctR.recordset[0].inventory_account_code || !acctR.recordset[0].stock_adjustment_account_code) {
    throw new Error('Inventory and Stock Adjustment accounts must be mapped in the Default Page before adjustments can be posted.');
  }
  const inventoryAcct = acctR.recordset[0].inventory_account_code;
  const stockAdjAcct = acctR.recordset[0].stock_adjustment_account_code;

  const txc = await beginTx();
  try {
    const brR = await txc.req().input('bid', sql.Int, input.branchId).query(`SELECT short_name FROM dbo.branches WHERE id = @bid`);
    if (brR.recordset.length === 0) throw new Error('Branch not found.');
    const branchShort = brR.recordset[0].short_name;
    const docNo = await nextDocNumber(branchShort, 'SA' as DocType, fyInfo.fyId, fyInfo.fyEndYY);

    const adjR = await txc.req()
      .input('dn', sql.VarChar, docNo)
      .input('dd', sql.Date, docDate)
      .input('fy', sql.Int, fyInfo.fyId)
      .input('bid', sql.Int, input.branchId)
      .input('sid', sql.Int, input.storeId)
      .input('ref', sql.NVarChar, input.reference ?? null)
      .input('cb', sql.Int, auditCtx.userId!)
      .query(`
        INSERT INTO dbo.stock_adjustments (doc_no, doc_date, fiscal_year_id, branch_id, store_id, reference, created_by)
        OUTPUT INSERTED.id
        VALUES (@dn, @dd, @fy, @bid, @sid, @ref, @cb)
      `);
    const adjId = adjR.recordset[0].id;

    // Build GL lines: for each line, gain = Dr Inventory, Cr Stock Adjustment;
    // loss = Dr Stock Adjustment, Cr Inventory. Use current avg cost as rate.
    const ledgerLines: LedgerLine[] = [];
    let lineNo = 0;
    let totalDebit = 0, totalCredit = 0;
    for (const line of input.lines) {
      lineNo++;
      const difference = Number((line.physicalQty - line.systemQty).toFixed(4));
      if (Math.abs(difference) < 0.0001) continue;  // no adjustment needed

      // Determine avg cost via currentQuantity + reading balance row
      const bal = await txc.req()
        .input('pid', sql.Int, line.productId)
        .input('sid', sql.Int, input.storeId)
        .query(`SELECT quantity, avg_cost FROM dbo.stock_balances WITH (UPDLOCK, HOLDLOCK) WHERE product_id = @pid AND store_id = @sid`);
      if (bal.recordset.length === 0) throw new Error(`No stock balance for product ${line.productId} in this store.`);
      const avgCost = Number(bal.recordset[0].avg_cost) || 0;
      const lineValue = Math.round((Math.abs(difference) * avgCost) * 100) / 100;

      if (difference > 0) {
        // Gain — Dr Inventory, Cr Stock Adjustment
        ledgerLines.push({ accountCode: inventoryAcct, debit: lineValue, credit: 0, narration: `Stock gain: ${line.reason}` });
        ledgerLines.push({ accountCode: stockAdjAcct, debit: 0, credit: lineValue, narration: `Stock gain: ${line.reason}` });
        totalDebit += lineValue; totalCredit += lineValue;
        // Stock-in
        await stockIn({
          productId: line.productId, storeId: input.storeId, quantity: Math.abs(difference),
          rate: avgCost, docType: 'SA', refDocType: 'SA', refDocId: adjId, docDate, branchId: input.branchId,
          narration: `Stock adjustment gain: ${line.reason}`,
        }, txc);
      } else {
        // Loss — Dr Stock Adjustment, Cr Inventory
        ledgerLines.push({ accountCode: stockAdjAcct, debit: lineValue, credit: 0, narration: `Stock loss: ${line.reason}` });
        ledgerLines.push({ accountCode: inventoryAcct, debit: 0, credit: lineValue, narration: `Stock loss: ${line.reason}` });
        totalDebit += lineValue; totalCredit += lineValue;
        // Stock-out
        await stockOut({
          productId: line.productId, storeId: input.storeId, quantity: Math.abs(difference),
          docType: 'SA', refDocType: 'SA', refDocId: adjId, docDate, branchId: input.branchId,
          narration: `Stock adjustment loss: ${line.reason}`,
        }, txc);
      }

      await txc.req()
        .input('aid', sql.BigInt, adjId)
        .input('ln', sql.Int, lineNo)
        .input('pid', sql.Int, line.productId)
        .input('sq', sql.Decimal(18,4), line.systemQty)
        .input('pq', sql.Decimal(18,4), line.physicalQty)
        .input('diff', sql.Decimal(18,4), difference)
        .input('rsn', sql.NVarChar, line.reason)
        .input('ac', sql.Decimal(18,4), avgCost)
        .query(`
          INSERT INTO dbo.stock_adjustment_lines (adjustment_id, line_no, product_id, system_qty, physical_qty, difference, reason, avg_cost_at_post)
          VALUES (@aid, @ln, @pid, @sq, @pq, @diff, @rsn, @ac)
        `);
    }

    // Post the adjustment entry via the ledger engine
    if (ledgerLines.length >= 2) {
      await postEntry({
        voucherNo: docNo,
        voucherType: 'JV',  // SAs post as JVs since there's no separate voucher_type for them
        docDate,
        fiscalYearId: fyInfo.fyId,
        branchId: input.branchId,
        narration: `Stock adjustment ${docNo}`,
        createdBy: auditCtx.userId!,
        lines: ledgerLines,
        refDocType: 'SA',
        refDocId: adjId,
      }, txc);
    }

    await audit(auditCtx, 'adjust_stock', 'CREATE', 'AdjustStock', String(adjId), docNo, null, input, txc.tx);
    await txc.commit();
    return { docNo };
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function listAdjustStock(filter: { branchId?: number; storeId?: number; fromDate?: string; toDate?: string }): Promise<any[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, filter.branchId ?? null)
    .input('sid', sql.Int, filter.storeId ?? null)
    .input('fd', sql.Date, filter.fromDate ?? null)
    .input('td', sql.Date, filter.toDate ?? null)
    .query(`
      SELECT a.id, a.doc_no, a.doc_date, a.branch_id, b.short_name AS branch_short,
             a.store_id, s.code AS store_code, s.name AS store_name,
             a.reference, a.created_at
      FROM dbo.stock_adjustments a
      JOIN dbo.branches b ON b.id = a.branch_id
      JOIN dbo.stores s ON s.id = a.store_id
      WHERE (@bid IS NULL OR a.branch_id = @bid)
        AND (@sid IS NULL OR a.store_id = @sid)
        AND (@fd IS NULL OR a.doc_date >= @fd)
        AND (@td IS NULL OR a.doc_date <= @td)
      ORDER BY a.doc_date DESC, a.id DESC
    `);
  return r.recordset;
}

// ---------------------------------------------------------------------------
// Stock / Product Ledger
// ---------------------------------------------------------------------------
export async function stockLedger(filter: {
  productId?: number | null;
  storeId?: number | null;
  fromDate?: string;
  toDate?: string;
}): Promise<any> {
  const pool = await getPool();
  if (!filter.productId) throw new Error('productId is required.');

  // Opening balance as of fromDate (or 0 if no fromDate)
  const openR = await pool.request()
    .input('pid', sql.Int, filter.productId)
    .input('sid', sql.Int, filter.storeId ?? null)
    .input('fd', sql.Date, filter.fromDate ?? null)
    .query(`
      SELECT TOP 1 *
      FROM dbo.stock_ledger
      WHERE product_id = @pid
        AND (@sid IS NULL OR store_id = @sid)
        AND (@fd IS NULL OR doc_date < @fd)
      ORDER BY doc_date DESC, id DESC
    `);
  const opening = openR.recordset.length > 0 ? {
    quantity: Number(openR.recordset[0].balance_after),
    avgCost: Number(openR.recordset[0].avg_cost_after),
  } : { quantity: 0, avgCost: 0 };

  // Movements in the period
  const mvR = await pool.request()
    .input('pid', sql.Int, filter.productId)
    .input('sid', sql.Int, filter.storeId ?? null)
    .input('fd', sql.Date, filter.fromDate ?? null)
    .input('td', sql.Date, filter.toDate ?? null)
    .query(`
      SELECT id, doc_type, ref_doc_id, doc_date, store_id, s.code AS store_code, s.name AS store_name,
             qty_in, qty_out, rate, balance_after, avg_cost_after, narration
      FROM dbo.stock_ledger sl
      LEFT JOIN dbo.stores s ON s.id = sl.store_id
      WHERE product_id = @pid
        AND (@sid IS NULL OR store_id = @sid)
        AND (@fd IS NULL OR doc_date >= @fd)
        AND (@td IS NULL OR doc_date <= @td)
        AND is_reversed = 0
      ORDER BY doc_date, id
    `);

  // Closing = last balance in the period, or opening if no movements
  const closing = mvR.recordset.length > 0
    ? { quantity: Number(mvR.recordset[mvR.recordset.length - 1].balance_after), avgCost: Number(mvR.recordset[mvR.recordset.length - 1].avg_cost_after) }
    : opening;

  return {
    opening,
    movements: mvR.recordset.map((r: any) => ({
      ...r,
      qty_in: Number(r.qty_in), qty_out: Number(r.qty_out), rate: Number(r.rate),
      balance_after: Number(r.balance_after), avg_cost_after: Number(r.avg_cost_after),
    })),
    closing,
  };
}

// ---------------------------------------------------------------------------
// Inventory report (as-of-date summary)
// ---------------------------------------------------------------------------
export async function inventoryReport(filter: {
  asOfDate: string;
  branchId?: number | null;
  storeId?: number | null;
}): Promise<any> {
  const pool = await getPool();
  // Current stock_balances joined to product + store
  const r = await pool.request()
    .input('bid', sql.Int, filter.branchId ?? null)
    .input('sid', sql.Int, filter.storeId ?? null)
    .input('d', sql.Date, filter.asOfDate)
    .query(`
      SELECT p.id AS product_id, p.code AS product_code, p.name AS product_name,
             s.id AS store_id, s.code AS store_code, s.name AS store_name,
             sb.quantity, sb.avg_cost,
             (sb.quantity * sb.avg_cost) AS value,
             p.reorder_level
      FROM dbo.stock_balances sb
      JOIN dbo.products p ON p.id = sb.product_id
      JOIN dbo.stores s ON s.id = sb.store_id
      WHERE p.is_group = 0
        AND (@bid IS NULL OR EXISTS (SELECT 1 FROM dbo.store_branch_tags t WHERE t.store_id = s.id AND t.branch_id = @bid))
        AND (@sid IS NULL OR s.id = @sid)
      ORDER BY p.code, s.code
    `);
  // Filter by as-of-date: query stock_ledger for closing balance per product+store
  // For simplicity in this iteration, we report the current balance which is correct
  // for the latest state. A historical as-of-date query would recalculate from the
  // stock_ledger; that's the next iteration.
  const totalValue = r.recordset.reduce((sum: number, row: any) => sum + Number(row.value), 0);
  const totalQty = r.recordset.reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
  return {
    rows: r.recordset.map((row: any) => ({
      ...row,
      quantity: Number(row.quantity),
      avg_cost: Number(row.avg_cost),
      value: Number(row.value),
      reorder_level: Number(row.reorder_level),
      below_reorder: Number(row.quantity) <= Number(row.reorder_level),
    })),
    totalValue, totalQty,
  };
}
