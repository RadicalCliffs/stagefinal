# Quick Start Guide - Front-End Package for Bolt

## Overview
This guide provides step-by-step instructions to use the ThePrize.io front-end package in Bolt.

## Prerequisites
- Access to Bolt or a similar development environment
- Basic knowledge of React and TypeScript
- Access to the following credentials (for full functionality):
  - Coinbase CDP API Key
  - Coinbase CDP Project ID
  - Supabase URL and Anon Key
  - Treasury wallet address

## Step 1: Generate the Package

In the repository root, run:
```bash
bash create-bolt-package.sh
```

This creates:
- `theprize-frontend.zip` (14MB) - Ready for upload
- `theprize-frontend/` - Directory for inspection

## Step 2: Upload to Bolt

1. Open Bolt (https://bolt.new or your Bolt instance)
2. Click "Import Project" or "Upload"
3. Select `theprize-frontend.zip`
4. Bolt will automatically:
   - Extract all files
   - Recognize it as a Vite + React project
   - Set up the development environment

## Step 3: Install Dependencies

Bolt should automatically run `npm install`. If not, run it manually:
```bash
npm install
```

This installs 40+ dependencies including:
- React 19.1.1
- Vite 7.1.7
- TypeScript 5.9
- Tailwind CSS 4.1
- Wagmi & Viem (Web3)
- Coinbase OnchainKit
- And more...

## Step 4: Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Coinbase Developer Platform
VITE_CDP_API_KEY=your_cdp_api_key_here
VITE_CDP_PROJECT_ID=your_project_id_here
VITE_ONCHAINKIT_PROJECT_ID=your_project_id_here

# Supabase
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Network (use 'true' for mainnet)
VITE_BASE_MAINNET=true

# Treasury
VITE_TREASURY_ADDRESS=your_treasury_address_here
```

**Note:** For testing in Bolt, you can use dummy values, but wallet/payment features won't work without real credentials.

## Step 5: Start Development Server

Run:
```bash
npm run dev
```

Bolt will start the Vite dev server and show you the live preview.

## Step 6: Make Your Changes

### What You Can Edit

#### 🎨 UI Components (`src/components/`)
- Modify any component's JSX structure
- Update Tailwind CSS classes
- Add new props or functionality

Example locations:
- `src/components/Header.tsx` - Main navigation
- `src/components/Footer.tsx` - Footer section
- `src/components/HeroSection.tsx` - Landing page hero
- `src/components/LiveCompetitionCard.tsx` - Competition cards

#### 📄 Pages (`src/pages/`)
- Edit page layouts
- Update content and copy
- Add new sections

Example locations:
- `src/pages/LandingPage.tsx` - Home page
- `src/pages/CompetitionsPage.tsx` - Competitions list
- `src/pages/UserDashboard.tsx` - User dashboard

#### 🎭 Styling
- All components use Tailwind CSS v4
- Colors defined in class names
- Responsive breakpoints: `sm:`, `md:`, `lg:`, `xl:`
- Custom theme colors like brand yellow: `bg-[#DDE404]`

#### 🔧 Configuration
- `src/constants/constant.ts` - App constants
- `src/utils/util.ts` - Utility functions
- `vite.config.ts` - Build settings (advanced)

### What to Avoid

❌ Don't modify backend-related files:
- Anything referencing `netlify/functions`
- Database schema references
- Environment variable names (you can change values)

❌ Don't change critical dependencies without testing:
- React version
- Vite version
- Web3 library versions

## Step 7: Test Your Changes

### Visual Testing
- Use Bolt's live preview to see changes instantly
- Test responsive design by resizing the preview
- Check different pages by navigating in the preview

### Build Testing
Run a production build to check for errors:
```bash
npm run build
```

This will:
- Compile TypeScript
- Check for type errors
- Build optimized bundles
- Report any issues

### Linting
Check code quality:
```bash
npm run lint
```

Fix issues automatically:
```bash
npm run lint -- --fix
```

## Step 8: Download Your Changes

Once you're happy with your changes:

1. In Bolt, click "Download" or "Export"
2. Download the entire project or specific files
3. Save them locally

## Step 9: Re-integrate to Repository

### Option A: Direct File Copy
```bash
# Copy changed files from Bolt export to your local repo
cp -r bolt-export/src/* /path/to/repo/src/

# Review changes
git status
git diff

# Commit
git add src/
git commit -m "Updated UI components from Bolt"
git push origin main
```

### Option B: Create a Branch
```bash
# Create a new branch
git checkout -b bolt-ui-improvements

# Copy files
cp -r bolt-export/src/* ./src/

# Commit and push
git add src/
git commit -m "UI improvements made in Bolt"
git push origin bolt-ui-improvements

# Create a pull request on GitHub
```

## Step 10: Deploy

Once your changes are merged to main:
1. Netlify automatically detects the changes
2. Runs the build process
3. Deploys to production
4. Usually takes 2-5 minutes

Monitor deployment at: https://app.netlify.com

## Common Workflows

### Updating a Component's Styling

1. Find component: `src/components/ComponentName.tsx`
2. Edit Tailwind classes in JSX
3. Save and preview in Bolt
4. Export and commit

Example:
```tsx
// Before
<button className="bg-blue-500 text-white">
  Click me
</button>

// After  
<button className="bg-[#DDE404] text-black font-bold rounded-lg">
  Click me
</button>
```

### Adding a New Page

1. Create file: `src/pages/NewPage.tsx`
2. Add route in `src/main.tsx`:
```tsx
{ path: 'new-page', element: <NewPage /> }
```
3. Test navigation
4. Export and commit

### Updating Text Content

1. Find the page or component
2. Search for the text you want to change
3. Update the JSX
4. Preview and export

### Modifying Forms

1. Find form in `src/components/` or `src/pages/`
2. Update field labels, placeholders, or validation
3. Check `src/constants/validators.ts` for validation rules
4. Test form submission
5. Export and commit

## Troubleshooting

### "Module not found" errors
- Run `npm install` again
- Check that all files were extracted from the zip
- Verify import paths are correct

### Environment variable not working
- Make sure `.env` file is in the root directory
- Restart the dev server after adding variables
- Check variable names start with `VITE_`

### Build errors
- Check TypeScript errors: `npm run build`
- Fix any type issues
- Ensure all imports are correct

### Preview not updating
- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Restart dev server
- Clear browser cache

### Styling not applying
- Check Tailwind class names are valid
- Verify no conflicting styles
- Inspect element in browser DevTools

## Tips for Bolt Users

### Efficient Development
- Use Bolt's AI assistant to help with code changes
- Ask for component suggestions
- Request style improvements
- Get help with TypeScript types

### Best Practices
- Make small, incremental changes
- Test frequently in the preview
- Keep components focused and simple
- Use TypeScript types for safety
- Follow existing code patterns

### File Organization
- Keep related components together
- Use descriptive file names
- Add comments for complex logic
- Maintain consistent formatting

## Next Steps

After getting comfortable with basic edits:
1. Explore custom hooks in `src/hooks/`
2. Understand context providers in `src/contexts/`
3. Review service integrations in `src/services/`
4. Learn about the routing structure in `src/main.tsx`

## Resources

- **React Docs:** https://react.dev
- **TypeScript Docs:** https://www.typescriptlang.org
- **Tailwind CSS:** https://tailwindcss.com
- **Vite Docs:** https://vitejs.dev
- **Repository:** https://github.com/teamstack-xyz/theprize.io

## Support

For issues or questions:
1. Check `BOLT_README.md` for detailed information
2. Review `BOLT_PACKAGE_SUMMARY.md` for architecture details
3. Contact the development team

---

**Happy coding! 🚀**
