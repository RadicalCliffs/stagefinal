# Auth Modal Visual Editor

## Overview

The Auth Modal Visual Editor is an admin-only tool for modifying both the aesthetic properties AND authentication flow order of the authentication modals (`NewAuthModal.tsx` and `BaseWalletAuthModal.tsx`) without touching code.

## Access

**Secret Route:** `https://substage.theprize.io/a/e/o/x/u`

This route is:
- **Admin-only:** Requires `is_admin = true` in the `canonical_users` table
- **Unindexable:** Blocked in `robots.txt` to prevent search engine indexing
- **Hidden:** Not linked from any public pages or navigation

## Features

### 1. Flow Order Editor (NEW!)
- **Reorder authentication steps** via drag-and-drop
- **Enable/disable steps** to skip or include them in the flow
- **Customize user experience** while ensuring required data is collected
- **Requirements enforced:** Username, email, country, wallet, and OTP verification must be collected
- **Locked steps:** Some steps (like OTP verification after email, success screen) cannot be reordered for security

**Use Cases:**
- Start BaseWalletAuth on wallet selection screen instead of email screen
- Skip username entry and collect it during profile completion
- Change order: wallet → email → profile instead of email → profile → wallet
- Remove optional steps from the flow entirely

### 2. Color Editor
- Modify all color properties including:
  - Background colors
  - Text colors (primary, secondary, muted)
  - Button colors (primary, secondary, hover states)
  - Success/error/warning message colors
  - Input field colors
- Uses standard color picker and hex input
- **Locked elements:** Functional components (input backgrounds, focus states) are locked to preserve authentication flow

### 3. Font Editor
- Adjust typography for:
  - Headings (size, weight, family)
  - Subheadings
  - Body text
  - Buttons
  - Inputs
- Supports:
  - Font family selection (System Default, Inter, Roboto, Open Sans, Poppins)
  - Font size (rem, px, em)
  - Font weight (300-700)
  - Font style (normal, italic)
- **Locked elements:** Button and input fonts are locked to maintain usability

### 4. Text Content Editor
- Edit text content including:
  - Modal titles and subtitles
  - Success messages
  - Helper text
  - Instructions
- Supports single-line and multi-line text fields
- **Locked elements:** Functional labels and error messages are locked

### 5. Image Editor
- Upload and replace images/icons
- Supports:
  - Logo replacements
  - Icon uploads
  - Background images
- File upload with preview
- **Locked elements:** Functional icons (loading spinners, checkmarks for validation) are locked

### 5. Live Preview
- Real-time preview of changes
- Can be toggled on/off
- Opens modal in preview mode
- Shows exactly how changes will appear

## Security

### Admin Authentication
1. User must be logged in with a wallet address
2. Wallet address must have `is_admin = true` in `canonical_users` table
3. API endpoint validates admin status before allowing writes

### File Writing Safety
- Only modifies specified aesthetic properties
- Never touches functional code
- Validates all inputs
- Locked elements cannot be modified
- Uses TypeScript AST parsing (planned) for safe code manipulation

### Current Implementation
The current implementation generates CSS override files instead of directly modifying TypeScript files for safety. A future enhancement will implement full TypeScript AST parsing for direct file modifications.

## Usage Guide

### Step 1: Access the Editor
1. Log in as an admin user
2. Navigate to `https://substage.theprize.io/a/e/o/x/u`
3. You should see the Visual Editor interface

### Step 2: Select Modal to Edit
1. Use the dropdown at the top to select which modal to edit:
   - **NewAuthModal.tsx** - Main authentication flow modal
   - **BaseWalletAuthModal.tsx** - Wallet connection modal

### Step 3: Make Changes
1. Click on the tabs: **Colors**, **Fonts**, **Text Content**, or **Images**
2. Modify properties as needed
3. Toggle **Show Preview** to see changes in real-time
4. Click **Open Modal** in the preview panel to interact with the modal

### Step 4: Save Changes
1. Click **Save Changes** button
2. Wait for confirmation message
3. Changes are written to the respective files
4. A rebuild/redeploy may be required to see changes in production

### Step 5: Reset if Needed
- Click **Reset** to discard unsaved changes
- Reload the page to get fresh data from files

## Locked Elements Explanation

Some elements are marked with a 🔒 lock icon. These are **functional components** that are essential for authentication to work properly. They cannot be modified to prevent breaking the login flow.

**Examples of locked elements:**
- Input field backgrounds (need contrast for visibility)
- Input focus states (accessibility requirement)
- Button functionality-related styles
- Loading indicators
- Validation icons
- Form submission logic

## Technical Details

### Architecture
```
Visual Editor (React Component)
    ↓
Auth Modal Files (NewAuthModal.tsx, BaseWalletAuthModal.tsx)
    ↓
Netlify Function (/api/update-auth-modal-styles)
    ↓
File System (TypeScript files)
```

### Files Involved
- `/src/pages/AuthModalVisualEditor.tsx` - Main editor component
- `/src/components/AdminGuard.tsx` - Route protection
- `/src/lib/admin-auth.ts` - Admin authentication helpers
- `/netlify/functions/update-auth-modal-styles.mts` - File writing API
- `/public/robots.txt` - Search engine blocking

### Database Schema
The editor relies on the `is_admin` column in `canonical_users`:
```sql
SELECT is_admin FROM canonical_users WHERE wallet_address = '0x...';
```

## Development

### Adding New Editable Properties

1. **Add to EditorState interface:**
```typescript
colors: ColorProperty[];
fonts: FontProperty[];
texts: TextProperty[];
images: ImageProperty[];
```

2. **Add to loadModalProperties:**
```typescript
colors: [
  { name: 'newColor', label: 'New Color', value: '#000000', description: '...' },
]
```

3. **Update API endpoint** to handle new property types

4. **Add mapping in modal files** to use the properties

### Testing

1. Create a test admin user:
```sql
UPDATE canonical_users 
SET is_admin = true 
WHERE wallet_address = 'YOUR_WALLET_ADDRESS';
```

2. Log in with that wallet
3. Navigate to `/a/e/o/x/u`
4. Test all functionality

## Troubleshooting

### "Unauthorized - Admin access required"
- Ensure you're logged in
- Check that your wallet has `is_admin = true` in the database
- Verify wallet address in localStorage matches database

### Changes Not Saving
- Check browser console for errors
- Verify API endpoint is accessible
- Check Netlify function logs
- Ensure sufficient permissions on file system

### Preview Not Working
- Check that modal components are importing correctly
- Verify no TypeScript errors in modal files
- Check browser console for rendering errors

## Future Enhancements

1. **Direct TypeScript AST Parsing**
   - Parse TypeScript files using TypeScript Compiler API
   - Find and replace specific JSX properties
   - Preserve all formatting and comments

2. **Drag-and-Drop Layout Editor**
   - Visual positioning of elements
   - Resize components
   - Reorder sections

3. **Theme Presets**
   - Save multiple color schemes
   - Quick theme switching
   - Import/export themes

4. **Version History**
   - Track all changes
   - Rollback to previous versions
   - Compare versions

5. **Multi-Admin Support**
   - Concurrent editing locks
   - Change notifications
   - Conflict resolution

## Support

For issues or questions, contact the development team or file an issue in the admin repository.

## License

This tool is part of The Prize platform and is proprietary software. Unauthorized access or use is prohibited.
