# Migration Guide: Using the New CDP & Base Hooks

This guide helps developers migrate from direct SDK imports to the new centralized hooks system.

## What Changed?

We've added comprehensive React hooks for:
1. **CDP Embedded Wallets** - All @coinbase/cdp-hooks are now available via centralized exports
2. **Base Account SDK** - Enhanced Base SDK integration with dedicated hooks
3. **Unified Import System** - Import all hooks from `@/hooks` or `@/hooks/cdp`

## Benefits

- ✅ Single import location for all hooks
- ✅ Better TypeScript support with re-exported types
- ✅ Comprehensive documentation and examples
- ✅ Easier to discover available functionality
- ✅ Consistent API patterns across the application

## Migration Examples

### Authentication Hooks

**Before:**
```tsx
import { useCurrentUser, useIsSignedIn, useSignOut } from '@coinbase/cdp-hooks';
```

**After:**
```tsx
// Option 1: Import from cdp module
import { useCurrentUser, useIsSignedIn, useSignOut } from '@/hooks/cdp';

// Option 2: Import from main hooks index
import { useCurrentUser, useIsSignedIn, useSignOut } from '@/hooks';
```

### Wallet Management Hooks

**New functionality now available:**
```tsx
// Previously not easily accessible, now centralized
import { 
  useEvmAccounts,
  useEvmSmartAccounts,
  useSolanaAccounts,
  useCreateEvmSmartAccount,
  useExportEvmAccount
} from '@/hooks/cdp';

function WalletManager() {
  const { evmAccounts } = useEvmAccounts();
  const { smartAccounts } = useEvmSmartAccounts();
  const { createEvmSmartAccount } = useCreateEvmSmartAccount();
  
  // Now easily accessible!
}
```

### Transaction Hooks

**New hooks for signing and sending:**
```tsx
import { 
  useSendEvmTransaction,
  useSignEvmMessage,
  useSignEvmTypedData,
  useSendUserOperation,
  useWaitForUserOperation
} from '@/hooks/cdp';

function TransactionComponent() {
  const { sendEvmTransaction } = useSendEvmTransaction();
  const { signEvmTypedData } = useSignEvmTypedData();
  const { sendUserOperation } = useSendUserOperation();
  
  // ERC-4337 user operations now supported!
}
```

### Spend Permissions

**Enhanced spend permission hooks:**
```tsx
// CDP native hooks now available
import { 
  useCreateSpendPermission,
  useListSpendPermissions,
  useRevokeSpendPermission
} from '@/hooks/cdp';

// Or use the enhanced custom implementation
import { useSpendPermission } from '@/hooks';

function PaymentSetup() {
  // CDP native approach
  const { createSpendPermission } = useCreateSpendPermission();
  
  // Or enhanced custom approach with more features
  const { 
    requestPermission, 
    activePermission, 
    canSpend 
  } = useSpendPermission();
}
```

### Multi-Factor Authentication

**New MFA hooks:**
```tsx
import { 
  useGetMfaConfig,
  useInitiateMfaEnrollment,
  useSubmitMfaEnrollment,
  useInitiateMfaVerification,
  useSubmitMfaVerification
} from '@/hooks/cdp';

function MFASetup() {
  const { mfaConfig } = useGetMfaConfig();
  const { initiateMfaEnrollment, qrCode } = useInitiateMfaEnrollment();
  const { submitMfaEnrollment } = useSubmitMfaEnrollment();
  
  // Now you can add 2FA to your app!
}
```

### Base SDK Integration

**New Base SDK hooks:**
```tsx
import { 
  useBaseAccountSDK,
  useBaseProvider,
  useBaseSession,
  useBaseSubAccount,
  useBasePayments
} from '@/hooks';

function BaseIntegration() {
  // Access the SDK directly
  const { sdk, isReady } = useBaseAccountSDK();
  
  // Get the EIP-1193 provider
  const { provider } = useBaseProvider();
  
  // Check session state
  const { hasSession, account } = useBaseSession();
  
  // Create sub-accounts
  const { createSubAccount } = useBaseSubAccount();
  
  // Send payments
  const { pay } = useBasePayments();
}
```

## Update Your Existing Code

### Step 1: Update Authentication Components

Files to update:
- `src/contexts/AuthContext.tsx` ✅ Already using CDP hooks correctly
- `src/components/WalletManagement/SendTransaction.tsx` ✅ Already correct
- `src/components/WalletManagement/ExportWalletKey.tsx` ✅ Already correct

No changes needed for these files - they're already using the hooks correctly!

### Step 2: Consider New Features

Look for opportunities to use the new hooks:

