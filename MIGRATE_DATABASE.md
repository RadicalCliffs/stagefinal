# Database Migration Guide: Old Project → Prizefinal

## Connection Strings

**Old Project (mthwfldcjvpxjtmrqkqm):**
```
postgresql://postgres.mthwfldcjvpxjtmrqkqm:Habibinamimbi@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

**New Project (prizefinal - qpenzfiwkneeahfcrrjh):**
```
postgresql://postgres.qpenzfiwkneeahfcrrjh:XxxSexM@chine69@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

---

## Option 1: Install PostgreSQL Tools (5 minutes)

### 1. Download and install PostgreSQL
- Download from: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
- Choose Windows x86-64 version
- During installation, you only need "Command Line Tools" (uncheck the rest to save time)
- Default install location: `C:\Program Files\PostgreSQL\17\bin`

### 2. Add to PATH (or use full path)
```powershell
# Add PostgreSQL to PATH for this session
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
```

### 3. Export schema from old project
```powershell
pg_dump "postgresql://postgres.mthwfldcjvpxjtmrqkqm:Habibinamimbi@aws-0-us-east-1.pooler.supabase.com:6543/postgres" --schema-only --no-owner --no-privileges -f old-schema.sql
```

### 4. Import to new project
```powershell
psql "postgresql://postgres.qpenzfiwkneeahfcrrjh:XxxSexM@chine69@aws-0-us-east-1.pooler.supabase.com:6543/postgres" -f old-schema.sql
```

### 5. (Optional) Copy data too
```powershell
# Export data
pg_dump "postgresql://postgres.mthwfldcjvpxjtmrqkqm:Habibinamimbi@aws-0-us-east-1.pooler.supabase.com:6543/postgres" --data-only --no-owner --no-privileges -f old-data.sql

# Import data
psql "postgresql://postgres.qpenzfiwkneeahfcrrjh:XxxSexM@chine69@aws-0-us-east-1.pooler.supabase.com:6543/postgres" -f old-data.sql
```

---

## Option 2: Use Supabase Dashboard (Manual)

### Export from old project:
1. Go to: https://supabase.com/dashboard/project/mthwfldcjvpxjtmrqkqm/database/backups
2. Click "Download" on the latest backup
3. This will download a `.sql` file

### Import to new project:
1. Go to: https://supabase.com/dashboard/project/qpenzfiwkneeahfcrrjh/sql/new
2. Open the downloaded `.sql` file in a text editor
3. Copy and paste into the SQL editor
4. Run the query

---

## Option 3: Use Docker with Supabase CLI

If you install Docker Desktop:

```powershell
# Link to old project
supabase link --password Habibinamimbi --project-ref mthwfldcjvpxjtmrqkqm

# Pull schema
supabase db pull

# Link to new project
supabase link --password "XxxSexM@chine69" --project-ref qpenzfiwkneeahfcrrjh

# Push schema
supabase db push
```

---

## Verify Migration

After migration, verify in new project:

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Check row counts match
SELECT 
    schemaname,
    tablename,
    n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
```

---

## Quick Commands (Copy-Paste Ready)

```powershell
# Full schema + data export and import
$OLD_DB = "postgresql://postgres.mthwfldcjvpxjtmrqkqm:Habibinamimbi@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
$NEW_DB = "postgresql://postgres.qpenzfiwkneeahfcrrjh:XxxSexM@chine69@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

pg_dump $OLD_DB --no-owner --no-privileges -f full-backup.sql
psql $NEW_DB -f full-backup.sql
```
