// Unit test for the notification amount parser. Run: node scripts/test-notify.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Use a throwaway database: importing the module opens the DB.
process.env.DATA_DIR = path.join(os.tmpdir(), `kasira-notify-test-${process.pid}`);
const { parseAmounts, extractNotification } = await import('../server/notify.js');

const cases = [
  ['Pembayaran QRIS Rp18.000 diterima', [18000]],
  ['Dana masuk Rp 18.000,00 dari BUDI', [18000]],
  ['Kamu menerima Rp. 1.250.000.', [1250000]],
  ['Received IDR 18,000.00 via QRIS', [18000]],
  ['Transfer masuk Rp18000', [18000]],
  ['Pembayaran Rp18.000,- berhasil', [18000]],
  ['Rp 500 cashback', [500]],
  ['Terima Rp25.000. Saldo Rp1.230.500', [25000, 1230500]],
  ['Pesanan #1234 jam 14:30 tanggal 21-11-2026', []],
];
for (const [text, expected] of cases) assert.deepEqual(parseAmounts(text), expected, text);

// Plain text body as sent by MacroDroid (app name, title, text on separate lines)
let n = extractNotification('GoPay Merchant\nPembayaran diterima\nRp51.000 dari pelanggan\n1763712000123', 'text/plain');
assert.equal(n.source, 'GoPay Merchant');
assert.equal(n.text, 'Pembayaran diterima Rp51.000 dari pelanggan 1763712000123');
assert.deepEqual(parseAmounts(n.text), [51000]);
n = extractNotification('Dana masuk Rp 20.000', 'text/plain'); // single line: no app name
assert.equal(n.source, '');
assert.deepEqual(parseAmounts(n.text), [20000]);

// JSON body, including broken JSON caused by unescaped quotes in the notification text
n = extractNotification('{"app":"DANA Bisnis","title":"Uang masuk","text":"Rp 20.000"}', 'application/json');
assert.equal(n.source, 'DANA Bisnis');
assert.deepEqual(parseAmounts(n.text), [20000]);
n = extractNotification('{"text":"Dari "Toko" Rp 20.000"}', 'application/json');
assert.deepEqual(parseAmounts(n.text), [20000]);

// Form body
n = extractNotification('app=BCA&text=Dana+masuk+Rp+75.500', 'application/x-www-form-urlencoded');
assert.equal(n.source, 'BCA');
assert.deepEqual(parseAmounts(n.text), [75500]);

const { db } = await import('../server/db.js');
db.close();
(await import('node:fs')).rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log('NOTIFY PARSER OK');
