# CDP React Hooks - Complete Reference

This directory contains comprehensive React hooks for the Coinbase Developer Platform (CDP) SDK, providing full access to embedded wallet functionality for Base and other EVM chains, as well as Solana.

## Quick Start

All CDP hooks are exported from a single entry point for convenience:

```tsx
import { 
  useCurrentUser,
  useEvmAccounts, 
  useSendEvmTransaction,
  useCreateSpendPermission 
} from '@/hooks/cdp';
```

## Hook Categories

### 🔐 Authentication (`useCDPAuth.ts`)

Hooks for user authentication via email, SMS, OAuth, and JWT.

#### Core Authentication

```tsx
import { useCurrentUser, useIsSignedIn, useSignOut } from '@/hooks/cdp';

function AuthComponent() {
  const { currentUser } = useCurrentUser();
  const { isSignedIn } = useIsSignedIn();
  const { signOut } = useSignOut();
  
  return (
    <div>
      {isSignedIn ? (
        <>
          <p>Welcome, {currentUser?.email}</p>
          <button onClick={signOut}>Sign Out</button>
        </>
      ) : (
        <p>Please sign in</p>
      )}
    </div>
  );
}
```

#### Email Authentication

```tsx
import { useSignInWithEmail, useVerifyEmailOTP } from '@/hooks/cdp';

function EmailSignIn() {
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  
  const handleSignIn = async (email: string) => {
    // Step 1: Request OTP
    await signInWithEmail({ email });
    
    // Step 2: User enters OTP from email
    const otp = prompt('Enter OTP from email:');
    
    // Step 3: Verify OTP
    await verifyEmailOTP({ email, otp });
  };
  
  return <button onClick={() => handleSignIn('user@example.com')}>Sign In</button>;
}
```

#### OAuth Authentication

```tsx
import { useSignInWithOAuth, useLinkGoogle, useLinkApple } from '@/hooks/cdp';

function OAuthSignIn() {
  const { signInWithOAuth } = useSignInWithOAuth();
  const { linkGoogle } = useLinkGoogle();
  const { linkApple } = useLinkApple();
  
  return (
    <div>
      <button onClick={() => signInWithOAuth({ provider: 'google' })}>
        Sign In with Google
      </button>
      <button onClick={() => signInWithOAuth({ provider: 'apple' })}>
        Sign In with Apple
      </button>
      
      {/* For linking additional accounts after sign-in */}
      <button onClick={linkGoogle}>Link Google Account</button>
      <button onClick={linkApple}>Link Apple Account</button>
    </div>
  );
}
```

**Available Hooks:**
- `useCurrentUser` - Get current user info
- `useIsSignedIn` - Check authentication status
- `useIsInitialized` - Check if CDP is ready
- `useSignOut` - Sign out the current user
- `useSignInWithEmail` / `useVerifyEmailOTP` - Email authentication
- `useSignInWithSms` / `useVerifySmsOTP` - SMS authentication
- `useSignInWithOAuth` - OAuth (Google, Apple)
- `useLinkEmail`, `useLinkSms`, `useLinkOAuth`, `useLinkApple`, `useLinkGoogle` - Link additional accounts
- `useAuthenticateWithJWT` - JWT-based auth
- `useGetAccessToken` - Get access token
- `useEnforceAuthenticated`, `useEnforceUnauthenticated` - Utility wrappers

### 💼 Wallet Management (`useCDPWallet.ts`)

Hooks for managing EVM, Solana, and Smart Accounts.

#### EVM Account Management

```tsx
import { useEvmAccounts, useEvmAddress, useEvmSmartAccounts } from '@/hooks/cdp';

function WalletInfo() {
  const { evmAccounts } = useEvmAccounts();
  const { evmAddress } = useEvmAddress();
  const { smartAccounts } = useEvmSmartAccounts();
  
  return (
    <div>
      <p>Primary Address: {evmAddress}</p>
      <p>Total Accounts: {evmAccounts.length}</p>
      <p>Smart Accounts: {smartAccounts.length}</p>
    </div>
  );
}
```

#### Account Creation

