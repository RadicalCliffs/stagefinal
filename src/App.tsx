import { Outlet, ScrollRestoration } from 'react-router'
import Header from './components/Header'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import DiscountBanner from './components/DiscountBanner'
import { WinnerNotificationToast } from './components/WinnerNotification'
import { ToastProvider } from './components/Toast'
import { useAuthUser } from './contexts/AuthContext'
import { usePageTracking } from './hooks/usePageTracking'

function App() {
  const { authenticated } = useAuthUser();
  
  // Automatically track page views when routes change
  usePageTracking();

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className='relative overflow-x-hidden w-full'>
          <div className='fixed top-0 w-full z-50'>
            <DiscountBanner />
            <Header />
          </div>
          <div className='h-26 xl:h-30.5'></div>
          <ScrollRestoration />
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
          <div className='relative'>
            <Footer />
          </div>

          {/* Global winner notification toast - only shown when authenticated */}
          {authenticated && <WinnerNotificationToast />}
        </div>
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App