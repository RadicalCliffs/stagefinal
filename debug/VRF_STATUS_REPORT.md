==============================================================================
VRF AUTOMATIC WINNER SELECTION - STATUS & VERIFICATION
==============================================================================

## WHAT EXISTS:

1. VRF SCHEDULER (netlify/functions/vrf-scheduler.mts)
   - Runs every 10 minutes via Netlify scheduled function
   - Automatically finds competitions that:
     - Have passed end_date
     - Have onchain_competition_id (blockchain ID)
     - Status is 'active' or 'ended'
     - NOT instant win (those are handled at purchase time)
     - NOT already drawn
   - Calls vrf-draw-winner edge function
   - Monitors drawing status and syncs winners
   - Creates notifications for winning and losing participants
   - Sends winner emails via SendGrid

2. VRF DRAW WINNER (supabase/functions/vrf-draw-winner/index.ts)
   - Uses pregenerated VRF seed to select winner
   - Deterministic and provably fair
   - Finds winning ticket and owner
   - Updates competition status to 'drawn'
   - Inserts into competition_winners table

3. FRONTEND SYNCING (src/components/UserDashboard/Entries/EntriesList.tsx)
   - Subscribes to winners table via Supabase realtime
   - Subscribes to competitions table for status changes
   - Detects when user wins or competition ends
   - Refetches entry data when changes detected
   - Maps competition statuses (active/ended/drawn/completed)

==============================================================================

## POTENTIAL ISSUES TO CHECK:

1. SCHEDULER NOT DEPLOYED?
   - Function exists in code but NOT in netlify.toml config
   - May not be deployed to Netlify
   - Check if Netlify has the scheduled function registered

   ACTION: Deploy vrf-scheduler to Netlify

2. VRF DRAW WINNER NOT CREATING WINNERS TABLE ENTRY
   - Function updates 'competitions' table with winner_address
   - Inserts into 'competition_winners' table
   - BUT: Does 'winners' table also need an entry?
   - Frontend subscribes to 'winners' table for realtime updates

   ACTION: Check if 'winners' table is being populated

3. STATUS NOT UPDATING FROM 'DRAWN' TO 'COMPLETED'
   - vrf-draw-winner sets status = 'drawn'
   - Scheduler checkVRFDrawResults() sets status = 'completed'
   - But only if winner exists in 'winners' table

   ACTION: Verify 'winners' table is populated OR update scheduler to check 'competition_winners'

4. FRONTEND NOT SHOWING WINNERS
   - Frontend checks is_winner flag from joincompetition entries
   - is_winner may not be set when winner is selected

   ACTION: Add trigger or logic to set is_winner = true in joincompetition when winner selected

==============================================================================

## WHAT NEEDS TO HAPPEN:

WHEN COMPETITION ENDS:

1. VRF Scheduler detects end_date passed
2. Calls vrf-draw-winner edge function
3. vrf-draw-winner selects winning ticket using VRF seed
4. vrf-draw-winner updates competition status = 'drawn'
5. vrf-draw-winner inserts into competition_winners
6. [MISSING] Insert into 'winners' table
7. [MISSING] Set is_winner = true in joincompetition for winner

ON NEXT SCHEDULER RUN: 8. checkVRFDrawResults() finds competition in 'drawing' status 9. Checks for winner in 'winners' table 10. Updates status = 'completed' and competitionended = 1 11. Creates notifications for winner and losers 12. Sends winner email

FRONTEND REALTIME: 13. Receives realtime update from 'winners' table 14. Receives realtime update from 'competitions' status change 15. Refetches entries 16. Shows winner badge if is_winner = true

==============================================================================

## VERIFICATION NEEDED:

1. Is vrf-scheduler actually deployed and running?
   - Check Netlify functions dashboard
   - Check Netlify scheduled functions
   - Look for logs in past 10 minutes

2. Does 'winners' table exist and have proper structure?
   - Check database schema
   - Verify columns: competition_id, user_id, ticket_number, etc.

3. Is vrf-draw-winner function deployed to Supabase?
   - Check Supabase Edge Functions dashboard
   - Test calling it manually

4. Are there any competitions stuck in 'drawing' status?
   - Query competitions where status='drawing' and vrf_draw_requested_at < NOW() - INTERVAL '1 HOUR'

5. Are winners being synced to frontend properly?
   - Check EntriesList component subscriptions
   - Verify is_winner flag is set
   - Check realtime channels are connected

==============================================================================
