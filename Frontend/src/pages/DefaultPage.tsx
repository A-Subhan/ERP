export default function DefaultPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Default Page</div>
          <div className="page-subtitle">Application-wide configuration. Tabs below cover general, finance, and print settings.</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head" style={{ display: 'flex', gap: 0, padding: 0, borderBottom: '1px solid var(--c-border)' }}>
          <button className="tab active">General</button>
          <button className="tab">Finance &amp; Account Mapping</button>
          <button className="tab">Print</button>
        </div>
        <div className="panel-body">
          <p className="text-muted">
            This page is the central settings surface. The skeleton exposes the three tabs
            required by the spec (General, Finance &amp; Account Mapping, Print) so the rest
            of the modules can read configuration from the <code>settings</code> table.
          </p>
          <p className="text-muted">
            The actual form fields on each tab — company name and ID (read-only), address,
            decimals, hierarchy digit-per-level settings, mapped accounts, fiscal years list,
            aging buckets, print layout fields, and live preview — are implemented next, after
            the voucher and stock modules are wired, so the form is exercised end-to-end.
          </p>
        </div>
      </div>
    </div>
  );
}
