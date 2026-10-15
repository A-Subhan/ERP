/* ===========================================================================
 * Account details service — CRUD for the ~60 business detail fields per
 * account. All fields OPTIONAL; columns are properly typed.
 * Photo uploads handled in routes/accountDetails.routes.ts (POST /:code/photo).
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { audit, AuditContext } from '../utils/audit';

export interface AccountDetails {
  accountCode: string;
  // General
  accountTitle?: string | null;
  shortName?: string | null;
  referenceNumber?: string | null;
  externalCode?: string | null;
  serialNumber?: number | null;
  accountStatus?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'ON_HOLD' | null;
  registrationDate?: string | null;
  customerSupplierCategory?: string | null;
  customerType?: string | null;
  businessType?: string | null;
  remarksNotes?: string | null;
  // Contact
  contactPersonsJson?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressLine3?: string | null;
  area?: string | null;
  city?: string | null;
  provinceState?: string | null;
  postalCode?: string | null;
  country?: string | null;
  telephone?: string | null;
  residenceTelephone?: string | null;
  mobileNumber?: string | null;
  whatsappNumber?: string | null;
  faxNumber?: string | null;
  email?: string | null;
  website?: string | null;
  uanHelpline?: string | null;
  deliveryAddress?: string | null;
  billingAddress?: string | null;
  // Tax and legal
  ntn?: string | null;
  strn?: string | null;
  gstNumber?: string | null;
  cnicNicNumber?: string | null;
  nicop?: string | null;
  cnicExpiryDate?: string | null;
  taxPayerType?: string | null;
  taxPayerStatus?: string | null;
  taxType?: string | null;
  withholdingTaxApplicable?: boolean | null;
  additionalWithholdingApplicable?: boolean | null;
  srbProvincialTaxNumber?: string | null;
  exemptionCertificateNumber?: string | null;
  exemptionCertificateExpiry?: string | null;
  licenseNumber?: string | null;
  licenseExpiryDate?: string | null;
  registrationAuthority?: string | null;
  // Credit and commercial
  creditDays?: number | null;
  creditAmount?: number | null;
  commissionPercent?: number | null;
  defaultDiscountPercent?: number | null;
  defaultSalesman?: string | null;
  priceLevel?: 'RETAIL' | 'WHOLESALE' | 'RESALE' | 'COST' | 'OTHER' | null;
  paymentTerms?: string | null;
  currency?: string | null;
  territoryRoute?: string | null;
  openingRemarks?: string | null;
  defaultProcessNotes?: string | null;
  careOfAccountCode?: string | null;
  cashFlowClassification?: string | null;
  allowSales?: boolean | null;
  allowPurchases?: boolean | null;
  // Personal
  fatherHusbandName?: string | null;
  nationality?: string | null;
  occupation?: string | null;
  monthlyIncome?: number | null;
  customerAge?: number | null;
  numberOfDependents?: number | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  emergencyContact?: string | null;
  // Bank
  bankName?: string | null;
  bankPrefix?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  iban?: string | null;
  bankAccountType?: 'CURRENT' | 'SAVINGS' | 'OTHER' | null;
  bankCurrency?: string | null;
  bankBranchCode?: string | null;
  bankBranchName?: string | null;
  bankBranchAddress?: string | null;
  bankBranchCity?: string | null;
  swiftCode?: string | null;
  lcLimit?: number | null;
  bankCharges?: number | null;
  signatoriesJson?: string | null;
  chequeBookRangeFrom?: string | null;
  chequeBookRangeTo?: string | null;
  currentChequeNumber?: string | null;
  chequePrintFormat?: string | null;
  payOrderOnlineRefNotes?: string | null;
  // Photos (paths on disk)
  nicPhotoPath?: string | null;
  personPhotoPath?: string | null;
  photo1Path?: string | null;
  photo1Label?: string | null;
  photo2Path?: string | null;
  photo2Label?: string | null;
  // Budget
  budgetJan?: number | null; budgetFeb?: number | null; budgetMar?: number | null;
  budgetApr?: number | null; budgetMay?: number | null; budgetJun?: number | null;
  budgetJul?: number | null; budgetAug?: number | null; budgetSep?: number | null;
  budgetOct?: number | null; budgetNov?: number | null; budgetDec?: number | null;
}

const COLS: (keyof AccountDetails)[] = [
  'accountTitle','shortName','referenceNumber','externalCode','serialNumber','accountStatus','registrationDate',
  'customerSupplierCategory','customerType','businessType','remarksNotes',
  'contactPersonsJson','addressLine1','addressLine2','addressLine3','area','city','provinceState','postalCode','country',
  'telephone','residenceTelephone','mobileNumber','whatsappNumber','faxNumber','email','website','uanHelpline',
  'deliveryAddress','billingAddress',
  'ntn','strn','gstNumber','cnicNicNumber','nicop','cnicExpiryDate','taxPayerType','taxPayerStatus','taxType',
  'withholdingTaxApplicable','additionalWithholdingApplicable','srbProvincialTaxNumber',
  'exemptionCertificateNumber','exemptionCertificateExpiry','licenseNumber','licenseExpiryDate','registrationAuthority',
  'creditDays','creditAmount','commissionPercent','defaultDiscountPercent','defaultSalesman','priceLevel','paymentTerms',
  'currency','territoryRoute','openingRemarks','defaultProcessNotes','careOfAccountCode','cashFlowClassification',
  'allowSales','allowPurchases',
  'fatherHusbandName','nationality','occupation','monthlyIncome','customerAge','numberOfDependents',
  'dateOfBirth','gender','maritalStatus','emergencyContact',
  'bankName','bankPrefix','bankAccountName','bankAccountNumber','iban','bankAccountType','bankCurrency',
  'bankBranchCode','bankBranchName','bankBranchAddress','bankBranchCity','swiftCode','lcLimit','bankCharges',
  'signatoriesJson','chequeBookRangeFrom','chequeBookRangeTo','currentChequeNumber','chequePrintFormat','payOrderOnlineRefNotes',
  'nicPhotoPath','personPhotoPath','photo1Path','photo1Label','photo2Path','photo2Label',
  'budgetJan','budgetFeb','budgetMar','budgetApr','budgetMay','budgetJun',
  'budgetJul','budgetAug','budgetSep','budgetOct','budgetNov','budgetDec',
];

// Map camelCase field name -> snake_case DB column
const FIELD_TO_COL: Record<string, string> = {
  accountTitle: 'account_title', shortName: 'short_name', referenceNumber: 'reference_number',
  externalCode: 'external_code', serialNumber: 'serial_number', accountStatus: 'account_status',
  registrationDate: 'registration_date', customerSupplierCategory: 'customer_supplier_category',
  customerType: 'customer_type', businessType: 'business_type', remarksNotes: 'remarks_notes',
  contactPersonsJson: 'contact_persons_json', addressLine1: 'address_line1', addressLine2: 'address_line2',
  addressLine3: 'address_line3', area: 'area', city: 'city', provinceState: 'province_state',
  postalCode: 'postal_code', country: 'country', telephone: 'telephone',
  residenceTelephone: 'residence_telephone', mobileNumber: 'mobile_number', whatsappNumber: 'whatsapp_number',
  faxNumber: 'fax_number', email: 'email', website: 'website', uanHelpline: 'uan_helpline',
  deliveryAddress: 'delivery_address', billingAddress: 'billing_address',
  ntn: 'ntn', strn: 'strn', gstNumber: 'gst_number', cnicNicNumber: 'cnic_nic_number', nicop: 'nicop',
  cnicExpiryDate: 'cnic_expiry_date', taxPayerType: 'tax_payer_type', taxPayerStatus: 'tax_payer_status',
  taxType: 'tax_type', withholdingTaxApplicable: 'withholding_tax_applicable',
  additionalWithholdingApplicable: 'additional_withholding_applicable',
  srbProvincialTaxNumber: 'srb_provincial_tax_number',
  exemptionCertificateNumber: 'exemption_certificate_number',
  exemptionCertificateExpiry: 'exemption_certificate_expiry',
  licenseNumber: 'license_number', licenseExpiryDate: 'license_expiry_date',
  registrationAuthority: 'registration_authority',
  creditDays: 'credit_days', creditAmount: 'credit_amount', commissionPercent: 'commission_percent',
  defaultDiscountPercent: 'default_discount_percent', defaultSalesman: 'default_salesman',
  priceLevel: 'price_level', paymentTerms: 'payment_terms', currency: 'currency',
  territoryRoute: 'territory_route', openingRemarks: 'opening_remarks',
  defaultProcessNotes: 'default_process_notes', careOfAccountCode: 'care_of_account_code',
  cashFlowClassification: 'cash_flow_classification', allowSales: 'allow_sales', allowPurchases: 'allow_purchases',
  fatherHusbandName: 'father_husband_name', nationality: 'nationality', occupation: 'occupation',
  monthlyIncome: 'monthly_income', customerAge: 'customer_age', numberOfDependents: 'number_of_dependents',
  dateOfBirth: 'date_of_birth', gender: 'gender', maritalStatus: 'marital_status',
  emergencyContact: 'emergency_contact',
  bankName: 'bank_name', bankPrefix: 'bank_prefix', bankAccountName: 'bank_account_name',
  bankAccountNumber: 'bank_account_number', iban: 'iban', bankAccountType: 'bank_account_type',
  bankCurrency: 'bank_currency', bankBranchCode: 'bank_branch_code', bankBranchName: 'bank_branch_name',
  bankBranchAddress: 'bank_branch_address', bankBranchCity: 'bank_branch_city', swiftCode: 'swift_code',
  lcLimit: 'lc_limit', bankCharges: 'bank_charges', signatoriesJson: 'signatories_json',
  chequeBookRangeFrom: 'cheque_book_range_from', chequeBookRangeTo: 'cheque_book_range_to',
  currentChequeNumber: 'current_cheque_number', chequePrintFormat: 'cheque_print_format',
  payOrderOnlineRefNotes: 'pay_order_online_ref_notes',
  nicPhotoPath: 'nic_photo_path', personPhotoPath: 'person_photo_path',
  photo1Path: 'photo1_path', photo1Label: 'photo1_label', photo2Path: 'photo2_path', photo2Label: 'photo2_label',
  budgetJan: 'budget_jan', budgetFeb: 'budget_feb', budgetMar: 'budget_mar', budgetApr: 'budget_apr',
  budgetMay: 'budget_may', budgetJun: 'budget_jun', budgetJul: 'budget_jul', budgetAug: 'budget_aug',
  budgetSep: 'budget_sep', budgetOct: 'budget_oct', budgetNov: 'budget_nov', budgetDec: 'budget_dec',
};

export async function getDetails(code: string): Promise<AccountDetails | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('code', sql.VarChar, code)
    .query(`SELECT * FROM dbo.account_details WHERE account_code = @code`);
  if (r.recordset.length === 0) return null;
  return rowToDetails(r.recordset[0]);
}

function rowToDetails(row: any): AccountDetails {
  const out: any = { accountCode: row.account_code };
  for (const f of COLS) {
    const col = FIELD_TO_COL[f as string];
    if (col && row[col] !== undefined) out[f] = row[col];
  }
  return out as AccountDetails;
}

export async function upsertDetails(code: string, input: Partial<AccountDetails>, auditCtx: AuditContext): Promise<AccountDetails> {
  const txc = await beginTx();
  try {
    // Ensure account exists
    const acc = await txc.req()
      .input('code', sql.VarChar, code)
      .query(`SELECT code FROM dbo.accounts WITH (UPDLOCK, HOLDLOCK) WHERE code = @code`);
    if (acc.recordset.length === 0) throw new Error('Account not found.');

    // Ensure details row exists
    await txc.req()
      .input('code2', sql.VarChar, code)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.account_details WHERE account_code = @code2)
        INSERT INTO dbo.account_details (account_code) VALUES (@code2)
      `);

    // Build UPDATE for any provided field
    const setClauses: string[] = [];
    const req = txc.req().input('code', sql.VarChar, code);
    let i = 0;
    for (const f of COLS) {
      const v = (input as any)[f as string];
      if (v === undefined) continue;
      const col = FIELD_TO_COL[f as string];
      const paramName = `p${i++}`;
      // Use sql.NVarChar for everything — mssql driver will cast primitives to
      // the column type as long as the value is a string. For dates we pass
      // ISO strings; for booleans we pass true/false which mssql converts to
      // bit. For numbers we pass numbers which become decimals/ints. The
      // default NVarChar is a safe catch-all here.
      req.input(paramName, v);
      setClauses.push(`${col} = @${paramName}`);
    }
    if (setClauses.length > 0) {
      setClauses.push('updated_at = SYSUTCDATETIME()');
      await req.query(`UPDATE dbo.account_details SET ${setClauses.join(', ')} WHERE account_code = @code`);
    }

    // Branch tags (allow_sales, allow_purchases — wait, those are different. The
    // Tag branch feature uses account_branch_tags. The input doesn't include tags
    // directly; that's a separate endpoint.

    await audit(auditCtx, 'COA_DETAILS', 'EDIT', 'AccountDetails', code, code, null, input, txc.tx);
    await txc.commit();
    return (await getDetails(code))!;
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function setPhoto(code: string, field: 'nicPhotoPath' | 'personPhotoPath' | 'photo1Path' | 'photo2Path', path: string | null, label: string | null, auditCtx: AuditContext): Promise<void> {
  const col = FIELD_TO_COL[field];
  if (!col) throw new Error('Invalid photo field.');
  const txc = await beginTx();
  try {
    const labelCol = field === 'photo1Path' ? 'photo1_label' : field === 'photo2Path' ? 'photo2_label' : null;
    if (labelCol) {
      await txc.req()
        .input('code', sql.VarChar, code)
        .input('path', sql.NVarChar, path)
        .input('label', sql.NVarChar, label)
        .query(`
          UPDATE dbo.account_details SET ${col} = @path, ${labelCol} = @label, updated_at = SYSUTCDATETIME()
          WHERE account_code = @code
        `);
    } else {
      await txc.req()
        .input('code', sql.VarChar, code)
        .input('path', sql.NVarChar, path)
        .query(`UPDATE dbo.account_details SET ${col} = @path, updated_at = SYSUTCDATETIME() WHERE account_code = @code`);
    }
    await audit(auditCtx, 'COA_DETAILS', 'EDIT', 'AccountPhoto', code, code, null, { field, path }, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function setBranchTags(code: string, branchIds: number[], auditCtx: AuditContext): Promise<void> {
  const txc = await beginTx();
  try {
    await txc.req()
      .input('code', sql.VarChar, code)
      .query(`DELETE FROM dbo.account_branch_tags WHERE account_code = @code`);
    for (const bid of branchIds) {
      await txc.req()
        .input('code', sql.VarChar, code)
        .input('bid', sql.Int, bid)
        .query(`INSERT INTO dbo.account_branch_tags (account_code, branch_id) VALUES (@code, @bid)`);
    }
    await audit(auditCtx, 'COA_DETAILS', 'EDIT', 'AccountBranchTags', code, code, null, { branchIds }, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function getBranchTags(code: string): Promise<number[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('code', sql.VarChar, code)
    .query(`SELECT branch_id FROM dbo.account_branch_tags WHERE account_code = @code`);
  return r.recordset.map((row: any) => row.branch_id);
}
