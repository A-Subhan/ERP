import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Branch } from '../api/types';

type ReportKind = 'general-ledger' | 'trial-balance' | 'income-statement' | 'balance-sheet' | 'aging-customer' | 'aging-supplier';

const REPORT_META: Record<ReportKind, { title: string; needsDateRange: boolean; needsAsOf: boolean; screen: string }> = {
  'general-ledger': { title: 'General Ledger', needsDateRange: true, needsAsOf: false, screen: 'general_ledger' },
  'trial-balance': { title: 'Trial Balance', needsDateRange: true, needsAsOf: false, screen: 'trial_balance' },
  'income-statement': { title: 'Income Statement', needsDateRange: true, needsAsOf: false, screen: 'income_statement' },
  'balance-sheet': { title: 'Balance Sheet', needsDateRange: false, needsAsOf: true, screen: 'balance_sheet' },
  'aging-customer': { title: 'Aging (Customer-wise)', needsDateRange: false, needsAsOf: true, screen: 'aging_reports' },
  'aging-supplier': { title: 'Aging (Supplier-wise)', needsDateRange: false, needsAsOf: true, screen: 'aging_reports' },
};

export default function Reports({ kind }: { kind: ReportKind }) {
  const meta = REPORT_META[kind];
  const [branches, setBranches] = useState<Branch[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [branchId, setBranchId] = useState<number | null>(null);
  const [hideZero, setHideZero] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.get<Branch[]>('/api/branches').then(setBranches).catch(() => {}); }, []);

  const run = async () => {
    setLoading(true); setError(''); setData(null);
    try {
      const params: any = {};
      if (branchId) params.branchId = branchId;
      if (meta.needsDateRange) { params.fromDate = fromDate; params.toDate = toDate; }
      if (meta.needsAsOf) params.asOfDate = asOfDate;
      if (kind === 'trial-balance') params.hideZeroRows = hideZero;
      const q = new URLSearchParams(Object.entries(params).reduce((a, [k, v]) => { if (v !== null && v !== '' && v !== false) a[k] = String(v); return a; }, {} as Record<string, string>)).toString();
      const endpoint = kind === 'aging-customer' ? '/aging/customer'
                    : kind === 'aging-supplier' ? '/aging/supplier'
                    : kind.replace('-', '/');
      setData(await api.get(`/api/reports${endpoint}?${q}`));
    } catch (err) { setError(err instanceof Error ? err.message : 'Report failed.'); }
    finally { setLoading(false); }
  };

  const buildQuery = () => {
    const params: any = {};
    if (branchId) params.branchId = String(branchId);
    if (meta.needsDateRange) { params.fromDate = fromDate; params.toDate = toDate; }
    if (meta.needsAsOf) params.asOfDate = asOfDate;
    if (kind === 'trial-balance' && hideZero) params.hideZeroRows = 'true';
    return new URLSearchParams(params).toString();
  };

  const exportReport = async (fmt: 'pdf' | 'xlsx' | 'csv' | 'docx') => {
    setError('');
    try {
      const q = buildQuery();
      const r = await fetch(`/api/reports/${kind}/export?format=${fmt}&${q}`, { credentials: 'same-origin' });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: 'Export failed.' }));
        throw new Error(e.error || 'Export failed.');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('content-disposition');
      const m = cd && cd.match(/filename="?([^";]+)"?/i);
      a.download = (m && m[1]) || `${kind}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err instanceof Error ? err.message : 'Export failed.'); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{meta.title}</div>
          <div className="page-subtitle">Filters below. Run to load on screen; PDF / Excel / CSV / Word export via the buttons on the right.</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <div className="form-grid">
            {meta.needsDateRange && (
              <>
                <div className="field">
                  <label className="field-label">From date</label>
                  <input className="field-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">To date</label>
                  <input className="field-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
              </>
            )}
            {meta.needsAsOf && (
              <div className="field">
                <label className="field-label">As of date</label>
                <input className="field-input" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
                <div className="field-hint">Aging uses the bucket limits from the Default Page.</div>
              </div>
            )}
            <div className="field">
              <label className="field-label">Branch (includes children)</label>
              <select className="field-select" value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
                <option value="">All branches</option>
                {flatten(branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
            {kind === 'trial-balance' && (
              <div className="field">
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
                  <span>Hide zero rows</span>
                </label>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-primary" onClick={run} disabled={loading}>{loading ? 'Running…' : 'Run report'}</button>
            <button className="btn" disabled={!data || loading} onClick={() => exportReport('pdf')}>PDF</button>
            <button className="btn" disabled={!data || loading} onClick={() => exportReport('xlsx')}>Excel</button>
            <button className="btn" disabled={!data || loading} onClick={() => exportReport('csv')}>CSV</button>
            <button className="btn" disabled={!data || loading} onClick={() => exportReport('docx')}>Word</button>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      {data && (
        <div className="panel">
          <div className="panel-head">{meta.title}</div>
          <div className="panel-body">
            <ReportData kind={kind} data={data} />
          </div>
        </div>
      )}
    </div>
  );
}

function ReportData({ kind, data }: { kind: ReportKind; data: any }) {
  if (kind === 'general-ledger') {
    if (!Array.isArray(data) || data.length === 0) return <div className="empty-state">No data.</div>;
    return (
      <div>
        {data.map((acct: any) => (
          <div key={acct.code} style={{ marginBottom: 16 }}>
            <h4>{acct.code} — {acct.name} <span className="text-muted">({acct.opening_nature})</span></h4>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>
                {acct.transactions.map((t: any, i: number) => (
                  <tr key={i}>
                    <td>{t.entry_date ? formatDate(t.entry_date) : ''}</td>
                    <td>{t.voucher_no || t.ref_doc_type || ''}</td>
                    <td>{t.narration || ''}</td>
                    <td className="num">{Number(t.debit || 0).toFixed(2)}</td>
                    <td className="num">{Number(t.credit || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-muted">
              Opening: {Number(acct.op_debit).toFixed(2)} Dr / {Number(acct.op_credit).toFixed(2)} Cr —
              Closing: <strong>{Math.abs(acct.closing_balance).toFixed(2)} {acct.closing_nature}</strong>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'trial-balance') {
    return (
      <div>
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th className="num">Opening Dr</th><th className="num">Opening Cr</th><th className="num">Period Dr</th><th className="num">Period Cr</th><th className="num">Closing Dr</th><th className="num">Closing Cr</th></tr></thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.code}>
                <td className="num">{r.code}</td><td>{r.name}</td>
                <td className="num">{Number(r.opening_debit).toFixed(2)}</td><td className="num">{Number(r.opening_credit).toFixed(2)}</td>
                <td className="num">{Number(r.period_debit).toFixed(2)}</td><td className="num">{Number(r.period_credit).toFixed(2)}</td>
                <td className="num">{r.closing_balance >= 0 ? Number(r.closing_balance).toFixed(2) : ''}</td>
                <td className="num">{r.closing_balance < 0 ? Number(-r.closing_balance).toFixed(2) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>Totals:</td>
              <td className="num">{Number(data.totals.opening_debit).toFixed(2)}</td>
              <td className="num">{Number(data.totals.opening_credit).toFixed(2)}</td>
              <td className="num">{Number(data.totals.period_debit).toFixed(2)}</td>
              <td className="num">{Number(data.totals.period_credit).toFixed(2)}</td>
              <td className="num">{Number(data.totals.closing_debit).toFixed(2)}</td>
              <td className="num">{Number(data.totals.closing_credit).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }
  if (kind === 'income-statement') {
    return (
      <div>
        <h4>Revenue</h4>
        <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
          <tbody>{data.revenue.map((r: any) => <tr key={r.code}><td className="num">{r.code}</td><td>{r.name}</td><td className="num">{Math.abs(Number(r.net_movement)).toFixed(2)}</td></tr>)}</tbody>
        </table>
        <div className="text-right"><strong>Total revenue: {Number(data.totalRevenue).toFixed(2)}</strong></div>

        <h4 style={{ marginTop: 16 }}>Expenses</h4>
        <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
          <tbody>{data.expenses.map((r: any) => <tr key={r.code}><td className="num">{r.code}</td><td>{r.name}</td><td className="num">{Math.abs(Number(r.net_movement)).toFixed(2)}</td></tr>)}</tbody>
        </table>
        <div className="text-right"><strong>Total expenses: {Number(data.totalExpenses).toFixed(2)}</strong></div>
        <div className="text-right"><strong>Net profit / (loss): {Number(data.netProfit).toFixed(2)}</strong></div>
      </div>
    );
  }
  if (kind === 'balance-sheet') {
    return (
      <div>
        <h4>Assets</h4>
        <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
          <tbody>{data.assets.map((r: any) => <tr key={r.code}><td className="num">{r.code}</td><td>{r.name}</td><td className="num">{Number(r.balance).toFixed(2)}</td></tr>)}</tbody>
        </table>
        <div className="text-right"><strong>Total assets: {Number(data.totalAssets).toFixed(2)}</strong></div>

        <h4 style={{ marginTop: 16 }}>Liabilities</h4>
        <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
          <tbody>{data.liabilities.map((r: any) => <tr key={r.code}><td className="num">{r.code}</td><td>{r.name}</td><td className="num">{Number(-r.balance).toFixed(2)}</td></tr>)}</tbody>
        </table>
        <div className="text-right"><strong>Total liabilities: {Number(data.totalLiabilities).toFixed(2)}</strong></div>

        <h4 style={{ marginTop: 16 }}>Equity</h4>
        <table className="data-table"><thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
          <tbody>{data.equity.map((r: any) => <tr key={r.code}><td className="num">{r.code}</td><td>{r.name}</td><td className="num">{Number(-r.balance).toFixed(2)}</td></tr>)}</tbody>
        </table>
        <div className="text-right"><strong>Total equity: {Number(data.totalEquity).toFixed(2)}</strong></div>
        <div className="text-right" style={{ marginTop: 12 }}>
          <span className={data.isBalanced ? 'badge badge-success' : 'badge badge-danger'}>
            {data.isBalanced ? 'Assets = Liabilities + Equity' : 'Out of balance'}
          </span>
        </div>
      </div>
    );
  }
  if (kind === 'aging-customer' || kind === 'aging-supplier') {
    return (
      <div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Party</th><th className="num">Current</th>
              {data.buckets.slice(1).map((b: string) => <th key={b} className="num">{b}</th>)}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.parties.map((p: any) => (
              <tr key={p.accountCode}>
                <td>{p.accountCode} — {p.accountName}</td>
                <td className="num">{Number(p.current).toFixed(2)}</td>
                <td className="num">{Number(p.b0_30).toFixed(2)}</td>
                <td className="num">{Number(p.b31_60).toFixed(2)}</td>
                <td className="num">{Number(p.b61_90).toFixed(2)}</td>
                <td className="num">{Number(p.b90_plus).toFixed(2)}</td>
                <td className="num"><strong>{Number(p.total).toFixed(2)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

function flatten(nodes: Branch[]): Branch[] {
  const out: Branch[] = [];
  const walk = (ns: Branch[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}
function formatDate(d: string): string {
  if (!d) return '';
  const date = new Date(d);
  return `${String(date.getUTCDate()).padStart(2, '0')}-${date.toLocaleString('en-US', { month: 'short' })}-${date.getUTCFullYear()}`;
}
