/* ===========================================================================
 * Chart of Accounts service — tree CRUD with hierarchy codes.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { nextChildCode } from '../utils/hierarchy';
import { audit, AuditContext } from '../utils/audit';

export interface AccountNode {
  id: number; code: string; parentId: number | null; level: number;
  name: string; nature: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isGroup: boolean; isCash: boolean; isBank: boolean;
  partyType: 'NONE' | 'CUSTOMER' | 'SUPPLIER';
  contactPerson?: string | null; partyAddress?: string | null;
  partyPhone?: string | null; partyEmail?: string | null;
  partyNtnCnic?: string | null; creditDays?: number | null; creditLimit?: number | null;
  bankName?: string | null; bankAccountNo?: string | null; bankBranch?: string | null;
  isActive: boolean;
  children?: AccountNode[];
}

const NAT = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'] as const;
const PT  = ['NONE','CUSTOMER','SUPPLIER'] as const;
export type Nature = typeof NAT[number];
export type PartyType = typeof PT[number];

export async function listAccounts(): Promise<AccountNode[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT id, code, parent_id, level_no, name, nature, is_group, is_cash, is_bank, party_type,
           contact_person, party_address, party_phone, party_email, party_ntn_cnic,
           credit_days, credit_limit, bank_name, bank_account_no, bank_branch, is_active
    FROM dbo.accounts ORDER BY code
  `);
  const all: AccountNode[] = r.recordset.map(mapRow);
  const byId = new Map<number, AccountNode>(all.map((b) => [b.id, b]));
  const roots: AccountNode[] = [];
  for (const b of all) {
    if (b.parentId && byId.has(b.parentId)) {
      const p = byId.get(b.parentId)!;
      if (!p.children) p.children = [];
      p.children.push(b);
    } else roots.push(b);
  }
  return roots;
}

function mapRow(row: any): AccountNode {
  return {
    id: row.id, code: row.code, parentId: row.parent_id, level: row.level_no,
    name: row.name, nature: row.nature, isGroup: !!row.is_group,
    isCash: !!row.is_cash, isBank: !!row.is_bank,
    partyType: row.party_type, contactPerson: row.contact_person,
    partyAddress: row.party_address, partyPhone: row.party_phone,
    partyEmail: row.party_email, partyNtnCnic: row.party_ntn_cnic,
    creditDays: row.credit_days, creditLimit: row.credit_limit,
    bankName: row.bank_name, bankAccountNo: row.bank_account_no,
    bankBranch: row.bank_branch, isActive: !!row.is_active,
  };
}

export async function getAccountById(id: number): Promise<AccountNode | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, code, parent_id, level_no, name, nature, is_group, is_cash, is_bank, party_type,
             contact_person, party_address, party_phone, party_email, party_ntn_cnic,
             credit_days, credit_limit, bank_name, bank_account_no, bank_branch, is_active
      FROM dbo.accounts WHERE id = @id
    `);
  if (r.recordset.length === 0) return null;
  return mapRow(r.recordset[0]);
}

export async function createAccount(input: {
  parentId: number | null;
  name: string;
  nature: Nature;
  isGroup: boolean;
  isCash?: boolean;
  isBank?: boolean;
  partyType?: PartyType;
  contactPerson?: string | null;
  partyAddress?: string | null;
  partyPhone?: string | null;
  partyEmail?: string | null;
  partyNtnCnic?: string | null;
  creditDays?: number | null;
  creditLimit?: number | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankBranch?: string | null;
}, auditCtx: AuditContext): Promise<AccountNode> {
  if (!input.name || input.name.trim() === '') throw new Error('Account name is required.');

  const txc = await beginTx();
  try {
    let parentCode: string | null = null;
    let levelNo = 1;
    let parentNature = input.nature;

    if (input.parentId) {
      const pr = await txc.req()
        .input('pid', sql.Int, input.parentId)
        .query(`SELECT code, level_no, nature, is_group FROM dbo.accounts WITH (UPDLOCK, HOLDLOCK) WHERE id = @pid`);
      if (pr.recordset.length === 0) throw new Error('Parent account not found.');
      parentCode = pr.recordset[0].code;
      levelNo = pr.recordset[0].level_no + 1;
      parentNature = pr.recordset[0].nature;
      // Inherit nature from parent
      input.nature = parentNature;
    }

    // Inside this transaction: the UPDLOCK range below must not deadlock
    // against our own uncommitted parent-row lock on a second connection
    const code = await nextChildCode('COA', parentCode, levelNo, 'accounts', txc);

    // Posting accounts cannot have children; group accounts cannot be posted to.
    if (input.isGroup && (input.isCash || input.isBank || input.partyType !== 'NONE')) {
      throw new Error('A group account cannot be a cash, bank, or party account.');
    }

    const r = await txc.req()
      .input('code', sql.VarChar, code)
      .input('pid', sql.Int, input.parentId)
      .input('lvl', sql.Int, levelNo)
      .input('name', sql.NVarChar, input.name)
      .input('nature', sql.VarChar, input.nature)
      .input('grp', sql.Bit, input.isGroup ? 1 : 0)
      .input('cash', sql.Bit, input.isCash ? 1 : 0)
      .input('bank', sql.Bit, input.isBank ? 1 : 0)
      .input('pt', sql.VarChar, input.partyType ?? 'NONE')
      .input('cp', sql.NVarChar, input.contactPerson ?? null)
      .input('addr', sql.NVarChar, input.partyAddress ?? null)
      .input('pph', sql.NVarChar, input.partyPhone ?? null)
      .input('pe', sql.NVarChar, input.partyEmail ?? null)
      .input('ntn', sql.NVarChar, input.partyNtnCnic ?? null)
      .input('cd', sql.Int, input.creditDays ?? null)
      .input('cl', sql.Decimal(18,2), input.creditLimit ?? null)
      .input('bn', sql.NVarChar, input.bankName ?? null)
      .input('bano', sql.NVarChar, input.bankAccountNo ?? null)
      .input('bbr', sql.NVarChar, input.bankBranch ?? null)
      .query(`
        INSERT INTO dbo.accounts
          (code, parent_id, level_no, name, nature, is_group, is_cash, is_bank, party_type,
           contact_person, party_address, party_phone, party_email, party_ntn_cnic,
           credit_days, credit_limit, bank_name, bank_account_no, bank_branch, is_active)
        OUTPUT INSERTED.id
        VALUES (@code, @pid, @lvl, @name, @nature, @grp, @cash, @bank, @pt,
                @cp, @addr, @pph, @pe, @ntn, @cd, @cl, @bn, @bano, @bbr, 1)
      `);
    const id = r.recordset[0].id;
    await audit(auditCtx, 'COA', 'CREATE', 'Account', String(id), code, null, { code, ...input }, txc.tx);
    await txc.commit();
    return (await getAccountById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function updateAccount(id: number, input: {
  name?: string;
  isCash?: boolean;
  isBank?: boolean;
  partyType?: PartyType;
  contactPerson?: string | null;
  partyAddress?: string | null;
  partyPhone?: string | null;
  partyEmail?: string | null;
  partyNtnCnic?: string | null;
  creditDays?: number | null;
  creditLimit?: number | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankBranch?: string | null;
  isActive?: boolean;
}, auditCtx: AuditContext): Promise<AccountNode> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.accounts WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Account not found.');
    const before = beforeR.recordset[0];

    // Nature and is_group cannot change once postings exist
    if ((input.partyType !== undefined && input.partyType !== before.party_type)) {
      const txR = await txc.req()
        .input('id', sql.Int, id)
        .query(`SELECT 1 FROM dbo.gl_entries WHERE account_id = @id`);
      if (txR.recordset.length > 0) {
        throw new Error('Account has transactions; its party type cannot be changed.');
      }
    }

    await txc.req()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar, input.name ?? before.name)
      .input('cash', sql.Bit, input.isCash ?? (before.is_cash ? 1 : 0))
      .input('bank', sql.Bit, input.isBank ?? (before.is_bank ? 1 : 0))
      .input('pt', sql.VarChar, input.partyType ?? before.party_type)
      .input('cp', sql.NVarChar, input.contactPerson ?? before.contact_person)
      .input('addr', sql.NVarChar, input.partyAddress ?? before.party_address)
      .input('pph', sql.NVarChar, input.partyPhone ?? before.party_phone)
      .input('pe', sql.NVarChar, input.partyEmail ?? before.party_email)
      .input('ntn', sql.NVarChar, input.partyNtnCnic ?? before.party_ntn_cnic)
      .input('cd', sql.Int, input.creditDays ?? before.credit_days)
      .input('cl', sql.Decimal(18,2), input.creditLimit ?? before.credit_limit)
      .input('bn', sql.NVarChar, input.bankName ?? before.bank_name)
      .input('bano', sql.NVarChar, input.bankAccountNo ?? before.bank_account_no)
      .input('bbr', sql.NVarChar, input.bankBranch ?? before.bank_branch)
      .input('active', sql.Bit, input.isActive ?? (before.is_active ? 1 : 0))
      .query(`
        UPDATE dbo.accounts SET
          name = @name, is_cash = @cash, is_bank = @bank, party_type = @pt,
          contact_person = @cp, party_address = @addr, party_phone = @pph, party_email = @pe,
          party_ntn_cnic = @ntn, credit_days = @cd, credit_limit = @cl,
          bank_name = @bn, bank_account_no = @bano, bank_branch = @bbr, is_active = @active,
          updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await audit(auditCtx, 'COA', 'EDIT', 'Account', String(id), before.code, before, input, txc.tx);
    await txc.commit();
    return (await getAccountById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function canDeleteAccount(id: number): Promise<{ ok: boolean; reason?: string }> {
  const pool = await getPool();
  const childR = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT 1 FROM dbo.accounts WHERE parent_id = @id`);
  if (childR.recordset.length > 0) {
    return { ok: false, reason: 'This account has child accounts. Move or delete them first.' };
  }
  const txR = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT 1 FROM dbo.gl_entries WHERE account_id = @id`);
  if (txR.recordset.length > 0) {
    return { ok: false, reason: 'This account has ledger entries and cannot be deleted. Deactivate it instead.' };
  }
  const mapR = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT 1 FROM dbo.settings
      WHERE default_cash_account_id = @id OR default_bank_account_id = @id
         OR sales_account_id = @id OR sales_returns_account_id = @id
         OR output_sales_tax_account_id = @id OR input_sales_tax_account_id = @id
         OR inventory_account_id = @id OR cogs_account_id = @id
         OR grn_clearing_account_id = @id OR purchase_price_variance_account_id = @id
         OR stock_adjustment_account_id = @id
    `);
  if (mapR.recordset.length > 0) {
    return { ok: false, reason: 'This account is mapped in settings and cannot be deleted. Clear the mapping first.' };
  }
  return { ok: true };
}

export async function deleteAccount(id: number, auditCtx: AuditContext): Promise<void> {
  const check = await canDeleteAccount(id);
  if (!check.ok) throw new Error(check.reason);
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.accounts WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Account not found.');
    const before = beforeR.recordset[0];
    await txc.req()
      .input('id', sql.Int, id)
      .query(`DELETE FROM dbo.accounts WHERE id = @id`);
    await audit(auditCtx, 'COA', 'DELETE', 'Account', String(id), before.code, before, null, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
