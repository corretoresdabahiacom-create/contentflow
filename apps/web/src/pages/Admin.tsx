import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ErrorNote } from '../components/ErrorNote';
import { api } from '../lib/api';
import { useMe } from '../lib/session';

const TABS = ['overview', 'users', 'workspaces', 'projects', 'jobs', 'reports', 'flags', 'quotas', 'audit'] as const;
type Tab = (typeof TABS)[number];
type Quota = { key: string; limit: number; peak: number | null; pct: number | null; level: string };

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const short = (id: string | null) => (id ? id.slice(0, 8) : '—');

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col" className="border-b px-2 py-1 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-neutral-200 px-2 py-1 align-top dark:border-neutral-800">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Painel global. Só metadados (a API não devolve conteúdo privado). Não-admin vê 404 na API e é mandado para /app. */
export function Admin() {
  const { t } = useTranslation();
  const me = useMe();
  const [tab, setTab] = useState<Tab>('overview');
  if (me.isLoading) return <p>…</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  if (!me.data.user.isGlobalAdmin) return <Navigate to="/app" replace />;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
      <p className="card text-sm">{t('admin.onlyMeta')}</p>
      <div role="tablist" aria-label={t('admin.title')} className="flex flex-wrap gap-2">
        {TABS.map((k) => (
          <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="admin-panel" className={`btn ${tab === k ? '' : 'btn-secondary'}`} onClick={() => setTab(k)}>
            {t(`admin.tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="admin-panel" aria-labelledby={`tab-${tab}`} className="space-y-4">
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <Users />}
        {tab === 'workspaces' && <Workspaces />}
        {tab === 'projects' && <Projects />}
        {tab === 'jobs' && <Jobs />}
        {tab === 'reports' && <Reports />}
        {tab === 'flags' && <Flags />}
        {tab === 'quotas' && <Quotas />}
        {tab === 'audit' && <Audit />}
      </div>
    </section>
  );
}

function Overview() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api<{ tables: Record<string, number>; jobs: { stuck: number; failedLast7d: number }; sourceFiles: { count: number; bytes: number }; openReports: number; alerts: { key: string; level: string; pct: number }[] }>('/api/admin/overview'),
  });
  if (q.error) return <ErrorNote error={q.error} />;
  const o = q.data;
  if (!o) return <p>…</p>;
  const stat = (label: string, v: string | number) => (
    <div className="card"><dt className="text-xs">{label}</dt><dd className="text-2xl font-semibold">{v}</dd></div>
  );
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat(t('admin.stuck'), o.jobs.stuck)}
        {stat(t('admin.failed7'), o.jobs.failedLast7d)}
        {stat(t('admin.openReports'), o.openReports)}
        {stat(t('admin.files'), o.sourceFiles.count)}
      </dl>
      <p className="text-xs">{t('admin.filesNote')}</p>
      <h2 className="font-medium">{t('admin.alerts')}</h2>
      {o.alerts.length === 0 ? <p className="text-sm">{t('admin.noAlerts')}</p> : (
        <ul className="text-sm">{o.alerts.map((a) => <li key={a.key + a.level}>{a.key}: {a.pct}% · {t(`admin.level.${a.level}`)}</li>)}</ul>
      )}
      <h2 className="font-medium">{t('admin.external')}</h2>
      <dl className="text-sm">
        {(['workersRequests', 'd1Reads', 'd1Writes'] as const).map((k) => <div key={k} className="flex flex-wrap gap-2 border-b py-1"><dt className="font-medium">{t(`admin.${k}`)}</dt><dd>{t('admin.unavailable')}</dd></div>)}
        <div className="flex flex-wrap gap-2 border-b py-1"><dt className="font-medium">{t('admin.r2label')}</dt><dd>{t('admin.r2')}</dd></div>
      </dl>
      <h2 className="font-medium">{t('admin.tables')}</h2>
      <Table head={['table', 'rows']} rows={Object.entries(o.tables).map(([k, v]) => [k, v])} empty={t('admin.noRows')} />
    </>
  );
}

function Users() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<{ users: { id: string; email: string; status: string; isGlobalAdmin: boolean; createdAt: number; workspaces: number }[] }>('/api/admin/users') });
  const set = useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'suspended' }) => api(`/api/admin/users/${v.id}`, { method: 'PATCH', json: { status: v.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
  return (
    <>
      <ErrorNote error={q.error ?? set.error} />
      <Table empty={t('admin.noRows')} head={[t('admin.email'), t('admin.status'), t('admin.tabs.workspaces'), t('admin.created'), t('admin.action')]}
        rows={(q.data?.users ?? []).map((u) => [
          <>{u.email}{u.isGlobalAdmin ? ` (${t('admin.isAdmin')})` : ''}</>, u.status, u.workspaces, when(u.createdAt),
          u.isGlobalAdmin ? '—' : <button className="underline" onClick={() => set.mutate({ id: u.id, status: u.status === 'active' ? 'suspended' : 'active' })}>{u.status === 'active' ? t('admin.suspend') : t('admin.activate')}</button>,
        ])} />
    </>
  );
}

function Workspaces() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'ws'], queryFn: () => api<{ workspaces: { id: string; name: string; kind: string; createdAt: number; members: number; clients: number; projects: number; activeLinks: number }[] }>('/api/admin/workspaces') });
  return (
    <>
      <ErrorNote error={q.error} />
      <Table empty={t('admin.noRows')} head={['id', t('admin.kind'), t('admin.members'), t('admin.clients'), t('admin.projectsCol'), t('admin.links'), t('admin.created')]}
        rows={(q.data?.workspaces ?? []).map((w) => [short(w.id), w.kind, w.members, w.clients, w.projects, w.activeLinks, when(w.createdAt)])} />
    </>
  );
}

function Projects() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'projects'], queryFn: () => api<{ projects: { id: string; workspaceId: string; status: string; createdAt: number; sourceFiles: number; bytes: number; outputs: number }[] }>('/api/admin/projects') });
  return (
    <>
      <ErrorNote error={q.error} />
      <Table empty={t('admin.noRows')} head={['id', t('admin.wsCol'), t('admin.status'), t('admin.files_'), t('admin.bytes'), t('admin.outputs'), t('admin.created')]}
        rows={(q.data?.projects ?? []).map((p) => [short(p.id), short(p.workspaceId), p.status, p.sourceFiles, p.bytes, p.outputs, when(p.createdAt)])} />
    </>
  );
}

function Jobs() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'stuck' | 'failed'>('stuck');
  const q = useQuery({ queryKey: ['admin', 'jobs', filter], queryFn: () => api<{ jobs: { id: string; workspaceId: string; kind: string; status: string; attempts: number; errorCode: string | null; updatedAt: number }[] }>(`/api/admin/jobs?filter=${filter}`) });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/api/admin/jobs/${id}/cancel`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'jobs'] }) });
  return (
    <>
      <div className="flex gap-2">
        {(['stuck', 'failed'] as const).map((f) => <button key={f} aria-pressed={filter === f} className={`btn ${filter === f ? '' : 'btn-secondary'}`} onClick={() => setFilter(f)}>{t(f === 'stuck' ? 'admin.stuckFilter' : 'admin.failedFilter')}</button>)}
      </div>
      <ErrorNote error={q.error ?? cancel.error} />
      <Table empty={t('admin.noRows')} head={['id', t('admin.wsCol'), t('admin.kind'), t('admin.status'), t('admin.attempts'), t('admin.error'), t('admin.when'), t('admin.action')]}
        rows={(q.data?.jobs ?? []).map((j) => [short(j.id), short(j.workspaceId), j.kind, j.status, j.attempts, j.errorCode ?? '—', when(j.updatedAt),
          filter === 'stuck' ? <button className="underline" onClick={() => cancel.mutate(j.id)}>{t('admin.cancelJob')}</button> : '—'])} />
    </>
  );
}

