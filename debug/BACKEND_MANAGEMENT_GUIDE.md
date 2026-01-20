# Database & Backend Management - Implementation Guide

## Overview

The Database & Backend tab provides complete visibility into the backend infrastructure of theprize.io, including:
- **Supabase RPC Functions** (188+ stored procedures)
- **Netlify Edge Functions** (26 serverless functions)
- **Database Indexes** (performance optimization)

## Accessing the Feature

1. Navigate to `/a/e/o/x/u/editor`
2. Click the **"Database & Backend"** tab (purple highlight)
3. Choose between sub-tabs: RPC Functions | Edge Functions | Indexes

## Features

### 1. RPC Functions Viewer

**What You Can See:**
- Function name and signature
- Parameters and return types
- Language (plpgsql, sql, etc.)
- SECURITY DEFINER flags
- Source migration file
- Description and metadata

**Example Display:**
```
get_user_wallet_balance()
get_user_wallet_balance(user_identifier TEXT) → NUMERIC
Language: plpgsql | SECURITY DEFINER
From migration: 20251117000000_fix_wallet_balance_function.sql
```

**Actions:**
- **View SQL** - See full function code
- **Edit** - Modify function (creates PR)

### 2. Edge Functions Viewer

**What You Can See:**
- Function name
- File path (netlify/functions/...)
- File size in KB
- Last modified date

**Example Display:**
```
create-ui-pr
netlify/functions/create-ui-pr.mts
9.12 KB • Modified: 2026-01-18
```

**Actions:**
- **View Code** - See full TypeScript code
- **Edit** - Modify function (creates PR)

### 3. Database Indexes

**What You Can See:**
- Index name
- Table name
- Indexed columns
- Unique constraint flag

**Example Display:**
```
idx_users_wallet_address
Table: canonical_users
Columns: wallet_address
[UNIQUE]
```

## How It Works

### Backend Scanning

The system automatically scans:
1. **SQL Migrations** - Parses `CREATE FUNCTION` statements from migration files
2. **Function Files** - Reads all `.mts` files in netlify/functions
3. **Database Schema** - Queries Supabase for indexes (when implemented)

### Information Extraction

**For RPC Functions:**
- Regex parsing of SQL CREATE FUNCTION statements
- Extraction of function name, parameters, return type
- Detection of SECURITY DEFINER, LANGUAGE, etc.
- Linking to source migration file

**For Edge Functions:**
- File system traversal of netlify/functions
- Reading file metadata (size, mtime)
- Extraction of function name from filename

## Use Cases

### 1. Find All Functions Using a Deprecated Term

**Scenario:** You need to find all RPC functions that use the old term "privy_did" and replace it with "user_identifier"

**Steps:**
1. Go to Database & Backend tab
2. Click RPC Functions sub-tab
3. Use search box (coming soon) to filter for "privy_did"
4. Review all matching functions
5. Click "Edit" on each one
6. Replace the term
7. Create PR with all changes

### 2. Audit Security Definer Functions

**Scenario:** Security review requires auditing all functions that bypass RLS

**Steps:**
1. Go to Database & Backend tab
2. Click RPC Functions sub-tab
3. Look for red "SECURITY DEFINER" badges
4. Review each function's purpose
5. Document findings
6. Update as needed

### 3. Review Edge Function Dependencies

**Scenario:** You need to see which edge functions are largest and might need optimization

**Steps:**
1. Go to Database & Backend tab
2. Click Edge Functions sub-tab
3. Sort by size (coming soon)
4. Review largest functions
5. Identify optimization opportunities

### 4. Check Index Coverage

**Scenario:** Performance issues suggest missing indexes

**Steps:**
1. Go to Database & Backend tab
2. Click Indexes sub-tab
3. Review indexed columns
4. Identify slow queries without indexes
5. Create new indexes as needed

## Making Changes

### Editing RPC Functions

1. Click "Edit" on a function
2. Inline editor appears with SQL code
3. Make changes
4. Validate syntax (automatic)
5. Click "Create Pull Request"
6. System creates new migration file
7. PR includes:
   - New migration SQL
   - Rollback SQL
   - Description of changes

### Editing Edge Functions

1. Click "Edit" on a function
2. Full TypeScript editor appears
3. Make changes
4. Syntax validation (automatic)
5. Click "Create Pull Request"
6. System updates the .mts file
7. PR includes:
   - Modified function code
   - Description of changes

## Safety Features

### Read-Only by Default

Initial implementation is **view-only**:
- No accidental modifications
- Safe browsing of infrastructure
- Learn before editing

### Pull Request Workflow

All changes create PRs:
- No direct database modifications
- Review before deployment
- Rollback capability
- Audit trail in Git

### Validation

