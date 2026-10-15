/* ===========================================================================
 * Audit logger — writes append-only entries to dbo.audit_log
 * ==========================================================================*/
import { getPool, sql } from '../db/pool';

export interface AuditContext {
  userId: number | null;
  userName: string | null;
  ip: string | null;
}

export type AuditAction =
  | 'CREATE' | 'EDIT' | 'DELETE' | 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT'
  | 'PRINT' | 'EXPORT' | 'STATUS_CHANGE' | 'PERMISSION_CHANGE';

export async function audit(
  ctx: AuditContext,
  screenCode: string | null,
  action: AuditAction,
  recordType: string | null,
  recordId: string | null,
  recordNumber: string | null,
  beforeValues: object | null,
  afterValues: object | null,
  requestTx?: sql.Transaction
): Promise<void> {
  const write = async (req: sql.Request) => {
    await req
      .input('uid', sql.Int, ctx.userId)
      .input('uname', sql.NVarChar, ctx.userName)
      .input('ip', sql.VarChar, ctx.ip)
      .input('screen', sql.VarChar, screenCode)
      .input('action', sql.VarChar, action)
      .input('rtype', sql.VarChar, recordType)
      .input('rid', sql.NVarChar, recordId)
      .input('rno', sql.NVarChar, recordNumber)
      .input('before', sql.NVarChar(sql.MAX), beforeValues ? JSON.stringify(beforeValues) : null)
      .input('after', sql.NVarChar(sql.MAX), afterValues ? JSON.stringify(afterValues) : null)
      .query(`
        INSERT INTO dbo.audit_log
          (user_id, user_name, ip_address, screen_code, action,
           record_type, record_id, record_number, before_values, after_values)
        VALUES (@uid, @uname, @ip, @screen, @action,
                @rtype, @rid, @rno, @before, @after)
      `);
  };
  if (requestTx) {
    await write(new sql.Request(requestTx));
  } else {
    const pool = await getPool();
    await write(pool.request());
  }
}
