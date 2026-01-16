# Modal Visual Editor

## Overview

The Modal Visual Editor is an admin-only tool for modifying aesthetic properties, authentication flow order, and button links for multiple modals:
- `NewAuthModal.tsx` - Main authentication flow
- `BaseWalletAuthModal.tsx` - Wallet connection modal  
- `PaymentModal.tsx` - Payment and checkout modal
- `TopUpWalletModal.tsx` - Balance top-up modal

**Important:** This editor generates downloadable TypeScript files for developers to apply manually. It does NOT write directly to GitHub.

## Access

**Secret Route:** `https://substage.theprize.io/a/e/o/x/u`

This route is:
- **Admin-only:** Requires `is_admin = true` in the `canonical_users` table
- **Unindexable:** Blocked in `robots.txt` to prevent search engine indexing
- **Hidden:** Not linked from any public pages or navigation

## Features

### 1. Modal Selection
- **Select from 4 modals** to edit:
  - NewAuthModal - Authentication flow
  - BaseWalletAuthModal - Wallet connection
  - PaymentModal - Payment processing
  - TopUpWalletModal - Balance top-up
- Each modal has specific editable properties
- Tabs shown dynamically based on modal capabilities

### 2. Button Visibility & Management (⭐ ENHANCED)
- **Hide/Show Buttons:** Toggle button visibility without deleting configuration
- **Dynamic Button Creation:** Add new buttons using predefined templates
- **Button Reordering:** Drag-and-drop to change display order (⭐ NEW)
- **Button Templates:**
  - Payment Method Button - For new payment options
  - Wallet Connection Button - For specific wallet providers
  - External Link Button - Link to external resources
  - Internal Navigation Button - Navigate within the app
- **Icon Support:** Add custom icons to buttons via URL
- **Visual Indicators:** Hidden buttons are clearly marked with badges
- **Safe Editing:** Hidden buttons won't appear in modal but retain all settings

**Use Cases:**
- Temporarily hide a payment method without losing configuration
- Add Apple Pay as a new payment option with custom icon
- Propose new wallet connection options (MetaMask, WalletConnect, etc.)
- Test button configurations before making them live
- Reorder buttons to feature preferred payment methods first

### 3. Section Visibility Management (⭐ NEW)
- **Hide/Show Sections:** Control visibility of entire modal sections
- **Section Groups:** Manage related content together
- **Locked Sections:** Core sections cannot be hidden for functionality
- **Visual Feedback:** Hidden sections clearly marked

**Available Sections:**
- Payment Methods Section (can hide)
- Balance Information (locked - core)
- Order Summary (locked - core)
- Top-Up Methods Section (can hide)

**Use Cases:**
- Simplify modals for specific user segments
- A/B test different layouts
- Regional customization
- Progressive disclosure strategies

### 3. Flow Order Editor
- **Reorder authentication steps** via drag-and-drop (auth modals only)
- **Enable/disable steps** to skip or include them in the flow
- **Customize user experience** while ensuring required data is collected
- **Requirements enforced:** Username, email, country, wallet, and OTP verification must be collected
- **Locked steps:** Some steps (like OTP verification after email, success screen) cannot be reordered for security

**Use Cases:**
- Start BaseWalletAuth on wallet selection screen instead of email screen
- Skip username entry and collect it during profile completion
- Change order: wallet → email → profile instead of email → profile → wallet
- Remove optional steps from the flow entirely

### 4. Color Editor
- Modify all color properties including:
  - Background colors
  - Text colors (primary, secondary, muted)
  - Button colors (primary, secondary, hover states)
  - Success/error/warning message colors
  - Input field colors
  - Accent colors (payment modals)
- Uses standard color picker and hex input
- **Locked elements:** Functional components (input backgrounds, focus states) are locked to preserve authentication flow

### 5. Font Editor
- Adjust typography for:
  - Headings (size, weight, family)
  - Subheadings
  - Body text
  - Buttons
  - Inputs
  - Special text (prices, amounts)
- Supports:
  - Font family selection (System Default, Inter, Roboto, Open Sans, Poppins)
  - Font size (rem, px, em)
  - Font weight (300-700)
  - Font style (normal, italic)
- **Locked elements:** Button and input fonts are locked to maintain usability

