# Base Account SDK - Developer Onboarding Guide

This guide helps developers understand and work with the Base Account SDK integration in The Prize application.

## Quick Start

The application uses a centralized Base Account SDK instance for all wallet operations, payments, and account management. The SDK is initialized at application bootstrap and made available throughout the component tree via React Context.

### Key Concepts

1. **Singleton SDK Instance**: One SDK instance shared across the entire app
2. **EIP-1193 Provider**: Compatible with viem, wagmi, and other Web3 libraries
3. **React Context**: SDK accessible via `useBaseAccountSDK()` hook
4. **Session Management**: Automatic tracking of authentication state
5. **Sub-Accounts**: Optional derived accounts for passkey-free transactions
6. **Spend Permissions**: One-click payments without repeated confirmations

## Architecture Overview

```
main.tsx (App Bootstrap)
├── BaseAccountSDKProvider (Initializes SDK)
│   ├── SDK Instance (Singleton)
│   ├── EIP-1193 Provider
│   └── Session State
├── AuthProvider (User Authentication)
│   └── Links to SDK session
└── Components
    ├── useBaseAccountSDK() → Access SDK
    ├── useBaseSubAccount() → Manage sub-accounts
    └── useSpendPermission() → Manage spend permissions
```

## File Structure

### Core SDK Files

- **`src/lib/base-account-sdk.ts`**: SDK initialization and singleton instance
- **`src/contexts/BaseAccountSDKContext.tsx`**: React Context for SDK access
- **`src/lib/base-account-payment.ts`**: Payment service using SDK

### Hooks

- **`src/hooks/useBaseSubAccount.ts`**: Sub-account management
- **`src/hooks/useSpendPermission.ts`**: Spend permission management
- **`src/hooks/useGetPaymentStatus.ts`**: Payment status tracking

### UI Components

- **`src/components/BaseAccountStatus.tsx`**: Display SDK session info
- **`src/components/SpendPermissionManager.tsx`**: Manage spend permissions
- **`src/components/BasePayButton.tsx`**: Payment button component
- **`src/components/PaymentModal.tsx`**: Payment modal with SDK integration

## Common Tasks

### 1. Access the SDK

```typescript
import { useBaseAccountSDK } from '@/contexts/BaseAccountSDKContext';

function MyComponent() {
  const { sdk, provider, hasSession, account } = useBaseAccountSDK();
  
  // SDK is ready to use
  if (hasSession && account) {
    console.log('Connected:', account.address);
  }
}
```

### 2. Process a Payment

```typescript
import { BaseAccountPaymentService } from '@/lib/base-account-payment';

async function handlePayment() {
  const result = await BaseAccountPaymentService.purchaseTickets({
    userId: user.id,
    competitionId: competitionId,
    ticketCount: 5,
    ticketPrice: 1.00,
    selectedTickets: [1, 2, 3, 4, 5],
  });
  
  if (result.success) {
    console.log('Payment completed:', result.transactionHash);
  } else {
    console.error('Payment failed:', result.error);
  }
}
```

### 3. Create a Sub-Account

```typescript
import { useBaseSubAccount } from '@/hooks/useBaseSubAccount';

function MyComponent() {
  const { getOrCreateSubAccount, sendTransaction } = useBaseSubAccount();
  
  async function handleCreateSubAccount() {
    const subAccount = await getOrCreateSubAccount();
    if (subAccount) {
      console.log('Sub-account created:', subAccount.address);
    }
  }
}
```

### 4. Enable One-Click Payments

```typescript
import { useSpendPermission } from '@/hooks/useSpendPermission';

function MyComponent() {
  const { requestPermission, hasPermission } = useSpendPermission();
  
  async function handleEnableOneClick() {
    const permission = await requestPermission({
      allowanceUSD: 500,    // $500 per period
      periodInDays: 30,     // Monthly reset
      validityDays: 365,    // Valid for 1 year
    });
    
    if (permission) {
      console.log('One-click payments enabled!');
    }
  }
}
```

### 5. Use SDK Provider with Viem

```typescript
import { useBaseAccountSDK } from '@/contexts/BaseAccountSDKContext';
import { createWalletClient, custom } from 'viem';
import { base } from 'viem/chains';

function MyComponent() {
  const { provider } = useBaseAccountSDK();
  
  const walletClient = createWalletClient({
    chain: base,
    transport: custom(provider),
  });
  
  // Use walletClient for signing, transactions, etc.
}
```

## Best Practices

### 1. Always Check SDK Ready State

```typescript
const { sdk, isReady, error } = useBaseAccountSDK();

if (!isReady) {
  return <div>Loading SDK...</div>;
}

if (error) {
  return <div>SDK Error: {error.message}</div>;
}

// SDK is ready to use
```

### 2. Prefer SDK Provider Over Direct Access

```typescript
// ✅ Good: Use SDK provider
const { provider } = useBaseAccountSDK();
const signature = await provider.request({
  method: 'personal_sign',
  params: [message, address],
});

// ❌ Avoid: Direct window.ethereum access
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: [message, address],
});
```

