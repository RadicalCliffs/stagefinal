import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let sql: ReturnType<typeof postgres> | null = null;

  try {
    const dbUrl = Deno.env.get('DATABASE_URL') || Deno.env.get('SUPABASE_DB_URL');
    
    if (!dbUrl) {
      return new Response(JSON.stringify({
        success: false,
        error: 'DATABASE_URL not configured'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    sql = postgres(dbUrl, { ssl: 'require', max: 1, idle_timeout: 5 });

    // Step 1: List triggers before dropping
    const triggersBefore = await sql`
      SELECT t.tgname as trigger_name, p.proname as function_name
      FROM pg_trigger t
      JOIN pg_proc p ON t.tgfoid = p.oid
      JOIN pg_class c ON t.tgrelid = c.oid
      WHERE c.relname = 'pending_tickets' AND NOT t.tgisinternal
    `;

    // Step 2: Drop each trigger
    const dropped: string[] = [];
    for (const trigger of triggersBefore) {
      try {
        await sql.unsafe(`DROP TRIGGER IF EXISTS "${trigger.trigger_name}" ON pending_tickets CASCADE`);
        dropped.push(trigger.trigger_name);
      } catch (e) {
        dropped.push(`${trigger.trigger_name} (error: ${e})`);
      }
    }

    // Step 3: List triggers after dropping
    const triggersAfter = await sql`
      SELECT t.tgname as trigger_name
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      WHERE c.relname = 'pending_tickets' AND NOT t.tgisinternal
    `;

    // Step 4: Test insert
    let testResult = 'not attempted';
    if (triggersAfter.length === 0) {
      try {
        const testId = crypto.randomUUID();
        await sql`
          INSERT INTO pending_tickets (
            id, user_id, competition_id, ticket_numbers, ticket_count,
            ticket_price, total_amount, status, expires_at
          ) VALUES (
            ${testId}, 'test-drop-trigger', 'acd263e0-56dd-4512-acae-3d939dc0deda',
            ARRAY[9999], 1, 0.99, 0.99, 'pending', NOW() + INTERVAL '15 minutes'
          )
        `;
        await sql`DELETE FROM pending_tickets WHERE id = ${testId}`;
        testResult = 'SUCCESS';
      } catch (e) {
        testResult = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    await sql.end();

    return new Response(JSON.stringify({
      success: true,
      triggers_before: triggersBefore,
      dropped,
      triggers_after: triggersAfter,
      test_insert: testResult
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    if (sql) await sql.end().catch(() => {});
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
