/* ===========================================================================
 * Users service — CRUD + permissions + admin protection.
 * ==========================================================================*/
import argon2 from 'argon2';
import { getPool, sql, beginTx } from '../db/pool';
import { allocateIds, formatDisplayId } from '../utils/counter';
import { audit, AuditContext } from '../utils/audit';

export interface User {
  id: number; displayId: string; username: string; fullName: string;
  isAdmin: boolean; isActive: boolean; forceChangePw: boolean;
  allowedBranchesCsv: string | null; allowedStoresCsv: string | null;
}

export interface UserWithPermissions extends User {
  permissions: { screenCode: string; view: boolean; add: boolean; edit: boolean; delete: boolean; print: boolean }[];
}

export async function listUsers(): Promise<User[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT id, display_id, username, full_name, is_admin, is_active, force_change_pw,
           allowed_branches_csv, allowed_stores_csv
    FROM dbo.users ORDER BY display_id
  `);
  return r.recordset.map((row: any) => ({
    id: row.id, displayId: row.display_id, username: row.username, fullName: row.full_name,
    isAdmin: !!row.is_admin, isActive: !!row.is_active, forceChangePw: !!row.force_change_pw,
    allowedBranchesCsv: row.allowed_branches_csv, allowedStoresCsv: row.allowed_stores_csv,
  }));
}

export async function getUserById(id: number): Promise<UserWithPermissions | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, display_id, username, full_name, is_admin, is_active, force_change_pw,
             allowed_branches_csv, allowed_stores_csv
      FROM dbo.users WHERE id = @id
    `);
  if (r.recordset.length === 0) return null;
  const row = r.recordset[0];
  const permsR = await pool.request()
    .input('uid', sql.Int, id)
    .query(`SELECT screen_code, can_view, can_add, can_edit, can_delete, can_print FROM dbo.user_permissions WHERE user_id = @uid`);
  return {
    id: row.id, displayId: row.display_id, username: row.username, fullName: row.full_name,
    isAdmin: !!row.is_admin, isActive: !!row.is_active, forceChangePw: !!row.force_change_pw,
    allowedBranchesCsv: row.allowed_branches_csv, allowedStoresCsv: row.allowed_stores_csv,
    permissions: permsR.recordset.map((p: any) => ({
      screenCode: p.screen_code, view: !!p.can_view, add: !!p.can_add,
      edit: !!p.can_edit, delete: !!p.can_delete, print: !!p.can_print,
    })),
  };
}

