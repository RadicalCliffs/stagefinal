# JWT & Authentication - Master Index

## Quick Start

**Question:** "What JWT code exists in the codebase?"

**Answer:** 18 files use JWT-related code. 7 work, 11 are broken.

**Read:** Start with `JWT_AUDIT_SUMMARY.md` (2 min read)

---

## Document Guide

### 🚀 Quick Reference (Start Here)

**`JWT_AUDIT_SUMMARY.md`** (3 pages)
- TL;DR of findings
- File counts and categories
- Quick action items
- **Read this first**

**`QUICK_FIX_GUIDE.md`** (1 page)
- Immediate actions needed
- Priority order
- Edge function deployment

---

### 📊 Detailed Analysis

**`JWT_USAGE_COMPLETE_AUDIT.md`** (12 pages)
- Every file with line numbers
- Code patterns and examples
- Impact analysis
- Detailed recommendations
- **Complete reference**

**`JWT_VISUAL_MAP.md`** (7 pages)
- Visual diagrams
- Flow charts
- Call sequence diagrams
- Statistics tables
- **For visual learners**

---

### 🏗️ Architecture & Context

**`AUTHENTICATION_ARCHITECTURE.md`** (9 pages)
- How auth actually works (CDP/Base)
- Why JWT validation doesn't work
- Alternative solutions
- Security analysis
- **Essential context**

**`WHY_NO_JWT_VALIDATION.md`** (5 pages)
- Why JWT validation was reverted
- What would have happened
- Alternative security approaches
- **Background explanation**

---

### 🚨 Current Issues

**`ISSUE_RESOLUTION_SUMMARY.md`** (6 pages)
- What went wrong with preview
- Root causes
- Fixes applied
- What needs manual action
- **Current status**

**`EDGE_FUNCTION_DEPLOYMENT_ISSUE.md`** (3 pages)
- Why Lucky Dip is failing
- Deployment instructions
- Verification steps
- **Critical blocker**

**`TRANSACTION_ISSUES_ANALYSIS.md`** (5 pages)
- Negative transaction amounts
- Duplicate entries
- Investigation queries
- **Secondary issues**

---

## Finding Specific Information

### "Which files use JWT?"
→ `JWT_USAGE_COMPLETE_AUDIT.md` - Section 2

### "Why doesn't Supabase Auth work?"
→ `AUTHENTICATION_ARCHITECTURE.md` - Section 1

### "What's broken right now?"
→ `ISSUE_RESOLUTION_SUMMARY.md` - Summary section

### "How do I fix Lucky Dip?"
→ `EDGE_FUNCTION_DEPLOYMENT_ISSUE.md` - Solution section

### "What are the security implications?"
→ `AUTHENTICATION_ARCHITECTURE.md` - Security Analysis

### "How do I clean up the code?"
→ `JWT_USAGE_COMPLETE_AUDIT.md` - Recommended Actions

### "Show me visual diagrams"
→ `JWT_VISUAL_MAP.md` - All diagrams

---

## File Categories

### Working Code ✅
- Coinbase CDP JWTs (7 edge functions)
- Service role key usage (10+ functions)
- Frontend CDP/Base auth

### Broken Code ❌
- Supabase Auth getSession (11 files)
- Returns null, falls back to anon key

### Dead Code ⚠️
- Privy localStorage checks (7 files)
- Never has data, can be removed

---

## Key Findings Summary

### Authentication System
- **Used:** CDP/Base by Coinbase
- **Not Used:** Supabase Auth
- **Result:** No Supabase JWTs exist

### JWT Types
1. **Coinbase CDP JWTs** - Generated for Coinbase API (✅ working)
2. **Supabase Auth JWTs** - Expected but never created (❌ broken)

### Files Affected
- **18 total files** with JWT code
- **11 files** have broken getSession calls
- **7 files** have defunct Privy checks

### Why It Still Works
- Edge functions use service role keys
- Frontend auth prevents unauthorized UI
- Database RLS protects data
- Code fails gracefully

---

## Priority Actions

### 🔴 CRITICAL (Do Now)
1. Deploy `lucky-dip-reserve` edge function
   - See: `EDGE_FUNCTION_DEPLOYMENT_ISSUE.md`
   - Time: 2 minutes
   - Impact: Unblocks all Lucky Dip purchases

### 🟡 HIGH (Do Soon)
2. Fix transaction display
   - See: `ISSUE_RESOLUTION_SUMMARY.md`
   - Status: ✅ Already fixed in this PR

3. Clean up JWT code
   - See: `JWT_USAGE_COMPLETE_AUDIT.md`
   - Options: Document, remove, or replace
   - Time: 1-2 hours

