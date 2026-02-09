import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200,  // Use 200 instead of 204 for better compatibility headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // SQL to fix get_unavailable_tickets
    const fixSql = `
      DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
      
      CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
      RETURNS INTEGER[]
      LANGUAGE plpgsql
      STABLE 
      SECURITY DEFINER
      SET search_path = public
      AS $$
      DECLARE
        v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
        v_sold_jc INTEGER[] := ARRAY[]::INTEGER[];
        v_sold_tickets INTEGER[] := ARRAY[]::INTEGER[];
        v_pending INTEGER[] := ARRAY[]::INTEGER[];
      BEGIN
        IF p_competition_id IS NULL OR TRIM(p_competition_id) = '' THEN 
          RETURN ARRAY[]::INTEGER[]; 
        END IF;

        -- Get sold tickets from joincompetition
        BEGIN
          SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
          INTO v_sold_jc
          FROM (
            SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num 
            FROM joincompetition
            WHERE competitionid = p_competition_id
              AND ticketnumbers IS NOT NULL 
              AND TRIM(ticketnumbers::TEXT) != ''
          ) AS jc_tickets
          WHERE ticket_num IS NOT NULL AND ticket_num > 0;
        EXCEPTION WHEN OTHERS THEN
          v_sold_jc := ARRAY[]::INTEGER[];
        END;

        -- Get sold tickets from tickets table
        BEGIN
          SELECT COALESCE(array_agg(DISTINCT t.ticket_number), ARRAY[]::INTEGER[])
          INTO v_sold_tickets
          FROM tickets t
          WHERE t.competition_id = p_competition_id
            AND t.ticket_number IS NOT NULL
            AND t.ticket_number > 0;
        EXCEPTION WHEN OTHERS THEN
          v_sold_tickets := ARRAY[]::INTEGER[];
        END;

        -- Get pending tickets from pending_ticket_items
        BEGIN
          SELECT COALESCE(array_agg(DISTINCT pti.ticket_number), ARRAY[]::INTEGER[])
          INTO v_pending
          FROM pending_ticket_items pti
          INNER JOIN pending_tickets pt ON pti.pending_ticket_id = pt.id
          WHERE pti.competition_id = p_competition_id
            AND pt.status IN ('pending', 'confirming')
            AND pt.expires_at > NOW()
            AND pti.ticket_number IS NOT NULL
            AND pti.ticket_number > 0;
        EXCEPTION WHEN OTHERS THEN
          v_pending := ARRAY[]::INTEGER[];
        END;

        -- Combine all sources
        v_unavailable := COALESCE(v_sold_jc, ARRAY[]::INTEGER[]) 
                      || COALESCE(v_sold_tickets, ARRAY[]::INTEGER[]) 
                      || COALESCE(v_pending, ARRAY[]::INTEGER[]);
        
        -- Remove duplicates and sort
        IF array_length(v_unavailable, 1) IS NOT NULL AND array_length(v_unavailable, 1) > 0 THEN
          SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::INTEGER[])
          INTO v_unavailable
          FROM unnest(v_unavailable) AS u
          WHERE u IS NOT NULL AND u > 0;
        ELSE
          v_unavailable := ARRAY[]::INTEGER[];
        END IF;
        
        RETURN v_unavailable;
      END;
      $$;
      
      GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated;
      GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO anon;
      GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO service_role;
    `;

    // Execute the SQL
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'X-Client-Info': 'fix-rpc-edge-function',
      },
      body: JSON.stringify({ sql: fixSql }),
    });

    if (!response.ok) {
      const error = await response.text();
      
      // Try alternative: pg-functions approach
      const altResponse = await fetch(`${supabaseUrl}/functions/v1/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ query: fixSql }),
      });
      
      if (!altResponse.ok) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Could not execute SQL via Edge Functions',
          hint: 'Run the SQL manually in Supabase Dashboard SQL Editor',
          sql: fixSql
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      const altData = await altResponse.json();
      return new Response(JSON.stringify({
        success: true,
        message: 'SQL executed via Edge Function',
        result: altData
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    
    // Test the fixed RPC
    const testResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_unavailable_tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ p_competition_id: '22786f37-66a1-4bf1-aa15-910ddf8d4eb4' }),
    });

    let testResult = null;
    if (testResponse.ok) {
      testResult = await testResponse.json();
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'get_unavailable_tickets RPC fixed!',
      sql_executed: true,
      test_result: testResult,
      ticket_count: Array.isArray(testResult) ? testResult.length : 'unknown'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: String(error),
      hint: 'Run this SQL in Supabase Dashboard → SQL Editor:',
      sql: `DROP FUNCTION IF EXISTS get_unavailable_tickets(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION get_unavailable_tickets(p_competition_id TEXT)
RETURNS INTEGER[] LANGUAGE plpgsql STABLE SECURITY DEFINER AS \$\$
DECLARE v_unavailable INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT ticket_num), ARRAY[]::INTEGER[])
  INTO v_unavailable
  FROM (
    SELECT CAST(TRIM(unnest(string_to_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket_num 
    FROM joincompetition WHERE competitionid = p_competition_id AND ticketnumbers IS NOT NULL
  ) jc WHERE ticket_num > 0;
  RETURN v_unavailable;
END;
\$\$;
GRANT EXECUTE ON FUNCTION get_unavailable_tickets(TEXT) TO authenticated, anon, service_role;`
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