type Detail = {
  id: string; reason: string; urgent: boolean; status: string; details: string | null; ownerNotifiedAt: number | null; resolution: string | null; canRevoke: boolean;
  target: null | { workspaceName: string | null; active: boolean; samples: { id: string; channel: string; title: string | null; sample: string }[] };
};

function Reports() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'reports'], queryFn: () => api<{ reports: { id: string; reason: string; urgent: boolean; status: string; ownerNotifiedAt: number | null; createdAt: number }[] }>('/api/admin/reports') });
  return (
    <>
      <ErrorNote error={q.error} />
      <Table empty={t('admin.noRows')} head={['id', t('admin.reason'), t('admin.status'), t('admin.notified'), t('admin.created'), t('admin.action')]}
        rows={(q.data?.reports ?? []).map((r) => [short(r.id), <>{t(`report.reasons.${r.reason}`)}{r.urgent ? ` · ${t('admin.urgent')}` : ''}</>, r.status, r.ownerNotifiedAt ? when(r.ownerNotifiedAt) : '—', when(r.createdAt),
          <button className="underline" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>{t('admin.open')}</button>])} />
      {open && <ReportDetail id={open} onDone={() => { setOpen(null); void q.refetch(); }} />}
    </>
  );
}

function ReportDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ['admin', 'report', id], queryFn: () => api<Detail>(`/api/admin/reports/${id}`) });
  const act = useMutation({
    mutationFn: (v: { path: string; json?: unknown }) => api(`/api/admin/reports/${id}/${v.path}`, { method: 'POST', json: v.json }),
    onSuccess: (_d, v) => (v.path === 'notify-owner' ? q.refetch() : onDone()),
  });
  const d = q.data;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!d) return <p>…</p>;
  const closed = d.status === 'resolved' || d.status === 'dismissed';
  return (
    <div className="card space-y-3" aria-label={t('admin.tabs.reports')}>
      <p className="text-sm"><b>{t(`report.reasons.${d.reason}`)}</b>{d.urgent ? ` · ${t('admin.urgent')}` : ''}</p>
      {d.details && <p className="text-sm"><span className="font-medium">{t('admin.details')}:</span> {d.details}</p>}
      {d.target ? (
        <div className="space-y-1 text-sm">
          <p>{t('admin.target')}: {d.target.workspaceName ?? '—'} · {d.target.active ? t('admin.active') : t('admin.inactive')}</p>
          <p className="text-xs">{t('admin.samples')}</p>
          <ul className="list-disc pl-5">{d.target.samples.map((s) => <li key={s.id}>{s.channel}{s.title ? ` · ${s.title}` : ''}: {s.sample}</li>)}</ul>
        </div>
      ) : <p className="text-sm">{t('admin.noTarget')}</p>}
      {closed ? <p role="status" className="text-sm">{t('admin.closed', { res: d.resolution ?? d.status })}</p> : (
        <>
          <label htmlFor="rd-note" className="block text-sm">{t('admin.note')}</label>
          <input id="rd-note" className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {d.target && !d.urgent && <button className="btn btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ path: 'notify-owner' })}>{t('admin.notifyOwner')}</button>}
            <button className="btn btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ path: 'resolve', json: { action: 'dismiss', note: note || undefined } })}>{t('admin.dismiss')}</button>
          </div>
          {d.target?.active && (
            <div className="space-y-2 border-t pt-2">
              {!d.canRevoke && <p className="text-sm">{t('admin.needNotice')}</p>}
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} disabled={!d.canRevoke} onChange={(e) => setConfirm(e.target.checked)} />{t('admin.confirmRevoke')}</label>
              <button className="btn" disabled={!d.canRevoke || !confirm || act.isPending} onClick={() => act.mutate({ path: 'resolve', json: { action: 'revoke_link', confirm: true, note: note || undefined } })}>{t('admin.revoke')}</button>
            </div>
          )}
        </>
      )}
      <ErrorNote error={act.error} />
    </div>
  );
}

