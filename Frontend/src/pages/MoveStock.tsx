import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Branch, Store, ProductNode } from '../api/types';

interface MoveRow {
  id: number; doc_no: string; doc_date: string;
  branch_short: string; from_store_code: string; from_store_name: string;
  to_store_code: string; to_store_name: string; reference: string | null; created_at: string;
}

export default function MoveStock() {
  const [rows, setRows] = useState<MoveRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [filterBranch, setFilterBranch] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const q = filterBranch ? `?branchId=${filterBranch}` : '';
      setRows(await api.get<MoveRow[]>(`/api/inventory/move-stock${q}`));
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    Promise.all([api.get<Branch[]>('/api/branches'), api.get<Store[]>('/api/stores'), api.get<ProductNode[]>('/api/products')])
      .then(([b, s, p]) => { setBranches(b); setStores(s); setProducts(p); }).catch(() => {});
    load();
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Move Stock</div><div className="page-subtitle">Transfer between two stores in the same branch. No GL effect; carries source average.</div></div>
        <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowForm(true)}>New move</button></div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="data-table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Doc no</th><th>Date</th><th>Branch</th><th>From</th><th>To</th><th>Reference</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="empty-state">Loading…</td></tr> :
               rows.length === 0 ? <tr><td colSpan={6} className="empty-state">No moves stock documents yet.</td></tr> :
               rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.doc_no}</td><td>{r.doc_date}</td><td>{r.branch_short}</td>
                  <td>{r.from_store_code} — {r.from_store_name}</td>
                  <td>{r.to_store_code} — {r.to_store_name}</td>
                  <td>{r.reference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <MoveForm branches={branches} stores={stores} products={products} onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />}
    </div>
  );
}

function MoveForm({ branches, stores, products, onClose, onSaved }: {
  branches: Branch[]; stores: Store[]; products: ProductNode[];
  onClose: () => void; onSaved: () => void;
}) {
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState<number | null>(null);
  const [fromStoreId, setFromStoreId] = useState<number | null>(null);
  const [toStoreId, setToStoreId] = useState<number | null>(null);
  const [lines, setLines] = useState<{ productId: number | null; quantity: string }[]>([{ productId: null, quantity: '0' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const flatProducts = flattenProducts(products);
  const stockStores = flattenStores(stores).filter((s) => s.storeType === 'STOCK');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!branchId) { setError('Branch is required.'); return; }
    if (!fromStoreId || !toStoreId) { setError('Both source and target stores are required.'); return; }
    if (fromStoreId === toStoreId) { setError('Source and target stores must be different.'); return; }
    if (!lines.length) { setError('At least one line is required.'); return; }
    setBusy(true);
    try {
      await api.post('/api/inventory/move-stock', {
        docDate, branchId, fromStoreId, toStoreId,
        lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) || 0 })).filter((l) => l.productId),
      });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <form className="panel" style={{ width: 720, maxWidth: '95vw', maxHeight: '95vh', overflowY: 'auto' }} onSubmit={submit}>
        <div className="panel-head">New move stock</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field"><label className="field-label">Date <span className="req">*</span></label><input className="field-input" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
            <div className="field"><label className="field-label">Branch <span className="req">*</span></label>
              <select className="field-select" value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {flattenBranches(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="field-label">From store <span className="req">*</span></label>
              <select className="field-select" value={fromStoreId ?? ''} onChange={(e) => setFromStoreId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {stockStores.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="field-label">To store <span className="req">*</span></label>
              <select className="field-select" value={toStoreId ?? ''} onChange={(e) => setToStoreId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {stockStores.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
          </div>
          <h4 style={{ marginTop: 16 }}>Lines</h4>
          <table className="data-table">
            <thead><tr><th>#</th><th>Product</th><th className="num">Qty</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="num">{idx + 1}</td>
                  <td>
                    <select value={l.productId ?? ''} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, productId: Number(e.target.value) || null } : x))} style={{ width: '100%' }}>
                      <option value="">—</option>
                      {flatProducts.filter((p) => !p.isGroup).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    </select>
                  </td>
                  <td><input type="number" step="0.0001" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} style={{ width: 100, textAlign: 'right' }} /></td>
                  <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm" onClick={() => setLines((p) => [...p, { productId: null, quantity: '0' }])}>Add line</button>

          {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderBottom: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
    </div>
  );
}

function flattenBranches(nodes: Branch[]): Branch[] { const out: Branch[] = []; const walk = (ns: Branch[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out; }
function flattenStores(nodes: Store[]): Store[] { const out: Store[] = []; const walk = (ns: Store[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out; }
function flattenProducts(nodes: ProductNode[]): ProductNode[] { const out: ProductNode[] = []; const walk = (ns: ProductNode[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out; }
