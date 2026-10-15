import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface UserRow {
  id: number;
  displayId: string;
  username: string;
  fullName: string;
  isAdmin: boolean;
  isActive: boolean;
  forceChangePw: boolean;
  allowedBranchesCsv: string | null;
  allowedStoresCsv: string | null;
}

export default function Users() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.get<UserRow[]>('/api/users')); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load users.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onDelete = async (u: UserRow) => {
    if (!confirm(`Delete user ${u.username} — ${u.fullName}?`)) return;
    try { await api.del(`/api/users/${u.id}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Users</div>
          <div className="page-subtitle">Admin-only area. The last admin cannot be deleted or demoted.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>New user</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="data-table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">ID</th>
                <th>Username</th>
                <th>Full name</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="empty-state">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="empty-state">No users yet.</td></tr>
              ) : rows.map((u) => (
                <tr key={u.id}>
                  <td className="num">{u.displayId}</td>
                  <td>{u.username}</td>
                  <td>{u.fullName}</td>
                  <td>{u.isAdmin ? <span className="badge badge-muted">Admin</span> : <span className="badge badge-muted">User</span>}</td>
                  <td>{u.isActive ? (u.forceChangePw ? <span className="badge badge-warn">Active (pw reset pending)</span> : <span className="badge badge-success">Active</span>) : <span className="badge badge-muted">Inactive</span>}</td>
                  <td className="text-right">
                    <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(u); setShowForm(true); }}>Edit</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => onDelete(u)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <UserForm existing={editing} onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />
      )}
    </div>
  );
}

function UserForm({ existing, onClose, onSaved }: { existing: UserRow | null; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(existing?.username || '');
  const [fullName, setFullName] = useState(existing?.fullName || '');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(existing?.isAdmin ?? false);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [allowedBranchesCsv, setAllowedBranchesCsv] = useState(existing?.allowedBranchesCsv || '');
  const [allowedStoresCsv, setAllowedStoresCsv] = useState(existing?.allowedStoresCsv || '');
  const [resetPassword, setResetPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username || !fullName) { setError('Username and full name are required.'); return; }
    if (!existing && (!password || password.length < 8)) { setError('Password must be at least 8 characters.'); return; }
    if (resetPassword && resetPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }

    setBusy(true);
    try {
      const payload: any = {
        username, fullName, isAdmin, isActive,
        allowedBranchesCsv: allowedBranchesCsv || null,
        allowedStoresCsv: allowedStoresCsv || null,
      };
      if (existing) {
        if (resetPassword) payload.resetPassword = resetPassword;
        await api.put(`/api/users/${existing.id}`, payload);
      } else {
        payload.password = password;
        await api.post('/api/users', payload);
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <form className="panel" style={{ width: 540, maxWidth: '95vw' }} onSubmit={submit}>
        <div className="panel-head">{existing ? `Edit user ${existing.displayId}` : 'New user'}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Username <span className="req">*</span></label>
              <input className="field-input" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!!existing} />
              {existing ? <div className="field-hint">Username cannot be changed after creation.</div> : null}
            </div>
            <div className="field">
              <label className="field-label">Full name <span className="req">*</span></label>
              <input className="field-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            {!existing && (
              <div className="field full">
                <label className="field-label">Password <span className="req">*</span></label>
                <input className="field-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                <div className="field-hint">At least 8 characters.</div>
              </div>
            )}
            {existing && (
              <div className="field full">
                <label className="field-label">Reset password</label>
                <input className="field-input" type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="Leave blank to keep current" autoComplete="new-password" />
                <div className="field-hint">User must change this password at next sign-in.</div>
              </div>
            )}
            <div className="field">
              <label className="field-label">Role</label>
              <select className="field-select" value={isAdmin ? 'ADMIN' : 'USER'} onChange={(e) => setIsAdmin(e.target.value === 'ADMIN')}>
                <option value="USER">Normal user</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">Status</label>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span>Active</span>
              </label>
            </div>
            <div className="field">
              <label className="field-label">Allowed branches (CSV)</label>
              <input className="field-input" value={allowedBranchesCsv} onChange={(e) => setAllowedBranchesCsv(e.target.value)} placeholder="e.g. 1,2,3 — blank = all" />
            </div>
            <div className="field">
              <label className="field-label">Allowed stores (CSV)</label>
              <input className="field-input" value={allowedStoresCsv} onChange={(e) => setAllowedStoresCsv(e.target.value)} placeholder="e.g. 1,2,3 — blank = all" />
            </div>
          </div>
          {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderBottom: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create user'}</button>
        </div>
      </form>
    </div>
  );
}
