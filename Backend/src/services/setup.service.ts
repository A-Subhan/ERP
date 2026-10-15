/* ===========================================================================
 * Setup service — first-run: creates company row + first admin + first branch
 * + initial fiscal year. Company ID is enforced unique across all time.
 * Passwords are stored as plain text per change request #2.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { allocateIds, formatDisplayId } from '../utils/counter';
import { nextChildCode } from '../utils/hierarchy';
import { audit } from '../utils/audit';

export interface SetupInput {
  companyName: string;
  companyId: string;
  branchName: string;
  branchShortName: string;
  fiscalYearName: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  adminUsername: string;
  adminFullName: string;
  adminPassword: string;
}

export async function isSetupDone(): Promise<boolean> {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT 1 FROM dbo.settings WHERE id = 1`);
  return r.recordset.length > 0;
}

export async function isCompanyIdTaken(companyId: string): Promise<boolean> {
  const pool = await getPool();
  const cur = await pool.request()
    .input('cid', sql.NVarChar, companyId)
    .query(`SELECT 1 FROM dbo.settings WHERE company_id = @cid`);
  if (cur.recordset.length > 0) return true;
  const prior = await pool.request()
    .input('cid', sql.NVarChar, companyId)
    .query(`
      SELECT 1
      FROM dbo.audit_log
      WHERE action = 'CREATE'
        AND record_type = 'Company'
        AND JSON_VALUE(after_values, '$.companyId') = @cid
    `);
  return prior.recordset.length > 0;
}

export async function runSetup(input: SetupInput): Promise<{ adminUserId: number }> {
  if (await isSetupDone()) {
    throw new Error('First-time setup has already been completed. To change company or admin details, edit the database directly.');
  }
  if (await isCompanyIdTaken(input.companyId)) {
    throw new Error(`Company ID "${input.companyId}" has already been used. Choose a different ID.`);
  }
  if (!input.companyName || input.companyName.trim().length === 0) {
    throw new Error('Company name is required.');
  }
  if (!input.companyId || !/^[A-Za-z0-9 _-]+$/.test(input.companyId) || input.companyId.length > 50) {
    throw new Error('Company ID may only contain letters, numbers, spaces, underscore and hyphen (max 50 chars).');
  }
  if (input.branchShortName.length > 20) {
    throw new Error('Branch short name must be 20 characters or fewer.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(input.branchShortName)) {
    throw new Error('Branch short name may only contain letters, numbers, underscore and hyphen.');
  }
  const fyStart = new Date(input.fiscalYearStart);
  const fyEnd = new Date(input.fiscalYearEnd);
  if (Number.isNaN(fyStart.getTime())) throw new Error('Fiscal year start date is not valid.');
  if (Number.isNaN(fyEnd.getTime())) throw new Error('Fiscal year end date is not valid.');
  if (fyEnd <= fyStart) throw new Error('Fiscal year end must be after its start.');

  const txc = await beginTx();
  try {
    await txc.req()
      .input('cn', sql.NVarChar, input.companyName)
      .input('cid', sql.NVarChar, input.companyId)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1)
        INSERT INTO dbo.settings (id, company_name, company_id)
        VALUES (1, @cn, @cid)
      `);

    const fyR = await txc.req()
      .input('name', sql.NVarChar, input.fiscalYearName)
      .input('start', sql.Date, fyStart)
      .input('end', sql.Date, fyEnd)
      .query(`
        INSERT INTO dbo.fiscal_years (name, start_date, end_date)
        OUTPUT INSERTED.id
        VALUES (@name, @start, @end)
      `);
    const fyId = fyR.recordset[0].id;

    const branchCode = await nextChildCode('BRANCH', null, 1, 'branches');
    const branchR = await txc.req()
      .input('code', sql.VarChar, branchCode)
      .input('name', sql.NVarChar, input.branchName)
      .input('short', sql.VarChar, input.branchShortName)
      .query(`
        INSERT INTO dbo.branches (code, parent_id, level_no, name, short_name, is_active)
        OUTPUT INSERTED.id
        VALUES (@code, NULL, 1, @name, @short, 1)
      `);
    const branchId = branchR.recordset[0].id;

    await txc.req()
      .input('bid', sql.Int, branchId)
      .query(`UPDATE dbo.settings SET default_branch_id = @bid WHERE id = 1`);

    const [userId] = await allocateIds('USERS', 1);
    // PLAIN-TEXT password storage per change request #2. No hashing.
    await txc.req()
      .input('did', sql.VarChar, formatDisplayId(userId))
      .input('uname', sql.NVarChar, input.adminUsername)
      .input('fname', sql.NVarChar, input.adminFullName)
      .input('pw', sql.NVarChar, input.adminPassword)
      .query(`
        INSERT INTO dbo.users (display_id, username, full_name, password, is_active, is_admin)
        VALUES (@did, @uname, @fname, @pw, 1, 1)
      `);
    const adminIdR = await txc.req()
      .input('uname', sql.NVarChar, input.adminUsername)
      .query(`SELECT id FROM dbo.users WHERE username = @uname`);
    const adminUserId = adminIdR.recordset[0].id;

    await audit({ userId: adminUserId, userName: input.adminUsername, ip: null },
      'SETUP', 'CREATE', 'Company', null, null, null,
      { companyName: input.companyName, companyId: input.companyId, branch: input.branchName },
      txc.tx);

    await txc.commit();
    return { adminUserId };
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
