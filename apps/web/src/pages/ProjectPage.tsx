import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  EXPORT_FORMATS,
  CHANNELS,
  CHANNEL_SPECS,
  EXPORT_MIME,
  analyzeText,
  exportFilename,
  generateChannelOutputs,
  generateOutputs,
  type Channel,
  serialize,
  type Analysis,
  type ExportDoc,
  type ExportFormat,
} from '@contentflow/shared';
import { ClipsPanel } from '../components/ClipsPanel';
import { ErrorNote } from '../components/ErrorNote';
import { TranscriptPanel } from '../components/TranscriptPanel';
import { api, ApiRequestError } from '../lib/api';
import { ACCEPT, readSourceFile, type FileKind } from '../lib/readers';
import { useMe } from '../lib/session';

type Output = { id: string; channel: string; kind: string; title: string | null; body: string; version: number; sourceKind: string };
type ProjectDetail = {
  id: string;
  name: string;
  source: { kind: string; filename: string | null; chars: number; text: string; analysis: Analysis | null } | null;
};

function OutputCard({ o, url, onChanged }: { o: Output; url: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const [body, setBody] = useState(o.body);
  useEffect(() => setBody(o.body), [o.body, o.version]);
  const save = useMutation({
    mutationFn: () => api(`${url}/outputs/${o.id}`, { method: 'PATCH', json: { body, version: o.version } }),
    onSettled: onChanged,
  });
  const del = useMutation({ mutationFn: () => api(`${url}/outputs/${o.id}`, { method: 'DELETE' }), onSuccess: onChanged });
  const label = o.channel === 'generic' ? t(`kinds.${o.kind}`) : `${t(`channels.${o.channel}`)} · ${t(`kinds.${o.kind}`)}`;
  const max = o.channel === 'generic' ? undefined : CHANNEL_SPECS[o.channel as Channel]?.find((x) => x.kind === o.kind)?.maxChars;
  return (
    <article className="card space-y-2" aria-label={label}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{label}</h3>
        <span className="rounded border px-2 py-0.5 text-xs" title={t('project.badgeTemplateHint')}>
          {o.sourceKind === 'template' ? t('project.badgeTemplate') : o.sourceKind} · v{o.version}
        </span>
      </header>
      <label className="sr-only" htmlFor={`o-${o.id}`}>{label}</label>
      <textarea id={`o-${o.id}`} className="input min-h-32 font-mono" value={body} onChange={(e) => setBody(e.target.value)} />
      {max && (
        <p className={`text-xs ${body.length > max ? 'text-red-700 dark:text-red-300' : ''}`}>
          {t('ch.limit', { n: body.length.toLocaleString(), max: max.toLocaleString() })}
          {body.length > max ? ` · ${t('ch.over')}` : ''}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn" disabled={save.isPending || body === o.body || !body.trim()} onClick={() => save.mutate()}>
          {t('project.save')}
        </button>
        <button className="btn btn-secondary" onClick={() => del.mutate()}>{t('ws.delete')}</button>
      </div>
      <ErrorNote error={save.error ?? del.error} />
    </article>
  );
}

export function ProjectPage() {
  const { clientId = '', projectId = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const ws = me.data?.workspaces[0]?.id;
  const url = `/api/workspaces/${ws}/clients/${clientId}/projects/${projectId}`;
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'paste' | FileKind>('paste');
  const [filename, setFilename] = useState<string | null>(null);
  const [fileError, setFileError] = useState<unknown>(null);
  const loaded = useRef(false);

  const project = useQuery({ queryKey: ['project', projectId], enabled: !!ws, queryFn: () => api<ProjectDetail>(url) });
  const outputs = useQuery({ queryKey: ['outputs', projectId], enabled: !!ws, queryFn: () => api<{ outputs: Output[] }>(`${url}/outputs`) });
  useEffect(() => {
    if (project.data && !loaded.current) {
      loaded.current = true;
      setText(project.data.source?.text ?? '');
      setKind((project.data.source?.kind as FileKind | undefined) ?? 'paste');
      setFilename(project.data.source?.filename ?? null);
    }
  }, [project.data]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['outputs', projectId] });
    void qc.invalidateQueries({ queryKey: ['project', projectId] });
  };

  const analyze = useMutation({
    mutationFn: async () => {
      const analysis = analyzeText(text); // processamento real, no navegador
      await api(`${url}/source`, { method: 'PUT', json: { kind, filename, text, analysis } });
    },
    onSuccess: refresh,
  });
  const generate = useMutation({
    mutationFn: async () => {
      const a = project.data?.source?.analysis;
      const src = project.data?.source;
      if (!a || !src) return;
      const outs = generateOutputs(a, src.text, { title: project.data?.name });
      await api(`${url}/outputs`, { method: 'POST', json: { outputs: outs.map(({ kind: k, title, body, channel }) => ({ kind: k, title, body, channel })) } });
    },
    onSuccess: refresh,
  });
  const [picked, setPicked] = useState<Channel[]>([...CHANNELS]);
  const generateCh = useMutation({
    mutationFn: async () => {
      const a = project.data?.source?.analysis;
      const src = project.data?.source;
      if (!a || !src || !picked.length) return;
      const outs = generateChannelOutputs(a, src.text, { title: project.data?.name, channels: picked });
      await api(`${url}/outputs`, { method: 'POST', json: { outputs: outs.map(({ kind: k, title, body, channel }) => ({ kind: k, title, body, channel })) } });
    },
    onSuccess: refresh,
  });
  const subs = useQuery({
    queryKey: ['transcripts', url],
    enabled: !!ws,
    queryFn: () => api<{ transcripts: { id: string; segments: number }[] }>(`${url}/transcripts`),
  });
  const hasSubs = (subs.data?.transcripts ?? []).some((x) => x.segments > 0);
  const exporter = useMutation({
    mutationFn: async (f: ExportFormat) => {
      const doc = await api<ExportDoc>(`${url}/export-data`);
      const blob = new Blob([serialize(doc, f)], { type: EXPORT_MIME[f] });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = exportFilename(doc.project.name, f);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    try {
      const r = await readSourceFile(file);
      setText(r.text);
      setKind(r.kind);
      setFilename(r.filename);
    } catch (e) {
      setFileError(e);
    }
  }

  if (me.isLoading || project.isLoading) return <p>…</p>;
  if (project.error instanceof ApiRequestError && project.error.status === 404) return <p>{t('notFound')}</p>;
  const a = project.data?.source?.analysis;
  const changed = text !== (project.data?.source?.text ?? '');

  return (
    <section className="space-y-8">
      <header>
        <Link to="/app" className="text-sm">← {t('nav.app')}</Link>
        <h1 className="text-2xl font-semibold">{project.data?.name}</h1>
      </header>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">{t('project.source')}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('project.sourceHint')}</p>
        <label className="block text-sm" htmlFor="file">{t('project.upload')}</label>
        <input id="file" type="file" accept={ACCEPT} onChange={(e) => void onFile(e.target.files?.[0])} />
        <ErrorNote error={fileError} />
        <label className="block text-sm" htmlFor="source-text">{t('project.text')}</label>
        <textarea id="source-text" className="input min-h-48" value={text} onChange={(e) => { setText(e.target.value); if (kind !== 'paste' && filename) { /* mantém origem do arquivo */ } }} />
        <p className="text-xs">{text.length.toLocaleString()} / 200.000 {t('project.chars')}{filename ? ` · ${filename}` : ''}</p>
        <button className="btn" disabled={!text.trim() || text.length > 200_000 || analyze.isPending} onClick={() => analyze.mutate()}>
          {analyze.isPending ? t('auth.working') : t('project.saveAnalyze')}
        </button>
        <ErrorNote error={analyze.error} />
      </div>

      <TranscriptPanel
        url={url}
        onUseAsSource={(txt) => {
          setText(txt);
          setKind('paste');
          setFilename(null);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {a && (
        <div className="space-y-3" aria-label={t('project.analysis')}>
          <h2 className="text-lg font-medium">{t('project.analysis')}</h2>
          <dl className="grid max-w-2xl gap-1 text-sm">
            <div><dt className="inline font-medium">{t('project.language')}: </dt><dd className="inline" data-testid="lang">{a.language}</dd></div>
            <div><dt className="inline font-medium">{t('project.stats')}: </dt><dd className="inline">{a.stats.words} {t('project.words')}, {a.stats.sentences} {t('project.sentences')}</dd></div>
            <div><dt className="inline font-medium">{t('project.keywords')}: </dt><dd className="inline">{a.keywords.join(', ')}</dd></div>
          </dl>
          <h3 className="font-medium">{t('project.summary')}</h3>
          <ul className="list-disc pl-5 text-sm">{a.summary.map((s) => <li key={s}>{s}</li>)}</ul>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {t('project.algorithms', { lang: a.algorithms.language, kw: a.algorithms.keywords, sum: a.algorithms.summary })}
          </p>
          {changed && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t('project.stale')}</p>}
          <button className="btn" disabled={generate.isPending || changed} onClick={() => generate.mutate()}>{t('project.generate')}</button>
          <ErrorNote error={generate.error} />

          <h3 className="pt-2 font-medium">{t('ch.heading')}</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('ch.hint')}</p>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">{t('ch.heading')}</legend>
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={picked.includes(c)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c] : p.filter((x) => x !== c)))} />
                {t(`channels.${c}`)}
              </label>
            ))}
          </fieldset>
          <button className="btn" disabled={generateCh.isPending || changed || !picked.length} onClick={() => generateCh.mutate()}>{t('ch.generate')}</button>
          <ErrorNote error={generateCh.error} />
        </div>
      )}

      <ClipsPanel url={url} />

      <div className="space-y-3">
        <h2 className="text-lg font-medium">{t('project.outputs')}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('project.outputsHint')}</p>
        {outputs.data?.outputs.length === 0 && <p className="text-sm">{t('project.noOutputs')}</p>}
        <div className="grid gap-4">
          {outputs.data?.outputs.map((o) => <OutputCard key={o.id} o={o} url={url} onChanged={refresh} />)}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">{t('project.export')}</h2>
        <div className="flex flex-wrap gap-2">
          {EXPORT_FORMATS.map((f) => (
            <button key={f} className="btn btn-secondary" disabled={exporter.isPending || ((f === 'srt' || f === 'vtt') && !hasSubs)} title={(f === 'srt' || f === 'vtt') && !hasSubs ? t('project.exportNoSubs') : undefined} onClick={() => exporter.mutate(f)}>
              {t('project.exportAs', { format: f.toUpperCase() })}
            </button>
          ))}
        </div>
        <ErrorNote error={exporter.error} />
      </div>
    </section>
  );
}
