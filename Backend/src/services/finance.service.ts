/* ===========================================================================
 * Finance module service — Opening Trial Balance, Update Cheque Status,
 * Bank Reconciliation. Each is a thin wrapper around the existing ledger
 * and voucher services.
 * ==========================================================================*/
import { getPool, sql, beginTx } from '../db/pool';
import { postEntry, LedgerLine } from './ledger.service';
import { reverseVoucher } from './ledger.service';
import { nextDocNumber, fiscalYearForDate, DocType } from '../utils/docNumber';
import { audit, AuditContext } from '../utils/audit';

// ---------------------------------------------------------------------------
// Opening Trial Balance
// ---------------------------------------------------------------------------

export interface OpeningBalanceLine {
  accountCode: string;
  debit: number;
  credit: number;
  // Knock-Off mode: per-bill breakdown (bill_no, bill_date, amount)
  bills?: Array<{ billNo: string; billDate: string; amount: number }> | null;
}

export async function getOpeningBalances(branchId: number): Promise<any[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bid', sql.Int, branchId)
    .query(`
      SELECT ob.account_code, a.name AS account_name, a.nature, a.party_type,
             ob.debit, ob.credit, ob.fy_start_date,
             ob.bill_id, b.bill_no AS bill_no
      FROM dbo.opening_balances ob
      JOIN dbo.accounts a ON a.code = ob.account_code
      LEFT JOIN dbo.bills b ON b.id = ob.bill_id
      WHERE ob.branch_id = @bid
      ORDER BY ob.account_code
    `);
  return r.recordset;
}

