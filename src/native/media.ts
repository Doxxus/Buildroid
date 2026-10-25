import { registerPlugin } from '@capacitor/core';

interface MediaNotificationPlugin {
  update(o: {
    title: string;
    artist: string;
    album: string;
    playing: boolean;
    position: number;
    duration: number;
    rate: number;
  }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: 'mediaAction',
    cb: (e: { action: string; position?: number }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

const Native = registerPlugin<MediaNotificationPlugin>('MediaNotification');

type Handler = ((d: MediaSessionActionDetails) => void) | null;

/**
 * Mirrors playback of <audio>/<video> elements (and navigator.mediaSession metadata, if the site sets it) into the
 * Android media notification, and routes its buttons back to the site's mediaSession handlers or the element itself.
 */
export function installMediaNotification(): void {
  const ms = navigator.mediaSession;
  const handlers = new Map<string, Handler>();
  if (ms) {
    const orig = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      handlers.set(action, h);
      try {
        orig(action, h);
      } catch {
        /* unsupported action */
      }
    };
  }

  let active: HTMLMediaElement | null = null;
  let lastSig = '';
  const seen = new WeakSet<HTMLMediaElement>();

  const sync = (force = false): void => {
    const el = active;
    if (!el) return;
    const md = ms?.metadata;
    const playing = !el.paused && !el.ended;
    const payload = {
      title: md?.title || document.title || '',
      artist: md?.artist || '',
      album: md?.album || '',
      playing,
      position: Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      rate: el.playbackRate || 1,
    };
    const sig = JSON.stringify({ ...payload, position: 0 });
    if (!force && sig === lastSig) return;
    lastSig = sig;
    void Native.update(payload).catch(() => undefined);
  };

  const attach = (el: HTMLMediaElement): void => {
    if (seen.has(el)) return;
    seen.add(el);
    const on = (e: string, fn: () => void) => el.addEventListener(e, fn);
    on('play', () => {
      active = el;
      sync(true);
    });
    on('playing', () => {
      active = el;
      sync(true);
    });
    for (const e of ['pause', 'ended', 'seeked', 'ratechange', 'durationchange', 'loadedmetadata']) {
      on(e, () => {
        if (active === el) sync(true);
      });
    }
  };

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    attach(this);
    return origPlay.call(this);
  };
  document.addEventListener('play', (e) => e.target instanceof HTMLMediaElement && attach(e.target), true);
  document.querySelectorAll('audio,video').forEach((el) => attach(el as HTMLMediaElement));

  // The site often sets mediaSession.metadata after playback starts or on track change.
  window.setInterval(() => sync(), 1000);

  void Native.addListener('mediaAction', ({ action, position }) => {
    const el = active;
    const h = handlers.get(action);
    if (h) {
      h({ action: action as MediaSessionAction, seekTime: position });
      return;
    }
    if (!el) return;
    switch (action) {
      case 'play':
        void el.play();
        break;
      case 'pause':
      case 'stop':
        el.pause();
        break;
      case 'seekto':
        if (position !== undefined) el.currentTime = position;
        break;
      case 'nexttrack':
      case 'previoustrack':
        break;
    }
  });
}
