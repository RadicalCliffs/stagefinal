import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

/**
 * Cleanup Duplicate Email Accounts
 *
 * This function handles two scenarios for duplicate emails:
 *
 * 1. SAME WALLET, MULTIPLE ACCOUNTS: Truly redundant accounts for the same wallet.
 *    These are deleted entirely, keeping only the most active one.
 *
 * 2. DIFFERENT WALLETS, SAME EMAIL: Different users sharing an email.
 *    The email is kept ONLY on the most active account.
 *    Other accounts have their email cleared (set to NULL).
 *
 * This ensures each email maps to exactly one wallet for authentication.
 *
 * Routes:
 * - GET /api/cleanup-duplicate-emails?dry_run=true - Preview what would be done
 * - POST /api/cleanup-duplicate-emails - Execute the cleanup
 */

const OPENING_BALANCE = 10; // $10 opening bonus

interface UserAccount {
  id: string;
  uid: string;
  privy_user_id: string;
  canonical_user_id: string | null;
  email: string | null;
  wallet_address: string | null;
  base_wallet_address: string | null;
  bonus_balance: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface AccountWithActivity extends UserAccount {
  transaction_count: number;
  entry_count: number;
  activity_score: number;
  balance: number;
  effective_wallet: string;
}

interface DuplicateEmailGroup {
  email: string;
  accounts: AccountWithActivity[];
  account_to_keep: AccountWithActivity;
  accounts_to_delete: AccountWithActivity[];  // Same wallet duplicates - delete entirely
  accounts_to_clear_email: AccountWithActivity[];  // Different wallet - just clear email
}

function getSupabaseClient() {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const supabaseServiceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase configuration");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ error: message, ok: false }, status);
}

/**
 * Calculate an activity score for an account
 * Higher score = more active/valuable account
 */
function calculateActivityScore(account: AccountWithActivity): number {
  let score = 0;

  // Balance above opening bonus is valuable
  const balance = account.balance || 0;
  if (balance > OPENING_BALANCE) {
    score += (balance - OPENING_BALANCE) * 10; // $1 above opening = 10 points
  } else if (balance > 0) {
    score += 1; // Has some balance
  }

  // Competition entries are very valuable
  score += (account.entry_count || 0) * 100;

  // Transactions show engagement
  score += (account.transaction_count || 0) * 50;

  return score;
}

/**
 * Get the effective wallet address for an account (normalized to lowercase)
 */
function getEffectiveWallet(account: UserAccount): string {
  const wallet = account.wallet_address || account.base_wallet_address || "";
  return wallet.toLowerCase();
}

async function findDuplicateEmails(serviceClient: ReturnType<typeof createClient>): Promise<DuplicateEmailGroup[]> {
  // Step 1: Find all emails that appear multiple times
  const { data: allUsers, error: countError } = await serviceClient
    .from("canonical_users")
    .select("id, uid, privy_user_id, email, wallet_address, base_wallet_address, canonical_user_id, bonus_balance, created_at, updated_at")
    .not("email", "is", null)
    .not("email", "eq", "");

  if (countError) {
    throw new Error(`Failed to fetch users: ${countError.message}`);
  }

  // Count email occurrences (case-insensitive)
  const emailMap = new Map<string, UserAccount[]>();
  for (const user of allUsers || []) {
    if (user.email) {
      const email = user.email.toLowerCase().trim();
      if (!emailMap.has(email)) {
        emailMap.set(email, []);
      }
      emailMap.get(email)!.push(user);
    }
  }

  // Get emails with duplicates
  const duplicateEmails = Array.from(emailMap.entries())
    .filter(([, accounts]) => accounts.length > 1);

  if (duplicateEmails.length === 0) {
    return [];
  }

  console.log(`Found ${duplicateEmails.length} emails with multiple accounts`);

  // Step 2: Process each duplicate email group
  const duplicateGroups: DuplicateEmailGroup[] = [];

  for (const [email, accounts] of duplicateEmails) {
    // Enrich accounts with activity data
    const enrichedAccounts: AccountWithActivity[] = [];

    for (const account of accounts) {
      // Get balance from wallet_balances table
      const { data: balanceData } = await serviceClient
        .from("wallet_balances")
        .select("balance")
        .eq("user_id", account.id)
        .maybeSingle();

      const balance = balanceData?.balance || 0;

      // Count transactions for this account
      const walletAddr = account.wallet_address || 'IMPOSSIBLE';
      const baseWalletAddr = account.base_wallet_address || 'IMPOSSIBLE';

      const { count: transactionCount } = await serviceClient
        .from("user_transactions")
        .select("*", { count: "exact", head: true })
        .or(`user_id.eq.${account.privy_user_id},wallet_address.ilike.${walletAddr},wallet_address.ilike.${baseWalletAddr}`);

      // Count competition entries for this account
      const { count: entryCount } = await serviceClient
        .from("joincompetition")
        .select("*", { count: "exact", head: true })
        .or(`userid.eq.${account.privy_user_id},wallet_address.ilike.${walletAddr},wallet_address.ilike.${baseWalletAddr},privy_user_id.eq.${account.privy_user_id}`);

      const enrichedAccount: AccountWithActivity = {
        ...account,
        balance,
        transaction_count: transactionCount || 0,
        entry_count: entryCount || 0,
        activity_score: 0,
        effective_wallet: getEffectiveWallet(account),
      };

      enrichedAccount.activity_score = calculateActivityScore(enrichedAccount);

      enrichedAccounts.push(enrichedAccount);
    }

    // Sort by activity score (highest first)
    enrichedAccounts.sort((a, b) => b.activity_score - a.activity_score);

    // The first account (highest score) is kept with email
    const accountToKeep = enrichedAccounts[0];
    const otherAccounts = enrichedAccounts.slice(1);

    // Categorize other accounts:
    // - Same wallet as keeper = delete entirely (truly redundant)
    // - Different wallet = clear email only (different user)
    const accountsToDelete: AccountWithActivity[] = [];
    const accountsToClearEmail: AccountWithActivity[] = [];

    const keeperWallet = accountToKeep.effective_wallet;

    for (const acc of otherAccounts) {
      if (acc.effective_wallet === keeperWallet) {
        // Same wallet - this is a redundant duplicate account
        accountsToDelete.push(acc);
      } else {
        // Different wallet - just remove email from this account
        accountsToClearEmail.push(acc);
      }
    }

    // Only add to results if there are accounts to process
    if (accountsToDelete.length > 0 || accountsToClearEmail.length > 0) {
      duplicateGroups.push({
        email,
        accounts: enrichedAccounts,
        account_to_keep: accountToKeep,
        accounts_to_delete: accountsToDelete,
        accounts_to_clear_email: accountsToClearEmail,
      });
    }
  }

  return duplicateGroups;
}

async function processCleanup(
  serviceClient: ReturnType<typeof createClient>,
  accountsToDelete: AccountWithActivity[],
  accountsToClearEmail: AccountWithActivity[]
): Promise<{ deleted: string[]; cleared: string[]; errors: string[] }> {
  const deleted: string[] = [];
  const cleared: string[] = [];
  const errors: string[] = [];

  // First, clear emails from accounts that are different wallets
  // Use raw SQL via RPC to avoid trigger issues
  for (const account of accountsToClearEmail) {
    try {
      // Use raw SQL to update, avoiding any triggers that reference non-existent columns
      const { error: updateError } = await serviceClient.rpc('execute_sql', {
        sql: `UPDATE canonical_users SET email = NULL, updated_at = NOW() WHERE id = '${account.id}'`
      });

      // If RPC doesn't exist, fallback to direct update
      if (updateError && updateError.message.includes('function')) {
        const { error: directError } = await serviceClient
          .from("canonical_users")
          .update({ email: null })
          .eq("id", account.id);

        if (directError) {
          errors.push(`Failed to clear email for ${account.privy_user_id}: ${directError.message}`);
          continue;
        }
      } else if (updateError) {
        errors.push(`Failed to clear email for ${account.privy_user_id}: ${updateError.message}`);
        continue;
      }

      cleared.push(account.privy_user_id);
      console.log(`Cleared email from account: ${account.privy_user_id} (wallet: ${account.effective_wallet})`);
    } catch (err) {
      errors.push(`Error clearing email for ${account.privy_user_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Then, delete redundant same-wallet accounts
  for (const account of accountsToDelete) {
    try {
      // Delete from wallet_balances first (references canonical_users)
      await serviceClient
        .from("wallet_balances")
        .delete()
        .eq("user_id", account.id);

      // Delete from balance_ledger
      await serviceClient
        .from("balance_ledger")
        .delete()
        .eq("user_id", account.id);

      // Delete from pending_tickets
      await serviceClient
        .from("pending_tickets")
        .delete()
        .or(`user_id.eq.${account.privy_user_id},user_id.eq.${account.canonical_user_id || 'NONE'}`);

      // Delete the main user account
      const { error: deleteError } = await serviceClient
        .from("canonical_users")
        .delete()
        .eq("id", account.id);

      if (deleteError) {
        errors.push(`Failed to delete account ${account.privy_user_id}: ${deleteError.message}`);
      } else {
        deleted.push(account.privy_user_id);
        console.log(`Deleted redundant account: ${account.privy_user_id} (wallet: ${account.effective_wallet})`);
      }
    } catch (err) {
      errors.push(`Error deleting account ${account.privy_user_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { deleted, cleared, errors };
}

export default async (req: Request, context: Context): Promise<Response> => {
  // Check for admin authorization (basic protection)
  const adminKey = Netlify.env.get("ADMIN_API_KEY");
  const authHeader = req.headers.get("Authorization");

  if (adminKey && (!authHeader || authHeader !== `Bearer ${adminKey}`)) {
    // If ADMIN_API_KEY is set, require it. Otherwise allow access (for dev/testing)
    const hasKey = !!adminKey;
    if (hasKey) {
      return errorResponse("Unauthorized - admin access required", 401);
    }
  }

  const serviceClient = getSupabaseClient();
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true" || req.method === "GET";

  try {
    console.log(`Starting duplicate email cleanup (dry_run: ${dryRun})`);

    // Find all duplicate email groups
    const duplicateGroups = await findDuplicateEmails(serviceClient);

    if (duplicateGroups.length === 0) {
      return jsonResponse({
        ok: true,
        message: "No duplicate email accounts found that need cleanup",
        duplicate_email_count: 0,
        accounts_to_delete: 0,
        accounts_to_clear_email: 0,
      });
    }

    // Collect all accounts to process
    const allAccountsToDelete = duplicateGroups.flatMap(g => g.accounts_to_delete);
    const allAccountsToClearEmail = duplicateGroups.flatMap(g => g.accounts_to_clear_email);

    // Prepare summary
    const summary = {
      ok: true,
      dry_run: dryRun,
      duplicate_email_count: duplicateGroups.length,
      total_accounts_affected: duplicateGroups.reduce((sum, g) => sum + g.accounts.length, 0),
      accounts_to_delete: allAccountsToDelete.length,
      accounts_to_clear_email: allAccountsToClearEmail.length,
      groups: duplicateGroups.map(g => ({
        email: g.email,
        total_accounts: g.accounts.length,
        keeping: {
          privy_user_id: g.account_to_keep.privy_user_id,
          wallet_address: g.account_to_keep.effective_wallet,
          balance: g.account_to_keep.balance,
          activity_score: g.account_to_keep.activity_score,
          entry_count: g.account_to_keep.entry_count,
          transaction_count: g.account_to_keep.transaction_count,
        },
        deleting_redundant_accounts: g.accounts_to_delete.map(acc => ({
          privy_user_id: acc.privy_user_id,
          wallet_address: acc.effective_wallet,
          balance: acc.balance,
          activity_score: acc.activity_score,
          entry_count: acc.entry_count,
          transaction_count: acc.transaction_count,
          reason: "Same wallet as kept account - redundant duplicate",
        })),
        clearing_email_from_accounts: g.accounts_to_clear_email.map(acc => ({
          privy_user_id: acc.privy_user_id,
          wallet_address: acc.effective_wallet,
          balance: acc.balance,
          activity_score: acc.activity_score,
          entry_count: acc.entry_count,
          transaction_count: acc.transaction_count,
          reason: "Different wallet - email will be cleared to resolve conflict",
        })),
      })),
    };

    if (dryRun) {
      return jsonResponse({
        ...summary,
        message: `Dry run - would delete ${allAccountsToDelete.length} redundant accounts and clear email from ${allAccountsToClearEmail.length} accounts. Send POST request to execute cleanup.`,
      });
    }

    // Execute the cleanup
    const { deleted, cleared, errors } = await processCleanup(serviceClient, allAccountsToDelete, allAccountsToClearEmail);

    return jsonResponse({
      ...summary,
      deleted_count: deleted.length,
      deleted_accounts: deleted,
      cleared_count: cleared.length,
      cleared_accounts: cleared,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully deleted ${deleted.length} redundant accounts and cleared email from ${cleared.length} accounts${errors.length > 0 ? ` with ${errors.length} errors` : ""}`,
    });
  } catch (err) {
    console.error("Cleanup error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500
    );
  }
};

export const config: Config = {
  path: "/api/cleanup-duplicate-emails",
};
