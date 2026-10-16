import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Account } from '../api/types';

interface ReconLine {
  id: number; entry_date: string; voucher_no: string | null;
  ref_doc_type: string | null; debit: number; credit: number;
  narration: string | null; is_reconciled: boolean; reconcile_date: string | null;
}

interface ReconData {
  lines: ReconLine[];
  reconciledBalance: number;
  ledgerBalance: number;
}

export default function BankReconciliation() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankAccountCode, setBankAccountCode] = useState('');
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [closingBalance, setClosingBalance] = useState('0');
  const [data, setData] = useState<ReconData | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get<Account[]>('/api/accounts').then(setAccounts).catch(() => {}); }, []);

  const load = async () => {
    if (!bankAccountCode) { setError('Pick a bank account first.'); return; }
    if (!statementDate) { setError('Statement date is required.'); return; }
    setLoading(true); setError(''); setData(null); setTicked(new Set());
    try {
      const d = await api.get<ReconData>(`/api/finance/bank-reconciliation?bankAccountCode=${encodeURIComponent(bankAccountCode)}&statementDate=${statementDate}`);
      setData(d);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed.'); }
    finally { setLoading(false); }
  };

  const tickSum = () => {
    if (!data) return 0;
    return data.lines.filter((l) => ticked.has(l.id) || l.is_reconciled).reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
  };

  const reconcileDifference = data ? Number(closingBalance) - tickSum() : 0;

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      await api.post('/api/finance/bank-reconciliation', {
        bankAccountCode, statementDate,
        closingBalance: Number(closingBalance) || 0,
        tickedGlEntryIds: Array.from(ticked),
      });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Bank Reconciliation</div><div className="page-subtitle">Tick lines that appear on the statement; enter the closing balance.</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Bank account <span className="req">*</span></label>
              <select className="field-select" value={bankAccountCode} onChange={(e) => setBankAccountCode(e.target.value)}>
                <option value="">—</option>
                {flatten(accounts).filter((a) => !a.isGroup && a.isBank).map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="field-label">Statement date <span className="req">*</span></label><input className="field-input" type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} /></div>
            <div className="field"><label className="field-label">Closing balance <span className="req">*</span></label><input className="field-input" type="number" step="0.01" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn" onClick={load} disabled={loading}>Load lines</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !data} style={{ marginLeft: 8 }}>Save reconciliation</button>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      {data && (
        <>
          <div className="text-muted" style={{ marginBottom: 8 }}>
            Reconciled balance: <strong className="num">{tickSum().toFixed(2)}</strong> · Statement: <strong className="num">{Number(closingBalance).toFixed(2)}</strong> · Difference: <strong className="num">{reconcileDifference.toFixed(2)}</strong>
          </div>
          <div className="data-table-wrap">
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Tick</th><th>Date</th><th>Voucher</th><th className="num">Debit</th><th className="num">Credit</th><th>Narration</th><th>Status</th></tr></thead>
                <tbody>
                  {data.lines.length === 0 ? <tr><td colSpan={7} className="empty-state">No ledger lines.</td></tr> :
                  data.lines.map((l) => (
                    <tr key={l.id}>
                      <td><input type="checkbox" checked={ticked.has(l.id) || l.is_reconciled} disabled={l.is_reconciled}
                        onChange={(e) => setTicked((prev) => { const n = new Set(prev); e.target.checked ? n.add(l.id) : n.delete(l.id); return n; })} /></td>
                      <td>{l.entry_date}</td><td>{l.voucher_no || l.ref_doc_type || '—'}</td>
                      <td className="num">{Number(l.debit).toFixed(2)}</td><td className="num">{Number(l.credit).toFixed(2)}</td>
                      <td>{l.narration || '—'}</td>
                      <td>{l.is_reconciled ? <span className="badge badge-success">Reconciled</span> : <span className="badge badge-muted">Open</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function flatten(nodes: Account[]): Account[] {
  const out: Account[] = []; const walk = (ns: Account[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out;
}