export async function saveOpeningBalances(input: {
  branchId: number;
  lines: OpeningBalanceLine[];
}, auditCtx: AuditContext): Promise<void> {
  // Validate balance: total debit must equal total credit
  const totalDebit = input.lines.reduce((s, l) => s + round2(l.debit), 0);
  const totalCredit = input.lines.reduce((s, l) => s + round2(l.credit), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Opening trial balance is not balanced. Debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}.`);
  }

  const txc = await beginTx();
  try {
    // Get the first fiscal year's start date
    const fyR = await txc.req().query(`SELECT TOP 1 id, start_date FROM dbo.fiscal_years ORDER BY start_date`);
    if (fyR.recordset.length === 0) throw new Error('No fiscal year defined. Add one in the Default Page first.');
    const fyId = fyR.recordset[0].id;
    const fyStartDate = fyR.recordset[0].start_date;

    // Delete existing opening balances for this branch (re-saving replaces them)
    await txc.req()
      .input('bid', sql.Int, input.branchId)
      .query(`DELETE FROM dbo.opening_balances WHERE branch_id = @bid`);

    // Also delete opening bills for this branch's party accounts
    await txc.req()
      .input('bid', sql.Int, input.branchId)
      .query(`DELETE FROM dbo.bills WHERE branch_id = @bid AND bill_type = 'OPENING'`);

    // Delete the old opening GL entries for this branch
    await txc.req()
      .input('bid', sql.Int, input.branchId)
      .query(`DELETE FROM dbo.gl_entries WHERE branch_id = @bid AND is_opening = 1`);

    // Insert new opening balances + GL entries
    const ledgerLines: LedgerLine[] = [];
    for (const line of input.lines) {
      if (line.debit === 0 && line.credit === 0) continue;
      // Insert opening_balance row
      await txc.req()
        .input('bid', sql.Int, input.branchId)
        .input('ac', sql.VarChar, line.accountCode)
        .input('d', sql.Decimal(18,2), round2(line.debit))
        .input('c', sql.Decimal(18,2), round2(line.credit))
        .input('fy', sql.Date, fyStartDate)
        .query(`
          INSERT INTO dbo.opening_balances (branch_id, account_code, debit, credit, fy_start_date)
          VALUES (@bid, @ac, @d, @c, @fy)
        `);

      // Insert bill records for knock-off mode if bills array provided
      let billId: number | null = null;
      if (line.bills && line.bills.length > 0) {
        for (const b of line.bills) {
          const br = await txc.req()
            .input('bn', sql.NVarChar, b.billNo)
            .input('bt', sql.VarChar, 'OPENING')
            .input('pac', sql.VarChar, line.accountCode)
            .input('bid', sql.Int, input.branchId)
            .input('dd', sql.Date, new Date(b.billDate))
            .input('gross', sql.Decimal(18,2), round2(b.amount))
            .input('net', sql.Decimal(18,2), round2(b.amount))
            .query(`
              INSERT INTO dbo.bills (bill_no, bill_type, party_account_code, branch_id, doc_date, gross_amount, net_amount, settled_amount)
              OUTPUT INSERTED.id
              VALUES (@bn, @bt, @pac, @bid, @dd, @gross, @net, 0)
            `);
          if (!billId) billId = br.recordset[0].id;  // first bill id for opening_balance bill_id ref
        }
      }

      // Build ledger line (debit OR credit, not both)
      ledgerLines.push({
        accountCode: line.accountCode,
        debit: round2(line.debit),
        credit: round2(line.credit),
        narration: `Opening balance — branch ${input.branchId}`,
        billId,
      });
    }

    if (ledgerLines.length >= 2) {
      await postEntry({
        voucherNo: `OPN/${input.branchId}/${fyId}`,
        voucherType: 'JV',
        docDate: new Date(fyStartDate),
        fiscalYearId: fyId,
        branchId: input.branchId,
        narration: 'Opening Trial Balance',
        createdBy: auditCtx.userId!,
        lines: ledgerLines,
      }, txc);
      // Mark the GL entries as opening
      await txc.req().query(`
        UPDATE dbo.gl_entries SET is_opening = 1
        WHERE voucher_id = (SELECT TOP 1 id FROM dbo.vouchers WHERE voucher_no = 'OPN/${input.branchId}/${fyId}' ORDER BY id DESC)
      `);
    }

    await audit(auditCtx, 'opening_trial_balance', 'EDIT', 'OpeningBalances', String(input.branchId), null, null, input, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Update Cheque Status
// ---------------------------------------------------------------------------

export async function updateChequeStatus(input: {
  voucherId: number;
  newStatus: 'CLEARED' | 'BOUNCED' | 'CANCELLED';
  statusDate: string;
  reason?: string | null;
}, auditCtx: AuditContext): Promise<void> {
  const pool = await getPool();
  const vR = await pool.request()
    .input('id', sql.BigInt, input.voucherId)
    .query(`SELECT id, voucher_no, voucher_type, doc_date, fiscal_year_id, branch_id, narration, created_by, cheque_status FROM dbo.vouchers WHERE id = @id`);
  if (vR.recordset.length === 0) throw new Error('Voucher not found.');
  const v = vR.recordset[0];
  if (v.cheque_status && (v.cheque_status === 'BOUNCED' || v.cheque_status === 'CANCELLED')) {
    throw new Error(`This cheque has already been ${v.cheque_status.toLowerCase()}. Create a new voucher instead.`);
  }

  const txc = await beginTx();
  try {
    // Update the voucher's cheque_status
    await txc.req()
      .input('id', sql.BigInt, input.voucherId)
      .input('cs', sql.VarChar, input.newStatus)
      .input('csd', sql.Date, new Date(input.statusDate))
      .query(`UPDATE dbo.vouchers SET cheque_status = @cs, cheque_status_date = @csd, updated_at = SYSUTCDATETIME() WHERE id = @id`);

    // For BOUNCED or CANCELLED: reverse the voucher (creates linked reversing entry)
    if (input.newStatus === 'BOUNCED' || input.newStatus === 'CANCELLED') {
      await reverseVoucher(input.voucherId, txc);
      // Also reopen any bills that the voucher had settled
      // (reverseVoucher already does this via its settled-amount release logic)
    }

    await audit(auditCtx, 'update_cheque_status', 'EDIT', 'Voucher', String(input.voucherId), v.voucher_no, { cheque_status: v.cheque_status }, { cheque_status: input.newStatus, statusDate: input.statusDate }, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

export async function listCheques(filter: {
  bankAccountCode?: string | null;
  direction?: 'RECEIPT' | 'PAYMENT' | null;
  status?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  chequeNo?: string | null;
}): Promise<any[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('bac', sql.VarChar, filter.bankAccountCode ?? null)
    .input('cs', sql.VarChar, filter.status ?? null)
    .input('fd', sql.Date, filter.fromDate ?? null)
    .input('td', sql.Date, filter.toDate ?? null)
    .input('cn', sql.VarChar, filter.chequeNo ?? null)
    .query(`
      SELECT v.id, v.voucher_no, v.voucher_type, v.doc_date, v.branch_id, b.short_name AS branch_short,
             v.bank_account_code, v.cheque_no, v.cheque_date, v.cheque_bank_name,
             v.cheque_status, v.cheque_status_date, v.counter_account_code, v.net_amount
      FROM dbo.vouchers v
      JOIN dbo.branches b ON b.id = v.branch_id
      WHERE v.payment_type = 'CHEQUE'
        AND (@bac IS NULL OR v.bank_account_code = @bac)
        AND (@cs IS NULL OR v.cheque_status = @cs)
        AND (@fd IS NULL OR v.doc_date >= @fd)
        AND (@td IS NULL OR v.doc_date <= @td)
        AND (@cn IS NULL OR v.cheque_no LIKE '%' + @cn + '%')
      ORDER BY v.doc_date DESC, v.id DESC
    `);
  // Apply direction filter (BRV/CRV = receipt, BPV/CPV = payment)
  let rows: any[] = r.recordset as any[];
  if (filter.direction) {
    rows = rows.filter((row: any) =>
      filter.direction === 'RECEIPT' ? ['BRV', 'CRV'].includes(row.voucher_type) : ['BPV', 'CPV'].includes(row.voucher_type)
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Bank Reconciliation
// ---------------------------------------------------------------------------

export async function getBankReconciliationData(input: {
  bankAccountCode: string;
  statementDate: string;
}): Promise<any> {
  const pool = await getPool();
  // List unreconciled ledger lines for this bank up to the statement date
  const r = await pool.request()
    .input('bac', sql.VarChar, input.bankAccountCode)
    .input('td', sql.Date, input.statementDate)
    .query(`
      SELECT g.id AS gl_entry_id, g.entry_date, v.voucher_no, g.ref_doc_type,
             g.debit, g.credit, g.narration, g.is_reconciled, g.reconcile_date
      FROM dbo.gl_entries g
      LEFT JOIN dbo.vouchers v ON v.id = g.voucher_id
      WHERE g.account_code = @bac
        AND g.entry_date <= @td
      ORDER BY g.entry_date, g.id
    `);
  // Compute opening balance (sum of all reconciled lines before statement date)
  const openR = await pool.request()
    .input('bac', sql.VarChar, input.bankAccountCode)
    .input('td', sql.Date, input.statementDate)
    .query(`
      SELECT
        ISNULL(SUM(CASE WHEN is_reconciled = 1 THEN debit - credit ELSE 0 END), 0) AS reconciled_balance,
        ISNULL(SUM(debit - credit), 0) AS ledger_balance
      FROM dbo.gl_entries
      WHERE account_code = @bac AND entry_date <= @td
    `);
  return {
    lines: r.recordset.map((row: any) => ({
      ...row,
      debit: Number(row.debit), credit: Number(row.credit),
    })),
    reconciledBalance: Number(openR.recordset[0].reconciled_balance),
    ledgerBalance: Number(openR.recordset[0].ledger_balance),
  };
}

export async function saveBankReconciliation(input: {
  bankAccountCode: string;
  statementDate: string;
  closingBalance: number;
  tickedGlEntryIds: number[];
}, auditCtx: AuditContext): Promise<void> {
  const txc = await beginTx();
  try {
    // Get current reconciled state
    const curR = await txc.req()
      .input('bac', sql.VarChar, input.bankAccountCode)
      .input('td', sql.Date, input.statementDate)
      .query(`
        SELECT ISNULL(SUM(CASE WHEN is_reconciled = 1 THEN debit - credit ELSE 0 END), 0) AS current_reconciled
        FROM dbo.gl_entries
        WHERE account_code = @bac AND entry_date <= @td
      `);
    const currentReconciled = Number(curR.recordset[0].current_reconciled);

    // Mark the ticked entries as reconciled with the statement date
    if (input.tickedGlEntryIds.length > 0) {
      const ids = input.tickedGlEntryIds.join(',');
      await txc.req()
        .input('rd', sql.Date, input.statementDate)
        .query(`
          UPDATE dbo.gl_entries SET is_reconciled = 1, reconcile_date = @rd
          WHERE id IN (${ids})
        `);
    }

    // Insert the reconciliation session row
    const reconciledBalance = currentReconciled;  // they ticked the lines that were on the statement
    const difference = round2(input.closingBalance - reconciledBalance);
    await txc.req()
      .input('bac', sql.VarChar, input.bankAccountCode)
      .input('sd', sql.Date, input.statementDate)
      .input('ob', sql.Decimal(18,2), currentReconciled)
      .input('cb', sql.Decimal(18,2), input.closingBalance)
      .input('rb', sql.Decimal(18,2), reconciledBalance)
      .input('diff', sql.Decimal(18,2), difference)
      .input('cb_user', sql.Int, auditCtx.userId!)
      .query(`
        INSERT INTO dbo.bank_reconciliations (bank_account_code, statement_date, opening_balance, closing_balance, reconciled_balance, difference, created_by)
        OUTPUT INSERTED.id
        VALUES (@bac, @sd, @ob, @cb, @rb, @diff, @cb_user)
      `);
    const reconId = (await txc.req().query(`SELECT MAX(id) AS max_id FROM dbo.bank_reconciliations`)).recordset[0].max_id;

    if (input.tickedGlEntryIds.length > 0) {
      const ids = input.tickedGlEntryIds.join(',');
      await txc.req()
        .input('rid', sql.BigInt, reconId)
        .query(`
          INSERT INTO dbo.bank_reconciliation_lines (reconciliation_id, gl_entry_id, is_tick)
          SELECT @rid, id, 1 FROM dbo.gl_entries WHERE id IN (${ids})
        `);
    }

    await audit(auditCtx, 'bank_reconciliation', 'CREATE', 'BankReconciliation', String(reconId), null, null, input, txc.tx);
    await txc.commit();
  } catch (err) {
    await txc.rollback();
    throw err;
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
