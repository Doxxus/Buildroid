import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';
import { openDebug, runCheck } from './ui';

const LONG_PRESS_MS = 800;
const LAUNCHED_FLAG = 'bw.launched';

function openExternally(url: string): void {
  void Browser.open({ url });
}

function installExternalLinks(): void {
  document.addEventListener(
    'click',
    (ev) => {
      const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      let u: URL;
      try {
        u = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (u.origin !== location.origin && /^(https?|mailto|tel):$/.test(u.protocol)) {
        ev.preventDefault();
        openExternally(u.toString());
      }
    },
    true,
  );
  window.open = ((url?: string | URL) => {
    if (url) openExternally(new URL(String(url), location.href).toString());
    return null;
  }) as typeof window.open;
}

// Long-press the page title (first <h1>/<header>, or the top-left corner) to open the debug screen.
function installDebugTrigger(): void {
  let timer: number | undefined;
  const cancel = () => window.clearTimeout(timer);
  document.addEventListener(
    'pointerdown',
    (ev) => {
      const t = ev.target as Element | null;
      const onTitle = !!t?.closest?.('h1, header, [data-wrapper-title]');
      const onCorner = ev.clientX < 56 && ev.clientY < 56;
      if (!onTitle && !onCorner) return;
      cancel();
      timer = window.setTimeout(() => void openDebug(), LONG_PRESS_MS);
    },
    true,
  );
  for (const e of ['pointerup', 'pointercancel', 'pointermove', 'scroll']) document.addEventListener(e, cancel, true);
}

async function maybeCheck(throttle: boolean): Promise<void> {
  const status = await Network.getStatus();
  if (!status.connected) return; // offline: keep serving the cached bundle
  await runCheck({ throttle });
}

function boot(): void {
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else void App.exitApp();
  });
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void maybeCheck(true);
  });
  installExternalLinks();
  installDebugTrigger();
  void SplashScreen.hide();
  // Full page navigations re-run this script; only treat the first load of the session as a launch.
  if (!sessionStorage.getItem(LAUNCHED_FLAG)) {
    sessionStorage.setItem(LAUNCHED_FLAG, '1');
    void maybeCheck(false);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
