import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { toPrizePid } from "../_shared/userId.ts";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, Pragma, Expires',
};

// Avatar URLs from Supabase public storage bucket "Avatars"
// These are the official 777btc avatars (EH-01 through EH-34)
const SUPABASE_AVATAR_BASE_URL = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Avatars';
const AVATAR_FILENAMES = [
  '777btc_Avatars_EH-01.png', '777btc_Avatars_EH-02.png', '777btc_Avatars_EH-03.png',
  '777btc_Avatars_EH-04.png', '777btc_Avatars_EH-05.png', '777btc_Avatars_EH-06.png',
  '777btc_Avatars_EH-07.png', '777btc_Avatars_EH-08.png', '777btc_Avatars_EH-09.png',
  '777btc_Avatars_EH-10.png', '777btc_Avatars_EH-11.png', '777btc_Avatars_EH-12.png',
  '777btc_Avatars_EH-13.png', '777btc_Avatars_EH-14.png', '777btc_Avatars_EH-15.png',
  '777btc_Avatars_EH-16.png', '777btc_Avatars_EH-17.png', '777btc_Avatars_EH-18.png',
  '777btc_Avatars_EH-19.png', '777btc_Avatars_EH-20.png', '777btc_Avatars_EH-21.png',
  '777btc_Avatars_EH-22.png', '777btc_Avatars_EH-23.png', '777btc_Avatars_EH-24.png',
  '777btc_Avatars_EH-25.png', '777btc_Avatars_EH-26.png', '777btc_Avatars_EH-27.png',
  '777btc_Avatars_EH-28.png', '777btc_Avatars_EH-29.png', '777btc_Avatars_EH-30.png',
  '777btc_Avatars_EH-31.png', '777btc_Avatars_EH-32.png', '777btc_Avatars_EH-33.png',
  '777btc_Avatars_EH-34.png',
];

