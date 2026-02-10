# URL Update Checklist: substage.theprize.io → stage.theprize.io

This document lists every hardcoded URL, RPC function, trigger, and index on Netlify, GitHub, and Supabase that needs updating when changing from `substage.theprize.io` to `stage.theprize.io`.

## Summary

**Total locations requiring updates: 50+**

---

## 1. SUPABASE EDGE FUNCTIONS (Deno/TypeScript)

### 1.1 CORS Configuration Files

These files contain CORS allowed origins lists that include `substage.theprize.io`:

#### `supabase/functions/_shared/cors.ts` (Shared CORS module)
- **Line 4**: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
- **Line 7**: `'https://substage.theprize.io',` in ALLOWED_ORIGINS array
- **Impact**: This is a shared module used by multiple functions

#### Individual Edge Functions with Inlined CORS:

1. **`supabase/functions/confirm-pending-tickets/index.ts`**
   - Line 52: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 55: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

2. **`supabase/functions/create-new-user/index.ts`**
   - Line 6: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 9: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

3. **`supabase/functions/email-auth-start/index.ts`**
   - Line 5: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 8: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

4. **`supabase/functions/email-auth-verify/index.ts`**
   - Line 5: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 8: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

5. **`supabase/functions/get-user-profile/index.ts`**
   - Line 6: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 9: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

6. **`supabase/functions/lucky-dip-reserve/index.ts`**
   - Line 6: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 9: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

7. **`supabase/functions/payments-auto-heal/index.ts`**
   - Line 57: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 60: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

8. **`supabase/functions/reserve-tickets/index.ts`**
   - Line 61: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 64: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

9. **`supabase/functions/reserve_tickets/index.ts`** (duplicate/legacy)
   - Line 61: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
   - Line 64: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

10. **`supabase/functions/update-user-avatar/index.ts`**
    - Line 5: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
    - Line 8: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

11. **`supabase/functions/upsert-user/index.ts`**
    - Line 6: `const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';`
    - Line 9: `'https://substage.theprize.io',` in ALLOWED_ORIGINS

### 1.2 Payment/Onramp Redirect URLs

These functions have hardcoded redirect URLs back to the frontend:

12. **`supabase/functions/create-charge/index.ts`**
    - Line 68: `const successBaseUrl = Deno.env.get("SUCCESS_URL") || "https://substage.theprize.io";`
    - **Impact**: Payment success redirects

13. **`supabase/functions/offramp-cancel/index.ts`**
    - Line 37: `const DEFAULT_REDIRECT_URL = 'https://substage.theprize.io/dashboard/entries?status=cancelled';`
    - **Impact**: Offramp cancellation redirects

14. **`supabase/functions/offramp-complete/index.ts`**
    - Line 38: `const DEFAULT_REDIRECT_URL = 'https://substage.theprize.io/dashboard/entries?status=complete';`
    - **Impact**: Offramp completion redirects

15. **`supabase/functions/onramp-cancel/index.ts`**
    - Line 37: `const DEFAULT_REDIRECT_URL = 'https://substage.theprize.io/dashboard/entries?status=cancelled';`
    - **Impact**: Onramp cancellation redirects

16. **`supabase/functions/onramp-complete/index.ts`**
    - Line 38: `const DEFAULT_REDIRECT_URL = 'https://substage.theprize.io/dashboard/entries?status=complete';`
    - **Impact**: Onramp completion redirects

### 1.3 Onramp/Offramp Functions with "stage.theprize.io"

**Note**: These files currently have `stage.theprize.io` (not `substage`), but should be reviewed for consistency:

17. **`supabase/functions/offramp-cancel/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS (alongside the substage redirect URL)

18. **`supabase/functions/offramp-complete/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS

19. **`supabase/functions/offramp-init/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS

20. **`supabase/functions/offramp-quote/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS

21. **`supabase/functions/offramp-status/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS

22. **`supabase/functions/offramp-webhook/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS

23. **`supabase/functions/onramp-init/index.ts`**
    - Line 20: `'https://stage.theprize.io',` in ALLOWED_ORIGINS
    - **Special Note**: Also includes 'https://vocal-cascaron-bcef9b.netlify.app' which may be a staging Netlify URL

24. **`supabase/functions/onramp-quote/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS

25. **`supabase/functions/onramp-status/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS

26. **`supabase/functions/onramp-webhook/index.ts`**
    - Has `'https://stage.theprize.io',` in ALLOWED_ORIGINS

---

## 2. SUPABASE CONFIGURATION

### 2.1 Environment Variables (Supabase Dashboard)

**Action Required**: Update environment variables in Supabase Dashboard → Settings → Edge Functions → Environment Variables

- **`SITE_URL`**: Should be set to `https://stage.theprize.io`
- **`SUCCESS_URL`**: Should be set to `https://stage.theprize.io` (used by create-charge function)

### 2.2 Local Supabase Config

**`supabase/config.toml`**
- Line 70: `site_url = "http://127.0.0.1:3000"` (local development only, no changes needed for production)
- Line 72: `additional_redirect_urls = ["https://127.0.0.1:3000"]` (local development only)

