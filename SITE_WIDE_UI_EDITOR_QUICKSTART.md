# Quick Start Guide: Site-Wide UI Editor

## Overview
The Site-Wide UI Editor is a Wix-like visual editor integrated into theprize.io that allows admins to customize images, colors, and navigation across the entire website without touching code.

## Access
1. **Log in** with admin wallet at https://theprize.io
2. **Navigate to** https://theprize.io/a/e/o/x/u/editor
3. **Click** the "Site-Wide UI" tab (highlighted in yellow)

## What You Can Edit

### 📷 Images
**Categories:**
- **Logos**: Header logo, mobile logo, footer logo
- **Hero Images**: Main hero section background, landing page backgrounds
- **Icons**: Decorative graphics (smash graphic, etc.)
- **Backgrounds**: Section backgrounds

**How to Edit:**
1. Go to "Site-Wide UI" tab → "Images" sub-tab
2. Find the image you want to change
3. Click "Upload New"
4. Select your image file (max 5MB)
5. See instant preview

### 🎨 Colors
**Available Colors:**
- Primary Yellow (#DDE404) - Buttons, highlights
- Primary Pink (#EF008F) - Accents, alerts
- Base Blue (#0052FF) - Links, Coinbase branding
- Dark Background (#1A1A1A) - Main backgrounds
- White Text (#FFFFFF) - Primary text

**How to Edit:**
1. Go to "Site-Wide UI" tab → "Colors" sub-tab
2. Click the color picker OR type hex code
3. See live preview
4. Check "Used in" to see where it appears

### 🧭 Navigation
**Menu Items:**
- Home, Competitions, How to Play, Winners, About
- Add custom pages
- Reorder items
- Show/hide items

**How to Edit:**
1. Go to "Site-Wide UI" tab → "Navigation" sub-tab
2. Edit label, path, or order
3. Toggle "Visible" checkbox
4. Click "Add Menu Item" for new pages
5. Click trash icon to delete

## Saving Changes

### Option 1: Create Pull Request (Recommended)
1. Make all your changes
2. Click "Create Pull Request" (top right)
3. Note the PR number
4. Share PR number with developer for review
5. Changes go live after developer approves

**Benefits:**
- Changes reviewed before going live
- Safe rollback if needed
- Full audit trail

### Option 2: Download Configuration
1. Make all your changes
2. Click "Download Config" (top right)
3. Save JSON file
4. Email file to developer
5. Developer applies changes manually

## Important Notes

⚠️ **Changes Don't Go Live Immediately**
- All changes are saved to a Pull Request
- Developer reviews and approves before deployment
- This protects the live site from accidental changes

✅ **Preview Capability**
- Switch to other tabs (Colors, Images, Buttons) to see changes in modals
- Color changes affect modal appearance instantly
- Full site preview available after PR is merged

🔒 **Security**
- Admin-only access (requires database permission)
- All changes tracked in Git
- No direct file system access
- Review process enforced

## Troubleshooting

**"Unsaved changes" indicator stuck?**
- Create PR or download config to clear

**Image not uploading?**
- Check file size (must be under 5MB)
- Check file type (PNG, JPG, SVG, WebP only)

**Can't see changes on live site?**
- Changes require PR approval and merge
- Check with developer for PR status

**Don't have access?**
- Admin must enable your wallet address in database
- Contact admin to grant access

## Example Workflows

### Change Main Logo
1. Go to `/a/e/o/x/u/editor`
2. Click "Site-Wide UI" tab
3. Click "Images" sub-tab
4. Find "Main Logo" under "Logo Images"
5. Click "Upload New"
6. Select new logo file
7. Preview appears instantly
8. Click "Create Pull Request"
9. Share PR number with developer

### Update Brand Colors
1. Go to `/a/e/o/x/u/editor`
2. Click "Site-Wide UI" tab
3. Click "Colors" sub-tab
4. Find "Primary Yellow"
5. Use color picker or type new hex code
6. See preview in modal tabs
7. Repeat for other colors
8. Click "Create Pull Request"

### Add New Menu Item
1. Go to `/a/e/o/x/u/editor`
2. Click "Site-Wide UI" tab
3. Click "Navigation" sub-tab
4. Click "Add Menu Item"
5. Fill in:
   - Label: "Blog"
   - Path: "/blog"
   - Order: 6
   - Visible: ✓
6. Click "Create Pull Request"

## Developer Notes

### Setting Up Admin Access
```sql
UPDATE canonical_users 
SET is_admin = true 
WHERE wallet_address = '0xYourWalletAddress';
```

### Environment Variables Needed
```
GITHUB_TOKEN=<github-personal-access-token>
GITHUB_REPO_OWNER=teamstack-xyz
GITHUB_REPO_NAME=theprize.io
```

### GitHub Token Permissions
- `repo` (full repository access)
- Ability to create branches and PRs

### Reviewing PRs
1. Check GitHub for new PR from editor
2. Review configuration JSON file
3. Verify image quality and optimization
4. Test color accessibility (contrast ratios)
5. Validate navigation links work
6. Merge when satisfied
7. Deploy to production

## Support

**Questions?**
- Check COMPREHENSIVE_UI_EDITOR_IMPLEMENTATION.md for full documentation
- Contact development team for technical issues
- Request features via GitHub issues

**Bug Reports:**
- Include steps to reproduce
- Screenshot if possible
- Note which browser/device

## Version History

**v1.0 (Current)**
- Integrated site-wide editor into existing modal editor
- Image management (logos, hero, backgrounds, icons)
- Color theme editor
- Navigation menu editor
- GitHub PR integration
- Configuration download

**Planned Features:**
- Layout editor (drag-and-drop positioning)
- Content editor (inline text editing)
- Font manager (custom font uploads)
- A/B testing (multiple theme variants)
- Version history (revert to previous configs)

---

**Last Updated:** 2026-01-18  
**Location:** `/a/e/o/x/u/editor` → "Site-Wide UI" tab  
**Access Level:** Admin only  
**Status:** ✅ Production Ready
