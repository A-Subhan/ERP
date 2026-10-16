/* ===========================================================================
 * Audit log service — list/viewer only. UPDATE/DELETE blocked by trigger.
 * ==========================================================================*/
import { getPool, sql } from '../db/pool';

export async function listAudit(filters: {
  fromDate?: string | null;
  toDate?: string | null;
  userId?: number | null;
  screenCode?: string | null;
  action?: string | null;
  recordNumber?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: any[]; total: number; page: number; pageSize: number }> {
  const pool = await getPool();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  if (filters.fromDate) where.push('a.event_at >= @fd');
  if (filters.toDate) where.push('a.event_at <= @td');
  if (filters.userId) where.push('a.user_id = @uid');
  if (filters.screenCode) where.push('a.screen_code = @sc');
  if (filters.action) where.push('a.action = @act');
  if (filters.recordNumber) where.push('a.record_number = @rn');
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const r = await pool.request()
    .input('fd', sql.DateTime2, filters.fromDate ? new Date(filters.fromDate) : null)
    .input('td', sql.DateTime2, filters.toDate ? new Date(filters.toDate + 'T23:59:59') : null)
    .input('uid', sql.Int, filters.userId ?? null)
    .input('sc', sql.VarChar, filters.screenCode ?? null)
    .input('act', sql.VarChar, filters.action ?? null)
    .input('rn', sql.NVarChar, filters.recordNumber ?? null)
    .input('offset', sql.Int, offset)
    .input('size', sql.Int, pageSize)
    .query(`
      SELECT a.id, a.event_at, a.user_id, a.user_name, a.ip_address, a.screen_code,
             a.action, a.record_type, a.record_id, a.record_number, a.before_values, a.after_values
      FROM dbo.audit_log a
      ${whereSql}
      ORDER BY a.event_at DESC, a.id DESC
      OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY
    `);

  const countR = await pool.request()
    .input('fd', sql.DateTime2, filters.fromDate ? new Date(filters.fromDate) : null)
    .input('td', sql.DateTime2, filters.toDate ? new Date(filters.toDate + 'T23:59:59') : null)
    .input('uid', sql.Int, filters.userId ?? null)
    .input('sc', sql.VarChar, filters.screenCode ?? null)
    .input('act', sql.VarChar, filters.action ?? null)
    .input('rn', sql.NVarChar, filters.recordNumber ?? null)
    .query(`SELECT COUNT(*) AS n FROM dbo.audit_log a ${whereSql}`);

  return {
    rows: r.recordset,
    total: countR.recordset[0].n,
    page,
    pageSize,
  };
}

export async function listAuditActions(): Promise<string[]> {
  return ['CREATE','EDIT','DELETE','LOGIN','LOGIN_FAILED','LOGOUT','PRINT','EXPORT','STATUS_CHANGE','PERMISSION_CHANGE'];
}
