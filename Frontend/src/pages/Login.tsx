import { useState } from 'react';
import { api } from '../api/client';
import { User } from '../api/types';

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; user: User; needsPasswordChange?: boolean; error?: string }>('/api/login', { username, password });
      onLogin(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">Use your ERP credentials. Contact your administrator if you have trouble.</p>
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field-label" htmlFor="u">Username</label>
          <input className="field-input" id="u" value={username}
                 onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field-label" htmlFor="p">Password</label>
          <input className="field-input" id="p" type="password" value={password}
                 onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="auth-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>Sign in</button>
        </div>
      </form>
    </div>
  );
}
