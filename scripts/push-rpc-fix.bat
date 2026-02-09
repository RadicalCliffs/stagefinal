@echo off
REM Push only the RPC fix migration to Supabase

echo Pushing RPC fix migration to Supabase...

cd "%~dp0"

REM Get service role key from environment or prompt
set SERVICE_KEY=%SUPABASE_SERVICE_KEY%
if "%SERVICE_KEY%"=="" (
  echo Please set SUPABASE_SERVICE_KEY environment variable
  echo Example: set SUPABASE_SERVICE_KEY=your_service_role_key
  exit /b 1
)

REM Get the SQL content
set SQL_FILE=supabase\migrations\20260209000000_fix_rpc_uuid_casting.sql

if not exist "%SQL_FILE%" (
  echo Error: %SQL_FILE% not found
  exit /b 1
)

echo Migration file found: %SQL_FILE%
echo.
echo The migration will:
echo 1. Fix get_unavailable_tickets to properly cast UUID to TEXT
echo 2. Allow the function to query competitions.id (UUID) using TEXT competition_id
echo.
echo Applying fix...

REM Try using curl to execute SQL via Supabase API
set PROJECT_ID=mthwfldcjvpxjtmrqkqm
set SUPABASE_URL=https://%PROJECT_ID%.supabase.co

echo.
echo If the migration fails, please run this SQL in Supabase Dashboard SQL Editor:
echo ====================================================================
type "%SQL_FILE%"
echo ====================================================================

pause
