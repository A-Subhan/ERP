import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Branch } from '../../api/types';

interface SalesDash {
  totalSales: number; totalReturns: number; netSales: number; invoiceCount: number;
  topCustomers: Array<{ code: string; name: string; amount: number }>;
  topProducts: Array<{ code: string; name: string; qty: number; amount: number }>;
}

export default function SalesDashboard() {
  const [data, setData] = useState<SalesDash | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (branchId) params.branchId = branchId;
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;
      const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
      setData(await api.get<SalesDash>(`/api/dashboards/sales?${q}`));
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { api.get<Branch[]>('/api/branches').then(setBranches).catch(() => {}); load(); }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Sales dashboard</div><div className="page-subtitle">Totals match the Sales Report for the same filters.</div></div>
        <div className="page-actions">
          <select className="field-select" value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value) || null)} style={{ width: 160 }}>
            <option value="">All branches</option>
            {flatten(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
          <input className="field-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input className="field-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <button className="btn btn-primary" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Stat label="Total sales" value={data?.totalSales.toFixed(2) ?? '—'} />
        <Stat label="Returns" value={data?.totalReturns.toFixed(2) ?? '—'} />
        <Stat label="Net sales" value={data?.netSales.toFixed(2) ?? '—'} />
        <Stat label="Invoice count" value={String(data?.invoiceCount ?? '—')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <div className="panel">
          <div className="panel-head">Top 5 customers</div>
          <div className="panel-body">
            {data?.topCustomers.length === 0 ? <div className="empty-state">No data.</div> : (
              <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {data?.topCustomers.map((c) => <tr key={c.code}><td className="num">{c.code}</td><td>{c.name}</td><td className="num">{c.amount.toFixed(2)}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">Top 5 products</div>
          <div className="panel-body">
            {data?.topProducts.length === 0 ? <div className="empty-state">No data.</div> : (
              <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {data?.topProducts.map((p) => <tr key={p.code}><td className="num">{p.code}</td><td>{p.name}</td><td className="num">{p.qty}</td><td className="num">{p.amount.toFixed(2)}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel"><div className="panel-body">
      <div className="text-muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div></div>
  );
}

function flatten(nodes: Branch[]): Branch[] {
  const out: Branch[] = [];
  const walk = (ns: Branch[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}
