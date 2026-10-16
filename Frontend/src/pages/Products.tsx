import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Unit } from '../api/types';

interface ProductNode {
  id: number; code: string; parentId: number | null; level: number;
  name: string; unitId: number | null; salesTaxPct: number;
  reorderLevel: number; purchasePrice: number; salesPrice: number;
  isGroup: boolean; isActive: boolean;
  children?: ProductNode[];
}

export default function Products() {
  const [tree, setTree] = useState<ProductNode[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProductNode | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const [p, u] = await Promise.all([
        api.get<ProductNode[]>('/api/products'),
        api.get<Unit[]>('/api/units'),
      ]);
      setTree(p); setUnits(u); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load products.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onAdd = (parent: ProductNode | null) => { setEditing(null); setParentId(parent ? parent.id : null); setShowForm(true); };
  const onEdit = (p: ProductNode) => { setEditing(p); setParentId(p.parentId); setShowForm(true); };
  const onDelete = async (p: ProductNode) => {
    if (!confirm(`Delete product ${p.code} — ${p.name}?`)) return;
    try { await api.del(`/api/products/${p.id}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };
  const toggle = (id: number) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = (roots: ProductNode[]) => { const n = new Set<number>(); const walk = (nodes: ProductNode[]) => { for (const x of nodes) { if (x.children && x.children.length) { n.add(x.id); walk(x.children); } } }; walk(roots); setCollapsed(n); };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Products</div>
          <div className="page-subtitle">Tree of product groups and items. Items require a unit.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => collapseAll(tree)}>Collapse all</button>
          <button className="btn" onClick={expandAll}>Expand all</button>
          <button className="btn btn-primary" onClick={() => onAdd(null)}>New root product</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="panel">
        <div className="panel-body">
          {loading ? <div className="empty-state">Loading…</div> : (
            tree.length === 0 ? <div className="empty-state">No products yet.</div> :
            <TreeNodes nodes={tree} collapsed={collapsed} onToggle={toggle} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} units={units} />
          )}
        </div>
      </div>

      {showForm && (
        <ProductForm existing={editing} parentId={parentId} units={units} onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />
      )}
    </div>
  );
}

function TreeNodes({
  nodes, collapsed, onToggle, onAdd, onEdit, onDelete, units,
}: {
  nodes: ProductNode[]; collapsed: Set<number>;
  onToggle: (id: number) => void;
  onAdd: (p: ProductNode | null) => void;
  onEdit: (p: ProductNode) => void;
  onDelete: (p: ProductNode) => void;
  units: Unit[];
}) {
  const unitName = (id: number | null) => units.find((u) => u.id === id)?.code || '—';
  return (
    <ul className="tree">
      {nodes.map((p) => (
        <li className="tree-node" key={p.id}>
          <div className="tree-node-row">
            <span className="tree-code">{p.code}</span>
            <span className="tree-name">{p.name}</span>
            {p.isGroup ? <span className="badge badge-muted">Group</span> : <span className="badge badge-success">Item ({unitName(p.unitId)})</span>}
            {!p.isGroup && <span className="badge badge-muted">Tax {p.salesTaxPct}%</span>}
            {!p.isGroup && <span className="badge badge-muted">Reorder {p.reorderLevel}</span>}
            {!p.isActive && <span className="badge badge-warn">Inactive</span>}
            <span className="tree-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => onAdd(p)}>Add child</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onEdit(p)}>Edit</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onDelete(p)}>Delete</button>
              {p.children && p.children.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={() => onToggle(p.id)}>
                  {collapsed.has(p.id) ? '+' : '−'}
                </button>
              )}
            </span>
          </div>
          {p.children && p.children.length > 0 && !collapsed.has(p.id) && (
            <ul className="tree-children">
              <TreeNodes nodes={p.children} collapsed={collapsed} onToggle={onToggle} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} units={units} />
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProductForm({
  existing, parentId, units, onClose, onSaved,
}: {
  existing: ProductNode | null;
  parentId: number | null;
  units: Unit[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [unitId, setUnitId] = useState<number | null>(existing?.unitId || null);
  const [salesTaxPct, setSalesTaxPct] = useState(String(existing?.salesTaxPct ?? 0));
  const [reorderLevel, setReorderLevel] = useState(String(existing?.reorderLevel ?? 0));
  const [purchasePrice, setPurchasePrice] = useState(String(existing?.purchasePrice ?? 0));
  const [salesPrice, setSalesPrice] = useState(String(existing?.salesPrice ?? 0));
  const [isGroup, setIsGroup] = useState(existing?.isGroup ?? false);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name) { setError('Name is required.'); return; }
    if (!isGroup && !unitId) { setError('A unit is required for items.'); return; }

    const payload: any = {
      name, unitId: isGroup ? null : unitId,
      salesTaxPct: parseFloat(salesTaxPct) || 0,
      reorderLevel: parseFloat(reorderLevel) || 0,
      purchasePrice: parseFloat(purchasePrice) || 0,
      salesPrice: parseFloat(salesPrice) || 0,
      isGroup, isActive,
    };
    setBusy(true);
    try {
      if (existing) await api.put(`/api/products/${existing.id}`, payload);
      else await api.post('/api/products', { parentId, ...payload });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <form className="panel" style={{ width: 540, maxWidth: '95vw' }} onSubmit={submit}>
        <div className="panel-head">{existing ? 'Edit product' : 'New product'}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Name <span className="req">*</span></label>
              <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Type</label>
              <select className="field-select" value={isGroup ? 'GROUP' : 'ITEM'} onChange={(e) => setIsGroup(e.target.value === 'GROUP')} disabled={!!existing}>
                <option value="ITEM">Item</option>
                <option value="GROUP">Group</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">Unit</label>
              <select className="field-select" value={unitId ?? ''} onChange={(e) => setUnitId(Number(e.target.value) || null)} disabled={isGroup}>
                <option value="">—</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Sales tax %</label>
              <input className="field-input" type="number" step="0.0001" value={salesTaxPct} onChange={(e) => setSalesTaxPct(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Reorder level</label>
              <input className="field-input" type="number" step="0.0001" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Purchase price</label>
              <input className="field-input" type="number" step="0.0001" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Sales price</label>
              <input className="field-input" type="number" step="0.0001" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} />
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
          <button type="submit" className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create product'}</button>
        </div>
      </form>
    </div>
  );
}
