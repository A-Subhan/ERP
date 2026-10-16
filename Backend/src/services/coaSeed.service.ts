/* ===========================================================================
 * Chart of Accounts seed — runs automatically inside first-time setup so the
 * user never has to re-run a SQL file by hand. Idempotent: existing accounts
 * are left untouched. database/002_seed_coa.sql mirrors this data for manual
 * re-runs on an existing installation.
 * ==========================================================================*/
import { sql } from '../db/pool';

interface SeedAccount {
  code: string;
  parent: string | null;
  level: number;
  name: string;
  nature: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  group?: boolean;
  cash?: boolean;
  bank?: boolean;
  partyType?: 'CUSTOMER' | 'SUPPLIER';
}

const SEED_ACCOUNTS: SeedAccount[] = [
  // Level 1 — the five natures
  { code: '01', parent: null, level: 1, name: 'ASSETS', nature: 'ASSET', group: true },
  { code: '02', parent: null, level: 1, name: 'LIABILITIES', nature: 'LIABILITY', group: true },
  { code: '03', parent: null, level: 1, name: 'EQUITY', nature: 'EQUITY', group: true },
  { code: '04', parent: null, level: 1, name: 'REVENUE', nature: 'REVENUE', group: true },
  { code: '05', parent: null, level: 1, name: 'EXPENSES', nature: 'EXPENSE', group: true },

  // Level 2
  { code: '01001', parent: '01', level: 2, name: 'Current Assets', nature: 'ASSET', group: true },
  { code: '02001', parent: '02', level: 2, name: 'Current Liabilities', nature: 'LIABILITY', group: true },
  { code: '03001', parent: '03', level: 2, name: 'Capital', nature: 'EQUITY', group: true },
  { code: '03002', parent: '03', level: 2, name: 'Retained Earnings', nature: 'EQUITY', group: true },
  { code: '04001', parent: '04', level: 2, name: 'Sales Revenue', nature: 'REVENUE', group: true },
  { code: '05001', parent: '05', level: 2, name: 'Cost of Sales', nature: 'EXPENSE', group: true },
  { code: '05002', parent: '05', level: 2, name: 'General Expenses', nature: 'EXPENSE', group: true },

  // Level 3 — posting accounts
  { code: '01001001', parent: '01001', level: 3, name: 'Cash in Hand', nature: 'ASSET', cash: true },
  { code: '01001002', parent: '01001', level: 3, name: 'Banks', nature: 'ASSET', bank: true },
  { code: '01001003', parent: '01001', level: 3, name: 'Trade Debtors', nature: 'ASSET', partyType: 'CUSTOMER' },
  { code: '01001004', parent: '01001', level: 3, name: 'Inventory', nature: 'ASSET' },
  { code: '01001005', parent: '01001', level: 3, name: 'Input Sales Tax', nature: 'ASSET' },
  { code: '01001006', parent: '01001', level: 3, name: 'Advance Tax', nature: 'ASSET' },
  { code: '01001007', parent: '01001', level: 3, name: 'GRN Clearing', nature: 'ASSET' },
  { code: '02001001', parent: '02001', level: 3, name: 'Trade Creditors', nature: 'LIABILITY', partyType: 'SUPPLIER' },
  { code: '02001002', parent: '02001', level: 3, name: 'Output Sales Tax Payable', nature: 'LIABILITY' },
  { code: '02001003', parent: '02001', level: 3, name: 'Withholding Tax Payable', nature: 'LIABILITY' },
  { code: '03001001', parent: '03001', level: 3, name: 'Owner Capital', nature: 'EQUITY' },
  { code: '03002001', parent: '03002', level: 3, name: 'Retained Earnings (Prior Years)', nature: 'EQUITY' },
  { code: '04001001', parent: '04001', level: 3, name: 'Sales', nature: 'REVENUE' },
  { code: '04001002', parent: '04001', level: 3, name: 'Sales Returns', nature: 'REVENUE' },
  { code: '05001001', parent: '05001', level: 3, name: 'Cost of Goods Sold', nature: 'EXPENSE' },
  { code: '05001002', parent: '05001', level: 3, name: 'Purchase Price Variance', nature: 'EXPENSE' },
  { code: '05001003', parent: '05001', level: 3, name: 'Stock Adjustment', nature: 'EXPENSE' },
  { code: '05002001', parent: '05002', level: 3, name: 'General Expenses', nature: 'EXPENSE' },
];

/** Seed the standard Chart of Accounts + default account mapping. */
export async function seedChartOfAccounts(req: () => sql.Request): Promise<void> {
  for (const a of SEED_ACCOUNTS) {
    await req()
      .input('code', sql.VarChar, a.code)
      .input('parent', sql.VarChar, a.parent)
      .input('level', sql.TinyInt, a.level)
      .input('name', sql.NVarChar, a.name)
      .input('nature', sql.VarChar, a.nature)
      .input('grp', sql.Bit, a.group ? 1 : 0)
      .input('cash', sql.Bit, a.cash ? 1 : 0)
      .input('bank', sql.Bit, a.bank ? 1 : 0)
      .input('pt', sql.VarChar, a.partyType ?? 'NONE')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.accounts WHERE code = @code)
        INSERT INTO dbo.accounts (code, parent_code, level_no, name, nature, is_group, is_cash, is_bank, party_type, is_active)
        VALUES (@code, @parent, @level, @name, @nature, @grp, @cash, @bank, @pt, 1)
      `);
  }

  // Empty account_details row for every account (all detail fields optional)
  await req().query(`
    INSERT INTO dbo.account_details (account_code)
    SELECT code FROM dbo.accounts a
    WHERE NOT EXISTS (SELECT 1 FROM dbo.account_details d WHERE d.account_code = a.code)
  `);

  // Pre-map the default accounts in settings
  await req().query(`
    UPDATE s SET
      default_cash_account_code            = '01001001',
      default_bank_account_code            = '01001002',
      sales_account_code                   = '04001001',
      sales_returns_account_code           = '04001002',
      output_sales_tax_account_code        = '02001002',
      input_sales_tax_account_code         = '01001005',
      inventory_account_code               = '01001004',
      cogs_account_code                    = '05001001',
      grn_clearing_account_code            = '01001007',
      purchase_price_variance_account_code = '05001002',
      stock_adjustment_account_code        = '05001003',
      updated_at = SYSUTCDATETIME()
    FROM dbo.settings s WHERE s.id = 1
  `);
}
