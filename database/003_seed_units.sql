-- ============================================================================
-- ERP Seed 003: Default Units
-- Spec section 12: PCS, KG, BOX, METER. No demo transactions, no demo users.
-- Counter is initialised so the next manually-created unit gets '0005'.
-- ============================================================================

SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET XACT_ABORT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.master_counter WHERE counter_type = 'UNITS')
    INSERT INTO dbo.master_counter (counter_type, next_value) VALUES ('UNITS', 5);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.units WHERE code = 'PCS')
    INSERT INTO dbo.units (display_id, code, name, is_active)
    VALUES ('0001', 'PCS', N'Pieces', 1);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.units WHERE code = 'KG')
    INSERT INTO dbo.units (display_id, code, name, is_active)
    VALUES ('0002', 'KG', N'Kilogram', 1);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.units WHERE code = 'BOX')
    INSERT INTO dbo.units (display_id, code, name, is_active)
    VALUES ('0003', 'BOX', N'Box', 1);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.units WHERE code = 'METER')
    INSERT INTO dbo.units (display_id, code, name, is_active)
    VALUES ('0004', 'METER', N'Meter', 1);
GO

PRINT '003_seed_units.sql applied successfully.';
GO
