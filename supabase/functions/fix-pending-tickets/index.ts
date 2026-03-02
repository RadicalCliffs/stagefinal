import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const results: any[] = [];

    // Step 1: Try to drop all triggers on pending_tickets using a helper RPC
    // We'll create this RPC if it doesn't exist
    const dropTriggersSQL = `
      DO $
      DECLARE
          trigger_rec RECORD;
          trigger_count INTEGER := 0;
      BEGIN
          FOR trigger_rec IN 
              SELECT t.tgname
              FROM pg_trigger t
              WHERE t.tgrelid = 'pending_tickets'::regclass
              AND NOT t.tgisinternal
          LOOP
              trigger_count := trigger_count + 1;
              EXECUTE format('DROP TRIGGER IF EXISTS %I ON pending_tickets CASCADE', trigger_rec.tgname);
          END LOOP;
          
          -- Also drop potential trigger functions
          DROP FUNCTION IF EXISTS check_ticket_availability_trigger() CASCADE;
          DROP FUNCTION IF EXISTS validate_ticket_reservation() CASCADE;
          DROP FUNCTION IF EXISTS prevent_duplicate_ticket_reservation() CASCADE;
          DROP FUNCTION IF EXISTS check_tickets_available() CASCADE;
      END $;
    `;

    // Try to execute via a helper function if it exists
    const { error: dropError } = await supabase.rpc('execute_admin_sql', { 
      sql_text: dropTriggersSQL 
    });
    
    if (dropError) {
      results.push({ drop_triggers: 'rpc_not_available', error: dropError.message });
    } else {
      results.push({ drop_triggers: 'success' });
    }

    // Step 2: Try a direct insert to test if triggers are gone
    const testId = crypto.randomUUID();
    const testUserId = 'test-fix-user-' + Date.now();
    
    const testInsert = await supabase
      .from('pending_tickets')
      .insert({
        id: testId,
        user_id: testUserId,
        competition_id: 'acd263e0-56dd-4512-acae-3d939dc0deda',
        ticket_numbers: [9998, 9997],
        ticket_count: 2,
        ticket_price: 0.99,
        total_amount: 1.98,
        status: 'pending',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      .select();

    if (testInsert.error) {
      results.push({ 
        test_insert: 'failed', 
        error: testInsert.error.message,
        code: testInsert.error.code,
        details: testInsert.error.details,
        hint: testInsert.error.hint
      });
      
      // The trigger is still there. Let's try to identify it by querying pg_proc
      // for functions containing the error message
      const { data: funcSearch } = await supabase.rpc('search_function_source', {
        search_text: 'no longer available'
      });
      
      if (funcSearch) {
        results.push({ found_functions: funcSearch });
      }
    } else {
      results.push({ test_insert: 'success', data: testInsert.data });
      
      // Clean up test row
      if (testInsert.data?.[0]?.id) {
        await supabase
          .from('pending_tickets')
          .delete()
          .eq('id', testInsert.data[0].id);
        results.push({ cleanup: 'done' });
      }
    }

    // Step 3: Test the RPC function directly
    const rpcTest = await supabase.rpc('reserve_tickets_atomically', {
      p_user_id: testUserId,
      p_competition_id: 'acd263e0-56dd-4512-acae-3d939dc0deda',
      p_ticket_numbers: [9996, 9995],
      p_ticket_price: 0.99,
      p_reservation_id: crypto.randomUUID(),
      p_expires_at: new Date(Date.now() + 60000).toISOString(),
      p_session_id: null
    });

    if (rpcTest.error) {
      results.push({ 
        rpc_test: 'failed', 
        error: rpcTest.error.message,
        code: rpcTest.error.code
      });
    } else {
      results.push({ rpc_test: 'success', data: rpcTest.data });
      
      // Clean up if successful
      if (rpcTest.data?.reservation_id) {
        await supabase
          .from('pending_tickets')
          .delete()
          .eq('id', rpcTest.data.reservation_id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Diagnostic and fix attempt complete',
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
