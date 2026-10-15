/* ===========================================================================
 * Tax Heads service — flat list with display IDs from the counter.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { allocateIds, formatDisplayId } from '../utils/counter';
import { audit, AuditContext } from '../utils/audit';

export interface TaxHead {
  id: number; displayId: string; name: string; accountCode: string;
  percentage: number; isActive: boolean;
}

export async function listTaxHeads(): Promise<TaxHead[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT id, display_id, name, account_code, percentage, is_active
    FROM dbo.tax_heads ORDER BY display_id
  `);
  return r.recordset.map((row: any) => ({
    id: row.id, displayId: row.display_id, name: row.name,
    accountCode: row.account_code, percentage: row.percentage, isActive: !!row.is_active,
  }));
}

export async function getTaxHeadById(id: number): Promise<TaxHead | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT id, display_id, name, account_code, percentage, is_active FROM dbo.tax_heads WHERE id = @id`);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  return { id: row.id, displayId: row.display_id, name: row.name, accountCode: row.account_code, percentage: row.percentage, isActive: !!row.is_active };
}

export async function createTaxHead(input: {
  name: string;
  accountCode: string;
  percentage: number;
}, auditCtx: AuditContext): Promise<TaxHead> {
  if (!input.name || input.name.trim() === '') throw new Error('Tax head name is required.');
  if (input.percentage < 0 || input.percentage > 100) throw new Error('Percentage must be between 0 and 100.');
  // Validate linked account is a posting account of nature Liability or Asset
  const pool = await getPool();
  const acctR = await pool.request()
    .input('code', sql.VarChar, input.accountCode)
    .query(`SELECT nature, is_group FROM dbo.accounts WHERE code = @code`);
  if (acctR.recordset.length === 0) throw new Error('Linked account not found.');
  const acct = acctR.recordset[0];
  if (acct.is_group) throw new Error('Linked account must be a posting account, not a group.');
  if (acct.nature !== 'LIABILITY' && acct.nature !== 'ASSET') {
    throw new Error('Linked account must be of nature Liability or Asset.');
  }

  const txc = await beginTx();
  try {
    const [id] = await allocateIds('TAX_HEADS', 1);
    const r = await txc.req()
      .input('did', sql.VarChar, formatDisplayId(id))
      .input('name', sql.NVarChar, input.name)
      .input('ac', sql.VarChar, input.accountCode)
      .input('pct', sql.Decimal(7,4), input.percentage)
      .query(`
        INSERT INTO dbo.tax_heads (display_id, name, account_code, percentage, is_active)
        OUTPUT INSERTED.id
        VALUES (@did, @name, @ac, @pct, 1)
      `);
    const newId = r.recordset[0].id;
    await audit(auditCtx, 'TAX_HEADS', 'CREATE', 'TaxHead', String(newId), formatDisplayId(id), null, input, txc.tx);
    await txc.commit();
    return (await getTaxHeadById(newId))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function updateTaxHead(id: number, input: {
  name?: string;
  accountCode?: string;
  percentage?: number;
  isActive?: boolean;
}, auditCtx: AuditContext): Promise<TaxHead> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req().input('id', sql.Int, id).query(`SELECT * FROM dbo.tax_heads WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Tax head not found.');
    const before = beforeR.recordset[0];
    await txc.req()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar, input.name ?? before.name)
      .input('ac', sql.VarChar, input.accountCode ?? before.account_code)
      .input('pct', sql.Decimal(7,4), input.percentage ?? before.percentage)
      .input('active', sql.Bit, input.isActive ?? (before.is_active ? 1 : 0))
      .query(`UPDATE dbo.tax_heads SET name = @name, account_code = @ac, percentage = @pct, is_active = @active, updated_at = SYSUTCDATETIME() WHERE id = @id`);
    await audit(auditCtx, 'TAX_HEADS', 'EDIT', 'TaxHead', String(id), before.display_id, before, input, txc.tx);
    await txc.commit();
    return (await getTaxHeadById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function deleteTaxHead(id: number, auditCtx: AuditContext): Promise<void> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req().input('id', sql.Int, id).query(`SELECT * FROM dbo.tax_heads WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Tax head not found.');
    const before = beforeR.recordset[0];
    await txc.req().input('id', sql.Int, id).query(`DELETE FROM dbo.tax_heads WHERE id = @id`);
    await audit(auditCtx, 'TAX_HEADS', 'DELETE', 'TaxHead', String(id), before.display_id, before, null, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
