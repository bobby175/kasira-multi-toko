const unauthorizedListeners = new Set();

/** Identifies this browser tab, so realtime events triggered here are not re-announced here. */
export const CLIENT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Subscribe to "session expired" events (HTTP 401). */
export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Kasira': '1',
        'X-Client-Id': CLIENT_ID,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi jaringan.', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') unauthorizedListeners.forEach((l) => l());
    throw new ApiError(data?.error || `Terjadi kesalahan (${res.status})`, res.status);
  }
  return data;
}
