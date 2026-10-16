/* ===========================================================================
 * Stores service — tree CRUD. Same pattern as Branches.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { nextChildCode } from '../utils/hierarchy';
import { audit, AuditContext } from '../utils/audit';

export interface StoreNode {
  id: number; code: string; parentId: number | null; level: number;
  name: string; storeType: 'GROUP' | 'STOCK'; isActive: boolean;
  taggedBranches?: number[];
  children?: StoreNode[];
}

export async function listStores(): Promise<StoreNode[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT s.id, s.code, s.parent_id, s.level_no, s.name, s.store_type, s.is_active
    FROM dbo.stores s ORDER BY s.code
  `);
  const tagsR = await pool.request().query(`SELECT store_id, branch_id FROM dbo.store_branch_tags`);
  const tagsByStore = new Map<number, number[]>();
  for (const t of tagsR.recordset) {
    if (!tagsByStore.has(t.store_id)) tagsByStore.set(t.store_id, []);
    tagsByStore.get(t.store_id)!.push(t.branch_id);
  }
  const all: StoreNode[] = r.recordset.map((row: any) => ({
    id: row.id, code: row.code, parentId: row.parent_id, level: row.level_no,
    name: row.name, storeType: row.store_type, isActive: !!row.is_active,
    taggedBranches: tagsByStore.get(row.id) || [],
  }));
  const byId = new Map<number, StoreNode>(all.map((b) => [b.id, b]));
  const roots: StoreNode[] = [];
  for (const b of all) {
    if (b.parentId && byId.has(b.parentId)) {
      const p = byId.get(b.parentId)!;
      if (!p.children) p.children = [];
      p.children.push(b);
    } else roots.push(b);
  }
  return roots;
}

export async function getStoreById(id: number): Promise<StoreNode | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT id, code, parent_id, level_no, name, store_type, is_active FROM dbo.stores WHERE id = @id`);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  return {
    id: row.id, code: row.code, parentId: row.parent_id, level: row.level_no,
    name: row.name, storeType: row.store_type, isActive: !!row.is_active,
  };
}

export async function createStore(input: {
  parentId: number | null;
  name: string;
  storeType: 'GROUP' | 'STOCK';
  taggedBranches?: number[];
}, auditCtx: AuditContext): Promise<StoreNode> {
  const txc = await beginTx();
  try {
    let parentCode: string | null = null;
    let levelNo = 1;
    if (input.parentId) {
      const pr = await txc.req()
        .input('pid', sql.Int, input.parentId)
        .query(`SELECT code, level_no FROM dbo.stores WITH (UPDLOCK, HOLDLOCK) WHERE id = @pid`);
      if (pr.recordset.length === 0) throw new Error('Parent store not found.');
      parentCode = pr.recordset[0].code;
      levelNo = pr.recordset[0].level_no + 1;
    }
    const code = await nextChildCode('STORE', parentCode, levelNo, 'stores');
    const r = await txc.req()
      .input('code', sql.VarChar, code)
      .input('pid', sql.Int, input.parentId)
      .input('lvl', sql.Int, levelNo)
      .input('name', sql.NVarChar, input.name)
      .input('st', sql.VarChar, input.storeType)
      .query(`
        INSERT INTO dbo.stores (code, parent_id, level_no, name, store_type, is_active)
        OUTPUT INSERTED.id
        VALUES (@code, @pid, @lvl, @name, @st, 1)
      `);
    const id = r.recordset[0].id;
    if (input.taggedBranches) {
      for (const bid of input.taggedBranches) {
        await txc.req()
          .input('sid', sql.Int, id)
          .input('bid', sql.Int, bid)
          .query(`INSERT INTO dbo.store_branch_tags (store_id, branch_id) VALUES (@sid, @bid)`);
      }
    }
    await audit(auditCtx, 'STORES', 'CREATE', 'Store', String(id), code, null, { code, ...input }, txc.tx);
    await txc.commit();
    return (await getStoreById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function updateStore(id: number, input: {
  name?: string;
  storeType?: 'GROUP' | 'STOCK';
  isActive?: boolean;
  taggedBranches?: number[];
}, auditCtx: AuditContext): Promise<StoreNode> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.stores WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Store not found.');
    const before = beforeR.recordset[0];
    await txc.req()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar, input.name ?? before.name)
      .input('st', sql.VarChar, input.storeType ?? before.store_type)
      .input('active', sql.Bit, input.isActive ?? (before.is_active ? 1 : 0))
      .query(`UPDATE dbo.stores SET name = @name, store_type = @st, is_active = @active, updated_at = SYSUTCDATETIME() WHERE id = @id`);
    if (input.taggedBranches !== undefined) {
      await txc.req().input('id', sql.Int, id).query(`DELETE FROM dbo.store_branch_tags WHERE store_id = @id`);
      for (const bid of input.taggedBranches) {
        await txc.req()
          .input('sid', sql.Int, id)
          .input('bid', sql.Int, bid)
          .query(`INSERT INTO dbo.store_branch_tags (store_id, branch_id) VALUES (@sid, @bid)`);
      }
    }
    await audit(auditCtx, 'STORES', 'EDIT', 'Store', String(id), before.code, before, input, txc.tx);
    await txc.commit();
    return (await getStoreById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function deleteStore(id: number, auditCtx: AuditContext): Promise<void> {
  const pool = await getPool();
  const childR = await pool.request().input('id', sql.Int, id).query(`SELECT 1 FROM dbo.stores WHERE parent_id = @id`);
  if (childR.recordset.length > 0) throw new Error('This store has child stores. Move or delete them first.');
  const txR = await pool.request().input('id', sql.Int, id).query(`SELECT 1 FROM dbo.stock_balances WHERE store_id = @id`);
  if (txR.recordset.length > 0) throw new Error('This store has stock transactions. Deactivate it instead.');
  const txc = await beginTx();
  try {
    const beforeR = await txc.req().input('id', sql.Int, id).query(`SELECT * FROM dbo.stores WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Store not found.');
    const before = beforeR.recordset[0];
    await txc.req().input('id', sql.Int, id).query(`DELETE FROM dbo.stores WHERE id = @id`);
    await audit(auditCtx, 'STORES', 'DELETE', 'Store', String(id), before.code, before, null, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
