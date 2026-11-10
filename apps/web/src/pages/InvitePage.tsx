import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorNote } from '../components/ErrorNote';
import { api, ApiRequestError } from '../lib/api';
import { useMe } from '../lib/session';

export function InvitePage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['invite', token],
    enabled: !!me.data,
    retry: false,
    queryFn: () => api<{ workspaceName: string; role: string; expiresAt: number; alreadyMember: boolean }>(`/api/invites/${token}`),
  });
  const accept = useMutation({
    mutationFn: () => api<{ workspaceId: string }>(`/api/invites/${token}/accept`, { method: 'POST', json: {} }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['me'] }); navigate('/app'); },
  });
  if (me.isLoading) return <p>…</p>;
  if (!me.data) {
    return (
      <section className="space-y-3 max-w-md" aria-label={t('invite.heading')}>
        <h1 className="text-2xl font-semibold">{t('invite.heading')}</h1>
        <p>{t('invite.needLogin')}</p>
        <p className="flex gap-3"><Link className="btn" to="/login">{t('nav.login')}</Link><Link className="btn btn-secondary" to="/register">{t('nav.register')}</Link></p>
        <p className="text-sm">{t('invite.reopen')}</p>
      </section>
    );
  }
  const gone = info.error instanceof ApiRequestError && info.error.status === 404;
  return (
    <section className="space-y-3 max-w-md" aria-label={t('invite.heading')}>
      <h1 className="text-2xl font-semibold">{t('invite.heading')}</h1>
      {gone && <p role="alert">{t('invite.invalid')}</p>}
      {info.data && (
        <div className="card space-y-2">
          <p>{t('invite.body', { name: info.data.workspaceName, role: info.data.role })}</p>
          {info.data.alreadyMember ? <p role="status">{t('invite.already')}</p> : <button className="btn" disabled={accept.isPending} onClick={() => accept.mutate()}>{t('invite.accept')}</button>}
        </div>
      )}
      {!gone && <ErrorNote error={info.error && !gone ? info.error : accept.error} />}
    </section>
  );
}
