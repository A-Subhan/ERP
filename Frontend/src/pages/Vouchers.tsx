import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Branch, Account } from '../api/types';

interface VoucherRow {
  id: number;
  voucher_no: string;
  voucher_type: 'CRV' | 'CPV' | 'BRV' | 'BPV' | 'JV';
  doc_date: string;
  branch_id: number;
  branch_short: string;
  counter_account_code: string | null;
  cash_account_code: string | null;
  bank_account_code: string | null;
  cheque_no: string | null;
  cheque_status: string | null;
  reference: string | null;
  narration: string | null;
  gross_amount: number | null;
  tax_amount: number | null;
  net_amount: number | null;
  status: string;
}

interface TaxHead {
  id: number; displayId: string; name: string; accountCode: string;
  percentage: number; isActive: boolean;
}

interface VoucherLineInput {
  accountCode: string;
  debit: number;
  credit: number;
  narration?: string | null;
}

const VOUCHER_META: Record<string, { title: string; screen: string }> = {
  CRV: { title: 'Cash Receipt Voucher', screen: 'cash_receipt' },
  CPV: { title: 'Cash Payment Voucher', screen: 'cash_payment' },
  BRV: { title: 'Bank Receipt Voucher', screen: 'bank_receipt' },
  BPV: { title: 'Bank Payment Voucher', screen: 'bank_payment' },
  JV:  { title: 'Journal Voucher', screen: 'journal_voucher' },
};