### 6. Text Content Editor
- Edit text content including:
  - Modal titles and subtitles
  - Success messages
  - Helper text
  - Instructions
  - Payment descriptions
  - Method labels
- Supports single-line and multi-line text fields
- **Locked elements:** Functional labels and error messages are locked

### 7. Image Editor (ENHANCED! ⭐)
- Upload and replace images/icons with intelligent validation
- **Image Type Classification:**
  - Logo - Brand logos with flexible dimensions
  - Icon - UI icons with specific size requirements
  - Wallet Icon - Wallet provider icons (standardized)
  - Payment Icon - Payment method icons
  - Background - Background images
- **Format Validation:**
  - Preferred formats displayed (SVG, PNG, WebP)
  - Format mismatch warnings (allows upload but suggests conversion)
  - Accept attribute customized per image type
- **Dimension Recommendations:**
  - Shows recommended dimensions for each image type
  - Validates uploaded image dimensions
  - Warns if dimensions don't match recommendations
- **Size Validation:**
  - Maximum file size: 2MB
  - Clear error messages for oversized files
- **Enhanced Preview:**
  - Better formatted previews
  - Image metadata badges (type, format)
  - Visual feedback on successful upload
- **Flexible Input:**
  - File upload support
  - URL input for icons (hosted elsewhere)

**Use Cases:**
- Upload wallet icons with proper format validation (SVG preferred)
- Replace payment method icons with standardized dimensions
- Add custom branding with appropriate format recommendations
- Ensure icons meet quality standards before integration

**Locked elements:** Functional icons (loading spinners, checkmarks) are locked

### 8. Button Link Editor (ENHANCED! ⭐)
- **Configure button links** with multiple options:
  - **None** - Keep default action
  - **External URL** - Link to external website
  - **Internal Route** - Navigate to app route
  - **Action/Function** - Trigger specific function
- **Dependency Warnings:**
  - Buttons with ⚠️ icon have functional dependencies
  - Shows list of dependencies that may break
  - Warns before allowing link changes
  - Examples: Payment buttons, top-up buttons
- **Use Cases:**
  - Link "Top Up Balance" to external payment page
  - Redirect "Learn More" button to FAQ
  - Change payment method links
  
### 9. Preset Management (⭐ NEW)
- **Save Configurations:** Save complete editor state as named presets
- **Load Presets:** Instantly switch between saved configurations
- **Persistent Storage:** Presets saved in browser localStorage
- **Modal-Specific:** Only see presets for current modal type
- **Metadata Tracking:** Name, description, timestamp for each preset

**Use Cases:**
- Save seasonal themes ("Holiday 2026", "Summer Theme")
- A/B testing configurations ("Variant A", "Variant B")
- Work-in-progress saves
- Quick design switching
- Team standardization

### 10. Undo/Redo System (⭐ NEW)
- **History Tracking:** Up to 50 previous states saved
- **Undo Changes:** Revert to previous state with one click
- **Redo Changes:** Reapply undone changes
- **Visual Feedback:** Buttons disabled at history limits
- **Safe Experimentation:** Try changes risk-free

**Use Cases:**
- Recover from mistakes quickly
- Compare different states by toggling
- Iterative design workflow
- Test multiple variations safely

### 11. Export/Import Configuration (⭐ NEW)
- **Export to JSON:** Download complete configuration as file
- **Import from JSON:** Load configurations from file
- **Team Collaboration:** Share configurations between team members
- **Validation:** Ensures modal type compatibility
- **Backup:** Save configurations externally

**Use Cases:**
- Share configurations with developers
- Version control configurations externally
- Copy settings between environments
- Backup important configurations
- Client approval workflows

### 12. Live Preview
- Real-time preview of changes (auth modals only)
- Can be toggled on/off
- Opens modal in preview mode
- Payment modals show notice (require additional context)
- Preview helps visualize color/font changes

### 13. File Download System
- **Downloads TypeScript file** instead of writing to GitHub
- **Generated file includes:**
  - All customizations (colors, fonts, texts, buttons)
  - Detailed integration instructions
  - Dependency warnings
  - Testing checklist
  - Manual application guide
- **Filename format:** `{ModalName}-customizations-{timestamp}.tsx`
- **Send to developer** to manually apply changes
- **Safe approach** - no automatic GitHub writes

