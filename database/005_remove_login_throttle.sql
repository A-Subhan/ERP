-- ============================================================================
-- ERP Migration 005: Remove login attempt throttling
--
-- Change request 17: "Disable the login attempt limit completely. Remove the
-- failed-attempt counter, the lock fields and logic, and the login rate
-- limiter. A user can try to log in any number of times. No user is ever
-- blocked automatically."
--
-- This migration:
--   1. Clears any lock state already stored in existing user rows
--      (failed_login_count = 0, locked_until = NULL).
--   2. Drops the locked_until and failed_login_count columns from users.
--   3. Drops the login rate limiter — that's in the Node app code
--      (Backend/src/index.ts), not the database.
--
-- Failed logins are still written to the audit log (action = LOGIN_FAILED,
-- screen = LOGIN). The audit log never stores the password value.
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Step 1: clear any existing lock state
UPDATE dbo.users
   SET failed_login_count = 0,
       locked_until = NULL
 WHERE failed_login_count <> 0 OR locked_until IS NOT NULL;
GO

-- Step 2: drop the failed_login_count and locked_until columns
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.users') AND name = 'failed_login_count')
BEGIN
    ALTER TABLE dbo.users DROP COLUMN failed_login_count;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.users') AND name = 'locked_until')
BEGIN
    ALTER TABLE dbo.users DROP COLUMN locked_until;
END
GO

PRINT '005_remove_login_throttle.sql applied successfully.';
GO
