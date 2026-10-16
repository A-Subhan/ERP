import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Account, Branch, Store } from '../api/types';

interface Settings {
  companyName: string; companyId: string;
  address: string | null; phone: string | null; email: string | null;
  ntn: string | null; strn: string | null; logoPath: string | null;
  defaultBranchId: number | null; defaultStoreId: number | null;
  decimalsAmount: number; decimalsQuantity: number; decimalsRate: number;
  allowNegativeStock: boolean;
  branchDigitsPerLevel: string; storeDigitsPerLevel: string; productDigitsPerLevel: string;
  accountingType: 'KNOCK_OFF' | 'FIFO'; coaDigitsPerLevel: string;
  coaMaxLevels: number; branchMaxLevels: number; storeMaxLevels: number; productMaxLevels: number;
  agingBucket1: number; agingBucket2: number; agingBucket3: number;
  defaultCashAccountCode: string | null; defaultBankAccountCode: string | null;
  salesAccountCode: string | null; salesReturnsAccountCode: string | null;
  outputSalesTaxAccountCode: string | null; inputSalesTaxAccountCode: string | null;
  inventoryAccountCode: string | null; cogsAccountCode: string | null;
  grnClearingAccountCode: string | null; purchasePriceVarianceAccountCode: string | null;
  stockAdjustmentAccountCode: string | null;
  printSettings: any;
}

interface FiscalYear { id: number; name: string; startDate: string; endDate: string; isActive: boolean; }

