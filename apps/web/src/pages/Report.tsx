import { useCallback, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { REPORT_LIMITS, REPORT_REASONS, type ReportReason } from '@contentflow/shared';
import { ErrorNote } from '../components/ErrorNote';
import { Turnstile } from '../components/Turnstile';
import { api } from '../lib/api';
import { useServerConfig } from '../lib/session';

/** Página pública de denúncia: sem login. Falha fechada se o Turnstile não estiver configurado (R4). */
export function Report() {
  const { t } = useTranslation();
  const cfg = useServerConfig();
  const [link, setLink] = useState('');
  const [reason, setReason] = useState<ReportReason>('abuse');
  const [details, setDetails] = useState('');
  const [contact, setContact] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const onToken = useCallback((v: string | null) => setToken(v), []);
  const c = cfg.data;
  const blocked = c?.turnstile.mode === 'not_configured';
  const tokenToSend = c?.turnstile.mode === 'dev_bypass' ? 'dev-bypass' : token;
  const send = useMutation({
    mutationFn: () => api('/api/reports', { method: 'POST', json: { link, reason, details: details || undefined, contact: contact || undefined, turnstileToken: tokenToSend } }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!tokenToSend) return setWaiting(true);
    setWaiting(false);
    send.mutate();
  };
  if (send.isSuccess) return <p role="status" className="card max-w-xl">{t('report.sent')}</p>;
  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('report.title')}</h1>
      <p className="text-sm">{t('report.intro')}</p>
      <p className="card text-sm">{t('report.notice')}</p>
      {blocked && <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">{t('report.notConfigured')}</p>}
      <form className="space-y-3" onSubmit={submit}>
        <div>
          <label htmlFor="rp-link" className="mb-1 block text-sm">{t('report.link')}</label>
          <input id="rp-link" className="input" required maxLength={REPORT_LIMITS.link} value={link} onChange={(e) => setLink(e.target.value)} aria-describedby="rp-link-h" />
          <p id="rp-link-h" className="text-xs text-neutral-600 dark:text-neutral-400">{t('report.linkHint')}</p>
        </div>
        <div>
          <label htmlFor="rp-reason" className="mb-1 block text-sm">{t('report.reason')}</label>
          <select id="rp-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
            {REPORT_REASONS.map((r) => <option key={r} value={r}>{t(`report.reasons.${r}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rp-details" className="mb-1 block text-sm">{t('report.details')}</label>
          <textarea id="rp-details" className="input" rows={4} maxLength={REPORT_LIMITS.details} value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rp-contact" className="mb-1 block text-sm">{t('report.contact')}</label>
          <input id="rp-contact" className="input" maxLength={REPORT_LIMITS.contact} value={contact} onChange={(e) => setContact(e.target.value)} aria-describedby="rp-contact-h" />
          <p id="rp-contact-h" className="text-xs text-neutral-600 dark:text-neutral-400">{t('report.contactHint')}</p>
        </div>
        {c?.turnstile.mode === 'enforced' && c.turnstile.siteKey && <Turnstile siteKey={c.turnstile.siteKey} onToken={onToken} />}
        {waiting && <p role="status" className="text-sm">{t('report.waiting')}</p>}
        <ErrorNote error={send.error} />
        <button className="btn" disabled={!c || blocked || send.isPending}>{t('report.send')}</button>
      </form>
    </section>
  );
}
