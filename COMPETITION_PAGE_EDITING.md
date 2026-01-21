# Competition Page Text Editing Guide

## Overview
You can now edit the text content on individual competition pages through the visual editor. These changes **directly affect the live site** for all competitions.

## What Was Fixed
- ❌ **REMOVED**: Useless "Competition Title" placeholder text that couldn't be edited
- ✅ **ADDED**: 4 editable text fields that affect the LIVE site

## Editable Fields (4 fields)

1. **Ticket Numbers Description** - Explains how ticket numbers work and instant wins
2. **Pictures Disclaimer** - Disclaimer about pictures being for illustration only
3. **Minimum Win Text** - Text about minimum site credit wins  
4. **Additional Info** - Optional extra text (can be blank)

## How to Edit (Affects LIVE Site)

### Step 1: Access the Visual Editor
1. Go to `/a/e/o/x/u`
2. Enter password: `aintn0body`
3. Navigate to `/a/e/o/x/u/editor`

### Step 2: Select Competition Page
1. In the dropdown at the top, select **"🎫 Individual Competition Page"**
2. Click on the **"Text Content"** tab in the left panel

### Step 3: Edit the Text
1. You'll see 4 text fields you can edit
2. Changes appear in the live preview immediately
3. Edit as needed

### Step 4: Download and Deploy
1. Click the **Download** button (💾 icon)
2. This downloads a file called `competitionPageConfig.ts`
3. Replace the file at `src/config/competitionPageConfig.ts` with the downloaded version
4. Commit and push to GitHub
5. Deploy - **your changes are now LIVE** on all competition pages!

## Technical Details

### Files Involved
- **Live Site Config**: `src/config/competitionPageConfig.ts` - The source of truth for live site text
- **Component**: `src/components/IndividualCompetition/IndividualCompetitionInfo.tsx` - Uses the config
- **Editor**: `src/pages/AuthModalVisualEditor.tsx` - Visual editor for making changes

### How It Works
1. The live competition pages read text from `src/config/competitionPageConfig.ts`
2. The visual editor loads these same values for editing
3. When you download from the editor, you get an updated config file
4. Replace the old config file with the new one and deploy
5. All competition pages instantly use the new text

## Important Notes

- ⚠️ These text changes affect **ALL competition pages** sitewide
- ⚠️ You must download and commit the file for changes to persist
- ⚠️ The editor preview shows changes, but they won't be live until you deploy
- ✅ The useless "Competition Title" placeholder has been removed completely
- ✅ No database changes needed - just file updates

## Example Workflow

```bash
# 1. Edit text in visual editor at /a/e/o/x/u/editor
# 2. Download the config file
# 3. Replace the existing file
mv ~/Downloads/competitionPageConfig.ts src/config/competitionPageConfig.ts

# 4. Commit and push
git add src/config/competitionPageConfig.ts
git commit -m "Update competition page text content"
git push

# 5. Deploy (your deployment process)
# Changes are now LIVE!
```
