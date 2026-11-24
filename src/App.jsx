import { Suspense, lazy, useEffect } from 'react';
import { usePathname, navigate } from './lib/router.jsx';
import { unlockAudioOnFirstGesture } from './lib/sound.js';
import { AuthProvider, useAuth } from './state/auth.jsx';
import { DataProvider } from './state/data.jsx';
import { ConfirmProvider, FullScreenLoader, Spinner, ToastProvider } from './components/ui.jsx';
import { Shell } from './components/Shell.jsx';
import { PaymentDialog } from './components/PaymentDialog.jsx';
import { PrintHost } from './components/Receipt.jsx';
import { LoginPage, SetupPage } from './pages/Auth.jsx';
import POSPage from './pages/POS.jsx';
import PaymentsPage from './pages/Payments.jsx';
import HistoryPage from './pages/History.jsx';
import ProductsPage from './pages/Products.jsx';

// Loaded on demand: the customer display and settings are not needed by every device.
const SettingsPage = lazy(() => import('./pages/Settings.jsx'));
const DisplayPage = lazy(() => import('./pages/Display.jsx'));

const PageFallback = () => (
  <div className="grid min-h-[60vh] place-items-center text-slate-400">
    <Spinner className="size-7" />
  </div>
);

const ROUTES = {
  '/': POSPage,
  '/pembayaran': PaymentsPage,
  '/riwayat': HistoryPage,
  '/produk': ProductsPage,
  '/pengaturan': SettingsPage,
};

function StaffApp() {
  const path = usePathname();
  const Page = ROUTES[path];
  useEffect(() => {
    if (!Page) navigate('/', { replace: true });
  }, [Page]);
  return (
    <DataProvider>
      <Shell>
        <Suspense fallback={<PageFallback />}>{Page ? <Page /> : null}</Suspense>
      </Shell>
      <PaymentDialog />
      <PrintHost />
    </DataProvider>
  );
}

function Gate() {
  const { loading, error, needsSetup, user, reload, preferLogin } = useAuth();
  useEffect(() => {
    document.title = 'Kasira • Kasir Modern';
  }, []);
  if (loading) return <FullScreenLoader />;
  if (error && !user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-semibold text-slate-700">{error}</p>
        <button type="button" className="btn btn-primary" onClick={reload}>Coba lagi</button>
      </div>
    );
  }
  if (needsSetup && !preferLogin) return <SetupPage />;
  if (!user) return <LoginPage />;
  return <StaffApp />;
}

export default function App() {
  const path = usePathname();
  useEffect(() => unlockAudioOnFirstGesture(), []);

  return (
    <ToastProvider>
      {path.startsWith('/display') ? (
        <Suspense fallback={<FullScreenLoader />}>
          <DisplayPage />
        </Suspense>
      ) : (
        <ConfirmProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ConfirmProvider>
      )}
    </ToastProvider>
  );
}
