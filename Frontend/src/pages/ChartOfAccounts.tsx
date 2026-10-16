import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Account } from '../api/types';

const NATURES = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'] as const;
const NATURE_LABEL: Record<string, string> = {
  ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', REVENUE: 'Revenue', EXPENSE: 'Expense',
};

interface TreeNode extends Account { expanded?: boolean; }

export default function ChartOfAccounts() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [viewing, setViewing] = useState<Account | null>(null);
  const [parentCode, setParentCode] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try { setTree(await api.get<Account[]>('/api/accounts')); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load accounts.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onAdd = (parent: Account | null) => {
    setEditing(null);
    setParentCode(parent ? parent.code : null);
    setShowForm(true);
  };
  const onEdit = (a: Account) => { setEditing(a); setParentCode(a.parentCode); setShowForm(true); };
  const onViewDetails = (a: Account) => { setViewing(a); setShowDetails(true); };
  const onDelete = async (a: Account) => {
    if (!confirm(`Delete account ${a.code} — ${a.name}? This cannot be undone.`)) return;
    try { await api.del(`/api/accounts/${a.code}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };
  const toggle = (code: string) => setCollapsed((c) => { const n = new Set(c); n.has(code) ? n.delete(code) : n.add(code); return n; });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = (roots: TreeNode[]) => {
    const n = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const x of nodes) {
        if (x.children && x.children.length) { n.add(x.code); walk(x.children); }
      }
    };
    walk(roots); setCollapsed(n);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Chart of Accounts</div>
          <div className="page-subtitle">Account code is the primary key. Parent cannot be changed after creation.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => collapseAll(tree)}>Collapse all</button>
          <button className="btn" onClick={expandAll}>Expand all</button>
          <button className="btn btn-primary" onClick={() => onAdd(null)}>New root account</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="panel">
        <div className="panel-body">
          {loading ? <div className="empty-state">Loading…</div> : (
            tree.length === 0
              ? <div className="empty-state">No accounts yet.</div>
              : <AccountTreeNodes nodes={tree} collapsed={collapsed} onToggle={toggle}
                  onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onViewDetails={onViewDetails} />
          )}
        </div>
      </div>

      {showForm && (
        <AccountForm existing={editing} parentCode={parentCode} onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load(); }} />
      )}

      {showDetails && viewing && (
        <AccountDetailsModal account={viewing} onClose={() => setShowDetails(false)}
          onSaved={async () => { setShowDetails(false); await load(); }} />
      )}
    </div>
  );
}

function AccountTreeNodes({
  nodes, collapsed, onToggle, onAdd, onEdit, onDelete, onViewDetails,
}: {
  nodes: TreeNode[]; collapsed: Set<string>;
  onToggle: (code: string) => void;
  onAdd: (a: Account | null) => void;
  onEdit: (a: Account) => void;
  onDelete: (a: Account) => void;
  onViewDetails: (a: Account) => void;
}) {
  return (
    <ul className="tree">
      {nodes.map((a) => (
        <li className="tree-node" key={a.code}>
          <div className="tree-node-row">
            <span className="tree-code">{a.code}</span>
            <span className="tree-name">{a.name}</span>
            <span className="badge badge-muted">{NATURE_LABEL[a.nature]}</span>
            {a.isGroup ? <span className="badge badge-muted">Group</span> : <span className="badge badge-success">Posting</span>}
            {a.isCash && <span className="badge badge-muted">Cash</span>}
            {a.isBank && <span className="badge badge-muted">Bank</span>}
            {a.partyType && a.partyType !== 'NONE' && <span className="badge badge-muted">{a.partyType.toLowerCase()}</span>}
            {!a.isActive && <span className="badge badge-warn">Inactive</span>}
            <span className="tree-actions">
              <button className="btn btn-sm btn-ghost" onClick={() => onAdd(a)}>Add child</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onEdit(a)}>Edit</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onViewDetails(a)}>Details</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onDelete(a)}>Delete</button>
              {a.children && a.children.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={() => onToggle(a.code)}>
                  {collapsed.has(a.code) ? '+' : '−'}
                </button>
              )}
            </span>
          </div>
          {a.children && a.children.length > 0 && !collapsed.has(a.code) && (
            <ul className="tree-children">
              <AccountTreeNodes nodes={a.children} collapsed={collapsed} onToggle={onToggle}
                onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onViewDetails={onViewDetails} />
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function AccountForm({
  existing, parentCode, onClose, onSaved,
}: {
  existing: Account | null;
  parentCode: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [nature, setNature] = useState<typeof NATURES[number]>(existing?.nature || 'ASSET');
  const [isGroup, setIsGroup] = useState(existing?.isGroup ?? false);
  const [isCash, setIsCash] = useState(existing?.isCash ?? false);
  const [isBank, setIsBank] = useState(existing?.isBank ?? false);
  const [partyType, setPartyType] = useState<'NONE' | 'CUSTOMER' | 'SUPPLIER'>(existing?.partyType || 'NONE');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name) { setError('Name is required.'); return; }
    const payload: any = { name, nature, isGroup, isCash, isBank, partyType, isActive };
    setBusy(true);
    try {
      if (existing) await api.put(`/api/accounts/${existing.code}`, payload);
      else await api.post('/api/accounts', { parentCode, ...payload });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: 16 }}>
      <form className="panel" style={{ width: 720, maxWidth: '95vw' }} onSubmit={submit}>
        <div className="panel-head">{existing ? `Edit account ${existing.code}` : 'New account'}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Name <span className="req">*</span></label>
              <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Nature</label>
              <select className="field-select" value={nature} onChange={(e) => setNature(e.target.value as typeof NATURES[number])} disabled={!!parentCode}>
                {NATURES.map((n) => <option key={n} value={n}>{NATURE_LABEL[n]}</option>)}
              </select>
              {parentCode ? <div className="field-hint">Inherited from parent.</div> : null}
            </div>
            <div className="field">
              <label className="field-label">Type</label>
              <select className="field-select" value={isGroup ? 'GROUP' : 'POSTING'} onChange={(e) => setIsGroup(e.target.value === 'GROUP')} disabled={!!existing}>
                <option value="GROUP">Group (cannot post)</option>
                <option value="POSTING">Posting (leaf)</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">Party type</label>
              <select className="field-select" value={partyType} onChange={(e) => setPartyType(e.target.value as any)}>
                <option value="NONE">None</option>
                <option value="CUSTOMER">Customer</option>
                <option value="SUPPLIER">Supplier</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">Cash account</label>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={isCash} onChange={(e) => setIsCash(e.target.checked)} disabled={isGroup} />
                <span>Mark as cash</span>
              </label>
            </div>
            <div className="field">
              <label className="field-label">Bank account</label>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={isBank} onChange={(e) => setIsBank(e.target.checked)} disabled={isGroup} />
                <span>Mark as bank</span>
              </label>
            </div>
            {existing && (
              <div className="field">
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <span>Active</span>
                </label>
              </div>
            )}
          </div>
          {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}
          <div className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
            Use the <strong>Details</strong> button on the tree to add tax numbers, contacts, bank details, photos and budget per account.
          </div>
        </div>
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderBottom: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create account'}</button>
        </div>
      </form>
    </div>
  );
}

function AccountDetailsModal({
  account, onClose, onSaved,
}: {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<any>({});
  const [branches, setBranches] = useState<any[]>([]);
  const [branchTags, setBranchTags] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'contact' | 'tax' | 'credit' | 'personal' | 'bank' | 'photos' | 'budget'>('general');

  useEffect(() => {
    (async () => {
      try {
        const [r, b] = await Promise.all([
          api.get<{ details: any; branchTags: number[] }>(`/api/accounts/${account.code}/details`),
          api.get<any[]>('/api/branches'),
        ]);
        setD(r.details || {});
        setBranchTags(r.branchTags);
        setBranches(flattenBranches(b));
      } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load.'); }
      finally { setLoading(false); }
    })();
  }, [account.code]);

  const set = (k: string, v: any) => setD((p: any) => ({ ...p, [k]: v }));

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await api.put(`/api/accounts/${account.code}/details`, { ...d, branchTags });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div style={{ padding: 32, color: '#6b7280' }}>Loading…</div>;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="panel" style={{ width: 900, maxWidth: '95vw', maxHeight: '95vh', overflowY: 'auto' }}>
        <div className="panel-head">Account details — {account.code} {account.name}</div>
        <div className="tabs" style={{ padding: '0 16px', borderBottom: '1px solid var(--c-border)' }}>
          {(['general','contact','tax','credit','personal','bank','photos','budget'] as const).map((t) => (
            <button key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="panel-body">
          {activeTab === 'general' && (
            <div className="form-grid">
              <div className="field"><label className="field-label">Account title (printed)</label><input className="field-input" value={d.accountTitle || ''} onChange={(e) => set('accountTitle', e.target.value)} /></div>
              <div className="field"><label className="field-label">Short name</label><input className="field-input" value={d.shortName || ''} onChange={(e) => set('shortName', e.target.value)} /></div>
              <div className="field"><label className="field-label">Reference number</label><input className="field-input" value={d.referenceNumber || ''} onChange={(e) => set('referenceNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">External / legacy code</label><input className="field-input" value={d.externalCode || ''} onChange={(e) => set('externalCode', e.target.value)} /></div>
              <div className="field"><label className="field-label">Serial number</label><input className="field-input" type="number" value={d.serialNumber ?? ''} onChange={(e) => set('serialNumber', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Account status</label><select className="field-select" value={d.accountStatus || ''} onChange={(e) => set('accountStatus', e.target.value || null)}><option value="">—</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="BLOCKED">Blocked</option><option value="ON_HOLD">On hold</option></select></div>
              <div className="field"><label className="field-label">Registration date</label><input className="field-input" type="date" value={d.registrationDate ? d.registrationDate.slice(0, 10) : ''} onChange={(e) => set('registrationDate', e.target.value || null)} /></div>
              <div className="field"><label className="field-label">Customer/supplier category</label><input className="field-input" value={d.customerSupplierCategory || ''} onChange={(e) => set('customerSupplierCategory', e.target.value)} /></div>
              <div className="field"><label className="field-label">Customer type</label><input className="field-input" value={d.customerType || ''} onChange={(e) => set('customerType', e.target.value)} /></div>
              <div className="field"><label className="field-label">Business type</label><input className="field-input" value={d.businessType || ''} onChange={(e) => set('businessType', e.target.value)} /></div>
              <div className="field full"><label className="field-label">Remarks / notes</label><textarea className="field-textarea" value={d.remarksNotes || ''} onChange={(e) => set('remarksNotes', e.target.value)} /></div>
            </div>
          )}

          {activeTab === 'contact' && (
            <div className="form-grid">
              <div className="field"><label className="field-label">Address line 1</label><input className="field-input" value={d.addressLine1 || ''} onChange={(e) => set('addressLine1', e.target.value)} /></div>
              <div className="field"><label className="field-label">Address line 2</label><input className="field-input" value={d.addressLine2 || ''} onChange={(e) => set('addressLine2', e.target.value)} /></div>
              <div className="field"><label className="field-label">Address line 3</label><input className="field-input" value={d.addressLine3 || ''} onChange={(e) => set('addressLine3', e.target.value)} /></div>
              <div className="field"><label className="field-label">Area</label><input className="field-input" value={d.area || ''} onChange={(e) => set('area', e.target.value)} /></div>
              <div className="field"><label className="field-label">City</label><input className="field-input" value={d.city || ''} onChange={(e) => set('city', e.target.value)} /></div>
              <div className="field"><label className="field-label">Province / State</label><input className="field-input" value={d.provinceState || ''} onChange={(e) => set('provinceState', e.target.value)} /></div>
              <div className="field"><label className="field-label">Postal code</label><input className="field-input" value={d.postalCode || ''} onChange={(e) => set('postalCode', e.target.value)} /></div>
              <div className="field"><label className="field-label">Country</label><input className="field-input" value={d.country || ''} onChange={(e) => set('country', e.target.value)} /></div>
              <div className="field"><label className="field-label">Telephone</label><input className="field-input" value={d.telephone || ''} onChange={(e) => set('telephone', e.target.value)} /></div>
              <div className="field"><label className="field-label">Residence telephone</label><input className="field-input" value={d.residenceTelephone || ''} onChange={(e) => set('residenceTelephone', e.target.value)} /></div>
              <div className="field"><label className="field-label">Mobile number</label><input className="field-input" value={d.mobileNumber || ''} onChange={(e) => set('mobileNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">WhatsApp</label><input className="field-input" value={d.whatsappNumber || ''} onChange={(e) => set('whatsappNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">Fax</label><input className="field-input" value={d.faxNumber || ''} onChange={(e) => set('faxNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">Email</label><input className="field-input" value={d.email || ''} onChange={(e) => set('email', e.target.value)} /></div>
              <div className="field"><label className="field-label">Website</label><input className="field-input" value={d.website || ''} onChange={(e) => set('website', e.target.value)} /></div>
              <div className="field"><label className="field-label">UAN / helpline</label><input className="field-input" value={d.uanHelpline || ''} onChange={(e) => set('uanHelpline', e.target.value)} /></div>
              <div className="field full"><label className="field-label">Delivery address</label><textarea className="field-textarea" value={d.deliveryAddress || ''} onChange={(e) => set('deliveryAddress', e.target.value)} /></div>
              <div className="field full"><label className="field-label">Billing address</label><textarea className="field-textarea" value={d.billingAddress || ''} onChange={(e) => set('billingAddress', e.target.value)} /></div>
            </div>
          )}

          {activeTab === 'tax' && (
            <div className="form-grid">
              <div className="field"><label className="field-label">NTN</label><input className="field-input" value={d.ntn || ''} onChange={(e) => set('ntn', e.target.value)} /></div>
              <div className="field"><label className="field-label">STRN (sales tax reg.)</label><input className="field-input" value={d.strn || ''} onChange={(e) => set('strn', e.target.value)} /></div>
              <div className="field"><label className="field-label">GST number</label><input className="field-input" value={d.gstNumber || ''} onChange={(e) => set('gstNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">CNIC / NIC number</label><input className="field-input" value={d.cnicNicNumber || ''} onChange={(e) => set('cnicNicNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">NICOP</label><input className="field-input" value={d.nicop || ''} onChange={(e) => set('nicop', e.target.value)} /></div>
              <div className="field"><label className="field-label">CNIC expiry</label><input className="field-input" type="date" value={d.cnicExpiryDate ? d.cnicExpiryDate.slice(0, 10) : ''} onChange={(e) => set('cnicExpiryDate', e.target.value || null)} /></div>
              <div className="field"><label className="field-label">Tax payer type</label><input className="field-input" value={d.taxPayerType || ''} onChange={(e) => set('taxPayerType', e.target.value)} /></div>
              <div className="field"><label className="field-label">Tax payer status (filer/non-filer)</label><input className="field-input" value={d.taxPayerStatus || ''} onChange={(e) => set('taxPayerStatus', e.target.value)} /></div>
              <div className="field"><label className="field-label">Tax type</label><input className="field-input" value={d.taxType || ''} onChange={(e) => set('taxType', e.target.value)} /></div>
              <div className="field"><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={d.withholdingTaxApplicable ?? false} onChange={(e) => set('withholdingTaxApplicable', e.target.checked)} /><span>Withholding tax applicable</span></label></div>
              <div className="field"><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={d.additionalWithholdingApplicable ?? false} onChange={(e) => set('additionalWithholdingApplicable', e.target.checked)} /><span>Additional withholding applicable</span></label></div>
              <div className="field"><label className="field-label">SRB / provincial tax number</label><input className="field-input" value={d.srbProvincialTaxNumber || ''} onChange={(e) => set('srbProvincialTaxNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">Exemption certificate no.</label><input className="field-input" value={d.exemptionCertificateNumber || ''} onChange={(e) => set('exemptionCertificateNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">Exemption cert. expiry</label><input className="field-input" type="date" value={d.exemptionCertificateExpiry ? d.exemptionCertificateExpiry.slice(0, 10) : ''} onChange={(e) => set('exemptionCertificateExpiry', e.target.value || null)} /></div>
              <div className="field"><label className="field-label">License number</label><input className="field-input" value={d.licenseNumber || ''} onChange={(e) => set('licenseNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">License expiry</label><input className="field-input" type="date" value={d.licenseExpiryDate ? d.licenseExpiryDate.slice(0, 10) : ''} onChange={(e) => set('licenseExpiryDate', e.target.value || null)} /></div>
              <div className="field"><label className="field-label">Registration authority</label><input className="field-input" value={d.registrationAuthority || ''} onChange={(e) => set('registrationAuthority', e.target.value)} /></div>
            </div>
          )}

          {activeTab === 'credit' && (
            <div className="form-grid">
              <div className="field"><label className="field-label">Credit days</label><input className="field-input" type="number" value={d.creditDays ?? ''} onChange={(e) => set('creditDays', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Credit amount (limit)</label><input className="field-input" type="number" step="0.01" value={d.creditAmount ?? ''} onChange={(e) => set('creditAmount', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Commission percent</label><input className="field-input" type="number" step="0.0001" value={d.commissionPercent ?? ''} onChange={(e) => set('commissionPercent', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Default discount %</label><input className="field-input" type="number" step="0.0001" value={d.defaultDiscountPercent ?? ''} onChange={(e) => set('defaultDiscountPercent', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Default salesman</label><input className="field-input" value={d.defaultSalesman || ''} onChange={(e) => set('defaultSalesman', e.target.value)} /></div>
              <div className="field"><label className="field-label">Price level</label><select className="field-select" value={d.priceLevel || ''} onChange={(e) => set('priceLevel', e.target.value || null)}><option value="">—</option><option value="RETAIL">Retail</option><option value="WHOLESALE">Wholesale</option><option value="RESALE">Resale</option><option value="COST">Cost</option><option value="OTHER">Other</option></select></div>
              <div className="field"><label className="field-label">Payment terms</label><input className="field-input" value={d.paymentTerms || ''} onChange={(e) => set('paymentTerms', e.target.value)} /></div>
              <div className="field"><label className="field-label">Currency</label><input className="field-input" value={d.currency || ''} onChange={(e) => set('currency', e.target.value)} /></div>
              <div className="field"><label className="field-label">Territory / route</label><input className="field-input" value={d.territoryRoute || ''} onChange={(e) => set('territoryRoute', e.target.value)} /></div>
              <div className="field"><label className="field-label">Cash-flow classification</label><input className="field-input" value={d.cashFlowClassification || ''} onChange={(e) => set('cashFlowClassification', e.target.value)} /></div>
              <div className="field"><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={d.allowSales ?? false} onChange={(e) => set('allowSales', e.target.checked)} /><span>Allow sales</span></label></div>
              <div className="field"><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={d.allowPurchases ?? false} onChange={(e) => set('allowPurchases', e.target.checked)} /><span>Allow purchases</span></label></div>
              <div className="field full"><label className="field-label">Tag branches</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, border: '1px solid var(--c-border)', padding: 8, borderRadius: 4, maxHeight: 120, overflowY: 'auto' }}>
                  {branches.map((b: any) => (
                    <label key={b.id} className="row" style={{ gap: 4 }}>
                      <input type="checkbox" checked={branchTags.includes(b.id)} onChange={(e) => setBranchTags((prev) => e.target.checked ? [...prev, b.id] : prev.filter((id) => id !== b.id))} />
                      <span>{b.code} — {b.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'personal' && (
            <div className="form-grid">
              <div className="field"><label className="field-label">Father / husband name</label><input className="field-input" value={d.fatherHusbandName || ''} onChange={(e) => set('fatherHusbandName', e.target.value)} /></div>
              <div className="field"><label className="field-label">Nationality</label><input className="field-input" value={d.nationality || ''} onChange={(e) => set('nationality', e.target.value)} /></div>
              <div className="field"><label className="field-label">Occupation</label><input className="field-input" value={d.occupation || ''} onChange={(e) => set('occupation', e.target.value)} /></div>
              <div className="field"><label className="field-label">Monthly income</label><input className="field-input" type="number" step="0.01" value={d.monthlyIncome ?? ''} onChange={(e) => set('monthlyIncome', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Customer age</label><input className="field-input" type="number" value={d.customerAge ?? ''} onChange={(e) => set('customerAge', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Number of dependents</label><input className="field-input" type="number" value={d.numberOfDependents ?? ''} onChange={(e) => set('numberOfDependents', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Date of birth</label><input className="field-input" type="date" value={d.dateOfBirth ? d.dateOfBirth.slice(0, 10) : ''} onChange={(e) => set('dateOfBirth', e.target.value || null)} /></div>
              <div className="field"><label className="field-label">Gender</label><input className="field-input" value={d.gender || ''} onChange={(e) => set('gender', e.target.value)} /></div>
              <div className="field"><label className="field-label">Marital status</label><input className="field-input" value={d.maritalStatus || ''} onChange={(e) => set('maritalStatus', e.target.value)} /></div>
              <div className="field full"><label className="field-label">Emergency contact</label><input className="field-input" value={d.emergencyContact || ''} onChange={(e) => set('emergencyContact', e.target.value)} /></div>
            </div>
          )}

          {activeTab === 'bank' && (
            <div className="form-grid">
              <div className="field"><label className="field-label">Bank name</label><input className="field-input" value={d.bankName || ''} onChange={(e) => set('bankName', e.target.value)} /></div>
              <div className="field"><label className="field-label">Bank prefix</label><input className="field-input" value={d.bankPrefix || ''} onChange={(e) => set('bankPrefix', e.target.value)} /></div>
              <div className="field"><label className="field-label">Bank account name</label><input className="field-input" value={d.bankAccountName || ''} onChange={(e) => set('bankAccountName', e.target.value)} /></div>
              <div className="field"><label className="field-label">Account number</label><input className="field-input" value={d.bankAccountNumber || ''} onChange={(e) => set('bankAccountNumber', e.target.value)} /></div>
              <div className="field"><label className="field-label">IBAN</label><input className="field-input" value={d.iban || ''} onChange={(e) => set('iban', e.target.value)} /></div>
              <div className="field"><label className="field-label">Account type</label><select className="field-select" value={d.bankAccountType || ''} onChange={(e) => set('bankAccountType', e.target.value || null)}><option value="">—</option><option value="CURRENT">Current</option><option value="SAVINGS">Savings</option><option value="OTHER">Other</option></select></div>
              <div className="field"><label className="field-label">Bank currency</label><input className="field-input" value={d.bankCurrency || ''} onChange={(e) => set('bankCurrency', e.target.value)} /></div>
              <div className="field"><label className="field-label">Branch code</label><input className="field-input" value={d.bankBranchCode || ''} onChange={(e) => set('bankBranchCode', e.target.value)} /></div>
              <div className="field"><label className="field-label">Branch name</label><input className="field-input" value={d.bankBranchName || ''} onChange={(e) => set('bankBranchName', e.target.value)} /></div>
              <div className="field full"><label className="field-label">Branch address</label><input className="field-input" value={d.bankBranchAddress || ''} onChange={(e) => set('bankBranchAddress', e.target.value)} /></div>
              <div className="field"><label className="field-label">Branch city</label><input className="field-input" value={d.bankBranchCity || ''} onChange={(e) => set('bankBranchCity', e.target.value)} /></div>
              <div className="field"><label className="field-label">SWIFT code</label><input className="field-input" value={d.swiftCode || ''} onChange={(e) => set('swiftCode', e.target.value)} /></div>
              <div className="field"><label className="field-label">LC limit</label><input className="field-input" type="number" step="0.01" value={d.lcLimit ?? ''} onChange={(e) => set('lcLimit', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Bank charges</label><input className="field-input" type="number" step="0.01" value={d.bankCharges ?? ''} onChange={(e) => set('bankCharges', Number(e.target.value) || null)} /></div>
              <div className="field"><label className="field-label">Cheque book range from</label><input className="field-input" value={d.chequeBookRangeFrom || ''} onChange={(e) => set('chequeBookRangeFrom', e.target.value)} /></div>
              <div className="field"><label className="field-label">Cheque book range to</label><input className="field-input" value={d.chequeBookRangeTo || ''} onChange={(e) => set('chequeBookRangeTo', e.target.value)} /></div>
              <div className="field"><label className="field-label">Current cheque number</label><input className="field-input" value={d.currentChequeNumber || ''} onChange={(e) => set('currentChequeNumber', e.target.value)} /></div>
              <div className="field full"><label className="field-label">Cheque print format</label><textarea className="field-textarea" value={d.chequePrintFormat || ''} onChange={(e) => set('chequePrintFormat', e.target.value)} /></div>
              <div className="field full"><label className="field-label">Pay-order / online reference notes</label><textarea className="field-textarea" value={d.payOrderOnlineRefNotes || ''} onChange={(e) => set('payOrderOnlineRefNotes', e.target.value)} /></div>
            </div>
          )}

          {activeTab === 'photos' && (
            <PhotosTab account={account} details={d} onChanged={() => {/* parent refetches on save */}} />
          )}

          {activeTab === 'budget' && (
            <div className="form-grid">
              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, idx) => (
                <div className="field" key={m}>
                  <label className="field-label">{m}</label>
                  <input className="field-input" type="number" step="0.01"
                    value={(d['budget' + m] ?? '')}
                    onChange={(e) => set('budget' + m, Number(e.target.value) || null)} />
                </div>
              ))}
            </div>
          )}

          {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderBottom: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>Save details</button>
        </div>
      </div>
    </div>
  );
}

function flattenBranches(nodes: any[]): any[] {
  const out: any[] = [];
  const walk = (ns: any[]) => { for (const n of ns) { out.push(n); if (n.children) walk(n.children); } };
  walk(nodes); return out;
}

// ---------------------------------------------------------------------------
// Photos tab — upload, view, replace, remove. Authenticated via cookie.
// ---------------------------------------------------------------------------
const PHOTO_SLOTS: Array<{ field: 'nicPhotoPath' | 'personPhotoPath' | 'photo1Path' | 'photo2Path'; label: string; hasCustomLabel?: boolean }> = [
  { field: 'nicPhotoPath', label: 'NIC photo' },
  { field: 'personPhotoPath', label: "Person's photo" },
  { field: 'photo1Path', label: 'Photo 1', hasCustomLabel: true },
  { field: 'photo2Path', label: 'Photo 2', hasCustomLabel: true },
];

function PhotosTab({ account, details, onChanged }: { account: Account; details: any; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [labels, setLabels] = useState<{ photo1Label: string; photo2Label: string }>({
    photo1Label: details.photo1Label || '',
    photo2Label: details.photo2Label || '',
  });

  const upload = async (field: typeof PHOTO_SLOTS[number]['field'], file: File) => {
    setBusy(field); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (field === 'photo1Path' || field === 'photo2Path') {
        fd.append('label', labels[(field + 'Label') as 'photo1Label' | 'photo2Label'] || '');
      }
      const r = await fetch(`/api/accounts/${account.code}/photo/${field}`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: 'Upload failed.' }));
        throw new Error(e.error || 'Upload failed.');
      }
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
    finally { setBusy(null); }
  };

  const remove = async (field: typeof PHOTO_SLOTS[number]['field']) => {
    if (!confirm('Remove this photo?')) return;
    setBusy(field); setError('');
    try {
      const r = await fetch(`/api/accounts/${account.code}/photo/${field}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: 'Remove failed.' }));
        throw new Error(e.error || 'Remove failed.');
      }
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Remove failed.'); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Accepts JPG, PNG and WebP up to 3 MB each. Files are stored on the server under <code>uploads/account_photos/</code>.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {PHOTO_SLOTS.map((slot) => {
          const path = details[slot.field];
          const url = path ? `/api/accounts/${account.code}/photo/${slot.field}` : null;
          const displayLabel = slot.hasCustomLabel ? labels[(slot.field + 'Label') as 'photo1Label' | 'photo2Label'] || slot.label : slot.label;
          return (
            <div key={slot.field} className="panel" style={{ marginBottom: 0 }}>
              <div className="panel-head">{displayLabel}</div>
              <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {slot.hasCustomLabel && (
                  <input
                    className="field-input"
                    placeholder={`Label for ${slot.label}`}
                    value={labels[(slot.field + 'Label') as 'photo1Label' | 'photo2Label']}
                    onChange={(e) => setLabels((prev) => ({ ...prev, [(slot.field + 'Label') as 'photo1Label' | 'photo2Label']: e.target.value }))}
                  />
                )}
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                    <img src={url} alt={displayLabel} style={{ maxWidth: '100%', maxHeight: 180, border: '1px solid var(--c-border)', borderRadius: 4 }} />
                  </a>
                ) : (
                  <div className="empty-state" style={{ padding: 16 }}>No photo uploaded.</div>
                )}
                <div className="row" style={{ gap: 8 }}>
                  <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                    {busy === slot.field ? 'Uploading…' : (path ? 'Replace' : 'Upload')}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      disabled={busy !== null}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(slot.field, f); e.target.value = ''; }}
                    />
                  </label>
                  {path && (
                    <button className="btn btn-sm btn-danger" onClick={() => remove(slot.field)} disabled={busy !== null}>Remove</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}
