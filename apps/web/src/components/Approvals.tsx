import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { ErrorNote } from './ErrorNote';

export type Approval = { id: string; outputId: string; status: 'pending' | 'approved' | 'rejected'; outputVersion: number; note: string | null };

/** Estado de aprovação de um output: a decisão só vale para a versão em que foi pedida. */
export function ApprovalControls({ url, outputId, version, approval, onChanged }: { url: string; outputId: string; version: number; approval?: Approval; onChanged: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const ask = useMutation({
    mutationFn: () => api(`${url}/outputs/${outputId}/approvals`, { method: 'POST', json: { note: note || null } }),
    onSuccess: () => { setAsking(false); setNote(''); onChanged(); },
  });
  const stale = !!approval && approval.outputVersion !== version;
  const state = !approval ? 'none' : stale ? `${approval.status}Stale` : approval.status;
  const canAsk = !approval || approval.status === 'rejected' || stale;
  return (
    <div className="space-y-1 text-sm" aria-label={t('appr.heading')}>
      <p role="status"><span className="rounded border px-2 py-0.5 text-xs">{t(`appr.state.${state}`)}</span>{approval?.note && approval.status !== 'pending' ? ` · ${approval.note}` : ''}</p>
      {canAsk && !asking && <button className="text-xs underline" onClick={() => setAsking(true)}>{t('appr.request')}</button>}
      {asking && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask.mutate(); }}>
          <label className="sr-only" htmlFor={`an-${outputId}`}>{t('appr.note')}</label>
          <input id={`an-${outputId}`} className="input !w-64" value={note} maxLength={1000} placeholder={t('appr.note')} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-secondary" disabled={ask.isPending}>{t('appr.send')}</button>
          <button type="button" className="text-xs underline" onClick={() => setAsking(false)}>{t('cal.close')}</button>
        </form>
      )}
      <ErrorNote error={ask.error} />
    </div>
  );
}

type Row = { id: string; note: string | null; outputTitle: string | null; channel: string; kind: string; stale: boolean; projectId: string; projectName: string; clientId: string; clientName: string; requestedBy: string };

/** Caixa de entrada de aprovações do workspace. Qualquer membro vê; só owner/admin decide. */
export function ApprovalsInbox({ ws, canDecide }: { ws: string; canDecide: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['approvals', ws], queryFn: () => api<{ approvals: Row[] }>(`/api/workspaces/${ws}/approvals`) });
  const decide = useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'rejected' }) => api(`/api/workspaces/${ws}/approvals/${v.id}/decision`, { method: 'POST', json: { status: v.status, note: notes[v.id] || null } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['approvals', ws] }),
  });
  return (
    <div className="space-y-2" aria-label={t('appr.inbox')}>
      <h3 className="font-medium">{t('appr.inbox')}</h3>
      {q.data?.approvals.length === 0 && <p className="text-sm">{t('appr.none')}</p>}
      <ul className="space-y-2">
        {q.data?.approvals.map((a) => (
          <li key={a.id} className="card space-y-2 text-sm" aria-label={t('appr.item', { title: a.outputTitle ?? `${a.channel}/${a.kind}` })}>
            <p>
              <Link to={`/app/w/${ws}/clients/${a.clientId}/projects/${a.projectId}`}>{a.clientName} · {a.projectName} · {a.outputTitle ?? `${a.channel}/${a.kind}`}</Link>
              {' '}· {t('appr.by', { email: a.requestedBy })}{a.note ? ` · “${a.note}”` : ''}
            </p>
            {a.stale && <p role="note">{t('appr.stale')}</p>}
            {canDecide && !a.stale && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="sr-only" htmlFor={`dn-${a.id}`}>{t('appr.decisionNote')}</label>
                <input id={`dn-${a.id}`} className="input !w-64" placeholder={t('appr.decisionNote')} maxLength={1000} value={notes[a.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} />
                <button className="btn" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, status: 'approved' })}>{t('appr.approve')}</button>
                <button className="btn btn-secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, status: 'rejected' })}>{t('appr.reject')}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote error={decide.error} />
    </div>
  );
}
