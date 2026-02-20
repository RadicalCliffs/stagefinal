// Script to execute SQL file against Supabase
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = 'https://mthwfldcjvpxjtmrqkqm.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY environment variable');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const sqlFile = process.argv[2] || 'debug/CREATE_TEST_COMPETITIONS.sql';
  const sql = fs.readFileSync(path.resolve(sqlFile), 'utf-8');
  
  // Split by semicolons but keep only INSERT statements and verification SELECT
  const statements = sql
    .split(/;[\s]*\n/)
    .map(s => s.trim())
    .filter(s => s.startsWith('INSERT') || s.startsWith('SELECT'));

  console.log(`Found ${statements.length} statements to execute`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, ' ');
    console.log(`\n[${i + 1}/${statements.length}] ${preview}...`);
    
    try {
      const { data, error } = await supabase.rpc('exec_sql', { sql_query: stmt });
      if (error) {
        // Try direct approach - use raw SQL via PostgREST
        console.log('  RPC not available, this script needs direct DB access');
        throw error;
      }
      console.log('  ✓ Success');
    } catch (err) {
      console.error('  ✗ Error:', err.message || err);
    }
  }
}

main().catch(console.error);
