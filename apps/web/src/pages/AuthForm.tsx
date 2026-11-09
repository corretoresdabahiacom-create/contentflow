import { useCallback, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { deriveAuthKey } from '@contentflow/shared';
import { Turnstile } from '../components/Turnstile';
import { Limitation } from '../limitations/Limitation';
import { api, ApiRequestError } from '../lib/api';
import { ERROR_LIMITATION_MAP } from '../lib/errors';
import { useServerConfig } from '../lib/session';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { t, i18n } = useTranslation();
  const cfg = useServerConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; limitation?: string } | null>(null);
  const onToken = useCallback((v: string | null) => setToken(v), []);

  const c = cfg.data;
  // R4: a UI reflete o estado real. Sem configuração, o formulário não envia nada.
  const blocked = !!c && (!c.authConfigured || c.turnstile.mode === 'not_configured');
  const tokenToSend = c?.turnstile.mode === 'dev_bypass' ? 'dev-bypass' : token;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!c || blocked) return;
    if (password.length < 10) return setError({ code: 'tooShort' });
    if (!tokenToSend) return setError({ code: 'turnstileWaiting' });
    setBusy(true);
    try {
      const authKey = await deriveAuthKey(email, password, c.authKdfIterations);
      await api(`/api/auth/${mode}`, {
        method: 'POST',
        json: {
          email,
          authKey,
          turnstileToken: tokenToSend,
          ...(mode === 'register'
            ? {
                locale: i18n.resolvedLanguage === 'pt' ? 'pt' : 'en',
                displayName: displayName || undefined,
              }
            : {}),
        },
      });
      setPassword('');
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/app');
    } catch (err) {
      const e2 = err instanceof ApiRequestError ? err : null;
      setError({ code: e2?.code ?? 'internal_error', limitation: e2?.limitation });
    } finally {
      setBusy(false);
    }
  };

  const errText = error
    ? error.code === 'tooShort' || error.code === 'turnstileWaiting'
      ? t(error.code === 'tooShort' ? 'auth.tooShort' : 'auth.turnstileWaiting')
      : t(`errors.${error.code}`, { defaultValue: t('errors.internal_error') })
    : null;
  const limitationId = error ? (error.limitation ?? ERROR_LIMITATION_MAP[error.code]) : undefined;

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">
        {t(mode === 'login' ? 'auth.loginTitle' : 'auth.registerTitle')}
      </h1>

      {c && !c.authConfigured && (
        <p role="alert" className="card border-red-300 text-sm">
          <strong>{t('auth.notConfigured')}.</strong> {t('auth.authNotConfigured')}
        </p>
      )}
      {c && c.authConfigured && c.turnstile.mode === 'not_configured' && (
        <p role="alert" className="card border-red-300 text-sm">
          <strong>{t('auth.notConfigured')}.</strong> {t('auth.turnstileNotConfigured')}
        </p>
      )}
      {c?.turnstile.mode === 'dev_bypass' && (
        <p role="note" className="card border-amber-300 text-sm">
          {t('auth.devBypass')}
        </p>
      )}
      {cfg.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('errors.network')}
        </p>
      )}

      <form onSubmit={submit} className="space-y-4" noValidate>
        {mode === 'register' && (
          <div>
            <label htmlFor="name" className="mb-1 block text-sm">
              {t('auth.displayName')}
            </label>
            <input
              id="name"
              className="input"
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm">
            {t('auth.email')}
          </label>
          <input
            id="email"
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm">
            {t('auth.password')}
          </label>
          <input
            id="password"
            type="password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && (
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              {t('auth.passwordHint')}
            </p>
          )}
        </div>
        {c?.turnstile.mode === 'enforced' && c.turnstile.siteKey && (
          <Turnstile siteKey={c.turnstile.siteKey} onToken={onToken} />
        )}
        {errText && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {errText}
          </p>
        )}
        {limitationId && <Limitation id={limitationId} variant="inline" />}
        <button className="btn w-full" type="submit" disabled={busy || blocked || !c}>
          {busy ? t('auth.working') : t('auth.submit')}
        </button>
      </form>

      <p className="text-sm">
        {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
        <Link to={mode === 'login' ? '/register' : '/login'}>
          {t(mode === 'login' ? 'nav.register' : 'nav.login')}
        </Link>
      </p>
    </section>
  );
}
