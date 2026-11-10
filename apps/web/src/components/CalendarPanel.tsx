import { useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CALENDAR_STATUSES, addDays, formatDay, monthGrid, parseDay, todayLocal, weekDays, type CalendarStatus } from '@contentflow/shared';
import { api } from '../lib/api';
import { ErrorNote } from './ErrorNote';

type Entry = { id: string; title: string; scheduledFor: number | null; status: CalendarStatus; assigneeUserId: string | null; outputId: string | null; version: number };
type Member = { userId: string; email: string };

function Chip({ e, onOpen, selected }: { e: Entry; onOpen: () => void; selected: boolean }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: e.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={t('cal.entryLabel', { title: e.title })}
      aria-pressed={selected}
      onClick={onOpen}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, touchAction: 'none' }}
      className={`block w-full truncate rounded border px-1 py-0.5 text-left text-xs ${isDragging ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-blue-500' : ''}`}
    >
      {e.title} · {t(`cal.status.${e.status}`)}
    </button>
  );
}

function Cell({ id, label, muted, today, children }: { id: string; label: ReactNode; muted?: boolean; today?: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} data-testid={id} className={`min-h-20 space-y-1 border p-1 ${muted ? 'bg-neutral-50 text-neutral-500 dark:bg-neutral-900' : ''} ${isOver ? 'outline outline-2 outline-blue-500' : ''} ${today ? 'border-blue-500' : ''}`}>
      <div className="text-xs">{label}</div>
      {children}
    </div>
  );
}

function EditForm({ e, members, base, onDone }: { e: Entry; members: Member[]; base: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(e.title);
  const [date, setDate] = useState(e.scheduledFor === null ? '' : formatDay(e.scheduledFor));
  const [status, setStatus] = useState<CalendarStatus>(e.status);
  const [who, setWho] = useState(e.assigneeUserId ?? '');
  const d = date ? parseDay(date) : null;
  const valid = !!title.trim() && (!date || d !== null);
  const save = useMutation({
    mutationFn: () => api(`${base}/calendar/${e.id}`, { method: 'PATCH', json: { title, scheduledFor: date ? d : null, status, assigneeUserId: who || null, version: e.version } }),
    onSettled: onDone,
  });
  const del = useMutation({ mutationFn: () => api(`${base}/calendar/${e.id}`, { method: 'DELETE' }), onSuccess: onDone });
  return (
    <form className="card grid gap-2 sm:grid-cols-2" aria-label={t('cal.editHeading')} onSubmit={(ev) => { ev.preventDefault(); if (valid) save.mutate(); }}>
      <div className="sm:col-span-2"><label className="block text-sm" htmlFor="ce-title">{t('cal.title')}</label><input id="ce-title" className="input" value={title} maxLength={120} onChange={(ev) => setTitle(ev.target.value)} /></div>
      <div><label className="block text-sm" htmlFor="ce-date">{t('cal.date')}</label><input id="ce-date" type="date" className="input" value={date} onChange={(ev) => setDate(ev.target.value)} /></div>
      <div><label className="block text-sm" htmlFor="ce-status">{t('cal.statusLabel')}</label>
        <select id="ce-status" className="input" value={status} onChange={(ev) => setStatus(ev.target.value as CalendarStatus)}>{CALENDAR_STATUSES.map((s) => <option key={s} value={s}>{t(`cal.status.${s}`)}</option>)}</select></div>
      <div><label className="block text-sm" htmlFor="ce-who">{t('cal.assignee')}</label>
        <select id="ce-who" className="input" value={who} onChange={(ev) => setWho(ev.target.value)}><option value="">{t('cal.nobody')}</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}</select></div>
      <div className="flex items-end gap-2">
        <button className="btn" disabled={!valid || save.isPending}>{t('project.save')}</button>
        <button type="button" className="btn btn-secondary" onClick={() => del.mutate()}>{t('ws.delete')}</button>
        <button type="button" className="text-sm underline" onClick={onDone}>{t('cal.close')}</button>
      </div>
      <div className="sm:col-span-2"><ErrorNote error={save.error ?? del.error} /></div>
    </form>
  );
}

