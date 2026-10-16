/* ===========================================================================
 * App — routes + auth gate + layout.
 * Every screen in the permission registry has a route. Placeholder pages
 * for screens not yet implemented show a clear "Coming next" panel listing
 * what's wired vs what's pending — they are NOT 404s.
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
import Stores from './pages/Stores';
import Products from './pages/Products';
import TaxHeads from './pages/TaxHeads';
import Vouchers from './pages/Vouchers';
import Reports from './pages/Reports';
import AuditLog from './pages/AuditLog';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupCompleted, setSetupCompleted] = useState(true);
  const location = useLocation();

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
      } catch (_) { /* network down */ }
      setLoading(false);
    })();
  }, []);

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
    <Layout user={user} onLogout={() => setUser(null)}>
      <Routes>
        {/* Dashboards */}
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboards/sales" element={<ComingSoon title="Sales Dashboard" />} />
        <Route path="/dashboards/purchase" element={<ComingSoon title="Purchase Dashboard" />} />
        <Route path="/dashboards/receivables-payables" element={<ComingSoon title="Receivables and Payables Dashboard" />} />
        <Route path="/dashboards/stock" element={<ComingSoon title="Stock Dashboard" />} />

        {/* Finance */}
        <Route path="/finance/cash-receipt" element={<Vouchers voucherType="CRV" />} />
        <Route path="/finance/cash-payment" element={<Vouchers voucherType="CPV" />} />
        <Route path="/finance/bank-receipt" element={<Vouchers voucherType="BRV" />} />
        <Route path="/finance/bank-payment" element={<Vouchers voucherType="BPV" />} />
        <Route path="/finance/journal-voucher" element={<Vouchers voucherType="JV" />} />
        <Route path="/finance/opening-trial-balance" element={<ComingSoon title="Opening Trial Balance" />} />
        <Route path="/finance/bank-reconciliation" element={<ComingSoon title="Bank Reconciliation" />} />
        <Route path="/finance/update-cheque-status" element={<ComingSoon title="Update Cheque Status" />} />
        <Route path="/finance/chart-of-accounts" element={<ChartOfAccounts />} />
        <Route path="/finance/tax-heads" element={<TaxHeads />} />
        <Route path="/finance/reports/general-ledger" element={<Reports kind="general-ledger" />} />
        <Route path="/finance/reports/trial-balance" element={<Reports kind="trial-balance" />} />
        <Route path="/finance/reports/income-statement" element={<Reports kind="income-statement" />} />
        <Route path="/finance/reports/balance-sheet" element={<Reports kind="balance-sheet" />} />
        <Route path="/finance/reports/aging-customer" element={<Reports kind="aging-customer" />} />
        <Route path="/finance/reports/aging-supplier" element={<Reports kind="aging-supplier" />} />

        {/* Sales */}
        <Route path="/sales/orders" element={<ComingSoon title="Sales Orders" />} />
        <Route path="/sales/challans" element={<ComingSoon title="Delivery Challans" />} />
        <Route path="/sales/invoices" element={<ComingSoon title="Sales Invoices" />} />
        <Route path="/sales/credit-notes" element={<ComingSoon title="Credit Notes" />} />
        <Route path="/sales/reports/sales" element={<ComingSoon title="Sales Report" />} />
        <Route path="/sales/reports/return" element={<ComingSoon title="Sales Return Report" />} />

        {/* Purchase */}
        <Route path="/purchase/requisitions" element={<ComingSoon title="Purchase Requisitions" />} />
        <Route path="/purchase/orders" element={<ComingSoon title="Purchase Orders" />} />
        <Route path="/purchase/receiving" element={<ComingSoon title="Receiving Challans" />} />
        <Route path="/purchase/invoices" element={<ComingSoon title="Purchase Invoices" />} />
        <Route path="/purchase/debit-notes" element={<ComingSoon title="Debit Notes" />} />
        <Route path="/purchase/reports/purchase" element={<ComingSoon title="Purchase Report" />} />
        <Route path="/purchase/reports/return" element={<ComingSoon title="Purchase Return Report" />} />

        {/* Inventory */}
        <Route path="/inventory/products" element={<Products />} />
        <Route path="/inventory/opening-stock" element={<ComingSoon title="Opening Stock" />} />
        <Route path="/inventory/moves" element={<ComingSoon title="Move Stock" />} />
        <Route path="/inventory/adjustments" element={<ComingSoon title="Adjust Stock" />} />
        <Route path="/inventory/stock-ledger" element={<ComingSoon title="Stock / Product Ledger" />} />
        <Route path="/inventory/reports/inventory" element={<ComingSoon title="Inventory Report" />} />
        <Route path="/inventory/reports/movement" element={<ComingSoon title="Movement Report" />} />
        <Route path="/inventory/reports/adjustment" element={<ComingSoon title="Adjustment Report" />} />

        {/* Admin */}
        <Route path="/admin/default" element={<DefaultPage />} />
        <Route path="/admin/branches" element={<Branches />} />
        <Route path="/admin/stores" element={<Stores />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/units" element={<Units />} />
        <Route path="/admin/audit-log" element={<AuditLog />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{title}</div>
          <div className="page-subtitle">Backend services and schema are wired; the full UI for this screen is being completed next.</div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-body">
          <p className="text-muted">
            The backend routes, services and SQL schema for this screen are in place. The full create/edit/list UI
            is the next pass. Meanwhile this route never returns a 404.
          </p>
        </div>
      </div>
    </div>
  );
}
