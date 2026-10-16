-- ============================================================================
-- ERP Migration 006: Company ID uniqueness (case-insensitive, space-ignoring)
--
-- Per change request #2: "When someone enters a company ID, check the database
-- that no company with that ID (compare case-insensitively, ignoring spaces)
-- already exists. Show a clear message under the field and enforce it with a
-- unique constraint in the database."
--
-- SQL Server is case-insensitive by default for VARCHAR comparisons in most
-- collations, but we want to be explicit and to also ignore interior spaces.
-- A computed column normalized_company_id (UPPER + REPLACE all spaces) holds
-- the comparable form, and a UNIQUE INDEX on it enforces uniqueness.
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Add the computed column if not present
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.settings') AND name = 'normalized_company_id')
BEGIN
    ALTER TABLE dbo.settings
        ADD normalized_company_id AS (UPPER(REPLACE(company_id, ' ', '')));
END
GO

-- Unique index on the normalized form
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_settings_normalized_company_id')
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UQ_settings_normalized_company_id
        ON dbo.settings(normalized_company_id);
END
GO

PRINT '006_company_id_unique.sql applied successfully.';
GO
