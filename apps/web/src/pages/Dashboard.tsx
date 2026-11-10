import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ApprovalsInbox } from '../components/Approvals';
import { ErrorNote } from '../components/ErrorNote';
import { api } from '../lib/api';
import { Workspace } from './Workspace';
import { Limitation } from '../limitations/Limitation';
import { useMe, useServerConfig } from '../lib/session';

export function Dashboard() {
  const { t } = useTranslation();
  const me = useMe();
  const cfg = useServerConfig();
  const qc = useQueryClient();
  const [picked, setPicked] = useState('');
  const [teamName, setTeamName] = useState('');
  const createTeam = useMutation({
    mutationFn: () => api<{ id: string }>('/api/workspaces', { method: 'POST', json: { name: teamName } }),
    onSuccess: async (r) => { setTeamName(''); await qc.invalidateQueries({ queryKey: ['me'] }); setPicked(r.id); },
  });
  if (me.isLoading) return <p>…</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  const c = cfg.data;
  const active = me.data.workspaces.find((w) => w.id === picked) ?? me.data.workspaces[0];
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
      <form className="flex max-w-md gap-2" aria-label={t('team.create')} onSubmit={(e) => { e.preventDefault(); if (teamName.trim()) createTeam.mutate(); }}>
        <label className="sr-only" htmlFor="team-name">{t('team.createName')}</label>
        <input id="team-name" className="input" value={teamName} maxLength={80} placeholder={t('team.createName')} onChange={(e) => setTeamName(e.target.value)} />
        <button className="btn btn-secondary" disabled={createTeam.isPending || !teamName.trim()}>{t('team.create')}</button>
      </form>
      <ErrorNote error={createTeam.error} />
      {active && (
        <div className="space-y-6">
          {me.data.workspaces.length > 1 && (
            <div>
              <label className="block text-sm" htmlFor="ws-pick">{t('dashboard.activeWorkspace')}</label>
              <select id="ws-pick" className="input !w-auto" value={active.id} onChange={(e) => setPicked(e.target.value)}>
                {me.data.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} ({t(`dashboard.${w.kind}`)})</option>)}
              </select>
            </div>
          )}
          <p className="text-sm"><Link to={`/app/w/${active.id}/team`}>{t('team.open')}</Link></p>
          <div>
            <h2 className="mb-2 text-lg font-medium">{t('dashboard.clients')}</h2>
            <Workspace key={active.id} ws={active.id} role={active.role} />
          </div>
          <div>
            <h2 className="mb-2 text-lg font-medium">{t('appr.heading')}</h2>
            <ApprovalsInbox key={active.id} ws={active.id} canDecide={active.role === 'owner' || active.role === 'admin'} />
          </div>
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