```tsx
import { useCreateEvmEoaAccount, useCreateEvmSmartAccount } from '@/hooks/cdp';

function CreateAccount() {
  const { createEvmEoaAccount } = useCreateEvmEoaAccount();
  const { createEvmSmartAccount } = useCreateEvmSmartAccount();
  
  const handleCreateEOA = async () => {
    const account = await createEvmEoaAccount();
    console.log('Created EOA:', account.address);
  };
  
  const handleCreateSmartAccount = async () => {
    const account = await createEvmSmartAccount({
      // Optional: specify owner account
    });
    console.log('Created Smart Account:', account.address);
  };
  
  return (
    <div>
      <button onClick={handleCreateEOA}>Create EOA</button>
      <button onClick={handleCreateSmartAccount}>Create Smart Account</button>
    </div>
  );
}
```

#### Solana Support

```tsx
import { useSolanaAccounts, useSolanaAddress, useCreateSolanaAccount } from '@/hooks/cdp';

function SolanaWallet() {
  const { solanaAccounts } = useSolanaAccounts();
  const { solanaAddress } = useSolanaAddress();
  const { createSolanaAccount } = useCreateSolanaAccount();
  
  return (
    <div>
      <p>Solana Address: {solanaAddress}</p>
      <button onClick={createSolanaAccount}>Create Solana Account</button>
    </div>
  );
}
```

**Available Hooks:**
- `useEvmAccounts`, `useEvmAddress`, `useEvmSmartAccounts` - EVM wallet info
- `useSolanaAccounts`, `useSolanaAddress` - Solana wallet info
- `useCreateEvmEoaAccount`, `useCreateEvmSmartAccount`, `useCreateSolanaAccount` - Create accounts
- `useExportEvmAccount`, `useExportSolanaAccount` - Export private keys
- `useEvmKeyExportIframe`, `useSolanaKeyExportIframe` - Secure key export UI

### 💸 Transactions (`useCDPTransactions.ts`)

Hooks for sending and signing transactions on EVM and Solana.

#### EVM Transactions

```tsx
import { useSendEvmTransaction, useSignEvmMessage, useSignEvmTypedData } from '@/hooks/cdp';

function TransactionComponent() {
  const { sendEvmTransaction, loading } = useSendEvmTransaction();
  const { signEvmMessage } = useSignEvmMessage();
  const { signEvmTypedData } = useSignEvmTypedData();
  
  const handleSendETH = async () => {
    const tx = await sendEvmTransaction({
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      value: '1000000000000000000', // 1 ETH in wei
    });
    console.log('Transaction hash:', tx.hash);
  };
  
  const handleSignMessage = async () => {
    const signature = await signEvmMessage({
      message: 'Hello, Base!',
    });
    console.log('Signature:', signature);
  };
  
  const handleSignTypedData = async () => {
    const signature = await signEvmTypedData({
      domain: {
        name: 'My DApp',
        version: '1',
        chainId: 8453,
      },
      types: {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      },
      message: {
        name: 'Alice',
        wallet: '0x...',
      },
    });
    console.log('Typed data signature:', signature);
  };
  
  return (
    <div>
      <button onClick={handleSendETH} disabled={loading}>Send ETH</button>
      <button onClick={handleSignMessage}>Sign Message</button>
      <button onClick={handleSignTypedData}>Sign Typed Data</button>
    </div>
  );
}
```

#### User Operations (ERC-4337)

```tsx
import { useSendUserOperation, useWaitForUserOperation } from '@/hooks/cdp';

function UserOpComponent() {
  const { sendUserOperation } = useSendUserOperation();
  const { waitForUserOperation } = useWaitForUserOperation();
  
  const handleSendUserOp = async () => {
    // Send a user operation (gasless transaction)
    const userOpHash = await sendUserOperation({
      // User operation params
    });
    
    // Wait for the operation to be included
    const receipt = await waitForUserOperation({ hash: userOpHash });
    console.log('User operation receipt:', receipt);
  };
  
  return <button onClick={handleSendUserOp}>Send User Operation</button>;
}
```

