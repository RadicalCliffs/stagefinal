/**
 * Shared utility to get the admin wallet private key
 * Supports both ADMIN_WALLET_PRIVATE_KEY and NEW_ADMIN_WALLET_PRIVATE_KEY
 * for backwards compatibility during migration
 */

export function getAdminWalletPrivateKey(): string | null {
  return (
    Deno.env.get("ADMIN_WALLET_PRIVATE_KEY") ||
    Deno.env.get("NEW_ADMIN_WALLET_PRIVATE_KEY") ||
    null
  );
}

export function requireAdminWalletPrivateKey(): string {
  const key = getAdminWalletPrivateKey();
  if (!key) {
    throw new Error(
      "Admin wallet private key not configured. Set ADMIN_WALLET_PRIVATE_KEY or NEW_ADMIN_WALLET_PRIVATE_KEY in Supabase secrets.",
    );
  }
  return key;
}
