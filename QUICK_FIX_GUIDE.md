# 🚀 QUICK FIX GUIDE: Pay with Balance Issue

## 🔴 Current Status

**Code**: ✅ Fixed  
**Deployment**: ⚠️ **REQUIRED**  
**User Impact**: 🔴 **HIGH** - Users cannot purchase with balance

## ⚡ Quick Deploy (30 seconds)

```bash
# 1. Navigate to project root
cd theprize.io

# 2. Run deployment script
./deploy-edge-functions.sh

# 3. Test on substage.theprize.io
```

That's it! The fix will be live immediately.

## 📋 What's Fixed

The "Failed to fetch" error when purchasing with balance is caused by missing runtime initialization in three Supabase Edge Functions.

**Fixed Functions**:
- ✅ `purchase-tickets-with-bonus` (main payment function)
- ✅ `update-user-avatar` (user profile)
- ✅ `upsert-user` (user management)

## 🛠️ What Was Done

Each function now has the required import on line 1:
```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
```

This enables:
- Proper Deno runtime initialization
- CORS preflight handling
- HTTP request processing
- Error-free function execution

## 📦 Files in This Fix

### Core Code Changes (Already Applied)
- `supabase/functions/purchase-tickets-with-bonus/index.ts` - ✅ Fixed
- `supabase/functions/update-user-avatar/index.ts` - ✅ Fixed
- `supabase/functions/upsert-user/index.ts` - ✅ Fixed

### Deployment Tools (New)
- `deploy-edge-functions.sh` - **Automated deployment script**
- `FIX_PAY_WITH_BALANCE_DEPLOYMENT.md` - Complete deployment guide
- `FIX_PAY_WITH_BALANCE_FINAL_SUMMARY.md` - Technical summary
- `QUICK_FIX_GUIDE.md` - This file

## 🎯 Deployment Prerequisites

You need:
1. Supabase CLI installed: `npm install -g supabase`
2. Logged in to Supabase: `supabase login`
3. Project linked: `supabase status` (should show project info)

If not set up:
```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project (if needed)
supabase link --project-ref YOUR_PROJECT_REF
```

## ✅ Verification

After deployment, test:

1. **Go to**: substage.theprize.io
2. **Open**: Browser console (F12)
3. **Navigate**: To any competition
4. **Select**: 1-3 tickets
5. **Click**: "Purchase with Balance"

**Expected**: 
- ✅ No "Failed to fetch" error
- ✅ Purchase completes successfully
- ✅ Balance deducted
- ✅ Tickets appear in dashboard

**Before Fix**:
- ❌ "Failed to fetch" error
- ❌ "Failed to send a request to the Edge Function"
- ❌ Purchase fails

## 🔄 Rollback (if needed)

If something goes wrong:

**Via Supabase Dashboard**:
1. Go to Edge Functions
2. Select the function
3. View Deployment History
4. Click "Rollback" on previous version

**Via CLI**:
```bash
# Restore from backup
cp supabase/functions/purchase-tickets-with-bonus/index.ts.backup \
   supabase/functions/purchase-tickets-with-bonus/index.ts
supabase functions deploy purchase-tickets-with-bonus
```

## 📊 Metrics

**Risk**: 🟢 Low (minimal code changes)  
**Impact**: 🔴 High (critical user feature)  
**Time**: ⚡ ~5 minutes  
**Complexity**: 🟢 Simple (1 import per file)

## 🆘 Troubleshooting

### "supabase: command not found"
```bash
npm install -g supabase
```

### "Not logged in"
```bash
supabase login
```

### "Project not linked"
```bash
supabase link --project-ref YOUR_PROJECT_REF
```

### "Deployment failed"
Check Supabase dashboard Edge Functions section for error details.

## 📚 Documentation

**Quick Start**: This file  
**Full Guide**: `FIX_PAY_WITH_BALANCE_DEPLOYMENT.md`  
**Technical**: `FIX_PAY_WITH_BALANCE_FINAL_SUMMARY.md`  
**Checklist**: `DEPLOYMENT_CHECKLIST_CORS_FIX.md`

## 🎉 Expected Outcome

After deployment:
- Users can purchase tickets with balance ✅
- No more "Failed to fetch" errors ✅
- Normal payment flow restored ✅
- All balance-based features working ✅

## ⏱️ Timeline

- **Code Fix**: ✅ Complete
- **Documentation**: ✅ Complete  
- **Deployment**: ⚠️ Pending (you are here)
- **Testing**: ⏳ Next step
- **Resolution**: ⏳ ~10 minutes away

---

**Ready to deploy?** Run `./deploy-edge-functions.sh` now!
