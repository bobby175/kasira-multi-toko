function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('File bukan gambar yang valid.'));
    };
    img.src = url;
  });
}

/** Resize + center-crop an image file to a square JPEG data URL (for product photos). */
export async function imageFileToSquareDataUrl(file, size = 560) {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement('canvas');
  const target = Math.min(size, side);
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, target, target);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
  return canvas.toDataURL('image/jpeg', 0.84);
}

/** Read a QR code from an uploaded image (photo/screenshot of the QRIS sticker). */
export async function decodeQrFromFile(file) {
  const [{ default: jsQR }, img] = await Promise.all([import('jsqr'), loadImage(file)]);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const longest = Math.max(img.naturalWidth, img.naturalHeight);

  for (const maxSide of [1400, 1000, 700, 2000]) {
    const scale = Math.min(1, maxSide / longest);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const result = jsQR(data, w, h, { inversionAttempts: 'attemptBoth' });
    if (result?.data) return result.data;
  }
  return null;
}

/** Copy text to clipboard with a fallback for non-HTTPS (LAN) origins. */
export async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
