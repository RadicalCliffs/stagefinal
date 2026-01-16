// Buffer polyfill for browser environment (required by some SDK dependencies)
// This must be imported before any other modules that use Buffer
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import { StrictMode, lazy, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router';
import Loader from './components/Loader.tsx';
import AppLoader from './components/AppLoader.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
// Competition lifecycle checking has been moved to a server-side scheduled function
// to eliminate client-side network issues (ERR_CONNECTION_CLOSED errors)
// See: netlify/functions/competition-lifecycle-checker.mts
import EnsureBaseChain from './components/EnsureBaseChain.tsx';
import { OnchainKitProvider } from '@coinbase/onchainkit';
import { CDPReactProvider, type Config as CDPConfig, type Theme as CDPTheme } from '@coinbase/cdp-react';
import { base, baseSepolia } from 'viem/chains';
import '@coinbase/onchainkit/styles.css';
// Wagmi imports for wallet connection (Base App, Coinbase Wallet, etc.)
import { WagmiProvider, createConfig, http } from 'wagmi';
import { coinbaseWallet, metaMask, injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Determine which network to use based on environment variable
// When VITE_BASE_MAINNET is 'true', use Base Mainnet; otherwise use Base Sepolia testnet
const isBaseMainnet = import.meta.env.VITE_BASE_MAINNET === 'true';
const activeChain = isBaseMainnet ? base : baseSepolia;
const supportedChainsList = isBaseMainnet ? [base] : [base, baseSepolia];

// Wagmi configuration for wallet connections
// We support multiple wallet types with proper deep linking for mobile users:
// 1. Coinbase Wallet / Smart Wallet - primary option, uses smartWalletOnly for consistent experience
// 2. MetaMask - uses MetaMask SDK for proper mobile deep linking
// 3. Injected wallets - catches other browser extension wallets (Phantom, etc.)
//
// CRITICAL: We must use explicit RPC URLs that are whitelisted in our CSP (public/_headers)
// Using http() with no URL causes viem to use fallback RPCs like eth.merkle.io which may not be in CSP
const wagmiConfig = createConfig({
  chains: isBaseMainnet ? [base] : [base, baseSepolia],
  connectors: [
    coinbaseWallet({
      appName: 'The Prize',
      appLogoUrl: 'https://theprize.io/logo.png',
      // Use smartWalletOnly to force Coinbase Smart Wallet / Base wallet connection
      // This ensures "Connect with Base" actually connects to Base, not MetaMask
      // On mobile, this triggers the native Base wallet popup with deep linking
      preference: { options: 'smartWalletOnly' },
    }),
    // MetaMask connector with mobile SDK support for deep linking
    // When users click MetaMask on mobile, it will attempt to open the MetaMask app
    metaMask({
      dappMetadata: {
        name: 'The Prize',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://theprize.io',
        iconUrl: 'https://theprize.io/logo.png',
      },
    }),
    // Injected connector catches other browser extension wallets like Phantom, Rainbow, etc.
    // This allows users with these wallets installed to connect directly
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    // Use explicit Base RPC URLs that are whitelisted in CSP
    // These are the official Base network endpoints that are already in connect-src
    [base.id]: http('https://mainnet.base.org'),
    [baseSepolia.id]: http('https://sepolia.base.org'),
  },
});

// Query client for React Query (required by wagmi)
const queryClient = new QueryClient();

// Lazy load pages
const LandingPage = lazy(() => import('./pages/LandingPage.tsx'));
const CompetitionsPage = lazy(() => import('./pages/CompetitionsPage.tsx'));
const WinnersPage = lazy(() => import('./pages/WinnersPage.tsx'));
const AboutPage = lazy(() => import('./pages/AboutPage.tsx'));
const FaqPage = lazy(() => import('./pages/FaqPage.tsx'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage.tsx'));
const CookiePolicyPage = lazy(() => import('./pages/CookiePolicyPage.tsx'));
const TermsAndConditionsPage = lazy(() => import('./pages/TermsAndConditionsPage.tsx'));
const TermsOfUsePage = lazy(() => import('./pages/TermsOfUsePage.tsx'));
const AcceptableUsePage = lazy(() => import('./pages/AcceptableUsePage.tsx'));
const CompetitionDetail = lazy(() => import('./components/CompetitionDetail.tsx'));

// Hero competition pages
const LamborghiniUrusPage = lazy(() => import('./pages/LamborghiniUrusPage.tsx'));
const BitcoinGiveawayPage = lazy(() => import('./pages/BitcoinGiveawayPage.tsx'));
const RolexWatchPage = lazy(() => import('./pages/RolexWatchPage.tsx'));

// Dashboard + its sections
const UserDashboard = lazy(() => import('./pages/UserDashboard.tsx'));
const EntriesLayout = lazy(() => import('./components/UserDashboard/Entries/EntriesLayout.tsx'));
const EntriesList = lazy(() => import('./components/UserDashboard/Entries/EntriesList.tsx'));
const EntryDetail = lazy(() => import('./components/UserDashboard/Entries/EntryDetails.tsx'));
const CompetitionEntryDetails = lazy(() => import('./components/UserDashboard/Entries/CompetitionEntryDetails.tsx'));
const Account = lazy(() => import('./components/UserDashboard/Account/AccountLayout.tsx'));
const NotificationsLayout = lazy(() => import('./components/UserDashboard/Notifications/NotificationsLayout.tsx'));
const WalletPage = lazy(() => import('./pages/Dashboard/WalletPage.tsx'));

// Dashboard sub-components (moved from eager imports for better code splitting)
const HowToPlay = lazy(() => import('./pages/HowToPlay.tsx'));
const Promo = lazy(() => import('./components/UserDashboard/Promo/PromoLayout.tsx'));
const OrdersLayout = lazy(() => import('./components/UserDashboard/Orders/OrdersLayout.tsx'));
const OrdersList = lazy(() => import('./components/UserDashboard/Orders/OrdersList.tsx'));
const OrderDetails = lazy(() => import('./components/UserDashboard/Orders/OrderDetails.tsx'));

// Admin-only visual editor for auth modals (secret route)
const AuthModalVisualEditor = lazy(() => import('./pages/AuthModalVisualEditor.tsx'));
const AdminGuard = lazy(() => import('./components/AdminGuard.tsx'));

// NOTE: Admin functionality is in a separate repository
// Admin dashboard: https://github.com/RadicalCliffs/theprize-admin-github-ready
// All admin operations (competition management, draws, payouts) are handled there

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'competitions', element: <CompetitionsPage /> },
      { path: 'competitions/lamborghini-urus', element: <LamborghiniUrusPage /> },
      { path: 'competitions/bitcoin-giveaway', element: <BitcoinGiveawayPage /> },
      { path: 'competitions/rolex-watch', element: <RolexWatchPage /> },
      { path: 'competitions/:id', element: <CompetitionDetail /> },
      { path: 'how-to-play', element: <HowToPlay /> },
      { path: 'winners', element: <WinnersPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'faq', element: <FaqPage /> },
      { path: 'privacy-policy', element: <PrivacyPolicyPage /> },
      { path: 'cookie-policy', element: <CookiePolicyPage /> },
      { path: 'terms-and-conditions', element: <TermsAndConditionsPage /> },
      { path: 'terms-of-use', element: <TermsOfUsePage /> },
      { path: 'acceptable-use', element: <AcceptableUsePage /> },
      // Secret admin route for visual auth modal editor
      // Pattern: /a/e/o/x/u (unindexable, unsearchable)
      { 
        path: 'a/e/o/x/u', 
        element: (
          <Suspense fallback={<Loader />}>
            <AdminGuard>
              <AuthModalVisualEditor />
            </AdminGuard>
          </Suspense>
        ),
      },
      {
        path: 'dashboard',
        element: <UserDashboard />,
        children: [
          { index: true, element: <Navigate to="/dashboard/entries" replace /> },
          {
            path: 'entries',
            element: <EntriesLayout />,
            children: [
              { index: true, element: <EntriesList /> },
              { path: 'competition/:competitionId', element: <CompetitionEntryDetails /> },
              { path: ':id', element: <EntryDetail /> },
            ],
          },
          {
            path: 'orders',
            element: <OrdersLayout />,
            children: [
              { index: true, element: <OrdersList /> },
              { path: ':id', element: <OrderDetails /> },
            ],
          },
          { path: 'notifications', element: <NotificationsLayout /> },
          { path: 'wallet', element: <WalletPage /> },
          { path: 'promo', element: <Promo /> },
          { path: 'account', element: <Account /> },
        ],
      },
    ],
  },
]);

