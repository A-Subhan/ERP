import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Branch } from '../../api/types';

interface RPDash {
  totalReceivable: number; totalPayable: number;
  overdueReceivable: number; overduePayable: number;
  topDebtors: Array<{ code: string; name: string; outstanding: number }>;
  topCreditors: Array<{ code: string; name: string; outstanding: number }>;
}

export default function ReceivablesPayablesDashboard() {
  const [data, setData] = useState<RPDash | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { asOfDate };
      if (branchId) params.branchId = branchId;
      const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
      setData(await api.get<RPDash>(`/api/dashboards/receivables-payables?${q}`));
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { api.get<Branch[]>('/api/branches').then(setBranches).catch(() => {}); load(); }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Receivables and Payables dashboard</div><div className="page-subtitle">Totals match the Aging Reports for the same as-of date.</div></div>
        <div className="page-actions">
          <select className="field-select" value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value) || null)} style={{ width: 160 }}>
            <option value="">All branches</option>
            {flatten(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
          <input className="field-input" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          <button className="btn btn-primary" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Stat label="Total receivable" value={data?.totalReceivable.toFixed(2) ?? '—'} />
        <Stat label="Total payable" value={data?.totalPayable.toFixed(2) ?? '—'} />
        <Stat label="Overdue receivable" value={data?.overdueReceivable.toFixed(2) ?? '—'} tone="warn" />
        <Stat label="Overdue payable" value={data?.overduePayable.toFixed(2) ?? '—'} tone="warn" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <div className="panel">
          <div className="panel-head">Top 5 debtors</div>
          <div className="panel-body">
            {data?.topDebtors.length === 0 ? <div className="empty-state">No data.</div> : (
              <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Outstanding</th></tr></thead>
                <tbody>
                  {data?.topDebtors.map((d) => <tr key={d.code}><td className="num">{d.code}</td><td>{d.name}</td><td className="num">{d.outstanding.toFixed(2)}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">Top 5 creditors</div>
          <div className="panel-body">
            {data?.topCreditors.length === 0 ? <div className="empty-state">No data.</div> : (
              <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Outstanding</th></tr></thead>
                <tbody>
                  {data?.topCreditors.map((c) => <tr key={c.code}><td className="num">{c.code}</td><td>{c.name}</td><td className="num">{c.outstanding.toFixed(2)}</td></tr>)}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'danger' }) {
  return (
    <div className="panel"><div className="panel-body">
      <div className="text-muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="num" style={{
        fontSize: 24, fontWeight: 600, marginTop: 4,
        color: tone === 'warn' ? 'var(--c-warn)' : tone === 'danger' ? 'var(--c-danger)' : 'inherit',
      }}>{value}</div>
    </div></div>
  );
}

function flatten(nodes: Branch[]): Branch[] {
  const out: Branch[] = [];
  const walk = (ns: Branch[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}
