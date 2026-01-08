import { useAuthUser } from '../contexts/AuthContext';
import { useCallback } from 'react';

/**
 * Custom login hook that wraps Base/CDP authentication.
 * For Base-first authentication, users sign in via the BaseWalletAuthModal.
 * This hook provides auth state for components that need to check login status.
 */
export const useCustomLogin = () => {
  const { authenticated, ready } = useAuthUser();

  // Login action - in Base-first flow, this should trigger the auth modal
  // Components should use the BaseWalletAuthModal directly for login
  const login = useCallback(() => {
    console.log('[useCustomLogin] Login called - use BaseWalletAuthModal for Base authentication');
    // The actual login flow is handled by BaseWalletAuthModal and CDP SignIn
    // This is kept for backward compatibility with components that call login()
  }, []);

  return {
    login,
    authenticated,
    ready,
  };
};
