import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CLIP_HEURISTIC_VERSION,
  EDIT_PLAN_FORMATS,
  EDIT_PLAN_MIME,
  buildEditPlan,
  planFilename,
  serializePlan,
  suggestClips,
  type EditPlanFormat,
  type ExportDoc,
  type Segment,
} from '@contentflow/shared';
import { api } from '../lib/api';
import { formatClock, formatDuration, parseClock } from '../lib/clock';
import { Limitation } from '../limitations/Limitation';
import { ErrorNote } from './ErrorNote';

type Clip = {
  id: string; startMs: number; endMs: number; title: string; justification: string; excerpt: string;
  notes: string | null; edited: boolean; version: number; origin: string;
};
type TrRow = { id: string; language: string | null; segments: number };
type TrFull = { id: string; language: string | null; segments: Segment[] };

function ClipCard({ k, url, onChanged }: { k: Clip; url: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(k.title);
  const [start, setStart] = useState(formatClock(k.startMs));
  const [end, setEnd] = useState(formatClock(k.endMs));
  const [notes, setNotes] = useState(k.notes ?? '');
  const s = parseClock(start);
  const e = parseClock(end);
  const valid = s !== null && e !== null && e > s && !!title.trim();
  const dirty = title !== k.title || notes !== (k.notes ?? '') || s !== k.startMs || e !== k.endMs;
  const save = useMutation({
    mutationFn: () => api(`${url}/clips/${k.id}`, { method: 'PATCH', json: { title, notes, startMs: s, endMs: e, version: k.version } }),
    onSettled: onChanged,
  });
  const del = useMutation({ mutationFn: () => api(`${url}/clips/${k.id}`, { method: 'DELETE' }), onSuccess: onChanged });
  return (
    <article className="card space-y-2" aria-label={t('clips.cardLabel', { title: k.title })}>
      <header className="flex items-center justify-between gap-2 text-xs">
        <span>{formatClock(k.startMs)}–{formatClock(k.endMs)} · {formatDuration(k.endMs - k.startMs)}</span>
        <span className="rounded border px-2 py-0.5">{k.origin === 'manual' ? t('clips.manual') : t('clips.heuristic')}{k.edited ? ` · ${t('clips.edited')}` : ''} · v{k.version}</span>
      </header>
      <label className="block text-sm" htmlFor={`ct-${k.id}`}>{t('clips.title')}</label>
      <input id={`ct-${k.id}`} className="input" value={title} maxLength={120} onChange={(ev) => setTitle(ev.target.value)} />
      <div className="flex gap-2">
        <div>
          <label className="block text-sm" htmlFor={`cs-${k.id}`}>{t('clips.start')}</label>
          <input id={`cs-${k.id}`} className="input" value={start} onChange={(ev) => setStart(ev.target.value)} aria-invalid={s === null} />
        </div>
        <div>
          <label className="block text-sm" htmlFor={`ce-${k.id}`}>{t('clips.end')}</label>
          <input id={`ce-${k.id}`} className="input" value={end} onChange={(ev) => setEnd(ev.target.value)} aria-invalid={e === null || (s !== null && e <= s)} />
        </div>
      </div>
      {!valid && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t('clips.invalidRange')}</p>}
      <p className="text-sm"><span className="font-medium">{t('clips.why')}: </span>{k.justification}</p>
      {k.excerpt && <blockquote className="border-l-2 pl-3 text-sm text-neutral-700 dark:text-neutral-300">{k.excerpt}</blockquote>}
      <label className="block text-sm" htmlFor={`cn-${k.id}`}>{t('clips.notes')}</label>
      <textarea id={`cn-${k.id}`} className="input min-h-16" value={notes} maxLength={2000} onChange={(ev) => setNotes(ev.target.value)} />
      <div className="flex gap-2">
        <button className="btn" disabled={!valid || !dirty || save.isPending} onClick={() => save.mutate()}>{t('project.save')}</button>
        <button className="btn btn-secondary" onClick={() => del.mutate()}>{t('ws.delete')}</button>
      </div>
      <ErrorNote error={save.error ?? del.error} />
    </article>
  );
}