**Note**: The local config doesn't need updating for production deployment, but if you deploy to a remote Supabase project, ensure the `site_url` in Supabase Dashboard → Authentication → URL Configuration is set to `https://stage.theprize.io`

---

## 3. NETLIFY CONFIGURATION

### 3.1 Netlify Configuration File

**`netlify.toml`**
- **No direct substage.theprize.io references found**
- However, review the following in Netlify Dashboard:
  - Site domain settings
  - Deploy contexts
  - Branch deploys

### 3.2 Netlify Dashboard Settings to Review

**Action Required in Netlify Dashboard**:

1. **Site Settings → Domain management**
   - Update custom domain from `substage.theprize.io` to `stage.theprize.io`
   - Update DNS records accordingly

2. **Site Settings → Build & deploy → Environment variables**
   - Check for any environment variables that reference `substage.theprize.io`
   - Update `SITE_URL` or similar variables

3. **Site Settings → Build & deploy → Deploy contexts**
   - Review branch deploy URLs
   - Update any deploy previews that reference substage

4. **Netlify Functions Environment Variables** (if set separately)
   - Review all Netlify Functions for environment variable references

---

## 4. GITHUB

### 4.1 GitHub Workflows

**Finding**: No `.github` directory found in the repository.

**Action**: If GitHub Actions are configured at the organization or repository level via GitHub UI, check for:
- Workflow files that may reference `substage.theprize.io`
- Repository secrets/variables containing the URL
- Deploy workflows with hardcoded URLs

### 4.2 GitHub Repository Settings

**Action Required in GitHub**:

1. **Settings → Secrets and variables → Actions**
   - Check for variables like `DEPLOYMENT_URL`, `SITE_URL`, etc.

2. **Settings → Environments**
   - Review environment URLs if staging environment is configured
   - Update environment URLs from substage to stage

3. **Settings → Pages** (if applicable)
   - Review custom domain settings

---

## 5. SCRIPTS & DEPLOYMENT TOOLS

### 5.1 Verification Scripts

27. **`scripts/verify-cors-fix.sh`**
    - Line 21: `ORIGIN="https://substage.theprize.io"`
    - Line 144: `echo "1. Test in browser at: https://substage.theprize.io"`

28. **`scripts/verify-cors-deployment.sh`**
    - Line 10: `ORIGIN="https://substage.theprize.io"`
    - Line 68: `elif echo "$ALLOW_ORIGIN" | grep -q "substage.theprize.io\|theprize.io"; then`

29. **`scripts/deploy-cors-fix.sh`**
    - Line 54: `echo "2. Test in browser at: https://substage.theprize.io"`

30. **`scripts/deploy-edge-functions.sh`**
    - Line 93: `echo "1. Test the fix on substage.theprize.io"`

---

## 6. DOCUMENTATION FILES

### 6.1 Debug Documentation

31. **`debug/COMPREHENSIVE_CORS_FIX.md`** - Multiple references
32. **`debug/CORS_FIX_DEPLOYMENT.md`** - Line 12 and others
33. **`debug/DEPLOYMENT_CHECKLIST_CORS_FIX.md`** - Multiple references
34. **`debug/EXECUTIVE_SUMMARY_CORS_FIX.md`** - Multiple references
35. **`debug/FIX_COMPLETE_BALANCE_PAYMENT.md`** - Multiple references
36. **`debug/FIX_PAY_WITH_BALANCE_DEPLOYMENT.md`** - Multiple references
37. **`debug/FIX_PAY_WITH_BALANCE_FINAL_SUMMARY.md`** - Multiple references
38. **`debug/PAYMENT_ARCHITECTURE.md`** - Multiple references
39. **`debug/PAYMENT_PROCESSES_JSON_PAYLOADS.md`**
    - Line 1199: `- SUCCESS_URL - Base URL for redirect after payment (default: https://substage.theprize.io)`
40. **`debug/PAYMENT_QUICK_REFERENCE.md`**
    - Line 262: `SUCCESS_URL=<base_url_for_redirects>  # Default: https://substage.theprize.io`
41. **`debug/QUICK_DEPLOYMENT_GUIDE.md`**
    - Line 47: `1. Open: https://substage.theprize.io/dashboard/entries`
42. **`debug/QUICK_FIX_GUIDE.md`** - Multiple references
43. **`debug/README_FIX_BALANCE_PAYMENT.md`** - Multiple references
44. **`debug/VISUAL_EDITOR_IMPLEMENTATION.md`** - Multiple references
45. **`debug/VISUAL_EDITOR_README.md`** - Multiple references

### 6.2 Archive Documentation

46. **`docs/archive/BEFORE_AND_AFTER_FIXES.md`** - Lines 66, 174
47. **`docs/archive/COMPLETE_SUMMARY.md`** - Multiple references
48. **`docs/archive/COMPREHENSIVE_SMOKE_TEST_SUMMARY.md`**
    - Line 251: `- Visit: https://substage.theprize.io`
49. **`docs/archive/CORS_AND_JAVASCRIPT_ERRORS_FIX.md`**
    - Lines 37, 98, multiple references
