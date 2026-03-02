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
    
    // Use postgres connection string to run raw SQL
    const dbUrl = Deno.env.get('SUPABASE_DB_URL') || 
      supabaseUrl.replace('https://', 'postgresql://postgres:').replace('.supabase.co', '.supabase.co:5432/postgres');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query triggers using a raw SQL approach via the PostgREST
    // We'll query the pg_trigger system catalog through a view or function
    
    // First, let's try to get trigger info by creating a temporary function
    const createFuncSQL = `
      CREATE OR REPLACE FUNCTION get_table_triggers(p_table_name text)
      RETURNS TABLE(
        trigger_name text,
        trigger_function text,
        trigger_event text,
        trigger_timing text
      )
      LANGUAGE sql
      SECURITY DEFINER
      AS $$
        SELECT 
          t.tgname::text as trigger_name,
          p.proname::text as trigger_function,
          CASE 
            WHEN t.tgtype & 1 = 1 THEN 'ROW'
            ELSE 'STATEMENT'
          END ||
          CASE 
            WHEN t.tgtype & 2 = 2 THEN ' BEFORE'
            WHEN t.tgtype & 64 = 64 THEN ' INSTEAD OF'
            ELSE ' AFTER'
          END ||
          CASE WHEN t.tgtype & 4 = 4 THEN ' INSERT' ELSE '' END ||
          CASE WHEN t.tgtype & 8 = 8 THEN ' DELETE' ELSE '' END ||
          CASE WHEN t.tgtype & 16 = 16 THEN ' UPDATE' ELSE '' END as trigger_event,
          CASE 
            WHEN t.tgtype & 2 = 2 THEN 'BEFORE'
            WHEN t.tgtype & 64 = 64 THEN 'INSTEAD OF'
            ELSE 'AFTER'
          END as trigger_timing
        FROM pg_trigger t
        JOIN pg_proc p ON t.tgfoid = p.oid
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE c.relname = p_table_name
        AND NOT t.tgisinternal;
      $$;
    `;

    // Try to call the function if it exists, otherwise return error
    const { data: triggers, error: triggerError } = await supabase.rpc(
      'get_table_triggers',
      { p_table_name: 'pending_tickets' }
    );

    if (triggerError) {
      // Function doesn't exist, return the error
      return new Response(JSON.stringify({
        success: false,
        error: 'get_table_triggers function not found',
        details: triggerError.message,
        hint: 'Run this SQL in Supabase SQL Editor to create the function and query triggers',
        sql: `
-- Create helper function
CREATE OR REPLACE FUNCTION get_table_triggers(p_table_name text)
RETURNS TABLE(trigger_name text, trigger_function text, trigger_event text)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT t.tgname::text, p.proname::text,
    CASE WHEN t.tgtype & 4 = 4 THEN 'INSERT' 
         WHEN t.tgtype & 8 = 8 THEN 'DELETE'
         WHEN t.tgtype & 16 = 16 THEN 'UPDATE' END
  FROM pg_trigger t
  JOIN pg_proc p ON t.tgfoid = p.oid
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = p_table_name AND NOT t.tgisinternal;
$$;

-- Query triggers on pending_tickets
SELECT * FROM get_table_triggers('pending_tickets');

-- Find functions with the error message
SELECT proname, substring(prosrc, 1, 500) as source_preview
FROM pg_proc 
WHERE prosrc ILIKE '%no longer available%';

-- Drop all triggers on pending_tickets
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tgname FROM pg_trigger t 
           JOIN pg_class c ON t.tgrelid = c.oid 
           WHERE c.relname = 'pending_tickets' AND NOT t.tgisinternal
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.tgname) || ' ON pending_tickets CASCADE';
    RAISE NOTICE 'Dropped: %', r.tgname;
  END LOOP;
END $$;
        `
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      triggers: triggers,
      count: triggers?.length || 0
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
