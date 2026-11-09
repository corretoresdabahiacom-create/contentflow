import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <p>
      {t('notFound')} <Link to="/">{t('nav.home')}</Link>
    </p>
  );
}
