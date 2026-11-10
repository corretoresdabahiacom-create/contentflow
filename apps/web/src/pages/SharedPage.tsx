import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { api, ApiRequestError } from '../lib/api';

type Shared = {
  clientName: string | null;
  brandKit: { name: string; logoUrl: string | null; primaryColor: string | null; tone: string | null } | null;
  expiresAt: number;
  outputs: { id: string; channel: string; kind: string; title: string | null; body: string; sourceKind: string }[];
};

/** Página pública (sem login) de um link compartilhado. Só mostra o que o autor escolheu + o brand kit. */
export function SharedPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['shared', token], retry: false, queryFn: () => api<Shared>(`/api/shared/${token}`) });
  const gone = q.error instanceof ApiRequestError && q.error.status === 404;
  const kit = q.data?.brandKit;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8" aria-label={t('shared.heading')}>
      <meta name="robots" content="noindex, nofollow" />
      {q.isLoading && <p>…</p>}
      {gone && <p role="alert">{t('shared.gone')}</p>}
      {q.error && !gone && <p role="alert">{t('shared.error')}</p>}
      {q.data && (
        <>
          <header className="space-y-2" style={kit?.primaryColor ? { borderTop: `6px solid ${kit.primaryColor}`, paddingTop: 12 } : undefined}>
            {kit?.logoUrl && <img src={kit.logoUrl} alt={kit.name} referrerPolicy="no-referrer" className="max-h-16" />}
            <h1 className="text-2xl font-semibold">{kit?.name ?? q.data.clientName ?? t('shared.heading')}</h1>
            {kit?.tone && <p className="text-sm">{t('shared.tone')}: {kit.tone}</p>}
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('shared.note', { date: new Date(q.data.expiresAt).toLocaleDateString() })}</p>
          </header>
          {q.data.outputs.length === 0 && <p>{t('shared.empty')}</p>}
          {q.data.outputs.map((o) => (
            <article key={o.id} className="card space-y-2" aria-label={`${o.channel}/${o.kind}`}>
              <p className="text-xs">{o.channel} · {o.kind} · <span className="rounded border px-1">{o.sourceKind === 'template' ? 'template' : o.sourceKind}</span></p>
              {o.title && <h2 className="text-lg font-medium">{o.title}</h2>}
              <pre className="whitespace-pre-wrap font-sans text-sm">{o.body}</pre>
            </article>
          ))}
          <footer className="text-xs text-neutral-600 dark:text-neutral-400">{t('shared.footer')}</footer>
        </>
      )}
    </main>
  );
}
