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
  const [editing, setEditing] = useState<Account | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try { setTree(await api.get<Account[]>('/api/accounts')); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load accounts.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onAdd = (parent: Account | null) => {
    setEditing(null);
    setParentId(parent ? parent.id : null);
    setShowForm(true);
  };
  const onEdit = (a: Account) => { setEditing(a); setParentId(a.parentId); setShowForm(true); };
  const onDelete = async (a: Account) => {
    if (!confirm(`Delete account ${a.code} — ${a.name}? This cannot be undone.`)) return;
    try { await api.del(`/api/accounts/${a.id}`); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed.'); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Chart of Accounts</div>
          <div className="page-subtitle">Tree of accounts, customers and suppliers by nature.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => onAdd(null)}>New root account</button>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="panel">
        <div className="panel-body">
          {loading ? <div className="empty-state">Loading…</div> : (
            tree.length === 0
              ? <div className="empty-state">No accounts yet.</div>
              : <AccountTreeNodes nodes={tree} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
          )}
        </div>
      </div>

      {showForm && (
        <AccountForm existing={editing} parentId={parentId} onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />
      )}
    </div>
  );
}

function AccountTreeNodes({
  nodes, onAdd, onEdit, onDelete,
}: {
  nodes: TreeNode[];
  onAdd: (a: Account | null) => void;
  onEdit: (a: Account) => void;
  onDelete: (a: Account) => void;
}) {
  return (
    <ul className="tree">
      {nodes.map((a) => (
        <li className="tree-node" key={a.id}>
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
              <button className="btn btn-sm btn-ghost" onClick={() => onDelete(a)}>Delete</button>
            </span>
          </div>
          {a.children && a.children.length > 0 && (
            <ul className="tree-children">
              <AccountTreeNodes nodes={a.children} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function AccountForm({
  existing, parentId, onClose, onSaved,
}: {
  existing: Account | null;
  parentId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [nature, setNature] = useState<typeof NATURES[number]>(existing?.nature || 'ASSET');
  const [isGroup, setIsGroup] = useState(existing?.isGroup ?? false);
  const [isCash, setIsCash] = useState(existing?.isCash ?? false);
  const [isBank, setIsBank] = useState(existing?.isBank ?? false);
  const [partyType, setPartyType] = useState<'NONE' | 'CUSTOMER' | 'SUPPLIER'>(existing?.partyType || 'NONE');
  const [contactPerson, setContactPerson] = useState(existing?.contactPerson || '');
  const [partyAddress, setPartyAddress] = useState(existing?.partyAddress || '');
  const [partyPhone, setPartyPhone] = useState(existing?.partyPhone || '');
  const [partyEmail, setPartyEmail] = useState(existing?.partyEmail || '');
  const [partyNtnCnic, setPartyNtnCnic] = useState(existing?.partyNtnCnic || '');
  const [creditDays, setCreditDays] = useState<string>(existing?.creditDays ? String(existing.creditDays) : '');
  const [creditLimit, setCreditLimit] = useState<string>(existing?.creditLimit ? String(existing.creditLimit) : '');
  const [bankName, setBankName] = useState(existing?.bankName || '');
  const [bankAccountNo, setBankAccountNo] = useState(existing?.bankAccountNo || '');
  const [bankBranch, setBankBranch] = useState(existing?.bankBranch || '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name) { setError('Name is required.'); return; }

    const payload: any = {
      name, nature, isGroup, isCash, isBank, partyType,
      contactPerson: contactPerson || null,
      partyAddress: partyAddress || null,
      partyPhone: partyPhone || null,
      partyEmail: partyEmail || null,
      partyNtnCnic: partyNtnCnic || null,
      creditDays: creditDays ? parseInt(creditDays, 10) : null,
      creditLimit: creditLimit ? parseFloat(creditLimit) : null,
      bankName: bankName || null,
      bankAccountNo: bankAccountNo || null,
      bankBranch: bankBranch || null,
      isActive,
    };

    setBusy(true);
    try {
      if (existing) await api.put(`/api/accounts/${existing.id}`, payload);
      else await api.post('/api/accounts', { parentId, ...payload });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed.'); }
    finally { setBusy(false); }
  };

  const isParty = partyType !== 'NONE';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: 16 }}>
      <form className="panel" style={{ width: 720, maxWidth: '95vw' }} onSubmit={submit}>
        <div className="panel-head">{existing ? 'Edit account' : 'New account'}</div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Name <span className="req">*</span></label>
              <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label className="field-label">Nature</label>
              <select className="field-select" value={nature} onChange={(e) => setNature(e.target.value as typeof NATURES[number])}
                      disabled={!!parentId /* inherit from parent */}>
                {NATURES.map((n) => <option key={n} value={n}>{NATURE_LABEL[n]}</option>)}
              </select>
              {parentId ? <div className="field-hint">Inherited from parent.</div> : null}
            </div>
            <div className="field">
              <label className="field-label">Type</label>
              <select className="field-select" value={isGroup ? 'GROUP' : 'POSTING'}
                      onChange={(e) => setIsGroup(e.target.value === 'GROUP')}
                      disabled={!!existing}>
                <option value="GROUP">Group (cannot post)</option>
                <option value="POSTING">Posting (leaf)</option>
              </select>
              {existing ? <div className="field-hint">Type cannot change after creation.</div> : null}
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
                <span>Mark as a cash account</span>
              </label>
            </div>
            <div className="field">
              <label className="field-label">Bank account</label>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={isBank} onChange={(e) => setIsBank(e.target.checked)} disabled={isGroup} />
                <span>Mark as a bank account</span>
              </label>
            </div>
          </div>

          {isParty && (
            <>
              <h4 style={{ marginTop: 16, marginBottom: 8 }}>Party details</h4>
              <div className="form-grid">
                <div className="field"><label className="field-label">Contact person</label><input className="field-input" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></div>
                <div className="field"><label className="field-label">Address</label><input className="field-input" value={partyAddress} onChange={(e) => setPartyAddress(e.target.value)} /></div>
                <div className="field"><label className="field-label">Phone</label><input className="field-input" value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} /></div>
                <div className="field"><label className="field-label">Email</label><input className="field-input" value={partyEmail} onChange={(e) => setPartyEmail(e.target.value)} /></div>
                <div className="field"><label className="field-label">NTN / CNIC</label><input className="field-input" value={partyNtnCnic} onChange={(e) => setPartyNtnCnic(e.target.value)} /></div>
                <div className="field"><label className="field-label">Credit days</label><input className="field-input" type="number" value={creditDays} onChange={(e) => setCreditDays(e.target.value)} /></div>
                <div className="field"><label className="field-label">Credit limit</label><input className="field-input" type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} /></div>
              </div>
            </>
          )}

          {isBank && (
            <>
              <h4 style={{ marginTop: 16, marginBottom: 8 }}>Bank details</h4>
              <div className="form-grid">
                <div className="field"><label className="field-label">Bank name</label><input className="field-input" value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
                <div className="field"><label className="field-label">Account number</label><input className="field-input" value={bankAccountNo} onChange={(e) => setBankAccountNo(e.target.value)} /></div>
                <div className="field"><label className="field-label">Branch</label><input className="field-input" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} /></div>
              </div>
            </>
          )}

          {existing && (
            <div className="field" style={{ marginTop: 12 }}>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span>Active</span>
              </label>
            </div>
          )}

          {error && <div className="inline-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderBottom: 0 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{existing ? 'Save changes' : 'Create account'}</button>
        </div>
      </form>
    </div>
  );
}
