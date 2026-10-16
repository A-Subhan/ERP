import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Account } from '../api/types';

interface ChequeRow {
  id: number; voucher_no: string; voucher_type: string; doc_date: string;
  branch_short: string; bank_account_code: string; cheque_no: string | null;
  cheque_date: string | null; cheque_bank_name: string | null;
  cheque_status: string | null; cheque_status_date: string | null;
  counter_account_code: string | null; net_amount: number | null;
}

export default function UpdateChequeStatus() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankAccountCode, setBankAccountCode] = useState('');
  const [direction, setDirection] = useState<'RECEIPT' | 'PAYMENT' | ''>('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [rows, setRows] = useState<ChequeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.get<Account[]>('/api/accounts').then(setAccounts).catch(() => {}); }, []);

  const load = async () => {
    setLoading(true); setError(''); setRows([]);
    try {
      const params = new URLSearchParams();
      if (bankAccountCode) params.append('bankAccountCode', bankAccountCode);
      if (direction) params.append('direction', direction);
      if (status) params.append('status', status);
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);
      if (chequeNo) params.append('chequeNo', chequeNo);
      setRows(await api.get<ChequeRow[]>(`/api/finance/cheques?${params.toString()}`));
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed.'); }
    finally { setLoading(false); }
  };

  const changeStatus = async (row: ChequeRow, newStatus: 'CLEARED' | 'BOUNCED' | 'CANCELLED') => {
    const statusDate = prompt(`Set cheque ${row.cheque_no} (${row.voucher_no}) to ${newStatus}. Enter status date (YYYY-MM-DD):`, new Date().toISOString().slice(0, 10));
    if (!statusDate) return;
    try {
      await api.post(`/api/finance/cheques/${row.id}/status`, { newStatus, statusDate });
      await load();
    } catch (err) { alert(err instanceof Error ? err.message : 'Update failed.'); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Update Cheque Status</div><div className="page-subtitle">Cleared, Bounced or Cancelled. Bounced / Cancelled creates an automatic reversing entry.</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field"><label className="field-label">Bank account</label>
              <select className="field-select" value={bankAccountCode} onChange={(e) => setBankAccountCode(e.target.value)}>
                <option value="">All banks</option>
                {flatten(accounts).filter((a) => !a.isGroup && a.isBank).map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="field-label">Direction</label>
              <select className="field-select" value={direction} onChange={(e) => setDirection(e.target.value as any)}>
                <option value="">Both</option>
                <option value="RECEIPT">Receipts</option>
                <option value="PAYMENT">Payments</option>
              </select>
            </div>
            <div className="field"><label className="field-label">Status</label>
              <select className="field-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                <option value="ISSUED">Issued</option>
                <option value="CLEARED">Cleared</option>
                <option value="BOUNCED">Bounced</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div className="field"><label className="field-label">Cheque no (contains)</label><input className="field-input" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></div>
            <div className="field"><label className="field-label">From date</label><input className="field-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
            <div className="field"><label className="field-label">To date</label><input className="field-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={load} disabled={loading}>Search</button>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="data-table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Voucher no</th><th>Date</th><th>Branch</th><th>Bank</th><th>Cheque no</th><th>Status</th><th className="num">Amount</th><th>Action</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={8} className="empty-state">No cheques match.</td></tr> :
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.voucher_no}</td><td>{r.doc_date}</td><td>{r.branch_short}</td>
                  <td className="num">{r.bank_account_code}</td><td>{r.cheque_no}</td>
                  <td>{r.cheque_status ? <span className={`badge ${r.cheque_status === 'CLEARED' ? 'badge-success' : r.cheque_status === 'BOUNCED' || r.cheque_status === 'CANCELLED' ? 'badge-danger' : 'badge-muted'}`}>{r.cheque_status}</span> : '—'}</td>
                  <td className="num">{r.net_amount?.toFixed(2)}</td>
                  <td>
                    {(r.cheque_status === 'ISSUED' || !r.cheque_status) && (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => changeStatus(r, 'CLEARED')}>Mark cleared</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => changeStatus(r, 'BOUNCED')}>Mark bounced</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => changeStatus(r, 'CANCELLED')}>Cancel</button>
                      </>
                    )}
                    {(r.cheque_status === 'BOUNCED' || r.cheque_status === 'CANCELLED') && <span className="text-muted">Final</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function flatten(nodes: Account[]): Account[] {
  const out: Account[] = []; const walk = (ns: Account[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out;
}
