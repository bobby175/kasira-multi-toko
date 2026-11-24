import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, CLIENT_ID } from '../lib/api.js';
import { rupiah } from '../lib/format.js';
import { playChime } from '../lib/sound.js';
import { useToast } from '../components/ui.jsx';
import { useAuth } from './auth.jsx';

const DataContext = createContext(null);

const CART_KEY = 'kasira_cart_v1';

function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((i) => Number.isInteger(i.productId) && i.qty > 0) : [];
  } catch {
    return [];
  }
}

export function DataProvider({ children }) {
  const toast = useToast();
  const { user, logout } = useAuth();

  const [products, setProducts] = useState([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [settings, setSettings] = useState({ store: { name: '' }, qris: { configured: false }, banks: [] });
  const [txMap, setTxMap] = useState({});
  const [connected, setConnected] = useState(false);
  const [activeTxId, setActiveTxId] = useState(null);
  const [cart, setCart] = useState(loadCart);
  const [displayCount, setDisplayCount] = useState(0);
  const [notifyTick, setNotifyTick] = useState(0);

  const txListeners = useRef(new Set());
  const socketRef = useRef(null);
  // Set when the cashier changes the cart on this device; only those changes go to the customer display.
  const cartTouched = useRef(false);

  // ---------- loaders ----------
  const refreshProducts = useCallback(async () => {
    const data = await api('/products');
    setProducts(data.products);
    setProductsLoaded(true);
  }, []);

  const refreshSettings = useCallback(async () => {
    setSettings(await api('/settings'));
  }, []);

  const upsertTx = useCallback((tx) => setTxMap((m) => ({ ...m, [tx.id]: tx })), []);

  const refreshPending = useCallback(async () => {
    const data = await api('/transactions/pending');
    setTxMap((m) => {
      const next = {};
      // keep non-pending entries that are open/known, replace the pending set with fresh data
      for (const [id, tx] of Object.entries(m)) if (tx.status !== 'pending') next[id] = tx;
      for (const tx of data.transactions) next[tx.id] = tx;
      return next;
    });
  }, []);

  useEffect(() => {
    refreshProducts().catch((e) => toast.error(e.message));
    refreshSettings().catch((e) => toast.error(e.message));
    refreshPending().catch(() => {});
  }, [refreshProducts, refreshSettings, refreshPending, toast]);

  // ---------- realtime ----------
  const handlers = useRef({});
  handlers.current = {
    // A payment notification arrived but could not be matched safely: staff must check manually.
    onAttention: ({ amounts, detail, codes }) => {
      playChime('notify');
      const nominal = amounts?.length ? amounts.map(rupiah).join(', ') : 'tanpa nominal';
      toast.warning(`${detail}${codes?.length ? ` (${codes.join(', ')})` : ''}.`, {
        title: `Notifikasi pembayaran ${nominal} masuk`,
        duration: 12000,
      });
    },
    onTx: ({ transaction: tx, action, by, clientId }) => {
      upsertTx(tx);
      txListeners.current.forEach((l) => l({ tx, action, by }));
      if (clientId === CLIENT_ID) return;
      const who = by?.name ?? 'Staf';
      if (action === 'created') {
        playChime('notify');
        toast.info(`${tx.code} • ${rupiah(tx.total)} dari ${who}`, { title: 'Pembayaran baru menunggu konfirmasi' });
      } else if (action === 'confirmed') {
        playChime('success');
        if (tx.confirmSource === 'auto') {
          toast.success(`${tx.code} • ${rupiah(tx.total)} terkonfirmasi dari notifikasi pembayaran`, { title: 'Pembayaran lunas (otomatis)' });
        } else {
          toast.success(`${tx.code} • ${rupiah(tx.total)} dikonfirmasi oleh ${who}`, { title: 'Pembayaran lunas' });
        }
      } else if (action === 'cancelled') {
        toast.warning(`${tx.code} dibatalkan oleh ${who}`);
      }
    },
  };

  useEffect(() => {
    const socket = io({ withCredentials: true, auth: { deviceId: CLIENT_ID } });
    socketRef.current = socket;
    socket.on('display:presence', ({ count }) => setDisplayCount(count));
    socket.on('connect', () => {
      setConnected(true);
      // catch up on anything missed while offline
      refreshPending().catch(() => {});
      refreshProducts().catch(() => {});
      refreshSettings().catch(() => {});
    });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect') {
        // server kicked us (logout, role change, account disabled): re-check the session
        api('/auth/me')
          .then(() => socket.connect())
          .catch(() => {});
      }
    });
    socket.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'UNAUTHORIZED') {
        socket.close();
        logout().catch(() => {});
      }
    });
    socket.on('tx:updated', (payload) => handlers.current.onTx(payload));
    socket.on('notify:attention', (payload) => handlers.current.onAttention(payload));
    socket.on('notify:received', () => setNotifyTick((t) => t + 1));
    socket.on('products:changed', () => refreshProducts().catch(() => {}));
    socket.on('settings:changed', () => refreshSettings().catch(() => {}));
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [refreshPending, refreshProducts, refreshSettings, logout]);

  // ---------- cart ----------
  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  // Mirror cart changes to the customer display (short debounce merges rapid taps).
  useEffect(() => {
    if (!cartTouched.current) return undefined;
    const timer = setTimeout(() => {
      cartTouched.current = false;
      socketRef.current?.emit('cart:update', { items: cart.map(({ productId, qty }) => ({ productId, qty })) });
    }, 60);
    return () => clearTimeout(timer);
  }, [cart]);

  // Drop cart lines whose product was deleted.
  useEffect(() => {
    if (!productsLoaded) return;
    const ids = new Set(products.map((p) => p.id));
    setCart((c) => (c.every((i) => ids.has(i.productId)) ? c : c.filter((i) => ids.has(i.productId))));
  }, [products, productsLoaded]);

  const cartApi = useMemo(() => {
    const change = (updater) => {
      cartTouched.current = true;
      setCart(updater);
    };
    return {
      add: (productId) =>
        change((c) => {
          const found = c.find((i) => i.productId === productId);
          if (found) return c.map((i) => (i.productId === productId ? { ...i, qty: Math.min(i.qty + 1, 9999) } : i));
          return [...c, { productId, qty: 1 }];
        }),
      setQty: (productId, qty) =>
        change((c) =>
          qty <= 0 ? c.filter((i) => i.productId !== productId) : c.map((i) => (i.productId === productId ? { ...i, qty: Math.min(qty, 9999) } : i))
        ),
      remove: (productId) => change((c) => c.filter((i) => i.productId !== productId)),
      clear: () => change([]),
      replace: (items) => change(items),
    };
  }, []);

  const productMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const cartLines = useMemo(
    () =>
      cart
        .map((i) => ({ ...i, product: productMap[i.productId] }))
        .filter((l) => l.product)
        .map((l) => ({ ...l, subtotal: l.product.price * l.qty })),
    [cart, productMap]
  );
  const cartTotal = cartLines.reduce((s, l) => s + l.subtotal, 0);
  const cartCount = cartLines.reduce((s, l) => s + l.qty, 0);

  const pending = useMemo(
    () => Object.values(txMap).filter((t) => t.status === 'pending').sort((a, b) => b.id - a.id),
    [txMap]
  );

  const subscribeTx = useCallback((listener) => {
    txListeners.current.add(listener);
    return () => txListeners.current.delete(listener);
  }, []);

  const value = {
    user,
    products,
    productsLoaded,
    productMap,
    settings,
    connected,
    displayCount,
    notifyTick,
    pending,
    txMap,
    upsertTx,
    subscribeTx,
    refreshProducts,
    refreshSettings,
    setSettings,
    cart,
    cartLines,
    cartTotal,
    cartCount,
    cartApi,
    activeTxId,
    openTx: setActiveTxId,
    closeTx: () => setActiveTxId(null),
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
