import { supabase } from './supabase';
import { userDataService } from '../services/userDataService';
import { toPrizePid, isWalletAddress, normalizeWalletAddress } from '../utils/userId';
import { toCanonicalUserId } from './canonicalUserId';
import { generatePrivyStyleId } from './identity';

export interface UserProfile {
  id: string;
  uid?: string | null;
  canonical_user_id?: string | null;
  email?: string | null;
  wallet_address?: string | null;
  eth_wallet_address?: string | null;
  base_wallet_address?: string | null;
  username?: string | null;
  telegram_handle?: string | null;
  telephone_number?: string | null;
  avatar_url?: string | null;
  created_at: string | null;
  first_name?: string | null;
  last_name?: string | null;
  country?: string | null;
}

/**
 * Extract the best email from a user object.
 * Supports both Privy (legacy) and CDP/Base user objects.
 */
function extractEmailFromUser(user: any): string | null {
  // Direct email string
  if (typeof user?.email === 'string') {
    return user.email;
  }

  // Email object with address property (Privy/CDP format)
  if (user?.email?.address) {
    return user.email.address;
  }

  // Linked accounts array (Privy format)
  if (user?.linkedAccounts) {
    const emailAccount = user.linkedAccounts.find(
      (account: any) => account.type === 'email' && account.address
    );
    if (emailAccount) {
      return emailAccount.address;
    }
  }

  return null;
}

