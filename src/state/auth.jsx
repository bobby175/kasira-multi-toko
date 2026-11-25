import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setApiStoreId, onUnauthorized } from '../lib/api.js';

const AuthContext = createContext(null);
const STORE_KEY = 'kasira_active_store_v1';

function pickActiveStoreId(user, stores, preferred = null) {
  if (!user || !Array.isArray(stores) || stores.length === 0) return null;
  if (user.role === 'karyawan') return user.storeId ?? stores[0].id;
  const saved = preferred ?? Number(localStorage.getItem(STORE_KEY));
  if (saved && stores.some((s) => s.id === saved)) return saved;
  return stores[0].id;
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    needsSetup: false,
    user: null,
    stores: [],
    activeStoreId: null,
    storeName: '',
  });

  const applyStoreState = useCallback((user, stores, preferred = null) => {
    const list = Array.isArray(stores) ? stores : [];
    const nextId = pickActiveStoreId(user, list, preferred);
    setApiStoreId(nextId);
    if (user?.role === 'admin' && nextId) localStorage.setItem(STORE_KEY, String(nextId));
    return { stores: list, activeStoreId: nextId };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api('/bootstrap');
      const { stores, activeStoreId } = applyStoreState(data.user, data.stores);
      setState({
        loading: false,
        error: null,
        needsSetup: data.needsSetup,
        user: data.user,
        storeName: data.storeName || '',
        stores,
        activeStoreId,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [applyStoreState]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      onUnauthorized(() => {
        setApiStoreId(null);
        setState((s) => (s.user ? { ...s, user: null, stores: [], activeStoreId: null, sessionExpired: true } : s));
      }),
    []
  );

  const setUser = useCallback(
    (user, stores = []) => {
      const { stores: list, activeStoreId } = applyStoreState(user, stores);
      setState((s) => ({ ...s, user, stores: list, activeStoreId, needsSetup: false, sessionExpired: false }));
    },
    [applyStoreState]
  );

  const selectStore = useCallback((storeId) => {
    setState((s) => {
      if (!s.user || s.user.role !== 'admin') return s;
      const nextId = Number(storeId);
      if (!s.stores.some((st) => st.id === nextId) || s.activeStoreId === nextId) return s;
      setApiStoreId(nextId);
      localStorage.setItem(STORE_KEY, String(nextId));
      return { ...s, activeStoreId: nextId };
    });
  }, []);

  const setStores = useCallback(
    (nextStores, preferredId = null) => {
      setState((s) => {
        const { stores: list, activeStoreId } = applyStoreState(s.user, nextStores, preferredId ?? s.activeStoreId);
        return { ...s, stores: list, activeStoreId };
      });
    },
    [applyStoreState]
  );

  const refreshStores = useCallback(async () => {
    const data = await api('/stores');
    setStores(data.stores);
    return data.stores;
  }, [setStores]);

  // "Sudah pernah setup? Masuk": show the login form even while the server reports no accounts.
  // Re-check the server too, in case setup was just completed on another device.
  const [loginView, setLoginView] = useState({ preferLogin: false, notice: '' });
  const showLogin = useCallback(
    (notice = '') => {
      setLoginView({ preferLogin: true, notice });
      load();
    },
    [load]
  );
  const showSetup = useCallback(() => setLoginView({ preferLogin: false, notice: '' }), []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setApiStoreId(null);
      setState((s) => ({ ...s, user: null, stores: [], activeStoreId: null }));
    }
  }, []);

  const activeStore = useMemo(
    () => state.stores.find((s) => s.id === state.activeStoreId) ?? state.stores[0] ?? null,
    [state.stores, state.activeStoreId]
  );

  return (
    <AuthContext.Provider
      value={{
        ...state,
        activeStore,
        reload: load,
        setUser,
        selectStore,
        setStores,
        refreshStores,
        logout,
        preferLogin: loginView.preferLogin,
        loginNotice: loginView.notice,
        showLogin,
        showSetup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
