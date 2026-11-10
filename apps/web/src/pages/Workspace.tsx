import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ErrorNote } from '../components/ErrorNote';
import { api } from '../lib/api';

type Client = { id: string; name: string; isImplicit: boolean };
type Project = { id: string; name: string; status: string };

function Projects({ ws, client, canAdmin }: { ws: string; client: Client; canAdmin: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const key = ['projects', ws, client.id];
  const base = `/api/workspaces/${ws}/clients/${client.id}`;
  const list = useQuery({ queryKey: key, queryFn: () => api<{ projects: Project[] }>(`${base}/projects`) });
  const create = useMutation({
    mutationFn: () => api(`${base}/projects`, { method: 'POST', json: { name } }),
    onSuccess: () => { setName(''); void qc.invalidateQueries({ queryKey: key }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`${base}/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  return (
    <div className="mt-3 space-y-2">
      {list.data?.projects.length === 0 && <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('ws.noProjects')}</p>}
      <ul className="space-y-1">
        {list.data?.projects.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
            <Link to={`/app/w/${ws}/clients/${client.id}/projects/${p.id}`}>{p.name}</Link>
            <span className="flex items-center gap-2">
              {p.status === 'archived' && <span className="text-xs">{t('ws.archived')}</span>}
              {canAdmin && (
                <button
                  className="text-xs underline"
                  aria-label={t('ws.deleteProjectAria', { name: p.name })}
                  onClick={() => { if (window.confirm(t('ws.confirmDeleteProject', { name: p.name }))) del.mutate(p.id); }}
                >
                  {t('ws.delete')}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
      >
        <label className="sr-only" htmlFor={`np-${client.id}`}>{t('ws.projectName')}</label>
        <input id={`np-${client.id}`} className="input" value={name} maxLength={80} placeholder={t('ws.projectName')} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={create.isPending || !name.trim()}>{t('ws.createProject')}</button>
      </form>
      <ErrorNote error={create.error ?? del.error} />
    </div>
  );
}

export function Workspace({ ws, role }: { ws: string; role: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const canAdmin = role === 'owner' || role === 'admin';
  const key = ['clients', ws];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ clients: Client[] }>(`/api/workspaces/${ws}/clients`) });
  const create = useMutation({
    mutationFn: () => api(`/api/workspaces/${ws}/clients`, { method: 'POST', json: { name } }),
    onSuccess: () => { setName(''); void qc.invalidateQueries({ queryKey: key }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/api/workspaces/${ws}/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  return (
    <div className="space-y-4">
      {list.data?.clients.map((c) => (
        <section key={c.id} className="card" aria-label={c.name}>
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{c.isImplicit ? t('ws.defaultClient') : c.name}</h3>
            <Link className="text-xs underline" to={`/app/w/${ws}/clients/${c.id}`} aria-label={t('ws.clientTools', { name: c.isImplicit ? t('ws.defaultClient') : c.name })}>{t('ws.calendarBrand')}</Link>
            {canAdmin && !c.isImplicit && (
              <button
                className="text-xs underline"
                onClick={() => { if (window.confirm(t('ws.confirmDeleteClient', { name: c.name }))) del.mutate(c.id); }}
              >
                {t('ws.delete')}
              </button>
            )}
          </div>
          <Projects ws={ws} client={c} canAdmin={canAdmin} />
        </section>
      ))}
      {canAdmin && (
        <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <label className="sr-only" htmlFor="new-client">{t('ws.clientName')}</label>
          <input id="new-client" className="input" value={name} maxLength={80} placeholder={t('ws.clientName')} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-secondary" disabled={create.isPending || !name.trim()}>{t('ws.createClient')}</button>
        </form>
      )}
      <ErrorNote error={create.error ?? del.error} />
    </div>
  );
}
