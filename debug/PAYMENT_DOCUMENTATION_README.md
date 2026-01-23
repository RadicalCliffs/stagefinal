# Payment Processes Documentation

Complete documentation of all payment-related JSON payloads and database schemas for The Prize platform.

## 📚 Documentation Files

### 1. [PAYMENT_PROCESSES_JSON_PAYLOADS.md](./PAYMENT_PROCESSES_JSON_PAYLOADS.md) (Full Documentation)
**1,251 lines** - Comprehensive reference with complete JSON payloads for all payment processes.

**Includes:**
- ✅ Complete request/response JSON payloads for 8 payment functions
- ✅ Database table schemas with field definitions
- ✅ Webhook payload structures and verification methods
- ✅ User identity format documentation
- ✅ Critical RPC function specifications
- ✅ Error response examples
- ✅ Testing payloads and curl examples

### 2. [PAYMENT_QUICK_REFERENCE.md](./PAYMENT_QUICK_REFERENCE.md) (Quick Reference)
**341 lines** - Condensed guide with payment flows and key information.

**Includes:**
- ✅ Payment functions comparison table
- ✅ Three common payment flows with step-by-step diagrams
- ✅ Critical database tables overview
- ✅ User identity system explanation
- ✅ Webhook security methods
- ✅ First-topup bonus logic
- ✅ Environment variables required
- ✅ Testing endpoints

## 🎯 Use Cases

### For Supabase Configuration
→ Use **PAYMENT_PROCESSES_JSON_PAYLOADS.md**
- Exact database schemas for table creation
- Field types and constraints
- Index definitions
- RPC function signatures

### For API Integration
→ Use **PAYMENT_PROCESSES_JSON_PAYLOADS.md**
- Complete request/response payloads
- Field name variations supported
- Webhook payload structures
- Authentication requirements

### For Quick Development Reference
→ Use **PAYMENT_QUICK_REFERENCE.md**
- Payment flow diagrams
- Function comparison table
- Common error responses
- Testing examples

## 🔑 Key Payment Functions Covered

1. **purchase-tickets-with-bonus** - Buy tickets using balance
2. **process-balance-payments** - Background processor for pending transactions
3. **reserve-tickets** - Reserve specific tickets (15-min hold)
4. **confirm-pending-tickets** - Confirm payment and create tickets
5. **create-charge** - Create Coinbase Commerce charge
6. **commerce-webhook** - Coinbase Commerce webhook receiver
7. **onramp-init** - Initialize Coinbase Onramp session
8. **onramp-webhook** - Coinbase Onramp webhook receiver

## 📊 Database Tables Documented

- **user_transactions** - Primary payment tracking
- **sub_account_balances** - User USD balances (atomic RPCs)
- **pending_tickets** - Ticket reservations (15-min expiry)
- **balance_ledger** - Audit trail for all balance changes
- **tickets** - Individual ticket records
- **joincompetition** - Competition entries (dashboard display)
- **canonical_users** - User records and bonus tracking

## 🔐 Security Features Documented

- Coinbase Commerce webhook signature verification (HMAC SHA256)
- Coinbase Onramp webhook signature verification (Hook0 format)
- User identity canonical format (`prize:pid:<identifier>`)
- Smart wallet resolution to parent EOA

## 💰 Bonus System Documentation

**First-Topup Bonus:**
- 50% bonus on first balance top-up
- Automatically applied by `credit_sub_account_balance` RPC
- Tracked via `canonical_users.has_used_new_user_bonus`
- Recorded in `balance_ledger` as separate 'bonus' entry

**Applicable to:**
- Coinbase Commerce top-ups
- Coinbase Onramp purchases

## 🔄 Payment Flows Covered

### Flow 1: Balance Top-Up → Purchase
```
create-charge(topup) → User pays → commerce-webhook 
→ process-balance-payments → purchase-tickets-with-bonus
```

