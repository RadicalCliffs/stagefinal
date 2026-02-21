const { Client } = require('pg');

const client = new Client({
  host: 'aws-1-ap-south-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.mthwfldcjvpxjtmrqkqm',
  password: 'LetsF4ckenGo!',
  ssl: { rejectUnauthorized: false }
});

// Strip defaults from arg list: "p_user text DEFAULT NULL::text, p_id text" -> "text, text"
function stripDefaults(args) {
  return args
    .split(',')
    .map(arg => {
      // Remove DEFAULT ... portion
      const withoutDefault = arg.split(/\s+DEFAULT\s+/i)[0].trim();
      // Extract just the type (last word or words like "character varying")
      const parts = withoutDefault.split(/\s+/);
      // Handle "p_name type" -> "type", "p_name character varying" -> "character varying"
      if (parts.length >= 2) {
        return parts.slice(1).join(' ');
      }
      return withoutDefault;
    })
    .join(', ');
}

async function run() {
  await client.connect();
  console.log('Connected\n');

  // Get functions that still reference usdc_balance
  const funcs = await client.query(`
    SELECT p.oid, p.proname as name, pg_get_function_identity_arguments(p.oid) as identity_args
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' 
    AND prosrc ILIKE '%usdc_balance%'
  `);

  console.log('Dropping', funcs.rows.length, 'functions with usdc_balance:\n');
  for (const f of funcs.rows) {
    const cleanArgs = stripDefaults(f.identity_args);
    const dropSql = `DROP FUNCTION IF EXISTS public.${f.name}(${cleanArgs}) CASCADE`;
    console.log('  ', f.name + '(' + cleanArgs + ')');
    try {
      await client.query(dropSql);
      console.log('    ✅ Dropped');
    } catch (e) {
      console.log('    ❌', e.message);
    }
  }

  // Recreate the critical ones with proper function bodies
  console.log('\nRecreating necessary functions...\n');

  // credit_user_balance - used by some flows
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION public.credit_user_balance(p_user_id uuid, p_amount numeric)
      RETURNS numeric
      LANGUAGE plpgsql SECURITY DEFINER
      AS $func$
      DECLARE 
        v_new_balance NUMERIC;
        v_canonical_id TEXT;
      BEGIN
        SELECT canonical_user_id INTO v_canonical_id FROM canonical_users WHERE id = p_user_id;
        IF v_canonical_id IS NULL THEN RETURN 0; END IF;
        
        INSERT INTO public.sub_account_balances AS sab
          (canonical_user_id, currency, available_balance, pending_balance, last_updated)
        VALUES (v_canonical_id, 'USD', p_amount, 0, now())
        ON CONFLICT (canonical_user_id, currency) DO UPDATE
          SET available_balance = sab.available_balance + p_amount, last_updated = now()
        RETURNING available_balance INTO v_new_balance;
        
        RETURN COALESCE(v_new_balance, 0);
      END;
      $func$;
    `);
    console.log('✅ Created credit_user_balance(uuid,numeric)');
  } catch (e) { console.log('⚠️ credit_user_balance:', e.message); }

  // get_custody_wallet_summary - admin dashboard
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION public.get_custody_wallet_summary()
      RETURNS TABLE(total_users bigint, total_balance numeric, avg_balance numeric)
      LANGUAGE sql STABLE
      AS $func$
        SELECT COUNT(*)::BIGINT, COALESCE(SUM(available_balance), 0), COALESCE(AVG(available_balance), 0)
        FROM public.canonical_users;
      $func$;
    `);
    console.log('✅ Created get_custody_wallet_summary()');
  } catch (e) { console.log('⚠️ get_custody_wallet_summary:', e.message); }

  // get_user_balance - core function
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION public.get_user_balance(p_user_identifier text DEFAULT NULL, p_canonical_user_id text DEFAULT NULL)
      RETURNS TABLE(canonical_user_id text, available_balance numeric, pending_balance numeric, total_balance numeric)
      LANGUAGE plpgsql STABLE
      AS $func$
      BEGIN
        RETURN QUERY
        SELECT 
          cu.canonical_user_id,
          cu.available_balance,
          COALESCE(sab.pending_balance, 0::numeric),
          cu.available_balance + COALESCE(sab.pending_balance, 0::numeric)
        FROM public.canonical_users cu
        LEFT JOIN public.sub_account_balances sab ON sab.canonical_user_id = cu.canonical_user_id AND sab.currency = 'USD'
        WHERE (p_canonical_user_id IS NOT NULL AND cu.canonical_user_id = p_canonical_user_id)
           OR (p_user_identifier IS NOT NULL AND (cu.wallet_address = p_user_identifier OR cu.email = p_user_identifier));
      END;
      $func$;
    `);
    console.log('✅ Created get_user_balance(text,text)');
  } catch (e) { console.log('⚠️ get_user_balance:', e.message); }

  // credit_sub_account_with_bonus - uses SAB
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION public.credit_sub_account_with_bonus(
        p_canonical_user_id text,
        p_amount numeric,
        p_currency text DEFAULT 'USD'
      )
      RETURNS numeric
      LANGUAGE plpgsql SECURITY DEFINER
      AS $func$
      DECLARE v_new_balance NUMERIC;
      BEGIN
        INSERT INTO public.sub_account_balances AS sab
          (canonical_user_id, currency, available_balance, pending_balance, last_updated)
        VALUES (p_canonical_user_id, 'USD', p_amount, 0, now())
        ON CONFLICT (canonical_user_id, currency) DO UPDATE
          SET available_balance = sab.available_balance + p_amount, last_updated = now()
        RETURNING available_balance INTO v_new_balance;
        RETURN COALESCE(v_new_balance, 0);
      END;
      $func$;
    `);
    console.log('✅ Created credit_sub_account_with_bonus(text,numeric,text)');
  } catch (e) { console.log('⚠️ credit_sub_account_with_bonus:', e.message); }

  // get_user_dashboard_entries - reads balance
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION public.get_user_dashboard_entries(
        p_canonical_user_id text,
        p_include_pending boolean DEFAULT false
      )
      RETURNS TABLE(
        entry_id uuid,
        competition_id uuid,
        ticket_number text,
        entry_date timestamptz,
        status text,
        prize_amount numeric
      )
      LANGUAGE plpgsql STABLE SECURITY DEFINER
      AS $func$
      BEGIN
        RETURN QUERY
        SELECT 
          t.id as entry_id,
          t.competition_id,
          t.ticket_number,
          t.created_at as entry_date,
          COALESCE(t.status, 'active') as status,
          0::numeric as prize_amount
        FROM public.tickets t
        WHERE t.canonical_user_id = p_canonical_user_id
          AND (p_include_pending OR t.status != 'pending');
      END;
      $func$;
    `);
    console.log('✅ Created get_user_dashboard_entries(text,boolean)');
  } catch (e) { console.log('⚠️ get_user_dashboard_entries:', e.message); }

  // upsert_canonical_user - core user management
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION public.upsert_canonical_user(
        p_uid text,
        p_canonical_user_id text DEFAULT NULL,
        p_email text DEFAULT NULL,
        p_username text DEFAULT NULL,
        p_wallet_address text DEFAULT NULL,
        p_base_wallet_address text DEFAULT NULL,
        p_eth_wallet_address text DEFAULT NULL,
        p_privy_user_id text DEFAULT NULL,
        p_first_name text DEFAULT NULL,
        p_last_name text DEFAULT NULL,
        p_telegram_handle text DEFAULT NULL,
        p_country text DEFAULT NULL,
        p_avatar_url text DEFAULT NULL,
        p_auth_provider text DEFAULT NULL,
        p_wallet_linked boolean DEFAULT false
      )
      RETURNS TABLE(
        id uuid,
        canonical_user_id text,
        email text,
        username text,
        wallet_address text,
        available_balance numeric
      )
      LANGUAGE plpgsql SECURITY DEFINER
      AS $func$
      DECLARE
        v_canonical_id TEXT;
        v_id UUID;
      BEGIN
        -- Generate canonical_user_id if not provided
        v_canonical_id := COALESCE(p_canonical_user_id, 'user_' || gen_random_uuid()::text);
        
        INSERT INTO public.canonical_users (
          canonical_user_id, email, username, wallet_address, base_wallet_address,
          eth_wallet_address, privy_user_id, first_name, last_name, telegram_handle,
          country, avatar_url, auth_provider, wallet_linked, available_balance
        ) VALUES (
          v_canonical_id, p_email, p_username, p_wallet_address, p_base_wallet_address,
          p_eth_wallet_address, p_privy_user_id, p_first_name, p_last_name, p_telegram_handle,
          p_country, p_avatar_url, p_auth_provider, p_wallet_linked, 0
        )
        ON CONFLICT (canonical_user_id) DO UPDATE SET
          email = COALESCE(EXCLUDED.email, canonical_users.email),
          username = COALESCE(EXCLUDED.username, canonical_users.username),
          wallet_address = COALESCE(EXCLUDED.wallet_address, canonical_users.wallet_address),
          base_wallet_address = COALESCE(EXCLUDED.base_wallet_address, canonical_users.base_wallet_address),
          eth_wallet_address = COALESCE(EXCLUDED.eth_wallet_address, canonical_users.eth_wallet_address),
          privy_user_id = COALESCE(EXCLUDED.privy_user_id, canonical_users.privy_user_id),
          first_name = COALESCE(EXCLUDED.first_name, canonical_users.first_name),
          last_name = COALESCE(EXCLUDED.last_name, canonical_users.last_name),
          telegram_handle = COALESCE(EXCLUDED.telegram_handle, canonical_users.telegram_handle),
          country = COALESCE(EXCLUDED.country, canonical_users.country),
          avatar_url = COALESCE(EXCLUDED.avatar_url, canonical_users.avatar_url),
          auth_provider = COALESCE(EXCLUDED.auth_provider, canonical_users.auth_provider),
          wallet_linked = COALESCE(EXCLUDED.wallet_linked, canonical_users.wallet_linked),
          updated_at = now()
        RETURNING canonical_users.id INTO v_id;
        
        RETURN QUERY SELECT 
          cu.id, cu.canonical_user_id, cu.email, cu.username, cu.wallet_address, cu.available_balance
        FROM public.canonical_users cu WHERE cu.id = v_id;
      END;
      $func$;
    `);
    console.log('✅ Created upsert_canonical_user(...)');
  } catch (e) { console.log('⚠️ upsert_canonical_user:', e.message); }

  // Verify
  const remaining = await client.query(`
    SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND prosrc ILIKE '%usdc_balance%'
  `);
  
  console.log('\n=== Remaining functions with usdc_balance:', remaining.rows.length);
  remaining.rows.forEach(r => console.log('  ⚠️', r.proname));

  if (remaining.rows.length === 0) {
    console.log('\n✅ SUCCESS: No functions reference usdc_balance anymore!');
  }

  await client.end();
}

run().catch(e => console.error('ERROR:', e.message));
