// Minimal client-side router (the app only needs a handful of flat routes).
import { useSyncExternalStore } from 'react';

const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function Link({ to, onClick, ...props }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...props}
    />
  );
}
