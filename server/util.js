export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status, message) => new HttpError(status, message);

/** Validate and trim a string field. */
export function str(value, { field, max = 200, required = false, pattern, patternMessage } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw httpError(400, `${field} tidak valid`);
  const v = value.trim();
  if (required && !v) throw httpError(400, `${field} wajib diisi`);
  if (v.length > max) throw httpError(400, `${field} maksimal ${max} karakter`);
  if (v && pattern && !pattern.test(v)) throw httpError(400, patternMessage || `${field} tidak valid`);
  return v;
}

/** Validate an integer field (accepts numeric strings). */
export function int(value, { field, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isSafeInteger(n)) throw httpError(400, `${field} harus berupa angka bulat`);
  if (n < min) throw httpError(400, `${field} minimal ${min}`);
  if (n > max) throw httpError(400, `${field} maksimal ${max}`);
  return n;
}

export function parseId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw httpError(404, 'Data tidak ditemukan');
  return n;
}
