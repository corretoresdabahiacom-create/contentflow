import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES } from '@contentflow/shared';
import { setLocale } from '../i18n';
import { api } from '../lib/api';
import { useMe } from '../lib/session';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { OfflineBanner } from './OfflineBanner';

export function Layout() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.setQueryData(['me'], null);
    navigate('/');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <OfflineBanner />
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3 text-sm"
          aria-label="Main"
        >
          <Link to="/" className="font-semibold no-underline">
            ContentFlow AI
          </Link>
          <Link to="/docs/limitations">{t('nav.limitations')}</Link>
          <Link to="/report">{t('nav.report')}</Link>
          <span className="flex-1" />
          <label className="sr-only" htmlFor="lang">
            {t('nav.language')}
          </label>
          <select
            id="lang"
            className="input !w-auto"
            value={i18n.resolvedLanguage}
            onChange={(e) => setLocale(e.target.value)}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="theme">
            {t('nav.theme')}
          </label>
          <select
            id="theme"
            className="input !w-auto"
            defaultValue={getThemePref()}
            onChange={(e) => setThemePref(e.target.value as ThemePref)}
          >
            {(['system', 'light', 'dark'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`theme.${p}`)}
              </option>
            ))}
          </select>
          {me.data ? (
            <>
              <Link to="/app">{t('nav.app')}</Link>
              {me.data.user.isGlobalAdmin && <Link to="/app/admin">{t('nav.admin')}</Link>}
              <button className="btn btn-secondary" onClick={logout}>
                {t('nav.logout')}
              </button>
            </>
          ) : (
            <>
              <Link to="/login">{t('nav.login')}</Link>
              <Link to="/register" className="btn">
                {t('nav.register')}
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
