# Documentation Index

**All essential documentation for working with this codebase.**

## Core Reference Documents

### 1. PRODUCTION_SCHEMA_REFERENCE.md
**Purpose:** Complete reference for all production tables and RPC functions  
**When to use:** 
- Before creating any migration
- When verifying column names
- When checking function signatures
- When unsure about data types

**Contains:**
- All critical tables with exact column names
- All RPC function signatures
- Parameter naming conventions
- Type definitions
- Generated column markers
- Common mistakes section

### 2. MIGRATION_CHECKLIST.md
**Purpose:** Step-by-step process for creating migrations  
**When to use:**
- Before creating ANY migration
- When modifying functions
- When changing table schemas
- As a verification checklist

**Contains:**
- Pre-migration research checklist
- Migration creation steps
- Post-migration verification
- Emergency rollback procedures
- Complete example migration
- Testing procedures

### 3. COMMON_MISTAKES_LEARNED.md
**Purpose:** Document all past mistakes to prevent repetition  
**When to use:**
- Before starting any database work
- When reviewing migrations
- When something goes wrong
- To understand why certain practices exist

**Contains:**
- 12 documented mistakes with root causes
- Lessons learned from each
- Prevention strategies
- Golden rules summary
- How to use the document

### 4. QUICK_REFERENCE.md
**Purpose:** Fast lookups for common patterns and commands  
**When to use:**
- When you need quick information
- For common grep patterns
- For DROP statement templates
- For error message lookups
- For emergency SQL commands

**Contains:**
- Column quick reference by table
- Function parameter patterns
- Type reference
- Common grep commands
- Error message fixes
- Emergency SQL commands

## Production Schema Source

### Substage Schema, functions, triggers & indexes.md
**Purpose:** Complete production database schema (15,995 lines)  
**When to use:**
- As source of truth for all schema questions
- When PRODUCTION_SCHEMA_REFERENCE.md doesn't have details
- When needing complete function definitions
- For comprehensive table analysis

**Contains:**
- All 82 CREATE TABLE statements
- All 400+ function definitions
- All triggers and indexes
- Complete schema documentation

## How to Use This Documentation

### When Creating a Migration:

1. **Start here:** MIGRATION_CHECKLIST.md
2. **Verify columns:** PRODUCTION_SCHEMA_REFERENCE.md
3. **Check mistakes:** COMMON_MISTAKES_LEARNED.md (sections 1, 3, 6, 8)
4. **Quick lookups:** QUICK_REFERENCE.md
5. **Deep dive:** Substage Schema... .md (if needed)

### When Debugging an Error:

1. **Error message:** QUICK_REFERENCE.md → "Common Error Messages & Fixes"
2. **Column error:** PRODUCTION_SCHEMA_REFERENCE.md → Check exact column name
3. **Function error:** PRODUCTION_SCHEMA_REFERENCE.md → Check exact signature
4. **Similar past error:** COMMON_MISTAKES_LEARNED.md → Find similar mistake

### When Starting Work on This Codebase:

**Read in this order:**
1. THIS FILE (you are here)
2. QUICK_REFERENCE.md (get familiar with patterns)
3. PRODUCTION_SCHEMA_REFERENCE.md (understand the schema)
4. COMMON_MISTAKES_LEARNED.md (learn from past issues)
5. MIGRATION_CHECKLIST.md (understand the process)

### When Reviewing Someone's Migration:

**Check against:**
1. MIGRATION_CHECKLIST.md - Did they follow all steps?
2. PRODUCTION_SCHEMA_REFERENCE.md - Do columns/functions exist?
3. COMMON_MISTAKES_LEARNED.md - Are they repeating past mistakes?

## Document Maintenance

### When Adding New Information:

**Column discovered missing from docs:**
- Add to PRODUCTION_SCHEMA_REFERENCE.md → Correct table section
- Update QUICK_REFERENCE.md → Column Quick Reference

**New mistake made:**
- Add to COMMON_MISTAKES_LEARNED.md with full analysis
- Update MIGRATION_CHECKLIST.md if process needs changing
- Update QUICK_REFERENCE.md if it affects common patterns

**New common pattern:**
- Add to QUICK_REFERENCE.md → Relevant section
- Consider if MIGRATION_CHECKLIST.md needs update

**Production schema updated:**
- Re-scan Substage Schema... .md
- Update PRODUCTION_SCHEMA_REFERENCE.md
- Update examples if patterns changed

### Version Control:

Each document has "Last Updated" date at top.  
Update this date when making changes.

## File Locations

```
Repository Root:
├── DOCUMENTATION_INDEX.md           ← This file
├── PRODUCTION_SCHEMA_REFERENCE.md   ← Schema reference
├── MIGRATION_CHECKLIST.md           ← Migration process
├── COMMON_MISTAKES_LEARNED.md       ← Lessons learned
├── QUICK_REFERENCE.md               ← Fast lookups
├── Substage Schema, ... .md         ← Production schema source
└── debug/                           ← Old debug files (193 files)
```

## Quick Decision Tree

**"I need to create a migration"**
→ Start with MIGRATION_CHECKLIST.md

**"I need to check if a column exists"**
→ PRODUCTION_SCHEMA_REFERENCE.md or QUICK_REFERENCE.md

**"I got an error message"**
→ QUICK_REFERENCE.md → Error section

**"This seems familiar, did we do this before?"**
→ COMMON_MISTAKES_LEARNED.md

**"I need to verify a function signature"**
→ PRODUCTION_SCHEMA_REFERENCE.md → RPC Functions section

**"I need complete function definition"**
→ Substage Schema... .md (search for function name)

**"I'm new to this codebase"**
→ Read all 5 core docs in order listed above

## Key Principles

1. **Never assume** - Always verify against production schema
2. **Check first** - Use MIGRATION_CHECKLIST.md before creating migrations
3. **Learn from history** - Read COMMON_MISTAKES_LEARNED.md
4. **Verify everything** - Every column, every parameter, every type
5. **Think comprehensive** - Fix all related issues at once

## Debug Files

All old debug/investigation files have been moved to `/debug` folder.

These include:
- 193 markdown files from previous investigations
- Historical context and debugging notes
- Useful for understanding past issues
- Not needed for day-to-day work

**Don't delete debug files** - they contain historical context that may be useful for understanding why certain decisions were made.

## Getting Help

If documentation is unclear or missing information:
1. Check if answer is in production schema document
2. Ask for clarification
3. Once clarified, update the relevant document
4. Update this index if new document added

## Summary

**Start here for everything:**
- Creating migrations: MIGRATION_CHECKLIST.md
- Checking schema: PRODUCTION_SCHEMA_REFERENCE.md
- Quick lookups: QUICK_REFERENCE.md
- Learning from past: COMMON_MISTAKES_LEARNED.md

**Never assume. Always verify. Use the checklists.**
