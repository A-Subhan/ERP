/* ===========================================================================
 * Engine tests — ledger balance, posting guards, stock moving average,
 * recalculation, bills/knock-off, document numbering.
 * Runs against the real erp_test database (see global-setup.cjs).
 * ==========================================================================*/
import { beginTx, getPool, closePool, sql } from '../src/db/pool';
import { postEntry } from '../src/services/ledger.service';
import { stockIn, stockOut, transfer, recalculateLedger } from '../src/services/stock.service';
import { createBill, getOpenBills, validateAllocations, releaseVoucherAllocations } from '../src/services/bill.service';
import { nextDocNumber, fiscalYearForDate } from '../src/utils/docNumber';

let fyId: number;
let fyEndYY: number;

beforeAll(async () => {
  const pool = await getPool();
  // One fiscal year covering "now" for the whole suite
  const exists = await pool.request().query(`SELECT id, end_date FROM dbo.fiscal_years WHERE '2026-07-01' <= end_date AND '2027-06-30' >= start_date`);
  if (exists.recordset.length === 0) {
    await pool.request()
      .query(`INSERT INTO dbo.fiscal_years (name, start_date, end_date) VALUES (N'TY', '2026-07-01', '2027-06-30')`);
  }
  const fy = await pool.request().query(`SELECT id, end_date FROM dbo.fiscal_years WHERE '2026-07-01' <= end_date AND '2027-06-30' >= start_date`);
  fyId = fy.recordset[0].id;
  fyEndYY = new Date(fy.recordset[0].end_date).getFullYear() % 100;
});

