import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Branch, Store } from '../api/types';

interface InventoryRow {
  product_id: number; product_code: string; product_name: string;
  store_id: number; store_code: string; store_name: string;
  quantity: number; avg_cost: number; value: number; reorder_level: number; below_reorder: boolean;
}

interface InvReport {
  rows: InventoryRow[];
  totalValue: number;
  totalQty: number;
}

export default function InventoryReportPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState<number | null>(null);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [data, setData] = useState<InvReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get<Branch[]>('/api/branches'), api.get<Store[]>('/api/stores')])
      .then(([b, s]) => { setBranches(b); setStores(s); }).catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true); setError(''); setData(null);
    try {
      const params = new URLSearchParams({ asOfDate });
      if (branchId) params.append('branchId', String(branchId));
      if (storeId) params.append('storeId', String(storeId));
      setData(await api.get<InvReport>(`/api/inventory/inventory-report?${params.toString()}`));
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Inventory Report</div><div className="page-subtitle">Quantity per store, average cost, value at cost, reorder flags.</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field"><label className="field-label">As of date <span className="req">*</span></label><input className="field-input" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} /></div>
            <div className="field"><label className="field-label">Branch</label>
              <select className="field-select" value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
                <option value="">All branches</option>
                {flattenBranches(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="field-label">Store</label>
              <select className="field-select" value={storeId ?? ''} onChange={(e) => setStoreId(Number(e.target.value) || null)}>
                <option value="">All stores</option>
                {flattenStores(stores).filter((s) => s.storeType === 'STOCK').map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={run} disabled={loading}>{loading ? 'Running…' : 'Run report'}</button>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      {data && (
        <div className="panel">
          <div className="panel-head">Inventory — total value {data.totalValue.toFixed(2)} | total qty {data.totalQty.toFixed(2)}</div>
          <div className="panel-body">
            <table className="data-table">
              <thead><tr><th>Product</th><th>Store</th><th className="num">Qty</th><th className="num">Avg cost</th><th className="num">Value</th><th className="num">Reorder</th><th>Status</th></tr></thead>
              <tbody>
                {data.rows.length === 0 ? <tr><td colSpan={7} className="empty-state">No stock on hand.</td></tr> :
                data.rows.map((r) => (
                  <tr key={r.product_id + ':' + r.store_id}>
                    <td>{r.product_code} — {r.product_name}</td>
                    <td>{r.store_code} — {r.store_name}</td>
                    <td className="num">{r.quantity.toFixed(2)}</td>
                    <td className="num">{r.avg_cost.toFixed(4)}</td>
                    <td className="num">{r.value.toFixed(2)}</td>
                    <td className="num">{r.reorder_level.toFixed(2)}</td>
                    <td>{r.below_reorder ? <span className="badge badge-warn">Below reorder</span> : <span className="badge badge-muted">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function flattenBranches(nodes: Branch[]): Branch[] { const out: Branch[] = []; const walk = (ns: Branch[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out; }
function flattenStores(nodes: Store[]): Store[] { const out: Store[] = []; const walk = (ns: Store[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out; }