**Available Hooks:**
- `useSendEvmTransaction`, `useSignEvmTransaction`, `useSignEvmMessage` - EVM transactions
- `useSignEvmHash`, `useSignEvmTypedData` - EVM signing
- `useSendSolanaTransaction`, `useSignSolanaTransaction`, `useSignSolanaMessage` - Solana transactions
- `useSendUserOperation`, `useWaitForUserOperation` - ERC-4337 Account Abstraction

### 🎫 Spend Permissions (`useCDPSpendPermissions.ts`)

Hooks for enabling one-click, gasless payments via spend permissions.

#### Creating Spend Permissions

```tsx
import { useCreateSpendPermission, useListSpendPermissions } from '@/hooks/cdp';

function OneClickPayments() {
  const { createSpendPermission, loading } = useCreateSpendPermission();
  const { spendPermissions } = useListSpendPermissions();
  
  const handleEnablePayments = async () => {
    const treasuryAddress = '0x...'; // Your treasury/spender address
    const usdcAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'; // USDC on Base
    
    const permission = await createSpendPermission({
      spender: treasuryAddress,
      token: usdcAddress,
      allowance: '100000000', // 100 USDC (6 decimals)
      period: 2592000, // 30 days in seconds
      start: Math.floor(Date.now() / 1000),
      end: Math.floor(Date.now() / 1000) + 31536000, // 1 year
    });
    
    console.log('Spend permission created:', permission);
  };
  
  return (
    <div>
      <button onClick={handleEnablePayments} disabled={loading}>
        Enable One-Click Payments ($100/month)
      </button>
      <p>Active Permissions: {spendPermissions.length}</p>
    </div>
  );
}
```

#### Revoking Permissions

```tsx
import { useRevokeSpendPermission, useListSpendPermissions } from '@/hooks/cdp';

function ManagePermissions() {
  const { revokeSpendPermission } = useRevokeSpendPermission();
  const { spendPermissions } = useListSpendPermissions();
  
  const handleRevoke = async (permissionHash: string) => {
    await revokeSpendPermission({ permissionHash });
    console.log('Permission revoked');
  };
  
  return (
    <div>
      <h3>Your Spend Permissions</h3>
      {spendPermissions.map(permission => (
        <div key={permission.hash}>
          <p>Allowance: {permission.allowance} USDC</p>
          <button onClick={() => handleRevoke(permission.hash)}>Revoke</button>
        </div>
      ))}
    </div>
  );
}
```

**Available Hooks:**
- `useCreateSpendPermission` - Create a spend permission
- `useListSpendPermissions` - List active permissions
- `useRevokeSpendPermission` - Revoke a permission

### 🔒 Multi-Factor Authentication (`useCDPMFA.ts`)

Hooks for enabling and managing 2FA via TOTP authenticator apps.

#### MFA Enrollment

```tsx
import { useState, useEffect } from 'react';
import { useGetMfaConfig, useInitiateMfaEnrollment, useSubmitMfaEnrollment } from '@/hooks/cdp';

function MFASetup() {
  const { getMfaConfig, mfaConfig } = useGetMfaConfig();
  const { initiateMfaEnrollment, qrCode } = useInitiateMfaEnrollment();
  const { submitMfaEnrollment } = useSubmitMfaEnrollment();
  const [totpCode, setTotpCode] = useState('');
  
  useEffect(() => {
    getMfaConfig();
  }, []);
  
  const handleEnableMFA = async () => {
    // Step 1: Get QR code for authenticator app
    const result = await initiateMfaEnrollment();
    console.log('Scan this QR code:', result.qrCode);
    // Display QR code to user
  };
  
  const handleSubmitCode = async () => {
    // Step 2: User scans QR and enters code from authenticator
    await submitMfaEnrollment({ totpCode });
    console.log('MFA enabled successfully');
  };
  
  return (
    <div>
      {!mfaConfig?.enabled ? (
        <>
          <button onClick={handleEnableMFA}>Enable 2FA</button>
          {qrCode && (
            <div>
              <img src={qrCode} alt="QR Code" />
              <input 
                value={totpCode} 
                onChange={e => setTotpCode(e.target.value)}
                placeholder="Enter 6-digit code"
              />
              <button onClick={handleSubmitCode}>Verify</button>
            </div>
          )}
        </>
      ) : (
        <p>✓ 2FA is enabled</p>
      )}
    </div>
  );
}
```

