/* ===========================================================================
 * Products service — tree CRUD. Same pattern as Branches/Stores.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { nextChildCode } from '../utils/hierarchy';
import { audit, AuditContext } from '../utils/audit';

export interface ProductNode {
  id: number; code: string; parentId: number | null; level: number;
  name: string; unitId: number | null; salesTaxPct: number;
  reorderLevel: number; purchasePrice: number; salesPrice: number;
  isGroup: boolean; isActive: boolean;
  children?: ProductNode[];
}

export async function listProducts(): Promise<ProductNode[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT id, code, parent_id, level_no, name, unit_id, sales_tax_pct,
           reorder_level, purchase_price, sales_price, is_group, is_active
    FROM dbo.products ORDER BY code
  `);
  const all: ProductNode[] = r.recordset.map((row: any) => ({
    id: row.id, code: row.code, parentId: row.parent_id, level: row.level_no,
    name: row.name, unitId: row.unit_id, salesTaxPct: row.sales_tax_pct,
    reorderLevel: row.reorder_level, purchasePrice: row.purchase_price,
    salesPrice: row.sales_price, isGroup: !!row.is_group, isActive: !!row.is_active,
  }));
  const byId = new Map<number, ProductNode>(all.map((b) => [b.id, b]));
  const roots: ProductNode[] = [];
  for (const b of all) {
    if (b.parentId && byId.has(b.parentId)) {
      const p = byId.get(b.parentId)!;
      if (!p.children) p.children = [];
      p.children.push(b);
    } else roots.push(b);
  }
  return roots;
}

export async function getProductById(id: number): Promise<ProductNode | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, code, parent_id, level_no, name, unit_id, sales_tax_pct,
             reorder_level, purchase_price, sales_price, is_group, is_active
      FROM dbo.products WHERE id = @id
    `);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  return {
    id: row.id, code: row.code, parentId: row.parent_id, level: row.level_no,
    name: row.name, unitId: row.unit_id, salesTaxPct: row.sales_tax_pct,
    reorderLevel: row.reorder_level, purchasePrice: row.purchase_price,
    salesPrice: row.sales_price, isGroup: !!row.is_group, isActive: !!row.is_active,
  };
}

export async function createProduct(input: {
  parentId: number | null;
  name: string;
  unitId?: number | null;
  salesTaxPct?: number;
  reorderLevel?: number;
  purchasePrice?: number;
  salesPrice?: number;
  isGroup: boolean;
}, auditCtx: AuditContext): Promise<ProductNode> {
  if (!input.name || input.name.trim() === '') throw new Error('Product name is required.');
  if (!input.isGroup && !input.unitId) throw new Error('A unit is required for product items (non-group).');

  const txc = await beginTx();
  try {
    let parentCode: string | null = null;
    let levelNo = 1;
    if (input.parentId) {
      const pr = await txc.req()
        .input('pid', sql.Int, input.parentId)
        .query(`SELECT code, level_no FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id = @pid`);
      if (pr.recordset.length === 0) throw new Error('Parent product not found.');
      parentCode = pr.recordset[0].code;
      levelNo = pr.recordset[0].level_no + 1;
    }
    const code = await nextChildCode('PRODUCT', parentCode, levelNo, 'products');
    const r = await txc.req()
      .input('code', sql.VarChar, code)
      .input('pid', sql.Int, input.parentId)
      .input('lvl', sql.Int, levelNo)
      .input('name', sql.NVarChar, input.name)
      .input('uid', sql.Int, input.unitId ?? null)
      .input('stp', sql.Decimal(7,4), input.salesTaxPct ?? 0)
      .input('rl', sql.Decimal(18,4), input.reorderLevel ?? 0)
      .input('pp', sql.Decimal(18,4), input.purchasePrice ?? 0)
      .input('sp', sql.Decimal(18,4), input.salesPrice ?? 0)
      .input('grp', sql.Bit, input.isGroup ? 1 : 0)
      .query(`
        INSERT INTO dbo.products (code, parent_id, level_no, name, unit_id, sales_tax_pct, reorder_level, purchase_price, sales_price, is_group, is_active)
        OUTPUT INSERTED.id
        VALUES (@code, @pid, @lvl, @name, @uid, @stp, @rl, @pp, @sp, @grp, 1)
      `);
    const id = r.recordset[0].id;
    await audit(auditCtx, 'PRODUCTS', 'CREATE', 'Product', String(id), code, null, { code, ...input }, txc.tx);
    await txc.commit();
    return (await getProductById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function updateProduct(id: number, input: {
  name?: string;
  unitId?: number | null;
  salesTaxPct?: number;
  reorderLevel?: number;
  purchasePrice?: number;
  salesPrice?: number;
  isActive?: boolean;
}, auditCtx: AuditContext): Promise<ProductNode> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req().input('id', sql.Int, id).query(`SELECT * FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Product not found.');
    const before = beforeR.recordset[0];
    await txc.req()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar, input.name ?? before.name)
      .input('uid', sql.Int, input.unitId ?? before.unit_id)
      .input('stp', sql.Decimal(7,4), input.salesTaxPct ?? before.sales_tax_pct)
      .input('rl', sql.Decimal(18,4), input.reorderLevel ?? before.reorder_level)
      .input('pp', sql.Decimal(18,4), input.purchasePrice ?? before.purchase_price)
      .input('sp', sql.Decimal(18,4), input.salesPrice ?? before.sales_price)
      .input('active', sql.Bit, input.isActive ?? (before.is_active ? 1 : 0))
      .query(`UPDATE dbo.products SET name = @name, unit_id = @uid, sales_tax_pct = @stp, reorder_level = @rl, purchase_price = @pp, sales_price = @sp, is_active = @active, updated_at = SYSUTCDATETIME() WHERE id = @id`);
    await audit(auditCtx, 'PRODUCTS', 'EDIT', 'Product', String(id), before.code, before, input, txc.tx);
    await txc.commit();
    return (await getProductById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function deleteProduct(id: number, auditCtx: AuditContext): Promise<void> {
  const pool = await getPool();
  const childR = await pool.request().input('id', sql.Int, id).query(`SELECT 1 FROM dbo.products WHERE parent_id = @id`);
  if (childR.recordset.length > 0) throw new Error('This product has children. Move or delete them first.');
  const txR = await pool.request().input('id', sql.Int, id).query(`SELECT 1 FROM dbo.stock_ledger WHERE product_id = @id`);
  if (txR.recordset.length > 0) throw new Error('This product has stock transactions. Deactivate it instead.');
  const txc = await beginTx();
  try {
    const beforeR = await txc.req().input('id', sql.Int, id).query(`SELECT * FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Product not found.');
    const before = beforeR.recordset[0];
    await txc.req().input('id', sql.Int, id).query(`DELETE FROM dbo.products WHERE id = @id`);
    await audit(auditCtx, 'PRODUCTS', 'DELETE', 'Product', String(id), before.code, before, null, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
