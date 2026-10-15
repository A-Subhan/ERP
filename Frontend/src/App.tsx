/* ===========================================================================
 * App — routes + auth gate + layout
 * ==========================================================================*/
import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api } from './api/client';
import { User } from './api/types';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Layout from './components/Layout';
import Branches from './pages/Branches';
import Units from './pages/Units';
import ChartOfAccounts from './pages/ChartOfAccounts';
import Users from './pages/Users';
import DefaultPage from './pages/DefaultPage';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupCompleted, setSetupCompleted] = useState(true);
  const location = useLocation();

  // Bootstrap: check setup status, then current user
  useEffect(() => {
    (async () => {
      try {
        const s = await api.get<{ setupCompleted: boolean }>('/api/setup-status');
        setSetupCompleted(s.setupCompleted);
        if (s.setupCompleted) {
          try {
            const me = await api.get<{ user: User }>('/api/me');
            setUser(me.user);
          } catch (_) { setUser(null); }
        }
      } catch (_) { /* network down etc. */ }
      setLoading(false);
    })();
  }, []);

  // Refetch user on route changes (so login state refreshes)
  useEffect(() => {
    if (user) return;
    if (location.pathname === '/login' || location.pathname === '/setup') return;
    api.get<{ user: User }>('/api/me').then((m) => setUser(m.user)).catch(() => setUser(null));
  }, [location.pathname, user]);

  if (loading) return <div style={{ padding: 32, color: '#6b7280' }}>Loading…</div>;

  if (!setupCompleted) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup onDone={() => { setSetupCompleted(true); setUser(null); }} />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={(u) => setUser(u)} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout user={user} onLogout={() => { setUser(null); }}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/admin/default" element={<DefaultPage />} />
        <Route path="/admin/branches" element={<Branches />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/units" element={<Units />} />
        <Route path="/finance/chart-of-accounts" element={<ChartOfAccounts />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