// Get a random avatar URL from the Supabase storage bucket
function getRandomAvatarUrl(): string {
  const randomIndex = Math.floor(Math.random() * AVATAR_FILENAMES.length);
  return `${SUPABASE_AVATAR_BASE_URL}/${AVATAR_FILENAMES[randomIndex]}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { username, email, firstName, lastName, country, telegram, avatar, walletAddress } = await req.json();

    if (!username || !email) {
      return new Response(JSON.stringify({ error: 'Username and email required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();
    const normalizedWallet = walletAddress ? walletAddress.toLowerCase().trim() : null;

    // Generate canonical_user_id from wallet if provided
    // Use toPrizePid() for consistent format (matches client-side and other functions)
    let canonicalUserId = null;
    if (normalizedWallet) {
      canonicalUserId = toPrizePid(normalizedWallet);
    }

    console.log('[upsert-user] Request data:', {
      email: normalizedEmail,
      username: normalizedUsername,
      walletAddress: normalizedWallet ? normalizedWallet.substring(0, 10) + '...' : null,
      canonicalUserId: canonicalUserId ? canonicalUserId.substring(0, 20) + '...' : null,
      hasWallet: !!normalizedWallet,
    });

    // Helper function to build wallet fields object
    const buildWalletFields = () => {
      if (!normalizedWallet) return {};
      return {
        wallet_address: normalizedWallet,
        base_wallet_address: normalizedWallet,
        eth_wallet_address: normalizedWallet,
        privy_user_id: normalizedWallet,
        canonical_user_id: canonicalUserId,
        wallet_linked: true,
        auth_provider: 'cdp',
      };
    };

    // Check if user already exists by email (case-insensitive)
    // CRITICAL: Use ilike for case-insensitive matching to ensure we find
    // pre-created users regardless of how their email was stored
    // Fetch all needed fields in one query to avoid duplicate database calls
    const { data: existingUser } = await supabase
      .from('canonical_users')
      .select('id, email, canonical_user_id, wallet_address, username, first_name, last_name, country, telegram_handle, avatar_url')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    console.log('[upsert-user] Existing user check:', {
      found: !!existingUser,
      userId: existingUser?.id,
      hasCanonicalId: !!existingUser?.canonical_user_id,
      hasWallet: !!existingUser?.wallet_address,
      hasUsername: !!existingUser?.username,
    });

    let data, error;

    if (existingUser) {
      // User exists - UPDATE with wallet fields and preserve existing data
      console.log('[upsert-user] Updating existing user:', existingUser.id);
      
      const updateData = {
        // CRITICAL: Preserve existing username if it exists, otherwise use provided username
        // This prevents overwriting the username from the signup form
        // Use nullish coalescing to preserve intentional empty strings
        username: existingUser.username ?? normalizedUsername,
        first_name: existingUser.first_name ?? firstName ?? null,
        last_name: existingUser.last_name ?? lastName ?? null,
        country: existingUser.country ?? country ?? null,
        telegram_handle: existingUser.telegram_handle ?? telegram ?? null,
        avatar_url: existingUser.avatar_url ?? avatar ?? getRandomAvatarUrl(),
        // CRITICAL: Include wallet fields if wallet address is provided
        ...buildWalletFields(),
      };

      console.log('[upsert-user] Preserving username:', {
        existing: existingUser.username,
        provided: normalizedUsername,
        using: updateData.username
      });

      const result = await supabase
        .from('canonical_users')
        .update(updateData)
        .eq('id', existingUser.id)
        .select('id, username, email, canonical_user_id, wallet_address, base_wallet_address')
        .single();
      
      data = result.data;
      error = result.error;
    } else {
      // User doesn't exist - INSERT new user
      console.log('[upsert-user] Creating new user');
      
      const insertData = {
        email: normalizedEmail,
        username: normalizedUsername,
        first_name: firstName || null,
        last_name: lastName || null,
        country: country || null,
        telegram_handle: telegram || null,
        avatar_url: avatar || getRandomAvatarUrl(),
        usdc_balance: 0,
        has_used_new_user_bonus: false,
        // Include wallet fields if wallet address is provided
        ...buildWalletFields(),
      };

      const result = await supabase
        .from('canonical_users')
        .insert(insertData)
        .select('id, username, email, canonical_user_id, wallet_address, base_wallet_address')
        .single();
      
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('[upsert-user] Upsert error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    console.log('[upsert-user] Upsert successful:', {
      userId: data?.id,
      email: data?.email,
      username: data?.username,
      hasCanonicalId: !!data?.canonical_user_id,
      hasWallet: !!data?.wallet_address,
    });

    // Call attach_identity_after_auth RPC to handle profile linking and prior_signup_payload
    // This is the transactional RPC that handles identity attachment post-authentication
    if (data?.id) {
      try {
        // Build prior_payload from signup data for profile mirroring
        const priorPayload = {
          username: normalizedUsername,
          avatar_url: avatar || getRandomAvatarUrl(),
          country: country || null,
          first_name: firstName || null,
          last_name: lastName || null,
          telegram_handle: telegram || null,
        };

        console.log('[upsert-user] Calling attach_identity_after_auth RPC:', {
          hasCanonicalUserId: !!canonicalUserId,
          hasWalletAddress: !!normalizedWallet,
          hasEmail: !!normalizedEmail,
        });

        const { data: rpcResult, error: rpcError } = await supabase.rpc('attach_identity_after_auth', {
          in_canonical_user_id: canonicalUserId,
          in_wallet_address: normalizedWallet,
          in_email: normalizedEmail,
          in_privy_user_id: normalizedWallet,
          in_prior_payload: priorPayload,
          in_base_wallet_address: normalizedWallet,
          in_eth_wallet_address: normalizedWallet,
        });

        if (rpcError) {
          // Log but don't fail - the user was already created successfully
          console.warn('attach_identity_after_auth RPC warning:', rpcError);
        } else {
          console.log('attach_identity_after_auth RPC success:', rpcResult);
        }
      } catch (rpcErr) {
        // Non-blocking - don't fail the request if RPC fails
        console.warn('attach_identity_after_auth RPC exception:', rpcErr);
      }
    }

    return new Response(JSON.stringify({ success: true, user: data }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
