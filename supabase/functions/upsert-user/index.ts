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
