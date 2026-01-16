/**
 * Admin Guard Component
 *
 * Protects routes by requiring admin authentication via password gate.
 * The password gate sets a localStorage flag that this guard checks.
 */

import { Navigate } from 'react-router';
import { isAdminAccessGranted } from '../pages/AdminPasswordGate';

interface AdminGuardProps {
  children: React.ReactNode;
}

export default function AdminGuard({ children }: AdminGuardProps) {
  // Check if admin access was granted via password gate
  if (!isAdminAccessGranted()) {
    // Redirect to the password gate page
    return <Navigate to="/a/e/o/x/u" replace />;
  }

  return <>{children}</>;
}
