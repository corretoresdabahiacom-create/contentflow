import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  detectLanguage,
  formatTimestamp,
  parseSubtitles,
  toSrt,
  toVtt,
  type Segment,
} from '@contentflow/shared';
import { api } from '../lib/api';
import {
  AUDIO_ACCEPT,
  WASM_MAX_SECONDS,
  WasmError,
  audioExtOk,
  canRunWasm,
  isMobile,
  transcribeWasm,
  wasmEstimate,
  wasmGate,
} from '../lib/wasm';
import { ReaderError } from '../lib/readers';
import { ErrorNote } from './ErrorNote';

type Job = { id: string; origin: string; status: string; errorCode: string | null; transcriptId: string | null };
type Draft = { text: string; segments: Segment[]; language: string | null };
type TranscriptRow = { id: string; origin: string; language: string | null; chars: number };
type TranscriptFull = { id: string; text: string; segments: Segment[]; origin: string; language: string | null };
type Mode = 'paste' | 'subtitles' | 'wasm';

const download = (name: string, mime: string, content: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export function TranscriptPanel({ url, onUseAsSource }: { url: string; onUseAsSource: (text: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('paste');
  const [pasted, setPasted] = useState('');
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewText, setReviewText] = useState('');
  const [viewId, setViewId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<unknown>(null);

  // áudio local: nunca enviado; só alimenta o player e (opcionalmente) o WASM
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audio, setAudio] = useState<{ file: File; url: string } | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [audioErr, setAudioErr] = useState(false);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  const jobsKey = ['tjobs', url];
  const trKey = ['transcripts', url];
  const jobs = useQuery({ queryKey: jobsKey, queryFn: () => api<{ jobs: Job[] }>(`${url}/transcript-jobs`) });
  const list = useQuery({ queryKey: trKey, queryFn: () => api<{ transcripts: TranscriptRow[] }>(`${url}/transcripts`) });
  const review = useQuery({
    queryKey: ['tjob', reviewId],
    enabled: !!reviewId,
    queryFn: async () => {
      const j = await api<Job & { draft: Draft | null }>(`${url}/transcript-jobs/${reviewId}`);
      setReviewText(j.draft?.text ?? '');
      return j;
    },
  });
  const view = useQuery({
    queryKey: ['transcript', viewId],
    enabled: !!viewId,
    queryFn: () => api<TranscriptFull>(`${url}/transcripts/${viewId}`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: jobsKey });
    void qc.invalidateQueries({ queryKey: trKey });
  };

  const create = useMutation({
    mutationFn: (body: object) => api<{ id: string }>(`${url}/transcript-jobs`, { method: 'POST', json: body }),
    onSuccess: (r) => { setReviewId(r.id); setPasted(''); refresh(); },
  });
  const approve = useMutation({
    mutationFn: () => {
      const draft = review.data?.draft;
      const edited = draft && !draft.segments.length && reviewText !== draft.text;
      return api<{ transcriptId: string }>(`${url}/transcript-jobs/${reviewId}/approve`, { method: 'POST', json: edited ? { text: reviewText } : {} });
    },
    onSuccess: (r) => { setReviewId(null); setViewId(r.transcriptId); refresh(); },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`${url}/transcript-jobs/${id}/cancel`, { method: 'POST', json: {} }),
    onSuccess: () => { setReviewId(null); refresh(); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`${url}/transcripts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setViewId(null); refresh(); },
  });

  async function onSubtitles(file: File | undefined) {
    if (!file) return;
    setLocalError(null);
    try {
      const { format, segments } = parseSubtitles(await file.text());
      const language = detectLanguage(segments.map((s) => s.text).join(' ')).code;
      create.mutate({ origin: format, segments, language });
    } catch (e) {
      setLocalError(e);
    }
  }

  function onAudio(file: File | undefined) {
    setLocalError(null);
    setDuration(null);
    setAudioErr(false);
    if (!file) return;
    if (!audioExtOk(file.name)) {
      setLocalError(new ReaderError('unsupported'));
      return;
    }
    setAudio({ file, url: URL.createObjectURL(file) });
  }

  // WASM
  const gate = useMemo(
    () =>
      wasmGate({
        mobile: isMobile(navigator.userAgent, navigator.maxTouchPoints),
        deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        durationSec: duration,
        hasWasm: typeof WebAssembly === 'object',
        hasAudioContext: typeof AudioContext !== 'undefined' && typeof OfflineAudioContext !== 'undefined',
      }),
    [duration],
  );
  const [accepted, setAccepted] = useState(false);
  const [wasmLang, setWasmLang] = useState<'pt' | 'en' | 'es'>('pt');
  const [wasmStatus, setWasmStatus] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const runWasm = useMutation({
    mutationFn: async () => {
      if (!audio) return;
      const { id } = await api<{ id: string }>(`${url}/transcript-jobs`, { method: 'POST', json: { origin: 'wasm' } });
      abort.current = new AbortController();
      try {
        const segments = await transcribeWasm(audio.file, wasmLang, (s) => setWasmStatus(s), abort.current.signal);
        await api(`${url}/transcript-jobs/${id}/submit`, { method: 'POST', json: { segments, language: wasmLang } });
        setReviewId(id);
      } catch (e) {
        const code = e instanceof WasmError ? e.code : 'wasm_failed';
        await api(`${url}/transcript-jobs/${id}/fail`, { method: 'POST', json: { code } }).catch(() => undefined);
        throw e;
      } finally {
        setWasmStatus(null);
        refresh();
      }
    },
  });

  const open = jobs.data?.jobs.filter((j) => ['waiting_review', 'running', 'validating', 'submitted'].includes(j.status)) ?? [];
  const draft = review.data?.draft ?? null;
  const est = duration ? wasmEstimate(duration) : null;
  const tabs: Mode[] = ['paste', 'subtitles', 'wasm'];

  return (
    <div className="space-y-4" aria-label={t('tr.title')}>
      <h2 className="text-lg font-medium">{t('tr.title')}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('tr.hint')}</p>

      <div className="card space-y-2">
        <label className="block text-sm font-medium" htmlFor="audio-file">{t('tr.audio')}</label>
        <input id="audio-file" type="file" accept={AUDIO_ACCEPT} onChange={(e) => onAudio(e.target.files?.[0])} />
        <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('tr.audioLocal')}</p>
        {audio && (
          <>
            <audio
              ref={audioRef}
              controls
              src={audio.url}
              className="w-full"
              onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null)}
              onError={() => setAudioErr(true)}
            />
            {audioErr && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t('tr.audioError')}</p>}
            {duration !== null && <p className="text-xs">{t('tr.duration', { time: formatTimestamp(duration * 1000, '.').slice(0, 8) })}</p>}
          </>
        )}
      </div>

      <div role="tablist" aria-label={t('tr.modes')} className="flex flex-wrap gap-2">
        {tabs.map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={`btn ${mode === m ? '' : 'btn-secondary'}`} onClick={() => setMode(m)}>
            {t(`tr.mode.${m}`)}
          </button>
        ))}
      </div>

      {mode === 'paste' && (
        <div className="space-y-2">
          <label className="block text-sm" htmlFor="tr-paste">{t('tr.pasteLabel')}</label>
          <textarea id="tr-paste" className="input min-h-40" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button
            className="btn"
            disabled={!pasted.trim() || create.isPending}
            onClick={() => create.mutate({ origin: 'pasted', text: pasted, language: detectLanguage(pasted).code })}
          >
            {t('tr.sendReview')}
          </button>
        </div>
      )}

      {mode === 'subtitles' && (
        <div className="space-y-2">
          <label className="block text-sm" htmlFor="tr-subs">{t('tr.subsLabel')}</label>
          <input id="tr-subs" type="file" accept=".srt,.vtt" onChange={(e) => { void onSubtitles(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}

      {mode === 'wasm' && (
        <div className="card space-y-3" aria-label={t('tr.mode.wasm')}>
          <p className="text-sm font-medium">{t('tr.wasmExperimental')}</p>
          <ul className="list-disc pl-5 text-sm">
            <li>{t('tr.wasmReqDownload')}</li>
            <li>{t('tr.wasmReqRam')}</li>
            <li>{t('tr.wasmReqTime')}</li>
            <li>{t('tr.wasmReqQuality')}</li>
            <li>{t('tr.wasmReqLimit', { min: WASM_MAX_SECONDS / 60 })}</li>
            <li>{t('tr.wasmPrivacy')}</li>
          </ul>
          {est && <p className="text-xs">{t('tr.wasmEstimate', { dl: est.downloadMb.join('–'), t1: est.minutes[0], t2: est.minutes[1] })}</p>}
          {!audio && <p className="text-sm">{t('tr.wasmNeedAudio')}</p>}
          {gate.blocked.map((r) => <p key={r} role="alert" className="text-sm text-red-700 dark:text-red-300">{t(`tr.gate.${r}`)}</p>)}
          {gate.overridable.map((r) => <p key={r} role="alert" className="text-sm text-amber-700 dark:text-amber-300">{t(`tr.gate.${r}`)}</p>)}
          {gate.overridable.length > 0 && gate.blocked.length === 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              {t('tr.gate.accept')}
            </label>
          )}
          <label className="block text-sm" htmlFor="wasm-lang">{t('tr.wasmLang')}</label>
          <select id="wasm-lang" className="input !w-auto" value={wasmLang} onChange={(e) => setWasmLang(e.target.value as 'pt' | 'en' | 'es')}>
            <option value="pt">Português</option><option value="en">English</option><option value="es">Español</option>
          </select>
          <div className="flex gap-2">
            <button className="btn" disabled={!audio || !canRunWasm(gate, accepted) || runWasm.isPending} onClick={() => runWasm.mutate()}>
              {runWasm.isPending ? t(`tr.wasmStatus.${wasmStatus ?? 'loading_model'}`) : t('tr.wasmStart')}
            </button>
            {runWasm.isPending && <button className="btn btn-secondary" onClick={() => abort.current?.abort()}>{t('tr.wasmAbort')}</button>}
          </div>
          {runWasm.error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {t(`tr.wasmErr.${runWasm.error instanceof WasmError ? runWasm.error.code : 'wasm_failed'}`)}
            </p>
          )}
        </div>
      )}
      <ErrorNote error={localError ?? create.error} />

      {open.length > 0 && !reviewId && (
        <div className="card space-y-2" aria-label={t('tr.openJobs')}>
          <h3 className="font-medium">{t('tr.openJobs')}</h3>
          <ul className="space-y-1 text-sm">
            {open.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2">
                <span>{t(`tr.status.${j.status}`)} · {j.origin}</span>
                <span className="flex gap-2">
                  {j.status === 'waiting_review' && <button className="underline" onClick={() => setReviewId(j.id)}>{t('tr.review')}</button>}
                  <button className="underline" onClick={() => cancel.mutate(j.id)}>{t('tr.cancel')}</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewId && draft && (
        <div className="card space-y-2" aria-label={t('tr.reviewTitle')}>
          <h3 className="font-medium">{t('tr.reviewTitle')}</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('tr.reviewHint')}</p>
          {draft.segments.length > 0 ? (
            <ol className="max-h-64 space-y-1 overflow-auto text-sm" aria-label={t('tr.segments')}>
              {draft.segments.map((s, i) => (
                <li key={i}><span className="font-mono text-xs">{formatTimestamp(s.startMs, '.')}</span> {s.text}</li>
              ))}
            </ol>
          ) : (
            <>
              <label className="sr-only" htmlFor="tr-review">{t('tr.reviewText')}</label>
              <textarea id="tr-review" className="input min-h-40" value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
            </>
          )}
          <div className="flex gap-2">
            <button className="btn" disabled={approve.isPending || !reviewText.trim()} onClick={() => approve.mutate()}>{t('tr.approve')}</button>
            <button className="btn btn-secondary" disabled={cancel.isPending} onClick={() => cancel.mutate(reviewId)}>{t('tr.cancel')}</button>
          </div>
          <ErrorNote error={approve.error ?? cancel.error} />
        </div>
      )}

      <div className="space-y-2">
        <h3 className="font-medium">{t('tr.saved')}</h3>
        {list.data?.transcripts.length === 0 && <p className="text-sm">{t('tr.none')}</p>}
        <ul className="space-y-1 text-sm">
          {list.data?.transcripts.map((tr) => (
            <li key={tr.id} className="flex items-center justify-between gap-2">
              <button className="underline" onClick={() => setViewId(tr.id)}>
                {t(`tr.origin.${tr.origin}`)} · {tr.language ?? '—'} · {tr.chars.toLocaleString()} {t('project.chars')}
              </button>
              <button className="text-xs underline" onClick={() => { if (window.confirm(t('tr.confirmDelete'))) del.mutate(tr.id); }}>{t('ws.delete')}</button>
            </li>
          ))}
        </ul>
        <ErrorNote error={del.error} />
      </div>

      {view.data && (
        <div className="card space-y-2" aria-label={t('tr.viewTitle')}>
          <h3 className="font-medium">{t('tr.viewTitle')}</h3>
          {view.data.segments.length > 0 ? (
            <ol className="max-h-64 space-y-1 overflow-auto text-sm">
              {view.data.segments.map((s) => (
                <li key={s.startMs + s.text}>
                  <button
                    className="text-left"
                    onClick={() => { if (audioRef.current) { audioRef.current.currentTime = s.startMs / 1000; void audioRef.current.play().catch(() => undefined); } }}
                  >
                    <span className="font-mono text-xs underline">{formatTimestamp(s.startMs, '.')}</span> {s.text}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="whitespace-pre-wrap text-sm">{view.data.text}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => onUseAsSource(view.data.text)}>{t('tr.useAsSource')}</button>
            <button className="btn btn-secondary" onClick={() => download('transcript.txt', 'text/plain;charset=utf-8', view.data.text)}>TXT</button>
            {view.data.segments.length > 0 && (
              <>
                <button className="btn btn-secondary" onClick={() => download('transcript.srt', 'application/x-subrip;charset=utf-8', toSrt(view.data.segments))}>SRT</button>
                <button className="btn btn-secondary" onClick={() => download('transcript.vtt', 'text/vtt;charset=utf-8', toVtt(view.data.segments))}>VTT</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