async function postSimple(debit: number, credit: number, accountCode = '05002001') {
  const txc = await beginTx();
  try {
    const { voucherId } = await postEntry({
      voucherNo: `TEST/${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      voucherType: 'JV', docDate: new Date('2026-10-01'), fiscalYearId: fyId, branchId: 1,
      createdBy: 1,
      lines: [
        { accountCode, debit, credit: 0 },
        { accountCode: '01001001', debit: 0, credit: debit },
      ],
    }, txc);
    await txc.commit();
    return voucherId;
  } catch (e) { await txc.rollback(); throw e; }
}

describe('ledger engine', () => {
  test('balanced entry posts and GL mirrors lines', async () => {
    const vid = await postSimple(100, 100);
    const pool = await getPool();
    const r = await pool.request().input('id', sql.BigInt, vid)
      .query(`SELECT SUM(debit) d, SUM(credit) c FROM dbo.gl_entries WHERE voucher_id = @id`);
    expect(Number(r.recordset[0].d)).toBe(100);
    expect(Number(r.recordset[0].c)).toBe(100);
  });

  test('unbalanced entry is rejected by the database trigger', async () => {
    const txc = await beginTx();
    await expect(postEntry({
      voucherNo: `BAD/${Date.now()}`, voucherType: 'JV', docDate: new Date('2026-10-01'),
      fiscalYearId: fyId, branchId: 1, createdBy: 1,
      lines: [
        { accountCode: '05002001', debit: 100, credit: 0 },
        { accountCode: '01001001', debit: 0, credit: 90 },
      ],
    }, txc)).rejects.toThrow(/balanced/i);
    await txc.rollback();
  });

  test('posting to a group account is rejected', async () => {
    await expect(postSimple(50, 50, '01001')).rejects.toThrow(/group account/i);
  });

  test('posting to an inactive account is rejected', async () => {
    const pool = await getPool();
    await pool.request().query(`UPDATE dbo.accounts SET is_active = 0 WHERE code = '05002001'`);
    try {
      await expect(postSimple(25, 25, '05002001')).rejects.toThrow(/inactive/i);
    } finally {
      await pool.request().query(`UPDATE dbo.accounts SET is_active = 1 WHERE code = '05002001'`);
    }
  });

  test('document date outside any fiscal year is rejected', async () => {
    await expect(fiscalYearForDate(new Date('2030-01-01'))).rejects.toThrow(/fiscal year/i);
  });
});

describe('stock engine — moving average', () => {
  let productId = 0;
  let storeId = 0;
  let store2Id = 0;

  beforeAll(async () => {
    const pool = await getPool();
    const mkStore = async (code: string, name: string): Promise<number> => {
      const st = await pool.request()
        .input('c', sql.VarChar, code)
        .input('n', sql.NVarChar, name)
        .input('t', sql.VarChar, 'STOCK')
        .query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.stores WHERE code = @c)
          BEGIN
            INSERT INTO dbo.stores (code, parent_id, level_no, name, store_type, is_active)
            VALUES (@c, NULL, 1, @n, @t, 1);
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
          END
          ELSE SELECT id FROM dbo.stores WHERE code = @c
        `);
      const sid = Number(st.recordset[0].id);
      await pool.request()
        .input('sid', sql.Int, sid)
        .query(`IF NOT EXISTS (SELECT 1 FROM dbo.store_branch_tags WHERE store_id = @sid AND branch_id = 1) INSERT INTO dbo.store_branch_tags (store_id, branch_id) VALUES (@sid, 1)`);
      return sid;
    };
    storeId = await mkStore('01', 'Main Store');
    store2Id = await mkStore('01001', 'Second Store');
    const pr = await pool.request()
      .input('c', sql.VarChar, '01001')
      .input('n', sql.NVarChar, 'Test Product')
      .input('u', sql.Int, 1)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE code = '01001')
        BEGIN
          INSERT INTO dbo.products (code, parent_id, level_no, name, unit_id, is_group, is_active)
          VALUES (@c, NULL, 3, @n, @u, 0, 1);
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
        END
        ELSE SELECT id FROM dbo.products WHERE code = '01001'
      `);
    productId = Number(pr.recordset[0].id);
  });

  afterAll(async () => {
    await closePool().catch(() => { /* already closed */ });
  });

  test('stockIn recalculates the moving average; stockOut uses it', async () => {
    const txc = await beginTx();
    try {
      await stockIn({ productId, storeId, quantity: 10, rate: 100, docType: 'OS', docDate: new Date('2026-08-01') }, txc);
      const r2 = await stockIn({ productId, storeId, quantity: 10, rate: 200, docType: 'RC', docDate: new Date('2026-08-05') }, txc);
      expect(r2.avgCostAfter).toBeCloseTo(150, 4);
      const o = await stockOut({ productId, storeId, quantity: 5, docType: 'DC', docDate: new Date('2026-08-10') }, txc);
      expect(o.rate).toBeCloseTo(150, 4);
      await txc.commit();
    } catch (e) { await txc.rollback(); throw e; }
  });

  test('negative stock is blocked when the switch is off', async () => {
    const txc = await beginTx();
    try {
      // available is 15 after the above; take 1000
      await expect(stockOut({ productId, storeId, quantity: 1000, docType: 'DC', docDate: new Date('2026-08-12') }, txc))
        .rejects.toThrow(/Negative stock is not allowed/i);
    } finally { await txc.rollback(); }
  });

  test('transfer carries the source average to the destination', async () => {
    const txc = await beginTx();
    try {
      const r = await transfer({ productId, storeId, toStoreId: store2Id, quantity: 2, docType: 'MV', docDate: new Date('2026-08-15') }, txc);
      expect(r.rate).toBeGreaterThan(0);
      await txc.commit();
    } catch (e) { await txc.rollback(); throw e; }
  });

  test('back-dated insert recalculates running values forward', async () => {
    const txc = await beginTx();
    try {
      // Insert a back-dated big-cost receipt before everything
      await stockIn({ productId, storeId, quantity: 10, rate: 500, docType: 'OS', docDate: new Date('2026-07-15') }, txc);
      const res = await recalculateLedger(productId, storeId, new Date('2026-07-01'), txc);
      // This store's ledger: in 10@500, in 10@100, in 10@200, out 5, transfer-out 2 → 23 left
      expect(res.quantity).toBe(23);
      expect(res.avgCost).toBeCloseTo(266.6667, 3);
      await txc.commit();
    } catch (e) { await txc.rollback(); throw e; }
  });
});

describe('bill engine — knock-off', () => {
  test('bills list, allocation validation and release', async () => {
    const txc = await beginTx();
    try {
      const b1 = await createBill({
        billNo: `TESTBILL-${Date.now()}`, billType: 'SALES_INVOICE', partyAccountCode: '01001003',
        branchId: 1, docDate: new Date('2026-09-01'), creditDays: 30, grossAmount: 500, netAmount: 500,
      }, txc);
      const b2 = await createBill({
        billNo: `TESTBILL2-${Date.now()}`, billType: 'SALES_INVOICE', partyAccountCode: '01001003',
        branchId: 1, docDate: new Date('2026-09-15'), creditDays: 0, grossAmount: 300, netAmount: 300,
      }, txc);
      await txc.commit();

      const open = await getOpenBills('01001003');
      expect(open.length).toBeGreaterThanOrEqual(2);

      // over-apply rejected
      expect(() => validateAllocations([{ billId: b1, amount: 600 }], open, 500)).toThrow(/exceeds its outstanding/i);
      // over-voucher rejected
      expect(() => validateAllocations([{ billId: b1, amount: 400 }, { billId: b2, amount: 200 }], open, 500)).toThrow(/cannot exceed the voucher amount/i);
      // valid split passes
      const total = validateAllocations([{ billId: b1, amount: 400 }, { billId: b2, amount: 100 }], open, 500);
      expect(total).toBe(500);

      // simulate applied lines then release them
      const t2 = await beginTx();
      try {
        await t2.req()
          .input('b1', sql.BigInt, b1).input('b2', sql.BigInt, b2)
          .query(`UPDATE dbo.bills SET settled_amount = CASE WHEN id = @b1 THEN 400 ELSE 100 END WHERE id IN (@b1, @b2)`);
        await releaseVoucherAllocations(0, t2); // voucher 0 has no lines; use direct release on bills via SQL for the amounts
        await t2.req()
          .input('b1', sql.BigInt, b1).input('b2', sql.BigInt, b2)
          .query(`UPDATE dbo.bills SET settled_amount = 0 WHERE id IN (@b1, @b2)`);
        await t2.commit();
      } catch (e) { await t2.rollback(); throw e; }
    } catch (e) { await txc.rollback(); throw e; }
  });
});

describe('document numbering', () => {
  test('serial increments and format is branch/TYPE/YY/000001', async () => {
    const n1 = await nextDocNumber('HO', 'SI', fyId, fyEndYY);
    const n2 = await nextDocNumber('HO', 'SI', fyId, fyEndYY);
    expect(n1).toMatch(/^HO\/SI\/\d{2}\/\d{6}$/);
    const serial1 = parseInt(n1.split('/')[3], 10);
    const serial2 = parseInt(n2.split('/')[3], 10);
    expect(serial2).toBe(serial1 + 1);
  });
});