export function ClipsPanel({ url }: { url: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pick, setPick] = useState<string>('');
  const [info, setInfo] = useState<string | null>(null);
  const [mTitle, setMTitle] = useState('');
  const [mStart, setMStart] = useState('0:00');
  const [mEnd, setMEnd] = useState('0:30');

  const trs = useQuery({ queryKey: ['transcripts', url], queryFn: () => api<{ transcripts: TrRow[] }>(`${url}/transcripts`) });
  const withTs = trs.data?.transcripts.filter((x) => x.segments > 0) ?? [];
  const chosen = pick || withTs[0]?.id || '';
  const clips = useQuery({ queryKey: ['clips', url], queryFn: () => api<{ clips: Clip[] }>(`${url}/clips`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['clips', url] });

  const suggest = useMutation({
    mutationFn: async () => {
      setInfo(null);
      const tr = await api<TrFull>(`${url}/transcripts/${chosen}`);
      const found = suggestClips(tr.segments, tr.language ?? 'pt'); // heurística local, determinística
      if (!found.length) { setInfo(t('clips.none')); return; }
      await api(`${url}/clips`, {
        method: 'POST',
        json: {
          replaceHeuristic: true,
          clips: found.map((c) => ({ startMs: c.startMs, endMs: c.endMs, title: c.title, justification: c.justification, excerpt: c.excerpt, transcriptId: tr.id, origin: 'heuristic', signals: { ...c.signals, score: c.score, heuristicVersion: CLIP_HEURISTIC_VERSION } })),
        },
      });
    },
    onSuccess: refresh,
  });
  const s = parseClock(mStart);
  const e = parseClock(mEnd);
  const add = useMutation({
    mutationFn: () => api(`${url}/clips`, { method: 'POST', json: { clips: [{ startMs: s, endMs: e, title: mTitle, justification: t('clips.manualWhy'), origin: 'manual', transcriptId: chosen || null }] } }),
    onSuccess: () => { setMTitle(''); refresh(); },
  });

  const plan = useMutation({
    mutationFn: async (f: EditPlanFormat) => {
      const doc = await api<ExportDoc>(`${url}/export-data`);
      const blob = new Blob([serializePlan(buildEditPlan(doc), f)], { type: EDIT_PLAN_MIME[f] });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = planFilename(doc.project.name, f);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  });
  const hasClips = (clips.data?.clips.length ?? 0) > 0;

  return (
    <div className="space-y-3" aria-label={t('clips.heading')}>
      <h2 className="text-lg font-medium">{t('clips.heading')}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('clips.disclaimer')}</p>

      {withTs.length === 0 ? (
        <p className="text-sm">{t('clips.needTimestamps')}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          {withTs.length > 1 && (
            <div>
              <label className="block text-sm" htmlFor="clip-tr">{t('clips.transcript')}</label>
              <select id="clip-tr" className="input !w-auto" value={chosen} onChange={(ev) => setPick(ev.target.value)}>
                {withTs.map((x, i) => <option key={x.id} value={x.id}>#{i + 1} · {x.segments} {t('tr.segments').toLowerCase()}</option>)}
              </select>
            </div>
          )}
          <button className="btn" disabled={suggest.isPending} onClick={() => suggest.mutate()}>{t('clips.suggest')}</button>
        </div>
      )}
      {info && <p role="status" className="text-sm">{info}</p>}
      <ErrorNote error={suggest.error} />

      {clips.data?.clips.length === 0 && <p className="text-sm">{t('clips.empty')}</p>}
      <div className="grid gap-4">
        {clips.data?.clips.map((k) => <ClipCard key={`${k.id}-${k.version}`} k={k} url={url} onChanged={refresh} />)}
      </div>

      <section className="card space-y-2" aria-label={t('clips.planHeading')}>
        <h3 className="font-medium">{t('clips.planHeading')}</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('clips.planHelp')}</p>
        <Limitation id="renderizacao-de-video" variant="inline" />
        {!hasClips && <p className="text-sm">{t('clips.planEmpty')}</p>}
        <div className="flex flex-wrap gap-2">
          {EDIT_PLAN_FORMATS.map((f) => (
            <button key={f} className="btn btn-secondary" disabled={!hasClips || plan.isPending} onClick={() => plan.mutate(f)}>
              {t('clips.planAs', { format: f.toUpperCase() })}
            </button>
          ))}
        </div>
        <ErrorNote error={plan.error} />
      </section>

      <form className="card flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); if (s !== null && e !== null && e > s && mTitle.trim()) add.mutate(); }} aria-label={t('clips.addManual')}>
        <div><label className="block text-sm" htmlFor="m-title">{t('clips.title')}</label><input id="m-title" className="input" value={mTitle} maxLength={120} onChange={(ev) => setMTitle(ev.target.value)} /></div>
        <div><label className="block text-sm" htmlFor="m-start">{t('clips.start')}</label><input id="m-start" className="input !w-24" value={mStart} onChange={(ev) => setMStart(ev.target.value)} /></div>
        <div><label className="block text-sm" htmlFor="m-end">{t('clips.end')}</label><input id="m-end" className="input !w-24" value={mEnd} onChange={(ev) => setMEnd(ev.target.value)} /></div>
        <button className="btn btn-secondary" disabled={add.isPending || s === null || e === null || e <= s || !mTitle.trim()}>{t('clips.addManual')}</button>
      </form>
      <ErrorNote error={add.error} />
    </div>
  );
}
