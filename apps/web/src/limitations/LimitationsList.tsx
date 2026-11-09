import { useMemo, useState } from 'react';
import { limitations, limitationsMeta, type Limitation as L } from './data';
import { Limitation } from './Limitation';

type StatusFilter = 'all' | L['status'];

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'Todos',
  not_available: 'Indisponível',
  limited: 'Limitado',
  experimental: 'Experimental',
};

export function LimitationsList() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return limitations.filter((l) => {
      if (status !== 'all' && l.status !== status) return false;
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        l.reason.toLowerCase().includes(q) ||
        l.alternatives.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [status, query]);

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Limitações do ContentFlow AI</h1>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          O que o produto <strong>não</strong> faz hoje, o motivo e as alternativas. Versão{' '}
          {limitationsMeta.version} · atualizado em {limitationsMeta.updatedAt}.
        </p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar limitação…"
          aria-label="Buscar limitação"
          className="input flex-1"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filtrar por status"
          className="input sm:!w-auto"
        >
          {(Object.keys(FILTER_LABEL) as StatusFilter[]).map((s) => (
            <option key={s} value={s}>
              {FILTER_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm">Nenhuma limitação encontrada com esse filtro.</p>
      )}

      <div className="space-y-4">
        {filtered.map((l) => (
          <Limitation key={l.id} id={l.id} variant="block" />
        ))}
      </div>
    </section>
  );
}
