import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Branch, Store, ProductNode } from '../api/types';

interface OpeningStockRow {
  doc_no: string;
  doc_date: string;
  branch_short: string;
  store_code: string;
  store_name: string;
  product_code: string;
  product_name: string;
  quantity: number;
  cost_price: number | null;
  sales_price: number | null;
  wholesale_price: number | null;
  resale_price: number | null;
}

export default function OpeningStock() {
  const [rows, setRows] = useState<OpeningStockRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [filterBranch, setFilterBranch] = useState<number | null>(null);
  const [filterStore, setFilterStore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterBranch) params.append('branchId', String(filterBranch));
      if (filterStore) params.append('storeId', String(filterStore));
      setRows(await api.get<OpeningStockRow[]>(`/api/inventory/opening-stock?${params.toString()}`));
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    Promise.all([
      api.get<Branch[]>('/api/branches'),
      api.get<Store[]>('/api/stores'),
      api.get<ProductNode[]>('/api/products'),
    ]).then(([b, s, p]) => { setBranches(b); setStores(s); setProducts(p); }).catch(() => {});
    load();
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Opening Stock</div><div className="page-subtitle">Sets the starting moving-average cost per product+store. No GL effect.</div></div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>New opening stock</button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Branch</label>
              <select className="field-select" value={filterBranch ?? ''} onChange={(e) => setFilterBranch(Number(e.target.value) || null)}>
                <option value="">All</option>
                {flattenBranches(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Store</label>
              <select className="field-select" value={filterStore ?? ''} onChange={(e) => setFilterStore(Number(e.target.value) || null)}>
                <option value="">All</option>
                {flattenStores(stores).filter((s) => s.storeType === 'STOCK').map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={load} disabled={loading}>Apply filters</button>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="data-table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Doc no</th><th>Date</th><th>Branch</th><th>Store</th><th>Product</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Sales</th><th className="num">Wholesale</th><th className="num">Resale</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={10} className="empty-state">Loading…</td></tr> :
               rows.length === 0 ? <tr><td colSpan={10} className="empty-state">No opening stock yet.</td></tr> :
               rows.map((r) => (
                <tr key={r.doc_no}>
                  <td>{r.doc_no}</td><td>{r.doc_date}</td><td>{r.branch_short}</td><td>{r.store_code} — {r.store_name}</td>
                  <td>{r.product_code} — {r.product_name}</td>
                  <td className="num">{Number(r.quantity).toFixed(2)}</td>
                  <td className="num">{r.cost_price != null ? Number(r.cost_price).toFixed(2) : '—'}</td>
                  <td className="num">{r.sales_price != null ? Number(r.sales_price).toFixed(2) : '—'}</td>
                  <td className="num">{r.wholesale_price != null ? Number(r.wholesale_price).toFixed(2) : '—'}</td>
                  <td className="num">{r.resale_price != null ? Number(r.resale_price).toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <OpeningStockForm branches={branches} stores={stores} products={products}
          onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />
      )}
    </div>
  );
}

function OpeningStockForm({ branches, stores, products, onClose, onSaved }: {
  branches: Branch[]; stores: Store[]; products: ProductNode[];
  onClose: () => void; onSaved: () => void;
}) {
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState<number | null>(null);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [lines, setLines] = useState<{ productId: number | null; quantity: string; costPrice: string; salesPrice: string; wholesalePrice: string; resalePrice: string }[]>([
    { productId: null, quantity: '0', costPrice: '', salesPrice: '', wholesalePrice: '', resalePrice: '' },
  ]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const flatProducts = flattenProducts(products);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!branchId) { setError('Branch is required.'); return; }
    if (!storeId) { setError('Store is required.'); return; }
    if (!lines.length) { setError('At least one line is required.'); return; }
    const payload = {
      docDate, branchId, storeId,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity) || 0,
        costPrice: l.costPrice ? Number(l.costPrice) : null,
        salesPrice: l.salesPrice ? Number(l.salesPrice) : null,
        wholesalePrice: l.wholesalePrice ? Number(l.wholesalePrice) : null,
        resalePrice: l.resalePrice ? Number(l.resalePrice) : null,
      })).filter((l) => l.productId),
    };
    setBusy(true);
    try { await api.post('/api/inventory/opening-stock', payload); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <form className="panel" style={{ width: 900, maxWidth: '95vw', maxHeight: '95vh', overflowY: 'auto' }} onSubmit={submit}>
        <div className="panel-head">New opening stock</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field"><label className="field-label">Date <span className="req">*</span></label><input className="field-input" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></div>
            <div className="field"><label className="field-label">Branch <span className="req">*</span></label>
              <select className="field-select" value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {flattenBranches(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="field-label">Store <span className="req">*</span></label>
              <select className="field-select" value={storeId ?? ''} onChange={(e) => setStoreId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {flattenStores(stores).filter((s) => s.storeType === 'STOCK').map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
          </div>

          <h4 style={{ marginTop: 16 }}>Lines</h4>
          <table className="data-table">
            <thead><tr><th>#</th><th>Product</th><th className="num">Qty</th><th className="num">Cost price</th><th className="num">Sales price</th><th className="num">Wholesale</th><th className="num">Resale</th><th></th></tr></thead>
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
                  <td><input type="number" step="0.0001" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} style={{ width: 80, textAlign: 'right' }} /></td>
                  <td><input type="number" step="0.0001" value={l.costPrice} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, costPrice: e.target.value } : x))} style={{ width: 80, textAlign: 'right' }} placeholder="0" /></td>
                  <td><input type="number" step="0.0001" value={l.salesPrice} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, salesPrice: e.target.value } : x))} style={{ width: 80, textAlign: 'right' }} /></td>
                  <td><input type="number" step="0.0001" value={l.wholesalePrice} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, wholesalePrice: e.target.value } : x))} style={{ width: 80, textAlign: 'right' }} /></td>
                  <td><input type="number" step="0.0001" value={l.resalePrice} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, resalePrice: e.target.value } : x))} style={{ width: 80, textAlign: 'right' }} /></td>
                  <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm" onClick={() => setLines((p) => [...p, { productId: null, quantity: '0', costPrice: '', salesPrice: '', wholesalePrice: '', resalePrice: '' }])}>Add line</button>

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

function flattenBranches(nodes: Branch[]): Branch[] {
  const out: Branch[] = []; const walk = (ns: Branch[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out;
}
function flattenStores(nodes: Store[]): Store[] {
  const out: Store[] = []; const walk = (ns: Store[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out;
}
function flattenProducts(nodes: ProductNode[]): ProductNode[] {
  const out: ProductNode[] = []; const walk = (ns: ProductNode[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out;
}
