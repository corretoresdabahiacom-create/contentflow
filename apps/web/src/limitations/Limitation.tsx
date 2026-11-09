import { anchorId, limitationsById, type Limitation as L } from './data';

const STATUS_LABEL: Record<L['status'], string> = {
  not_available: 'Indisponível',
  limited: 'Limitado',
  experimental: 'Experimental',
};

const STATUS_CLASS: Record<L['status'], string> = {
  not_available:
    'bg-red-50 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-100 dark:border-red-800',
  limited:
    'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800',
  experimental:
    'bg-violet-50 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-100 dark:border-violet-800',
};

type Props = { id: string; variant?: 'inline' | 'block'; className?: string };

/** Renderiza uma limitação a partir da fonte única de verdade. */
export function Limitation({ id, variant = 'inline', className = '' }: Props) {
  const lim = limitationsById[id];
  if (!lim) {
    if (import.meta.env.DEV) console.warn(`[Limitation] id desconhecido: "${id}"`);
    return null;
  }
  const href = `/docs/limitations#${anchorId(id)}`;

  if (variant === 'inline') {
    return (
      <p
        role="note"
        aria-label={`Limitação: ${lim.title}`}
        className={`text-sm text-neutral-700 dark:text-neutral-300 ${className}`}
      >
        {lim.inlineNotice ?? lim.title}{' '}
        <a href={href} className="underline underline-offset-2">
          Saiba mais
        </a>
        .
      </p>
    );
  }

  return (
    <article
      id={anchorId(id)}
      aria-label={`Limitação: ${lim.title}`}
      data-status={lim.status}
      className={`rounded-lg border p-4 ${STATUS_CLASS[lim.status]} ${className}`}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold">{lim.title}</h3>
        <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide">
          {STATUS_LABEL[lim.status]}
        </span>
      </header>
      <p className="mt-2 text-sm">{lim.reason}</p>
      {lim.quotas && lim.quotas.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {lim.quotas.map((q) => (
            <div key={q.label} className="flex justify-between gap-2">
              <dt>{q.label}</dt>
              <dd className="text-right font-medium">{q.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {lim.alternatives.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium">O que você pode fazer:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {lim.alternatives.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {lim.related && lim.related.length > 0 && (
        <p className="mt-3 text-sm">
          Ver também:{' '}
          {lim.related.map((rid, i) => {
            const r = limitationsById[rid];
            if (!r) return null;
            return (
              <span key={rid}>
                {i > 0 && ', '}
                <a href={`/docs/limitations#${anchorId(rid)}`} className="underline">
                  {r.title}
                </a>
              </span>
            );
          })}
          .
        </p>
      )}
    </article>
  );
}
