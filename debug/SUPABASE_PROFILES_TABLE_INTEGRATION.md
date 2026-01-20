# Supabase Profiles Table Integration Guide

This document provides specific instructions for integrating with the `profiles` table in Supabase to achieve perfect alignment with the user data architecture.

## Table Architecture Overview

The Prize platform uses a **dual-table architecture** for user data:

### 1. `canonical_users` Table (Primary/Authoritative)
- **Purpose**: Single source of truth for all user data
- **Primary Key**: `id` (UUID)
- **Identifier**: `canonical_user_id` (prize:pid: format)
- **Contains**:
  - Authentication data: `username`, `email`, `wallet_address`, `privy_user_id`
  - Profile data: `first_name`, `last_name`, `country`, `telegram_handle`, `avatar_url`
  - Balance data: `usdc_balance`
  - Account status: `is_active`, `deactivated_at`, `deactivation_reason`

### 2. `profiles` Table (Secondary/User-Editable)
- **Purpose**: Staging area for user profile updates with separate update tracking
- **Primary Key**: `id` (UUID)
- **Foreign Key**: `user_id` references `canonical_users.id`
- **Contains**:
  - `wallet_address`: Linked wallet (lowercase normalized)
  - `updated_at`: Timestamp of last update

## Why Use the Profiles Table?

The `profiles` table serves several critical purposes:

1. **Separation of Concerns**: Keeps user-editable profile data separate from system-managed authentication data
2. **Update Tracking**: Provides independent `updated_at` tracking for profile changes
3. **Async Processing**: Allows profile updates to be staged and processed asynchronously
4. **User Feedback**: Enables instant UI feedback ("changes reflected in 1-2 minutes") while background sync occurs
5. **Audit Trail**: Maintains a clear record of when users last updated their profile information

## Integration Instructions

### Creating/Updating a Profile Entry

When a user connects a wallet or updates their profile, create/update the profiles table:

```typescript
import { supabase } from '../lib/supabase';

async function upsertUserProfile(canonicalUserUUID: string, walletAddress: string) {
  const normalizedWallet = walletAddress.toLowerCase();

  // Check if profile already exists
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', canonicalUserUUID)
    .maybeSingle();

  // Use existing profile id or generate a new UUID
  const profileId = existingProfile?.id || crypto.randomUUID();

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: profileId,
      user_id: canonicalUserUUID,
      wallet_address: normalizedWallet,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'id'
    });

  if (profileError) {
    console.warn('[Profile] Upsert error (non-fatal):', profileError);
    return false;
  }

  return true;
}
```

### Updating Profile via RPC (Recommended)

For profile field updates, use the RPC function to bypass RLS:

```typescript
import { supabase } from '../lib/supabase';
import { toPrizePid } from '../utils/userId';

async function updateUserProfile(userId: string, profile: {
  username?: string;
  email?: string;
  telegram_handle?: string;
  country?: string;
  telephone_number?: string;
}) {
  const canonicalId = toPrizePid(userId);

  const { data, error } = await supabase.rpc('update_user_profile_by_identifier', {
    user_identifier: canonicalId,
    new_username: profile.username ?? null,
    new_email: profile.email ?? null,
    new_telegram_handle: profile.telegram_handle ?? null,
    new_country: profile.country ?? null,
    new_telephone_number: profile.telephone_number ?? null,
  });

  if (error) {
    console.error('[Profile] Update failed:', error);
    return false;
  }

  return data?.success ?? false;
}
```

### Reading Profile Data

To fetch a user's profile, query `canonical_users` with optional join to `profiles`:

```typescript
import { supabase } from '../lib/supabase';

async function getUserProfile(canonicalUserId: string) {
  const { data, error } = await supabase
    .from('canonical_users')
    .select(`
      id,
      canonical_user_id,
      username,
      email,
      wallet_address,
      first_name,
      last_name,
      country,
      telegram_handle,
      avatar_url,
      profiles (
        id,
        updated_at
      )
    `)
    .eq('canonical_user_id', canonicalUserId)
    .single();

  if (error) {
    console.error('[Profile] Fetch error:', error);
    return null;
  }

  return data;
}
```

## User Identifier Formats

The system supports multiple identifier formats, all converted to canonical `prize:pid:` format:

| Format | Example | Conversion |
|--------|---------|------------|
| Wallet Address | `0x1234...abcd` | `toPrizePid('0x1234...abcd')` → `prize:pid:0x1234...abcd` |
| Canonical ID | `prize:pid:xyz` | Already canonical |
| Legacy Privy DID | `did:privy:abc` | `toPrizePid('did:privy:abc')` → `prize:pid:did:privy:abc` |

Always use `toPrizePid()` from `src/utils/userId.ts` to normalize identifiers before database operations.

## RLS (Row Level Security) Considerations

The `profiles` table uses RLS policies that restrict direct access. Use these approaches:

1. **For reads**: Query through `canonical_users` with profile join
2. **For writes**: Use RPC functions (`update_user_profile_by_identifier`, `update_user_avatar`)
3. **For auth flows**: Use service role key in Edge Functions

## Profile Update Success Flow

After a successful profile update, display the `ProfileUpdateSuccessModal`:

```typescript
import ProfileUpdateSuccessModal from '../components/ProfileUpdateSuccessModal';

function AccountSettings() {
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const handleProfileUpdate = async (data) => {
    const success = await updateUserProfile(userId, data);

    if (success) {
      // Show success modal with live competitions carousel
      setShowSuccessModal(true);
    }
  };

  return (
    <>
      {/* Your form here */}

      <ProfileUpdateSuccessModal
        isOpen={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        username={profile.username}
      />
    </>
  );
}
```

The modal displays:
- Success confirmation message
- "Changes reflected in 1-2 minutes" note
- Side-scrolling carousel of live competitions
- Link to browse all competitions

## Real-time Subscriptions

Subscribe to profile changes for live updates:

```typescript
import { supabase } from '../lib/supabase';

function subscribeToProfileChanges(canonicalUserId: string, onUpdate: () => void) {
  const channel = supabase
    .channel(`user-profile-${canonicalUserId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'canonical_users',
        filter: `canonical_user_id=eq.${canonicalUserId}`
      },
      () => onUpdate()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
```

## Best Practices

1. **Always normalize wallet addresses**: Convert to lowercase before storage
2. **Use canonical IDs**: Convert all identifiers to `prize:pid:` format
3. **Handle RLS gracefully**: Use RPC functions for write operations
4. **Show immediate feedback**: Update UI optimistically, then confirm
5. **Track updates**: Always update `updated_at` in profiles table
6. **Cache avatars**: Use `userDataService.cacheAvatarUrl()` to prevent visual swapping

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| `permission denied for table profiles` | RLS blocking direct insert | Use RPC function instead |
| `duplicate key value violates unique constraint` | Profile already exists | Use upsert with `onConflict` |
| `foreign key constraint violation` | canonical_users record missing | Create canonical_users first |
| `column does not exist` | Schema mismatch | Check migration status |

## Migration Notes

If deploying to a new environment, ensure these migrations are applied:

1. `canonical_users` table creation with all profile columns
2. `profiles` table with `user_id` foreign key
3. RPC functions: `update_user_profile_by_identifier`, `update_user_avatar`
4. Appropriate RLS policies for both tables

## Support

For issues with the Supabase integration:
1. Check the browser console for detailed error messages
2. Verify the RPC functions exist in your Supabase project
3. Confirm RLS policies are correctly configured
4. Test with the Supabase Dashboard SQL editor
