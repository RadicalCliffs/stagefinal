import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

/**
 * Create Backend PR Function
 * 
 * This function creates a GitHub pull request with backend infrastructure changes:
 * - RPC function modifications (SQL migrations)
 * - Edge function code changes
 * - Index modifications
 */

interface BackendPRRequest {
  title: string;
  description: string;
  changes: {
    rpc?: {
      name: string;
      code: string;
    } | null;
    edgeFunction?: {
      name: string;
      code: string;
    } | null;
  };
}

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

// Create GitHub PR for backend changes
async function createGitHubPR(prData: BackendPRRequest): Promise<{ prNumber: number; prUrl: string }> {
  const githubToken = Netlify.env.get("GITHUB_TOKEN");
  const repoOwner = Netlify.env.get("GITHUB_REPO_OWNER") || "teamstack-xyz";
  const repoName = Netlify.env.get("GITHUB_REPO_NAME") || "theprize.io";

  if (!githubToken) {
    throw new Error("GitHub token not configured");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const branchName = `backend-changes-${timestamp}`;

  try {
    // 1. Get the default branch reference
    const refResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/main`,
      {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'ThePrize-Backend-Editor'
        }
      }
    );

    if (!refResponse.ok) {
      throw new Error(`Failed to get main branch: ${refResponse.statusText}`);
    }

    const refData = await refResponse.json();
    const baseSha = refData.object.sha;

    // 2. Create new branch
    const createBranchResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/refs`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'ThePrize-Backend-Editor'
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha
        })
      }
    );

    if (!createBranchResponse.ok) {
      throw new Error(`Failed to create branch: ${createBranchResponse.statusText}`);
    }

    // 3. Create configuration file with changes
    const configContent = {
      timestamp: new Date().toISOString(),
      changes: prData.changes,
      version: '1.0.0'
    };

    const configJson = JSON.stringify(configContent, null, 2);
    const configBase64 = Buffer.from(configJson).toString('base64');

    // 4. Create file in the branch
    const filePath = `backend-changes-${Date.now()}.json`;
    const createFileResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'ThePrize-Backend-Editor'
        },
        body: JSON.stringify({
          message: 'Add backend infrastructure changes',
          content: configBase64,
          branch: branchName
        })
      }
    );

    if (!createFileResponse.ok) {
      throw new Error(`Failed to create file: ${createFileResponse.statusText}`);
    }

    // 5. Create pull request
    const createPRResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/pulls`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'ThePrize-Backend-Editor'
        },
        body: JSON.stringify({
          title: prData.title,
          body: prData.description,
          head: branchName,
          base: 'main'
        })
      }
    );

    if (!createPRResponse.ok) {
      const errorText = await createPRResponse.text();
      throw new Error(`Failed to create PR: ${createPRResponse.statusText} - ${errorText}`);
    }

    const prResult = await createPRResponse.json();

    return {
      prNumber: prResult.number,
      prUrl: prResult.html_url
    };

  } catch (error) {
    console.error('GitHub API error:', error);
    throw error;
  }
}

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
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

    const body = await req.json() as BackendPRRequest;

    if (!body.title || !body.description || !body.changes) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const result = await createGitHubPR(body);

    return new Response(
      JSON.stringify({
        success: true,
        prNumber: result.prNumber,
        prUrl: result.prUrl,
        message: 'Pull request created successfully'
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in create-backend-pr function:', error);
    
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
  path: "/api/create-backend-pr"
};
