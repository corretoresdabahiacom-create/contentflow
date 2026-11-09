import { useEffect, useRef } from 'react';

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void },
  ) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<void> | null = null;
const loadScript = () =>
  (loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(s);
  }));

export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (t: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget: string | undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widget = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (t) => onToken(t),
          'expired-callback': () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, onToken]);
  return <div ref={ref} data-testid="turnstile" />;
}
