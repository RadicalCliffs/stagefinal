# Quick Reference: URL Migration substage → stage

## 📋 Executive Summary

When migrating from `substage.theprize.io` to `stage.theprize.io`, **61 locations** across the codebase and external services need updates.

For the complete detailed checklist, see [URL_UPDATE_CHECKLIST.md](./URL_UPDATE_CHECKLIST.md)

---

## 🎯 Critical Updates (Must Do First)

### 1. Supabase Dashboard
- Set environment variable: `SITE_URL=https://stage.theprize.io`
- Set environment variable: `SUCCESS_URL=https://stage.theprize.io`
- Update Auth settings → Site URL to `https://stage.theprize.io`
- Update Auth settings → Redirect URLs

### 2. Netlify Dashboard
- Update custom domain from `substage.theprize.io` to `stage.theprize.io`
- Update environment variables (check for any URL references)

### 3. DNS Provider
- Update DNS records:
  - Remove/update: `substage.theprize.io`
  - Add: `stage.theprize.io` → points to Netlify

### 4. External Services
- **Coinbase Commerce/Onramp**: Update webhook and redirect URLs
- **SendGrid**: Check email templates and webhook URLs

---

## 📁 Code Files to Update

### Supabase Edge Functions (26 files)

**Primary CORS file:**
- `supabase/functions/_shared/cors.ts` - Lines 4, 7

**Individual functions (11 files with inlined CORS):**
1. `supabase/functions/confirm-pending-tickets/index.ts`
2. `supabase/functions/create-new-user/index.ts`
3. `supabase/functions/email-auth-start/index.ts`
4. `supabase/functions/email-auth-verify/index.ts`
5. `supabase/functions/get-user-profile/index.ts`
6. `supabase/functions/lucky-dip-reserve/index.ts`
7. `supabase/functions/payments-auto-heal/index.ts`
8. `supabase/functions/reserve-tickets/index.ts`
9. `supabase/functions/reserve_tickets/index.ts` (legacy)
10. `supabase/functions/update-user-avatar/index.ts`
11. `supabase/functions/upsert-user/index.ts`

**Payment redirect URLs (5 files):**
- `supabase/functions/create-charge/index.ts` - Line 68
- `supabase/functions/offramp-cancel/index.ts` - Line 37
- `supabase/functions/offramp-complete/index.ts` - Line 38
- `supabase/functions/onramp-cancel/index.ts` - Line 37
- `supabase/functions/onramp-complete/index.ts` - Line 38

**Onramp/Offramp CORS (10 files with stage.theprize.io):**
- Note: These already have `stage.theprize.io` but also have `substage` in redirect URLs
- Review for consistency

### Scripts (4 files)
- `scripts/verify-cors-fix.sh`
- `scripts/verify-cors-deployment.sh`
- `scripts/deploy-cors-fix.sh`
- `scripts/deploy-edge-functions.sh`

---

## 📝 Documentation Files (Optional)

**Debug docs (15 files):** `debug/*.md`  
**Archive docs (14 files):** `docs/archive/*.md`  
**Test files:** `docs/archive/test-files/test-cors-rpc.html`

*These are optional updates - mainly for reference and testing*

---

## ✅ Deployment Sequence

1. **Prepare DNS** - Add `stage.theprize.io` DNS record
2. **Update Netlify** - Add custom domain
3. **Update Code** - Change all hardcoded URLs in Edge Functions
4. **Deploy Functions** - `supabase functions deploy`
5. **Update Supabase Env Vars** - Set SITE_URL, SUCCESS_URL
6. **Update Supabase Auth** - Site URL and redirect URLs
7. **Update External Services** - Coinbase, SendGrid
8. **Test Everything** - Full payment and auth flow testing
9. **Update Scripts** - Testing and deployment scripts
10. **Update Docs** - Optional documentation updates

---

## 🔍 Verification After Deployment

- [ ] Site loads at `stage.theprize.io`
- [ ] Authentication works
- [ ] Coinbase Onramp works
- [ ] Coinbase Offramp works
- [ ] Ticket purchases work
- [ ] No CORS errors in browser console
- [ ] Payment redirects work correctly
- [ ] Email links point to correct domain

---

## 💡 Pro Tips

1. **Environment Variables First**: Set `SITE_URL` in Supabase Dashboard before deploying functions. Most functions check this env var first.

2. **Test in Isolation**: Test each payment flow (onramp, offramp, direct purchase) separately.

3. **Keep Substage Alive**: Consider keeping `substage.theprize.io` in ALLOWED_ORIGINS temporarily during migration for zero-downtime deployment.

4. **Check Webhooks**: External services like Coinbase send webhooks - ensure they're updated or they'll fail silently.

5. **Browser Cache**: Clear browser cache when testing to avoid cached redirects.

---

## 📞 Need Help?

See the complete detailed checklist: [URL_UPDATE_CHECKLIST.md](./URL_UPDATE_CHECKLIST.md)