/** O ponteiro decide o dia (itens largos, como os da coluna "sem data", não empatam entre vários dias); no teclado vale a interseção. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

export function CalendarPanel({ ws, clientId }: { ws: string; clientId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const base = `/api/workspaces/${ws}/clients/${clientId}`;
  const [view, setView] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(todayLocal());
  const [open, setOpen] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const weekStartsOn = i18n.resolvedLanguage === 'en' ? 0 : 1;
  const a = new Date(anchor);
  const weeks = view === 'month' ? monthGrid(a.getUTCFullYear(), a.getUTCMonth(), weekStartsOn) : [weekDays(anchor, weekStartsOn)];
  const first = weeks[0]?.[0] ?? anchor;
  const last = weeks[weeks.length - 1]?.[6] ?? anchor;
  const key = ['calendar', base, first, last];

  const entries = useQuery({ queryKey: key, queryFn: () => api<{ entries: Entry[] }>(`${base}/calendar?from=${first}&to=${last}`) });
  const members = useQuery({ queryKey: ['members', ws], queryFn: () => api<{ members: Member[] }>(`/api/workspaces/${ws}/members`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['calendar', base] });

  const move = useMutation({
    mutationFn: (v: { e: Entry; to: number | null }) => api(`${base}/calendar/${v.e.id}`, { method: 'PATCH', json: { scheduledFor: v.to, version: v.e.version } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ entries: Entry[] }>(key);
      qc.setQueryData<{ entries: Entry[] }>(key, (d) => d && { entries: d.entries.map((x) => (x.id === v.e.id ? { ...x, scheduledFor: v.to } : x)) });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); },
    onSettled: refresh,
  });
  const create = useMutation({
    mutationFn: () => api(`${base}/calendar`, { method: 'POST', json: { title: newTitle, scheduledFor: newDate ? parseDay(newDate) : null } }),
    onSuccess: () => { setNewTitle(''); setNewDate(''); refresh(); },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const onDragEnd = (ev: DragEndEvent) => {
    const e = entries.data?.entries.find((x) => x.id === ev.active.id);
    const over = ev.over?.id ? String(ev.over.id) : null;
    if (!e || !over) return;
    const to = over === 'day:none' ? null : Number(over.slice(4));
    if (to === e.scheduledFor) return;
    move.mutate({ e, to });
  };

  const all = entries.data?.entries ?? [];
  const at = (d: number) => all.filter((x) => x.scheduledFor === d);
  const unscheduled = all.filter((x) => x.scheduledFor === null);
  const opened = all.find((x) => x.id === open) ?? null;
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeZone: 'UTC', ...o });
  const today = todayLocal();
  const step = (dir: 1 | -1) => setAnchor(view === 'month' ? Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + dir, 1) : addDays(anchor, 7 * dir));
  const heads = weeks[0] ?? [];

  return (
    <section className="space-y-3" aria-label={t('cal.heading')}>
      <h2 className="text-lg font-medium">{t('cal.heading')}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{t('cal.help')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-secondary" onClick={() => step(-1)} aria-label={t('cal.prev')}>‹</button>
        <button className="btn btn-secondary" onClick={() => setAnchor(todayLocal())}>{t('cal.today')}</button>
        <button className="btn btn-secondary" onClick={() => step(1)} aria-label={t('cal.next')}>›</button>
        <strong aria-live="polite">{view === 'month' ? fmt({ month: 'long', year: 'numeric' }).format(anchor) : `${fmt({ day: 'numeric', month: 'short' }).format(first)} – ${fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(last)}`}</strong>
        <span className="flex-1" />
        <button className="btn btn-secondary" aria-pressed={view === 'month'} onClick={() => setView('month')}>{t('cal.month')}</button>
        <button className="btn btn-secondary" aria-pressed={view === 'week'} onClick={() => setView('week')}>{t('cal.week')}</button>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-7 text-center text-xs font-medium" aria-hidden>{heads.map((d) => <div key={d}>{fmt({ weekday: 'short' }).format(d)}</div>)}</div>
        <div className="grid grid-cols-7" role="grid" aria-label={t('cal.grid')}>
          {weeks.flat().map((d) => (
            <Cell key={d} id={`day:${d}`} label={fmt({ day: 'numeric', ...(view === 'week' ? { month: 'short' } : {}) }).format(d)} muted={view === 'month' && new Date(d).getUTCMonth() !== a.getUTCMonth()} today={d === today}>
              {at(d).map((e) => <Chip key={e.id} e={e} selected={open === e.id} onOpen={() => setOpen(e.id)} />)}
            </Cell>
          ))}
        </div>
        <Cell id="day:none" label={t('cal.unscheduled')}>
          {unscheduled.map((e) => <Chip key={e.id} e={e} selected={open === e.id} onOpen={() => setOpen(e.id)} />)}
        </Cell>
      </DndContext>
      <p className="text-xs">{t('cal.dragHelp')}</p>
      <ErrorNote error={move.error ?? entries.error} />

      {opened && <EditForm key={`${opened.id}-${opened.version}`} e={opened} members={members.data?.members ?? []} base={base} onDone={() => { setOpen(null); refresh(); }} />}

      <form className="card flex flex-wrap items-end gap-2" aria-label={t('cal.newHeading')} onSubmit={(e) => { e.preventDefault(); if (newTitle.trim() && (!newDate || parseDay(newDate) !== null)) create.mutate(); }}>
        <div><label className="block text-sm" htmlFor="cn-title">{t('cal.title')}</label><input id="cn-title" className="input" value={newTitle} maxLength={120} onChange={(e) => setNewTitle(e.target.value)} /></div>
        <div><label className="block text-sm" htmlFor="cn-date">{t('cal.date')}</label><input id="cn-date" type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></div>
        <button className="btn" disabled={create.isPending || !newTitle.trim()}>{t('cal.add')}</button>
      </form>
      <ErrorNote error={create.error} />
    </section>
  );
}
