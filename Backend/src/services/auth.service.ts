/* ===========================================================================
 * Auth service — login, logout, change password, current user.
 * Plain-text password storage per change request #2 — no hashing, no argon2.
 * ==========================================================================*/
import { getPool, sql } from '../db/pool';
import { audit } from '../utils/audit';

export interface LoginResult {
  ok: boolean;
  error?: string;
  needsPasswordChange?: boolean;
  user?: { id: number; username: string; fullName: string; isAdmin: boolean };
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function login(username: string, password: string, ip: string | null): Promise<LoginResult> {
  const pool = await getPool();
  const r = await pool.request()
    .input('uname', sql.NVarChar, username)
    .query(`
      SELECT id, display_id, username, full_name, password, is_active, is_admin,
             failed_login_count, locked_until
      FROM dbo.users
      WHERE username = @uname
    `);
  if (r.recordset.length === 0) {
    await audit({ userId: null, userName: username, ip }, 'LOGIN', 'LOGIN_FAILED',
      'User', null, null, null, { username });
    return { ok: false, error: 'Username or password is not correct.' };
  }
  const u = r.recordset[0];
  if (!u.is_active) {
    return { ok: false, error: 'This account is not active. Contact your administrator.' };
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return { ok: false, error: 'This account is temporarily locked. Try again later.' };
  }

  // Plain-text comparison per change request #2.
  const valid = (password === u.password);

  if (!valid) {
    const nextFailed = u.failed_login_count + 1;
    const lockUntil = nextFailed >= MAX_FAILED
      ? new Date(Date.now() + LOCK_MINUTES * 60_000)
      : null;
    await pool.request()
      .input('uid', sql.Int, u.id)
      .input('cnt', sql.Int, nextFailed)
      .input('lock', sql.DateTime2, lockUntil)
      .query(`UPDATE dbo.users SET failed_login_count = @cnt, locked_until = @lock WHERE id = @uid`);
    await audit({ userId: u.id, userName: u.username, ip }, 'LOGIN', 'LOGIN_FAILED',
      'User', String(u.id), null, null, { username });
    return { ok: false, error: 'Username or password is not correct.' };
  }

  await pool.request()
    .input('uid', sql.Int, u.id)
    .input('now', sql.DateTime2, new Date())
    .query(`UPDATE dbo.users SET failed_login_count = 0, locked_until = NULL, last_login_at = @now WHERE id = @uid`);

  await audit({ userId: u.id, userName: u.username, ip }, 'LOGIN', 'LOGIN', 'User', String(u.id), null, null, null);

  return {
    ok: true,
    user: { id: u.id, username: u.username, fullName: u.full_name, isAdmin: !!u.is_admin },
  };
}

export async function logout(userId: number, username: string, ip: string | null): Promise<void> {
  await audit({ userId, userName: username, ip }, 'LOGOUT', 'LOGOUT', 'User', String(userId), null, null, null);
}

export async function changePassword(userId: number, oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const pool = await getPool();
  const r = await pool.request()
    .input('uid', sql.Int, userId)
    .query(`SELECT password FROM dbo.users WHERE id = @uid`);
  if (r.recordset.length === 0) return { ok: false, error: 'User not found.' };
  if (oldPassword !== r.recordset[0].password) return { ok: false, error: 'Current password is not correct.' };
  if (!newPassword || newPassword.length < 1) return { ok: false, error: 'New password must not be empty.' };
  // PLAIN-TEXT storage per change request #2.
  await pool.request()
    .input('uid', sql.Int, userId)
    .input('pw', sql.NVarChar, newPassword)
    .query(`UPDATE dbo.users SET password = @pw WHERE id = @uid`);
  return { ok: true };
}

export async function resetPassword(adminId: number, targetUserId: number, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 1) throw new Error('New password must not be empty.');
  const pool = await getPool();
  // NOTE: record only "password was reset" in audit — never the password value.
  await pool.request()
    .input('uid', sql.Int, targetUserId)
    .input('pw', sql.NVarChar, newPassword)
    .query(`UPDATE dbo.users SET password = @pw WHERE id = @uid`);
  await audit({ userId: adminId, userName: null, ip: null },
    'USERS', 'EDIT', 'User', String(targetUserId), null, null,
    { passwordReset: true }, undefined);
}

export async function currentUser(userId: number) {
  const pool = await getPool();
  const r = await pool.request()
    .input('uid', sql.Int, userId)
    .query(`
      SELECT id, display_id, username, full_name, is_admin, is_active
      FROM dbo.users WHERE id = @uid
    `);
  if (r.recordset.length === 0) return null;
  const u = r.recordset[0];
  return {
    id: u.id, displayId: u.display_id, username: u.username,
    fullName: u.full_name, isAdmin: !!u.is_admin,
  };
}
