-- ============================================================================
-- ERP Seed 002: Standard Chart of Accounts
-- Uses accounts.code as primary key (no id column).
-- Maps accounts in settings via *_account_code columns.
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
-- Level-1 group accounts
-- ----------------------------------------------------------------------------
-- Every batch below re-checks the guard: RETURN only exits the current batch,
-- so a single guard at the top of the file would not stop the later batches.
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('01', NULL, 1, 'ASSETS', 'ASSET', 1, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('02', NULL, 1, 'LIABILITIES', 'LIABILITY', 1, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('03', NULL, 1, 'EQUITY', 'EQUITY', 1, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '04')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('04', NULL, 1, 'REVENUE', 'REVENUE', 1, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('05', NULL, 1, 'EXPENSES', 'EXPENSE', 1, 1);
GO

-- ----------------------------------------------------------------------------
-- Level-2 group accounts
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('01001', '01', 2, 'Current Assets', 'ASSET', 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('02001', '02', 2, 'Current Liabilities', 'LIABILITY', 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('03001', '03', 2, 'Capital', 'EQUITY', 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03002')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('03002', '03', 2, 'Retained Earnings', 'EQUITY', 1, 1);
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Current Assets
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_cash, is_active)
    VALUES ('01001001', '01001', 3, 'Cash in Hand', 'ASSET', 0, 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001002')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_bank, is_active)
    VALUES ('01001002', '01001', 3, 'Banks', 'ASSET', 0, 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001003')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, party_type, credit_days, is_active)
    VALUES ('01001003', '01001', 3, 'Trade Debtors', 'ASSET', 0, 'CUSTOMER', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001004')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('01001004', '01001', 3, 'Inventory', 'ASSET', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001005')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('01001005', '01001', 3, 'Input Sales Tax', 'ASSET', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001006')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('01001006', '01001', 3, 'Advance Tax', 'ASSET', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '01001007')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('01001007', '01001', 3, 'GRN Clearing', 'ASSET', 0, 1);
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Current Liabilities
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02001001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, party_type, credit_days, is_active)
    VALUES ('02001001', '02001', 3, 'Trade Creditors', 'LIABILITY', 0, 'SUPPLIER', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02001002')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('02001002', '02001', 3, 'Output Sales Tax Payable', 'LIABILITY', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '02001003')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('02001003', '02001', 3, 'Withholding Tax Payable', 'LIABILITY', 0, 1);
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Capital and Retained Earnings
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03001001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('03001001', '03001', 3, 'Owner Capital', 'EQUITY', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '03002001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('03002001', '03002', 3, 'Retained Earnings (Prior Years)', 'EQUITY', 0, 1);
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Revenue
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '04001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('04001', '04', 2, 'Sales Revenue', 'REVENUE', 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '04001001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('04001001', '04001', 3, 'Sales', 'REVENUE', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '04001002')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('04001002', '04001', 3, 'Sales Returns', 'REVENUE', 0, 1);
GO

-- ----------------------------------------------------------------------------
-- Level-3 posting accounts under Expenses
-- ----------------------------------------------------------------------------
<<<<<<< HEAD
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;
=======
IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('05001', '05', 2, 'Cost of Sales', 'EXPENSE', 1, 1);
>>>>>>> a98c2af5df3dfd92f7352d2a5b31a7bc0e1be6bb

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05001001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('05001001', '05001', 3, 'Cost of Goods Sold', 'EXPENSE', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05001002')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('05001002', '05001', 3, 'Purchase Price Variance', 'EXPENSE', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05001003')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('05001003', '05001', 3, 'Stock Adjustment', 'EXPENSE', 0, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05002')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('05002', '05', 2, 'General Expenses', 'EXPENSE', 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = '05002001')
    INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_active)
    VALUES ('05002001', '05002', 3, 'General Expenses', 'EXPENSE', 0, 1);
GO

-- ----------------------------------------------------------------------------
-- Create empty account_details rows for each seeded account
-- ----------------------------------------------------------------------------
INSERT INTO dbo.account_details (account_code)
SELECT code FROM dbo.accounts a
WHERE NOT EXISTS (SELECT 1 FROM dbo.account_details d WHERE d.account_code = a.code);
GO

-- ----------------------------------------------------------------------------
-- Map default accounts in settings (via *_account_code columns)
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

UPDATE s SET
    default_cash_account_code         = '01001001',
    default_bank_account_code         = '01001002',
    sales_account_code                = '04001001',
    sales_returns_account_code        = '04001002',
    output_sales_tax_account_code     = '02001002',
    input_sales_tax_account_code      = '01001005',
    inventory_account_code            = '01001004',
    cogs_account_code                 = '05001001',
    grn_clearing_account_code         = '01001007',
    purchase_price_variance_account_code = '05001002',
    stock_adjustment_account_code     = '05001003',
    updated_at = SYSUTCDATETIME()
FROM dbo.settings s
WHERE s.id = 1;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1) RETURN;

PRINT '002_seed_coa.sql applied successfully.';
GO
