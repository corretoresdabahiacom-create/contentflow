import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LOCALES } from '@contentflow/shared';
import en from './en.json';
import pt from './pt.json';

const KEY = 'cf_lang'; // preferência de idioma (não é credencial)

export function detectLocale(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) return saved;
  } catch {
    /* storage indisponível */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return (SUPPORTED_LOCALES as readonly string[]).includes(nav) ? nav : 'en';
}

export function setLocale(lng: string) {
  try {
    localStorage.setItem(KEY, lng);
  } catch {
    /* ignore */
  }
  void i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, pt: { translation: pt } }, // 'es': adicionar es.json
  lng: detectLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
