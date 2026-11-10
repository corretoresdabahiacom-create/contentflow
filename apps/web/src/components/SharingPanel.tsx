import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { ErrorNote } from './ErrorNote';

type Out = { id: string; channel: string; kind: string; title: string | null; version: number; projectName: string };
type Link = { id: string; createdAt: number; expiresAt: number; status: 'active' | 'expired' | 'revoked'; outputs: number; views: number; lastViewedAt: number | null };
type Created = { token: string; path: string; expiresAt: number; outputs: number };
type Log = { accessedAt: number; visitor: string | null; userAgent: string | null };

function Logs({ base, id }: { base: string; id: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['sharelogs', id], queryFn: () => api<{ logs: Log[] }>(`${base}/shared-links/${id}/access-logs`) });
  if (!q.data) return <p className="text-sm">…</p>;
  if (!q.data.logs.length) return <p className="text-sm">{t('share.noLogs')}</p>;
  return (
    <ul className="text-xs space-y-1" aria-label={t('share.logs')}>
      {q.data.logs.map((l, i) => <li key={i}>{new Date(l.accessedAt).toLocaleString()} · {l.visitor ?? '—'} · {(l.userAgent ?? '').slice(0, 60)}</li>)}
    </ul>
  );
}

export function SharingPanel({ ws, clientId }: { ws: string; clientId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = `/api/workspaces/${ws}/clients/${clientId}`;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(30);
  const [confirming, setConfirming] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);

  const outs = useQuery({ queryKey: ['shareouts', base], queryFn: () => api<{ outputs: Out[] }>(`${base}/outputs`) });
  const links = useQuery({ queryKey: ['sharelinks', base], queryFn: () => api<{ links: Link[] }>(`${base}/shared-links`) });
  const create = useMutation({
    mutationFn: () => api<Created>(`${base}/shared-links`, { method: 'POST', json: { outputIds: [...picked], expiresInDays: days } }),
    onSuccess: (r) => { setCreated(r); setConfirming(false); setPicked(new Set()); void qc.invalidateQueries({ queryKey: ['sharelinks', base] }); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`${base}/shared-links/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['sharelinks', base] }) });
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); setConfirming(false); return n; });
  const titleOf = (o: Out) => `${o.projectName} · ${o.channel}/${o.kind}${o.title ? ` · ${o.title}` : ''}`;
  const link = created ? `${window.location.origin}${created.path}` : '';

  return (
    <section className="space-y-4" aria-label={t('share.heading')}>
      <h2 className="text-lg font-medium">{t('share.heading')}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('share.help')}</p>

      <fieldset className="card space-y-1">
        <legend className="px-1 text-sm font-medium">{t('share.pick')}</legend>
        {outs.data?.outputs.length === 0 && <p className="text-sm">{t('share.noOutputs')}</p>}
        {outs.data?.outputs.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} /> {titleOf(o)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-sm" htmlFor="share-days">{t('share.days')}</label>
          <input id="share-days" type="number" min={1} max={30} className="input !w-24" value={days} onChange={(e) => { setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1))); setConfirming(false); }} />
        </div>
        <button className="btn" disabled={picked.size === 0 || create.isPending} onClick={() => setConfirming(true)}>{t('share.review')}</button>
      </div>

      {confirming && (
        <div className="card space-y-2 border-amber-400" role="alertdialog" aria-label={t('share.confirmHeading')}>
          <h3 className="font-medium">{t('share.confirmHeading')}</h3>
          <p className="text-sm">{t('share.confirmPublic', { days })}</p>
          <ul className="list-disc pl-5 text-sm">
            {outs.data?.outputs.filter((o) => picked.has(o.id)).map((o) => <li key={o.id}>{titleOf(o)}</li>)}
            <li>{t('share.confirmBrand')}</li>
          </ul>
          <p className="text-sm">{t('share.confirmNever')}</p>
          <div className="flex gap-2">
            <button className="btn" disabled={create.isPending} onClick={() => create.mutate()}>{t('share.confirmCreate')}</button>
            <button className="btn btn-secondary" onClick={() => setConfirming(false)}>{t('share.cancel')}</button>
          </div>
        </div>
      )}
      <ErrorNote error={create.error ?? revoke.error} />

      {created && (
        <div className="card space-y-2" role="status" aria-label={t('share.created')}>
          <p className="text-sm font-medium">{t('share.created')}</p>
          <input className="input" readOnly value={link} aria-label={t('share.linkField')} onFocus={(e) => e.currentTarget.select()} />
          <p className="text-sm">{t('share.linkOnce', { date: new Date(created.expiresAt).toLocaleDateString() })}</p>
          <button className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(link)}>{t('team.copy')}</button>
        </div>
      )}

      <h3 className="font-medium">{t('share.links')}</h3>
      {links.data?.links.length === 0 && <p className="text-sm">{t('share.noLinks')}</p>}
      <ul className="space-y-2">
        {links.data?.links.map((l) => (
          <li key={l.id} className="card space-y-1 text-sm" aria-label={t('share.linkItem', { date: new Date(l.createdAt).toLocaleDateString() })}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t(`share.status.${l.status}`)} · {t('share.counts', { outputs: l.outputs, views: l.views })} · {t('share.expires', { date: new Date(l.expiresAt).toLocaleDateString() })}</span>
              <span className="flex gap-3">
                <button className="text-xs underline" onClick={() => setLogsFor(logsFor === l.id ? null : l.id)}>{t('share.logs')}</button>
                {l.status === 'active' && <button className="text-xs underline" onClick={() => { if (window.confirm(t('share.confirmRevoke'))) revoke.mutate(l.id); }}>{t('share.revoke')}</button>}
              </span>
            </div>
            {logsFor === l.id && <Logs base={base} id={l.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
