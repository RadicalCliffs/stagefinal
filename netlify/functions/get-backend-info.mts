import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

/**
 * Get Backend Info Function
 * 
 * This function retrieves information about backend infrastructure:
 * - Supabase RPC functions from migrations
 * - Netlify Edge functions
 * - Database indexes
 * 
 * Security: Admin-only access
 */

// Get Supabase clients
function getSupabaseClients() {
  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const supabaseAnonKey = Netlify.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase configuration");
  }

  if (!supabaseServiceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return { serviceClient };
}

// Verify admin status
async function verifyAdmin(
  walletAddress: string,
  serviceClient: ReturnType<typeof createClient>
): Promise<boolean> {
  const normalizedAddress = walletAddress.toLowerCase();

  const { data: user, error } = await serviceClient
    .from("canonical_users")
    .select("is_admin")
    .or(`wallet_address.ilike.${normalizedAddress},base_wallet_address.ilike.${normalizedAddress}`)
    .maybeSingle();

  if (error || !user) {
    console.error("Error checking admin status:", error?.message);
    return false;
  }

  return user.is_admin === true;
}

// Parse RPC functions from SQL migrations
async function getRPCFunctions(): Promise<any[]> {
  try {
    const migrationsPath = join(process.cwd(), 'supabase', 'migrations');
    const files = await readdir(migrationsPath);
    const sqlFiles = files.filter(f => f.endsWith('.sql'));

    const functions = [];
    
    for (const file of sqlFiles) {
      const content = await readFile(join(migrationsPath, file), 'utf-8');
      
      // Match CREATE OR REPLACE FUNCTION patterns with full body
      const functionRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\s*\((.*?)\)([\s\S]*?)(?=CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER|CREATE\s+INDEX|ALTER\s+TABLE|$)/gi;
      let match;
      
      while ((match = functionRegex.exec(content)) !== null) {
        const name = match[1];
        const params = match[2];
        const fullCode = match[0];
        
        // Check if SECURITY DEFINER
        const isSecurityDefiner = /SECURITY\s+DEFINER/i.test(fullCode);
        
        // Get language
        const languageMatch = fullCode.match(/LANGUAGE\s+(\w+)/i);
        const language = languageMatch ? languageMatch[1] : 'sql';
        
        // Get return type
        const returnMatch = fullCode.match(/RETURNS\s+([\w\s()]+)(?:\s+LANGUAGE)?/i);
        const returnType = returnMatch ? returnMatch[1].trim() : 'void';
        
        functions.push({
          name,
          file,
          signature: `${name}(${params})`,
          returnType,
          language,
          securityDefiner: isSecurityDefiner,
          description: `From migration: ${file}`,
          code: fullCode.trim()
        });
      }
    }

    return functions;
  } catch (error) {
    console.error('Error reading RPC functions:', error);
    return [];
  }
}

// Get Netlify Edge functions
async function getEdgeFunctions(): Promise<any[]> {
  try {
    const functionsPath = join(process.cwd(), 'netlify', 'functions');
    const files = await readdir(functionsPath);
    const mtsFiles = files.filter(f => f.endsWith('.mts'));

    const functions = [];
    
    for (const file of mtsFiles) {
      const filePath = join(functionsPath, file);
      const stats = await stat(filePath);
      
      functions.push({
        name: file.replace('.mts', ''),
        path: `netlify/functions/${file}`,
        size: stats.size,
        lastModified: stats.mtime.toISOString().split('T')[0]
      });
    }

    return functions;
  } catch (error) {
    console.error('Error reading edge functions:', error);
    return [];
  }
}

// Get database indexes
async function getDatabaseIndexes(serviceClient: ReturnType<typeof createClient>): Promise<any[]> {
  try {
    // Query pg_indexes system catalog to get all non-system indexes
    const { data, error } = await serviceClient.rpc('get_database_indexes');
    
    if (error) {
      console.error('Error querying indexes:', error);
      // Fallback: return empty array if RPC doesn't exist yet
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Error getting database indexes:', error);
    return [];
  }
}

export default async (req: Request, context: Context) => {
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();

    if (!token.startsWith('wallet:')) {
      return new Response(
        JSON.stringify({ error: 'Invalid token format' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const walletAddress = token.replace('wallet:', '').trim();

    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return new Response(
        JSON.stringify({ error: 'Invalid wallet address' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const { serviceClient } = getSupabaseClients();
    const isAdmin = await verifyAdmin(walletAddress, serviceClient);

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Get backend infrastructure info
    const [rpcFunctions, edgeFunctions, indexes] = await Promise.all([
      getRPCFunctions(),
      getEdgeFunctions(),
      getDatabaseIndexes(serviceClient)
    ]);

    return new Response(
      JSON.stringify({
        rpcFunctions,
        edgeFunctions,
        indexes
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in get-backend-info function:', error);
    
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

export const config: Config = {
  path: "/api/get-backend-info"
};
