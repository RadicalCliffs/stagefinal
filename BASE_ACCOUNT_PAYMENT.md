# Base Account Payment Integration

This document describes the Base Account payment integration in The Prize application.

## Overview

Base Account payments enable users to pay for competition entries using USDC on the Base network with a seamless one-tap experience. The integration uses the `@base-org/account` SDK to provide payments without requiring upfront wallet connection.

## Features

- **One-Tap Payments**: Users can pay with USDC on Base without needing to connect their wallet first
- **Seamless UX**: The Base Account SDK opens a payment popup for easy transaction approval
- **Automatic Conversion**: Works with Base network's native USDC
- **Transaction Tracking**: All payments are tracked in the `user_transactions` table with `payment_provider='base_account'`

## Configuration

### Environment Variables

The following environment variables must be configured:

```bash
# Treasury address that receives payments
VITE_TREASURY_ADDRESS=your_treasury_wallet_address_here

# Network selection (true for mainnet, false/omit for testnet)
VITE_BASE_MAINNET=true

# Supabase configuration (for transaction tracking)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Network Configuration

The payment service automatically selects the correct network based on `VITE_BASE_MAINNET`:
- **Mainnet**: When `VITE_BASE_MAINNET=true`, uses Base Mainnet
- **Testnet**: Otherwise, uses Base Sepolia testnet

## Architecture

### Components

1. **BaseAccountPaymentService** (`src/lib/base-account-payment.ts`)
   - Core payment processing service
   - Handles transaction creation, payment execution, and ticket confirmation
   - Uses Base Account SDK's `pay()` and `getPaymentStatus()` functions

2. **BasePayButton** (`src/components/BasePayButton.tsx`)
   - Reusable button component with Base branding
   - Shows loading states and handles click events
   - Can be used standalone for any Base Account payment

3. **PaymentModal Integration** (`src/components/PaymentModal.tsx`)
   - Integrated as a payment option alongside wallet and balance payments
   - Shows as "Pay with Base" with one-tap badge
   - Includes processing state UI with Base branding

### Payment Flow

1. **User Selection**: User selects tickets and clicks "Pay with Base" button
2. **Transaction Creation**: System creates a pending transaction record in database
3. **Payment Initiation**: Base Account SDK's `pay()` function is called, opening payment popup
4. **User Approval**: User approves payment in the Base Account popup
5. **Payment Confirmation**: System receives payment result with transaction hash
6. **Ticket Confirmation**: Backend confirms tickets and updates transaction status
7. **Success**: User receives their competition entries

### Transaction Tracking

All Base Account payments are tracked in the `user_transactions` table with:
- `payment_provider`: Set to `'base_account'`
- `network`: Set to `'base'`
- `tx_id`: Contains the blockchain transaction hash from Base Account
- `status`: Tracks payment status (`pending`, `processing`, `completed`, `failed`)

## Usage

### For Users

1. Select competition tickets
2. Click "Pay with Base" button in the payment modal
3. Approve the payment in the Base popup
4. Wait for confirmation
5. Receive competition entries

### For Developers

To add Base Account payments to a new component:

```typescript
import { BaseAccountPaymentService } from '../lib/base-account-payment';

// Process a payment
const result = await BaseAccountPaymentService.purchaseTickets({
  userId: user.id,
  competitionId: 'comp_123',
  ticketCount: 5,
  ticketPrice: 1.00,
  selectedTickets: [1, 2, 3, 4, 5],
  walletAddress: user.walletAddress, // optional
  reservationId: 'res_456', // optional
});

if (result.success) {
  console.log('Payment successful!', result.transactionHash);
} else {
  console.error('Payment failed:', result.error);
}
```

## Testing

### Testnet Testing

1. Set `VITE_BASE_MAINNET=false` or omit it
2. Ensure treasury address is set to a valid testnet address
3. Use Base Sepolia testnet for testing
4. Test payments will use testnet USDC

### Manual Testing Checklist

- [ ] Payment button appears in payment modal
- [ ] Click triggers Base Account popup
- [ ] Payment can be approved in popup
- [ ] Transaction is tracked in database
- [ ] Tickets are confirmed after successful payment
- [ ] Failed payments show appropriate error messages
- [ ] Payment status is correctly reflected in UI

## Security Considerations

- Treasury address should be securely managed and not hardcoded
- All payments are validated server-side before ticket confirmation
- Transaction records include detailed notes for audit purposes
- Payment provider is explicitly set to prevent confusion with other payment methods

## Troubleshooting

### Payment Not Processing

1. Check that `VITE_TREASURY_ADDRESS` is configured
2. Verify network settings (`VITE_BASE_MAINNET`)
3. Ensure user is authenticated
4. Check browser console for errors
5. Verify Supabase connection for transaction tracking

### Transaction Not Confirming

1. Check `user_transactions` table for transaction record
2. Verify payment status in transaction record
3. Check ticket confirmation logs
4. Ensure reservation hasn't expired (if using reservations)

### Base Account Popup Not Appearing

1. Ensure `@base-org/account` package is installed
2. Check browser console for SDK errors
3. Verify no popup blockers are interfering
4. Try in an incognito/private browsing window

## Documentation

- Base Account SDK: https://docs.base.org/base-account/guides/accept-payments
- Base Documentation: https://docs.base.org
- USDC on Base: https://www.base.org/ecosystem?tag=stablecoin

## Support

For issues or questions about Base Account payments:
1. Check this documentation
2. Review Base Account SDK documentation
3. Check transaction logs in Supabase
4. Contact development team
