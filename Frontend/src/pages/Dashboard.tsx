import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Branch } from '../api/types';
import { Link } from 'react-router-dom';

interface StatCard { label: string; value: string; hint?: string; }

export default function Dashboard() {
  const [stats, setStats] = useState<StatCard[]>([
    { label: 'Branches', value: '—', hint: 'active' },
    { label: 'Accounts', value: '—', hint: 'posting' },
    { label: 'Units', value: '—', hint: 'active' },
    { label: 'Users', value: '—', hint: 'active' },
  ]);
  const [recentBranches, setRecentBranches] = useState<Branch[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const branches = await api.get<Branch[]>('/api/branches');
        setRecentBranches(branches.slice(0, 5));
        const activeBranches = countActive(branches);
        setStats((s) => [
          { ...s[0], value: String(activeBranches) },
          ...s.slice(1),
        ]);
      } catch (_) { /* network */ }
      try {
        const accounts = await api.get<any[]>('/api/accounts');
        // Count posting accounts that are active
        const postingCount = countPosting(accounts);
        setStats((s) => [s[0], { ...s[1], value: String(postingCount) }, ...s.slice(2)]);
      } catch (_) {}
      try {
        const units = await api.get<any[]>('/api/units');
        setStats((s) => [s[0], s[1], { ...s[2], value: String(units.filter((u) => u.isActive).length) }, s[3]]);
      } catch (_) {}
      try {
        const users = await api.get<any[]>('/api/users');
        setStats((s) => [s[0], s[1], s[2], { ...s[3], value: String(users.filter((u) => u.isActive).length) }]);
      } catch (_) {}
    })();
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Overview</div>
          <div className="page-subtitle">A calm view of your ERP setup at a glance.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        {stats.map((s) => (
          <div className="panel" key={s.label}>
            <div className="panel-body" style={{ padding: 16 }}>
              <div className="text-muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
              <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{s.value}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{s.hint || ''}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head">Recently configured branches</div>
        <div className="panel-body">
          {recentBranches.length === 0 ? (
            <div className="empty-state">No branches yet. <Link to="/admin/branches">Create your first branch</Link>.</div>
          ) : (
            <table className="data-table">
              <thead><tr><th>Code</th><th>Name</th><th>Short name</th><th>Status</th></tr></thead>
              <tbody>
                {recentBranches.map((b) => (
                  <tr key={b.id}>
                    <td className="num">{b.code}</td>
                    <td>{b.name}</td>
                    <td>{b.shortName}</td>
                    <td>{b.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-muted">Inactive</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function countActive(branches: Branch[]): number {
  let n = 0;
  const walk = (nodes: Branch[]) => {
    for (const b of nodes) {
      if (b.isActive) n++;
      if (b.children) walk(b.children);
    }
  };
  walk(branches);
  return n;
}

function countPosting(accounts: any[]): number {
  let n = 0;
  const walk = (nodes: any[]) => {
    for (const a of nodes) {
      if (!a.isGroup && a.isActive) n++;
      if (a.children) walk(a.children);
    }
  };
  walk(accounts);
  return n;
}
