import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Account, Branch } from '../api/types';

interface OpeningRow {
  account_code: string; account_name: string; nature: string; party_type: string;
  debit: number; credit: number; fy_start_date: string;
  bill_no: string | null;
}

export default function OpeningTrialBalance() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [rows, setRows] = useState<OpeningRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Record<string, { debit: string; credit: string }>>({});

  useEffect(() => {
    Promise.all([api.get<Branch[]>('/api/branches'), api.get<Account[]>('/api/accounts')])
      .then(([b, a]) => { setBranches(b); setAccounts(a); }).catch(() => {});
  }, []);

  const load = async () => {
    if (!branchId) { setError('Pick a branch first.'); return; }
    setLoading(true); setError(''); setRows([]);
    try {
      const r = await api.get<OpeningRow[]>(`/api/finance/opening-trial-balance/${branchId}`);
      setRows(r);
      // Build editable grid from all posting accounts
      const edit: Record<string, { debit: string; credit: string }> = {};
      const flat = flatten(accounts).filter((a) => !a.isGroup);
      for (const a of flat) {
        const row = r.find((x) => x.account_code === a.code);
        edit[a.code] = {
          debit: row ? String(row.debit) : '',
          credit: row ? String(row.credit) : '',
        };
      }
      setEditing(edit);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed.'); }
    finally { setLoading(false); }
  };

  const totalDebit = Object.values(editing).reduce((s, x) => s + (Number(x.debit) || 0), 0);
  const totalCredit = Object.values(editing).reduce((s, x) => s + (Number(x.credit) || 0), 0);

  const save = async () => {
    setError('');
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      setError(`Out of balance. Debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}.`);
      return;
    }
    try {
      const lines = Object.entries(editing)
        .map(([code, x]) => ({ accountCode: code, debit: Number(x.debit) || 0, credit: Number(x.credit) || 0 }))
        .filter((l) => l.debit !== 0 || l.credit !== 0);
      await api.post('/api/finance/opening-trial-balance', { branchId, lines });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Opening Trial Balance</div><div className="page-subtitle">Choose a branch. Debit total must equal credit total.</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Branch <span className="req">*</span></label>
              <select className="field-select" value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {flattenB(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="text-muted">Debit total: <strong className="num">{totalDebit.toFixed(2)}</strong> · Credit total: <strong className="num">{totalCredit.toFixed(2)}</strong> · Difference: <strong className="num">{(totalDebit - totalCredit).toFixed(2)}</strong></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={load} disabled={loading || !branchId}>Load</button>
              <button className="btn btn-primary" onClick={save} disabled={loading || !branchId}>Save</button>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="data-table-wrap">
        <div className="table-scroll" style={{ maxHeight: 'calc(100vh - 380px)' }}>
          <table className="data-table">
            <thead><tr><th>Code</th><th>Name</th><th>Nature</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>
              {Object.keys(editing).length === 0 ? (
                <tr><td colSpan={5} className="empty-state">Pick a branch and click Load to view the editable grid.</td></tr>
              ) : (
                flatten(accounts).filter((a) => !a.isGroup).map((a) => (
                  <tr key={a.code}>
                    <td className="num">{a.code}</td>
                    <td>{a.name}</td>
                    <td>{a.nature}</td>
                    <td><input type="number" step="0.01" value={editing[a.code]?.debit || ''} onChange={(e) => setEditing((p) => ({ ...p, [a.code]: { debit: e.target.value, credit: p[a.code]?.credit || '' } }))} style={{ width: 120, textAlign: 'right' }} /></td>
                    <td><input type="number" step="0.01" value={editing[a.code]?.credit || ''} onChange={(e) => setEditing((p) => ({ ...p, [a.code]: { debit: p[a.code]?.debit || '', credit: e.target.value } }))} style={{ width: 120, textAlign: 'right' }} /></td>
                  </tr>
                ))
              )}
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
function flattenB(nodes: Branch[]): Branch[] {
  const out: Branch[] = []; const walk = (ns: Branch[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out;
}
