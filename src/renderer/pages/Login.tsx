import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/app-context';
import { Button, useToast } from '../components/primitives';
import { Field, Input } from '../components/forms';
import { ClinicLogo, ClinicName } from '../components/clinic-brand';
import { PRODUCT_NAME } from '../../shared/branding';
import type { ClinicSettings } from '../../shared/types';
import { api, useAsync } from '../api';

export function LoginPage() {
  const { login, system, settings } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const { data: publicSettings } = useAsync(() => api['settings/get'](), []);
  // Branding is the only thing the unauthenticated settings endpoint exposes.
  const clinic: ClinicSettings | undefined =
    publicSettings && 'clinic' in publicSettings ? publicSettings.clinic : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Enter your username and password.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await login(username, password);
      if (res.ok) {
        navigate('/');
        toast.success('Welcome back');
      } else if (res.reason === 'locked') {
        const mins = Math.max(1, Math.ceil((res.retryAfterMs ?? 60000) / 60000));
        setError(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
      } else if (res.reason === 'disabled') {
        setError('This account is disabled. Contact the administrator.');
      } else {
        setError('Incorrect username or password.');
      }
    } finally {
      setPending(false);
    }
  };

  void settings;

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          {/* The clinic's own identity leads; the product stays the subtitle. */}
          <ClinicLogo clinic={clinic} size={52} rounded={16} />
          <div style={{ minWidth: 0 }}>
            <div className="auth-title">
              <ClinicName clinic={clinic} />
            </div>
            <div className="auth-sub">{PRODUCT_NAME} · Dental Clinic Management</div>
          </div>
        </div>

        <div className="auth-form">
          {error && <div className="auth-error" role="alert">{error}</div>}
          <Field label="Username" required>
            {(id) => (
              <Input
                id={id}
                value={username}
                onChange={setUsername}
                autoFocus
                autoComplete="username"
                placeholder="e.g. admin"
              />
            )}
          </Field>
          <Field label="Password" required>
            {(id) => (
              <Input
                id={id}
                value={password}
                onChange={setPassword}
                type="password"
                autoComplete="current-password"
                placeholder="Your password"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" block loading={pending}>
            Sign in
          </Button>
        </div>

        <div className="auth-foot">
          Offline desktop application · v{system?.version ?? '—'}
          <br />
          Data is stored locally on this computer.
        </div>
      </form>
    </div>
  );
}
