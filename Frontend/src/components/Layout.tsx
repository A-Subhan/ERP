/* ===========================================================================
 * Layout — sidebar + topbar shell. Module groups shown based on permissions.
 * ==========================================================================*/
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { User } from '../api/types';
import { api } from '../api/client';

interface NavItem { to: string; label: string; }
interface NavGroup { title: string; items: NavItem[]; }

const NAV: NavGroup[] = [
  {
    title: 'Dashboards',
    items: [
      { to: '/', label: 'Overview' },
      { to: '/dashboards/sales', label: 'Sales' },
      { to: '/dashboards/purchase', label: 'Purchase' },
      { to: '/dashboards/receivables-payables', label: 'Receivables / Payables' },
      { to: '/dashboards/stock', label: 'Stock' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/finance/chart-of-accounts', label: 'Chart of Accounts' },
      { to: '/finance/tax-heads', label: 'Tax Heads' },
      { to: '/finance/cash-receipt', label: 'Cash Receipt' },
      { to: '/finance/cash-payment', label: 'Cash Payment' },
      { to: '/finance/bank-receipt', label: 'Bank Receipt' },
      { to: '/finance/bank-payment', label: 'Bank Payment' },
      { to: '/finance/journal-voucher', label: 'Journal Voucher' },
      { to: '/finance/opening-trial-balance', label: 'Opening Trial Balance' },
      { to: '/finance/update-cheque-status', label: 'Update Cheque Status' },
      { to: '/finance/bank-reconciliation', label: 'Bank Reconciliation' },
      { to: '/finance/reports/general-ledger', label: 'General Ledger' },
      { to: '/finance/reports/trial-balance', label: 'Trial Balance' },
      { to: '/finance/reports/income-statement', label: 'Income Statement' },
      { to: '/finance/reports/balance-sheet', label: 'Balance Sheet' },
      { to: '/finance/reports/aging-customer', label: 'Aging (Customers)' },
      { to: '/finance/reports/aging-supplier', label: 'Aging (Suppliers)' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/sales/orders', label: 'Sales Orders' },
      { to: '/sales/challans', label: 'Delivery Challans' },
      { to: '/sales/invoices', label: 'Sales Invoices' },
      { to: '/sales/credit-notes', label: 'Credit Notes' },
      { to: '/sales/reports/sales', label: 'Sales Report' },
      { to: '/sales/reports/return', label: 'Sales Return Report' },
    ],
  },
  {
    title: 'Purchase',
    items: [
      { to: '/purchase/requisitions', label: 'Purchase Requisitions' },
      { to: '/purchase/orders', label: 'Purchase Orders' },
      { to: '/purchase/receiving', label: 'Receiving Challans' },
      { to: '/purchase/invoices', label: 'Purchase Invoices' },
      { to: '/purchase/debit-notes', label: 'Debit Notes' },
      { to: '/purchase/reports/purchase', label: 'Purchase Report' },
      { to: '/purchase/reports/return', label: 'Purchase Return Report' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { to: '/inventory/products', label: 'Products' },
      { to: '/inventory/opening-stock', label: 'Opening Stock' },
      { to: '/inventory/moves', label: 'Move Stock' },
      { to: '/inventory/adjustments', label: 'Adjust Stock' },
      { to: '/inventory/stock-ledger', label: 'Stock / Product Ledger' },
      { to: '/inventory/reports/inventory', label: 'Inventory Report' },
      { to: '/inventory/reports/movement', label: 'Movement Report' },
      { to: '/inventory/reports/adjustment', label: 'Adjustment Report' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/admin/default', label: 'Default Page' },
      { to: '/admin/branches', label: 'Branches' },
      { to: '/admin/stores', label: 'Stores' },
      { to: '/admin/users', label: 'Users' },
      { to: '/admin/units', label: 'Units' },
      { to: '/admin/audit-log', label: 'Audit Log' },
    ],
  },
];

export default function Layout({ user, onLogout, children }: { user: User; onLogout: () => void; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const doLogout = async () => {
    try { await api.post('/api/logout'); } catch (_) { /* ignore */ }
    onLogout();
    navigate('/login');
  };

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-head">ERP</div>
        {NAV.map((g) => (
          <div className="sidebar-group" key={g.title}>
            <div className="sidebar-group-title">{g.title}</div>
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === '/'}
                className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <span className="ic" aria-hidden="true">·</span>
                <span>{it.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <button
          className="sidebar-collapse-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label="Toggle sidebar width"
        >
          <span>{collapsed ? '»' : '«'}</span> Collapse
        </button>
      </aside>

      <header className="topbar">
        <button
          className="topbar-hamburger"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Open menu"
        >☰</button>
        <div className="topbar-branch">
          <select aria-label="Branch">
            <option>All branches</option>
          </select>
        </div>
        <div className="spacer" />
        <div className="topbar-user">
          <span>{user.fullName}</span>
          <button onClick={doLogout}>Sign out</button>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  );
}
