/**
 * Admin Authentication Utilities
 * 
 * Provides admin authentication and authorization checks
 */

import { supabase } from './supabase';

export interface AdminUser {
  id: string;
  email?: string;
  wallet_address?: string;
  is_admin: boolean;
}

/**
 * Check if a user is an admin by wallet address
 */
export async function isAdmin(walletAddress: string): Promise<boolean> {
  if (!walletAddress) return false;

  try {
    const { data, error } = await supabase
      .from('canonical_users')
      .select('is_admin')
      .ilike('wallet_address', walletAddress)
      .maybeSingle() as any;

    if (error) {
      console.error('[AdminAuth] Error checking admin status:', error);
      return false;
    }

    return (data as any)?.is_admin === true;
  } catch (err) {
    console.error('[AdminAuth] Exception checking admin status:', err);
    return false;
  }
}

/**
 * Get admin user details by wallet address
 */
export async function getAdminUser(walletAddress: string): Promise<AdminUser | null> {
  if (!walletAddress) return null;

  try {
    const { data, error } = await supabase
      .from('canonical_users')
      .select('id, email, wallet_address, is_admin')
      .ilike('wallet_address', walletAddress)
      .maybeSingle() as any;

    if (error) {
      console.error('[AdminAuth] Error fetching admin user:', error);
      return null;
    }

    if (!(data as any)?.is_admin) {
      return null;
    }

    return data as unknown as AdminUser;
  } catch (err) {
    console.error('[AdminAuth] Exception fetching admin user:', err);
    return null;
  }
}
