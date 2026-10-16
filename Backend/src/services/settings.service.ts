/* ===========================================================================
 * Settings service — Default Page (3 tabs: General, Finance & Account Mapping,
 * Print). Company name and company ID are read-only (immutable from app).
 *
 * All updates write to the singleton settings row (id = 1) and to supporting
 * tables (fiscal_years, account_branch_tags for hierarchy digit-per-level
 * locks, etc.).
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { audit, AuditContext } from '../utils/audit';

export interface Settings {
  // General
  companyName: string;
  companyId: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  ntn: string | null;
  strn: string | null;
  logoPath: string | null;
  defaultBranchId: number | null;
  defaultStoreId: number | null;
  decimalsAmount: number;
  decimalsQuantity: number;
  decimalsRate: number;
  allowNegativeStock: boolean;
  branchDigitsPerLevel: string;
  storeDigitsPerLevel: string;
  productDigitsPerLevel: string;
  // Finance
  accountingType: 'KNOCK_OFF' | 'FIFO';
  coaDigitsPerLevel: string;
  coaMaxLevels: number;
  branchMaxLevels: number;
  storeMaxLevels: number;
  productMaxLevels: number;
  agingBucket1: number;
  agingBucket2: number;
  agingBucket3: number;
  defaultCashAccountCode: string | null;
  defaultBankAccountCode: string | null;
  salesAccountCode: string | null;
  salesReturnsAccountCode: string | null;
  outputSalesTaxAccountCode: string | null;
  inputSalesTaxAccountCode: string | null;
  inventoryAccountCode: string | null;
  cogsAccountCode: string | null;
  grnClearingAccountCode: string | null;
  purchasePriceVarianceAccountCode: string | null;
  stockAdjustmentAccountCode: string | null;
  // Print (stored as JSON blob)
  printSettings: any;
}

export async function getSettings(): Promise<Settings | null> {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT * FROM dbo.settings WHERE id = 1`);
  if (r.recordset.length === 0) return null;
  const s = r.recordset[0];
  return {
    companyName: s.company_name,
    companyId: s.company_id,
    address: s.address,
    phone: s.phone,
    email: s.email,
    ntn: s.ntn,
    strn: s.strn,
    logoPath: s.logo_path,
    defaultBranchId: s.default_branch_id,
    defaultStoreId: s.default_store_id,
    decimalsAmount: s.decimals_amount,
    decimalsQuantity: s.decimals_quantity,
    decimalsRate: s.decimals_rate,
    allowNegativeStock: !!s.allow_negative_stock,
    branchDigitsPerLevel: s.branch_digits_per_level,
    storeDigitsPerLevel: s.store_digits_per_level,
    productDigitsPerLevel: s.product_digits_per_level,
    accountingType: s.accounting_type,
    coaDigitsPerLevel: s.coa_digits_per_level,
    coaMaxLevels: s.coa_max_levels,
    branchMaxLevels: s.branch_max_levels,
    storeMaxLevels: s.store_max_levels,
    productMaxLevels: s.product_max_levels,
    agingBucket1: s.aging_bucket_1,
    agingBucket2: s.aging_bucket_2,
    agingBucket3: s.aging_bucket_3,
    defaultCashAccountCode: s.default_cash_account_code,
    defaultBankAccountCode: s.default_bank_account_code,
    salesAccountCode: s.sales_account_code,
    salesReturnsAccountCode: s.sales_returns_account_code,
    outputSalesTaxAccountCode: s.output_sales_tax_account_code,
    inputSalesTaxAccountCode: s.input_sales_tax_account_code,
    inventoryAccountCode: s.inventory_account_code,
    cogsAccountCode: s.cogs_account_code,
    grnClearingAccountCode: s.grn_clearing_account_code,
    purchasePriceVarianceAccountCode: s.purchase_price_variance_account_code,
    stockAdjustmentAccountCode: s.stock_adjustment_account_code,
    printSettings: s.print_settings ? JSON.parse(s.print_settings) : null,
  };
}

/**
 * Update settings. Company name and company ID are NOT editable here (a DB
 * trigger TRG_settings_protect_company rejects any change with a RAISERROR).
 * The accounting type is locked once any customer or supplier transaction
 * exists.
 */
