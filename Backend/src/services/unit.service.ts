/* ===========================================================================
 * Units service — flat list with display IDs from the counter.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { allocateIds, formatDisplayId } from '../utils/counter';
import { audit, AuditContext } from '../utils/audit';

export interface Unit { id: number; displayId: string; code: string; name: string; isActive: boolean; }

export async function listUnits(): Promise<Unit[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT id, display_id, code, name, is_active
    FROM dbo.units ORDER BY display_id
  `);
  return r.recordset.map((row: any) => ({
    id: row.id, displayId: row.display_id, code: row.code, name: row.name, isActive: !!row.is_active,
  }));
}

export async function createUnit(input: { code: string; name: string }, auditCtx: AuditContext): Promise<Unit> {
  if (!input.code || !/^[A-Za-z0-9_-]+$/.test(input.code)) {
    throw new Error('Unit code is required and may only contain letters, numbers, underscore and hyphen.');
  }
  if (!input.name || input.name.trim() === '') throw new Error('Unit name is required.');

  const txc = await beginTx();
  try {
    const [id] = await allocateIds('UNITS', 1);
    const r = await txc.req()
      .input('did', sql.VarChar, formatDisplayId(id))
      .input('code', sql.VarChar, input.code)
      .input('name', sql.NVarChar, input.name)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.units WHERE code = @code)
        BEGIN
          INSERT INTO dbo.units (display_id, code, name, is_active)
          OUTPUT INSERTED.id
          VALUES (@did, @code, @name, 1)
        END
      `);
    if (r.recordset.length === 0) throw new Error('Unit code already exists.');
    const newId = r.recordset[0].id;
    await audit(auditCtx, 'UNITS', 'CREATE', 'Unit', String(newId), input.code, null, input, txc.tx);
    await txc.commit();
    return (await getUnitById(newId))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function getUnitById(id: number): Promise<Unit | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT id, display_id, code, name, is_active FROM dbo.units WHERE id = @id`);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  return { id: row.id, displayId: row.display_id, code: row.code, name: row.name, isActive: !!row.is_active };
}

export async function updateUnit(id: number, input: { code?: string; name?: string; isActive?: boolean }, auditCtx: AuditContext): Promise<Unit> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.units WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Unit not found.');
    const before = beforeR.recordset[0];

    if (input.code && input.code !== before.code) {
      if (!/^[A-Za-z0-9_-]+$/.test(input.code)) throw new Error('Unit code may only contain letters, numbers, underscore and hyphen.');
      const dup = await txc.req()
        .input('code', sql.VarChar, input.code)
        .input('id', sql.Int, id)
        .query(`SELECT 1 FROM dbo.units WHERE code = @code AND id <> @id`);
      if (dup.recordset.length > 0) throw new Error('Unit code already exists.');
    }

    await txc.req()
      .input('id', sql.Int, id)
      .input('code', sql.VarChar, input.code ?? before.code)
      .input('name', sql.NVarChar, input.name ?? before.name)
      .input('active', sql.Bit, input.isActive ?? (before.is_active ? 1 : 0))
      .query(`UPDATE dbo.units SET code = @code, name = @name, is_active = @active WHERE id = @id`);

    await audit(auditCtx, 'UNITS', 'EDIT', 'Unit', String(id), before.code, before, input, txc.tx);
    await txc.commit();
    return (await getUnitById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function deleteUnit(id: number, auditCtx: AuditContext): Promise<void> {
  const pool = await getPool();
  const inUse = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT 1 FROM dbo.products WHERE unit_id = @id AND is_group = 0`);
  if (inUse.recordset.length > 0) {
    throw new Error('This unit is used by products and cannot be deleted. Deactivate it instead.');
  }
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.units WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('Unit not found.');
    const before = beforeR.recordset[0];
    await txc.req()
      .input('id', sql.Int, id)
      .query(`DELETE FROM dbo.units WHERE id = @id`);
    await audit(auditCtx, 'UNITS', 'DELETE', 'Unit', String(id), before.code, before, null, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
