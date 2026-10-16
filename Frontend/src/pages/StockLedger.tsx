import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ProductNode, Store } from '../api/types';

interface StockLedgerData {
  opening: { quantity: number; avgCost: number };
  movements: Array<{
    id: number; doc_type: string; ref_doc_id: number | null; doc_date: string;
    store_code: string | null; store_name: string | null;
    qty_in: number; qty_out: number; rate: number; balance_after: number; avg_cost_after: number; narration: string | null;
  }>;
  closing: { quantity: number; avgCost: number };
}

export default function StockLedgerPage() {
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [productId, setProductId] = useState<number | null>(null);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<StockLedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get<ProductNode[]>('/api/products'), api.get<Store[]>('/api/stores')])
      .then(([p, s]) => { setProducts(p); setStores(s); }).catch(() => {});
  }, []);

  const run = async () => {
    if (!productId) { setError('Product is required.'); return; }
    setLoading(true); setError(''); setData(null);
    try {
      const params = new URLSearchParams({ productId: String(productId) });
      if (storeId) params.append('storeId', String(storeId));
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);
      setData(await api.get<StockLedgerData>(`/api/inventory/stock-ledger?${params.toString()}`));
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Stock / Product Ledger</div><div className="page-subtitle">Opening balance, every movement, running quantity, closing.</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Product <span className="req">*</span></label>
              <select className="field-select" value={productId ?? ''} onChange={(e) => setProductId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {flattenProducts(products).filter((p) => !p.isGroup).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Store (optional)</label>
              <select className="field-select" value={storeId ?? ''} onChange={(e) => setStoreId(Number(e.target.value) || null)}>
                <option value="">All stores</option>
                {flattenStores(stores).filter((s) => s.storeType === 'STOCK').map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="field-label">From date</label><input className="field-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
            <div className="field"><label className="field-label">To date</label><input className="field-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={run} disabled={loading}>{loading ? 'Running…' : 'Run report'}</button>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      {data && (
        <div className="panel">
          <div className="panel-head">Stock ledger</div>
          <div className="panel-body">
            <div className="text-muted" style={{ marginBottom: 8 }}>
              Opening: <strong className="num">{data.opening.quantity.toFixed(2)}</strong> @ <strong className="num">{data.opening.avgCost.toFixed(4)}</strong> &nbsp;|&nbsp;
              Closing: <strong className="num">{data.closing.quantity.toFixed(2)}</strong> @ <strong className="num">{data.closing.avgCost.toFixed(4)}</strong>
            </div>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Type</th><th>Store</th><th>Narration</th><th className="num">Qty in</th><th className="num">Qty out</th><th className="num">Rate</th><th className="num">Balance</th><th className="num">Avg cost</th></tr></thead>
              <tbody>
                {data.movements.length === 0 ? <tr><td colSpan={9} className="empty-state">No movements in this period.</td></tr> :
                data.movements.map((m) => (
                  <tr key={m.id}>
                    <td>{m.doc_date}</td><td>{m.doc_type}</td>
                    <td>{m.store_code ? `${m.store_code} — ${m.store_name}` : '—'}</td>
                    <td>{m.narration || '—'}</td>
                    <td className="num">{m.qty_in > 0 ? m.qty_in.toFixed(4) : ''}</td>
                    <td className="num">{m.qty_out > 0 ? m.qty_out.toFixed(4) : ''}</td>
                    <td className="num">{m.rate.toFixed(4)}</td>
                    <td className="num">{m.balance_after.toFixed(4)}</td>
                    <td className="num">{m.avg_cost_after.toFixed(4)}</td>
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

function flattenProducts(nodes: ProductNode[]): ProductNode[] { const out: ProductNode[] = []; const walk = (ns: ProductNode[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out; }
function flattenStores(nodes: Store[]): Store[] { const out: Store[] = []; const walk = (ns: Store[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } }; walk(nodes); return out; }
