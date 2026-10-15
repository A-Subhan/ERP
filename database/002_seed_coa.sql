-- ============================================================================
-- ERP Seed 002: Standard Chart of Accounts
-- Pre-maps all required accounts in the Finance & Account Mapping tab.
-- Run AFTER 001_schema.sql AND after first-time setup has created the
-- settings row (company_name/company_id etc.).
--
-- Level digits: 2/3/3/3/3/3 (per spec section 12).
-- Codes are auto-derived from level digits.
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1)
BEGIN
    PRINT 'Skipping 002_seed_coa.sql: settings row does not exist yet.';
    PRINT '  Run first-time setup via the backend (cd Backend && npm run setup),';
    PRINT '  then re-run this seed script. The Chart of Accounts will be created then.';
    RETURN;
END
GO

-- ----------------------------------------------------------------------------
-- Level-1 group accounts (top-level by nature)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    VALUES ('01', NULL, 1, 'ASSETS', 'ASSET', 1, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    VALUES ('02', NULL, 1, 'LIABILITIES', 'LIABILITY', 1, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    VALUES ('03', NULL, 1, 'EQUITY', 'EQUITY', 1, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '04')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    VALUES ('04', NULL, 1, 'REVENUE', 'REVENUE', 1, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    VALUES ('05', NULL, 1, 'EXPENSES', 'EXPENSE', 1, 1);
GO

-- ----------------------------------------------------------------------------
-- Level-2 group accounts
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '01001', id, 2, 'Current Assets', 'ASSET', 1, 1 FROM dbo.accounts WHERE code = '01';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02001')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '02001', id, 2, 'Current Liabilities', 'LIABILITY', 1, 1 FROM dbo.accounts WHERE code = '02';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03001')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '03001', id, 2, 'Capital', 'EQUITY', 1, 1 FROM dbo.accounts WHERE code = '03';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03002')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '03002', id, 2, 'Retained Earnings', 'EQUITY', 1, 1 FROM dbo.accounts WHERE code = '03';
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Current Assets
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001001')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_cash, is_active)
    SELECT '01001001', id, 3, 'Cash in Hand', 'ASSET', 0, 1, 1 FROM dbo.accounts WHERE code = '01001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001002')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_bank, is_active)
    SELECT '01001002', id, 3, 'Banks', 'ASSET', 0, 1, 1 FROM dbo.accounts WHERE code = '01001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001003')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, party_type, is_active)
    SELECT '01001003', id, 3, 'Trade Debtors', 'ASSET', 0, 'CUSTOMER', 1 FROM dbo.accounts WHERE code = '01001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001004')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '01001004', id, 3, 'Inventory', 'ASSET', 0, 1 FROM dbo.accounts WHERE code = '01001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001005')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '01001005', id, 3, 'Input Sales Tax', 'ASSET', 0, 1 FROM dbo.accounts WHERE code = '01001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001006')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '01001006', id, 3, 'Advance Tax', 'ASSET', 0, 1 FROM dbo.accounts WHERE code = '01001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001007')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '01001007', id, 3, 'GRN Clearing', 'ASSET', 0, 1 FROM dbo.accounts WHERE code = '01001';
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Current Liabilities
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02001001')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, party_type, is_active)
    SELECT '02001001', id, 3, 'Trade Creditors', 'LIABILITY', 0, 'SUPPLIER', 1 FROM dbo.accounts WHERE code = '02001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02001002')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '02001002', id, 3, 'Output Sales Tax Payable', 'LIABILITY', 0, 1 FROM dbo.accounts WHERE code = '02001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02001003')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '02001003', id, 3, 'Withholding Tax Payable', 'LIABILITY', 0, 1 FROM dbo.accounts WHERE code = '02001';
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Capital and Retained Earnings
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03001001')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '03001001', id, 3, 'Owner Capital', 'EQUITY', 0, 1 FROM dbo.accounts WHERE code = '03001';

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03002001')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '03002001', id, 3, 'Retained Earnings (Prior Years)', 'EQUITY', 0, 1 FROM dbo.accounts WHERE code = '03002';
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Revenue
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '04001001')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '04001')
        INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
        SELECT '04001', id, 2, 'Sales Revenue', 'REVENUE', 1, 1 FROM dbo.accounts WHERE code = '04';

    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '04001001', id, 3, 'Sales', 'REVENUE', 0, 1 FROM dbo.accounts WHERE code = '04001';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '04001002')
    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '04001002', id, 3, 'Sales Returns', 'REVENUE', 0, 1 FROM dbo.accounts WHERE code = '04001';
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Expenses
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05001001')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05001')
        INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
        SELECT '05001', id, 2, 'Cost of Sales', 'EXPENSE', 1, 1 FROM dbo.accounts WHERE code = '05';

    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '05001001', id, 3, 'Cost of Goods Sold', 'EXPENSE', 0, 1 FROM dbo.accounts WHERE code = '05001';

    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '05001002', id, 3, 'Purchase Price Variance', 'EXPENSE', 0, 1 FROM dbo.accounts WHERE code = '05001';

    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '05001003', id, 3, 'Stock Adjustment', 'EXPENSE', 0, 1 FROM dbo.accounts WHERE code = '05001';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05002001')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05002')
        INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
        SELECT '05002', id, 2, 'General Expenses', 'EXPENSE', 1, 1 FROM dbo.accounts WHERE code = '05';

    INSERT INTO dbo.accounts (code, parent_id, level_no, name, nature, is_group, is_active)
    SELECT '05002001', id, 3, 'General Expenses', 'EXPENSE', 0, 1 FROM dbo.accounts WHERE code = '05002';
END
GO

-- ----------------------------------------------------------------------------
-- Update settings to map all the default accounts
-- ----------------------------------------------------------------------------
UPDATE s SET
    default_cash_account_id         = (SELECT id FROM dbo.accounts WHERE code = '01001001'),
    default_bank_account_id         = (SELECT id FROM dbo.accounts WHERE code = '01001002'),
    sales_account_id                = (SELECT id FROM dbo.accounts WHERE code = '04001001'),
    sales_returns_account_id        = (SELECT id FROM dbo.accounts WHERE code = '04001002'),
    output_sales_tax_account_id     = (SELECT id FROM dbo.accounts WHERE code = '02001002'),
    input_sales_tax_account_id       = (SELECT id FROM dbo.accounts WHERE code = '01001005'),
    inventory_account_id            = (SELECT id FROM dbo.accounts WHERE code = '01001004'),
    cogs_account_id                 = (SELECT id FROM dbo.accounts WHERE code = '05001001'),
    grn_clearing_account_id          = (SELECT id FROM dbo.accounts WHERE code = '01001007'),
    purchase_price_variance_account_id = (SELECT id FROM dbo.accounts WHERE code = '05001002'),
    stock_adjustment_account_id     = (SELECT id FROM dbo.accounts WHERE code = '05001003'),
    updated_at = SYSUTCDATETIME()
FROM dbo.settings s
WHERE s.id = 1;
GO

PRINT '002_seed_coa.sql applied successfully.';
GO
