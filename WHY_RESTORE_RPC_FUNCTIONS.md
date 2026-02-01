# Why Restore RPC Functions from Supabase?

## The Confusion

You mentioned: "i got those files from Supabase, why would i now be trying to migrate functionality 'back' to it, weren't they for you to ensure front end was utilising appropriately?"

This is a valid question! Here's what happened:

## What Actually Happened

### 1. **The Production Database Had These Functions**
The production Supabase database already contained these 4 RPC functions:
- `credit_sub_account_balance`
- `debit_sub_account_balance`
- `confirm_ticket_purchase`
- `get_joincompetition_entries_for_competition`

### 2. **The Frontend Was Built to Use Them**
The frontend code (edge functions) was already written to call these RPC functions:
- `purchase-tickets-with-bonus/index.ts` calls `debit_sub_account_balance` 
- `onramp-complete/index.ts` calls `credit_sub_account_balance`
- `select-competition-winners/index.ts` calls `get_joincompetition_entries_for_competition`
- etc.

### 3. **But They Were Missing from the Migration Files**
When the baseline migration files were created (to allow fresh database setups), these 4 functions were accidentally omitted. This meant:
- ✅ Production database: Has the functions (working)
- ❌ New databases: Missing the functions (broken)
- ✅ Frontend code: Expects the functions to exist

### 4. **The "Restore" is Actually "Include in Migrations"**
The word "restore" might be confusing. What we're really doing is:
- Taking the function definitions from production
- Adding them to migration files so they can be applied to other environments
- Ensuring all environments (dev, staging, production) have the same functions

## Why This Matters

### Without These Migrations:
1. Fresh database setup would fail (missing functions)
2. Frontend calls to these RPCs would fail
3. Balance payments wouldn't work
4. Ticket purchases would break

### With These Migrations:
1. ✅ Any new database gets all required functions
2. ✅ Frontend code works consistently across all environments
3. ✅ Production, staging, and dev all have the same schema

## The Files You Got from Supabase

When you "got those files from Supabase", what likely happened was:
1. Someone exported the function definitions from the production database
2. These were given to you as SQL migration files
3. The goal was to **include them in the migration system**

## Think of It This Way

**Old Situation:**
```
Production DB: [Has Functions] ←→ Frontend: [Calls Functions] ✅ Works
Dev/Staging DB: [Missing Functions] ←→ Frontend: [Calls Functions] ❌ Broken
```

**After Adding These Migrations:**
```
Production DB: [Has Functions] ←→ Frontend: [Calls Functions] ✅ Works
Dev/Staging DB: [Has Functions] ←→ Frontend: [Calls Functions] ✅ Works
New DB Setup: [Has Functions] ←→ Frontend: [Calls Functions] ✅ Works
```

## What You Need to Do

The migration files are already created and ready:
1. `20260201004000_restore_production_balance_functions.sql` - Core balance operations
2. `20260201004100_restore_additional_balance_functions.sql` - Helper functions

**To apply them:**
```bash
# If using Supabase CLI
supabase db push

# Or run manually in Supabase Studio SQL Editor
```

## Summary

**You're not migrating functionality "back" to Supabase.**

You're ensuring that the functions that exist in **production Supabase** are also available in **all other environments** by adding them to the migration system.

The frontend was correctly written to use these functions - they just need to exist in all databases, not just production.

---

**See also:** `/RESTORE_RPC_FUNCTIONS_DEPLOYMENT.md` for detailed deployment instructions.
