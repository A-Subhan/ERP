/* ===========================================================================
 * Branches service — tree CRUD with hierarchy code generation.
 * ==========================================================================*/
import { getPool, sql } from '../db/pool';
import { nextChildCode } from '../utils/hierarchy';
import { beginTx } from '../db/pool';
import { audit, AuditContext } from '../utils/audit';

export interface BranchNode {
  id: number;
  code: string;
  parentId: number | null;
  level: number;
  name: string;
  shortName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  children?: BranchNode[];
}

export async function listBranches(): Promise<BranchNode[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT id, code, parent_id, level_no, name, short_name, address, phone, email, is_active
    FROM dbo.branches
    ORDER BY code
  `);
  const all: BranchNode[] = r.recordset.map((row: any) => ({
    id: row.id, code: row.code, parentId: row.parent_id, level: row.level_no,
    name: row.name, shortName: row.short_name, address: row.address,
    phone: row.phone, email: row.email, isActive: !!row.is_active,
  }));
  // Build tree
  const byId = new Map<number, BranchNode>(all.map((b) => [b.id, b]));
  const roots: BranchNode[] = [];
  for (const b of all) {
    if (b.parentId && byId.has(b.parentId)) {
      const p = byId.get(b.parentId)!;
      if (!p.children) p.children = [];
      p.children.push(b);
    } else {
      roots.push(b);
    }
  }
  return roots;
}

export async function createBranch(input: {
  parentId: number | null;
  name: string;
  shortName: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}, auditCtx: AuditContext): Promise<BranchNode> {
  if (!input.shortName || !/^[A-Za-z0-9_-]+$/.test(input.shortName)) {
    throw new Error('Branch short name is required and may only contain letters, numbers, underscore and hyphen.');
  }

  const txc = await beginTx();
  try {
    let parentCode: string | null = null;
    let levelNo = 1;
    if (input.parentId) {
      const pr = await txc.req()
        .input('pid', sql.Int, input.parentId)
        .query(`SELECT code, level_no FROM dbo.branches WITH (UPDLOCK, HOLDLOCK) WHERE id = @pid`);
      if (pr.recordset.length === 0) throw new Error('Parent branch not found.');
      parentCode = pr.recordset[0].code;
      levelNo = pr.recordset[0].level_no + 1;
    }

    // Inside this transaction: the UPDLOCK range below must not deadlock
    // against our own uncommitted parent-row lock on a second connection
    const code = await nextChildCode('BRANCH', parentCode, levelNo, 'branches', txc);
    const dup = await txc.req()
      .input('sn', sql.VarChar, input.shortName)
      .query(`SELECT 1 FROM dbo.branches WHERE short_name = @sn`);
    if (dup.recordset.length > 0) throw new Error('Branch short name already exists.');

    const r = await txc.req()
      .input('code', sql.VarChar, code)
      .input('pid', sql.Int, input.parentId)
      .input('lvl', sql.Int, levelNo)
      .input('name', sql.NVarChar, input.name)
      .input('sn', sql.VarChar, input.shortName)
      .input('addr', sql.NVarChar, input.address || null)
      .input('phone', sql.NVarChar, input.phone || null)
      .input('email', sql.NVarChar, input.email || null)
      .query(`
        INSERT INTO dbo.branches (code, parent_id, level_no, name, short_name, address, phone, email, is_active)
        OUTPUT INSERTED.id
        VALUES (@code, @pid, @lvl, @name, @sn, @addr, @phone, @email, 1)
      `);
    const id = r.recordset[0].id;

    await audit(auditCtx, 'BRANCHES', 'CREATE', 'Branch', String(id), code, null,
      { code, name: input.name, shortName: input.shortName }, txc.tx);
    await txc.commit();
    return (await getBranchById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function getBranchById(id: number): Promise<BranchNode | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, code, parent_id, level_no, name, short_name, address, phone, email, is_active
      FROM dbo.branches WHERE id = @id
    `);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  return {
    id: row.id, code: row.code, parentId: row.parent_id, level: row.level_no,
    name: row.name, shortName: row.short_name, address: row.address,
    phone: row.phone, email: row.email, isActive: !!row.is_active,
  };
}

export async function updateBranch(id: number, input: {
  name?: string;
  shortName?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive?: boolean;
}, auditCtx: AuditContext): Promise<BranchNode> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.branches WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Branch not found.');
    const before = beforeR.recordset[0];

    if (input.shortName && input.shortName !== before.short_name) {
      const dup = await txc.req()
        .input('sn', sql.VarChar, input.shortName)
        .input('id', sql.Int, id)
        .query(`SELECT 1 FROM dbo.branches WHERE short_name = @sn AND id <> @id`);
      if (dup.recordset.length > 0) throw new Error('Branch short name already exists.');
      if (!/^[A-Za-z0-9_-]+$/.test(input.shortName)) {
        throw new Error('Branch short name may only contain letters, numbers, underscore and hyphen.');
      }
    }

    await txc.req()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar, input.name ?? before.name)
      .input('sn', sql.VarChar, input.shortName ?? before.short_name)
      .input('addr', sql.NVarChar, input.address ?? before.address)
      .input('phone', sql.NVarChar, input.phone ?? before.phone)
      .input('email', sql.NVarChar, input.email ?? before.email)
      .input('active', sql.Bit, input.isActive ?? (before.is_active ? 1 : 0))
      .query(`
        UPDATE dbo.branches
        SET name = @name, short_name = @sn, address = @addr, phone = @phone, email = @email, is_active = @active,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await audit(auditCtx, 'BRANCHES', 'EDIT', 'Branch', String(id), before.code, before, input, txc.tx);
    await txc.commit();
    return (await getBranchById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function canDeleteBranch(id: number): Promise<{ ok: boolean; reason?: string }> {
  // A branch cannot be deleted if it has children, is referenced in settings as default,
  // or has any transactional data (vouchers, invoices, etc.)
  const pool = await getPool();
  const childR = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT 1 FROM dbo.branches WHERE parent_id = @id`);
  if (childR.recordset.length > 0) {
    return { ok: false, reason: 'This branch has child branches. Move or delete them first.' };
  }
  const txR = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT TOP 1 1 FROM dbo.vouchers WHERE branch_id = @id
      UNION SELECT 1 FROM dbo.sales_orders WHERE branch_id = @id
      UNION SELECT 1 FROM dbo.purchase_orders WHERE branch_id = @id
      UNION SELECT 1 FROM dbo.gl_entries WHERE branch_id = @id
    `);
  if (txR.recordset.length > 0) {
    return { ok: false, reason: 'This branch has transactions and cannot be deleted. Deactivate it instead.' };
  }
  return { ok: true };
}

export async function deleteBranch(id: number, auditCtx: AuditContext): Promise<void> {
  // Safety: never delete the only branch
  const pool = await getPool();
  const cntR = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.branches`);
  if (cntR.recordset[0].n <= 1) throw new Error('Cannot delete the only branch.');

  const check = await canDeleteBranch(id);
  if (!check.ok) throw new Error(check.reason);

  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.branches WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Branch not found.');
    const before = beforeR.recordset[0];

    await txc.req()
      .input('id', sql.Int, id)
      .query(`DELETE FROM dbo.branches WHERE id = @id`);

    await audit(auditCtx, 'BRANCHES', 'DELETE', 'Branch', String(id), before.code, before, null, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