function Flags() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'flags'], queryFn: () => api<{ flags: { key: string; enabled: boolean; description: string | null; locked: string | null }[] }>('/api/admin/flags') });
  const set = useMutation({ mutationFn: (v: { key: string; enabled: boolean }) => api(`/api/admin/flags/${v.key}`, { method: 'PATCH', json: { enabled: v.enabled } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'flags'] }) });
  return (
    <>
      <ErrorNote error={q.error ?? set.error} />
      <ul className="space-y-2">
        {(q.data?.flags ?? []).map((f) => (
          <li key={f.key} className="card flex flex-wrap items-center justify-between gap-2 text-sm">
            <span><b>{f.key}</b><br />{f.description}{f.locked && <><br /><em>{t('admin.locked')}: {f.locked}</em></>}</span>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.enabled} disabled={!!f.locked || set.isPending} onChange={(e) => set.mutate({ key: f.key, enabled: e.target.checked })} />
              {t('admin.enabled')}
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

function Quotas() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<{ settings: { key: string; value: number }[]; quotas: Quota[] }>('/api/admin/settings') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (k: string) => api(`/api/admin/settings/${k}`, { method: 'PATCH', json: { value: Number(draft[k]) } }),
    onSuccess: async () => { setSaved(true); await qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); },
  });
  const peak = (k: string) => q.data?.quotas.find((x) => x.key === k);
  return (
    <>
      <p className="text-sm">{t('admin.quotaNote')}</p>
      <ErrorNote error={q.error ?? save.error} />
      {saved && !save.error && <p role="status" className="text-sm">{t('admin.saved')}</p>}
      <Table empty={t('admin.noRows')} head={[t('admin.quotaKey'), t('admin.limit'), t('admin.peak'), t('admin.status'), t('admin.action')]}
        rows={(q.data?.settings ?? []).map((s) => {
          const m = peak(s.key);
          return [s.key,
            <><label className="sr-only" htmlFor={`s-${s.key}`}>{s.key}</label><input id={`s-${s.key}`} className="input !w-28" inputMode="numeric" value={draft[s.key] ?? String(s.value)} onChange={(e) => { setSaved(false); setDraft({ ...draft, [s.key]: e.target.value }); }} /></>,
            m && m.peak !== null ? `${m.peak} (${m.pct}%)` : '—', m ? t(`admin.level.${m.level}`) : '—',
            <button className="underline" disabled={save.isPending || draft[s.key] === undefined} onClick={() => save.mutate(s.key)}>{t('admin.save')}</button>];
        })} />
    </>
  );
}

function Audit() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<{ events: { id: string; action: string; userId: string | null; workspaceId: string | null; targetKind: string | null; createdAt: number }[] }>('/api/admin/audit') });
  return (
    <>
      <ErrorNote error={q.error} />
      <Table empty={t('admin.noRows')} head={[t('admin.when'), t('admin.action'), t('admin.who'), t('admin.wsCol'), t('admin.target')]}
        rows={(q.data?.events ?? []).map((e) => [when(e.createdAt), e.action, short(e.userId), short(e.workspaceId), e.targetKind ?? '—'])} />
    </>
  );
}
