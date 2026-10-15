/* ===========================================================================
 * Session loader — populates req.user from the DB on every request.
 * ==========================================================================*/
import type { Request, Response, NextFunction } from 'express';
import { getPool, sql } from '../db/pool';

export async function sessionLoader(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.session?.userId) {
    next();
    return;
  }
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('uid', sql.Int, req.session.userId)
      .query(`
        SELECT id, display_id, username, full_name, is_admin, is_active,
               allowed_branches_csv, allowed_stores_csv
        FROM dbo.users
        WHERE id = @uid
      `);
    if (r.recordset.length === 0 || !r.recordset[0].is_active) {
      // User was deactivated since login — destroy the session
      req.session.destroy(() => { /* ignore */ });
      next();
      return;
    }
    const u = r.recordset[0];

    // Load permissions grid (only for non-admins)
    let perms: Record<string, { view: boolean; add: boolean; edit: boolean; delete: boolean; print: boolean }> = {};
    if (!u.is_admin) {
      const p = await pool.request()
        .input('uid', sql.Int, u.id)
        .query(`SELECT screen_code, can_view, can_add, can_edit, can_delete, can_print FROM dbo.user_permissions WHERE user_id = @uid`);
      for (const row of p.recordset) {
        perms[row.screen_code] = {
          view: !!row.can_view, add: !!row.can_add, edit: !!row.can_edit,
          delete: !!row.can_delete, print: !!row.can_print,
        };
      }
    }

    const parseIds = (csv: string | null): number[] | null => {
      if (!csv || csv.trim() === '') return null;
      return csv.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
    };

    req.user = {
      id: u.id,
      displayId: u.display_id,
      username: u.username,
      fullName: u.full_name,
      isAdmin: !!u.is_admin,
      allowedBranches: parseIds(u.allowed_branches_csv),
      allowedStores: parseIds(u.allowed_stores_csv),
      permissions: perms,
    };
    req.auditCtx = { userId: u.id, userName: u.username, ip: req.ip || null };
    next();
  } catch (err) {
    next(err);
  }
}
