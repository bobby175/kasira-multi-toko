import { useSyncExternalStore } from 'react';

/** True on phones (short side <= 520 CSS px), regardless of current orientation. */
export const isPhone = () => Math.min(window.screen.width, window.screen.height) <= 520;

/** Fullscreen + landscape lock is possible on Android Chrome; iPhone Safari has no fullscreen API. */
export const canLockLandscape = () => Boolean(document.fullscreenEnabled) && isPhone();

function subscribe(listener) {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
}

export function useIsFullscreen() {
  return useSyncExternalStore(subscribe, () => Boolean(document.fullscreenElement));
}

// Same condition as the `short:` CSS variant (phone held in landscape).
const SHORT_QUERY = '(orientation: landscape) and (max-height: 520px)';

function subscribeShort(listener) {
  const mq = window.matchMedia(SHORT_QUERY);
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}

export function useShortScreen() {
  return useSyncExternalStore(subscribeShort, () => window.matchMedia(SHORT_QUERY).matches);
}

/** Enter fullscreen and rotate to landscape. Must be called from a tap/click. */
export async function enterLandscape({ lock = true } = {}) {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    return false;
  }
  if (lock) {
    try {
      await window.screen.orientation?.lock?.('landscape');
    } catch {
      /* browser refused the lock; fullscreen alone still gains screen space */
    }
  }
  return true;
}

export async function exitFullscreen() {
  try {
    window.screen.orientation?.unlock?.();
  } catch {
    /* ignore */
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}
