/* Creates the erp_test database from the numbered SQL scripts.
 * Uses sqlcmd (Windows auth) so no credentials live in the repo. */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SQLDIR = path.join(__dirname, '..', '..', 'database');

function sqlcmd(database, file) {
  const args = ['-S', 'localhost', '-E', '-C', '-d', database, '-b', '-i', file];
  execSync(`sqlcmd ${args.map((a) => (/[ ]/.test(a) ? `"${a}"` : a)).join(' ')}`, { stdio: 'pipe' });
}

function sqlexec(database, query) {
  execSync(`sqlcmd -S localhost -E -C -d ${database} -Q "${query.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
}

module.exports = async function globalSetup() {
  // Recreate from scratch
  try { sqlexec('master', 'IF DB_ID(\'erp_test\') IS NOT NULL ALTER DATABASE erp_test SET SINGLE_USER WITH ROLLBACK IMMEDIATE; IF DB_ID(\'erp_test\') IS NOT NULL DROP DATABASE erp_test'); } catch (_) { /* not exists */ }
  execSync('sqlcmd -S localhost -E -C -d master -Q "CREATE DATABASE erp_test"', { stdio: 'pipe' });

  sqlcmd('erp_test', path.join(SQLDIR, '001_schema.sql'));
  sqlcmd('erp_test', path.join(SQLDIR, '004_inactive_account_guard.sql'));
  // A settings row is required for the COA seed to run (mirrors first-time setup)
  sqlexec('erp_test', "INSERT INTO dbo.settings (id, company_name, company_id) VALUES (1, N'Test Co', N'TC')");
  // Fixture branch (first row -> id 1) used by tests
  sqlexec('erp_test', "INSERT INTO dbo.branches (code, parent_id, level_no, name, short_name, is_active) VALUES ('01', NULL, 1, N'Head Office', 'HO', 1)");
  // Fixture admin user (id 1) — vouchers carry created_by FK
  sqlexec('erp_test', "INSERT INTO dbo.users (display_id, username, full_name, password, is_active, is_admin) VALUES ('0001', 'admin', N'Admin', 'admin12345', 1, 1)");
  sqlcmd('erp_test', path.join(SQLDIR, '002_seed_coa.sql'));
  sqlcmd('erp_test', path.join(SQLDIR, '003_seed_units.sql'));
  // _migrations bookkeeping (mirrors the runner)
  sqlexec('erp_test', `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='_migrations') CREATE TABLE dbo._migrations (id INT IDENTITY PRIMARY KEY, script_name VARCHAR(200) NOT NULL, applied_at DATETIME2 DEFAULT SYSUTCDATETIME()); INSERT INTO dbo._migrations (script_name) VALUES ('001_schema.sql'),('002_seed_coa.sql'),('003_seed_units.sql')`);

  // Point the backend at the test DB for this jest process
  process.env.DB_DATABASE = 'erp_test';
  process.env.DB_USER = 'sa';
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || '';
  process.env.DB_SERVER = 'localhost';
};
