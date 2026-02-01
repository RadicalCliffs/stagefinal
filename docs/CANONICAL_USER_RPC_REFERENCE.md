# Canonical User RPC Function Reference

## Overview

The `upsert_canonical_user` function is the primary RPC endpoint for managing canonical user records in ThePrize.io. It handles user creation, updates, and temporary placeholder replacement for email-first authentication flows.

## Function Signature

```sql
CREATE OR REPLACE FUNCTION public.upsert_canonical_user(
  p_uid TEXT,                           -- Required: User's unique identifier
  p_canonical_user_id TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_username TEXT DEFAULT NULL,
  p_wallet_address TEXT DEFAULT NULL,
  p_base_wallet_address TEXT DEFAULT NULL,
  p_eth_wallet_address TEXT DEFAULT NULL,
  p_privy_user_id TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_telegram_handle TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL,
  p_auth_provider TEXT DEFAULT NULL,
  p_wallet_linked BOOLEAN DEFAULT FALSE  -- Important: BOOLEAN type for client compatibility
)
RETURNS JSONB
```

## Return Value

Returns a JSONB object with:
```json
{
  "id": "user-id-string",
  "canonical_user_id": "prize:pid:0xabcdef..."
}
```

## Parameter Details

### Required Parameters

- **`p_uid`**: User's unique identifier (uid field in canonical_users table)

### Optional Parameters

All other parameters are optional and support incremental updates:

- **`p_canonical_user_id`**: Canonical user ID in format `prize:pid:0x...` or `prize:pid:temp<N>` for placeholders
- **`p_email`**: User's email address
- **`p_username`**: Display username
- **`p_wallet_address`**: Primary wallet address (normalized to lowercase)
- **`p_base_wallet_address`**: Base network wallet address
- **`p_eth_wallet_address`**: Ethereum network wallet address
- **`p_privy_user_id`**: Privy authentication provider ID
- **`p_first_name`**: User's first name
- **`p_last_name`**: User's last name
- **`p_telegram_handle`**: Telegram username
- **`p_country`**: Country code
- **`p_avatar_url`**: Profile avatar URL
- **`p_auth_provider`**: Authentication provider name
- **`p_wallet_linked`**: **BOOLEAN** flag indicating if this is a wallet connection event

### Important: p_wallet_linked Type

The `p_wallet_linked` parameter **MUST** be passed as a boolean (`true` or `false`), not as a string.

**Correct Frontend Usage:**
```typescript
await supabase.rpc('upsert_canonical_user', {
  p_uid: userId,
  p_wallet_linked: true,  // ✅ Boolean
  // ... other params
});
```

**Incorrect Usage:**
```typescript
await supabase.rpc('upsert_canonical_user', {
  p_uid: userId,
  p_wallet_linked: 'true',  // ❌ String - will cause type error
  // ... other params
});
```

## Behavior

### Insert vs Update

- **New User**: If `p_uid` does not exist, creates a new canonical_users record
- **Existing User**: Updates existing record, with `COALESCE` logic preserving existing values when new values are NULL

### Temporary Placeholder Replacement

The function includes special logic for email-first authentication:

1. User signs up with email → receives temporary `canonical_user_id` like `prize:pid:temp123`
2. User later connects wallet → function replaces temp ID with wallet-based ID `prize:pid:0xabcdef...`

**Replacement Conditions:**
- New `p_canonical_user_id` is wallet-based (`prize:pid:0x...`)
- OR existing ID is a placeholder (`prize:pid:temp...`) AND `p_wallet_address` is provided

### Wallet Address Normalization

All wallet addresses are normalized using `util.normalize_evm_address()` which:
- Converts addresses to lowercase
- Validates format
- Ensures consistency across the database

## Schema Note

This function is defined in the **`public`** schema and is the **only** client-facing `upsert_canonical_user` function.

**⚠️ Important:** Prior versions had a `util.upsert_canonical_user` helper function that caused search_path ambiguity. This has been renamed to `util.upsert_canonical_user_from_auth` to prevent conflicts.

## Frontend Integration

The function is called from multiple frontend locations:

- **`src/contexts/AuthContext.tsx`**: Main authentication flow
- **`src/components/NewAuthModal.tsx`**: Email-first signup
- **`src/components/BaseWalletAuthModal.tsx`**: Wallet connection and profile completion

All frontend calls pass `p_wallet_linked` as a boolean value.

## Testing

Test the function signature compatibility:
```bash
cd /home/runner/work/theprize.io/theprize.io
psql -f supabase/migrations/test_temp_user_placeholder.sql
```

The test suite includes:
- Temporary placeholder allocation
- User creation with placeholders
- Placeholder replacement on wallet connection
- Boolean parameter type validation

## Security

- **Security Level**: `SECURITY DEFINER` - runs with owner privileges
- **Search Path**: `SET search_path = public` - prevents schema injection
- **Access**: Callable by `anon` and `authenticated` users via RLS policies

## Related Functions

- **`allocate_temp_canonical_user()`**: Generates temporary placeholder IDs for email-first auth
- **`util.normalize_evm_address(text)`**: Normalizes wallet addresses to lowercase
- **`util.upsert_canonical_user_from_auth(...)`**: Internal helper for auth provider integration (formerly util.upsert_canonical_user)

## Migration History

1. **20260128054900**: Initial fix with BOOLEAN p_wallet_linked parameter
2. **20260201164500**: Added temp placeholder support, initially had TEXT parameter (bug)
3. **20260201170000**: Fixed parameter type to BOOLEAN and renamed util function to prevent collision
