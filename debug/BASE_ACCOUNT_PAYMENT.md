# Base Account SDK Integration

This document describes the comprehensive Base Account SDK integration in The Prize application.

## Overview

The Prize application now uses a centralized Base Account SDK instance for all account management, payments, and wallet operations. The SDK provides:

- **Unified Account Management**: Single SDK instance for consistent behavior across the app
- **EIP-1193 Provider**: Compatible with viem, wagmi, and other Web3 libraries
- **Sub-Account Support**: Create and manage sub-accounts for passkey-free transactions
- **Spend Permissions**: Enable one-click payments without repeated wallet confirmations
- **Session Management**: Track and manage user authentication state

## Architecture

### Core Components

1. **SDK Initialization** (`src/lib/base-account-sdk.ts`)
   - Singleton SDK instance created with `createBaseAccountSDK`
   - Configured with app metadata (name, logo, supported chains)
   - Provides EIP-1193 provider for wallet interactions

2. **React Context** (`src/contexts/BaseAccountSDKContext.tsx`)
   - Provides SDK instance to all components via React Context
   - Tracks session state and account information
   - Handles provider lifecycle and events

3. **Payment Service** (`src/lib/base-account-payment.ts`)
   - Uses Base Account SDK for USDC payments
   - Integrates with existing transaction tracking system
   - Supports one-tap payments via `pay()` and `getPaymentStatus()`

4. **Hooks**
   - `useBaseAccountSDK`: Access SDK instance and provider
   - `useBaseSubAccount`: Manage sub-accounts for passkey-free transactions
   - `useSpendPermission`: Enable and manage spend permissions

## Configuration

### Environment Variables

```bash
# Base Account SDK Configuration
VITE_APP_NAME=The Prize - Win Big with Crypto
VITE_APP_LOGO_URL=https://theprize.io/logo.png

# Optional: Paymaster for gas sponsorship
VITE_PAYMASTER_URL=https://paymaster.example.com

# Treasury address for payments
VITE_TREASURY_ADDRESS=your_treasury_wallet_address_here

# Network selection
VITE_BASE_MAINNET=true  # true for mainnet, false for testnet
```

### Supported Networks

- **Mainnet**: Base (Chain ID: 8453)
- **Testnet**: Base Sepolia (Chain ID: 84532)

The SDK automatically selects the correct network based on `VITE_BASE_MAINNET`.

## Features

### 1. One-Tap USDC Payments

Users can pay for competition entries using USDC on Base without upfront wallet connection:

```typescript
import { BaseAccountPaymentService } from '@/lib/base-account-payment';

const result = await BaseAccountPaymentService.purchaseTickets({
  userId: user.id,
  competitionId: 'comp_123',
  ticketCount: 5,
  ticketPrice: 1.00,
  selectedTickets: [1, 2, 3, 4, 5],
  walletAddress: user.walletAddress,
  reservationId: 'res_456',
});
```

### 2. Sub-Accounts

Create derived accounts controlled by embedded wallets for passkey-free signing:

```typescript
import { useBaseSubAccount } from '@/hooks/useBaseSubAccount';

function MyComponent() {
  const { getOrCreateSubAccount, sendTransaction } = useBaseSubAccount();
  
  const handlePayment = async () => {
    const subAccount = await getOrCreateSubAccount();
    if (subAccount) {
      await sendTransaction({
        to: treasuryAddress,
        value: parseEther('0.1'),
      });
    }
  };
}
```

### 3. Spend Permissions

Enable one-click payments by granting pre-approved spending allowances:

```typescript
import { useSpendPermission } from '@/hooks/useSpendPermission';

function MyComponent() {
  const { requestPermission, hasPermission } = useSpendPermission();
  
  const enableOneClick = async () => {
    await requestPermission({
      allowanceUSD: 500,    // $500 per period
      periodInDays: 30,     // Monthly reset
      validityDays: 365,    // Valid for 1 year
    });
  };
}
```

### 4. Session Management

Track and display SDK session state:

```typescript
import { useBaseAccountSDK } from '@/contexts/BaseAccountSDKContext';

function MyComponent() {
  const { hasSession, account, refreshSession } = useBaseAccountSDK();
  
  return (
    <div>
      <p>Session: {hasSession ? 'Active' : 'Inactive'}</p>
      {account && <p>Address: {account.address}</p>}
      <button onClick={refreshSession}>Refresh</button>
    </div>
  );
}
```

## UI Components

