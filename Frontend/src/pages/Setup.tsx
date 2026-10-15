import { useState } from 'react';
import { api } from '../api/client';
import { User } from '../api/types';

interface CheckResult { companyId: string; taken: boolean; }

export default function Setup({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    companyName: '',
    companyId: '',
    branchName: '',
    branchShortName: '',
    fiscalYearName: '',
    fiscalYearStart: '',
    fiscalYearEnd: '',
    adminUsername: '',
    adminFullName: '',
    adminPassword: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Per-field async validation state for company ID
  const [companyIdStatus, setCompanyIdStatus] = useState<'idle' | 'checking' | 'taken' | 'ok'>('idle');
  const [companyIdError, setCompanyIdError] = useState('');

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Debounced uniqueness check on company ID. Fires after the user stops
  // typing for ~500ms. Rejects empty or invalid-format input client-side.
  const onCompanyIdBlur = async () => {
    const id = f.companyId.trim();
    if (!id) { setCompanyIdStatus('idle'); setCompanyIdError(''); return; }
    if (!/^[A-Za-z0-9 _-]+$/.test(id) || id.length > 50) {
      setCompanyIdStatus('taken');
      setCompanyIdError('Company ID may only contain letters, numbers, spaces, underscore and hyphen (max 50 chars).');
      return;
    }
    setCompanyIdStatus('checking');
    setCompanyIdError('');
    try {
      const r = await api.get<CheckResult>(`/api/check-company-id?id=${encodeURIComponent(id)}`);
      if (r.taken) {
        setCompanyIdStatus('taken');
        setCompanyIdError(`Company ID "${id}" is already taken. Choose a different ID.`);
      } else {
        setCompanyIdStatus('ok');
        setCompanyIdError('');
      }
    } catch (err) {
      // Network or server error — don't block; the server-side check on submit
      // is the authoritative one.
      setCompanyIdStatus('idle');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!f.companyName || !f.companyId) { setError('Company name and company ID are required.'); return; }
    if (!/^[A-Za-z0-9 _-]+$/.test(f.companyId) || f.companyId.length > 50) {
      setError('Company ID may only contain letters, numbers, spaces, underscore and hyphen (max 50 chars).'); return;
    }
    // Re-check uniqueness client-side as a final guard (the server also enforces).
    if (companyIdStatus === 'taken') { setError(companyIdError); return; }
    if (companyIdStatus !== 'ok') {
      // Haven't checked yet or currently checking — block submit and trigger a check.
      setError('Please wait for the company ID uniqueness check to finish.');
      return;
    }
    if (!f.branchName || !f.branchShortName) { setError('Branch name and short name are required.'); return; }
    if (!/^[A-Za-z0-9_-]+$/.test(f.branchShortName)) {
      setError('Branch short name may only contain letters, numbers, underscore and hyphen.'); return;
    }
    if (!f.adminUsername || !f.adminFullName || !f.adminPassword) {
      setError('Admin username, full name and password are required.'); return;
    }
    if (f.adminPassword.length < 8) { setError('Admin password must be at least 8 characters.'); return; }
    if (!f.fiscalYearStart || !f.fiscalYearEnd || !f.fiscalYearName) {
      setError('Fiscal year name, start and end dates are required.'); return;
    }
    if (new Date(f.fiscalYearEnd) <= new Date(f.fiscalYearStart)) {
      setError('Fiscal year end must be after its start.'); return;
    }

    setBusy(true);
    try {
      await api.post('/api/setup', f);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" style={{ maxWidth: 720 }} onSubmit={submit}>
        <h1 className="auth-title">First-time setup</h1>
        <p className="auth-subtitle">Configure the company, first branch, fiscal year and the first admin account. These details are saved once.</p>

        <h3 style={{ marginTop: 16, marginBottom: 4 }}>Company</h3>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">Company name <span className="req">*</span></label>
            <input className="field-input" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Company ID <span className="req">*</span></label>
            <input
              className="field-input"
              value={f.companyId}
              onChange={(e) => { set('companyId', e.target.value); setCompanyIdStatus('idle'); setCompanyIdError(''); }}
              onBlur={onCompanyIdBlur}
              maxLength={50}
              placeholder="e.g. ACME-001"
            />
            <div className="field-hint">
              {companyIdStatus === 'checking' && 'Checking availability…'}
              {companyIdStatus === 'ok' && <span style={{ color: 'var(--c-success)' }}>This ID is available.</span>}
              {companyIdStatus === 'taken' && <span style={{ color: 'var(--c-danger)' }}>{companyIdError}</span>}
              {companyIdStatus === 'idle' && 'Set once. Cannot be reused across setups.'}
            </div>
          </div>
        </div>

        <h3 style={{ marginTop: 16, marginBottom: 4 }}>First branch</h3>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">Branch name <span className="req">*</span></label>
            <input className="field-input" value={f.branchName} onChange={(e) => set('branchName', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Short name <span className="req">*</span></label>
            <input className="field-input" value={f.branchShortName} onChange={(e) => set('branchShortName', e.target.value)} maxLength={20} />
            <div className="field-hint">Used in voucher numbers, e.g. <code>HO</code> → <code>HO/SI/27/000001</code>.</div>
          </div>
        </div>

        <h3 style={{ marginTop: 16, marginBottom: 4 }}>First fiscal year</h3>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">Fiscal year name <span className="req">*</span></label>
            <input className="field-input" value={f.fiscalYearName} onChange={(e) => set('fiscalYearName', e.target.value)} placeholder="FY 2026-27" />
          </div>
          <div className="field">
            <label className="field-label"></label>
            <div className="row" style={{ gap: 8 }}>
              <input className="field-input" type="date" value={f.fiscalYearStart} onChange={(e) => set('fiscalYearStart', e.target.value)} />
              <span className="text-muted">to</span>
              <input className="field-input" type="date" value={f.fiscalYearEnd} onChange={(e) => set('fiscalYearEnd', e.target.value)} />
            </div>
          </div>
        </div>

        <h3 style={{ marginTop: 16, marginBottom: 4 }}>First admin account</h3>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">Username <span className="req">*</span></label>
            <input className="field-input" value={f.adminUsername} onChange={(e) => set('adminUsername', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Full name <span className="req">*</span></label>
            <input className="field-input" value={f.adminFullName} onChange={(e) => set('adminFullName', e.target.value)} />
          </div>
          <div className="field full">
            <label className="field-label">Password <span className="req">*</span></label>
            <input className="field-input" type="password" value={f.adminPassword} onChange={(e) => set('adminPassword', e.target.value)} autoComplete="new-password" />
            <div className="field-hint">At least 8 characters.</div>
          </div>
        </div>

        {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="auth-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>Save and sign in</button>
        </div>
      </form>
    </div>
  );
}
