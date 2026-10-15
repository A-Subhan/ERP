import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Branch } from '../api/types';

interface StoreNode {
  id: number;
  code: string;
  parentId: number | null;
  level: number;
  name: string;
  storeType: 'GROUP' | 'STOCK';
  isActive: boolean;
  taggedBranches?: number[];
  children?: StoreNode[];
}

export default function Stores() {
  const [tree, setTree] = useState<StoreNode[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StoreNode | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([
        api.get<StoreNode[]>('/api/stores'),
        api.get<Branch[]>('/api/branches'),
      ]);
      setTree(s); setBranches(b);
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load stores.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onAdd = (parent: StoreNode | null) => { setEditing(null); setParentId(parent ? parent.id : null); setShowForm(true); };
  const onEdit = (s: StoreNode) => { setEditing(s); setParentId(s.parentId); setShowForm(true); };
  const onDelete = async (s: StoreNode) => {
    if (!confirm(`Delete store ${s.code} — ${s.name}?`)) return;
    try { await api.del(`/api/stores/${s.id}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };
  const toggle = (id: number) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = (roots: StoreNode[]) => { const n = new Set<number>(); const walk = (nodes: StoreNode[]) => { for (const x of nodes) { if (x.children && x.children.length) { n.add(x.id); walk(x.children); } } }; walk(roots); setCollapsed(n); };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Stores</div>
          <div className="page-subtitle">Tree of stockrooms and groups. A group node cannot hold stock.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => collapseAll(tree)}>Collapse all</button>
          <button className="btn" onClick={expandAll}>Expand all</button>
          <button className="btn btn-primary" onClick={() => onAdd(null)}>New root store</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="panel">
        <div className="panel-body">
          {loading ? <div className="empty-state">Loading…</div> : (
            tree.length === 0 ? <div className="empty-state">No stores yet. Add a root store to begin.</div> :
            <TreeNodes nodes={tree} collapsed={collapsed} onToggle={toggle} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} branches={branches} />
          )}
        </div>
      </div>

      {showForm && (
        <StoreForm
          existing={editing}
          parentId={parentId}
          branches={branches}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load(); }}
        />
      )}
    </div>
  );
}

function TreeNodes({
  nodes, collapsed, onToggle, onAdd, onEdit, onDelete, branches,
}: {
  nodes: StoreNode[]; collapsed: Set<number>;
  onToggle: (id: number) => void;
  onAdd: (p: StoreNode | null) => void;
  onEdit: (s: StoreNode) => void;
  onDelete: (s: StoreNode) => void;
  branches: Branch[];
}) {
  return (
    <ul className="tree">
      {nodes.map((s) => (
        <li className="tree-node" key={s.id}>
          <div className="tree-node-row">
            <span className="tree-code">{s.code}</span>
            <span className="tree-name">{s.name}</span>
            <span className="badge badge-muted">{s.storeType === 'GROUP' ? 'Group' : 'Stock'}</span>
            {s.taggedBranches && s.taggedBranches.length > 0 && (
              <span className="badge badge-muted">{s.taggedBranches.length} branch{s.taggedBranches.length > 1 ? 'es' : ''}</span>
            )}
            {!s.isActive && <span className="badge badge-warn">Inactive</span>}
            <span className="tree-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => onAdd(s)}>Add child</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onEdit(s)}>Edit</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onDelete(s)}>Delete</button>
              {s.children && s.children.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={() => onToggle(s.id)}>
                  {collapsed.has(s.id) ? '+' : '−'}
                </button>
              )}
            </span>
          </div>
          {s.children && s.children.length > 0 && !collapsed.has(s.id) && (
            <ul className="tree-children">
              <TreeNodes nodes={s.children} collapsed={collapsed} onToggle={onToggle} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} branches={branches} />
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function StoreForm({
  existing, parentId, branches, onClose, onSaved,
}: {
  existing: StoreNode | null;
  parentId: number | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [storeType, setStoreType] = useState<'GROUP' | 'STOCK'>(existing?.storeType || 'STOCK');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [taggedBranches, setTaggedBranches] = useState<number[]>(existing?.taggedBranches || []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name) { setError('Name is required.'); return; }
    setBusy(true);
    try {
      if (existing) {
        await api.put(`/api/stores/${existing.id}`, { name, storeType, isActive, taggedBranches });
      } else {
        await api.post('/api/stores', { parentId, name, storeType, taggedBranches });
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form className="panel" style={{ width: 540, maxWidth: '95vw' }} onSubmit={submit}>
        <div className="panel-head">{existing ? 'Edit store' : 'New store'}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Name <span className="req">*</span></label>
              <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Type</label>
              <select className="field-select" value={storeType} onChange={(e) => setStoreType(e.target.value as 'GROUP' | 'STOCK')}>
                <option value="STOCK">Stock-holding</option>
                <option value="GROUP">Group (cannot hold stock)</option>
              </select>
            </div>
            <div className="field full">
              <label className="field-label">Tagged branches</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 120, overflowY: 'auto', border: '1px solid var(--c-border)', padding: 8, borderRadius: 4 }}>
                {branches.map((b) => (
                  <label key={b.id} className="row" style={{ gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={taggedBranches.includes(b.id)}
                      onChange={(e) => setTaggedBranches((prev) => e.target.checked ? [...prev, b.id] : prev.filter((id) => id !== b.id))}
                    />
                    <span>{b.code} — {b.name}</span>
                  </label>
                ))}
              </div>
              <div className="field-hint">A transaction on a branch may only use stores tagged to that branch.</div>
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
          <button type="submit" className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create store'}</button>
        </div>
      </form>
    </div>
  );
}
