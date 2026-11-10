import { useTranslation } from 'react-i18next';
import { ApiRequestError } from '../lib/api';
import { ERROR_LIMITATION_MAP } from '../lib/errors';
import { Limitation } from '../limitations/Limitation';
import { SubtitleParseError } from '@contentflow/shared';
import { ReaderError } from '../lib/readers';

/** Mostra um erro real (nunca genérico demais) e, se houver, a limitação correspondente. */
export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  let msg: string;
  let limitation: string | undefined;
  if (error instanceof ReaderError) msg = t(`reader.${error.code}`);
  else if (error instanceof SubtitleParseError) msg = t(`subtitle.${error.code}`);
  else if (error instanceof ApiRequestError) {
    msg = t(`errors.${error.code}`, { defaultValue: t('errors.internal_error') });
    limitation = ERROR_LIMITATION_MAP[error.code];
  } else msg = t('errors.internal_error');
  return (
    <div role="alert" className="space-y-1 text-sm text-red-700 dark:text-red-300">
      <p>{msg}</p>
      {limitation && <Limitation id={limitation} variant="inline" />}
    </div>
  );
}