**Add OAuth Login:**
```tsx
import { useSignInWithOAuth, useLinkGoogle, useLinkApple } from '@/hooks/cdp';

function AuthModal() {
  const { signInWithOAuth } = useSignInWithOAuth();
  
  return (
    <>
      <button onClick={() => signInWithOAuth({ provider: 'google' })}>
        Sign In with Google
      </button>
      <button onClick={() => signInWithOAuth({ provider: 'apple' })}>
        Sign In with Apple
      </button>
    </>
  );
}
```

**Add MFA for Enhanced Security:**
```tsx
import { useEffect } from 'react';
import { useGetMfaConfig, useInitiateMfaEnrollment } from '@/hooks/cdp';

function SecuritySettings() {
  const { mfaConfig, getMfaConfig } = useGetMfaConfig();
  const { initiateMfaEnrollment } = useInitiateMfaEnrollment();
  
  useEffect(() => {
    getMfaConfig();
  }, []);
  
  return (
    <div>
      {!mfaConfig?.enabled && (
        <button onClick={initiateMfaEnrollment}>Enable 2FA</button>
      )}
    </div>
  );
}
```

**Use Smart Accounts:**
```tsx
import { useCreateEvmSmartAccount, useEvmSmartAccounts } from '@/hooks/cdp';

function SmartWallet() {
  const { createEvmSmartAccount } = useCreateEvmSmartAccount();
  const { smartAccounts } = useEvmSmartAccounts();
  
  return (
    <div>
      <button onClick={createEvmSmartAccount}>Create Smart Account</button>
      <p>Smart Accounts: {smartAccounts.length}</p>
    </div>
  );
}
```

**Use User Operations (ERC-4337):**
```tsx
import { useSendUserOperation, useWaitForUserOperation } from '@/hooks/cdp';

function GaslessTransaction() {
  const { sendUserOperation } = useSendUserOperation();
  const { waitForUserOperation } = useWaitForUserOperation();
  
  const handleGaslessPayment = async () => {
    // Send operation (gasless if paymaster configured)
    const userOpHash = await sendUserOperation({
      // operation params
    });
    
    // Wait for confirmation
    const receipt = await waitForUserOperation({ hash: userOpHash });
  };
  
  return <button onClick={handleGaslessPayment}>Send Gasless</button>;
}
```

### Step 3: Use the Comprehensive Index

Update your imports to use the main hooks index:

```tsx
// Instead of multiple imports from different files
import { useAuthUser } from '@/contexts/AuthContext';
import { useSpendPermission } from '@/hooks/useSpendPermission';
import { useRealTimeBalance } from '@/hooks/useRealTimeBalance';

// Use a single import
import { 
  useAuthUser, 
  useSpendPermission, 
  useRealTimeBalance 
} from '@/hooks';
```

## New Capabilities Unlocked

### 1. Solana Support
```tsx
import { 
  useSolanaAccounts,
  useSolanaAddress,
  useCreateSolanaAccount,
  useSendSolanaTransaction
} from '@/hooks/cdp';
```

### 2. Account Linking
```tsx
import { 
  useLinkEmail,
  useLinkSms,
  useLinkGoogle,
  useLinkApple
} from '@/hooks/cdp';

// Allow users to link multiple authentication methods
```

### 3. Advanced Signing
```tsx
import { 
  useSignEvmTypedData,
  useSignEvmHash,
  useSignEvmMessage
} from '@/hooks/cdp';

// Sign EIP-712 typed data, raw hashes, and messages
```

### 4. Key Export
```tsx
import { 
  useExportEvmAccount,
  useExportSolanaAccount,
  useEvmKeyExportIframe,
  useSolanaKeyExportIframe
} from '@/hooks/cdp';

// Allow users to export their keys (with proper security UI)
```

## Documentation

All hooks are fully documented:
- **CDP Hooks:** See `src/hooks/CDP_HOOKS_README.md` for comprehensive examples
- **Hook Files:** Each hook file has JSDoc comments with usage examples
- **Types:** All TypeScript types are re-exported for convenience

## Testing

After migration, test:
1. Authentication flows (email, OAuth)
2. Wallet operations (balance checks, transactions)
3. Spend permissions (if using them)
4. Any new features you've added

## Need Help?

- Check `CDP_HOOKS_README.md` for detailed examples
- Review the JSDoc comments in hook files
- Look at existing usage in the codebase
- Refer to [CDP Documentation](https://docs.cdp.coinbase.com/)

## Summary

✅ All CDP hooks are now available via `@/hooks/cdp`  
✅ Base SDK hooks available via `@/hooks`  
✅ Comprehensive types and documentation  
✅ Backwards compatible - no breaking changes  
✅ New capabilities: OAuth, MFA, Solana, Smart Accounts, User Operations  

Start using the new hooks today to take full advantage of CDP and Base SDK features!