#### MFA Verification (Login)

```tsx
import { useState } from 'react';
import { useInitiateMfaVerification, useSubmitMfaVerification } from '@/hooks/cdp';

function MFALogin() {
  const { initiateMfaVerification } = useInitiateMfaVerification();
  const { submitMfaVerification } = useSubmitMfaVerification();
  const [totpCode, setTotpCode] = useState('');
  
  const handleLogin = async () => {
    // After email/SMS login, if user has MFA enabled
    await initiateMfaVerification();
    
    // User enters code from authenticator app
    await submitMfaVerification({ totpCode });
    console.log('MFA verification successful');
  };
  
  return (
    <div>
      <input 
        value={totpCode}
        onChange={e => setTotpCode(e.target.value)}
        placeholder="Enter 6-digit code"
      />
      <button onClick={handleLogin}>Verify</button>
    </div>
  );
}
```

**Available Hooks:**
- `useGetMfaConfig` - Get MFA configuration
- `useInitiateMfaEnrollment`, `useSubmitMfaEnrollment` - Enable MFA
- `useInitiateMfaVerification`, `useSubmitMfaVerification` - Verify MFA on login
- `useRecordMfaEnrollmentPrompted` - Track enrollment prompts

### 🛠️ Utilities (`useCDPUtils.ts`)

Utility hooks for configuration and advanced features.

```tsx
import { useConfig, useX402 } from '@/hooks/cdp';

function ConfigInfo() {
  const { config } = useConfig();
  const { fetchWithX402 } = useX402();
  
  console.log('Project ID:', config.projectId);
  
  // Use X402 for pay-per-use API calls
  const handlePremiumFeature = async () => {
    const data = await fetchWithX402('/api/premium-data');
    console.log('Premium data:', data);
  };
  
  return (
    <div>
      <button onClick={handlePremiumFeature}>Access Premium Feature</button>
    </div>
  );
}
```

**Available Hooks:**
- `useConfig` - Access CDP configuration
- `useX402` - Pay-per-use API access

## Architecture Notes

### CDP Embedded Wallets

All these hooks integrate with CDP Embedded Wallets, which:
- Store user funds in wallets controlled by their email/passkey (not server wallets)
- Provide seamless onchain UX without seed phrases
- Support both EVM (Base, Ethereum) and Solana
- Enable gasless transactions via Smart Accounts
- Allow one-click payments via Spend Permissions

### Base Integration

These hooks are optimized for Base (Coinbase Layer 2):
- Default network is Base Mainnet (chain ID 8453) or Base Sepolia (84532)
- USDC is the primary token for payments
- Spend Permissions enable gasless USDC payments
- Smart Accounts provide account abstraction features

### Security Best Practices

1. **Always validate user input** before signing/sending transactions
2. **Use reasonable spend permission limits** (e.g., $100-500/month)
3. **Encourage MFA** for users with high-value accounts
4. **Never expose private keys** - use export hooks with caution
5. **Validate transaction recipients** to prevent phishing
6. **Set expiration dates** on spend permissions

## Migration Guide

If you're currently using CDP hooks directly, you can now import from the centralized location:

```tsx
// Before
import { useEvmAddress } from '@coinbase/cdp-hooks';

// After
import { useEvmAddress } from '@/hooks/cdp';
```

All hooks maintain the same API, so no code changes are needed beyond the import path.

## Documentation Links

- [CDP SDK Documentation](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/@coinbase/cdp-hooks)
- [Embedded Wallets Guide](https://docs.cdp.coinbase.com/embedded-wallets/react-hooks)
- [Base Documentation](https://docs.base.org/onchainkit/getting-started)
- [Spend Permissions Spec](https://github.com/base-org/spend-permissions)

## Support

For issues or questions:
- Check the [CDP Documentation](https://docs.cdp.coinbase.com/)
- Visit the [Base Discord](https://discord.gg/buildonbase)
- Review existing code in `src/hooks/useSpendPermission.ts` for advanced examples