### 3. Handle Provider Errors Gracefully

```typescript
const { provider } = useBaseAccountSDK();

try {
  const result = await provider.request({
    method: 'eth_sendTransaction',
    params: [transaction],
  });
} catch (error) {
  if (error.code === 4001) {
    // User rejected request
    console.log('User cancelled transaction');
  } else {
    // Other error
    console.error('Transaction failed:', error);
  }
}
```

### 4. Use Hooks for State Management

```typescript
// ✅ Good: Use the hook
const { hasPermission, requestPermission } = useSpendPermission();

// ❌ Avoid: Manual state management
const [hasPermission, setHasPermission] = useState(false);
// ... manual permission logic
```

### 5. Refresh Session After Changes

```typescript
const { refreshSession } = useBaseAccountSDK();

async function handleImportantAction() {
  // Perform action
  await doSomething();
  
  // Refresh session to get updated state
  await refreshSession();
}
```

## Configuration

### Environment Variables

```bash
# Required
VITE_APP_NAME=The Prize - Win Big with Crypto
VITE_APP_LOGO_URL=https://theprize.io/logo.png
VITE_TREASURY_ADDRESS=0x...
VITE_BASE_MAINNET=true

# Optional
VITE_PAYMASTER_URL=https://paymaster.example.com
```

### SDK Configuration

Edit `src/lib/base-account-sdk.ts` to modify SDK settings:

```typescript
const sdkConfig = {
  appName: getAppName(),
  appLogoUrl: getAppLogoUrl(),
  appChainIds: getSupportedChainIds(),
  subAccounts: {
    creation: 'manual',        // 'manual' or 'on-connect'
    defaultAccount: 'universal', // 'universal' or 'sub'
    funding: 'spend-permissions',
  },
  paymasterUrls: getPaymasterUrls(),
};
```

## Debugging

### Enable SDK Logging

The SDK logs are already enabled. Check browser console for messages prefixed with `[BaseAccountSDK]`, `[BaseAccountSDKProvider]`, or `[useSpendPermission]`.

### Common Issues

**Issue**: SDK not initializing
**Solution**: 
- Check environment variables are set
- Verify `BaseAccountSDKProvider` is in component tree
- Look for errors in browser console

**Issue**: Provider not available
**Solution**:
- Wait for `isReady` to be true
- Check `useBaseAccountSDK()` is called within `BaseAccountSDKProvider`
- Verify no errors in SDK initialization

**Issue**: Payments failing
**Solution**:
- Verify `VITE_TREASURY_ADDRESS` is configured
- Check network matches `VITE_BASE_MAINNET` setting
- Ensure user has sufficient USDC balance
- Review transaction logs in Supabase

## Testing

### Unit Tests

```typescript
import { renderHook } from '@testing-library/react';
import { BaseAccountSDKProvider } from '@/contexts/BaseAccountSDKContext';
import { useBaseAccountSDK } from '@/contexts/BaseAccountSDKContext';

test('SDK initializes correctly', () => {
  const { result } = renderHook(() => useBaseAccountSDK(), {
    wrapper: BaseAccountSDKProvider,
  });
  
  expect(result.current.sdk).toBeDefined();
});
```

### Integration Tests

See `BASE_ACCOUNT_PAYMENT.md` for manual testing checklist.

## Migration Guide

### From Direct SDK Calls to Context

**Before:**
```typescript
import { pay, getPaymentStatus } from '@base-org/account/payment/browser';

const result = await pay(options);
```

**After:**
```typescript
import { BaseAccountPaymentService } from '@/lib/base-account-payment';

const result = await BaseAccountPaymentService.processPayment(transactionId, amount);
```

### From Window.ethereum to SDK Provider

**Before:**
```typescript
const accounts = await window.ethereum.request({
  method: 'eth_requestAccounts',
});
```

**After:**
```typescript
const { provider } = useBaseAccountSDK();
const accounts = await provider.request({
  method: 'eth_requestAccounts',
});
```

## Resources

- **Base Account SDK Docs**: https://docs.base.org/base-account/reference/core/sdk-api
- **EIP-1193 Spec**: https://eips.ethereum.org/EIPS/eip-1193
- **Viem Integration**: https://viem.sh/docs/clients/custom
- **Spend Permissions**: https://docs.base.org/base-account/guides/spend-permissions
- **Sub-Accounts**: https://docs.base.org/base-account/improve-ux/sub-accounts

## Support

For questions or issues:
1. Check this guide
2. Review `BASE_ACCOUNT_PAYMENT.md`
3. Check Base Account SDK documentation
4. Search existing issues in GitHub
5. Contact the development team

## Contributing

When adding new SDK functionality:
1. Add hooks in `src/hooks/`
2. Add UI components in `src/components/`
3. Update this guide with examples
4. Add tests for new features
5. Update `BASE_ACCOUNT_PAYMENT.md` if needed
