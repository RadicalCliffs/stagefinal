/**
 * Robust User Lookup Utility for Deno Edge Functions
 * 
 * Ensures we ALWAYS find a username when one exists in the database.
 * Uses multiple fallback strategies to handle various identifier formats.
 * 
 * NEVER returns "Unknown" - throws error instead to surface data issues.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export interface UserLookupResult {
  username: string;
  country: string | null;
  wallet_address: string | null;
  avatar_url: string | null;
  canonical_user_id: string | null;
  id?: string | null;
}

export interface UserLookupInput {
  userId?: string | null;
  walletAddress?: string | null;
  privyUserId?: string | null;
  canonicalUserId?: string | null;
}

/**
 * Robust user lookup that tries multiple strategies
 * Throws error if no user found (better than silent "Unknown")
 */
export async function lookupUser(
  supabase: SupabaseClient,
  input: UserLookupInput,
  context: string = 'lookupUser'
): Promise<UserLookupResult> {
  const { userId, walletAddress, privyUserId, canonicalUserId } = input;

  console.log(`[${context}] Looking up user:`, {
    userId: userId?.substring(0, 20),
    walletAddress: walletAddress?.substring(0, 20),
    privyUserId: privyUserId?.substring(0, 20),
    canonicalUserId: canonicalUserId?.substring(0, 20),
  });

  let user: any = null;

  // Strategy 1: Try canonical_user_id (most reliable)
  if (canonicalUserId && !user) {
    const { data } = await supabase
      .from('canonical_users')
      .select('id, username, country, wallet_address, avatar_url, canonical_user_id')
      .eq('canonical_user_id', canonicalUserId)
      .maybeSingle();
    
    if (data?.username) {
      user = data;
      console.log(`[${context}] ✅ Found via canonical_user_id`);
    }
  }

  // Strategy 2: Try userId as canonical_user_id
  if (userId && !user) {
    const { data } = await supabase
      .from('canonical_users')
      .select('id, username, country, wallet_address, avatar_url, canonical_user_id')
      .eq('canonical_user_id', userId)
      .maybeSingle();
    
    if (data?.username) {
      user = data;
      console.log(`[${context}] ✅ Found via userId as canonical_user_id`);
    }
  }

  // Strategy 3: Try wallet address (case-insensitive)
  if (walletAddress && !user) {
    const { data } = await supabase
      .from('canonical_users')
      .select('id, username, country, wallet_address, avatar_url, canonical_user_id')
      .ilike('wallet_address', walletAddress)
      .maybeSingle();
    
    if (data?.username) {
      user = data;
      console.log(`[${context}] ✅ Found via wallet_address`);
    }
  }

  // Strategy 4: Try base_wallet_address
  if (walletAddress && !user) {
    const { data } = await supabase
      .from('canonical_users')
      .select('id, username, country, wallet_address, avatar_url, canonical_user_id')
      .ilike('base_wallet_address', walletAddress)
      .maybeSingle();
    
    if (data?.username) {
      user = data;
      console.log(`[${context}] ✅ Found via base_wallet_address`);
    }
  }

  // Strategy 5: Try privy_user_id
  if (privyUserId && !user) {
    const { data } = await supabase
      .from('canonical_users')
      .select('id, username, country, wallet_address, avatar_url, canonical_user_id')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();
    
    if (data?.username) {
      user = data;
      console.log(`[${context}] ✅ Found via privy_user_id`);
    }
  }

  // Strategy 6: Try userId as UUID id
  if (userId && !user) {
    try {
      const { data } = await supabase
        .from('canonical_users')
        .select('id, username, country, wallet_address, avatar_url, canonical_user_id')
        .eq('id', userId)
        .maybeSingle();
      
      if (data?.username) {
        user = data;
        console.log(`[${context}] ✅ Found via userId as id (UUID)`);
      }
    } catch (e) {
      // userId is not a valid UUID, skip
    }
  }

  // Strategy 7: Try constructing canonical_user_id from wallet
  if (walletAddress && !user) {
    const constructedCanonicalId = `prize:pid:${walletAddress.toLowerCase()}`;
    const { data } = await supabase
      .from('canonical_users')
      .select('id, username, country, wallet_address, avatar_url, canonical_user_id')
      .eq('canonical_user_id', constructedCanonicalId)
      .maybeSingle();
    
    if (data?.username) {
      user = data;
      console.log(`[${context}] ✅ Found via constructed canonical_user_id`);
    }
  }

  // If still not found, throw error (don't silently use "Unknown")
  if (!user || !user.username) {
    const errorMsg = `User not found in database for ${context}. Identifiers: userId=${userId?.substring(0, 20)}, wallet=${walletAddress?.substring(0, 20)}, privy=${privyUserId?.substring(0, 20)}, canonical=${canonicalUserId?.substring(0, 20)}`;
    console.error(`[${context}] ❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  return {
    id: user.id || null,
    username: user.username,
    country: user.country || null,
    wallet_address: user.wallet_address || walletAddress || null,
    avatar_url: user.avatar_url || null,
    canonical_user_id: user.canonical_user_id || null,
  };
}

/**
 * Safe version that returns null instead of throwing
 * Use only when "Unknown" is truly acceptable
 */
export async function lookupUserSafe(
  supabase: SupabaseClient,
  input: UserLookupInput,
  context: string = 'lookupUserSafe'
): Promise<UserLookupResult | null> {
  try {
    return await lookupUser(supabase, input, context);
  } catch (error) {
    console.warn(`[${context}] Could not find user, returning null:`, error);
    return null;
  }
}