export default function DefaultPage() {
  const [tab, setTab] = useState<'general' | 'finance' | 'print'>('general');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fys, setFys] = useState<FiscalYear[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, f, b, st, a] = await Promise.all([
        api.get<Settings>('/api/settings'),
        api.get<FiscalYear[]>('/api/settings/fiscal-years'),
        api.get<Branch[]>('/api/branches'),
        api.get<Store[]>('/api/stores'),
        api.get<Account[]>('/api/accounts'),
      ]);
      setSettings(s); setFys(f); setBranches(b); setStores(st); setAccounts(a);
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load settings.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadAll(); }, []);

  const update = async (patch: Partial<Settings>) => {
    setBusy(true); setError(''); setSuccess('');
    try {
      const updated = await api.put<Settings>('/api/settings', patch);
      setSettings(updated);
      setSuccess('Saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  const flatAccts = flatten(accounts).filter((a) => !a.isGroup);
  const cashAccts = flatAccts.filter((a) => a.isCash);
  const bankAccts = flatAccts.filter((a) => a.isBank);
  const flatBranches = flattenBranches(branches);
  const flatStores = flattenStores(stores);

  if (loading || !settings) return <div style={{ padding: 32, color: '#6b7280' }}>Loading…</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Default Page</div>
          <div className="page-subtitle">Company-wide configuration. Company name and ID are read-only (immutable).</div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {success && <div className="inline-success">{success}</div>}

      <div className="panel">
        <div className="tabs" style={{ padding: '0 16px' }}>
          <button className={`tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>General</button>
          <button className={`tab ${tab === 'finance' ? 'active' : ''}`} onClick={() => setTab('finance')}>Finance &amp; Account Mapping</button>
          <button className={`tab ${tab === 'print' ? 'active' : ''}`} onClick={() => setTab('print')}>Print</button>
        </div>

        {tab === 'general' && (
          <div className="panel-body">
            <h4 style={{ marginTop: 0 }}>Company (read-only)</h4>
            <div className="form-grid">
              <div className="field"><label className="field-label">Company name</label><input className="field-input" value={settings.companyName} readOnly /></div>
              <div className="field"><label className="field-label">Company ID</label><input className="field-input" value={settings.companyId} readOnly /></div>
            </div>

            <h4 style={{ marginTop: 16 }}>Address &amp; contact</h4>
            <div className="form-grid">
              <div className="field full"><label className="field-label">Address</label>
                <input className="field-input" defaultValue={settings.address || ''} id="address" /></div>
              <div className="field"><label className="field-label">Phone</label><input className="field-input" defaultValue={settings.phone || ''} id="phone" /></div>
              <div className="field"><label className="field-label">Email</label><input className="field-input" defaultValue={settings.email || ''} id="email" /></div>
              <div className="field"><label className="field-label">NTN</label><input className="field-input" defaultValue={settings.ntn || ''} id="ntn" /></div>
              <div className="field"><label className="field-label">STRN</label><input className="field-input" defaultValue={settings.strn || ''} id="strn" /></div>
            </div>

            <h4 style={{ marginTop: 16 }}>Defaults &amp; decimals</h4>
            <div className="form-grid">
              <div className="field">
                <label className="field-label">Default branch</label>
                <select className="field-select" defaultValue={settings.defaultBranchId ?? ''} id="defaultBranchId">
                  <option value="">—</option>
                  {flatBranches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Default store</label>
                <select className="field-select" defaultValue={settings.defaultStoreId ?? ''} id="defaultStoreId">
                  <option value="">—</option>
                  {flatStores.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                </select>
              </div>
              <div className="field"><label className="field-label">Decimals — amount</label><input className="field-input" type="number" min="0" max="4" defaultValue={settings.decimalsAmount} id="decimalsAmount" /></div>
              <div className="field"><label className="field-label">Decimals — quantity</label><input className="field-input" type="number" min="0" max="4" defaultValue={settings.decimalsQuantity} id="decimalsQuantity" /></div>
              <div className="field"><label className="field-label">Decimals — rate</label><input className="field-input" type="number" min="0" max="4" defaultValue={settings.decimalsRate} id="decimalsRate" /></div>
              <div className="field">
                <label className="field-label">Allow negative stock</label>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" defaultChecked={settings.allowNegativeStock} id="allowNegativeStock" />
                  <span>Yes, allow stock to go below zero</span>
                </label>
              </div>
            </div>

            <h4 style={{ marginTop: 16 }}>Hierarchy digit-per-level settings</h4>
            <p className="text-muted" style={{ fontSize: 12 }}>
              Comma-separated digits per level (e.g. <code>2,3,3,3,3</code> for Branches means level 1 uses 2 digits, level 2 uses 3, etc.). Codes are stored as text so leading zeros are kept.
            </p>
            <div className="form-grid">
              <div className="field"><label className="field-label">Branches</label><input className="field-input" defaultValue={settings.branchDigitsPerLevel} id="branchDigitsPerLevel" /></div>
              <div className="field"><label className="field-label">Stores</label><input className="field-input" defaultValue={settings.storeDigitsPerLevel} id="storeDigitsPerLevel" /></div>
              <div className="field"><label className="field-label">Products</label><input className="field-input" defaultValue={settings.productDigitsPerLevel} id="productDigitsPerLevel" /></div>
            </div>

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => {
                const get = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value || '';
                const getChecked = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;
                const getNum = (id: string) => { const v = (document.getElementById(id) as HTMLInputElement | null)?.value || ''; return v === '' ? null : Number(v); };
                update({
                  address: get('address') || null,
                  phone: get('phone') || null,
                  email: get('email') || null,
                  ntn: get('ntn') || null,
                  strn: get('strn') || null,
                  defaultBranchId: getNum('defaultBranchId'),
                  defaultStoreId: getNum('defaultStoreId'),
                  decimalsAmount: getNum('decimalsAmount') ?? 2,
                  decimalsQuantity: getNum('decimalsQuantity') ?? 2,
                  decimalsRate: getNum('decimalsRate') ?? 2,
                  allowNegativeStock: getChecked('allowNegativeStock'),
                  branchDigitsPerLevel: get('branchDigitsPerLevel'),
                  storeDigitsPerLevel: get('storeDigitsPerLevel'),
                  productDigitsPerLevel: get('productDigitsPerLevel'),
                });
              }}>Save general</button>
            </div>
          </div>
        )}

        {tab === 'finance' && (
          <div className="panel-body">
            <h4 style={{ marginTop: 0 }}>Accounting type</h4>
            <div className="form-grid">
              <div className="field">
                <label className="field-label">Accounting type</label>
                <select className="field-select" defaultValue={settings.accountingType} id="accountingType">
                  <option value="KNOCK_OFF">Knock-Off (bill-wise)</option>
                  <option value="FIFO">FIFO (oldest-first)</option>
                </select>
                <div className="field-hint">Locked once any customer or supplier transaction exists.</div>
              </div>
              <div className="field"><label className="field-label">COA digits per level</label><input className="field-input" defaultValue={settings.coaDigitsPerLevel} id="coaDigitsPerLevel" /></div>
            </div>

            <h4 style={{ marginTop: 16 }}>Fiscal years</h4>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {fys.map((fy) => (
                  <tr key={fy.id}>
                    <td>{fy.name}</td>
                    <td>{fy.startDate}</td>
                    <td>{fy.endDate}</td>
                    <td>{fy.isActive ? <span className="badge badge-success">Active</span> : <span className="badge badge-muted">Inactive</span>}</td>
                    <td><button className="btn btn-sm btn-ghost" onClick={async () => { try { await api.del(`/api/settings/fiscal-years/${fy.id}`); await loadAll(); } catch (e: any) { alert(e.message); } }}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <input className="field-input" placeholder="Name (e.g. FY 2026-27)" id="newFyName" style={{ flex: 1 }} />
              <input className="field-input" type="date" id="newFyStart" />
              <input className="field-input" type="date" id="newFyEnd" />
              <button className="btn btn-sm btn-primary" onClick={async () => {
                try {
                  await api.post('/api/settings/fiscal-years', {
                    name: (document.getElementById('newFyName') as HTMLInputElement).value,
                    startDate: (document.getElementById('newFyStart') as HTMLInputElement).value,
                    endDate: (document.getElementById('newFyEnd') as HTMLInputElement).value,
                  });
                  await loadAll();
                } catch (e: any) { alert(e.message); }
              }}>Add fiscal year</button>
            </div>

            <h4 style={{ marginTop: 16 }}>Aging buckets (days)</h4>
            <div className="form-grid">
              <div className="field"><label className="field-label">Bucket 1</label><input className="field-input" type="number" defaultValue={settings.agingBucket1} id="agingBucket1" /></div>
              <div className="field"><label className="field-label">Bucket 2</label><input className="field-input" type="number" defaultValue={settings.agingBucket2} id="agingBucket2" /></div>
              <div className="field"><label className="field-label">Bucket 3</label><input className="field-input" type="number" defaultValue={settings.agingBucket3} id="agingBucket3" /></div>
            </div>

            <h4 style={{ marginTop: 16 }}>Mapped accounts</h4>
            <div className="form-grid">
              {[
                ['defaultCashAccountCode', 'Default cash account', cashAccts],
                ['defaultBankAccountCode', 'Default bank account', bankAccts],
                ['salesAccountCode', 'Sales', flatAccts],
                ['salesReturnsAccountCode', 'Sales returns', flatAccts],
                ['outputSalesTaxAccountCode', 'Output sales tax', flatAccts],
                ['inputSalesTaxAccountCode', 'Input sales tax', flatAccts],
                ['inventoryAccountCode', 'Inventory', flatAccts],
                ['cogsAccountCode', 'Cost of goods sold', flatAccts],
                ['grnClearingAccountCode', 'GRN clearing', flatAccts],
                ['purchasePriceVarianceAccountCode', 'Purchase price variance', flatAccts],
                ['stockAdjustmentAccountCode', 'Stock adjustment', flatAccts],
              ].map(([id, label, list]) => (
                <div className="field" key={id as string}>
                  <label className="field-label">{label as string}</label>
                  <select className="field-select" defaultValue={(settings as any)[id as string] ?? ''} id={id as string}>
                    <option value="">—</option>
                    {(list as Account[]).map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => {
                const get = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value || '';
                const getNum = (id: string) => { const v = (document.getElementById(id) as HTMLInputElement | null)?.value || ''; return v === '' ? null : Number(v); };
                update({
                  accountingType: get('accountingType') as 'KNOCK_OFF' | 'FIFO',
                  coaDigitsPerLevel: get('coaDigitsPerLevel'),
                  agingBucket1: getNum('agingBucket1') ?? 30,
                  agingBucket2: getNum('agingBucket2') ?? 60,
                  agingBucket3: getNum('agingBucket3') ?? 90,
                  defaultCashAccountCode: get('defaultCashAccountCode') || null,
                  defaultBankAccountCode: get('defaultBankAccountCode') || null,
                  salesAccountCode: get('salesAccountCode') || null,
                  salesReturnsAccountCode: get('salesReturnsAccountCode') || null,
                  outputSalesTaxAccountCode: get('outputSalesTaxAccountCode') || null,
                  inputSalesTaxAccountCode: get('inputSalesTaxAccountCode') || null,
                  inventoryAccountCode: get('inventoryAccountCode') || null,
                  cogsAccountCode: get('cogsAccountCode') || null,
                  grnClearingAccountCode: get('grnClearingAccountCode') || null,
                  purchasePriceVarianceAccountCode: get('purchasePriceVarianceAccountCode') || null,
                  stockAdjustmentAccountCode: get('stockAdjustmentAccountCode') || null,
                });
              }}>Save finance</button>
            </div>
          </div>
        )}

        {tab === 'print' && (
          <div className="panel-body">
            <p className="text-muted">
              Print settings are stored as a JSON blob in <code>settings.print_settings</code>.
              The voucher print layouts use these settings when rendering. The full live-preview
              print designer is a future enhancement — for now, the JSON editor below lets you
              set the four signature labels, paper size, and which voucher fields appear on print.
            </p>
            <div className="field full">
              <label className="field-label">Print settings (JSON)</label>
              <textarea
                className="field-textarea"
                style={{ minHeight: 240, fontFamily: 'monospace', fontSize: 12 }}
                defaultValue={JSON.stringify(settings.printSettings || defaultPrintSettings(), null, 2)}
                id="printSettingsJson"
              />
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => {
                const raw = (document.getElementById('printSettingsJson') as HTMLTextAreaElement).value;
                try {
                  const parsed = JSON.parse(raw);
                  update({ printSettings: parsed });
                } catch (e: any) { setError('Print settings JSON is not valid: ' + e.message); }
              }}>Save print</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function defaultPrintSettings() {
  return {
    paperSize: 'A4',
    orientation: 'portrait',
    showNarration: true,
    showChequeDetails: true,
    showReference: true,
    showTaxLines: true,
    showBillAllocation: true,
    signatureLabels: ['Prepared by', 'Checked by', 'Approved by', 'Received by'],
    fontSize: 10,
    footerText: '',
  };
}

function flatten(nodes: Account[]): Account[] {
  const out: Account[] = [];
  const walk = (ns: Account[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}
function flattenBranches(nodes: Branch[]): Branch[] {
  const out: Branch[] = [];
  const walk = (ns: Branch[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}
function flattenStores(nodes: Store[]): Store[] {
  const out: Store[] = [];
  const walk = (ns: Store[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}