### 🟢 MEDIUM (Plan)
4. Investigate negative transactions
   - See: `TRANSACTION_ISSUES_ANALYSIS.md`
   - Run SQL queries
   - Fix webhook idempotency

### 🔵 LOW (Long-term)
5. Implement proper auth
   - See: `AUTHENTICATION_ARCHITECTURE.md`
   - Wallet signatures or custom JWTs
   - Time: Days to weeks

---

## Document Relationships

```
QUICK_FIX_GUIDE
    ↓
ISSUE_RESOLUTION_SUMMARY
    ↓
┌─────────────────┬────────────────────┐
│                 │                    │
EDGE_FUNCTION_   JWT_AUDIT_       TRANSACTION_
DEPLOYMENT       SUMMARY           ISSUES
    ↓                ↓                 ↓
    │          JWT_USAGE_         (SQL queries)
    │          COMPLETE_AUDIT
    │                ↓
    │          JWT_VISUAL_MAP
    │                ↓
    └────────> AUTHENTICATION_
               ARCHITECTURE
                    ↓
               WHY_NO_JWT_
               VALIDATION
```

---

## Quick Access

### By Topic

**JWT Usage:**
- Summary: `JWT_AUDIT_SUMMARY.md`
- Complete: `JWT_USAGE_COMPLETE_AUDIT.md`
- Visual: `JWT_VISUAL_MAP.md`

**Authentication:**
- Architecture: `AUTHENTICATION_ARCHITECTURE.md`
- JWT Validation: `WHY_NO_JWT_VALIDATION.md`

**Current Issues:**
- Overview: `ISSUE_RESOLUTION_SUMMARY.md`
- Quick Fix: `QUICK_FIX_GUIDE.md`
- Edge Function: `EDGE_FUNCTION_DEPLOYMENT_ISSUE.md`
- Transactions: `TRANSACTION_ISSUES_ANALYSIS.md`

### By Urgency

**Critical:**
1. `QUICK_FIX_GUIDE.md`
2. `EDGE_FUNCTION_DEPLOYMENT_ISSUE.md`

**High:**
3. `ISSUE_RESOLUTION_SUMMARY.md`
4. `JWT_AUDIT_SUMMARY.md`

**Medium:**
5. `JWT_USAGE_COMPLETE_AUDIT.md`
6. `TRANSACTION_ISSUES_ANALYSIS.md`

**Reference:**
7. `AUTHENTICATION_ARCHITECTURE.md`
8. `JWT_VISUAL_MAP.md`
9. `WHY_NO_JWT_VALIDATION.md`

### By Role

**Developer:**
- `JWT_USAGE_COMPLETE_AUDIT.md` - File list
- `JWT_VISUAL_MAP.md` - Diagrams
- `AUTHENTICATION_ARCHITECTURE.md` - System design

**DevOps:**
- `EDGE_FUNCTION_DEPLOYMENT_ISSUE.md` - Deploy instructions
- `QUICK_FIX_GUIDE.md` - Immediate actions

**Security:**
- `AUTHENTICATION_ARCHITECTURE.md` - Security analysis
- `JWT_USAGE_COMPLETE_AUDIT.md` - Vulnerabilities

**Product/Management:**
- `ISSUE_RESOLUTION_SUMMARY.md` - What happened
- `QUICK_FIX_GUIDE.md` - Impact and fixes

---

## Statistics

### Documentation
- **9 documents** created
- **60+ pages** total
- **Complete coverage** of JWT usage
- **Visual diagrams** included

### Code Analysis
- **92 edge functions** audited
- **18 files** with JWT code identified
- **11 files** need cleanup
- **7 files** have dead code

### Issues
- **1 critical** - Edge function deployment
- **1 high** - Transaction display (fixed)
- **2 medium** - Code cleanup, investigation
- **1 low** - Long-term auth improvement

---

## Next Steps

1. ✅ **Read** `JWT_AUDIT_SUMMARY.md` (you are here)
2. ⏭️ **Deploy** edge function (see `EDGE_FUNCTION_DEPLOYMENT_ISSUE.md`)
3. ⏭️ **Pull** this PR (get transaction fix)
4. ⏭️ **Choose** cleanup approach (see `JWT_USAGE_COMPLETE_AUDIT.md`)
5. ⏭️ **Implement** chosen approach
6. ⏭️ **Plan** long-term auth improvement (see `AUTHENTICATION_ARCHITECTURE.md`)

---

**All JWT usage documented and analyzed.**
**Ready for cleanup and security improvements.**

**Start with:** `JWT_AUDIT_SUMMARY.md`