const cdpApiKey = import.meta.env.VITE_CDP_API_KEY;
const cdpProjectId = import.meta.env.VITE_CDP_PROJECT_ID;

if (!cdpApiKey) {
  console.error('VITE_CDP_API_KEY is not defined - OnchainKit features will not work correctly');
} else if (cdpApiKey.length < 20) {
  console.warn('VITE_CDP_API_KEY appears to be invalid (too short) - OnchainKit RPC calls may fail');
}

if (!cdpProjectId) {
  console.error('VITE_CDP_PROJECT_ID is not defined - Coinbase wallet creation will not work');
} else {
  console.log('CDP Project ID configured:', cdpProjectId);
  console.log('Current origin:', typeof window !== 'undefined' ? window.location.origin : 'SSR');
  console.log('NOTE: Make sure this domain is whitelisted in CDP Portal at https://portal.cdp.coinbase.com/products/embedded-wallets/domains');
}

// CDP React Provider configuration for Base embedded wallet creation
//
// ARCHITECTURE NOTE - CDP Embedded Wallets (Primary User Wallet):
// ================================================================
// This application uses CDP EMBEDDED WALLETS as the primary user wallet system.
// - Users authenticate via email sign-in which creates an embedded Base wallet
// - User USDC is stored in this embedded wallet, controlled by their email/passkey
// - All payments originate from the user's embedded wallet (not server wallets)
// - Server wallet functions (/api/cdp/transfer/*) are DEPRECATED for payments
//
// The treasury address (VITE_TREASURY_ADDRESS) is the RECIPIENT of payments.
// It does NOT manage user funds - it's simply where payments are sent to.
//
// IMPORTANT: The domain must be whitelisted in CDP Portal for SignIn to work
// Go to: https://portal.cdp.coinbase.com/products/embedded-wallets/domains
// Add: localhost:5173 (for local dev) and your production domain
const cdpConfig: CDPConfig = {
  projectId: cdpProjectId || '',
  ethereum: {
    createOnLogin: 'eoa',
  },
  appName: 'The Prize - Win Big with Crypto',
  appLogoUrl: '',
  authMethods: ['email'],
  showCoinbaseFooter: false,
};

