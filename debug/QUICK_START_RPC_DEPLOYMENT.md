# Quick Start: RPC Functions Deployment

## TL;DR - What You Need to Do

You have 2 migration files that add 4 critical RPC functions to your database:
1. `supabase/migrations/20260201004000_restore_production_balance_functions.sql`
2. `supabase/migrations/20260201004100_restore_additional_balance_functions.sql`

**These are ready to deploy. Just run:**

```bash
supabase db push
```

## What These Functions Do

| Function | Purpose | Used By |
|----------|---------|---------|
| `credit_sub_account_balance` | Add money to user balance | Payment webhooks, balance top-ups |
| `debit_sub_account_balance` | Remove money from balance | Ticket purchases |
| `confirm_ticket_purchase` | Confirm pending tickets | Purchase confirmations |
| `get_joincompetition_entries_for_competition` | Get competition entries | Winner selection, entry validation |

## Why You Have These Files

**Short Answer:** Production has these functions → Frontend uses them → Migrations didn't have them → Now they do

**The Confusion:** You got these from Supabase production and wondered why you're "migrating back" to it.

**The Reality:** 
- Production DB: ✅ Has functions (working)
- Migration system: ❌ Missing functions
- After applying: ✅ All environments have functions

You're not migrating "back" - you're adding them to the migration system so all environments are consistent.

## Verify After Deployment

```bash
# Check functions exist
psql $DATABASE_URL -f supabase/migrations/verify_rpc_functions.sql
```

Or in Supabase Studio SQL Editor:
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN (
    'credit_sub_account_balance',
    'debit_sub_account_balance', 
    'confirm_ticket_purchase',
    'get_joincompetition_entries_for_competition'
  );
```

Should return 4 rows.

## Need More Info?

- **Full deployment guide:** `/RESTORE_RPC_FUNCTIONS_DEPLOYMENT.md`
- **Why "restore"?:** `/WHY_RESTORE_RPC_FUNCTIONS.md`
- **Task completion:** `/TASK_COMPLETION_RPC_FUNCTIONS.md`

## That's It!

The migration files are already created and ready. The frontend already uses these functions. Just deploy and you're done.
