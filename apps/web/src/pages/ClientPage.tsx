import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { BrandKitPanel } from '../components/BrandKitPanel';
import { CalendarPanel } from '../components/CalendarPanel';
import { SharingPanel } from '../components/SharingPanel';
import { api } from '../lib/api';
import { useMe } from '../lib/session';

type Tab = 'calendar' | 'brand' | 'share';

export function ClientPage() {
  const { t } = useTranslation();
  const { ws = '', clientId = '' } = useParams();
  const me = useMe();
  const [tab, setTab] = useState<Tab>('calendar');
  const mine = me.data?.workspaces.find((w) => w.id === ws);
  const isAdmin = mine?.role === 'owner' || mine?.role === 'admin';
  const clients = useQuery({ queryKey: ['clients', ws], enabled: !!mine, queryFn: () => api<{ clients: { id: string; name: string; isImplicit: boolean }[] }>(`/api/workspaces/${ws}/clients`) });
  if (me.isLoading) return <p>…</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  const client = clients.data?.clients.find((c) => c.id === clientId);
  if (!mine || (clients.data && !client)) return <p role="alert">{t('team.notFound')}</p>;
  const tabs: Tab[] = isAdmin ? ['calendar', 'brand', 'share'] : ['calendar', 'brand'];
  return (
    <section className="space-y-4" aria-label={t('client.heading')}>
      <header>
        <p className="text-sm"><Link to="/app">← {t('team.back')}</Link></p>
        <h1 className="text-2xl font-semibold">{client ? (client.isImplicit ? t('ws.defaultClient') : client.name) : '…'}</h1>
      </header>
      <div role="tablist" aria-label={t('client.heading')} className="flex gap-2">
        {tabs.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={`btn ${tab === x ? '' : 'btn-secondary'}`} onClick={() => setTab(x)}>{t(`client.tab.${x}`)}</button>
        ))}
      </div>
      {tab === 'calendar' && <CalendarPanel ws={ws} clientId={clientId} />}
      {tab === 'brand' && <BrandKitPanel ws={ws} clientId={clientId} canEdit={isAdmin} />}
      {tab === 'share' && isAdmin && <SharingPanel ws={ws} clientId={clientId} />}
    </section>
  );
}
