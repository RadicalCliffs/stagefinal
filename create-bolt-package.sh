#!/bin/bash

# Script to create a front-end package for Bolt
# This bundles all necessary files for editing the front-end in Bolt

set -e  # Exit on error

echo "📦 Creating ThePrize.io Front-End Package for Bolt..."
echo ""

# Define the output directory and zip file name
OUTPUT_DIR="theprize-frontend"
ZIP_NAME="theprize-frontend.zip"

# Clean up any existing package
if [ -d "$OUTPUT_DIR" ]; then
    echo "🧹 Cleaning up existing package directory..."
    rm -rf "$OUTPUT_DIR"
fi

if [ -f "$ZIP_NAME" ]; then
    echo "🧹 Removing existing zip file..."
    rm -f "$ZIP_NAME"
fi

echo ""
echo "📁 Creating package directory structure..."

# Create the output directory
mkdir -p "$OUTPUT_DIR"

# Copy essential directories
echo "  ↳ Copying src/ directory..."
cp -r src "$OUTPUT_DIR/"

echo "  ↳ Copying public/ directory..."
cp -r public "$OUTPUT_DIR/"

# Copy configuration files
echo "  ↳ Copying configuration files..."
cp package.json "$OUTPUT_DIR/"
cp vite.config.ts "$OUTPUT_DIR/"
cp tsconfig.json "$OUTPUT_DIR/"
cp tsconfig.app.json "$OUTPUT_DIR/"
cp tsconfig.node.json "$OUTPUT_DIR/"
cp eslint.config.js "$OUTPUT_DIR/"
cp index.html "$OUTPUT_DIR/"

# Copy environment example
echo "  ↳ Copying environment template..."
cp .env.example "$OUTPUT_DIR/"

# Copy gitignore for reference
echo "  ↳ Copying .gitignore..."
cp .gitignore "$OUTPUT_DIR/"

# Copy the Bolt-specific README
echo "  ↳ Copying README for Bolt..."
cp BOLT_README.md "$OUTPUT_DIR/README.md"

# Create a package info file
echo "  ↳ Creating package info..."
cat > "$OUTPUT_DIR/PACKAGE_INFO.txt" << EOF
ThePrize.io Front-End Package
==============================

Created: $(date)
Repository: https://github.com/teamstack-xyz/theprize.io
Branch: main

This package contains the complete front-end codebase for ThePrize.io,
ready to be edited in Bolt or any other development environment.

Quick Start:
1. Extract this package
2. Run: npm install
3. Create .env file (see .env.example)
4. Run: npm run dev

For detailed instructions, see README.md

Contents:
- src/          : Complete source code
- public/       : Static assets
- package.json  : Dependencies and scripts
- *.config.*    : Build and TypeScript configuration
- index.html    : Entry point
- README.md     : Detailed usage guide
EOF

echo ""
echo "📊 Package Statistics:"
echo "  ↳ Source files: $(find "$OUTPUT_DIR/src" -type f | wc -l)"
echo "  ↳ Components: $(find "$OUTPUT_DIR/src/components" -type f -name "*.tsx" | wc -l)"
echo "  ↳ Pages: $(find "$OUTPUT_DIR/src/pages" -type f -name "*.tsx" | wc -l)"
echo "  ↳ Total size: $(du -sh "$OUTPUT_DIR" | cut -f1)"

echo ""
echo "🗜️  Creating zip file..."

# Create the zip file (excluding node_modules and other unnecessary files)
cd "$OUTPUT_DIR"
zip -r "../$ZIP_NAME" . -x "*.git*" "node_modules/*" "dist/*" ".env" "*.log" > /dev/null
cd ..

echo ""
echo "✅ Package created successfully!"
echo ""
echo "📦 Output:"
echo "  ↳ Zip file: $ZIP_NAME"
echo "  ↳ Size: $(du -sh "$ZIP_NAME" | cut -f1)"
echo ""
echo "🚀 Next Steps:"
echo "  1. Upload $ZIP_NAME to Bolt"
echo "  2. Follow instructions in README.md inside the package"
echo "  3. After editing, re-upload changes to this repository"
echo ""
echo "💡 The package directory ($OUTPUT_DIR) has been kept for inspection."
echo "   You can delete it with: rm -rf $OUTPUT_DIR"
echo ""
