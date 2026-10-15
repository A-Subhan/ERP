import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Branch } from '../api/types';

interface TreeNode extends Branch { expanded?: boolean; }

export default function Branches() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try { setTree(await api.get<Branch[]>('/api/branches')); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load branches.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const onAdd = (parent: Branch | null) => {
    setEditing(null);
    setParentId(parent ? parent.id : null);
    setShowForm(true);
  };
  const onEdit = (b: Branch) => {
    setEditing(b);
    setParentId(b.parentId);
    setShowForm(true);
  };
  const onDelete = async (b: Branch) => {
    if (!confirm(`Delete branch ${b.code} — ${b.name}? This cannot be undone.`)) return;
    try { await api.del(`/api/branches/${b.id}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Branches</div>
          <div className="page-subtitle">Tree of branches; codes are derived from your level digit settings.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => onAdd(null)}>New root branch</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="panel">
        <div className="panel-body">
          {loading ? <div className="empty-state">Loading…</div> : (
            tree.length === 0
              ? <div className="empty-state">No branches yet. Add a root branch to begin.</div>
              : <BranchTreeNodes nodes={tree} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
          )}
        </div>
      </div>

      {showForm && (
        <BranchForm
          existing={editing}
          parentId={parentId}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load(); }}
        />
      )}
    </div>
  );
}

function BranchTreeNodes({
  nodes, onAdd, onEdit, onDelete,
}: {
  nodes: TreeNode[];
  onAdd: (b: Branch | null) => void;
  onEdit: (b: Branch) => void;
  onDelete: (b: Branch) => void;
}) {
  return (
    <ul className="tree">
      {nodes.map((b) => (
        <li className="tree-node" key={b.id}>
          <div className="tree-node-row">
            <span className="tree-code">{b.code}</span>
            <span className="tree-name">{b.name}</span>
            <span className="badge badge-muted">{b.shortName}</span>
            {b.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-warn">Inactive</span>}
            <span className="tree-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => onAdd(b)}>Add child</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onEdit(b)}>Edit</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onDelete(b)}>Delete</button>
            </span>
          </div>
          {b.children && b.children.length > 0 && (
            <ul className="tree-children">
              <BranchTreeNodes nodes={b.children} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function BranchForm({
  existing, parentId, onClose, onSaved,
}: {
  existing: Branch | null;
  parentId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [shortName, setShortName] = useState(existing?.shortName || '');
  const [address, setAddress] = useState(existing?.address || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name || !shortName) { setError('Name and short name are required.'); return; }
    if (!/^[A-Za-z0-9_-]+$/.test(shortName)) { setError('Short name may only contain letters, numbers, underscore, hyphen.'); return; }
    setBusy(true);
    try {
      if (existing) {
        await api.put(`/api/branches/${existing.id}`, { name, shortName, address, phone, email, isActive });
      } else {
        await api.post('/api/branches', { parentId, name, shortName, address, phone, email });
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form className="panel" style={{ width: 540, maxWidth: '95vw' }} onSubmit={submit}>
        <div className="panel-head">{existing ? 'Edit branch' : 'New branch'}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Name <span className="req">*</span></label>
              <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Short name <span className="req">*</span></label>
              <input className="field-input" value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={20} />
              <div className="field-hint">Used in voucher numbers.</div>
            </div>
            <div className="field full">
              <label className="field-label">Address</label>
              <input className="field-input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Phone</label>
              <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Email</label>
              <input className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {existing && (
              <div className="field">
                <label className="field-label">Status</label>
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
          <button type="submit" className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create branch'}</button>
        </div>
      </form>
    </div>
  );
}
