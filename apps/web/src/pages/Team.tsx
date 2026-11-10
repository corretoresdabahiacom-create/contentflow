import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { ErrorNote } from '../components/ErrorNote';
import { api } from '../lib/api';
import { useMe } from '../lib/session';

type Member = { id: string; userId: string; role: 'owner' | 'admin' | 'member'; email: string; displayName: string | null; isYou: boolean };
type Invite = { id: string; role: string; expiresAt: number };
type Created = { token: string; path: string; role: string; expiresAt: number };

export function Team() {
  const { t } = useTranslation();
  const { ws = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [days, setDays] = useState(7);
  const [created, setCreated] = useState<Created | null>(null);
  const mine = me.data?.workspaces.find((w) => w.id === ws);
  const isAdmin = mine?.role === 'owner' || mine?.role === 'admin';
  const isOwner = mine?.role === 'owner';
  const base = `/api/workspaces/${ws}`;

  const members = useQuery({ queryKey: ['members', ws], enabled: !!mine, queryFn: () => api<{ members: Member[] }>(`${base}/members`) });
  const invites = useQuery({ queryKey: ['invites', ws], enabled: !!mine && isAdmin && mine.kind === 'agency', queryFn: () => api<{ invites: Invite[] }>(`${base}/invites`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['members', ws] }); void qc.invalidateQueries({ queryKey: ['invites', ws] }); void qc.invalidateQueries({ queryKey: ['me'] }); };
  const setMemberRole = useMutation({ mutationFn: (v: { id: string; role: string }) => api(`${base}/members/${v.id}`, { method: 'PATCH', json: { role: v.role } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`${base}/members/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const invite = useMutation({
    mutationFn: () => api<Created>(`${base}/invites`, { method: 'POST', json: { role, expiresInDays: days } }),
    onSuccess: (r) => { setCreated(r); refresh(); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`${base}/invites/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  if (me.isLoading) return <p>…</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  if (!mine) return <p role="alert">{t('team.notFound')}</p>;
  const link = created ? `${window.location.origin}${created.path}` : '';

  return (
    <section className="space-y-6" aria-label={t('team.heading')}>
      <header>
        <p className="text-sm"><Link to="/app">← {t('team.back')}</Link></p>
        <h1 className="text-2xl font-semibold">{t('team.heading')}: {mine.name}</h1>
      </header>
      {mine.kind === 'personal' && <p className="text-sm">{t('team.personalNote')}</p>}

      <div className="space-y-2">
        <h2 className="text-lg font-medium">{t('team.members')}</h2>
        <ul className="space-y-2">
          {members.data?.members.map((m) => (
            <li key={m.id} className="card flex flex-wrap items-center justify-between gap-2 text-sm" aria-label={m.email}>
              <span>{m.displayName ? `${m.displayName} · ` : ''}{m.email}{m.isYou ? ` (${t('team.you')})` : ''}</span>
              <span className="flex items-center gap-2">
                {isOwner && m.role !== 'owner' ? (
                  <>
                    <label className="sr-only" htmlFor={`r-${m.id}`}>{t('team.roleOf', { email: m.email })}</label>
                    <select id={`r-${m.id}`} className="input !w-auto" value={m.role} onChange={(e) => setMemberRole.mutate({ id: m.id, role: e.target.value })}>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </>
                ) : <span className="rounded border px-2 py-0.5 text-xs">{m.role}</span>}
                {m.role !== 'owner' && (m.isYou || isAdmin) && (m.isYou || isOwner || m.role === 'member') && (
                  <button className="text-xs underline" onClick={() => { if (window.confirm(m.isYou ? t('team.confirmLeave') : t('team.confirmRemove', { email: m.email }))) remove.mutate(m.id); }}>
                    {m.isYou ? t('team.leave') : t('team.remove')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <ErrorNote error={setMemberRole.error ?? remove.error} />
      </div>

      {isAdmin && mine.kind === 'agency' && (
        <div className="space-y-3">
          <h2 className="text-lg font-medium">{t('team.invites')}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('team.inviteHelp')}</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
            <div>
              <label className="block text-sm" htmlFor="inv-role">{t('team.inviteRole')}</label>
              <select id="inv-role" className="input !w-auto" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
                <option value="member">member</option>
                {isOwner && <option value="admin">admin</option>}
              </select>
            </div>
            <div>
              <label className="block text-sm" htmlFor="inv-days">{t('team.inviteDays')}</label>
              <input id="inv-days" type="number" min={1} max={30} className="input !w-24" value={days} onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
            <button className="btn" disabled={invite.isPending}>{t('team.createInvite')}</button>
          </form>
          <ErrorNote error={invite.error ?? revoke.error} />
          {created && (
            <div className="card space-y-2" role="status" aria-label={t('team.newLink')}>
              <p className="text-sm font-medium">{t('team.newLink')} ({created.role})</p>
              <input className="input" readOnly value={link} aria-label={t('team.linkField')} onFocus={(e) => e.currentTarget.select()} />
              <p className="text-sm">{t('team.linkOnce')}</p>
              <button className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(link)}>{t('team.copy')}</button>
            </div>
          )}
          {invites.data?.invites.length === 0 && <p className="text-sm">{t('team.noInvites')}</p>}
          <ul className="space-y-2">
            {invites.data?.invites.map((i) => (
              <li key={i.id} className="card flex items-center justify-between gap-2 text-sm">
                <span>{t('team.pendingInvite', { role: i.role, date: new Date(i.expiresAt).toLocaleDateString() })}</span>
                <button className="text-xs underline" onClick={() => revoke.mutate(i.id)}>{t('team.revoke')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
