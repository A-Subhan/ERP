import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Account } from '../api/types';

interface TaxHead {
  id: number; displayId: string; name: string; accountCode: string;
  percentage: number; isActive: boolean;
}

export default function TaxHeads() {
  const [rows, setRows] = useState<TaxHead[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaxHead | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [t, a] = await Promise.all([
        api.get<TaxHead[]>('/api/tax-heads'),
        api.get<Account[]>('/api/accounts'),
      ]);
      setRows(t); setAccounts(a); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onDelete = async (t: TaxHead) => {
    if (!confirm(`Delete tax head ${t.displayId} — ${t.name}?`)) return;
    try { await api.del(`/api/tax-heads/${t.id}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };

  const postingAccts = flattenAccounts(accounts).filter((a) => !a.isGroup && (a.nature === 'ASSET' || a.nature === 'LIABILITY'));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Tax Heads</div>
          <div className="page-subtitle">Reusable tax definitions linked to a posting account.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>New tax head</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="data-table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th className="num">ID</th><th>Name</th><th>Account</th><th className="num">%</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="empty-state">Loading…</td></tr> :
               rows.length === 0 ? <tr><td colSpan={6} className="empty-state">No tax heads yet.</td></tr> :
               rows.map((t) => (
                <tr key={t.id}>
                  <td className="num">{t.displayId}</td>
                  <td>{t.name}</td>
                  <td className="num">{t.accountCode}</td>
                  <td className="num">{t.percentage.toFixed(4)}</td>
                  <td>{t.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-muted">Inactive</span>}</td>
                  <td className="text-right">
                    <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(t); setShowForm(true); }}>Edit</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => onDelete(t)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <TaxHeadForm existing={editing} accounts={postingAccts} onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />
      )}
    </div>
  );
}

function flattenAccounts(nodes: Account[]): Account[] {
  const out: Account[] = [];
  const walk = (nodes: Account[]) => { for (const n of nodes) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}

function TaxHeadForm({
  existing, accounts, onClose, onSaved,
}: {
  existing: TaxHead | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [accountCode, setAccountCode] = useState(existing?.accountCode || '');
  const [percentage, setPercentage] = useState(String(existing?.percentage ?? ''));
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name) { setError('Name is required.'); return; }
    if (!accountCode) { setError('Account is required.'); return; }
    if (!percentage) { setError('Percentage is required.'); return; }
    setBusy(true);
    try {
      const body = { name, accountCode, percentage: parseFloat(percentage), isActive };
      if (existing) await api.put(`/api/tax-heads/${existing.id}`, body);
      else await api.post('/api/tax-heads', body);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form className="panel" style={{ width: 420, maxWidth: '95vw' }} onSubmit={submit}>
        <div className="panel-head">{existing ? 'Edit tax head' : 'New tax head'}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field full">
              <label className="field-label">Name <span className="req">*</span></label>
              <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field full">
              <label className="field-label">Linked account (Asset / Liability) <span className="req">*</span></label>
              <select className="field-select" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Percentage <span className="req">*</span></label>
              <input className="field-input" type="number" step="0.0001" value={percentage} onChange={(e) => setPercentage(e.target.value)} />
            </div>
            {existing && (
              <div className="field">
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <span>Active</span>
                </label>
              </div>
            )}
          </div>
          {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderBottom: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create tax head'}</button>
        </div>
      </form>
    </div>
  );
}
