import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, onUnauthorized } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, error: null, needsSetup: false, user: null, storeName: '' });

  const load = useCallback(async () => {
    try {
      const data = await api('/bootstrap');
      setState({ loading: false, error: null, ...data });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => onUnauthorized(() => setState((s) => (s.user ? { ...s, user: null, sessionExpired: true } : s))),
    []
  );

  const setUser = useCallback((user) => setState((s) => ({ ...s, user, needsSetup: false, sessionExpired: false })), []);

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
      setState((s) => ({ ...s, user: null }));
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        reload: load,
        setUser,
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
