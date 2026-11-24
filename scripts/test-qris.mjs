// Self-check for the QRIS converter. Run: node scripts/test-qris.mjs
import assert from 'node:assert/strict';
import { crc16, parseTLV, analyzeQris, toDynamicQris } from '../server/qris.js';

// Standard check value for CRC-16/CCITT-FALSE
assert.equal(crc16('123456789'), '29B1');

// Build a sample static QRIS (structure mirrors real QRIS stickers)
const tlv = (t, v) => t + String(v.length).padStart(2, '0') + v;
const merchant51 = tlv('00', 'ID.CO.QRIS.WWW') + tlv('02', 'ID1020021181745') + tlv('03', 'UMI');
const body =
  tlv('00', '01') +
  tlv('01', '11') +
  tlv('26', tlv('00', 'ID.DANA.WWW') + tlv('01', '936009153022591481') + tlv('02', '022591481') + tlv('03', 'UMI')) +
  tlv('51', merchant51) +
  tlv('52', '5812') +
  tlv('53', '360') +
  tlv('58', 'ID') +
  tlv('59', 'TOKO CONTOH') +
  tlv('60', 'MEDAN') +
  tlv('61', '20111') +
  tlv('62', tlv('07', 'A01')) +
  '6304';
const staticQris = body + crc16(body);

const info = analyzeQris(staticQris);
assert.equal(info.merchantName, 'TOKO CONTOH');
assert.equal(info.merchantCity, 'MEDAN');
assert.equal(info.nmid, 'ID1020021181745');
assert.equal(info.isStatic, true);

const dyn = toDynamicQris(staticQris, 25000);
const dynInfo = analyzeQris(dyn); // validates CRC of the new payload
assert.equal(dynInfo.isStatic, false);
const fields = parseTLV(dyn);
assert.equal(fields.find((f) => f.tag === '01').value, '12');
assert.equal(fields.find((f) => f.tag === '54').value, '25000');
const tags = fields.map((f) => f.tag);
assert.equal(tags.indexOf('54'), tags.indexOf('53') + 1, 'tag 54 must follow tag 53');
assert.equal(tags.at(-1), '63');

// Re-converting a dynamic payload replaces the amount instead of duplicating it
const dyn2 = toDynamicQris(dyn, 1500);
assert.equal(parseTLV(dyn2).filter((f) => f.tag === '54').length, 1);
assert.equal(parseTLV(dyn2).find((f) => f.tag === '54').value, '1500');

// Corrupted payload is rejected
assert.throws(() => analyzeQris(staticQris.slice(0, -1) + (staticQris.endsWith('0') ? '1' : '0')), /Checksum/);
assert.throws(() => analyzeQris('hello'), /bukan kode QRIS/);

console.log('QRIS OK');
console.log('static :', staticQris);
console.log('dynamic:', dyn);
