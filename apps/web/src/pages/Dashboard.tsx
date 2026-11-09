import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Workspace } from './Workspace';
import { Limitation } from '../limitations/Limitation';
import { useMe, useServerConfig } from '../lib/session';

export function Dashboard() {
  const { t } = useTranslation();
  const me = useMe();
  const cfg = useServerConfig();
  if (me.isLoading) return <p>…</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  const c = cfg.data;
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 border-b border-neutral-200 py-2 text-sm dark:border-neutral-800">
      <dt>{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {t('dashboard.welcome', { email: me.data.user.email })}
        </p>
      </header>
      <div>
        <h2 className="mb-2 text-lg font-medium">{t('dashboard.workspaces')}</h2>
        <ul className="space-y-2">
          {me.data.workspaces.map((w) => (
            <li key={w.id} className="card text-sm">
              <strong>{w.name}</strong> · {t(`dashboard.${w.kind}`)} · {t('dashboard.role')}:{' '}
              {w.role}
            </li>
          ))}
        </ul>
      </div>
      {me.data.workspaces[0] && (
        <div>
          <h2 className="mb-2 text-lg font-medium">{t('dashboard.clients')}</h2>
          <Workspace ws={me.data.workspaces[0].id} role={me.data.workspaces[0].role} />
        </div>
      )}
      <div>
        <h2 className="mb-2 text-lg font-medium">{t('dashboard.platform')}</h2>
        {c && (
          <dl className="max-w-md">
            {row(
              t('dashboard.auth'),
              c.authConfigured ? t('dashboard.ok') : t('auth.notConfigured'),
            )}
            {row(
              t('dashboard.bot'),
              c.turnstile.mode === 'enforced'
                ? t('dashboard.ok')
                : c.turnstile.mode === 'dev_bypass'
                  ? 'dev'
                  : t('auth.notConfigured'),
            )}
            {row(t('dashboard.billing'), t('dashboard.billingOff'))}
            {row(t('dashboard.uploads'), t('dashboard.uploadsOff'))}
          </dl>
        )}
        <div className="mt-3">
          <Limitation id="upload-de-midia" variant="inline" />
        </div>
      </div>
    </section>
  );
}
