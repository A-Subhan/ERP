/* ===========================================================================
 * Document numbering — format `branchShortName/TYPE/YY/000001`
 * Per-branch/type/fiscal-year series, never reused.
 * Concurrency-safe via UPDLOCK, HOLDLOCK on doc_number_counter.
 * ==========================================================================*/
import { beginTx, sql } from '../db/pool';

export type DocType =
  | 'SO' | 'DC' | 'SI' | 'CN'    // sales
  | 'PR' | 'PO' | 'RC' | 'PI' | 'DN'  // purchase
  | 'CRV' | 'CPV' | 'BRV' | 'BPV' | 'JV'  // vouchers
  | 'MV' | 'SA' | 'OS';          // stock

const VALID_TYPES: DocType[] = [
  'SO','DC','SI','CN','PR','PO','RC','PI','DN',
  'CRV','CPV','BRV','BPV','JV','MV','SA','OS',
];

export function isDocType(s: string): s is DocType {
  return (VALID_TYPES as string[]).includes(s);
}

/** Compute fiscal year (YY) from a document date and the FY table. */
export async function fiscalYearForDate(docDate: Date): Promise<{ fyId: number; fyEndYY: number; fyStartDate: Date; fyEndDate: Date }> {
  const { getPool, sql } = await import('../db/pool');
  const pool = await getPool();
  const r = await pool.request()
    .input('d', sql.Date, docDate)
    .query(`
      SELECT id, start_date, end_date
      FROM dbo.fiscal_years
      WHERE start_date <= @d AND end_date >= @d
    `);
  if (r.recordset.length === 0) {
    throw new Error('No fiscal year covers the document date. Define a fiscal year first in the Default Page.');
  }
  const row = r.recordset[0];
  return {
    fyId: row.id,
    fyEndYY: new Date(row.end_date).getFullYear() % 100,
    fyStartDate: new Date(row.start_date),
    fyEndDate: new Date(row.end_date),
  };
}

/** Allocate the next document number for (branchShort, docType, fyEndYY). */
export async function nextDocNumber(branchShort: string, type: DocType, fyId: number, fyEndYY: number): Promise<string> {
  const txc = await beginTx();
  try {
    // Ensure counter row exists
    await txc.req()
      .input('bs', sql.VarChar, branchShort)
      .input('t',  sql.VarChar, type)
      .input('fy', sql.Int, fyId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.doc_number_counter
          WHERE branch_short = @bs AND doc_type = @t AND fiscal_year = @fy
        )
        INSERT INTO dbo.doc_number_counter (branch_short, doc_type, fiscal_year, next_serial)
        VALUES (@bs, @t, @fy, 1)
      `);

    // Lock and read
    const r = await txc.req()
      .input('bs2', sql.VarChar, branchShort)
      .input('t2',  sql.VarChar, type)
      .input('fy2', sql.Int, fyId)
      .query(`
        SELECT next_serial
        FROM dbo.doc_number_counter WITH (UPDLOCK, HOLDLOCK)
        WHERE branch_short = @bs2 AND doc_type = @t2 AND fiscal_year = @fy2
      `);
    if (r.recordset.length === 0) throw new Error('Counter not initialised');
    const serial = r.recordset[0].next_serial;

    await txc.req()
      .input('bs3', sql.VarChar, branchShort)
      .input('t3',  sql.VarChar, type)
      .input('fy3', sql.Int, fyId)
      .input('next', sql.Int, serial + 1)
      .query(`
        UPDATE dbo.doc_number_counter
        SET next_serial = @next
        WHERE branch_short = @bs3 AND doc_type = @t3 AND fiscal_year = @fy3
      `);

    await txc.commit();
    return `${branchShort}/${type}/${String(fyEndYY).padStart(2, '0')}/${String(serial).padStart(6, '0')}`;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