### BaseAccountStatus

Displays SDK session information and account details:

```typescript
import BaseAccountStatus from '@/components/BaseAccountStatus';

<BaseAccountStatus compact={false} />
```

### SpendPermissionManager

Manage spend permissions with a user-friendly interface:

```typescript
import SpendPermissionManager from '@/components/SpendPermissionManager';

<SpendPermissionManager compact={false} />
```

## Payment Flow

1. **User Selection**: User selects competition tickets
2. **Transaction Creation**: System creates pending transaction record
3. **SDK Payment**: Base Account SDK opens payment popup
4. **User Approval**: User approves payment in popup
5. **Confirmation**: System receives payment result with transaction hash
6. **Ticket Assignment**: Backend confirms tickets and updates transaction
7. **Success**: User receives competition entries

All payments are tracked in `user_transactions` table with:
- `payment_provider`: 'base_account'
- `network`: 'base'
- `tx_id`: Blockchain transaction hash
- `status`: Payment status (pending, processing, completed, failed)

## Integration Points

## Integration Points

### Wagmi & Viem

The SDK provider is compatible with wagmi and viem:

```typescript
import { useBaseAccountSDK } from '@/contexts/BaseAccountSDKContext';
import { createWalletClient, custom } from 'viem';

function MyComponent() {
  const { provider } = useBaseAccountSDK();
  
  // Create viem wallet client from SDK provider
  const walletClient = createWalletClient({
    transport: custom(provider),
  });
}
```

### OnchainKit

OnchainKit components work seamlessly with the SDK provider:

```typescript
import { OnchainKitProvider } from '@coinbase/onchainkit';
import { useBaseAccountSDK } from '@/contexts/BaseAccountSDKContext';

// The app already wraps everything in OnchainKitProvider
// SDK provider is automatically used when available
```

## Testing

### Testnet Testing

1. Set `VITE_BASE_MAINNET=false`
2. Configure testnet treasury address
3. Use Base Sepolia testnet
4. Test payments with testnet USDC

### Manual Testing Checklist

- [ ] SDK initializes correctly on app load
- [ ] Session state is tracked and displayed
- [ ] Base Account status shows in wallet management
- [ ] Spend permissions can be granted and revoked
- [ ] One-click payments work after permission granted
- [ ] Sub-accounts can be created (if applicable)
- [ ] Payment popup opens and processes correctly
- [ ] Transactions are tracked in database
- [ ] Tickets are confirmed after successful payment
- [ ] Failed payments show appropriate errors
- [ ] Session refresh works correctly

## Security Considerations

- SDK provider is sandboxed and follows EIP-1193 standards
- Spend permissions use EIP-712 for secure signing
- Treasury address should be kept secure (environment variable)
- All payments validated server-side before confirmation
- Permissions stored locally can be revoked at any time
- Sub-accounts inherit security from parent account
- Transaction records include audit trail

## Troubleshooting

### SDK Not Initializing

1. Check `VITE_APP_NAME` and `VITE_APP_LOGO_URL` are set
2. Verify supported chains match `VITE_BASE_MAINNET` setting
3. Check browser console for initialization errors
4. Ensure `@base-org/account` package is installed

### Provider Not Available

1. Wait for SDK to be ready (`isReady` in context)
2. Check BaseAccountSDKProvider is in component tree
3. Verify wagmi and viem versions are compatible
4. Try refreshing the page

### Spend Permission Fails

1. Check wallet is connected and on correct network
2. Verify treasury address is configured
3. Ensure user hasn't rejected the signature request
4. Check browser console for EIP-712 signing errors

### Payment Not Processing

1. Verify `VITE_TREASURY_ADDRESS` is configured
2. Check network settings match `VITE_BASE_MAINNET`
3. Ensure user is authenticated
4. Check Supabase connection for transaction tracking
5. Review payment logs in browser console

## Documentation

- Base Account SDK: https://docs.base.org/base-account/reference/core/sdk-api
- Payment Guide: https://docs.base.org/base-account/guides/accept-payments
- Sub-Accounts: https://docs.base.org/base-account/improve-ux/sub-accounts
- Spend Permissions: https://docs.base.org/base-account/guides/spend-permissions
- EIP-1193 Provider: https://eips.ethereum.org/EIPS/eip-1193

## Support

For issues or questions:
1. Check this documentation
2. Review Base Account SDK documentation
3. Check transaction logs in Supabase
4. Review browser console for errors
5. Contact development team
