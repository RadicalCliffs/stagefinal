/**
 * Admin Guard Component
 * 
 * Protects routes by requiring admin authentication
 */

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useAuthUser } from '../contexts/AuthContext';
import { isAdmin } from '../lib/admin-auth';
import Loader from './Loader';

interface AdminGuardProps {
  children: React.ReactNode;
}

export default function AdminGuard({ children }: AdminGuardProps) {
  const { authenticated, ready } = useAuthUser();
  const [isAdminUser, setIsAdminUser] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkAdminStatus() {
      if (!ready) return;

      if (!authenticated) {
        setIsAdminUser(false);
        setChecking(false);
        return;
      }

      // Get wallet address from localStorage (set during auth)
      const walletAddress = localStorage.getItem('cdp:wallet_address');
      
      if (!walletAddress) {
        setIsAdminUser(false);
        setChecking(false);
        return;
      }

      const adminStatus = await isAdmin(walletAddress);
      setIsAdminUser(adminStatus);
      setChecking(false);
    }

    checkAdminStatus();
  }, [authenticated, ready]);

  if (!ready || checking) {
    return <Loader />;
  }

  if (!authenticated || !isAdminUser) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
