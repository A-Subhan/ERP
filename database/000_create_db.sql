-- ============================================================================
-- ERP Migration 000: Create the database (if it doesn't exist)
--
-- SQL Server doesn't support `CREATE DATABASE IF NOT EXISTS`.
-- The pattern below checks sys.databases and creates the DB only when missing.
-- This script must run in the `master` database context — i.e. connect to
-- your SQL Server with the default database set to master, OR run
-- `USE master; GO` before this script.
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'erp')
BEGIN
    CREATE DATABASE erp;
    PRINT 'Database erp created.';
END
ELSE
BEGIN
    PRINT 'Database erp already exists.';
END
GO

-- Switch context to the erp database for subsequent scripts in the same session.
USE erp;
GO

PRINT 'Now connected to database erp. Run 001_schema.sql next.';
GO