export const userAuth = {
  /**
   * Get or create a user profile from Base/CDP or Privy authentication.
   *
   * CRITICAL: This function handles account linking to prevent duplicate accounts.
   * All user IDs are now stored in canonical prize:pid: format.
   *
   * For Base-first auth, the wallet address is the primary identifier.
   * Legacy Privy DIDs are converted to canonical format.
   *
   * Lookup priority:
   * 1. Canonical user ID (prize:pid: format)
   * 2. Wallet address (for legacy lookups)
   * 3. Email address (links accounts created via email)
   *
   * When a match is found, the account is linked, preserving all existing data.
   */
  async getOrCreateUser(user: any): Promise<UserProfile | null> {
    const walletAddress = user.wallet?.address || (isWalletAddress(user.id) ? user.id : null);
    const email = extractEmailFromUser(user);
    const inputUserId = user.id;
    
    // Convert to canonical prize:pid: format
    const canonicalUserId = toPrizePid(inputUserId);
    
    console.log('[user-auth] getOrCreateUser called:', {
      inputUserId: inputUserId?.substring(0, 20) + '...',
      canonicalUserId: canonicalUserId.substring(0, 25) + '...',
      email,
      walletAddress: walletAddress?.substring(0, 10) + '...',
      linkedAccountsCount: user?.linkedAccounts?.length || 0,
    });

    if (!inputUserId) {
      console.error('[user-auth] No user ID found');
      return null;
    }

    if (!walletAddress && !email) {
      console.error('[user-auth] No wallet address or email found');
      return null;
    }

    // ============================================
    // STEP 1: Try to find by CANONICAL USER ID first
    // ============================================
    console.log('[user-auth] Step 1: Looking up by canonical user ID:', canonicalUserId.substring(0, 25) + '...');

    const { data: byCanonical } = await supabase
      .from('canonical_users')
      .select('*')
      .eq('canonical_user_id', canonicalUserId)
      .limit(1)
      .maybeSingle();

    if (byCanonical) {
      console.log('[user-auth] ✅ Found existing user by CANONICAL ID:', {
        id: byCanonical.id,
        email: byCanonical.email,
        wallet: byCanonical.wallet_address,
        canonical_user_id: byCanonical.canonical_user_id,
        usdc_balance: byCanonical.usdc_balance,
      });

      // Update fields if needed
      const updates: Record<string, any> = {};
      if (email && !byCanonical.email) {
        updates.email = email;
      }
      if (walletAddress && !byCanonical.wallet_address) {
        updates.wallet_address = normalizeWalletAddress(walletAddress);
      }
      // Assign default avatar if missing
      if (!byCanonical.avatar_url) {
        updates.avatar_url = userDataService.getDefaultAvatar();
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('canonical_users')
          .update(updates)
          .eq('id', byCanonical.id);
      }

      return {
        id: byCanonical.id,
        uid: byCanonical.uid || byCanonical.id,
        canonical_user_id: byCanonical.canonical_user_id,
        email: byCanonical.email || email,
        wallet_address: byCanonical.wallet_address || walletAddress,
        eth_wallet_address: byCanonical.eth_wallet_address || byCanonical.wallet_address,
        base_wallet_address: byCanonical.base_wallet_address || byCanonical.wallet_address,
        username: byCanonical.username,
        telegram_handle: byCanonical.telegram_handle,
        telephone_number: byCanonical.telephone_number,
        avatar_url: byCanonical.avatar_url || updates.avatar_url,
        created_at: byCanonical.created_at,
        first_name: byCanonical.first_name,
        last_name: byCanonical.last_name,
        country: byCanonical.country,
      };
    }

    // ============================================
    // STEP 2: Try legacy lookups for backward compatibility during migration
    // ============================================
    if (walletAddress) {
      console.log('[user-auth] Step 2: Legacy lookup by wallet address for migration');

      const { data: byWalletArray } = await supabase
        .from('canonical_users')
        .select('*')
        .or(`wallet_address.ilike.${walletAddress.toLowerCase()},base_wallet_address.ilike.${walletAddress.toLowerCase()}`)
        .order('created_at', { ascending: false })
        .limit(1);

      const byWallet = byWalletArray?.[0] || null;

      if (byWallet) {
        console.log('[user-auth] Found user by wallet (legacy), migrating to canonical ID');

        // Update to canonical format
        const updates: Record<string, any> = {
          canonical_user_id: canonicalUserId,
        };
        
        if (email && !byWallet.email) {
          updates.email = email;
        }
        if (!byWallet.avatar_url) {
          updates.avatar_url = userDataService.getDefaultAvatar();
        }

        await supabase
          .from('canonical_users')
          .update(updates)
          .eq('id', byWallet.id);

        return {
          id: byWallet.id,
          uid: byWallet.uid || byWallet.id,
          canonical_user_id: canonicalUserId,
          email: byWallet.email || email,
          wallet_address: byWallet.wallet_address || walletAddress,
          eth_wallet_address: byWallet.eth_wallet_address || byWallet.wallet_address,
          base_wallet_address: byWallet.base_wallet_address || byWallet.wallet_address,
          username: byWallet.username,
          telegram_handle: byWallet.telegram_handle,
          telephone_number: byWallet.telephone_number,
          avatar_url: byWallet.avatar_url || updates.avatar_url,
          created_at: byWallet.created_at,
          first_name: byWallet.first_name,
          last_name: byWallet.last_name,
          country: byWallet.country,
        };
      }
    }

    // ============================================
    // STEP 3: Try to find by legacy privy_user_id for backward compatibility
    // ============================================
    console.log('[user-auth] Step 3: Legacy lookup by privy_user_id for migration');

    // Use limit(1) instead of maybeSingle() to avoid PGRST116 error
    const { data: existingByIdArray, error: fetchByIdError } = await supabase
      .from('canonical_users')
      .select('*')
      .eq('privy_user_id', inputUserId)
      .limit(1);

    const existingById = existingByIdArray?.[0] || null;

    if (fetchByIdError) {
      console.error('[user-auth] Error fetching user by ID:', fetchByIdError);
    }

    if (existingById) {
      console.log('[user-auth] Found user by privy_user_id (legacy), migrating to canonical ID');

      // User exists - migrate to canonical and update fields
      const updates: Record<string, any> = {
        canonical_user_id: canonicalUserId,
      };

      if (email && existingById.email !== email) {
        console.log('[user-auth] Updating email:', { old: existingById.email, new: email });
        updates.email = email;
      }

      if (walletAddress && !existingById.wallet_address) {
        updates.wallet_address = normalizeWalletAddress(walletAddress);
        updates.base_wallet_address = normalizeWalletAddress(walletAddress);
      }

      // Assign default avatar if missing
      if (!existingById.avatar_url) {
        updates.avatar_url = userDataService.getDefaultAvatar();
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('canonical_users')
          .update(updates)
          .eq('id', existingById.id);
      }

      return {
        id: existingById.id,
        uid: existingById.uid || existingById.id,
        canonical_user_id: canonicalUserId,
        email: email || existingById.email,
        wallet_address: existingById.wallet_address || walletAddress,
        eth_wallet_address: existingById.eth_wallet_address || existingById.wallet_address,
        base_wallet_address: existingById.base_wallet_address || existingById.wallet_address,
        username: existingById.username,
        telegram_handle: existingById.telegram_handle,
        telephone_number: existingById.telephone_number,
        avatar_url: existingById.avatar_url || updates.avatar_url,
        created_at: existingById.created_at,
        first_name: existingById.first_name,
        last_name: existingById.last_name,
        country: existingById.country,
      };
    }

    // ============================================
    // STEP 4: Try to find by EMAIL (for account linking)
    // ============================================
    const normalizedEmail = email?.toLowerCase().trim();
    console.log('[user-auth] Step 4: Looking up by email:', normalizedEmail);

    if (normalizedEmail) {
      // Use limit(1) instead of maybeSingle() to avoid PGRST116 error
      const { data: byEmailArray } = await supabase
        .from('canonical_users')
        .select('*')
        .eq('email', normalizedEmail)
        .order('created_at', { ascending: false })
        .limit(1);

      const byEmail = byEmailArray?.[0] || null;

      if (byEmail) {
        console.log('[user-auth] ✅ Found existing user by EMAIL:', {
          id: byEmail.id,
          email: byEmail.email,
          wallet: byEmail.wallet_address,
          base_wallet: byEmail.base_wallet_address,
          hasCanonicalId: !!byEmail.canonical_user_id,
          existingCanonicalId: byEmail.canonical_user_id,
          usdc_balance: byEmail.usdc_balance,
        });

        // CRITICAL: Link the canonical ID and wallet to this existing account
        const updates: Record<string, any> = {
          canonical_user_id: canonicalUserId,
          privy_user_id: inputUserId, // Keep legacy field for backward compatibility
          uid: byEmail.uid || byEmail.id,
        };

        console.log('[user-auth] Linking with canonical_user_id:', canonicalUserId.substring(0, 25) + '...');

        // Always update wallet addresses if we have a wallet
        // This handles both new wallet creation and "I already have a wallet" flows
        if (walletAddress) {
          updates.wallet_address = normalizeWalletAddress(walletAddress);
          updates.base_wallet_address = normalizeWalletAddress(walletAddress);
          updates.eth_wallet_address = normalizeWalletAddress(walletAddress);
        }

        // Assign default avatar if missing
        if (!byEmail.avatar_url) {
          updates.avatar_url = userDataService.getDefaultAvatar();
        }

        const { error: updateError } = await supabase
          .from('canonical_users')
          .update(updates)
          .eq('id', byEmail.id);

        if (updateError) {
          // Handle unique constraint on canonical_user_id if it conflicts
          if (updateError.code === '23505') {
            console.warn('[user-auth] canonical_user_id conflict during email link, user already exists elsewhere');
            // The wallet may already be linked to a different account
            // Return the existing email-based account anyway
          } else {
            console.error('[user-auth] Error linking user:', updateError);
          }
        } else {
          console.log('[user-auth] ✅ Successfully linked user to canonical ID');
          // Migrate balance from wallet address to canonical user ID
          if (walletAddress) {
            try {
              await supabase.rpc('migrate_user_balance', {
                p_old_id: walletAddress,
                p_new_id: toCanonicalUserId(inputUserId)
              });
              console.log('[user-auth] Balance migration completed for wallet:', walletAddress.substring(0, 10) + '...');
            } catch (migrateErr) {
              console.warn('[user-auth] Balance migration failed (non-blocking):', migrateErr);
            }
          }
        }

        return {
          id: byEmail.id,
          uid: byEmail.uid || byEmail.id,
          canonical_user_id: canonicalUserId,
          email: byEmail.email || normalizedEmail,
          wallet_address: walletAddress || byEmail.wallet_address,
          eth_wallet_address: walletAddress || byEmail.eth_wallet_address || byEmail.wallet_address,
          base_wallet_address: walletAddress || byEmail.base_wallet_address || byEmail.wallet_address,
          username: byEmail.username,
          telegram_handle: byEmail.telegram_handle,
          telephone_number: byEmail.telephone_number,
          avatar_url: byEmail.avatar_url || updates.avatar_url,
          created_at: byEmail.created_at,
          first_name: byEmail.first_name,
          last_name: byEmail.last_name,
          country: byEmail.country,
        };
      }
    }

    // ============================================
    // STEP 5: Create new user (no existing account found)
    // ============================================
    console.log('[user-auth] Step 5: Creating new user with canonical ID');

    // CRITICAL FIX: One final check by wallet address before creating a new user
    // This handles race conditions where upsert-user edge function just created the user
    // but we haven't found it yet due to replication lag or timing
    if (walletAddress) {
      console.log('[user-auth] Step 5a: Final safety check by wallet address before creating');
      
      const { data: finalWalletCheckArray } = await supabase
        .from('canonical_users')
        .select('*')
        .or(`wallet_address.ilike.${walletAddress.toLowerCase()},base_wallet_address.ilike.${walletAddress.toLowerCase()},canonical_user_id.eq.${canonicalUserId}`)
        .order('created_at', { ascending: false })
        .limit(1);
      
      const finalWalletCheck = finalWalletCheckArray?.[0] || null;
      
      if (finalWalletCheck) {
        console.log('[user-auth] ✅ Found user in final safety check! Returning existing user instead of creating duplicate.');
        
        // Update with any missing fields
        const updates: Record<string, any> = {};
        if (email && !finalWalletCheck.email) {
          updates.email = email;
        }
        if (!finalWalletCheck.canonical_user_id) {
          updates.canonical_user_id = canonicalUserId;
        }
        if (!finalWalletCheck.avatar_url) {
          updates.avatar_url = userDataService.getDefaultAvatar();
        }
        
        if (Object.keys(updates).length > 0) {
          await supabase
            .from('canonical_users')
            .update(updates)
            .eq('id', finalWalletCheck.id);
        }
        
        return {
          id: finalWalletCheck.id,
          uid: finalWalletCheck.uid || finalWalletCheck.id,
          canonical_user_id: finalWalletCheck.canonical_user_id || canonicalUserId,
          email: finalWalletCheck.email || email,
          wallet_address: finalWalletCheck.wallet_address || walletAddress,
          eth_wallet_address: finalWalletCheck.eth_wallet_address || finalWalletCheck.wallet_address,
          base_wallet_address: finalWalletCheck.base_wallet_address || finalWalletCheck.wallet_address,
          username: finalWalletCheck.username,
          telegram_handle: finalWalletCheck.telegram_handle,
          telephone_number: finalWalletCheck.telephone_number,
          avatar_url: finalWalletCheck.avatar_url || updates.avatar_url,
          created_at: finalWalletCheck.created_at,
          first_name: finalWalletCheck.first_name,
          last_name: finalWalletCheck.last_name,
          country: finalWalletCheck.country,
        };
      }
    }

    const newUser = {
      canonical_user_id: canonicalUserId, // NEW: Store canonical format
      privy_user_id: inputUserId, // Keep legacy field for backward compatibility
      wallet_address: walletAddress ? normalizeWalletAddress(walletAddress) : null,
      eth_wallet_address: walletAddress ? normalizeWalletAddress(walletAddress) : null,
      base_wallet_address: walletAddress ? normalizeWalletAddress(walletAddress) : null,
      email: email ? email.toLowerCase().trim() : null,
      username: email?.split('@')[0] || `user_${Date.now()}`,
      // Use getRandomAvatar() ONLY during account creation so user gets a unique avatar once
      // After creation, the avatar_url is stored in the database and should not be regenerated
      avatar_url: userDataService.getRandomAvatar(),
      usdc_balance: 0,
      has_used_new_user_bonus: false,
      created_at: new Date().toISOString(),
    };

    const { data: createdUser, error: createError } = await supabase
      .from('canonical_users')
      .insert(newUser)
      .select()
      .single();

    if (createError) {
      // Handle unique constraint violation - user may have been created concurrently
      // or exists with different identifier
      if (createError.code === '23505') {
        console.warn('[user-auth] User exists (unique constraint), attempting to find and link');

        // Try to find by email and update with wallet
        if (email) {
          // Use limit(1) instead of maybeSingle() to avoid PGRST116 error
          const { data: existingByEmailArray } = await supabase
            .from('canonical_users')
            .select('*')
            .eq('email', email.toLowerCase().trim())
            .order('created_at', { ascending: false })
            .limit(1);

          const existingByEmail = existingByEmailArray?.[0] || null;

          if (existingByEmail) {
            // Update existing user with the new canonical ID and wallet info
            const recoveryUpdates: Record<string, any> = {
              canonical_user_id: canonicalUserId,
              privy_user_id: inputUserId, // Keep legacy field
              wallet_address: walletAddress ? normalizeWalletAddress(walletAddress) : existingByEmail.wallet_address,
              base_wallet_address: walletAddress ? normalizeWalletAddress(walletAddress) : existingByEmail.base_wallet_address,
              eth_wallet_address: walletAddress ? normalizeWalletAddress(walletAddress) : existingByEmail.eth_wallet_address,
            };

            if (!existingByEmail.avatar_url) {
              recoveryUpdates.avatar_url = userDataService.getDefaultAvatar();
            }

            await supabase
              .from('canonical_users')
              .update(recoveryUpdates)
              .eq('id', existingByEmail.id);

            console.log('[user-auth] ✅ Linked existing user by email:', existingByEmail.id);

            return {
              id: existingByEmail.id,
              uid: existingByEmail.uid || existingByEmail.id,
              canonical_user_id: canonicalUserId,
              email: existingByEmail.email || email,
              wallet_address: walletAddress || existingByEmail.wallet_address,
              eth_wallet_address: walletAddress || existingByEmail.eth_wallet_address || existingByEmail.wallet_address,
              base_wallet_address: walletAddress || existingByEmail.base_wallet_address || existingByEmail.wallet_address,
              username: existingByEmail.username,
              telegram_handle: existingByEmail.telegram_handle,
              telephone_number: existingByEmail.telephone_number,
              avatar_url: existingByEmail.avatar_url || recoveryUpdates.avatar_url,
              created_at: existingByEmail.created_at,
              first_name: existingByEmail.first_name,
              last_name: existingByEmail.last_name,
              country: existingByEmail.country,
            };
          }
        }

        // Try to find by canonical_user_id
        // Use limit(1) instead of maybeSingle() to avoid PGRST116 error
        const { data: existingByIdArray } = await supabase
          .from('canonical_users')
          .select('*')
          .eq('privy_user_id', inputUserId)
          .limit(1);

        const existingById = existingByIdArray?.[0] || null;

        if (existingById) {
          console.log('[user-auth] ✅ Found existing user by privy_user_id after conflict:', existingById.id);

          // Update avatar if missing
          let avatarUrl = existingById.avatar_url;
          if (!avatarUrl) {
            avatarUrl = userDataService.getDefaultAvatar();
            await supabase
              .from('canonical_users')
              .update({ avatar_url: avatarUrl })
              .eq('id', existingById.id);
          }

          return {
            id: existingById.id,
            uid: existingById.uid || existingById.id,
            email: existingById.email || email,
            wallet_address: existingById.wallet_address || walletAddress,
            eth_wallet_address: existingById.eth_wallet_address || existingById.wallet_address,
            base_wallet_address: existingById.base_wallet_address || existingById.wallet_address,
            username: existingById.username,
            telegram_handle: existingById.telegram_handle,
            telephone_number: existingById.telephone_number,
            avatar_url: avatarUrl,
            created_at: existingById.created_at,
            first_name: existingById.first_name,
            last_name: existingById.last_name,
            country: existingById.country,
          };
        }
      }

      console.error('[user-auth] Error creating user:', createError);
      return null;
    }

    // Update uid to match id
    if (createdUser.id) {
      await supabase
        .from('canonical_users')
        .update({ uid: createdUser.id })
        .eq('id', createdUser.id);
    }

    console.log('[user-auth] ✅ Created new user:', createdUser.id);

    return {
      id: createdUser.id,
      uid: createdUser.id,
      email: createdUser.email,
      wallet_address: createdUser.wallet_address,
      eth_wallet_address: createdUser.eth_wallet_address ?? createdUser.wallet_address,
      base_wallet_address: createdUser.base_wallet_address ?? createdUser.wallet_address,
      username: createdUser.username,
      telegram_handle: createdUser.telegram_handle,
      telephone_number: createdUser.telephone_number,
      avatar_url: createdUser.avatar_url,
      created_at: createdUser.created_at,
      first_name: createdUser.first_name,
      last_name: createdUser.last_name,
      country: createdUser.country,
    };
  },

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    // Generate canonical user ID for lookup
    const canonicalId = toPrizePid(userId);

    // For wallet addresses, also generate the legacy privy-style ID for backward compatibility
    let legacyPrivyId = userId;
    if (isWalletAddress(userId)) {
      legacyPrivyId = generatePrivyStyleId(userId);
    }

    // Normalize wallet address for case-insensitive comparison
    const normalizedWallet = isWalletAddress(userId) ? normalizeWalletAddress(userId) : null;

    // Build query with canonical ID first, then fall back to legacy lookups
    // Use ilike for wallet addresses to ensure case-insensitive matching
    let query = supabase
      .from('canonical_users')
      .select('*');

    if (normalizedWallet) {
      // Wallet address lookup - use ilike for case-insensitive matching
      query = query.or(`canonical_user_id.eq.${canonicalId},privy_user_id.eq.${legacyPrivyId},wallet_address.ilike.${normalizedWallet},base_wallet_address.ilike.${normalizedWallet}`);
    } else {
      // Non-wallet lookup
      query = query.or(`canonical_user_id.eq.${canonicalId},privy_user_id.eq.${userId}`);
    }

    // Use limit(1) instead of maybeSingle() to avoid PGRST116 error
    const { data: dataArray, error } = await query.limit(1);

    const data = dataArray?.[0] || null;

    if (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      uid: data.uid || data.id,
      canonical_user_id: data.canonical_user_id,
      email: data.email,
      wallet_address: data.wallet_address,
      eth_wallet_address: data.eth_wallet_address ?? data.wallet_address,
      base_wallet_address: data.base_wallet_address ?? data.wallet_address,
      username: data.username,
      telegram_handle: data.telegram_handle,
      telephone_number: data.telephone_number,
      avatar_url: data.avatar_url,
      created_at: data.created_at,
      first_name: data.first_name,
      last_name: data.last_name,
      country: data.country,
    };
  },

  async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<boolean> {
    const { error } = await supabase
      .from('canonical_users')
      .update(updates)
      .eq('id', userId);

    if (error) {
      console.error('Error updating user profile:', error);
      return false;
    }

    return true;
  },

  async getUserTickets(userId: string) {
    // Generate canonical user ID for consistent lookup
    const canonicalId = toPrizePid(userId);

    // Normalize wallet address for case-insensitive comparison
    const isWallet = isWalletAddress(userId);
    const normalizedWallet = isWallet ? normalizeWalletAddress(userId) : null;

    let data = null;
    let error = null;

    if (isWallet && normalizedWallet) {
      // Query by wallet address (PRIMARY for Base auth) - use ilike for case-insensitive matching
      const result = await supabase
        .from('v_joincompetition_active')
        .select(`
          *,
          competitions(*)
        `)
        .or(`walletaddress.ilike.${normalizedWallet},userid.eq.${canonicalId}`)
        .order('buytime', { ascending: false });
      data = result.data;
      error = result.error;
    } else {
      // Query by userid for legacy IDs
      const result = await supabase
        .from('v_joincompetition_active')
        .select(`
          *,
          competitions(*)
        `)
        .or(`privy_user_id.eq.${userId},userid.eq.${userId}`)
        .order('buytime', { ascending: false });
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('Error fetching user tickets:', error);
      return [];
    }

    return data || [];
  },

  /**
   * Sync email from user to canonical_users.
   * Supports both Base/CDP and Privy user objects.
   */
  async syncEmailToProfile(user: any): Promise<boolean> {
    const userId = user?.id;
    const email = extractEmailFromUser(user);

    if (!userId || !email) {
      return true;
    }

    try {
      // Use limit(1) instead of maybeSingle() to avoid PGRST116 error
      const { data: existingArray } = await supabase
        .from('canonical_users')
        .select('id, email')
        .eq('privy_user_id', userId)
        .limit(1);

      const existing = existingArray?.[0] || null;

      if (existing && existing.email !== email) {
        await supabase
          .from('canonical_users')
          .update({ email })
          .eq('id', existing.id);
      }

      return true;
    } catch (error) {
      console.error('[user-auth] syncEmailToProfile error:', error);
      return false;
    }
  },
};
