import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';
import { installMediaNotification } from './native/media';
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
  let start = { x: 0, y: 0 };
  const cancel = () => window.clearTimeout(timer);
  const moved = (x: number, y: number) => Math.hypot(x - start.x, y - start.y) > 12;
  document.addEventListener(
    'pointerdown',
    (ev) => {
      const t = ev.target as Element | null;
      const onTitle = !!t?.closest?.('h1, header, [data-wrapper-title]');
      const onCorner = ev.clientX < 56 && ev.clientY < 56;
      if (!onTitle && !onCorner) return;
      cancel();
      start = { x: ev.clientX, y: ev.clientY };
      timer = window.setTimeout(() => {
        window.getSelection()?.removeAllRanges();
        void openDebug();
      }, LONG_PRESS_MS);
    },
    true,
  );
  // pointercancel/touchcancel are deliberately not used: Android fires them when text selection starts, long before the press ends.
  document.addEventListener('touchmove', (ev) => {
    const t = ev.touches[0];
    if (t && moved(t.clientX, t.clientY)) cancel();
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'touch' && moved(ev.clientX, ev.clientY)) cancel();
  }, true);
  for (const e of ['pointerup', 'touchend']) document.addEventListener(e, cancel, true);
  // Stops Android's long-press text selection from hijacking the gesture.
  const style = document.createElement('style');
  style.textContent = 'h1,header,[data-wrapper-title]{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}';
  document.head.append(style);
  document.addEventListener('contextmenu', (ev) => {
    const t = ev.target as Element | null;
    if (t?.closest?.('h1, header, [data-wrapper-title]')) ev.preventDefault();
  }, true);
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
  installMediaNotification();
  void SplashScreen.hide();
  // Full page navigations re-run this script; only treat the first load of the session as a launch.
  if (!sessionStorage.getItem(LAUNCHED_FLAG)) {
    sessionStorage.setItem(LAUNCHED_FLAG, '1');
    void maybeCheck(false);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
