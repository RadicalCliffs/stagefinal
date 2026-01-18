import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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
    let canonicalUserId = null;
    if (normalizedWallet) {
      // Simple PID generation: prz_ + first 8 chars of wallet
      canonicalUserId = `prz_${normalizedWallet.substring(2, 10)}`;
    }

    // Upsert - insert or update based on email
    const { data, error } = await supabase
      .from('canonical_users')
      .upsert({
        email: normalizedEmail,
        username: normalizedUsername,
        first_name: firstName || null,
        last_name: lastName || null,
        country: country || null,
        telegram_handle: telegram || null,
        avatar_url: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${normalizedUsername}`,
        usdc_balance: 0,
        has_used_new_user_bonus: false,
        // Include wallet fields if wallet address is provided
        ...(normalizedWallet && {
          wallet_address: normalizedWallet,
          base_wallet_address: normalizedWallet,
          eth_wallet_address: normalizedWallet,
          privy_user_id: normalizedWallet,
          canonical_user_id: canonicalUserId,
          wallet_linked: true,
          auth_provider: 'cdp',
        }),
      }, {
        onConflict: 'email',
      })
      .select('id, username, email')
      .single();

    if (error) {
      console.error('Upsert error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Call attach_identity_after_auth RPC to handle profile linking and prior_signup_payload
    // This is the transactional RPC that handles identity attachment post-authentication
    if (data?.id) {
      try {
        // Build prior_payload from signup data for profile mirroring
        const priorPayload = {
          username: normalizedUsername,
          avatar_url: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${normalizedUsername}`,
          country: country || null,
          first_name: firstName || null,
          last_name: lastName || null,
          telegram_handle: telegram || null,
        };

        console.log('Calling attach_identity_after_auth RPC:', {
          canonical_user_id: canonicalUserId,
          wallet_address: normalizedWallet,
          email: normalizedEmail,
          privy_user_id: normalizedWallet,
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
