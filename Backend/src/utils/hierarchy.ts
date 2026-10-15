/* ===========================================================================
 * Hierarchy code generator — builds parent + next-serial child codes
 * for Branches, Stores, Products, and Chart of Accounts.
 * ==========================================================================*/
import { beginTx, sql } from '../db/pool';

export type HierarchyKind = 'BRANCH' | 'STORE' | 'PRODUCT' | 'COA';

interface Settings {
  digitsPerLevel: number[];
  maxLevels: number;
}

export async function getHierarchySettings(kind: HierarchyKind): Promise<Settings> {
  const { getPool } = await import('../db/pool');
  const pool = await getPool();
  const field = kind === 'BRANCH' ? 'branch_digits_per_level'
              : kind === 'STORE'  ? 'store_digits_per_level'
              : kind === 'PRODUCT' ? 'product_digits_per_level'
              : 'coa_digits_per_level';
  const maxField = kind === 'BRANCH' ? 'branch_max_levels'
                 : kind === 'STORE'  ? 'store_max_levels'
                 : kind === 'PRODUCT' ? 'product_max_levels'
                 : 'coa_max_levels';

  const r = await pool.request().query(`SELECT ${field} AS digits, ${maxField} AS max FROM dbo.settings WHERE id = 1`);
  if (r.recordset.length === 0) throw new Error('Settings row missing; run first-time setup.');
  const raw = r.recordset[0].digits as string;
  const digits = raw.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !Number.isNaN(n));
  return { digitsPerLevel: digits, maxLevels: r.recordset[0].max };
}

/**
 * Generate the next child code at the given level under the given parent.
 * If parentCode is null/empty, generates a root-level code.
 *
 * Concurrency: locks the matching rows in the target table.
 */
export async function nextChildCode(
  kind: HierarchyKind,
  parentCode: string | null,
  targetLevel: number,
  tableName: 'branches' | 'stores' | 'products' | 'accounts'
): Promise<string> {
  const { digitsPerLevel, maxLevels } = await getHierarchySettings(kind);
  if (targetLevel < 1 || targetLevel > maxLevels) {
    throw new Error(`Level ${targetLevel} is out of range (1..${maxLevels})`);
  }
  if (targetLevel > digitsPerLevel.length) {
    throw new Error(`Level ${targetLevel} not configured (digits per level only has ${digitsPerLevel.length} entries)`);
  }

  // Compute prefix: parentCode + child-segment
  const digitsForThisLevel = digitsPerLevel[targetLevel - 1];

  const txc = await beginTx();
  try {
    // Count existing children at this level with this prefix (locked)
    const likePattern = (parentCode || '') + '_'.repeat(digitsForThisLevel);
    const r = await txc.req()
      .input('prefix', sql.VarChar, parentCode || '')
      .input('len', sql.Int, (parentCode || '').length)
      .input('level', sql.Int, targetLevel)
      .input('seglen', sql.Int, digitsForThisLevel)
      .query(`
        SELECT MAX(RIGHT(code, @seglen)) AS max_seg
        FROM dbo.${tableName} WITH (UPDLOCK, HOLDLOCK)
        WHERE ${parentCode ? `code LIKE @prefix AND LEN(code) = @len + @seglen` : `parent_id IS NULL AND LEN(code) = @seglen`}
      `);

    let nextSerial = 1;
    if (r.recordset[0].max_seg) {
      const parsed = parseInt(r.recordset[0].max_seg, 10);
      if (!Number.isNaN(parsed)) nextSerial = parsed + 1;
    }
    const maxSerial = Math.pow(10, digitsForThisLevel) - 1;
    if (nextSerial > maxSerial) {
      throw new Error(`No more codes available at this level (max ${maxSerial} reached)`);
    }
    const segment = String(nextSerial).padStart(digitsForThisLevel, '0');
    const newCode = (parentCode || '') + segment;
    await txc.commit();
    return newCode;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