## Security

### Admin Authentication
1. User must be logged in with a wallet address
2. Wallet address must have `is_admin = true` in `canonical_users` table
3. Route protected with AdminGuard component

### File Safety
- **No automatic GitHub writes** - all changes downloaded as files
- Only modifies specified aesthetic properties
- Never touches functional code
- Validates all inputs
- Locked elements cannot be modified
- Developer reviews all changes before applying

### Current Implementation
The editor generates complete TypeScript files with customizations for developers to manually integrate. This ensures:
- Human review of all changes
- No accidental breaking changes
- Full control over what gets deployed
- Testing before merging

## Usage Guide

### Step 1: Access the Editor
1. Log in as an admin user
2. Navigate to `https://substage.theprize.io/a/e/o/x/u`
3. You should see the Visual Editor interface

### Step 2: Select Modal to Edit
1. Use the dropdown at the top to select which modal to edit:
   - **NewAuthModal.tsx** - Main authentication flow
   - **BaseWalletAuthModal.tsx** - Wallet connection
   - **PaymentModal.tsx** - Payment processing (NEW!)
   - **TopUpWalletModal.tsx** - Balance top-up (NEW!)

### Step 3: Make Changes
1. Click on the tabs (available tabs vary by modal):
   - **Flow Order** - Reorder auth steps (auth modals only)
   - **Colors** - Modify color properties
   - **Fonts** - Adjust typography
   - **Text Content** - Edit text strings
   - **Images** - Upload/replace images
   - **Buttons** - Configure button links (payment modals)
2. Modify properties as needed
3. See changes reflected in "hasChanges" indicator

### Step 4: Download Changes
1. Click **Download File** button (replaces "Save Changes")
2. File downloads to your computer as `{ModalName}-customizations-{timestamp}.tsx`
3. Success message shows filename
4. File includes all customizations and integration instructions

### Step 5: Send to Developer
1. **Email or share** the downloaded file with your developer
2. Developer reviews the customizations
3. Developer manually applies changes to actual modal file
4. Developer tests thoroughly
5. Developer commits and deploys changes

### Step 6: Reset if Needed
- Click **Reset** to discard unsaved changes
- Reload the page to start fresh

## Button Visibility & Creation Guide (NEW! ⭐)

### Hiding/Showing Buttons

**To hide a button:**
1. Navigate to the **Buttons** tab
2. Find the button you want to hide
3. Click the **Hide** button on the right side
4. Button becomes visually dimmed with a "Hidden" badge
5. Hidden buttons won't appear in the modal but retain all settings

**To show a hidden button:**
1. Find the hidden button (marked with "Hidden" badge)
2. Click the **Show** button
3. Button becomes active again

**Use Cases:**
- Temporarily disable a payment method during maintenance
- A/B test different button configurations
- Hide seasonal payment options when not available
- Test new button configurations before enabling

### Adding New Buttons

**Prerequisites:**
- Only available for PaymentModal and TopUpWalletModal
- Must be on the **Buttons** tab

**Steps to add a new button:**
1. Click **"Add New Button"** section (expands form)
2. Choose a template or create custom:
   - **Payment Method** - New payment option
   - **Wallet Connection** - Specific wallet provider
   - **External Link** - Link to external resource
   - **Internal Navigation** - Navigate within app
3. Fill in required fields:
   - **Button Name** - Unique identifier (e.g., `applePayButton`)
   - **Button Label** - Display text (e.g., "Pay with Apple Pay")
   - **Link Type** - Action, URL, Route, or None
   - **Link Value** - The action/URL/route
   - **Icon URL** (optional) - Icon image URL
   - **Description** - Brief description
4. Click **"Add Button"**
5. Button appears in the list

**Button Name Guidelines:**
- Must be unique (not already used)
- Use camelCase (e.g., `myNewButton`)
- Descriptive but concise
- No spaces or special characters

**Icon URL Examples:**
- `https://example.com/icons/applepay.svg`
- `/public/icons/metamask.png`
- CDN URLs for common icons

**Validation:**
- Duplicate names are rejected
- Icon preview shown if URL is valid
- Name and label are required fields

### Managing Button Icons

