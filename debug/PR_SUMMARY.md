# Payment Processes Documentation - PR Summary

## 🎯 Objective Achieved

Provided a **complete list of exact JSON payloads** for all key payment processes, particularly `purchase-tickets-with-bonus` and all other payment-related functions, enabling precise Supabase alignment.

## 📦 Deliverables

### Three Comprehensive Documentation Files

1. **PAYMENT_PROCESSES_JSON_PAYLOADS.md** (1,251 lines)
   - Complete JSON request/response payloads for 8 payment functions
   - Exact database table schemas with field types and constraints
   - Webhook payload structures with security verification details
   - Critical RPC function specifications
   - Testing examples with curl commands

2. **PAYMENT_QUICK_REFERENCE.md** (341 lines)
   - Payment function comparison table
   - Three payment flow diagrams
   - Database tables overview
   - User identity system explanation
   - Quick reference for common use cases

3. **PAYMENT_DOCUMENTATION_README.md** (206 lines)
   - Navigation guide for all documentation
   - Integration checklist for Supabase alignment
   - Use case recommendations
   - Troubleshooting guide

**Total:** 1,798 lines of comprehensive documentation

## 🔑 Payment Functions Documented

1. ✅ **purchase-tickets-with-bonus** - Core balance-based ticket purchase
2. ✅ **process-balance-payments** - Background transaction processor
3. ✅ **reserve-tickets** - 15-minute ticket reservation
4. ✅ **confirm-pending-tickets** - Payment confirmation handler
5. ✅ **create-charge** - Coinbase Commerce charge creation
6. ✅ **commerce-webhook** - Coinbase Commerce webhook receiver
7. ✅ **onramp-init** - Coinbase Onramp session initialization
8. ✅ **onramp-webhook** - Coinbase Onramp webhook receiver

## 📊 Database Tables Documented

- `user_transactions` - Payment tracking
- `sub_account_balances` - USD balance storage (atomic RPCs)
- `pending_tickets` - Ticket reservations
- `balance_ledger` - Audit trail for balance changes
- `tickets` - Individual ticket records
- `joincompetition` - Competition entries
- `canonical_users` - User records & bonus tracking

## 🎁 Key Features Documented

### User Identity System
- Canonical format: `prize:pid:<identifier>`
- Wallet-based: `prize:pid:0x1234...`
- UUID-based: `prize:pid:550e8400-...`
- Smart wallet resolution

### First-Topup Bonus
- Automatic 50% bonus on first balance top-up
- Applied via `credit_sub_account_balance` RPC
- Tracked in `canonical_users.has_used_new_user_bonus`
- Separate entries in `balance_ledger` ('real' + 'bonus')

### Webhook Security
- Coinbase Commerce: HMAC SHA256 verification
- Coinbase Onramp: Hook0 format verification
- Signature validation methods documented

### Payment Flows
1. Balance Top-Up → Purchase Tickets
2. Direct Ticket Purchase (External Payment)
3. Coinbase Onramp Direct Credit

## ✅ Supabase Alignment Ready

The documentation provides exact specifications for:
- ✅ Database table creation with field types
- ✅ Index creation for performance
- ✅ RPC function implementation
- ✅ Webhook endpoint configuration
- ✅ API request/response validation
- ✅ Frontend integration

## 🚀 Next Steps for Integration

1. **Verify Database Tables**
   - Compare existing tables with documented schemas
   - Add missing fields/indexes if needed
   - Validate RPC functions exist

2. **Configure Webhooks**
   - Set webhook URLs in Coinbase dashboard
   - Configure webhook secrets
   - Test signature verification

3. **Deploy Edge Functions**
   - Ensure all 8 functions deployed to Supabase
   - Configure environment variables
   - Test with documented payloads

4. **Frontend Integration**
   - Use documented request/response structures
   - Implement error handling per documented errors
   - Test all payment flows

5. **Testing & Validation**
   - Use provided curl examples
   - Test first-topup bonus
   - Verify ticket reservation expiry
   - Test instant win detection

## 📚 How to Use This Documentation

**For Backend Developers:**
→ PAYMENT_PROCESSES_JSON_PAYLOADS.md (sections 1-8 for each function)

**For Database Admins:**
→ PAYMENT_PROCESSES_JSON_PAYLOADS.md (Database Schemas section)

**For Frontend Developers:**
→ PAYMENT_QUICK_REFERENCE.md (function comparison table)

**For DevOps:**
→ PAYMENT_DOCUMENTATION_README.md (integration checklist)

## 🔍 Documentation Quality

- ✅ All field names documented with alternatives
- ✅ All data types specified
- ✅ All constraints documented
- ✅ All error cases covered
- ✅ Security verification methods included
- ✅ Testing examples provided
- ✅ Environment variables documented

## 📈 Impact

This documentation enables:
- Precise Supabase database alignment
- Accurate API integration
- Proper webhook configuration
- Comprehensive testing coverage
- Future maintenance and troubleshooting

---

**Documentation Version:** 1.0  
**Created:** 2026-01-23  
**Total Lines:** 1,798 lines across 3 files