### Flow 2: Direct Ticket Purchase
```
reserve-tickets → create-charge(entry) → User pays 
→ commerce-webhook → confirm-pending-tickets
```

### Flow 3: Onramp Direct Credit
```
onramp-init → User pays in widget → onramp-webhook 
→ Credit balance → purchase-tickets-with-bonus
```

## 🛠️ Integration Checklist

### To Align Supabase with Documentation:

**1. Database Tables**
- [ ] Verify all tables exist with documented schemas
- [ ] Check field types match documentation
- [ ] Validate indexes are created
- [ ] Confirm RLS policies match access patterns

**2. RPC Functions**
- [ ] Verify `credit_sub_account_balance` exists and applies 50% bonus
- [ ] Verify `debit_sub_account_balance` exists
- [ ] Verify `debit_sub_account_balance_with_entry` exists
- [ ] Verify `confirm_ticket_purchase` exists

**3. Edge Functions**
- [ ] Deploy all 8 payment functions to Supabase
- [ ] Configure environment variables (see docs)
- [ ] Set up webhook endpoints with proper secrets
- [ ] Test each function with documented payloads

**4. Webhook Configuration**
- [ ] Configure Coinbase Commerce webhook URL
- [ ] Set `COINBASE_COMMERCE_WEBHOOK_SECRET`
- [ ] Configure Coinbase Onramp webhook URL (Hook0)
- [ ] Set `ONRAMP_WEBHOOK_SECRET`

**5. Testing**
- [ ] Test all payment flows end-to-end
- [ ] Verify first-topup bonus application
- [ ] Test reservation expiry (15 minutes)
- [ ] Verify instant win detection
- [ ] Test error cases (insufficient balance, expired reservation, etc.)

## 📖 How to Use This Documentation

### For Backend Developers:
1. Read **PAYMENT_QUICK_REFERENCE.md** to understand payment flows
2. Reference **PAYMENT_PROCESSES_JSON_PAYLOADS.md** for exact schemas
3. Use testing examples to validate integration

### For Frontend Developers:
1. Check **PAYMENT_QUICK_REFERENCE.md** for function comparison table
2. Use **PAYMENT_PROCESSES_JSON_PAYLOADS.md** for request/response structures
3. Reference error responses for error handling

### For DevOps/Supabase Admins:
1. Use **PAYMENT_PROCESSES_JSON_PAYLOADS.md** database schemas section
2. Configure environment variables from documentation
3. Set up webhooks with documented security methods
4. Use integration checklist above

### For QA/Testing:
1. Use testing payloads from **PAYMENT_PROCESSES_JSON_PAYLOADS.md**
2. Reference error cases for negative testing
3. Verify payment flows from **PAYMENT_QUICK_REFERENCE.md**

## 🆘 Common Issues & Solutions

### Issue: First-topup bonus not applied
**Solution:** Check `canonical_users.has_used_new_user_bonus` flag and verify `credit_sub_account_balance` RPC exists

### Issue: Tickets not confirmed after payment
**Solution:** Check `commerce-webhook` logs, verify webhook signature, check retry logic

### Issue: Reservation expired error
**Solution:** Reservations expire after 15 minutes - verify `pending_tickets.expires_at` and adjust flow

### Issue: User balance not updating
**Solution:** Verify `sub_account_balances` table exists and `credit_sub_account_balance` RPC is working

### Issue: Webhook signature verification failing
**Solution:** Check environment variable secrets match Coinbase dashboard configuration

## 📝 Change Log

### Version 1.0 (2026-01-23)
- ✅ Initial comprehensive documentation
- ✅ All 8 payment functions documented
- ✅ Complete database schemas included
- ✅ Payment flows documented
- ✅ Webhook security detailed
- ✅ Testing examples provided

---

**Maintained By:** The Prize Development Team  
**Last Updated:** 2026-01-23  
**Version:** 1.0

For questions or issues with payment processes, refer to this documentation first.