export async function createUser(input: {
  username: string;
  fullName: string;
  password: string;
  isAdmin?: boolean;
  allowedBranchesCsv?: string | null;
  allowedStoresCsv?: string | null;
}, auditCtx: AuditContext): Promise<User> {
  if (!input.username || input.username.trim() === '') throw new Error('Username is required.');
  if (input.username.length > 100) throw new Error('Username is too long.');
  if (!input.password || input.password.length < 8) throw new Error('Password must be at least 8 characters.');

  const txc = await beginTx();
  try {
    const dup = await txc.req()
      .input('u', sql.NVarChar, input.username)
      .query(`SELECT 1 FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE username = @u`);
    if (dup.recordset.length > 0) throw new Error('Username already exists.');

    const [id] = await allocateIds('USERS', 1);
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    const r = await txc.req()
      .input('did', sql.VarChar, formatDisplayId(id))
      .input('u', sql.NVarChar, input.username)
      .input('fn', sql.NVarChar, input.fullName)
      .input('ph', sql.NVarChar, hash)
      .input('adm', sql.Bit, input.isAdmin ? 1 : 0)
      .input('br', sql.VarChar, input.allowedBranchesCsv ?? null)
      .input('st', sql.VarChar, input.allowedStoresCsv ?? null)
      .query(`
        INSERT INTO dbo.users (display_id, username, full_name, password_hash, is_active, is_admin, force_change_pw, allowed_branches_csv, allowed_stores_csv)
        OUTPUT INSERTED.id
        VALUES (@did, @u, @fn, @ph, 1, @adm, 1, @br, @st)
      `);
    const newId = r.recordset[0].id;
    await audit(auditCtx, 'USERS', 'CREATE', 'User', String(newId), formatDisplayId(id), null, input, txc.tx);
    await txc.commit();
    return (await getUserById(newId))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function updateUser(id: number, input: {
  fullName?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  allowedBranchesCsv?: string | null;
  allowedStoresCsv?: string | null;
  resetPassword?: string | null;
  permissions?: { screenCode: string; view: boolean; add: boolean; edit: boolean; delete: boolean; print: boolean }[];
}, auditCtx: AuditContext): Promise<User> {
  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('User not found.');
    const before = beforeR.recordset[0];

    // Prevent the last admin from being demoted or deactivated
    if ((input.isAdmin === false || input.isActive === false) && before.is_admin) {
      const adminR = await txc.req().query(`SELECT COUNT(*) AS n FROM dbo.users WHERE is_active = 1 AND is_admin = 1`);
      if (adminR.recordset[0].n <= 1) {
        throw new Error('At least one active admin must always exist. Promote another user to admin first.');
      }
    }

    if (input.resetPassword && input.resetPassword.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }

    let hash = before.password_hash;
    if (input.resetPassword) {
      hash = await argon2.hash(input.resetPassword, { type: argon2.argon2id });
    }

    await txc.req()
      .input('id', sql.Int, id)
      .input('fn', sql.NVarChar, input.fullName ?? before.full_name)
      .input('adm', sql.Bit, input.isAdmin ?? (before.is_admin ? 1 : 0))
      .input('active', sql.Bit, input.isActive ?? (before.is_active ? 1 : 0))
      .input('br', sql.VarChar, input.allowedBranchesCsv ?? before.allowed_branches_csv)
      .input('st', sql.VarChar, input.allowedStoresCsv ?? before.allowed_stores_csv)
      .input('ph', sql.NVarChar, hash)
      .input('force', sql.Bit, input.resetPassword ? 1 : (before.force_change_pw ? 1 : 0))
      .query(`
        UPDATE dbo.users SET
          full_name = @fn, is_admin = @adm, is_active = @active,
          allowed_branches_csv = @br, allowed_stores_csv = @st,
          password_hash = @ph, force_change_pw = @force, updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    if (input.permissions !== undefined && !input.isAdmin) {
      await txc.req()
        .input('uid', sql.Int, id)
        .query(`DELETE FROM dbo.user_permissions WHERE user_id = @uid`);
      for (const p of input.permissions) {
        await txc.req()
          .input('uid', sql.Int, id)
          .input('sc', sql.VarChar, p.screenCode)
          .input('v', sql.Bit, p.view ? 1 : 0)
          .input('a', sql.Bit, p.add ? 1 : 0)
          .input('e', sql.Bit, p.edit ? 1 : 0)
          .input('d', sql.Bit, p.delete ? 1 : 0)
          .input('p', sql.Bit, p.print ? 1 : 0)
          .query(`
            INSERT INTO dbo.user_permissions (user_id, screen_code, can_view, can_add, can_edit, can_delete, can_print)
            VALUES (@uid, @sc, @v, @a, @e, @d, @p)
          `);
      }
    }

    await audit(auditCtx, 'USERS', 'EDIT', 'User', String(id), before.display_id, before, input, txc.tx);
    await txc.commit();
    return (await getUserById(id))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function deleteUser(id: number, auditCtx: AuditContext): Promise<void> {
  if (id === auditCtx.userId) throw new Error('You cannot delete your own account.');

  const txc = await beginTx();
  try {
    const beforeR = await txc.req()
      .input('id', sql.Int, id)
      .query(`SELECT * FROM dbo.users WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
    if (beforeR.recordset.length === 0) throw new Error('User not found.');
    const before = beforeR.recordset[0];

    if (before.is_admin) {
      const adminR = await txc.req().query(`SELECT COUNT(*) AS n FROM dbo.users WHERE is_active = 1 AND is_admin = 1`);
      if (adminR.recordset[0].n <= 1) {
        throw new Error('At least one active admin must always exist. Promote another user to admin first.');
      }
    }
    await txc.req()
      .input('id', sql.Int, id)
      .query(`DELETE FROM dbo.users WHERE id = @id`);
    await audit(auditCtx, 'USERS', 'DELETE', 'User', String(id), before.display_id, before, null, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
