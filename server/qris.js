// QRIS (EMVCo Merchant-Presented QR) utilities.
// Converts a merchant's static QRIS into a dynamic QRIS with the amount embedded,
// so the customer does not have to type the nominal.

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as required by EMVCo tag 63. */
export function crc16(input) {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Parse a TLV string ("TTLLVALUE...") into an ordered list of { tag, value }. */
export function parseTLV(input) {
  const fields = [];
  let i = 0;
  while (i < input.length) {
    const tag = input.slice(i, i + 2);
    const lenStr = input.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) {
      throw new Error('Format QRIS tidak valid.');
    }
    const len = Number(lenStr);
    const value = input.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new Error('Format QRIS tidak valid (data terpotong).');
    fields.push({ tag, value });
    i += 4 + len;
  }
  return fields;
}

function encodeTLV(tag, value) {
  if (value.length > 99) throw new Error(`Nilai tag ${tag} terlalu panjang.`);
  return tag + String(value.length).padStart(2, '0') + value;
}

/**
 * Validate a QRIS payload and extract merchant information.
 * Throws an Error with a user-facing (Indonesian) message when invalid.
 */
export function analyzeQris(raw) {
  const payload = String(raw ?? '').replace(/[\r\n\t]/g, '').trim();
  if (!payload) throw new Error('Kode QRIS kosong.');
  if (payload.length > 512) throw new Error('Kode QRIS terlalu panjang.');
  if (!payload.startsWith('000201')) {
    throw new Error('Ini bukan kode QRIS yang valid. Pastikan gambar yang diunggah adalah QRIS toko Anda.');
  }

  const fields = parseTLV(payload);
  const last = fields[fields.length - 1];
  if (!last || last.tag !== '63' || last.value.length !== 4) {
    throw new Error('Kode QRIS tidak memiliki checksum (CRC) yang valid.');
  }
  if (crc16(payload.slice(0, -4)) !== last.value.toUpperCase()) {
    throw new Error('Checksum QRIS tidak cocok. Kode mungkin rusak atau salah salin.');
  }

  const get = (tag) => fields.find((f) => f.tag === tag)?.value ?? null;
  if (!payload.includes('ID.CO.QRIS.WWW') && get('58') !== 'ID') {
    throw new Error('Kode QR ini bukan QRIS Indonesia.');
  }

  let nmid = null;
  const merchantInfo = get('51');
  if (merchantInfo) {
    try {
      nmid = parseTLV(merchantInfo).find((f) => f.tag === '02')?.value ?? null;
    } catch {
      nmid = null;
    }
  }

  return {
    payload,
    merchantName: get('59') || '',
    merchantCity: get('60') || '',
    nmid,
    isStatic: get('01') !== '12',
    hasAmount: Boolean(get('54')),
    currency: get('53'),
  };
}

/** Build a dynamic QRIS payload (amount embedded) from a static QRIS payload. */
export function toDynamicQris(staticPayload, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Nominal QRIS tidak valid.');
  const amountStr = String(amount);
  if (amountStr.length > 13) throw new Error('Nominal QRIS terlalu besar.');

  const fields = parseTLV(staticPayload).filter((f) => f.tag !== '63' && f.tag !== '54');

  const poi = fields.find((f) => f.tag === '01');
  if (poi) poi.value = '12';
  else fields.splice(1, 0, { tag: '01', value: '12' });

  const amountField = { tag: '54', value: amountStr };
  const currencyIndex = fields.findIndex((f) => f.tag === '53');
  if (currencyIndex >= 0) {
    fields.splice(currencyIndex + 1, 0, amountField);
  } else {
    const after = fields.findIndex((f) => Number(f.tag) > 54);
    if (after >= 0) fields.splice(after, 0, amountField);
    else fields.push(amountField);
  }

  const body = fields.map((f) => encodeTLV(f.tag, f.value)).join('') + '6304';
  return body + crc16(body);
}