// CDP React theme matching the app's dark theme
const cdpTheme: Partial<CDPTheme> = {
  'colors-bg-default': '#0a0b0d',
  'colors-bg-alternate': '#22252d',
  'colors-bg-primary': '#DDE404',
  'colors-bg-secondary': '#22252d',
  'colors-fg-default': '#ffffff',
  'colors-fg-muted': '#8a919e',
  'colors-fg-primary': '#DDE404',
  'colors-fg-onPrimary': '#0a0b0d',
  'colors-fg-onSecondary': '#ffffff',
  'colors-fg-positive': '#27ad75',
  'colors-fg-negative': '#f0616d',
  'colors-fg-warning': '#ed702f',
  'colors-line-default': '#252629',
  'colors-line-heavy': '#5a5d6a',
  'borderRadius-banner': 'var(--cdp-web-borderRadius-xl)',
  'borderRadius-cta': 'var(--cdp-web-borderRadius-full)',
  'borderRadius-link': 'var(--cdp-web-borderRadius-full)',
  'borderRadius-input': 'var(--cdp-web-borderRadius-lg)',
  'borderRadius-select-trigger': 'var(--cdp-web-borderRadius-lg)',
  'borderRadius-select-list': 'var(--cdp-web-borderRadius-lg)',
  'borderRadius-modal': 'var(--cdp-web-borderRadius-xl)',
};

// Render the app with Base/CDP as the primary auth
// NOTE: Competition lifecycle checking has been moved server-side to a scheduled function
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLoader>
      {cdpProjectId ? (
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <CDPReactProvider config={cdpConfig} theme={cdpTheme}>
              <OnchainKitProvider
                apiKey={cdpApiKey}
                chain={activeChain}
                config={{
                  appearance: {
                    name: 'The Prize',
                    logo: 'https://theprize.io/logo.png',
                    mode: 'dark',
                    theme: 'base',
                  },
                  wallet: {
                    // IMPORTANT: Use 'modal' display for proper Base popup experience on mobile
                    // This triggers the native Coinbase/Base wallet popup instead of inline UI
                    display: 'modal',
                    // Enable MetaMask and Phantom wallet options with proper deep linking
                    // These wallets will use the wagmi connectors configured above which handle:
                    // - Browser extension detection (desktop)
                    // - Mobile deep linking to open the wallet app
                    // - QR code display for mobile-to-desktop connections
                    supportedWallets: {
                      // Enable MetaMask - uses MetaMask SDK for mobile deep linking
                      metamask: true,
                      // Enable Phantom - uses injected connector, opens app on mobile
                      phantom: true,
                      // Keep other wallets disabled for now
                      rabby: false,
                      trust: false,
                      frame: false,
                    },
                  },
                }}
              >
                <AuthProvider>
                  <EnsureBaseChain />
                  <Suspense fallback={<Loader />}>
                    <RouterProvider router={router} />
                  </Suspense>
                </AuthProvider>
              </OnchainKitProvider>
            </CDPReactProvider>
          </QueryClientProvider>
        </WagmiProvider>
      ) : (
        <Suspense fallback={<Loader />}>
          <RouterProvider router={router} />
        </Suspense>
      )}
    </AppLoader>
  </StrictMode>
);