export async function updateSettings(input: Partial<Settings>, auditCtx: AuditContext): Promise<Settings> {
  const pool = await getPool();
  // Lock accounting type after first party transaction
  if (input.accountingType) {
    const txR = await pool.request().query(`
      SELECT 1 FROM dbo.bills
      WHERE bill_type IN ('SALES_INVOICE','PURCHASE_INVOICE','CREDIT_NOTE','DEBIT_NOTE','OPENING')
    `);
    if (txR.recordset.length > 0) {
      const cur = await getSettings();
      if (cur && cur.accountingType !== input.accountingType) {
        throw new Error('Accounting type is locked once any customer or supplier transaction exists.');
      }
    }
  }

  const txc = await beginTx();
  try {
    const beforeR = await txc.req().query(`SELECT * FROM dbo.settings WITH (UPDLOCK, HOLDLOCK) WHERE id = 1`);
    if (beforeR.recordset.length === 0) throw new Error('Settings row not found. Run first-time setup first.');
    const before = beforeR.recordset[0];

    // Build UPDATE only for provided fields (excluding company name/id which trigger blocks)
    const setClauses: string[] = [];
    const add = (col: string, val: any, type: any) => {
      const p = `p_${col}`;
      txc.req().input(p, type, val);
      setClauses.push(`${col} = @${p}`);
    };
    if (input.address !== undefined) add('address', input.address, sql.NVarChar(500));
    if (input.phone !== undefined) add('phone', input.phone, sql.NVarChar(50));
    if (input.email !== undefined) add('email', input.email, sql.NVarChar(100));
    if (input.ntn !== undefined) add('ntn', input.ntn, sql.NVarChar(50));
    if (input.strn !== undefined) add('strn', input.strn, sql.NVarChar(50));
    if (input.logoPath !== undefined) add('logo_path', input.logoPath, sql.NVarChar(500));
    if (input.defaultBranchId !== undefined) add('default_branch_id', input.defaultBranchId, sql.Int);
    if (input.defaultStoreId !== undefined) add('default_store_id', input.defaultStoreId, sql.Int);
    if (input.decimalsAmount !== undefined) add('decimals_amount', input.decimalsAmount, sql.TinyInt);
    if (input.decimalsQuantity !== undefined) add('decimals_quantity', input.decimalsQuantity, sql.TinyInt);
    if (input.decimalsRate !== undefined) add('decimals_rate', input.decimalsRate, sql.TinyInt);
    if (input.allowNegativeStock !== undefined) add('allow_negative_stock', input.allowNegativeStock ? 1 : 0, sql.Bit);
    if (input.branchDigitsPerLevel !== undefined) add('branch_digits_per_level', input.branchDigitsPerLevel, sql.VarChar(20));
    if (input.storeDigitsPerLevel !== undefined) add('store_digits_per_level', input.storeDigitsPerLevel, sql.VarChar(20));
    if (input.productDigitsPerLevel !== undefined) add('product_digits_per_level', input.productDigitsPerLevel, sql.VarChar(20));
    if (input.accountingType !== undefined) add('accounting_type', input.accountingType, sql.VarChar(20));
    if (input.coaDigitsPerLevel !== undefined) add('coa_digits_per_level', input.coaDigitsPerLevel, sql.VarChar(40));
    if (input.agingBucket1 !== undefined) add('aging_bucket_1', input.agingBucket1, sql.Int);
    if (input.agingBucket2 !== undefined) add('aging_bucket_2', input.agingBucket2, sql.Int);
    if (input.agingBucket3 !== undefined) add('aging_bucket_3', input.agingBucket3, sql.Int);
    if (input.defaultCashAccountCode !== undefined) add('default_cash_account_code', input.defaultCashAccountCode, sql.VarChar(40));
    if (input.defaultBankAccountCode !== undefined) add('default_bank_account_code', input.defaultBankAccountCode, sql.VarChar(40));
    if (input.salesAccountCode !== undefined) add('sales_account_code', input.salesAccountCode, sql.VarChar(40));
    if (input.salesReturnsAccountCode !== undefined) add('sales_returns_account_code', input.salesReturnsAccountCode, sql.VarChar(40));
    if (input.outputSalesTaxAccountCode !== undefined) add('output_sales_tax_account_code', input.outputSalesTaxAccountCode, sql.VarChar(40));
    if (input.inputSalesTaxAccountCode !== undefined) add('input_sales_tax_account_code', input.inputSalesTaxAccountCode, sql.VarChar(40));
    if (input.inventoryAccountCode !== undefined) add('inventory_account_code', input.inventoryAccountCode, sql.VarChar(40));
    if (input.cogsAccountCode !== undefined) add('cogs_account_code', input.cogsAccountCode, sql.VarChar(40));
    if (input.grnClearingAccountCode !== undefined) add('grn_clearing_account_code', input.grnClearingAccountCode, sql.VarChar(40));
    if (input.purchasePriceVarianceAccountCode !== undefined) add('purchase_price_variance_account_code', input.purchasePriceVarianceAccountCode, sql.VarChar(40));
    if (input.stockAdjustmentAccountCode !== undefined) add('stock_adjustment_account_code', input.stockAdjustmentAccountCode, sql.VarChar(40));
    if (input.printSettings !== undefined) add('print_settings', JSON.stringify(input.printSettings), sql.NVarChar(sql.MAX));

    if (setClauses.length > 0) {
      setClauses.push('updated_at = SYSUTCDATETIME()');
      await txc.req().query(`UPDATE dbo.settings SET ${setClauses.join(', ')} WHERE id = 1`);
    }

    await audit(auditCtx, 'DEFAULT_PAGE', 'EDIT', 'Settings', '1', null, before, input, txc.tx);
    await txc.commit();
    return (await getSettings())!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

// --- Fiscal years (managed via Default Page) ---

export interface FiscalYear { id: number; name: string; startDate: string; endDate: string; isActive: boolean; }

export async function listFiscalYears(): Promise<FiscalYear[]> {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT id, name, start_date, end_date, is_active FROM dbo.fiscal_years ORDER BY start_date`);
  return r.recordset.map((row: any) => ({
    id: row.id, name: row.name,
    startDate: row.start_date, endDate: row.end_date, isActive: !!row.is_active,
  }));
}

export async function createFiscalYear(input: { name: string; startDate: string; endDate: string }, auditCtx: AuditContext): Promise<FiscalYear> {
  if (!input.name || !input.startDate || !input.endDate) throw new Error('Name, start date and end date are required.');
  if (new Date(input.endDate) <= new Date(input.startDate)) throw new Error('End date must be after start date.');
  const pool = await getPool();
  const r = await pool.request()
    .input('name', sql.NVarChar, input.name)
    .input('start', sql.Date, new Date(input.startDate))
    .input('end', sql.Date, new Date(input.endDate))
    .query(`
      INSERT INTO dbo.fiscal_years (name, start_date, end_date, is_active)
      OUTPUT INSERTED.id, INSERTED.name, INSERTED.start_date, INSERTED.end_date, INSERTED.is_active
      VALUES (@name, @start, @end, 1)
    `);
  const fy = r.recordset[0];
  await audit(auditCtx, 'DEFAULT_PAGE', 'CREATE', 'FiscalYear', String(fy.id), null, null, input, undefined);
  return { id: fy.id, name: fy.name, startDate: fy.start_date, endDate: fy.end_date, isActive: !!fy.is_active };
}

export async function deleteFiscalYear(id: number, auditCtx: AuditContext): Promise<void> {
  const pool = await getPool();
  // Check no transactions reference this fiscal year
  const txR = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT 1 FROM dbo.gl_entries WHERE fiscal_year_id = @id`);
  if (txR.recordset.length > 0) throw new Error('This fiscal year has transactions and cannot be deleted.');
  await pool.request().input('id', sql.Int, id).query(`DELETE FROM dbo.fiscal_years WHERE id = @id`);
  await audit(auditCtx, 'DEFAULT_PAGE', 'DELETE', 'FiscalYear', String(id), null, null, null, undefined);
}
