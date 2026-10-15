import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface AuditRow {
  id: number;
  event_at: string;
  user_id: number | null;
  user_name: string | null;
  ip_address: string | null;
  screen_code: string | null;
  action: string;
  record_type: string | null;
  record_id: string | null;
  record_number: string | null;
  before_values: string | null;
  after_values: string | null;
}

export default function AuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [screenCode, setScreenCode] = useState('');
  const [action, setAction] = useState('');
  const [recordNumber, setRecordNumber] = useState('');
  const [actions, setActions] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(screenCode && { screenCode }),
        ...(action && { action }),
        ...(recordNumber && { recordNumber }),
      }).toString();
      const r = await api.get<{ rows: AuditRow[]; total: number; page: number; pageSize: number }>(`/api/audit-log?${q}`);
      setRows(r.rows);
      setTotal(r.total);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { api.get<string[]>('/api/audit-log/actions').then(setActions).catch(() => {}); }, []);
  useEffect(() => { load(); }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Audit Log</div>
          <div className="page-subtitle">Append-only. UPDATE and DELETE are blocked by a database trigger.</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">From date</label>
              <input className="field-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">To date</label>
              <input className="field-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Screen code</label>
              <input className="field-input" value={screenCode} onChange={(e) => setScreenCode(e.target.value)} placeholder="e.g. COA, USERS, CRV" />
            </div>
            <div className="field">
              <label className="field-label">Action</label>
              <select className="field-select" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">— Any —</option>
                {actions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Record number</label>
              <input className="field-input" value={recordNumber} onChange={(e) => setRecordNumber(e.target.value)} />
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
            <thead>
              <tr><th>When</th><th>User</th><th>Screen</th><th>Action</th><th>Record</th><th>IP</th><th>Changes</th></tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="empty-state">Loading…</td></tr> :
               rows.length === 0 ? <tr><td colSpan={7} className="empty-state">No entries.</td></tr> :
               rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.event_at, true)}</td>
                  <td>{r.user_name ?? '—'}</td>
                  <td>{r.screen_code ?? '—'}</td>
                  <td>{r.action}</td>
                  <td>{r.record_type ? `${r.record_type} / ${r.record_number ?? r.record_id ?? ''}` : '—'}</td>
                  <td>{r.ip_address ?? '—'}</td>
                  <td>
                    <details>
                      <summary className="text-muted">View JSON</summary>
                      <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                        before: {r.before_values || 'null'}{'\n\n'}after: {r.after_values || 'null'}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <span className="text-muted">{total} entries</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="text-muted">Page {page} of {totalPages}</span>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

function formatDate(d: string, withTime = false): string {
  if (!d) return '';
  const date = new Date(d);
  const base = `${String(date.getUTCDate()).padStart(2, '0')}-${date.toLocaleString('en-US', { month: 'short' })}-${date.getUTCFullYear()}`;
  return withTime ? `${base} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}` : base;
}