50. **`docs/archive/CORS_DEPLOYMENT_URGENT.md`**
    - Lines 9, 66, 73, 153
51. **`docs/archive/CORS_SECURITY_COMPLETE.md`** - Multiple references
52. **`docs/archive/DEPLOYMENT_INSTRUCTIONS_CORS_FIX.md`**
    - Lines 86, 94, 113, 122, 136, 159, 167
53. **`docs/archive/FIX_CORS_NOW.md`** - Multiple references
54. **`docs/archive/FIX_SUMMARY_CORS_JAVASCRIPT.md`** - Multiple references
55. **`docs/archive/README_QUICK_FIXES.md`** - Multiple references
56. **`docs/archive/ROOT_CAUSE_ANALYSIS.md`**
    - Lines 16, 96, 123, 237
57. **`docs/archive/TROUBLESHOOTING_CORS_HTTP0.md`** - Multiple references
58. **`docs/archive/URGENT_LUCKY_DIP_FIX.md`**
    - Line 29: `- **URL**: https://substage.theprize.io/competitions/47354b08-8167-471e-959a-5fc114dcc532`
59. **`docs/archive/WORK_COMPLETED_SUMMARY.md`**
    - Lines 129, 225

### 6.3 Test Files

60. **`docs/archive/test-files/test-cors-rpc.html`**
    - Lines 64, 84: `'Origin': 'https://substage.theprize.io'`

### 6.4 Deprecated/Backup Files

61. **`docs/archive/deprecated-functions/index.ts.backup`**
    - Lines 6, 9: CORS configuration (deprecated, may not need updating)

---

## 7. EXTERNAL SERVICES CONFIGURATION

### 7.1 Coinbase Commerce/Onramp

**Action Required**:
1. Log into Coinbase Commerce Dashboard
2. Update webhook URLs from `https://substage.theprize.io/*` to `https://stage.theprize.io/*`
3. Update redirect URLs in Coinbase Onramp settings
4. Update any allowed origins for CORS

### 7.2 SendGrid

**Action Required** (if applicable):
1. Check SendGrid Dashboard for any hardcoded callback URLs
2. Update email templates if they contain `substage.theprize.io` links
3. Review webhook configurations

### 7.3 DNS Provider

**Action Required**:
1. Update DNS A/CNAME records:
   - Remove or update `substage.theprize.io` → Netlify
   - Add/update `stage.theprize.io` → Netlify

---

## 8. CRITICAL ACTIONS SUMMARY

### Priority 1 (Breaks functionality if not updated):

1. **Supabase Edge Functions** - Update all CORS configurations and redirect URLs
2. **Supabase Environment Variables** - Set `SITE_URL` and `SUCCESS_URL`
3. **Netlify Domain Settings** - Update custom domain
4. **DNS Records** - Update domain pointing
5. **Coinbase Webhooks** - Update callback URLs

### Priority 2 (Important for correct operation):

6. **Netlify Environment Variables** - Update any URL references
7. **GitHub Secrets/Variables** - Update deployment URLs
8. **Supabase Auth Settings** - Update site URL and redirect URLs

### Priority 3 (Documentation/Testing):

9. **Scripts** - Update testing and deployment scripts
10. **Documentation** - Update all documentation files (optional, mainly for reference)

---

## 9. DEPLOYMENT SEQUENCE

**Recommended order for updates**:

1. **Update DNS** - Add new `stage.theprize.io` DNS record pointing to Netlify
2. **Update Netlify** - Add custom domain `stage.theprize.io`
3. **Update Supabase Environment Variables** - Set SITE_URL to `stage.theprize.io`
4. **Update Supabase Edge Functions** - Deploy updated functions with new URLs
5. **Update Supabase Auth Settings** - Set site URL and redirect URLs
6. **Update External Services** - Update Coinbase, SendGrid webhook URLs
7. **Test thoroughly** - Verify all payment flows, authentication, and API calls
8. **Update scripts** - Update testing and deployment scripts
9. **Update documentation** - Update reference documentation

---

## 10. VERIFICATION CHECKLIST

After updates, verify:

- [ ] Site loads at `stage.theprize.io`
- [ ] Authentication works (email auth, social auth)
- [ ] Payment flows work (Coinbase Onramp/Offramp)
- [ ] Ticket purchases work
- [ ] User profile updates work
- [ ] CORS errors are resolved
- [ ] Redirects after payment work correctly
- [ ] Email notifications have correct links
- [ ] All API endpoints respond correctly
- [ ] Webhooks from external services work

---

## NOTES

- **Environment Variable Strategy**: Most functions use `Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io'`, which means setting the `SITE_URL` environment variable in Supabase will update most functions without code changes. However, the hardcoded fallback values should still be updated.

- **Mixed stage/substage**: Some onramp/offramp functions already use `stage.theprize.io` while others use `substage.theprize.io`. This inconsistency should be resolved.

- **Documentation**: The documentation files in `docs/archive/` and `debug/` are extensive but may be historical/reference material. Updating them is optional but recommended for future reference.

- **No GitHub Workflows**: No `.github/workflows` directory was found, but check GitHub UI for any workflows configured at the repository level.
