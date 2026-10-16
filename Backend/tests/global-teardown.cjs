const { execSync } = require('child_process');

module.exports = async function globalTeardown() {
  try {
    execSync('sqlcmd -S localhost -E -C -d master -Q "IF DB_ID(\'erp_test\') IS NOT NULL ALTER DATABASE erp_test SET SINGLE_USER WITH ROLLBACK IMMEDIATE; IF DB_ID(\'erp_test\') IS NOT NULL DROP DATABASE erp_test"', { stdio: 'pipe' });
  } catch (_) { /* leave it */ }
};
