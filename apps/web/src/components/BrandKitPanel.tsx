import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BRAND_LIMITS } from '@contentflow/shared';
import { api } from '../lib/api';
import { ErrorNote } from './ErrorNote';

type Kit = { name: string; logoUrl: string | null; primaryColor: string | null; tone: string | null };

function Form({ kit, base, canEdit }: { kit: Kit | null; base: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(kit?.name ?? '');
  const [logo, setLogo] = useState(kit?.logoUrl ?? '');
  const [color, setColor] = useState(kit?.primaryColor ?? '');
  const [tone, setTone] = useState(kit?.tone ?? '');
  const save = useMutation({
    mutationFn: () => api(`${base}/brand-kit`, { method: 'PUT', json: { name, logoUrl: logo || null, primaryColor: color || null, tone: tone || null } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['brandkit', base] }),
  });
  const colorOk = !color || /^#[0-9a-fA-F]{6}$/.test(color);
  return (
    <form className="card space-y-2 max-w-xl" aria-label={t('brand.heading')} onSubmit={(e) => { e.preventDefault(); if (name.trim() && colorOk) save.mutate(); }}>
      <label className="block text-sm" htmlFor="bk-name">{t('brand.name')}</label>
      <input id="bk-name" className="input" value={name} maxLength={BRAND_LIMITS.name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
      <label className="block text-sm" htmlFor="bk-logo">{t('brand.logo')}</label>
      <input id="bk-logo" className="input" value={logo} maxLength={BRAND_LIMITS.logoUrl} placeholder="https://…" disabled={!canEdit} onChange={(e) => setLogo(e.target.value)} />
      <p className="text-xs text-neutral-600 dark:text-neutral-400">{t('brand.logoHelp')}</p>
      <label className="block text-sm" htmlFor="bk-color">{t('brand.color')}</label>
      <div className="flex items-center gap-2">
        <input id="bk-color" className="input !w-32" value={color} placeholder="#1a73e8" disabled={!canEdit} aria-invalid={!colorOk} onChange={(e) => setColor(e.target.value)} />
        {colorOk && color && <span aria-hidden className="inline-block h-6 w-6 rounded border" style={{ background: color }} />}
      </div>
      <label className="block text-sm" htmlFor="bk-tone">{t('brand.tone')}</label>
      <textarea id="bk-tone" className="input min-h-16" value={tone} maxLength={BRAND_LIMITS.tone} disabled={!canEdit} onChange={(e) => setTone(e.target.value)} />
      {logo && /^https:\/\//.test(logo) && <img src={logo} alt={t('brand.logoPreview')} referrerPolicy="no-referrer" className="max-h-16" />}
      {!colorOk && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t('brand.badColor')}</p>}
      {canEdit ? <button className="btn" disabled={save.isPending || !name.trim() || !colorOk}>{t('project.save')}</button> : <p className="text-sm">{t('brand.readOnly')}</p>}
      {save.isSuccess && <p role="status" className="text-sm">{t('brand.saved')}</p>}
      <ErrorNote error={save.error} />
    </form>
  );
}

export function BrandKitPanel({ ws, clientId, canEdit }: { ws: string; clientId: string; canEdit: boolean }) {
  const base = `/api/workspaces/${ws}/clients/${clientId}`;
  const q = useQuery({ queryKey: ['brandkit', base], queryFn: () => api<{ brandKit: (Kit & { updatedAt: number }) | null }>(`${base}/brand-kit`) });
  if (!q.data) return <p>…</p>;
  return <Form key={base} kit={q.data.brandKit} base={base} canEdit={canEdit} />;
}
