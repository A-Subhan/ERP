/* ===========================================================================
 * Chart of Accounts service — code is the primary key (no surrogate id).
 * Tree CRUD. Account details handled by accountDetails.service.ts.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { nextChildCode } from '../utils/hierarchy';
import { audit, AuditContext } from '../utils/audit';

export type Nature = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type PartyType = 'NONE' | 'CUSTOMER' | 'SUPPLIER';
const NAT = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'] as const;
const PT  = ['NONE','CUSTOMER','SUPPLIER'] as const;

export interface AccountNode {
  code: string; parentCode: string | null; level: number;
  name: string; nature: Nature;
  isGroup: boolean; isCash: boolean; isBank: boolean;
  partyType: PartyType;
  isActive: boolean;
  children?: AccountNode[];
}

export async function listAccounts(): Promise<AccountNode[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT code, parent_code, level_no, name, nature, is_group, is_cash, is_bank, party_type, is_active
    FROM dbo.accounts ORDER BY code
  `);
  const all: AccountNode[] = r.recordset.map((row: any) => ({
    code: row.code, parentCode: row.parent_code, level: row.level_no,
    name: row.name, nature: row.nature, isGroup: !!row.is_group,
    isCash: !!row.is_cash, isBank: !!row.is_bank, partyType: row.party_type,
    isActive: !!row.is_active,
  }));
  const byCode = new Map<string, AccountNode>(all.map((b) => [b.code, b]));
  const roots: AccountNode[] = [];
  for (const b of all) {
    if (b.parentCode && byCode.has(b.parentCode)) {
      const p = byCode.get(b.parentCode)!;
      if (!p.children) p.children = [];
      p.children.push(b);
    } else roots.push(b);
  }
  return roots;
}

export async function getAccountByCode(code: string): Promise<AccountNode | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('code', sql.VarChar, code)
    .query(`
      SELECT code, parent_code, level_no, name, nature, is_group, is_cash, is_bank, party_type, is_active
      FROM dbo.accounts WHERE code = @code
    `);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  return {
    code: row.code, parentCode: row.parent_code, level: row.level_no,
    name: row.name, nature: row.nature, isGroup: !!row.is_group,
    isCash: !!row.is_cash, isBank: !!row.is_bank, partyType: row.party_type,
    isActive: !!row.is_active,
  };
}

export async function createAccount(input: {
  parentCode: string | null;
  name: string;
  nature: Nature;
  isGroup: boolean;
  isCash?: boolean;
  isBank?: boolean;
  partyType?: PartyType;
}, auditCtx: AuditContext): Promise<AccountNode> {
  if (!input.name || input.name.trim() === '') throw new Error('Account name is required.');

  const txc = await beginTx();
  try {
    let parentCode: string | null = null;
    let levelNo = 1;
    let parentNature = input.nature;

    if (input.parentCode) {
      const pr = await txc.req()
        .input('pc', sql.VarChar, input.parentCode)
        .query(`SELECT code, level_no, nature, is_group FROM dbo.accounts WITH (UPDLOCK, HOLDLOCK) WHERE code = @pc`);
      if (pr.recordset.length === 0) throw new Error('Parent account not found.');
      parentCode = pr.recordset[0].code;
      levelNo = pr.recordset[0].level_no + 1;
      parentNature = pr.recordset[0].nature;
      input.nature = parentNature;
    }

    // Inside this transaction: the UPDLOCK range below must not deadlock
    // against our own uncommitted parent-row lock on a second connection
    const code = await nextChildCode('COA', parentCode, levelNo, 'accounts', txc);

    if (input.isGroup && (input.isCash || input.isBank || input.partyType !== 'NONE')) {
      throw new Error('A group account cannot be a cash, bank, or party account.');
    }

    await txc.req()
      .input('code', sql.VarChar, code)
      .input('pc', sql.VarChar, parentCode)
      .input('lvl', sql.Int, levelNo)
      .input('name', sql.NVarChar, input.name)
      .input('nature', sql.VarChar, input.nature)
      .input('grp', sql.Bit, input.isGroup ? 1 : 0)
      .input('cash', sql.Bit, input.isCash ? 1 : 0)
      .input('bank', sql.Bit, input.isBank ? 1 : 0)
      .input('pt', sql.VarChar, input.partyType ?? 'NONE')
      .query(`
        INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_cash, is_bank, party_type, is_active)
        VALUES (@code, @pc, @lvl, @name, @nature, @grp, @cash, @bank, @pt, 1)
      `);

    // Create empty details row
    await txc.req()
      .input('code', sql.VarChar, code)
      .query(`INSERT INTO dbo.account_details (account_code) VALUES (@code)`);

    await audit(auditCtx, 'COA', 'CREATE', 'Account', code, code, null, { code, ...input }, txc.tx);
    await txc.commit();
    return (await getAccountByCode(code))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function updateAccount(code: string, input: {
  name?: string;
  isCash?: boolean;
  isBank?: boolean;
  partyType?: PartyType;
  isActive?: boolean;
}, auditCtx: AuditContext): Promise<AccountNode> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('code', sql.VarChar, code)
      .query(`SELECT * FROM dbo.accounts WITH (UPDLOCK, HOLDLOCK) WHERE code = @code`);
    if (beforeR.recordset.length === 0) throw new Error('Account not found.');
    const before = beforeR.recordset[0];

    // parent_code and nature and is_group cannot change after creation
    await txc.req()
      .input('code', sql.VarChar, code)
      .input('name', sql.NVarChar, input.name ?? before.name)
      .input('cash', sql.Bit, input.isCash ?? (before.is_cash ? 1 : 0))
      .input('bank', sql.Bit, input.isBank ?? (before.is_bank ? 1 : 0))
      .input('pt', sql.VarChar, input.partyType ?? before.party_type)
      .input('active', sql.Bit, input.isActive ?? (before.is_active ? 1 : 0))
      .query(`
        UPDATE dbo.accounts SET
          name = @name, is_cash = @cash, is_bank = @bank, party_type = @pt, is_active = @active,
          updated_at = SYSUTCDATETIME()
        WHERE code = @code
      `);

    await audit(auditCtx, 'COA', 'EDIT', 'Account', code, code, before, input, txc.tx);
    await txc.commit();
    return (await getAccountByCode(code))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function canDeleteAccount(code: string): Promise<{ ok: boolean; reason?: string }> {
  const pool = await getPool();
  const childR = await pool.request()
    .input('code', sql.VarChar, code)
    .query(`SELECT 1 FROM dbo.accounts WHERE parent_code = @code`);
  if (childR.recordset.length > 0) return { ok: false, reason: 'This account has child accounts. Move or delete them first.' };
  const txR = await pool.request()
    .input('code', sql.VarChar, code)
    .query(`SELECT 1 FROM dbo.gl_entries WHERE account_code = @code`);
  if (txR.recordset.length > 0) return { ok: false, reason: 'This account has ledger entries and cannot be deleted. Deactivate it instead.' };
  const mapR = await pool.request()
    .input('code', sql.VarChar, code)
    .query(`
      SELECT 1 FROM dbo.settings
      WHERE default_cash_account_code = @code OR default_bank_account_code = @code
         OR sales_account_code = @code OR sales_returns_account_code = @code
         OR output_sales_tax_account_code = @code OR input_sales_tax_account_code = @code
         OR inventory_account_code = @code OR cogs_account_code = @code
         OR grn_clearing_account_code = @code OR purchase_price_variance_account_code = @code
         OR stock_adjustment_account_code = @code
    `);
  if (mapR.recordset.length > 0) return { ok: false, reason: 'This account is mapped in settings and cannot be deleted. Clear the mapping first.' };
  return { ok: true };
}

export async function deleteAccount(code: string, auditCtx: AuditContext): Promise<void> {
  const check = await canDeleteAccount(code);
  if (!check.ok) throw new Error(check.reason);
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('code', sql.VarChar, code)
      .query(`SELECT * FROM dbo.accounts WITH (UPDLOCK, HOLDLOCK) WHERE code = @code`);
    if (beforeR.recordset.length === 0) throw new Error('Account not found.');
    const before = beforeR.recordset[0];
    await txc.req()
      .input('code', sql.VarChar, code)
      .query(`DELETE FROM dbo.accounts WHERE code = @code`);
    await audit(auditCtx, 'COA', 'DELETE', 'Account', code, code, before, null, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export const _accountNatures = NAT;
export const _accountPartyTypes = PT;