export default function Vouchers({ voucherType }: { voucherType: 'CRV' | 'CPV' | 'BRV' | 'BPV' | 'JV' }) {
  const meta = VOUCHER_META[voucherType];
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [taxHeads, setTaxHeads] = useState<TaxHead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [v, b, a, t] = await Promise.all([
        api.get<VoucherRow[]>(`/api/vouchers?voucherType=${voucherType}`),
        api.get<Branch[]>('/api/branches'),
        api.get<Account[]>('/api/accounts'),
        api.get<TaxHead[]>('/api/tax-heads'),
      ]);
      setRows(v); setBranches(b); setAccounts(a); setTaxHeads(t);
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [voucherType]);

  const onDelete = async (v: VoucherRow) => {
    if (!confirm(`Reverse voucher ${v.voucher_no}? This will post a reversing entry.`)) return;
    try { await api.del(`/api/vouchers/${v.id}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{meta.title}</div>
          <div className="page-subtitle">Saved and posted immediately. Editing or deleting reverses and re-applies effects.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>New {meta.title}</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="data-table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Voucher no.</th><th>Date</th><th>Branch</th>
                <th>Counter account</th>
                <th className="num">Gross</th><th className="num">Tax</th><th className="num">Net</th>
                <th>Cheque</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={10} className="empty-state">Loading…</td></tr> :
               rows.length === 0 ? <tr><td colSpan={10} className="empty-state">No vouchers yet.</td></tr> :
               rows.map((v) => (
                <tr key={v.id}>
                  <td>{v.voucher_no}</td>
                  <td>{formatDate(v.doc_date)}</td>
                  <td>{v.branch_short}</td>
                  <td className="num">{v.counter_account_code || '—'}</td>
                  <td className="num">{v.gross_amount?.toFixed(2) || '—'}</td>
                  <td className="num">{v.tax_amount?.toFixed(2) || '—'}</td>
                  <td className="num">{v.net_amount?.toFixed(2) || '—'}</td>
                  <td>{v.cheque_no ? `${v.cheque_no} (${v.cheque_status || '—'})` : '—'}</td>
                  <td>{v.status === 'POSTED' ? <span className="badge badge-success">Posted</span> : <span className="badge badge-muted">{v.status}</span>}</td>
                  <td className="text-right">
                    <button className="btn btn-sm btn-ghost" onClick={() => onDelete(v)}>Reverse</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <VoucherForm
          voucherType={voucherType}
          branches={branches}
          accounts={accounts}
          taxHeads={taxHeads}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load(); }}
        />
      )}
    </div>
  );
}

function VoucherForm({
  voucherType, branches, accounts, taxHeads, onClose, onSaved,
}: {
  voucherType: 'CRV' | 'CPV' | 'BRV' | 'BPV' | 'JV';
  branches: Branch[];
  accounts: Account[];
  taxHeads: TaxHead[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const meta = VOUCHER_META[voucherType];
  const isCash = voucherType === 'CRV' || voucherType === 'CPV';
  const isBank = voucherType === 'BRV' || voucherType === 'BPV';
  const isPayment = voucherType === 'CPV' || voucherType === 'BPV';

  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState<number | null>(null);
  const [cashAccountCode, setCashAccountCode] = useState('');
  const [bankAccountCode, setBankAccountCode] = useState('');
  const [paymentType, setPaymentType] = useState<'CHEQUE' | 'ONLINE'>('CHEQUE');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeDate, setChequeDate] = useState(new Date().toISOString().slice(0, 10));
  const [chequeBankName, setChequeBankName] = useState('');
  const [counterAccountCode, setCounterAccountCode] = useState('');
  const [grossAmount, setGrossAmount] = useState('0');
  const [taxHeadId, setTaxHeadId] = useState<number | null>(null);
  const [taxPercentage, setTaxPercentage] = useState('0');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<VoucherLineInput[]>([
    { accountCode: '', debit: 0, credit: 0, narration: '' },
    { accountCode: '', debit: 0, credit: 0, narration: '' },
  ]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Compute tax/net live
  const gross = parseFloat(grossAmount) || 0;
  const taxPct = taxHeadId ? (parseFloat(taxPercentage) || 0) : 0;
  const taxAmount = gross * (taxPct / 100);
  const netAmount = gross - taxAmount;

  const postingAccts = flattenAccounts(accounts).filter((a) => !a.isGroup);
  const cashAccts = postingAccts.filter((a) => a.isCash);
  const bankAccts = postingAccts.filter((a) => a.isBank);
  const counterAccts = postingAccts;
  const allAccts = postingAccts;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!branchId) { setError('Branch is required.'); return; }
    if (!docDate) { setError('Date is required.'); return; }

    const body: any = {
      voucherType,
      docDate,
      branchId,
      reference: reference || null,
      narration: narration || null,
    };

    if (voucherType === 'JV') {
      const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
      const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        setError(`Voucher is not balanced. Debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}.`);
        return;
      }
      body.lines = lines.map((l) => ({
        accountCode: l.accountCode,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        narration: l.narration || null,
      })).filter((l) => l.accountCode);
    } else {
      if (isCash && !cashAccountCode) { setError('A cash account is required.'); return; }
      if (isBank && !bankAccountCode) { setError('A bank account is required.'); return; }
      if (!counterAccountCode) { setError('Counter account is required.'); return; }
      if (gross <= 0) { setError('Gross amount must be greater than zero.'); return; }
      if (isBank && paymentType === 'CHEQUE' && !chequeNo) { setError('Cheque number is required.'); return; }
      body.cashAccountCode = isCash ? cashAccountCode : null;
      body.bankAccountCode = isBank ? bankAccountCode : null;
      body.paymentType = isBank ? paymentType : null;
      body.chequeNo = isBank && paymentType === 'CHEQUE' ? chequeNo : null;
      body.chequeDate = isBank && paymentType === 'CHEQUE' ? chequeDate : null;
      body.chequeBankName = isBank && paymentType === 'CHEQUE' ? chequeBankName : null;
      body.counterAccountCode = counterAccountCode;
      body.grossAmount = gross;
      body.taxHeadId = taxHeadId;
      body.taxPercentage = taxHeadId ? taxPct : null;
    }

    setBusy(true);
    try {
      await api.post('/api/vouchers', body);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <form className="panel" style={{ width: 760, maxWidth: '95vw', maxHeight: '95vh', overflowY: 'auto' }} onSubmit={submit}>
        <div className="panel-head">{meta.title}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Date <span className="req">*</span></label>
              <input className="field-input" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Branch <span className="req">*</span></label>
              <select className="field-select" value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {flattenBranches(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name} ({b.shortName})</option>)}
              </select>
            </div>
            {isCash && (
              <div className="field">
                <label className="field-label">Cash account <span className="req">*</span></label>
                <select className="field-select" value={cashAccountCode} onChange={(e) => setCashAccountCode(e.target.value)}>
                  <option value="">—</option>
                  {cashAccts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </div>
            )}
            {isBank && (
              <>
                <div className="field">
                  <label className="field-label">Bank account <span className="req">*</span></label>
                  <select className="field-select" value={bankAccountCode} onChange={(e) => setBankAccountCode(e.target.value)}>
                    <option value="">—</option>
                    {bankAccts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Payment type</label>
                  <select className="field-select" value={paymentType} onChange={(e) => setPaymentType(e.target.value as 'CHEQUE' | 'ONLINE')}>
                    <option value="CHEQUE">Cheque</option>
                    <option value="ONLINE">Online / Transfer</option>
                  </select>
                </div>
                {paymentType === 'CHEQUE' && (
                  <>
                    <div className="field">
                      <label className="field-label">Cheque number <span className="req">*</span></label>
                      <input className="field-input" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
                    </div>
                    <div className="field">
                      <label className="field-label">Cheque date</label>
                      <input className="field-input" type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
                    </div>
                    <div className="field full">
                      <label className="field-label">Bank name (cheque)</label>
                      <input className="field-input" value={chequeBankName} onChange={(e) => setChequeBankName(e.target.value)} />
                    </div>
                  </>
                )}
              </>
            )}
            {voucherType !== 'JV' && (
              <>
                <div className="field">
                  <label className="field-label">{isPayment ? 'Counter account (Dr)' : 'Counter account (Cr)'} <span className="req">*</span></label>
                  <select className="field-select" value={counterAccountCode} onChange={(e) => setCounterAccountCode(e.target.value)}>
                    <option value="">—</option>
                    {counterAccts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Gross amount <span className="req">*</span></label>
                  <input className="field-input" type="number" step="0.01" value={grossAmount} onChange={(e) => setGrossAmount(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Tax head (optional)</label>
                  <select className="field-select" value={taxHeadId ?? ''} onChange={(e) => { const id = Number(e.target.value) || null; setTaxHeadId(id); if (id) { const t = taxHeads.find((x) => x.id === id); setTaxPercentage(String(t?.percentage || 0)); } }}>
                    <option value="">— None —</option>
                    {taxHeads.map((t) => <option key={t.id} value={t.id}>{t.displayId} — {t.name} ({t.percentage}%)</option>)}
                  </select>
                </div>
                {taxHeadId && (
                  <div className="field">
                    <label className="field-label">Tax % (editable)</label>
                    <input className="field-input" type="number" step="0.0001" value={taxPercentage} onChange={(e) => setTaxPercentage(e.target.value)} />
                  </div>
                )}
                {taxHeadId && (
                  <div className="field full">
                    <div className="field-hint">
                      Tax: <strong className="num">{taxAmount.toFixed(2)}</strong> &nbsp;
                      Net {isPayment ? 'cash/bank' : 'cash/bank'} amount: <strong className="num">{netAmount.toFixed(2)}</strong>
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="field full">
              <label className="field-label">Reference</label>
              <input className="field-input" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="field full">
              <label className="field-label">Narration</label>
              <textarea className="field-textarea" value={narration} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>

          {voucherType === 'JV' && (
            <div style={{ marginTop: 16 }}>
              <h4>Lines</h4>
              <table className="data-table">
                <thead>
                  <tr><th>#</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th><th>Narration</th><th></th></tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="num">{idx + 1}</td>
                      <td>
                        <select value={l.accountCode} onChange={(e) => setLines((prev) => prev.map((p, i) => i === idx ? { ...p, accountCode: e.target.value } : p))} style={{ width: '100%' }}>
                          <option value="">—</option>
                          {allAccts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                        </select>
                      </td>
                      <td><input type="number" step="0.01" value={l.debit} onChange={(e) => setLines((prev) => prev.map((p, i) => i === idx ? { ...p, debit: Number(e.target.value) || 0 } : p))} style={{ width: 100, textAlign: 'right' }} /></td>
                      <td><input type="number" step="0.01" value={l.credit} onChange={(e) => setLines((prev) => prev.map((p, i) => i === idx ? { ...p, credit: Number(e.target.value) || 0 } : p))} style={{ width: 100, textAlign: 'right' }} /></td>
                      <td><input value={l.narration || ''} onChange={(e) => setLines((prev) => prev.map((p, i) => i === idx ? { ...p, narration: e.target.value } : p))} style={{ width: '100%' }} /></td>
                      <td>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'right' }}>Totals:</td>
                    <td className="num">{lines.reduce((s, l) => s + (Number(l.debit) || 0), 0).toFixed(2)}</td>
                    <td className="num">{lines.reduce((s, l) => s + (Number(l.credit) || 0), 0).toFixed(2)}</td>
                    <td colSpan={2} className="num">
                      Diff: {(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0) - lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <button type="button" className="btn btn-sm" onClick={() => setLines((prev) => [...prev, { accountCode: '', debit: 0, credit: 0, narration: '' }])}>Add line</button>
            </div>
          )}

          {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderBottom: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save voucher</button>
        </div>
      </form>
    </div>
  );
}

function flattenAccounts(nodes: Account[]): Account[] {
  const out: Account[] = [];
  const walk = (nodes: Account[]) => { for (const n of nodes) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}
function flattenBranches(nodes: Branch[]): Branch[] {
  const out: Branch[] = [];
  const walk = (nodes: Branch[]) => { for (const n of nodes) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}
function formatDate(d: string): string {
  if (!d) return '';
  const date = new Date(d);
  return `${String(date.getUTCDate()).padStart(2, '0')}-${date.toLocaleString('en-US', { month: 'short' })}-${date.getUTCFullYear()}`;
}
