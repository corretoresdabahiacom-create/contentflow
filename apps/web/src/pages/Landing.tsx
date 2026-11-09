import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

export function Landing() {
  const { t } = useTranslation();
  return (
    <section className="space-y-6 py-8">
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight">{t('landing.title')}</h1>
      <p className="max-w-2xl text-lg text-neutral-700 dark:text-neutral-300">
        {t('landing.subtitle')}
      </p>
      <p className="card max-w-2xl text-sm">{t('landing.honest')}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Link to="/register" className="btn">
          {t('landing.cta')}
        </Link>
        <Link to="/docs/limitations">{t('landing.limitsLink')}</Link>
      </div>
    </section>
  );
}
