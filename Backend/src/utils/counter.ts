/* ===========================================================================
 * Master ID counter (never-reuse pattern)
 * Uses UPDLOCK, HOLDLOCK inside a transaction to guarantee no two writers
 * receive the same number, and the counter only moves forward.
 * ==========================================================================*/
import { beginTx, sql } from '../db/pool';

export type CounterType =
  | 'USERS' | 'UNITS' | 'TAX_HEADS' | 'AUDIT'
  // Counter types may also include 'ACCOUNTS'/'PRODUCTS' but those use
  // hierarchical codes; only flat-id masters use this counter.
  ;

/** Allocate `count` sequential display IDs and update the counter atomically. */
export async function allocateIds(type: CounterType, count: number = 1): Promise<number[]> {
  if (count < 1) throw new Error('Cannot allocate fewer than 1 ID');
  const txc = await beginTx();
  try {
    // Ensure row exists
    await txc.req().input('type', sql.VarChar, type)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.master_counter WHERE counter_type = @type)
        INSERT INTO dbo.master_counter (counter_type, next_value) VALUES (@type, 1)
      `);

    // Read with lock
    const r = await txc.req().input('type2', sql.VarChar, type)
      .query(`
        SELECT next_value FROM dbo.master_counter WITH (UPDLOCK, HOLDLOCK)
        WHERE counter_type = @type2
      `);
    if (r.recordset.length === 0) {
      throw new Error(`Counter ${type} not initialised`);
    }
    const startAt = r.recordset[0].next_value;
    const newNext = startAt + count;
    await txc.req()
      .input('type3', sql.VarChar, type)
      .input('newNext', sql.Int, newNext)
      .query(`UPDATE dbo.master_counter SET next_value = @newNext WHERE counter_type = @type3`);

    const ids: number[] = [];
    for (let i = 0; i < count; i++) ids.push(startAt + i);

    await txc.commit();
    return ids;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

/** Format a numeric id as a 4-digit zero-padded display string (widens after 9999). */
export function formatDisplayId(n: number): string {
  if (n < 1) throw new Error('ID must be positive');
  if (n <= 9999) return String(n).padStart(4, '0');
  return String(n); // widen naturally past 9999
}
