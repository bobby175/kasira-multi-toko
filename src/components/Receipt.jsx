import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { METHOD_LABEL, formatDateTime, formatNumber, formatTime, rupiah } from '../lib/format.js';

let requestPrint = null;

/** Print a receipt for a paid transaction (uses the browser print dialog). */
export function printReceipt(tx, store) {
  requestPrint?.({ tx, store, id: Date.now() });
}

export function Receipt({ tx, store }) {
  return (
    <div className={`receipt paper-${store.paperWidth === 80 ? 80 : 58}`}>
      <div className="r-center">
        <div className="r-title">{store.name}</div>
        {store.address && <div className="r-muted">{store.address}</div>}
        {store.phone && <div className="r-muted">Telp. {store.phone}</div>}
      </div>
      <div className="r-sep" />
      <div className="r-row"><span>No</span><span>{tx.code}</span></div>
      <div className="r-row"><span>Tanggal</span><span>{formatDateTime(tx.createdAt)}</span></div>
      <div className="r-row"><span>Kasir</span><span>{tx.createdBy?.name}</span></div>
      <div className="r-sep" />
      {tx.items.map((item, i) => (
        <div key={i} style={{ marginBottom: '1.2mm' }}>
          <div>{item.name}</div>
          <div className="r-row">
            <span className="r-muted">
              {item.qty} x {formatNumber(item.price)}
            </span>
            <span>{formatNumber(item.subtotal)}</span>
          </div>
        </div>
      ))}
      <div className="r-sep" />
      <div className="r-row r-total"><span>TOTAL</span><span>{rupiah(tx.total)}</span></div>
      <div className="r-row"><span>Bayar</span><span>{METHOD_LABEL[tx.method]}</span></div>
      <div className="r-row"><span>Status</span><span><b>{tx.status === 'paid' ? 'LUNAS' : tx.status.toUpperCase()}</b></span></div>
      {tx.confirmedAt && (
        <div className="r-row r-muted"><span>Dikonfirmasi</span><span>{tx.confirmedBy?.name} {formatTime(tx.confirmedAt)}</span></div>
      )}
      <div className="r-sep" />
      {store.footer && <div className="r-center">{store.footer}</div>}
      <div className="r-center r-muted" style={{ marginTop: '2mm', fontSize: '0.85em' }}>{tx.code}</div>
    </div>
  );
}

/** Mount once. Keeps the last receipt in #print-root (hidden on screen) and opens the print dialog. */
export function PrintHost() {
  const [job, setJob] = useState(null);

  useEffect(() => {
    requestPrint = setJob;
    return () => {
      requestPrint = null;
    };
  }, []);

  useEffect(() => {
    if (!job) return undefined;
    const timer = setTimeout(() => window.print(), 120);
    return () => clearTimeout(timer);
  }, [job]);

  const root = document.getElementById('print-root');
  if (!job || !root) return null;
  return createPortal(<Receipt tx={job.tx} store={job.store} />, root);
}
