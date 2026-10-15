import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Unit } from '../api/types';

export default function Units() {
  const [rows, setRows] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.get<Unit[]>('/api/units')); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load units.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onEdit = (u: Unit) => { setEditing(u); setShowForm(true); };
  const onDelete = async (u: Unit) => {
    if (!confirm(`Delete unit ${u.code} — ${u.name}?`)) return;
    try { await api.del(`/api/units/${u.id}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Units</div>
          <div className="page-subtitle">Units of measure used by products.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>New unit</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="data-table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">ID</th>
                <th>Code</th>
                <th>Name</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="empty-state">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="empty-state">No units yet. Add one to begin.</td></tr>
              ) : rows.map((u) => (
                <tr key={u.id}>
                  <td className="num">{u.displayId}</td>
                  <td>{u.code}</td>
                  <td>{u.name}</td>
                  <td>{u.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-muted">Inactive</span>}</td>
                  <td className="text-right">
                    <button className="btn btn-sm btn-ghost" onClick={() => onEdit(u)}>Edit</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => onDelete(u)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <UnitForm existing={editing} onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />
      )}
    </div>
  );
}

function UnitForm({ existing, onClose, onSaved }: { existing: Unit | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(existing?.code || '');
  const [name, setName] = useState(existing?.name || '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!code || !name) { setError('Code and name are required.'); return; }
    if (!/^[A-Za-z0-9_-]+$/.test(code)) { setError('Code may only contain letters, numbers, underscore, hyphen.'); return; }
    setBusy(true);
    try {
      if (existing) await api.put(`/api/units/${existing.id}`, { code, name, isActive });
      else await api.post('/api/units', { code, name });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form className="panel" style={{ width: 420, maxWidth: '95vw' }} onSubmit={submit}>
        <div className="panel-head">{existing ? 'Edit unit' : 'New unit'}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Code <span className="req">*</span></label>
              <input className="field-input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Name <span className="req">*</span></label>
              <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {existing && (
              <div className="field full">
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
          <button type="submit" className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create unit'}</button>
        </div>
      </form>
    </div>
  );
}