**To add/change a button icon:**
1. In the Buttons tab, find the button
2. Locate the "Icon URL" field
3. Enter the full URL to the icon image
4. Icon preview appears below if valid
5. Icon is included in the downloaded configuration

**Icon Recommendations:**
- Format: SVG (scalable), PNG (with transparency), or WebP
- Size: 24×24px to 40×40px for optimal display
- Hosted: Use CDN or public URL for reliability
- Quality: High-resolution for Retina displays

## Button Link Configuration

### Link Types

1. **None (Default Action)**
   - Keeps the button's original functionality
   - No custom linking applied
   - Safest option for buttons with dependencies

2. **External URL**
   - Opens a website in new tab
   - Example: `https://help.theprize.io`
   - Use for: Help links, documentation, external resources

3. **Internal Route**
   - Navigates within the app
   - Example: `/dashboard`, `/competitions`
   - Use for: Navigation to app pages

4. **Action/Function**
   - Triggers a specific function
   - Example: `openTopUpModal`, `processPayment`
   - Use for: Custom actions, modal triggers

### Dependency Warnings

Buttons with ⚠️ icon have functional dependencies:
- **PaymentModal Buttons:**
  - Balance Payment → Depends on balance check, transaction API
  - Card Payment → Depends on Coinbase Commerce API
  - Crypto Payment → Depends on OnchainKit, wallet connection
  - Top Up Link → Depends on TopUpWalletModal component
  
- **TopUpWalletModal Buttons:**
  - Instant Top-Up → Depends on wallet, USDC balance, treasury
  - Crypto Top-Up → Depends on OnchainKit, Coinbase Commerce
  - Card Top-Up → Depends on Coinbase Commerce API

**Best Practice:** Only change button links if you understand the dependencies and have developer support.

## Locked Elements Explanation

Some elements are marked with a 🔒 lock icon. These are **functional components** that are essential for the modal to work properly. They cannot be modified to prevent breaking functionality.

**Examples of locked elements:**
- Input field backgrounds (need contrast for visibility)
- Input focus states (accessibility requirement)
- Button functionality-related styles
- Loading indicators
- Validation icons
- Form submission logic
- Core payment buttons

## Technical Details

### Architecture
```
Visual Editor (React Component)
    ↓
Modal Selection & Customization
    ↓
Download TypeScript File
    ↓
Developer Review & Integration
    ↓
Manual Application to Actual Files
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

## Quick Reference

### Available Features by Modal Type

| Feature | NewAuthModal | BaseWalletAuthModal | PaymentModal | TopUpWalletModal |
|---------|--------------|---------------------|--------------|------------------|
| Flow Order | ✅ | ✅ | ❌ | ❌ |
| Colors | ✅ | ✅ | ✅ | ✅ |
| Fonts | ✅ | ✅ | ✅ | ✅ |
| Text Content | ✅ | ✅ | ✅ | ✅ |
| Images | ✅ | ❌ | ❌ | ❌ |
| Buttons | ❌ | ❌ | ✅ | ✅ |
| Sections | ❌ | ❌ | ✅ | ✅ |
| Presets | ✅ | ✅ | ✅ | ✅ |
| Undo/Redo | ✅ | ✅ | ✅ | ✅ |
| Export/Import | ✅ | ✅ | ✅ | ✅ |

### Keyboard Shortcuts
- Currently none implemented
- Future: Ctrl+Z (Undo), Ctrl+Y (Redo), Ctrl+S (Save Preset)

### Related Documentation
- **[UI Editor Enhancements Summary](./UI_EDITOR_ENHANCEMENTS_SUMMARY.md)** - Original features implementation
- **[Proactive Features Summary](./PROACTIVE_FEATURES_SUMMARY.md)** - Advanced features deep dive
- **[Enhanced Editor Summary](./ENHANCED_EDITOR_SUMMARY.md)** - Historical context

### Feature Status
- ✅ **Implemented:** Button visibility, button creation, image validation, button reordering, section visibility, presets, undo/redo, export/import
- 🚧 **Framework Ready:** Bulk operations (UI pending)
- 💡 **Planned:** Keyboard shortcuts, theme presets, version history

## Support

For issues or questions, contact the development team or file an issue in the admin repository.

## License

This tool is part of The Prize platform and is proprietary software. Unauthorized access or use is prohibited.
