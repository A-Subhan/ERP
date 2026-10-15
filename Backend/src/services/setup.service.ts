/* ===========================================================================
 * Setup service — first-run: creates company row + first admin + first branch
 * + initial fiscal year. Idempotent once setup is completed.
 *
 * Company ID is enforced unique across all time via the append-only audit_log:
 * even if the settings row is ever deleted, the audit entry proves the ID was
 * used before and the new setup is refused.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import argon2 from 'argon2';
import { allocateIds, formatDisplayId } from '../utils/counter';
import { nextChildCode } from '../utils/hierarchy';
import { audit } from '../utils/audit';

export interface SetupInput {
  companyName: string;
  companyId: string;
  branchName: string;
  branchShortName: string;
  fiscalYearName: string;
  fiscalYearStart: string; // YYYY-MM-DD
  fiscalYearEnd: string;   // YYYY-MM-DD
  adminUsername: string;
  adminFullName: string;
  adminPassword: string;
}

export async function isSetupDone(): Promise<boolean> {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT 1 FROM dbo.settings WHERE id = 1`);
  return r.recordset.length > 0;
}

/**
 * Check whether a company ID has ever been used in a previous setup.
 * Uses the append-only audit_log so the check survives settings-row deletion.
 */
export async function isCompanyIdTaken(companyId: string): Promise<boolean> {
  const pool = await getPool();
  // Settings row currently exists with this company_id?
  const cur = await pool.request()
    .input('cid', sql.NVarChar, companyId)
    .query(`SELECT 1 FROM dbo.settings WHERE company_id = @cid`);
  if (cur.recordset.length > 0) return true;

  // Any prior setup audit entry with this company_id?
  // JSON_VALUE reads from the after_values JSON column we populate in runSetup.
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

  // Company ID uniqueness — across all time
  if (await isCompanyIdTaken(input.companyId)) {
    throw new Error(`Company ID "${input.companyId}" has already been used. Choose a different ID.`);
  }

  // Basic field validation (defensive — zod schema also catches these)
  if (!input.companyName || input.companyName.trim().length === 0) {
    throw new Error('Company name is required.');
  }
  if (!input.companyId || !/^[A-Za-z0-9 _-]+$/.test(input.companyId) || input.companyId.length > 50) {
    throw new Error('Company ID is required and may only contain letters, numbers, spaces, underscore and hyphen (max 50 chars).');
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
    // 1. Settings row
    await txc.req()
      .input('cn', sql.NVarChar, input.companyName)
      .input('cid', sql.NVarChar, input.companyId)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1)
        INSERT INTO dbo.settings (id, company_name, company_id)
        VALUES (1, @cn, @cid)
      `);

    // 2. Fiscal year
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

    // 3. First branch (root of the tree)
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

    // Update default branch in settings
    await txc.req()
      .input('bid', sql.Int, branchId)
      .query(`UPDATE dbo.settings SET default_branch_id = @bid WHERE id = 1`);

    // 4. First admin user
    const [userId] = await allocateIds('USERS', 1);
    const pwHash = await argon2.hash(input.adminPassword, { type: argon2.argon2id });
    await txc.req()
      .input('did', sql.VarChar, formatDisplayId(userId))
      .input('uname', sql.NVarChar, input.adminUsername)
      .input('fname', sql.NVarChar, input.adminFullName)
      .input('ph', sql.NVarChar, pwHash)
      .query(`
        INSERT INTO dbo.users (display_id, username, full_name, password_hash, is_active, is_admin, force_change_pw)
        VALUES (@did, @uname, @fname, @ph, 1, 1, 0)
      `);
    const adminIdR = await txc.req()
      .input('uname', sql.NVarChar, input.adminUsername)
      .query(`SELECT id FROM dbo.users WHERE username = @uname`);
    const adminUserId = adminIdR.recordset[0].id;

    // 5. Audit (with companyId in after_values so isCompanyIdTaken can find it later)
    await audit({ userId: adminUserId, userName: input.adminUsername, ip: null },
      'SETUP', 'CREATE', 'Company', null, null, null,
      { companyName: input.companyName, companyId: input.companyId, branch: input.branchName },
      txc.tx
    );

    await txc.commit();
    return { adminUserId };
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}
