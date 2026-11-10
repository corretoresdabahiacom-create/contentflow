import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

type N = { id: string; kind: string; readAt: number | null; createdAt: number; payload: { reason?: string; key?: string; pct?: number; level?: string } };

/** Avisos in-app (moderação e alertas de cota). Sem e-mail: o produto não envia. */
export function Notifications() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ notifications: N[] }>('/api/notifications') });
  const read = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const list = (q.data?.notifications ?? []).filter((n) => n.readAt === null);
  if (q.isLoading || list.length === 0) return null;
  const text = (n: N) =>
    n.kind === 'quota.alert'
      ? t('notif.quota', { key: n.payload.key, pct: n.payload.pct, level: t(`admin.level.${n.payload.level ?? 'ok'}`) })
      : t(`notif.${n.kind.replace('.', '.')}`, { reason: t(`report.reasons.${n.payload.reason ?? 'other'}`) });
  return (
    <section aria-labelledby="notif-h" className="card space-y-2">
      <h2 id="notif-h" className="font-medium">{t('notif.title')}</h2>
      <ul className="space-y-2 text-sm">
        {list.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{text(n)}</span>
            <button className="text-xs underline" onClick={() => read.mutate(n.id)}>{t('notif.read')}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