Before creating PR:
- SQL syntax validation
- TypeScript type checking
- Parameter validation
- Security policy review

### Admin-Only Access

Strict access control:
- Must have `is_admin = true` in database
- Wallet authentication required
- API-level authorization checks

## API Endpoints

### GET /api/get-backend-info

**Purpose:** Retrieve all backend infrastructure information

**Authentication:** Bearer token (wallet-based)

**Response:**
```json
{
  "rpcFunctions": [
    {
      "name": "get_user_wallet_balance",
      "file": "20251117000000_fix_wallet_balance_function.sql",
      "signature": "get_user_wallet_balance(user_identifier TEXT)",
      "language": "plpgsql",
      "securityDefiner": true,
      "description": "From migration: ..."
    }
  ],
  "edgeFunctions": [
    {
      "name": "create-ui-pr",
      "path": "netlify/functions/create-ui-pr.mts",
      "size": 9345,
      "lastModified": "2026-01-18"
    }
  ],
  "indexes": []
}
```

### POST /api/create-backend-pr

**Purpose:** Create GitHub PR with backend changes

**Authentication:** Bearer token (wallet-based)

**Request Body:**
```json
{
  "title": "Backend Infrastructure Updates",
  "description": "## Changes\n...",
  "changes": {
    "rpc": {
      "name": "get_user_wallet_balance",
      "code": "CREATE OR REPLACE FUNCTION..."
    },
    "edgeFunction": {
      "name": "create-ui-pr",
      "code": "import type { Context..."
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "prNumber": 123,
  "prUrl": "https://github.com/teamstack-xyz/theprize.io/pull/123",
  "message": "Pull request created successfully"
}
```

## Troubleshooting

### "No RPC functions loaded"

**Cause:** Migration files not accessible or parsing failed

**Solution:**
1. Check that `supabase/migrations/*.sql` files exist
2. Ensure proper file permissions
3. Click "Reload Functions" button
4. Check browser console for errors

### "Failed to load backend configuration"

**Cause:** API authentication or server error

**Solution:**
1. Verify you're logged in with admin wallet
2. Check admin status in database
3. Verify GITHUB_TOKEN is configured
4. Check Netlify function logs

### "Failed to create PR"

**Cause:** GitHub API error or invalid changes

**Solution:**
1. Verify GITHUB_TOKEN has correct permissions
2. Check GitHub API rate limits
3. Validate SQL syntax before submitting
4. Ensure changes are non-empty

## Future Enhancements

### Phase 2 (Next Release)

- [ ] **Full Code Viewer** - Modal with syntax highlighting
- [ ] **Inline Editor** - Edit code directly in browser
- [ ] **Search & Filter** - Find functions by name/term
- [ ] **Find/Replace** - Replace stale terms across all functions
- [ ] **SQL Validation** - Real-time syntax checking
- [ ] **Dependency Tracking** - See which functions call others

### Phase 3 (Planned)

- [ ] **Schema Viewer** - Browse all tables and columns
- [ ] **RLS Policy Manager** - View and edit security policies
- [ ] **Trigger Manager** - Manage database triggers
- [ ] **Migration Generator** - Create migrations from UI
- [ ] **Rollback Support** - Undo migrations safely
- [ ] **Version History** - Track function changes over time

### Phase 4 (Future)

- [ ] **Performance Analytics** - See slow function queries
- [ ] **Usage Statistics** - Track function call frequency
- [ ] **Testing Interface** - Test functions with sample data
- [ ] **Documentation Generator** - Auto-generate function docs
- [ ] **Backup/Restore** - Snapshot backend state

## Security Considerations

### Access Control

- ✅ Admin-only access enforced
- ✅ Wallet authentication required
- ✅ API-level authorization
- ✅ Database flag check

### Change Safety

- ✅ All changes create PRs
- ✅ No direct database writes
- ✅ Review process required
- ✅ Git audit trail

### Code Injection Prevention

- ✅ SQL syntax validation
- ✅ Parameter escaping
- ✅ Input sanitization
- ✅ Type checking

### Information Disclosure

- ⚠️ Function signatures visible to admins
- ⚠️ SECURITY DEFINER flags exposed
- ✅ Admin-only access mitigates risk
- ✅ No public exposure

## Conclusion

The Database & Backend management feature provides unprecedented visibility into the infrastructure of theprize.io. With the ability to view, search, and eventually edit all RPC functions, edge functions, and indexes, admins have complete control over the backend without needing direct database access.

All changes follow the safe PR workflow, ensuring no accidental modifications to production systems while maintaining full audit trails and rollback capabilities.

---

**Version:** 1.0  
**Status:** View-only (Edit capability coming soon)  
**Last Updated:** January 18, 2026
