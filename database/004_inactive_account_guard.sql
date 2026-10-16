-- ============================================================================
-- ERP Migration 004: reject ledger postings to inactive accounts
-- (001_schema.sql contains the same trigger for fresh installs; this file
--  upgrades databases that were built before the guard existed.)
-- ============================================================================

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER TRIGGER dbo.TRG_accounts_rules
ON dbo.gl_entries
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.accounts a ON a.code = i.account_code
        WHERE a.is_group = 1
    )
    BEGIN
        RAISERROR('Cannot post to a group account. Only posting accounts accept ledger entries.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.accounts a ON a.code = i.account_code
        WHERE a.is_active = 0
    )
    BEGIN
        RAISERROR('Cannot post to an inactive account. Activate the account first.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END
GO
