 schema\_name,function\_name,identity\_args,full\_args,return\_type,language,security\_definer,volatility,leakproof,returns\_set,comment,definition  
auth,email,,,text,sql,false,s,false,false,Deprecated. Use auth.jwt() \-\> 'email' instead.,"CREATE OR REPLACE FUNCTION auth.email()  
 RETURNS text  
 LANGUAGE sql  
 STABLE  
AS $function$  
  select   
  coalesce(  
    nullif(current\_setting('request.jwt.claim.email', true), ''),  
    (nullif(current\_setting('request.jwt.claims', true), '')::jsonb \-\>\> 'email')  
  )::text  
$function$  
"  
auth,jwt,,,jsonb,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION auth.jwt()  
 RETURNS jsonb  
 LANGUAGE sql  
 STABLE  
AS $function$  
  select   
    coalesce(  
        nullif(current\_setting('request.jwt.claim', true), ''),  
        nullif(current\_setting('request.jwt.claims', true), '')  
    )::jsonb  
$function$  
"  
auth,role,,,text,sql,false,s,false,false,Deprecated. Use auth.jwt() \-\> 'role' instead.,"CREATE OR REPLACE FUNCTION auth.role()  
 RETURNS text  
 LANGUAGE sql  
 STABLE  
AS $function$  
  select   
  coalesce(  
    nullif(current\_setting('request.jwt.claim.role', true), ''),  
    (nullif(current\_setting('request.jwt.claims', true), '')::jsonb \-\>\> 'role')  
  )::text  
$function$  
"  
auth,uid,,,uuid,sql,false,s,false,false,Deprecated. Use auth.jwt() \-\> 'sub' instead.,"CREATE OR REPLACE FUNCTION auth.uid()  
 RETURNS uuid  
 LANGUAGE sql  
 STABLE  
AS $function$  
  select   
  coalesce(  
    nullif(current\_setting('request.jwt.claim.sub', true), ''),  
    (nullif(current\_setting('request.jwt.claims', true), '')::jsonb \-\>\> 'sub')  
  )::uuid  
$function$  
"  
public,\_apply\_wallet\_delta,"p\_canonical\_user\_id text, p\_currency text, p\_delta numeric","p\_canonical\_user\_id text, p\_currency text, p\_delta numeric",record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.\_apply\_wallet\_delta(p\_canonical\_user\_id text, p\_currency text, p\_delta numeric)  
 RETURNS TABLE(balance\_before numeric, balance\_after numeric)  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF p\_canonical\_user\_id IS NULL THEN  
    RAISE EXCEPTION 'canonical\_user\_id is required';  
  END IF;

  IF p\_currency IS NULL OR upper(p\_currency) NOT IN ('USD','USDC') THEN  
    RAISE EXCEPTION 'Unsupported currency: %', p\_currency;  
  END IF;

  \-- Ensure row exists  
  INSERT INTO public.sub\_account\_balances (id, canonical\_user\_id, user\_id, currency, available\_balance, pending\_balance, last\_updated)  
  SELECT gen\_random\_uuid(), p\_canonical\_user\_id, p\_canonical\_user\_id, 'USD', 0, 0, now()  
  ON CONFLICT DO NOTHING;

  \-- Lock row and read before  
  SELECT available\_balance INTO balance\_before  
  FROM public.sub\_account\_balances  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id  
  FOR UPDATE;

  IF balance\_before IS NULL THEN  
    balance\_before := 0;  
  END IF;

  balance\_after := balance\_before \+ p\_delta;

  IF balance\_after \< 0 THEN  
    RAISE EXCEPTION 'Insufficient wallet balance for %: before %, delta %, after %', p\_canonical\_user\_id, balance\_before, p\_delta, balance\_after;  
  END IF;

  UPDATE public.sub\_account\_balances  
  SET available\_balance \= balance\_after,  
      last\_updated \= now()  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id;

  RETURN;  
END;  
$function$  
"  
public,\_deduct\_sub\_account\_balance,"\_cuid text, \_amount numeric","\_cuid text, \_amount numeric",void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.\_deduct\_sub\_account\_balance(\_cuid text, \_amount numeric)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  \-- ensure row exists  
  INSERT INTO public.sub\_account\_balances (user\_id, canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated)  
  VALUES (\_cuid, \_cuid, 'USD', 0, 0, now())  
  ON CONFLICT (id) DO NOTHING; \-- no natural key; will adjust via update below

  \-- update by canonical\_user\_id (most reliable key here)  
  UPDATE public.sub\_account\_balances sab  
  SET available\_balance \= COALESCE(sab.available\_balance, 0\) \- \_amount,  
      last\_updated \= now()  
  WHERE sab.canonical\_user\_id \= \_cuid OR sab.user\_id \= \_cuid;  
END;  
$function$  
"  
public,\_get\_competition\_price,p\_competition\_id uuid,p\_competition\_id uuid,record,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.\_get\_competition\_price(p\_competition\_id uuid)  
 RETURNS TABLE(unit\_price numeric, currency text)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT c.ticket\_price::numeric, 'USD'::text  
  FROM public.competitions c  
  WHERE c.id \= p\_competition\_id;  
$function$  
"  
public,\_get\_user\_competition\_entries\_unified,p\_user\_identifier text,p\_user\_identifier text,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.\_get\_user\_competition\_entries\_unified(p\_user\_identifier text)  
 RETURNS TABLE(id uuid, competition\_id uuid, user\_id text, canonical\_user\_id text, wallet\_address text, ticket\_numbers integer\[\], ticket\_count integer, amount\_paid numeric, currency text, transaction\_hash text, payment\_provider text, entry\_status text, is\_winner boolean, prize\_claimed boolean, created\_at timestamp with time zone, updated\_at timestamp with time zone, competition\_title text, competition\_description text, competition\_image\_url text, competition\_status text, competition\_end\_date timestamp with time zone, competition\_prize\_value numeric, competition\_is\_instant\_win boolean)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
BEGIN  
  RETURN QUERY SELECT \* FROM public.get\_user\_competition\_entries(p\_user\_identifier);  
END; $function$  
"  
public,\_insert\_user\_spend\_tx,"\_cuid text, \_amount numeric, \_competition\_id uuid, \_order\_id uuid, \_ticket\_id uuid, \_payment\_provider text, \_wallet\_address text","\_cuid text, \_amount numeric, \_competition\_id uuid, \_order\_id uuid, \_ticket\_id uuid, \_payment\_provider text, \_wallet\_address text",uuid,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.\_insert\_user\_spend\_tx(\_cuid text, \_amount numeric, \_competition\_id uuid, \_order\_id uuid, \_ticket\_id uuid, \_payment\_provider text, \_wallet\_address text)  
 RETURNS uuid  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_id uuid;  
  v\_ref text;  
BEGIN  
  v\_ref := COALESCE(\_order\_id::text, \_ticket\_id::text);

  \-- idempotency: if a completed entry tx already exists for this cuid+ref+amount, reuse it  
  SELECT id INTO v\_id FROM public.user\_transactions  
  WHERE COALESCE(canonical\_user\_id, user\_id) \= \_cuid  
    AND type \= 'entry'  
    AND status \= 'completed'  
    AND amount \= \_amount  
    AND (order\_id \= \_order\_id OR (\_order\_id IS NULL AND order\_id IS NULL))  
    AND (description \= v\_ref OR description IS NULL AND v\_ref IS NULL)  
  LIMIT 1;

  IF v\_id IS NULL THEN  
    INSERT INTO public.user\_transactions (  
      user\_id, canonical\_user\_id, wallet\_address, type, amount, currency,  
      balance\_before, balance\_after, competition\_id, order\_id, description, status,  
      payment\_provider, created\_at  
    )  
    SELECT  
      \_cuid, \_cuid, \_wallet\_address, 'entry', \_amount, 'USDC',  
      sab.available\_balance,  
      sab.available\_balance \- \_amount,  
      \_competition\_id, \_order\_id, v\_ref, 'completed',  
      \_payment\_provider, now()  
    FROM public.sub\_account\_balances sab  
    WHERE sab.canonical\_user\_id \= \_cuid OR sab.user\_id \= \_cuid  
    ORDER BY sab.last\_updated DESC NULLS LAST  
    LIMIT 1  
    RETURNING id INTO v\_id;

    \-- If no SAB row found in SELECT above, insert with NULL balances  
    IF v\_id IS NULL THEN  
      INSERT INTO public.user\_transactions (  
        user\_id, canonical\_user\_id, wallet\_address, type, amount, currency,  
        competition\_id, order\_id, description, status, payment\_provider, created\_at  
      ) VALUES (  
        \_cuid, \_cuid, \_wallet\_address, 'entry', \_amount, 'USDC',  
        \_competition\_id, \_order\_id, v\_ref, 'completed', \_payment\_provider, now()  
      ) RETURNING id INTO v\_id;  
    END IF;  
  END IF;

  RETURN v\_id;  
END;  
$function$  
"  
public,\_orders\_from\_balance\_ledger,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.\_orders\_from\_balance\_ledger()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  INSERT INTO public.orders (  
    canonical\_user\_id, competition\_id, amount, currency, status,  
    ticket\_count, created\_at, updated\_at, order\_type, ledger\_ref,  
    source, source\_id, unique\_order\_key, bonus\_amount, cash\_amount, bonus\_currency,  
    completed\_at  
  ) VALUES (  
    NEW.canonical\_user\_id,  
    NULL,  
    NEW.amount,  
    COALESCE(NEW.currency, 'USD'),  
    'completed',  
    0,  
    COALESCE(NEW.created\_at, now()),  
    COALESCE(NEW.created\_at, now()),  
    CASE WHEN NEW.transaction\_type IN ('bonus\_award','bonus\_credit','credit') THEN 'bonus\_credit'  
         WHEN NEW.transaction\_type IN ('bonus\_spend','bonus\_debit','debit') THEN 'bonus\_spend'  
         ELSE 'ledger' END,  
    NEW.reference\_id,  
    'balance\_ledger',  
    NEW.id,  
    ('bl:' || NEW.id::text),  
    CASE WHEN NEW.amount \> 0 THEN NEW.amount ELSE 0 END,  
    CASE WHEN NEW.amount \< 0 THEN ABS(NEW.amount) ELSE 0 END,  
    COALESCE(NEW.currency, 'USD'),  
    COALESCE(NEW.created\_at, now())  
  )  
  ON CONFLICT (unique\_order\_key) DO NOTHING;  
  RETURN NEW;  
END;$function$  
"  
public,\_orders\_from\_user\_transactions,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.\_orders\_from\_user\_transactions()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  \-- Require canonical\_user\_id; skip if missing  
  IF NEW.canonical\_user\_id IS NULL THEN  
    RETURN NEW;  
  END IF;

  INSERT INTO public.orders (  
    canonical\_user\_id, user\_wallet\_address, user\_privy\_id,  
    competition\_id, amount, amount\_usd, currency, status, payment\_status,  
    payment\_provider, payment\_method, payment\_intent\_id, payment\_session\_id,  
    payment\_url, payment\_tx\_hash, ticket\_count, created\_at, updated\_at,  
    completed\_at, order\_type, transaction\_ref, source, source\_id,  
    unique\_order\_key  
  ) VALUES (  
    NEW.canonical\_user\_id,  
    NEW.wallet\_address,  
    NEW.user\_privy\_id,  
    NEW.competition\_id,  
    NEW.amount,  
    NULL,  
    COALESCE(NEW.currency, 'USDC'),  
    CASE WHEN NEW.payment\_status IN ('completed','success','paid') THEN 'completed' ELSE 'pending' END,  
    NEW.payment\_status,  
    NEW.payment\_provider,  
    NEW.method,  
    NEW.charge\_id,  
    NEW.webhook\_ref,  
    NEW.checkout\_url,  
    NEW.tx\_id,  
    COALESCE(NEW.ticket\_count,0),  
    COALESCE(NEW.created\_at, now()),  
    COALESCE(NEW.updated\_at, now()),  
    NEW.completed\_at,  
    'cash',  
    COALESCE(NEW.tx\_ref, NEW.webhook\_ref, NEW.charge\_id, NEW.tx\_id),  
    'user\_transactions',  
    NEW.id,  
    ('ut:' || NEW.id::text)  
  )  
  ON CONFLICT (unique\_order\_key) DO NOTHING;  
  RETURN NEW;  
END;$function$  
"  
public,\_test\_block,p\_ticket\_count integer,p\_ticket\_count integer DEFAULT 0,void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.\_test\_block(p\_ticket\_count integer DEFAULT 0\)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_res public.pending\_tickets%ROWTYPE;  
  v\_competition\_id uuid;  
  v\_needed int := GREATEST(COALESCE(p\_ticket\_count, 0), 0);  
  v\_available int\[\] := ARRAY\[\]::int\[\];  
  v\_selected int\[\] := ARRAY\[\]::int\[\];  
  v\_now timestamptz := now();  
BEGIN  
  RAISE NOTICE 'v\_needed=%', v\_needed;  
END  
$function$  
"  
public,\_ticket\_cuid,"\_user\_id text, \_canonical\_user\_id text, \_wallet\_address text","\_user\_id text, \_canonical\_user\_id text, \_wallet\_address text",text,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.\_ticket\_cuid(\_user\_id text, \_canonical\_user\_id text, \_wallet\_address text)  
 RETURNS text  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT COALESCE(\_canonical\_user\_id, \_user\_id, \_wallet\_address);  
$function$  
"  
public,\_wallet\_delta\_from\_txn,"tx\_type text, amt numeric","tx\_type text, amt numeric",numeric,sql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.\_wallet\_delta\_from\_txn(tx\_type text, amt numeric)  
 RETURNS numeric  
 LANGUAGE sql  
 IMMUTABLE  
AS $function$  
  SELECT CASE  
           WHEN lower(tx\_type) IN ('topup','top\_up','top-up') THEN GREATEST(amt, 0\)  
           WHEN lower(tx\_type) IN ('entry','entry\_payment','purchase') THEN \-GREATEST(amt, 0\)  
           ELSE 0  
         END;  
$function$  
"  
public,allocate\_lucky\_dip\_tickets\_batch,"p\_user\_id text, p\_competition\_id uuid, p\_count integer, p\_ticket\_price numeric, p\_hold\_minutes integer, p\_session\_id text, p\_excluded\_tickets integer\[\]","p\_user\_id text, p\_competition\_id uuid, p\_count integer, p\_ticket\_price numeric DEFAULT 1, p\_hold\_minutes integer DEFAULT 15, p\_session\_id text DEFAULT NULL::text, p\_excluded\_tickets integer\[\] DEFAULT NULL::integer\[\]",jsonb,plpgsql,true,v,false,false,"Batch-optimized lucky dip allocation supporting up to 500 tickets per call.  
Uses randomized offset for better distribution when multiple requests arrive.  
Accepts pre-excluded tickets to avoid re-querying unavailable tickets.  
For purchases \> 500 tickets, call multiple times with different batches.","CREATE OR REPLACE FUNCTION public.allocate\_lucky\_dip\_tickets\_batch(p\_user\_id text, p\_competition\_id uuid, p\_count integer, p\_ticket\_price numeric DEFAULT 1, p\_hold\_minutes integer DEFAULT 15, p\_session\_id text DEFAULT NULL::text, p\_excluded\_tickets integer\[\] DEFAULT NULL::integer\[\])  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_total\_tickets INTEGER;  
  v\_competition\_uid TEXT;  
  v\_available\_tickets INTEGER\[\];  
  v\_selected\_tickets INTEGER\[\];  
  v\_reservation\_id UUID;  
  v\_expires\_at TIMESTAMPTZ;  
  v\_total\_amount DECIMAL;  
  v\_unavailable\_set INTEGER\[\];  
  v\_available\_count INTEGER;  
  v\_random\_offset INTEGER;  
BEGIN  
  \-- Validate count (increased limit for batch operations)  
  IF p\_count \< 1 THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'Count must be at least 1'  
    );  
  END IF;

  \-- Allow up to 500 tickets per batch call (for bulk operations)  
  IF p\_count \> 500 THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'Count cannot exceed 500 per batch. Use multiple batches for larger purchases.',  
      'max\_batch\_size', 500  
    );  
  END IF;

  \-- Get competition details with row lock  
  SELECT total\_tickets, uid  
  INTO v\_total\_tickets, v\_competition\_uid  
  FROM competitions  
  WHERE id \= p\_competition\_id  
    AND deleted \= false  
    AND status \= 'active'  
  FOR UPDATE SKIP LOCKED;

  IF v\_total\_tickets IS NULL THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'Competition not found, not active, or temporarily locked',  
      'retryable', true  
    );  
  END IF;

  \-- Build set of unavailable tickets from database sources  
  \-- Start with any pre-provided excluded tickets (from caller's cache)  
  v\_unavailable\_set := COALESCE(p\_excluded\_tickets, ARRAY\[\]::INTEGER\[\]);

  \-- Add sold tickets from joincompetition  
  SELECT v\_unavailable\_set || COALESCE(array\_agg(DISTINCT ticket\_num), ARRAY\[\]::INTEGER\[\])  
  INTO v\_unavailable\_set  
  FROM (  
    SELECT CAST(trim(unnest(string\_to\_array(ticketnumbers, ','))) AS INTEGER) AS ticket\_num  
    FROM joincompetition  
    WHERE (competitionid \= p\_competition\_id::TEXT OR competitionid \= v\_competition\_uid)  
      AND ticketnumbers IS NOT NULL  
      AND trim(ticketnumbers) \!= ''  
  ) jc\_tickets  
  WHERE ticket\_num IS NOT NULL AND ticket\_num \>= 1 AND ticket\_num \<= v\_total\_tickets;

  \-- Add sold tickets from tickets table  
  SELECT v\_unavailable\_set || COALESCE(array\_agg(ticket\_number), ARRAY\[\]::INTEGER\[\])  
  INTO v\_unavailable\_set  
  FROM tickets  
  WHERE competition\_id \= p\_competition\_id  
    AND ticket\_number IS NOT NULL;

  \-- Add pending tickets from other users  
  SELECT v\_unavailable\_set || COALESCE(array\_agg(ticket\_num), ARRAY\[\]::INTEGER\[\])  
  INTO v\_unavailable\_set  
  FROM (  
    SELECT unnest(ticket\_numbers) AS ticket\_num  
    FROM pending\_tickets  
    WHERE competition\_id \= p\_competition\_id  
      AND status \= 'pending'  
      AND expires\_at \> NOW()  
      AND user\_id \!= p\_user\_id  
  ) pt;

  \-- Remove duplicates  
  SELECT array\_agg(DISTINCT u) INTO v\_unavailable\_set  
  FROM unnest(v\_unavailable\_set) AS u  
  WHERE u IS NOT NULL;

  v\_unavailable\_set := COALESCE(v\_unavailable\_set, ARRAY\[\]::INTEGER\[\]);

  \-- Generate a random starting offset for better distribution  
  \-- This helps when multiple requests come in simultaneously  
  v\_random\_offset := floor(random() \* v\_total\_tickets)::INTEGER;

  \-- Generate available tickets with randomization  
  \-- Use random offset to start from different positions  
  SELECT array\_agg(n ORDER BY (n \+ v\_random\_offset) % v\_total\_tickets \+ random())  
  INTO v\_available\_tickets  
  FROM generate\_series(1, v\_total\_tickets) AS n  
  WHERE n \!= ALL(v\_unavailable\_set);

  v\_available\_count := COALESCE(array\_length(v\_available\_tickets, 1), 0);

  \-- Check availability  
  IF v\_available\_count \= 0 THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'No tickets available',  
      'available\_count', 0  
    );  
  END IF;

  IF v\_available\_count \< p\_count THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'Insufficient availability',  
      'available\_count', v\_available\_count,  
      'requested\_count', p\_count  
    );  
  END IF;

  \-- Select tickets using the randomized array  
  v\_selected\_tickets := v\_available\_tickets\[1:p\_count\];

  \-- Cancel any existing pending reservations for this user on this competition  
  UPDATE pending\_tickets  
  SET status \= 'cancelled', updated\_at \= NOW()  
  WHERE user\_id \= p\_user\_id  
    AND competition\_id \= p\_competition\_id  
    AND status \= 'pending';

  \-- Generate reservation details  
  v\_reservation\_id := gen\_random\_uuid();  
  v\_expires\_at := NOW() \+ make\_interval(mins \=\> LEAST(GREATEST(p\_hold\_minutes, 1), 60));  
  v\_total\_amount := p\_count \* p\_ticket\_price;

  \-- Create the pending reservation  
  INSERT INTO pending\_tickets (  
    id,  
    user\_id,  
    competition\_id,  
    ticket\_numbers,  
    ticket\_count,  
    ticket\_price,  
    total\_amount,  
    status,  
    session\_id,  
    expires\_at,  
    created\_at,  
    updated\_at  
  ) VALUES (  
    v\_reservation\_id,  
    p\_user\_id,  
    p\_competition\_id,  
    v\_selected\_tickets,  
    p\_count,  
    p\_ticket\_price,  
    v\_total\_amount,  
    'pending',  
    p\_session\_id,  
    v\_expires\_at,  
    NOW(),  
    NOW()  
  );

  \-- Return success with selected tickets  
  RETURN jsonb\_build\_object(  
    'success', true,  
    'reservation\_id', v\_reservation\_id,  
    'ticket\_numbers', v\_selected\_tickets,  
    'ticket\_count', p\_count,  
    'total\_amount', v\_total\_amount,  
    'expires\_at', v\_expires\_at,  
    'available\_count\_after', v\_available\_count \- p\_count  
  );

EXCEPTION WHEN OTHERS THEN  
  RETURN jsonb\_build\_object(  
    'success', false,  
    'error', 'Failed to allocate tickets: ' || SQLERRM,  
    'retryable', true  
  );  
END;  
$function$  
"  
public,allocate\_temp\_canonical\_user,,,jsonb,plpgsql,true,v,false,false,Allocates a unique temporary canonical\_user\_id (prize:pid:temp\<N\>) and uid for email-first signup before wallet connection,"CREATE OR REPLACE FUNCTION public.allocate\_temp\_canonical\_user()  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_temp\_id TEXT;  
  v\_canonical\_user\_id TEXT;  
  v\_uid TEXT;  
BEGIN  
  \-- Allocate next temp ID atomically from sequence  
  v\_temp\_id := nextval('temp\_user\_sequence')::TEXT;  
  v\_canonical\_user\_id := 'prize:pid:temp' || v\_temp\_id;  
    
  \-- Generate unique uid for this user (used as stable identifier)  
  v\_uid := gen\_random\_uuid()::TEXT;  
    
  \-- Return both values for frontend to use  
  RETURN jsonb\_build\_object(  
    'uid', v\_uid,  
    'canonical\_user\_id', v\_canonical\_user\_id,  
    'temp\_id', v\_temp\_id  
  );  
END;  
$function$  
"  
public,apply\_wallet\_mutation,"p\_canonical\_user\_id text, p\_currency text, p\_amount numeric, p\_reference\_id text, p\_description text, p\_top\_up\_tx\_id text","p\_canonical\_user\_id text, p\_currency text, p\_amount numeric, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text, p\_top\_up\_tx\_id text DEFAULT NULL::text",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.apply\_wallet\_mutation(p\_canonical\_user\_id text, p\_currency text, p\_amount numeric, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text, p\_top\_up\_tx\_id text DEFAULT NULL::text)  
 RETURNS TABLE(ledger\_id uuid, canonical\_user\_id text, currency text, amount numeric, balance\_before numeric, balance\_after numeric, available\_balance numeric, top\_up\_tx\_id text)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
declare  
  v\_user\_id text;  
  v\_before numeric;  
  v\_after numeric;  
  v\_ledger\_id uuid;  
  v\_tx\_type text;  
  v\_top\_up\_tx\_id text;  
begin  
  v\_user\_id := case when p\_canonical\_user\_id ilike 'prize:pid:%'  
                    then p\_canonical\_user\_id  
                    else 'prize:pid:' || p\_canonical\_user\_id  
               end;

  if p\_amount \= 0 then  
    raise exception 'Amount must be non-zero';  
  end if;

  if p\_amount \> 0 then  
    v\_tx\_type := 'top\_up';  
    if p\_top\_up\_tx\_id is null or length(trim(p\_top\_up\_tx\_id)) \= 0 then  
      raise exception 'top\_up\_tx\_id is required for top-ups';  
    end if;  
    v\_top\_up\_tx\_id := p\_top\_up\_tx\_id;  
  else  
    v\_tx\_type := 'entry';  
    if p\_top\_up\_tx\_id is not null then  
      raise exception 'top\_up\_tx\_id must be null for debits/entries';  
    end if;  
    v\_top\_up\_tx\_id := null;  
  end if;

  insert into sub\_account\_balances (canonical\_user\_id, currency, available\_balance, pending\_balance)  
  values (v\_user\_id, p\_currency, 0, 0\)  
  on conflict (canonical\_user\_id) do nothing;

  select available\_balance  
    into v\_before  
  from sub\_account\_balances  
  where canonical\_user\_id \= v\_user\_id and currency \= p\_currency  
  for update;

  if v\_before is null then  
    insert into sub\_account\_balances (canonical\_user\_id, currency, available\_balance, pending\_balance)  
    values (v\_user\_id, p\_currency, 0, 0\)  
    on conflict do nothing;

    select available\_balance  
      into v\_before  
    from sub\_account\_balances  
    where canonical\_user\_id \= v\_user\_id and currency \= p\_currency  
    for update;  
  end if;

  v\_after := v\_before \+ p\_amount;

  if v\_after \< 0 then  
    raise exception 'Insufficient funds: % % would drop to %', v\_user\_id, p\_currency, v\_after  
      using errcode \= 'P0001';  
  end if;

  insert into balance\_ledger (  
    id, canonical\_user\_id, transaction\_type, amount, currency,  
    balance\_before, balance\_after, reference\_id, description, created\_at, top\_up\_tx\_id  
  )  
  values (  
    gen\_random\_uuid(),  
    v\_user\_id,  
    v\_tx\_type,  
    p\_amount,  
    p\_currency,  
    v\_before,  
    v\_after,  
    p\_reference\_id,  
    coalesce(p\_description, case when p\_amount \> 0 then 'Top up' else 'Execute balance payment' end),  
    now(),  
    v\_top\_up\_tx\_id  
  )  
  returning id into v\_ledger\_id;

  update sub\_account\_balances  
  set available\_balance \= v\_after,  
      last\_updated \= now()  
  where canonical\_user\_id \= v\_user\_id and currency \= p\_currency;

  return query  
  select v\_ledger\_id, v\_user\_id, p\_currency, p\_amount, v\_before, v\_after, v\_after, v\_top\_up\_tx\_id;  
end;  
$function$  
"  
public,armor,bytea,bytea,text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.armor(bytea)  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_armor$function$  
"  
public,armor,"bytea, text\[\], text\[\]","bytea, text\[\], text\[\]",text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.armor(bytea, text\[\], text\[\])  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_armor$function$  
"  
public,attach\_identity\_after\_auth,"in\_canonical\_user\_id text, in\_wallet\_address text, in\_email text, in\_privy\_user\_id text, in\_prior\_payload jsonb, in\_base\_wallet\_address text, in\_eth\_wallet\_address text","in\_canonical\_user\_id text, in\_wallet\_address text, in\_email text DEFAULT NULL::text, in\_privy\_user\_id text DEFAULT NULL::text, in\_prior\_payload jsonb DEFAULT NULL::jsonb, in\_base\_wallet\_address text DEFAULT NULL::text, in\_eth\_wallet\_address text DEFAULT NULL::text",jsonb,plpgsql,true,v,false,false,Attaches wallet identity to canonical\_users and merges prior signup payload data. Called after successful wallet authentication.,"CREATE OR REPLACE FUNCTION public.attach\_identity\_after\_auth(in\_canonical\_user\_id text, in\_wallet\_address text, in\_email text DEFAULT NULL::text, in\_privy\_user\_id text DEFAULT NULL::text, in\_prior\_payload jsonb DEFAULT NULL::jsonb, in\_base\_wallet\_address text DEFAULT NULL::text, in\_eth\_wallet\_address text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_user\_id uuid;  
  v\_result jsonb;  
BEGIN  
  \-- Normalize inputs with NULL handling  
  in\_wallet\_address := CASE WHEN in\_wallet\_address IS NOT NULL THEN LOWER(TRIM(in\_wallet\_address)) ELSE NULL END;  
  in\_email := CASE WHEN in\_email IS NOT NULL THEN LOWER(TRIM(in\_email)) ELSE NULL END;  
  in\_base\_wallet\_address := CASE WHEN in\_base\_wallet\_address IS NOT NULL THEN LOWER(TRIM(in\_base\_wallet\_address)) ELSE in\_wallet\_address END;  
  in\_eth\_wallet\_address := CASE WHEN in\_eth\_wallet\_address IS NOT NULL THEN LOWER(TRIM(in\_eth\_wallet\_address)) ELSE in\_wallet\_address END;  
    
  \-- Log the operation (without exposing full email for security)  
  RAISE NOTICE 'attach\_identity\_after\_auth: email=%\*\*, wallet=%',   
    CASE WHEN in\_email IS NOT NULL THEN SUBSTRING(in\_email, 1, 3\) ELSE 'NULL' END,  
    CASE WHEN in\_wallet\_address IS NOT NULL THEN SUBSTRING(in\_wallet\_address, 1, 10\) ELSE 'NULL' END;  
    
  \-- Find user by email (case-insensitive) if email provided  
  IF in\_email IS NOT NULL THEN  
    SELECT id INTO v\_user\_id  
    FROM canonical\_users  
    WHERE email ILIKE in\_email  
    LIMIT 1;  
  END IF;  
    
  \-- If user not found and wallet provided, try to find by wallet address  
  IF v\_user\_id IS NULL AND in\_wallet\_address IS NOT NULL THEN  
    SELECT id INTO v\_user\_id  
    FROM canonical\_users  
    WHERE wallet\_address ILIKE in\_wallet\_address  
       OR base\_wallet\_address ILIKE in\_wallet\_address  
       OR eth\_wallet\_address ILIKE in\_wallet\_address  
    LIMIT 1;  
  END IF;  
    
  \-- If still not found, log error and return  
  IF v\_user\_id IS NULL THEN  
    RAISE WARNING 'attach\_identity\_after\_auth: User not found for email=%\*\* or wallet=%',   
      CASE WHEN in\_email IS NOT NULL THEN SUBSTRING(in\_email, 1, 3\) ELSE 'NULL' END,  
      CASE WHEN in\_wallet\_address IS NOT NULL THEN SUBSTRING(in\_wallet\_address, 1, 10\) ELSE 'NULL' END;  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'User not found',  
      'has\_email', (in\_email IS NOT NULL),  
      'has\_wallet', (in\_wallet\_address IS NOT NULL)  
    );  
  END IF;  
    
  \-- Update user with wallet information and merge prior\_payload if provided  
  UPDATE canonical\_users  
  SET  
    canonical\_user\_id \= COALESCE(canonical\_user\_id, in\_canonical\_user\_id),  
    wallet\_address \= COALESCE(wallet\_address, in\_wallet\_address),  
    base\_wallet\_address \= COALESCE(base\_wallet\_address, in\_base\_wallet\_address),  
    eth\_wallet\_address \= COALESCE(eth\_wallet\_address, in\_eth\_wallet\_address),  
    privy\_user\_id \= COALESCE(privy\_user\_id, in\_privy\_user\_id),  
    \-- Merge prior\_payload fields if provided and current value is null  
    username \= CASE  
      WHEN username IS NULL AND in\_prior\_payload IS NOT NULL  
      THEN in\_prior\_payload-\>\>'username'  
      ELSE username  
    END,  
    first\_name \= CASE  
      WHEN first\_name IS NULL AND in\_prior\_payload IS NOT NULL  
      THEN in\_prior\_payload-\>\>'first\_name'  
      ELSE first\_name  
    END,  
    last\_name \= CASE  
      WHEN last\_name IS NULL AND in\_prior\_payload IS NOT NULL  
      THEN in\_prior\_payload-\>\>'last\_name'  
      ELSE last\_name  
    END,  
    country \= CASE  
      WHEN country IS NULL AND in\_prior\_payload IS NOT NULL  
      THEN in\_prior\_payload-\>\>'country'  
      ELSE country  
    END,  
    telegram\_handle \= CASE  
      WHEN telegram\_handle IS NULL AND in\_prior\_payload IS NOT NULL  
      THEN in\_prior\_payload-\>\>'telegram\_handle'  
      ELSE telegram\_handle  
    END,  
    avatar\_url \= CASE  
      WHEN avatar\_url IS NULL AND in\_prior\_payload IS NOT NULL  
      THEN in\_prior\_payload-\>\>'avatar\_url'  
      ELSE avatar\_url  
    END,  
    updated\_at \= NOW()  
  WHERE id \= v\_user\_id;  
    
  \-- Build success response  
  v\_result := jsonb\_build\_object(  
    'success', true,  
    'user\_id', v\_user\_id,  
    'canonical\_user\_id', in\_canonical\_user\_id,  
    'wallet\_linked', (in\_wallet\_address IS NOT NULL),  
    'prior\_payload\_merged', (in\_prior\_payload IS NOT NULL)  
  );  
    
  RAISE NOTICE 'attach\_identity\_after\_auth: Success for user\_id=%', v\_user\_id;  
    
  RETURN v\_result;  
    
EXCEPTION  
  WHEN OTHERS THEN  
    RAISE WARNING 'attach\_identity\_after\_auth: Error \- %', SQLERRM;  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', SQLERRM  
    );  
END;  
$function$  
"  
public,auto\_debit\_on\_balance\_order,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.auto\_debit\_on\_balance\_order()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_amount numeric;  
  v\_tx json;  
BEGIN  
  IF (TG\_OP \= 'INSERT' OR TG\_OP \= 'UPDATE') AND  
     (NEW.payment\_method \= 'balance' OR NEW.order\_type \= 'balance') AND  
     (NEW.status ILIKE 'completed' OR COALESCE(NEW.payment\_status,'') ILIKE 'paid%') THEN

    v\_amount := COALESCE(NEW.amount\_usd, NEW.amount);  
    v\_tx := public.debit\_balance\_and\_confirm\_tickets(  
      NEW.user\_id,  
      NEW.id,  
      NEW.competition\_id,  
      v\_amount,  
      md5(NEW.id::text || '-balance'),  
      'USD'  
    );  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,auto\_expire\_reservations,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.auto\_expire\_reservations()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.expires\_at IS NOT NULL AND NEW.expires\_at \< NOW() AND NEW.status \= 'pending' THEN NEW.status := 'expired'; END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,award\_first\_topup\_bonus,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.award\_first\_topup\_bonus()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_first\_tx\_id uuid;  
  v\_first\_amount numeric;  
  v\_bonus numeric;  
  v\_cu\_id uuid;  
  v\_canonical\_user\_id text;  
  v\_wallet\_address text;  
  v\_privy\_user\_id text;  
BEGIN  
  \-- Only react to transitions to completed  
  IF TG\_OP \<\> 'UPDATE' OR (OLD.status \= NEW.status) OR NEW.status \<\> 'completed' THEN  
    RETURN NEW;  
  END IF;

  \-- Only deposits/top\_up in USD sub-account  
  IF NEW.transaction\_type NOT IN ('deposit','top\_up') OR NEW.currency IS NULL OR NEW.currency NOT ILIKE 'USD%' THEN  
    RETURN NEW;  
  END IF;

  \-- Map user  
  SELECT cu.id, cu.canonical\_user\_id, cu.wallet\_address, cu.privy\_user\_id  
    INTO v\_cu\_id, v\_canonical\_user\_id, v\_wallet\_address, v\_privy\_user\_id  
  FROM public.canonical\_users cu  
  WHERE cu.id \= NEW.user\_id;

  IF v\_cu\_id IS NULL THEN  
    \-- No matching canonical user; nothing to do  
    RETURN NEW;  
  END IF;

  \-- Skip if user already used bonus  
  PERFORM 1 FROM public.canonical\_users cu  
   WHERE cu.id \= v\_cu\_id AND cu.has\_used\_new\_user\_bonus \= true;  
  IF FOUND THEN  
    RETURN NEW;  
  END IF;

  \-- Identify the true first completed USD deposit/top\_up for this user  
  SELECT ct.id, ct.amount  
    INTO v\_first\_tx\_id, v\_first\_amount  
  FROM public.custody\_transactions ct  
  WHERE ct.user\_id \= v\_cu\_id  
    AND ct.status \= 'completed'  
    AND ct.transaction\_type IN ('deposit','top\_up')  
    AND ct.currency ILIKE 'USD%'  
  ORDER BY ct.created\_at ASC, ct.id ASC  
  LIMIT 1;

  \-- If none found or current row isn't the first, exit  
  IF v\_first\_tx\_id IS NULL OR v\_first\_tx\_id \<\> NEW.id THEN  
    RETURN NEW;  
  END IF;

  \-- Compute 50% bonus (no cap)  
  v\_bonus := COALESCE(v\_first\_amount, 0\) \* 0.5;  
  IF v\_bonus \<= 0 THEN  
    RETURN NEW;  
  END IF;

  \-- Atomically mark bonus used and credit balance  
  UPDATE public.canonical\_users cu  
     SET bonus\_balance \= COALESCE(cu.bonus\_balance, 0\) \+ v\_bonus,  
         has\_used\_new\_user\_bonus \= true,  
         updated\_at \= now()  
   WHERE cu.id \= v\_cu\_id;

  \-- Log user transaction with audit fields  
  INSERT INTO public.user\_transactions (  
    user\_id,  
    canonical\_user\_id,  
    wallet\_address,  
    user\_privy\_id,  
    type,  
    amount,  
    currency,  
    description  
  ) VALUES (  
    v\_cu\_id::text,  
    v\_canonical\_user\_id,  
    v\_wallet\_address,  
    v\_privy\_user\_id,  
    'bonus\_credit',  
    v\_bonus,  
    'USD',  
    'First deposit 50% bonus'  
  );

  RETURN NEW;  
END;  
$function$  
"  
public,award\_first\_topup\_bonus,"p\_canonical\_user\_id text, p\_topup\_amount numeric, p\_bonus\_amount numeric, p\_currency text, p\_provider text, p\_tx\_ref text","p\_canonical\_user\_id text, p\_topup\_amount numeric, p\_bonus\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_provider text DEFAULT 'topup'::text, p\_tx\_ref text DEFAULT NULL::text",record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.award\_first\_topup\_bonus(p\_canonical\_user\_id text, p\_topup\_amount numeric, p\_bonus\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_provider text DEFAULT 'topup'::text, p\_tx\_ref text DEFAULT NULL::text)  
 RETURNS TABLE(balance\_before numeric, balance\_after numeric, bonus\_applied boolean, bonus\_amount numeric)  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_before numeric := 0;  
  v\_after numeric := 0;  
  v\_bonus\_applied boolean := false;  
  v\_has\_used boolean := false;  
  v\_existing\_balance record;  
  v\_user\_id uuid;  
BEGIN  
  IF p\_topup\_amount \<= 0 THEN  
    RAISE EXCEPTION 'Topup amount must be positive';  
  END IF;  
  IF p\_bonus\_amount \< 0 THEN  
    RAISE EXCEPTION 'Bonus amount cannot be negative';  
  END IF;

  \-- 1\) Lock/seed sub\_account\_balances row  
  LOOP  
    BEGIN  
      SELECT \* INTO v\_existing\_balance  
      FROM public.sub\_account\_balances  
      WHERE canonical\_user\_id \= p\_canonical\_user\_id AND currency \= p\_currency  
      FOR UPDATE;

      IF NOT FOUND THEN  
        INSERT INTO public.sub\_account\_balances (canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated)  
        VALUES (p\_canonical\_user\_id, p\_currency, 0, 0, now())  
        ON CONFLICT (canonical\_user\_id, currency) DO NOTHING;  
        CONTINUE;  
      END IF;

      EXIT;  
    EXCEPTION WHEN unique\_violation THEN  
      CONTINUE;  
    END;  
  END LOOP;

  v\_before := COALESCE(v\_existing\_balance.available\_balance, 0);

  \-- 2\) Check and lock canonical\_users row for first-bonus flag  
  \-- Seed canonical\_users row if missing (by canonical\_user\_id), capturing its UUID id for potential FKs  
  LOOP  
    BEGIN  
      SELECT id, has\_used\_new\_user\_bonus  
      INTO v\_user\_id, v\_has\_used  
      FROM public.canonical\_users  
      WHERE canonical\_user\_id \= p\_canonical\_user\_id  
      FOR UPDATE;

      IF NOT FOUND THEN  
        INSERT INTO public.canonical\_users (canonical\_user\_id)  
        VALUES (p\_canonical\_user\_id)  
        ON CONFLICT (canonical\_user\_id) DO NOTHING;  
        CONTINUE;  
      END IF;

      EXIT;  
    EXCEPTION WHEN unique\_violation THEN  
      CONTINUE;  
    END;  
  END LOOP;

  \-- 3\) Apply top-up and first-time bonus exactly once  
  v\_after := v\_before \+ p\_topup\_amount;

  IF NOT v\_has\_used AND p\_bonus\_amount \> 0 THEN  
    v\_after := v\_after \+ p\_bonus\_amount;  
    v\_bonus\_applied := true;

    UPDATE public.canonical\_users  
    SET has\_used\_new\_user\_bonus \= true,  
        updated\_at \= now()  
    WHERE id \= v\_user\_id;

    \-- Audit bonus award  
    INSERT INTO public.bonus\_award\_audit (  
      canonical\_user\_id,  
      amount,  
      currency,  
      awarded\_at,  
      reason,  
      sub\_account\_balance\_before,  
      sub\_account\_balance\_after,  
      note  
    ) VALUES (  
      p\_canonical\_user\_id,  
      p\_bonus\_amount,  
      p\_currency,  
      now(),  
      'first\_topup\_bonus',  
      v\_before,  
      v\_after,  
      p\_tx\_ref  
    );  
  END IF;

  \-- 4\) Persist balance  
  UPDATE public.sub\_account\_balances  
  SET available\_balance \= v\_after,  
      last\_updated \= now()  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id AND currency \= p\_currency;

  \-- 5\) Log transactions: topup and bonus (if applied)  
  INSERT INTO public.user\_transactions (  
    user\_id,  
    canonical\_user\_id,  
    type,  
    amount,  
    currency,  
    balance\_before,  
    balance\_after,  
    status,  
    description,  
    metadata  
  ) VALUES (  
    p\_canonical\_user\_id, \-- storing canonical id in user\_id for compatibility with your schema  
    p\_canonical\_user\_id,  
    'topup',  
    p\_topup\_amount,  
    p\_currency,  
    v\_before,  
    v\_before \+ p\_topup\_amount,  
    'completed',  
    'Balance top-up',  
    jsonb\_build\_object('provider', p\_provider, 'tx\_ref', p\_tx\_ref)  
  );

  IF v\_bonus\_applied THEN  
    INSERT INTO public.user\_transactions (  
      user\_id,  
      canonical\_user\_id,  
      type,  
      amount,  
      currency,  
      balance\_before,  
      balance\_after,  
      status,  
      description,  
      metadata  
    ) VALUES (  
      p\_canonical\_user\_id,  
      p\_canonical\_user\_id,  
      'bonus\_credit',  
      p\_bonus\_amount,  
      p\_currency,  
      v\_before \+ p\_topup\_amount,  
      v\_after,  
      'completed',  
      'First-time top-up bonus',  
      jsonb\_build\_object('provider', p\_provider, 'tx\_ref', p\_tx\_ref)  
    );  
  END IF;

  RETURN QUERY SELECT v\_before, v\_after, v\_bonus\_applied, CASE WHEN v\_bonus\_applied THEN p\_bonus\_amount ELSE 0 END;  
END;  
$function$  
"  
public,award\_first\_topup\_bonus\_via\_webhook,"p\_provider\_event\_id text, p\_preferred\_currency text, p\_bonus\_amount numeric","p\_provider\_event\_id text, p\_preferred\_currency text DEFAULT 'USDC'::text, p\_bonus\_amount numeric DEFAULT NULL::numeric",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.award\_first\_topup\_bonus\_via\_webhook(p\_provider\_event\_id text, p\_preferred\_currency text DEFAULT 'USDC'::text, p\_bonus\_amount numeric DEFAULT NULL::numeric)  
 RETURNS TABLE(success boolean, bonus\_applied boolean, bonus\_amount numeric, balance\_before numeric, balance\_after numeric, canonical\_user\_id text, credited\_amount numeric, credited\_currency text)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_row record;  
  v\_is\_first boolean;  
  v\_amount numeric;  
  v\_currency text;  
  v\_bonus numeric;  
  v\_before numeric;  
  v\_after numeric;  
  v\_res record;  
BEGIN  
  SELECT e.id,  
         e.provider,  
         e.event\_type,  
         e.event\_id,  
         e.status,  
         (e.payload-\>'event'-\>'data'-\>'metadata'-\>\>'user\_id')::text AS canonical\_user\_id,  
         COALESCE(  
           NULLIF((e.payload-\>'event'-\>'data'-\>'pricing'-\>'settlement'-\>\>'amount')::numeric, NULL),  
           (e.payload-\>'event'-\>'data'-\>'pricing'-\>'local'-\>\>'amount')::numeric  
         ) AS amt,  
         COALESCE(  
           NULLIF((e.payload-\>'event'-\>'data'-\>'pricing'-\>'settlement'-\>\>'currency')::text, ''),  
           (e.payload-\>'event'-\>'data'-\>'pricing'-\>'local'-\>\>'currency')::text  
         ) AS cur  
  INTO v\_row  
  FROM public.payment\_webhook\_events e  
  WHERE e.provider \= 'coinbase-commerce'  
    AND e.event\_id \= p\_provider\_event\_id  
    AND e.event\_type \= 'charge:confirmed'  
  LIMIT 1;

  IF NOT FOUND OR v\_row.canonical\_user\_id IS NULL OR v\_row.amt IS NULL THEN  
    RETURN QUERY SELECT false, false, 0::numeric, NULL::numeric, NULL::numeric, NULL::text, NULL::numeric, NULL::text;  
    RETURN;  
  END IF;

  IF v\_row.status \= 'confirmed' OR v\_row.status \= 'COMPLETED' THEN  
    SELECT sab.available\_balance INTO v\_after  
    FROM sub\_account\_balances sab  
    WHERE sab.canonical\_user\_id \= v\_row.canonical\_user\_id  
      AND sab.currency \= COALESCE(p\_preferred\_currency, v\_row.cur)  
    LIMIT 1;

    RETURN QUERY SELECT true, false, 0::numeric, NULL::numeric, COALESCE(v\_after,0), v\_row.canonical\_user\_id, NULL::numeric, COALESCE(p\_preferred\_currency, v\_row.cur);  
    RETURN;  
  END IF;

  v\_currency := COALESCE(p\_preferred\_currency, v\_row.cur);  
  v\_amount := v\_row.amt;

  SELECT NOT EXISTS (  
    SELECT 1  
    FROM public.payment\_webhook\_events pe  
    WHERE pe.provider \= 'coinbase-commerce'  
      AND pe.event\_type \= 'charge:confirmed'  
      AND (pe.payload-\>'event'-\>'data'-\>'metadata'-\>\>'type') IN ('topup','TOPUP')  
      AND (pe.payload-\>'event'-\>'data'-\>'metadata'-\>\>'user\_id') \= v\_row.canonical\_user\_id  
      AND pe.event\_id \<\> p\_provider\_event\_id  
  ) INTO v\_is\_first;

  v\_bonus := COALESCE(p\_bonus\_amount, ROUND(v\_amount \* 0.5, 2));

  SELECT \* INTO v\_res  
  FROM credit\_sub\_account\_balance(  
    v\_row.canonical\_user\_id, v\_amount, v\_currency, p\_provider\_event\_id, 'Top-up (principal)'  
  );

  IF NOT v\_res.success THEN  
    RETURN QUERY SELECT false, false, 0::numeric, v\_res.previous\_balance, v\_res.new\_balance, v\_row.canonical\_user\_id, v\_amount, v\_currency;  
    RETURN;  
  END IF;

  v\_before := v\_res.previous\_balance;  
  v\_after := v\_res.new\_balance;

  IF v\_is\_first AND v\_bonus \> 0 THEN  
    SELECT \* INTO v\_res  
    FROM credit\_sub\_account\_balance(  
      v\_row.canonical\_user\_id, v\_bonus, v\_currency, p\_provider\_event\_id, 'First top-up bonus (50%)'  
    );  
    IF v\_res.success THEN  
      v\_after := v\_res.new\_balance;  
      UPDATE public.payment\_webhook\_events  
      SET status \= 'confirmed',  
          processed\_at \= now(),  
          signature\_valid \= COALESCE(signature\_valid, true)  
      WHERE event\_id \= p\_provider\_event\_id;  
      RETURN QUERY SELECT true, true, v\_bonus, v\_before, v\_after, v\_row.canonical\_user\_id, v\_amount, v\_currency;  
      RETURN;  
    END IF;  
  END IF;

  UPDATE public.payment\_webhook\_events  
  SET status \= 'confirmed',  
      processed\_at \= now(),  
      signature\_valid \= COALESCE(signature\_valid, true)  
  WHERE event\_id \= p\_provider\_event\_id;

  RETURN QUERY SELECT true, false, 0::numeric, v\_before, v\_after, v\_row.canonical\_user\_id, v\_amount, v\_currency;  
END;  
$function$  
"  
public,award\_welcome\_bonus,"p\_wallet text, p\_threshold numeric","p\_wallet text, p\_threshold numeric DEFAULT 3",void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.award\_welcome\_bonus(p\_wallet text, p\_threshold numeric DEFAULT 3\)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_user record;  
  v\_sub record;  
  v\_prev numeric := 0;  
  v\_new numeric := 0;  
  v\_bonus numeric := 0;  
  v\_already\_awarded boolean := false;  
BEGIN  
  \-- Find the user by wallet  
  SELECT cu.\* INTO v\_user  
  FROM public.canonical\_users cu  
  WHERE cu.wallet\_address \= p\_wallet  
  LIMIT 1;  
  IF NOT FOUND THEN RETURN; END IF;

  \-- Latest USD balance row for this wallet  
  SELECT sab.\* INTO v\_sub  
  FROM public.sub\_account\_balances sab  
  WHERE sab.wallet\_address \= p\_wallet AND sab.currency \= 'USD'  
  ORDER BY sab.last\_updated DESC NULLS LAST  
  LIMIT 1;  
  IF NOT FOUND THEN RETURN; END IF;

  v\_new := COALESCE(v\_sub.available\_balance, 0);  
  v\_prev := GREATEST(0, COALESCE(v\_new,0) \- COALESCE(v\_sub.pending\_balance,0)); \-- fallback if no old row; not reliable

  \-- Check flag and prior tx for idempotency  
  v\_already\_awarded := COALESCE(v\_user.has\_used\_new\_user\_bonus, false);  
  IF v\_already\_awarded \= false THEN  
    SELECT EXISTS (  
      SELECT 1 FROM public.user\_transactions ut  
      WHERE ut.wallet\_address \= p\_wallet AND ut.type \= 'welcome\_bonus'  
    ) INTO v\_already\_awarded;  
  END IF;  
  IF v\_already\_awarded THEN RETURN; END IF;

  \-- Qualify only if balance \> threshold  
  IF v\_new \<= p\_threshold THEN RETURN; END IF;

  \-- Compute the user's first deposit amount. We approximate as v\_new when crossing threshold,  
  \-- since trigger calls on the first time balance becomes \> threshold.  
  \-- Award 50% of that amount.  
  v\_bonus := ROUND(v\_new \* 0.5, 2);  
  IF v\_bonus \<= 0 THEN RETURN; END IF;

  \-- Insert transaction  
  INSERT INTO public.user\_transactions (  
    user\_id, canonical\_user\_id, wallet\_address, type, amount, currency, description  
  ) VALUES (  
    v\_user.uid, v\_user.canonical\_user\_id, p\_wallet, 'welcome\_bonus', v\_bonus, 'USD', '50% welcome bonus on first deposit'  
  );

  \-- Update user bonus balance and flag  
  UPDATE public.canonical\_users  
  SET bonus\_balance \= COALESCE(bonus\_balance, 0\) \+ v\_bonus,  
      has\_used\_new\_user\_bonus \= true,  
      updated\_at \= now()  
  WHERE id \= v\_user.id;

  \-- Audit  
  INSERT INTO public.bonus\_award\_audit (  
    wallet\_address, canonical\_user\_id, amount, currency, reason, sub\_account\_balance\_before, sub\_account\_balance\_after, note  
  ) VALUES (  
    p\_wallet, v\_user.canonical\_user\_id, v\_bonus, 'USD', 'first\_topup\_over\_threshold\_50\_percent', NULL, v\_new, 'Auto-award 50% via award\_welcome\_bonus()'  
  );  
END;  
$function$  
"  
public,award\_welcome\_bonus,"p\_wallet text, p\_threshold numeric, p\_bonus numeric","p\_wallet text, p\_threshold numeric DEFAULT 3, p\_bonus numeric DEFAULT 100",void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.award\_welcome\_bonus(p\_wallet text, p\_threshold numeric DEFAULT 3, p\_bonus numeric DEFAULT 100\)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_user record;  
  v\_sub record;  
  v\_already\_awarded boolean := false;  
BEGIN  
  \-- Find the user by wallet  
  SELECT cu.\* INTO v\_user  
  FROM public.canonical\_users cu  
  WHERE cu.wallet\_address \= p\_wallet  
  LIMIT 1;

  IF NOT FOUND THEN  
    \-- No user for this wallet; nothing to do  
    RETURN;  
  END IF;

  \-- Check sub account latest balance for this wallet (USD only)  
  SELECT sab.\* INTO v\_sub  
  FROM public.sub\_account\_balances sab  
  WHERE sab.wallet\_address \= p\_wallet AND sab.currency \= 'USD'  
  ORDER BY sab.last\_updated DESC NULLS LAST  
  LIMIT 1;

  IF NOT FOUND THEN  
    RETURN; \-- No balance row; skip  
  END IF;

  \-- Check if already awarded via flag  
  v\_already\_awarded := COALESCE(v\_user.has\_used\_new\_user\_bonus, false);

  \-- If not flagged, double-check no existing welcome\_bonus tx for safety  
  IF v\_already\_awarded \= false THEN  
    SELECT EXISTS (  
      SELECT 1 FROM public.user\_transactions ut  
      WHERE ut.wallet\_address \= p\_wallet AND ut.type \= 'welcome\_bonus'  
    ) INTO v\_already\_awarded;  
  END IF;

  \-- Qualifies only if available\_balance \> threshold and not already awarded  
  IF COALESCE(v\_sub.available\_balance, 0\) \> p\_threshold AND v\_already\_awarded \= false THEN  
    \-- Insert transaction  
    INSERT INTO public.user\_transactions (  
      user\_id, canonical\_user\_id, wallet\_address, type, amount, currency, description  
    ) VALUES (  
      v\_user.uid, v\_user.canonical\_user\_id, p\_wallet, 'welcome\_bonus', p\_bonus, 'USD', 'One-time welcome bonus on first top-up'  
    );

    \-- Update user bonus balance and flag  
    UPDATE public.canonical\_users  
    SET bonus\_balance \= COALESCE(bonus\_balance, 0\) \+ p\_bonus,  
        has\_used\_new\_user\_bonus \= true,  
        updated\_at \= now()  
    WHERE id \= v\_user.id;

    \-- Audit  
    INSERT INTO public.bonus\_award\_audit (  
      wallet\_address, canonical\_user\_id, amount, currency, reason, sub\_account\_balance\_before, sub\_account\_balance\_after, note  
    ) VALUES (  
      p\_wallet, v\_user.canonical\_user\_id, p\_bonus, 'USD', 'first\_topup\_over\_threshold', NULL, v\_sub.available\_balance, 'Auto-award via award\_welcome\_bonus()'  
    );  
  END IF;

  RETURN;  
END;  
$function$  
"  
public,backfill\_competition\_entries,p\_competition\_id uuid,p\_competition\_id uuid DEFAULT NULL::uuid,void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.backfill\_competition\_entries(p\_competition\_id uuid DEFAULT NULL::uuid)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  \-- Use canonical unique key for upsert  
  INSERT INTO public.competition\_entries AS ce (  
    canonical\_user\_id,  
    competition\_id,  
    wallet\_address,  
    tickets\_count,  
    ticket\_numbers\_csv,  
    amount\_spent,  
    payment\_methods,  
    latest\_purchase\_at,  
    created\_at,  
    updated\_at,  
    username  
  )  
  SELECT  
    t.canonical\_user\_id,  
    t.competition\_id,  
    max(t.wallet\_address) FILTER (WHERE t.wallet\_address IS NOT NULL) AS wallet\_address,  
    count(\*)::int AS tickets\_count,  
    string\_agg(t.ticket\_number::text, ', ' ORDER BY t.ticket\_number) AS ticket\_numbers\_csv,  
    sum(coalesce(t.purchase\_price, 0)) AS amount\_spent,  
    string\_agg(DISTINCT coalesce(t.payment\_provider, 'unknown'), ', ') AS payment\_methods,  
    max(t.created\_at) AS latest\_purchase\_at,  
    now(),  
    now(),  
    max(p.username) FILTER (WHERE p.username IS NOT NULL) AS username  
  FROM public.tickets t  
  LEFT JOIN public.profiles p ON p.canonical\_user\_id \= t.canonical\_user\_id  
  WHERE t.canonical\_user\_id IS NOT NULL  
    AND (p\_competition\_id IS NULL OR t.competition\_id \= p\_competition\_id)  
  GROUP BY t.canonical\_user\_id, t.competition\_id  
  ON CONFLICT (canonical\_user\_id, competition\_id) DO UPDATE  
  SET  
    tickets\_count \= EXCLUDED.tickets\_count,  
    ticket\_numbers\_csv \= EXCLUDED.ticket\_numbers\_csv,  
    amount\_spent \= EXCLUDED.amount\_spent,  
    payment\_methods \= EXCLUDED.payment\_methods,  
    latest\_purchase\_at \= EXCLUDED.latest\_purchase\_at,  
    updated\_at \= now(),  
    username \= COALESCE(EXCLUDED.username, ce.username),  
    wallet\_address \= COALESCE(EXCLUDED.wallet\_address, ce.wallet\_address);  
END;  
$function$  
"  
public,balance\_ledger\_sync\_wallet,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.balance\_ledger\_sync\_wallet()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_delta numeric;  
  v\_before numeric;  
  v\_after numeric;  
BEGIN  
  IF NEW.canonical\_user\_id IS NULL THEN  
    RETURN NEW; \-- nothing we can do  
  END IF;

  IF NEW.amount IS NULL OR NEW.amount \= 0 THEN  
    RETURN NEW;  
  END IF;

  v\_delta := public.\_wallet\_delta\_from\_txn(NEW.transaction\_type, NEW.amount);

  SELECT balance\_before, balance\_after INTO v\_before, v\_after  
  FROM public.\_apply\_wallet\_delta(NEW.canonical\_user\_id, COALESCE(NEW.currency,'USD'), v\_delta);

  \-- Backfill before/after if not set  
  IF NEW.balance\_before IS NULL OR NEW.balance\_after IS NULL THEN  
    UPDATE public.balance\_ledger  
    SET balance\_before \= COALESCE(NEW.balance\_before, v\_before),  
        balance\_after  \= COALESCE(NEW.balance\_after,  v\_after)  
    WHERE id \= NEW.id;  
  END IF;

  RETURN NEW;  
END;  
$function$  
"  
public,bcast\_ticket\_changes,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.bcast\_ticket\_changes()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  PERFORM realtime.broadcast\_changes(  
    'competition:' || COALESCE(NEW.competition\_id, OLD.competition\_id)::text || ':tickets',  
    TG\_OP,  
    TG\_OP,  
    TG\_TABLE\_NAME,  
    TG\_TABLE\_SCHEMA,  
    NEW,  
    OLD  
  );  
  RETURN COALESCE(NEW, OLD);  
END;  
$function$  
"  
public,bcast\_winner\_changes,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.bcast\_winner\_changes()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  PERFORM realtime.broadcast\_changes(  
    'competition:' || COALESCE(NEW.competition\_id, OLD.competition\_id)::text || ':winners',  
    TG\_OP,  
    TG\_OP,  
    TG\_TABLE\_NAME,  
    TG\_TABLE\_SCHEMA,  
    NEW,  
    OLD  
  );  
  RETURN COALESCE(NEW, OLD);  
END;  
$function$  
"  
public,broadcast\_table\_changes,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
      BEGIN  
        PERFORM pg\_notify(  
          'table\_changes',  
          json\_build\_object(  
            'table', TG\_TABLE\_NAME,  
            'operation', TG\_OP,  
            'timestamp', NOW(),  
            'data', CASE  
              WHEN TG\_OP \= 'DELETE' THEN row\_to\_json(OLD)  
              ELSE row\_to\_json(NEW)  
            END  
          )::text  
        );  
        RETURN CASE WHEN TG\_OP \= 'DELETE' THEN OLD ELSE NEW END;  
      END;  
      $function$  
"  
public,call\_profiles\_processor\_async,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.call\_profiles\_processor\_async()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  PERFORM net.http\_post(  
    url := current\_setting('app.settings.supabase\_url', true) || '/functions/v1/profiles-processor',  
    headers := jsonb\_build\_object(  
      'Authorization', 'Bearer ' || current\_setting('app.settings.service\_role\_key', true),  
      'Content-Type', 'application/json'  
    ),  
    body := '{}'::jsonb  
  );  
  RETURN NEW;  
END;  
$function$  
"  
public,canonical\_users\_normalize,,,trigger,plpgsql,false,v,false,false,Normalizes wallet addresses to lowercase and auto-generates canonical\_user\_id (skips temp placeholders),"CREATE OR REPLACE FUNCTION public.canonical\_users\_normalize()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  \-- Normalize all wallet address fields using util function for consistency  
  IF NEW.wallet\_address IS NOT NULL THEN  
    NEW.wallet\_address := util.normalize\_evm\_address(NEW.wallet\_address);  
  END IF;  
    
  IF NEW.base\_wallet\_address IS NOT NULL THEN  
    NEW.base\_wallet\_address := util.normalize\_evm\_address(NEW.base\_wallet\_address);  
  END IF;  
    
  IF NEW.eth\_wallet\_address IS NOT NULL THEN  
    NEW.eth\_wallet\_address := util.normalize\_evm\_address(NEW.eth\_wallet\_address);  
  END IF;

  \-- Auto-generate canonical\_user\_id if missing and we have a wallet address  
  \-- IMPORTANT: Skip this if canonical\_user\_id is a temporary placeholder (prize:pid:temp\<N\>)  
  IF NEW.canonical\_user\_id IS NULL AND COALESCE(NEW.wallet\_address, NEW.base\_wallet\_address, NEW.eth\_wallet\_address) IS NOT NULL THEN  
    NEW.canonical\_user\_id := 'prize:pid:' || COALESCE(NEW.wallet\_address, NEW.base\_wallet\_address, NEW.eth\_wallet\_address);  
  END IF;

  RETURN NEW;  
END;  
$function$  
"  
public,canonical\_users\_normalize\_before\_write,,,trigger,plpgsql,false,v,false,false,Advanced normalization that ensures canonical\_user\_id and wallet\_address consistency (skips temp placeholders),"CREATE OR REPLACE FUNCTION public.canonical\_users\_normalize\_before\_write()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  \-- Normalize wallet\_address using util function  
  IF NEW.wallet\_address IS NOT NULL THEN  
    NEW.wallet\_address := util.normalize\_evm\_address(NEW.wallet\_address);  
  END IF;

  \-- Set canonical\_user\_id based on wallet\_address  
  IF NEW.wallet\_address IS NOT NULL THEN  
    NEW.canonical\_user\_id := 'prize:pid:' || NEW.wallet\_address;  
  \-- IMPORTANT: Only extract wallet from canonical\_user\_id if it's NOT a temporary placeholder  
  ELSIF NEW.canonical\_user\_id IS NOT NULL AND NEW.canonical\_user\_id NOT LIKE 'prize:pid:temp%' THEN  
    IF POSITION('prize:pid:' IN NEW.canonical\_user\_id) \= 1 THEN  
      \-- Use SUBSTRING to safely extract the wallet address part  
      NEW.wallet\_address := SUBSTRING(NEW.canonical\_user\_id FROM 11);  
      \-- Only normalize if it looks like a valid address (starts with 0x)  
      IF NEW.wallet\_address LIKE '0x%' THEN  
        NEW.wallet\_address := util.normalize\_evm\_address(NEW.wallet\_address);  
        NEW.canonical\_user\_id := 'prize:pid:' || NEW.wallet\_address;  
      END IF;  
    END IF;  
  END IF;

  RETURN NEW;  
END;  
$function$  
"  
public,check\_and\_mark\_competition\_sold\_out,p\_competition\_id text,p\_competition\_id text,bool,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.check\_and\_mark\_competition\_sold\_out(p\_competition\_id text)  
 RETURNS boolean  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public', 'pg\_temp'  
AS $function$  
DECLARE  
  v\_competition\_uuid UUID;  
  v\_total\_tickets INTEGER;  
  v\_sold\_count INTEGER;  
  v\_is\_sold\_out BOOLEAN := FALSE;  
BEGIN  
  IF p\_competition\_id IS NULL OR TRIM(p\_competition\_id) \= '' THEN  
    RETURN FALSE;  
  END IF;  
  BEGIN  
    v\_competition\_uuid := p\_competition\_id::UUID;  
  EXCEPTION WHEN invalid\_text\_representation THEN  
    SELECT id INTO v\_competition\_uuid  
    FROM competitions  
    WHERE uid \= p\_competition\_id  
    LIMIT 1;  
    IF v\_competition\_uuid IS NULL THEN  
      RETURN FALSE;  
    END IF;  
  END;

  SELECT total\_tickets INTO v\_total\_tickets  
  FROM competitions  
  WHERE id \= v\_competition\_uuid;

  IF v\_total\_tickets IS NULL THEN  
    RETURN FALSE;  
  END IF;

  \-- joincompetition.competitionid is UUID in this DB; compare UUID to UUID  
  SELECT COALESCE(SUM(numberoftickets), 0\) INTO v\_sold\_count  
  FROM joincompetition  
  WHERE competitionid \= v\_competition\_uuid;

  IF v\_sold\_count \>= v\_total\_tickets THEN  
    v\_is\_sold\_out := TRUE;  
    UPDATE competitions  
    SET status \= 'sold\_out',  
        updated\_at \= NOW()  
    WHERE id \= v\_competition\_uuid  
      AND status NOT IN ('sold\_out', 'drawn', 'completed', 'cancelled');  
  END IF;

  RETURN v\_is\_sold\_out;  
END;  
$function$  
"  
public,check\_and\_mark\_competition\_sold\_out,p\_competition\_id uuid,p\_competition\_id uuid,bool,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.check\_and\_mark\_competition\_sold\_out(p\_competition\_id uuid)  
 RETURNS boolean  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_total int;  
  v\_sold\_reserved int;  
  v\_remaining int;  
  v\_status text;  
BEGIN  
  SELECT total\_tickets, status INTO v\_total, v\_status  
  FROM public.competitions WHERE id \= p\_competition\_id FOR UPDATE;  
  IF v\_total IS NULL THEN  
    RETURN false; \-- competition not found  
  END IF;

  SELECT COALESCE(COUNT(\*),0) INTO v\_sold\_reserved  
  FROM public.tickets  
  WHERE competition\_id \= p\_competition\_id AND status IN ('sold','reserved');

  v\_remaining := GREATEST(v\_total \- v\_sold\_reserved, 0);

  IF v\_remaining \= 0 AND v\_status IN ('active','live','drawing') THEN  
    UPDATE public.competitions  
    SET status \= 'sold\_out', updated\_at \= NOW()  
    WHERE id \= p\_competition\_id AND status IN ('active','live','drawing');  
  END IF;

  RETURN v\_remaining \= 0;  
END;$function$  
"  
public,check\_balance\_health,p\_canonical\_user\_id text,p\_canonical\_user\_id text,jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.check\_balance\_health(p\_canonical\_user\_id text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_canonical\_balance NUMERIC;  
  v\_sub\_account\_balance NUMERIC;  
  v\_ledger\_balance NUMERIC;  
  v\_difference NUMERIC;  
  v\_status TEXT;  
BEGIN  
  SELECT usdc\_balance INTO v\_canonical\_balance  
  FROM public.canonical\_users  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id;

  SELECT available\_balance INTO v\_sub\_account\_balance  
  FROM public.sub\_account\_balances  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id AND (currency IS NULL OR currency \= 'USD' OR currency \= 'USDC');

  SELECT   
    COALESCE(SUM(CASE   
      WHEN transaction\_type IN ('deposit', 'bonus', 'credit') THEN amount  
      WHEN transaction\_type IN ('purchase', 'debit', 'withdrawal') THEN \-amount  
      ELSE 0  
    END), 0\) INTO v\_ledger\_balance  
  FROM public.balance\_ledger  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id;

  v\_difference := ABS(COALESCE(v\_canonical\_balance, 0\) \- COALESCE(v\_sub\_account\_balance, 0));

  IF v\_difference \< 0.01 THEN  
    v\_status := 'healthy';  
  ELSIF v\_difference \< 1.00 THEN  
    v\_status := 'minor\_discrepancy';  
  ELSE  
    v\_status := 'major\_discrepancy';  
  END IF;

  RETURN jsonb\_build\_object(  
    'status', v\_status,  
    'canonical\_balance', COALESCE(v\_canonical\_balance, 0),  
    'sub\_account\_balance', COALESCE(v\_sub\_account\_balance, 0),  
    'ledger\_calculated\_balance', COALESCE(v\_ledger\_balance, 0),  
    'difference', v\_difference,  
    'needs\_sync', v\_difference \>= 0.01  
  );  
END;  
$function$  
"  
public,check\_database\_health,,,json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.check\_database\_health()  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  result json;  
BEGIN  
  SELECT json\_build\_object(  
    'competitions\_count', (SELECT COUNT(\*) FROM competitions),  
    'active\_competitions', (SELECT COUNT(\*) FROM competitions WHERE status \= 'active'),  
    'total\_tickets\_sold', (SELECT COALESCE(SUM(tickets\_sold), 0\) FROM competitions),  
    'database\_healthy', true,  
    'timestamp', NOW()  
  ) INTO result;  
    
  RETURN result;  
END;  
$function$  
"  
public,check\_external\_usdc\_balance,wallet\_address text,wallet\_address text,numeric,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION public.check\_external\_usdc\_balance(wallet\_address text)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$ BEGIN RETURN 0; END; $function$  
"  
public,check\_first\_deposit\_bonus\_eligibility,p\_canonical\_user\_id text,p\_canonical\_user\_id text,jsonb,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION public.check\_first\_deposit\_bonus\_eligibility(p\_canonical\_user\_id text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user RECORD;  
BEGIN  
  SELECT c.\* INTO v\_user  
  FROM canonical\_users c  
  WHERE c.canonical\_user\_id \= p\_canonical\_user\_id  
     OR (is\_uuid(p\_canonical\_user\_id) AND c.id \= p\_canonical\_user\_id::uuid)  
  LIMIT 1;

  IF v\_user IS NULL THEN  
    RETURN jsonb\_build\_object('eligible', false, 'reason', 'User not found');  
  END IF;

  IF COALESCE(v\_user.has\_used\_new\_user\_bonus, false) THEN  
    RETURN jsonb\_build\_object('eligible', false, 'reason', 'Bonus already used', 'has\_used\_bonus', true);  
  END IF;

  RETURN jsonb\_build\_object('eligible', true, 'bonus\_percentage', 50, 'has\_used\_bonus', false, 'message', 'User is eligible for 50% first deposit bonus');  
END;$function$  
"  
public,check\_ticket\_availability,"p\_competition\_id uuid, p\_ticket\_numbers integer\[\]","p\_competition\_id uuid, p\_ticket\_numbers integer\[\]",record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.check\_ticket\_availability(p\_competition\_id uuid, p\_ticket\_numbers integer\[\])  
 RETURNS TABLE(ticket\_number integer, available boolean)  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  RETURN QUERY  
  WITH ticket\_range AS (  
    SELECT generate\_series(1, (SELECT total\_tickets FROM competitions WHERE id \= p\_competition\_id)) AS available\_ticket  
  ),  
  reserved\_tickets AS (  
    SELECT ticket\_number  
    FROM ticket\_reservations  
    WHERE competition\_id \= p\_competition\_id  
      AND reservation\_expires\_at \> NOW()  
  ),  
  sold\_tickets AS (  
    SELECT ticket\_number  
    FROM tickets  
    WHERE competition\_id \= p\_competition\_id  
      AND is\_cancelled IS NOT TRUE  
  )  
  SELECT   
    t.ticket\_number,  
    (t.ticket\_number NOT IN (SELECT ticket\_number FROM reserved\_tickets)   
     AND t.ticket\_number NOT IN (SELECT ticket\_number FROM sold\_tickets)) AS available  
  FROM unnest(p\_ticket\_numbers) AS t(ticket\_number);  
END;  
$function$  
"  
public,claim\_prize,"p\_competition\_id uuid, p\_user\_wallet\_address text","p\_competition\_id uuid, p\_user\_wallet\_address text",bool,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.claim\_prize(p\_competition\_id uuid, p\_user\_wallet\_address text)  
 RETURNS boolean  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
    user\_id UUID;  
    winner\_record RECORD;  
BEGIN  
    \-- Get user ID  
    SELECT id INTO user\_id   
    FROM public.users   
    WHERE wallet\_address \= p\_user\_wallet\_address;  
      
    IF user\_id IS NULL THEN  
        RAISE EXCEPTION 'User not found';  
    END IF;  
      
    \-- Get winner record  
    SELECT \* INTO winner\_record  
    FROM public.winners  
    WHERE competition\_id \= p\_competition\_id   
    AND user\_id \= user\_id   
    AND claimed \= FALSE;  
      
    IF NOT FOUND THEN  
        RAISE EXCEPTION 'No unclaimed prize found for this user';  
    END IF;  
      
    \-- Mark as claimed (blockchain tx will be updated separately)  
    UPDATE public.winners   
    SET claimed \= TRUE,  
        claimed\_at \= NOW()  
    WHERE id \= winner\_record.id;  
      
    RETURN TRUE;  
END;  
$function$  
"  
public,cleanup\_expired\_holds,p\_competition\_id uuid,p\_competition\_id uuid,void,sql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.cleanup\_expired\_holds(p\_competition\_id uuid)  
 RETURNS void  
 LANGUAGE sql  
 SECURITY DEFINER  
AS $function$  
  update pending\_tickets  
  set status \= 'expired', updated\_at \= now()  
  where competition\_id \= p\_competition\_id  
    and status in ('pending','confirming')  
    and coalesce(expires\_at, now()) \< now();  
$function$  
"  
public,cleanup\_expired\_idempotency,,,int4,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.cleanup\_expired\_idempotency()  
 RETURNS integer  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_deleted INTEGER;  
BEGIN  
  DELETE FROM payment\_idempotency  
  WHERE expires\_at \< NOW();

  GET DIAGNOSTICS v\_deleted \= ROW\_COUNT;

  RETURN v\_deleted;  
END;  
$function$  
"  
public,cleanup\_expired\_pending\_tickets,,,int4,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.cleanup\_expired\_pending\_tickets()  
 RETURNS integer  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE v\_count INT;  
BEGIN  
  UPDATE pending\_tickets SET status \= 'expired' WHERE status \= 'pending' AND expires\_at \< NOW();  
  GET DIAGNOSTICS v\_count \= ROW\_COUNT;  
  RETURN v\_count;  
END;  
$function$  
"  
public,cleanup\_expired\_reservations,,,int4,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.cleanup\_expired\_reservations()  
 RETURNS integer  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  deleted\_count INTEGER;  
BEGIN  
  DELETE FROM ticket\_reservations   
  WHERE reservation\_expires\_at \< NOW();  
    
  GET DIAGNOSTICS deleted\_count \= ROW\_COUNT;  
  RETURN deleted\_count;  
END;  
$function$  
"  
public,cleanup\_old\_data,,,void,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.cleanup\_old\_data()  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$ BEGIN  
  DELETE FROM payment\_webhook\_events WHERE COALESCE(received\_at, created\_at) \< NOW() \- INTERVAL '30 days';  
  DELETE FROM privy\_webhook\_events WHERE received\_at \< NOW() \- INTERVAL '30 days'; END; $function$  
"  
public,cleanup\_orphaned\_pending\_tickets,,,int4,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.cleanup\_orphaned\_pending\_tickets()  
 RETURNS integer  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  deleted\_count INTEGER := 0;  
  v\_rows INTEGER := 0;  
BEGIN  
  \-- Delete items for tickets with missing user/canonical id  
  WITH del\_items AS (  
    DELETE FROM public.pending\_ticket\_items  
    WHERE pending\_ticket\_id IN (  
      SELECT pt.id  
      FROM public.pending\_tickets pt  
      LEFT JOIN public.canonical\_users cu ON pt.canonical\_user\_id \= cu.canonical\_user\_id  
      WHERE cu.canonical\_user\_id IS NULL  
         OR pt.canonical\_user\_id IS NULL  
         OR pt.user\_id IS NULL  
    ) RETURNING 1  
  ) SELECT COUNT(\*) INTO v\_rows FROM del\_items;   
  deleted\_count := deleted\_count \+ COALESCE(v\_rows,0);

  \-- Delete tickets with missing user/canonical id  
  WITH del\_t AS (  
    DELETE FROM public.pending\_tickets  
    WHERE id IN (  
      SELECT pt.id  
      FROM public.pending\_tickets pt  
      LEFT JOIN public.canonical\_users cu ON pt.canonical\_user\_id \= cu.canonical\_user\_id  
      WHERE cu.canonical\_user\_id IS NULL  
         OR pt.canonical\_user\_id IS NULL  
         OR pt.user\_id IS NULL  
    ) RETURNING 1  
  ) SELECT COUNT(\*) INTO v\_rows FROM del\_t;   
  deleted\_count := deleted\_count \+ COALESCE(v\_rows,0);

  \-- Delete items for tickets with missing competition  
  WITH del\_items2 AS (  
    DELETE FROM public.pending\_ticket\_items  
    WHERE pending\_ticket\_id IN (  
      SELECT pt.id  
      FROM public.pending\_tickets pt  
      LEFT JOIN public.competitions c ON pt.competition\_id \= c.id  
      WHERE c.id IS NULL  
    ) RETURNING 1  
  ) SELECT COUNT(\*) INTO v\_rows FROM del\_items2;   
  deleted\_count := deleted\_count \+ COALESCE(v\_rows,0);

  \-- Delete tickets with missing competition  
  WITH del\_t2 AS (  
    DELETE FROM public.pending\_tickets pt  
    USING public.pending\_tickets pt2  
    LEFT JOIN public.competitions c ON pt2.competition\_id \= c.id  
    WHERE pt.id \= pt2.id AND c.id IS NULL  
    RETURNING 1  
  ) SELECT COUNT(\*) INTO v\_rows FROM del\_t2;   
  deleted\_count := deleted\_count \+ COALESCE(v\_rows,0);

  RETURN deleted\_count;  
END;  
$function$  
"  
public,cleanup\_stale\_transactions,,,void,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.cleanup\_stale\_transactions()  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$ BEGIN  
  UPDATE user\_transactions SET status='failed' WHERE status='pending' AND created\_at \< NOW() \- INTERVAL '24 hours'; END; $function$  
"  
public,competitions\_sync\_num\_winners,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.competitions\_sync\_num\_winners()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  \-- Before insert/update, if only one is provided, copy to the other  
  IF TG\_OP IN ('INSERT','UPDATE') THEN  
    IF NEW.num\_winners IS NULL AND NEW.winner\_count IS NOT NULL THEN  
      NEW.num\_winners := NEW.winner\_count;  
    ELSIF NEW.winner\_count IS NULL AND NEW.num\_winners IS NOT NULL THEN  
      NEW.winner\_count := NEW.num\_winners;  
    END IF;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,competitions\_sync\_tickets\_sold,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.competitions\_sync\_tickets\_sold()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF TG\_OP IN ('INSERT','UPDATE') THEN  
    IF NEW.tickets\_sold IS NULL AND NEW.sold\_tickets IS NOT NULL THEN  
      NEW.tickets\_sold := NEW.sold\_tickets;  
    ELSIF NEW.sold\_tickets IS NULL AND NEW.tickets\_sold IS NOT NULL THEN  
      NEW.sold\_tickets := NEW.tickets\_sold;  
    END IF;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,complete\_topup\_on\_webhook\_ref,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.complete\_topup\_on\_webhook\_ref()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  \-- Only for coinbase topups  
  IF (COALESCE(NEW.provider,'') \= 'coinbase' AND COALESCE(NEW.type,'') \= 'topup') THEN  
    \-- If webhook\_ref is present and status is not already completed, flip to completed  
    IF COALESCE(NEW.webhook\_ref, '') \<\> '' AND NEW.status \<\> 'completed' THEN  
      NEW.status := 'completed';  
      NEW.completed\_at := COALESCE(NEW.completed\_at, NOW());  
    END IF;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,confirm\_payment\_and\_issue\_tickets,"p\_order\_id uuid, p\_payment\_tx\_hash text, p\_amount numeric, p\_currency text","p\_order\_id uuid, p\_payment\_tx\_hash text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text",record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.confirm\_payment\_and\_issue\_tickets(p\_order\_id uuid, p\_payment\_tx\_hash text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text)  
 RETURNS TABLE(ticket\_id uuid, ticket\_number integer)  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_comp uuid;  
  v\_wallet text;  
  v\_cnt int;  
BEGIN  
  \-- Validate order pending and amount  
  SELECT competition\_id, user\_id, ticket\_count INTO v\_comp, v\_wallet, v\_cnt  
  FROM public.orders WHERE id \= p\_order\_id AND status \= 'pending';  
  IF NOT FOUND THEN RAISE EXCEPTION 'order\_not\_pending\_or\_missing'; END IF;

  UPDATE public.orders  
  SET status \= 'completed', payment\_status \= 'paid', payment\_tx\_hash \= p\_payment\_tx\_hash, completed\_at \= now(), amount \= p\_amount, currency \= p\_currency  
  WHERE id \= p\_order\_id;

  \-- Issue tickets to final table and mark them as sold  
  RETURN QUERY WITH chosen AS (  
    SELECT pti.ticket\_number  
    FROM public.order\_tickets ot  
    JOIN public.pending\_tickets pt ON pt.id \= (SELECT pending\_ticket\_id FROM public.tickets WHERE order\_id \= p\_order\_id LIMIT 1\) \-- fallback if used  
    RIGHT JOIN public.pending\_ticket\_items pti ON pti.pending\_ticket\_id \= pt.id  
    WHERE ot.order\_id \= p\_order\_id  
  )  
  INSERT INTO public.tickets(competition\_id, ticket\_number, status, purchased\_by, purchased\_at, order\_id, wallet\_address, purchase\_price, payment\_tx\_hash, purchase\_date)  
  SELECT v\_comp, ot.ticket\_number, 'sold', NULL, now(), p\_order\_id, v\_wallet, p\_amount / v\_cnt, p\_payment\_tx\_hash, now()  
  FROM public.order\_tickets ot  
  ON CONFLICT (competition\_id, ticket\_number) DO UPDATE  
    SET status='sold', order\_id \= EXCLUDED.order\_id, purchased\_at \= now(), wallet\_address \= EXCLUDED.wallet\_address, purchase\_price \= EXCLUDED.purchase\_price, payment\_tx\_hash \= EXCLUDED.payment\_tx\_hash  
  RETURNING id, ticket\_number;

  \-- Cleanup reservation items for this order  
  DELETE FROM public.pending\_ticket\_items USING public.pending\_tickets pt  
  WHERE pending\_ticket\_items.pending\_ticket\_id \= pt.id AND pt.user\_id \= v\_wallet AND pt.competition\_id \= v\_comp;

  UPDATE public.pending\_tickets SET status='confirmed', confirmed\_at \= now()  
  WHERE user\_id \= v\_wallet AND competition\_id \= v\_comp AND status='pending';

  \-- Ledger entry  
  INSERT INTO public.user\_transactions (user\_id, wallet\_address, type, amount, currency, competition\_id, order\_id, description)  
  VALUES (v\_wallet, v\_wallet, 'purchase', p\_amount, p\_currency, v\_comp, p\_order\_id, 'Ticket purchase completed');  
END; $function$  
"  
public,confirm\_pending\_tickets,"p\_reservation\_id uuid, p\_order\_id uuid, p\_tx\_hash text","p\_reservation\_id uuid, p\_order\_id uuid, p\_tx\_hash text",bool,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.confirm\_pending\_tickets(p\_reservation\_id uuid, p\_order\_id uuid, p\_tx\_hash text)  
 RETURNS boolean  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE v\_pending RECORD; v\_ticket\_num INT;  
BEGIN  
  SELECT \* INTO v\_pending FROM pending\_tickets WHERE id \= p\_reservation\_id AND status \= 'pending';  
  IF NOT FOUND THEN RETURN FALSE; END IF;  
    
  FOREACH v\_ticket\_num IN ARRAY v\_pending.ticket\_numbers LOOP  
    INSERT INTO tickets (competition\_id, wallet\_address, privy\_user\_id, ticket\_number, purchase\_price, payment\_tx\_hash, order\_id)  
    VALUES (v\_pending.competition\_id, v\_pending.wallet\_address, v\_pending.privy\_user\_id, v\_ticket\_num, v\_pending.total\_price / v\_pending.ticket\_count, p\_tx\_hash, p\_order\_id);  
  END LOOP;  
    
  UPDATE competitions SET tickets\_sold \= tickets\_sold \+ v\_pending.ticket\_count, updated\_at \= NOW() WHERE id \= v\_pending.competition\_id;  
  UPDATE pending\_tickets SET status \= 'confirmed' WHERE id \= p\_reservation\_id;  
  RETURN TRUE;  
END;  
$function$  
"  
public,confirm\_pending\_tickets\_with\_balance,"p\_reservation\_id uuid, p\_canonical\_user\_id text","p\_reservation\_id uuid, p\_canonical\_user\_id text",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.confirm\_pending\_tickets\_with\_balance(p\_reservation\_id uuid, p\_canonical\_user\_id text)  
 RETURNS TABLE(inserted\_ticket\_ids uuid\[\], ticket\_numbers integer\[\], total\_cost numeric, new\_available\_balance numeric, entry\_id uuid)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  v\_res pending\_tickets%rowtype;  
  v\_items\_count int;  
  v\_ticket\_numbers int\[\];  
  v\_competition\_id uuid;  
  v\_ticket\_price numeric;  
  v\_total\_cost numeric;  
  v\_bal sub\_account\_balances%rowtype;  
  v\_balance\_before numeric;  
  v\_balance\_after numeric;  
  v\_tx\_id text;  
  v\_inserted\_ids uuid\[\];  
  v\_entry\_id uuid;  
  v\_now timestamptz := now();  
begin  
  \-- Validate canonical\_user\_id shape (lowercase)  
  if p\_canonical\_user\_id is null or p\_canonical\_user\_id \!\~ '^prize:pid:0x\[a-f0-9\]{40}$' then  
    raise exception 'Invalid canonical\_user\_id format';  
  end if;

  \-- 1\) Lock reservation  
  select \*  
  into v\_res  
  from pending\_tickets  
  where id \= p\_reservation\_id  
  for update;

  if not found then  
    raise exception 'Reservation % not found', p\_reservation\_id;  
  end if;

  if v\_res.status \<\> 'pending' then  
    raise exception 'Reservation % is not pending (status=%)', p\_reservation\_id, v\_res.status;  
  end if;

  if v\_res.expires\_at \<= v\_now then  
    raise exception 'Reservation % has expired at %', p\_reservation\_id, v\_res.expires\_at;  
  end if;

  \-- Ensure ownership if set  
  if v\_res.canonical\_user\_id is not null and v\_res.canonical\_user\_id \<\> p\_canonical\_user\_id then  
    raise exception 'Reservation % does not belong to user %', p\_reservation\_id, p\_canonical\_user\_id;  
  end if;

  v\_competition\_id := v\_res.competition\_id;

  \-- 2\) Lock items and gather ticket numbers  
  select array\_agg(i.ticket\_number order by i.ticket\_number), count(\*)  
  into v\_ticket\_numbers, v\_items\_count  
  from pending\_ticket\_items i  
  where i.pending\_ticket\_id \= p\_reservation\_id  
  for update;

  if coalesce(v\_items\_count, 0\) \= 0 then  
    if v\_res.ticket\_numbers is not null and array\_length(v\_res.ticket\_numbers,1) \> 0 then  
      v\_ticket\_numbers := v\_res.ticket\_numbers;  
      v\_items\_count := array\_length(v\_res.ticket\_numbers,1);  
    else  
      raise exception 'Reservation % has no pending ticket items or ticket\_numbers', p\_reservation\_id;  
    end if;  
  end if;

  \-- 3\) Price and total  
  v\_ticket\_price := coalesce(  
    v\_res.ticket\_price,  
    (select c.ticket\_price from competitions c where c.id \= v\_competition\_id)  
  );  
  if v\_ticket\_price is null then  
    raise exception 'Ticket price not resolvable for competition %', v\_competition\_id;  
  end if;

  v\_total\_cost := v\_ticket\_price \* v\_items\_count;

  \-- 4\) Lock and verify balance  
  select \*  
  into v\_bal  
  from sub\_account\_balances  
  where canonical\_user\_id \= p\_canonical\_user\_id  
    and currency \= 'USD'  
  for update;

  if not found then  
    raise exception 'No sub\_account\_balances row for % (USD)', p\_canonical\_user\_id;  
  end if;

  v\_balance\_before := v\_bal.available\_balance;

  if v\_balance\_before \< v\_total\_cost then  
    raise exception 'Insufficient balance: have %, need %', v\_balance\_before, v\_total\_cost;  
  end if;

  v\_balance\_after := v\_balance\_before \- v\_total\_cost;

  \-- 5\) Deduct balance immediately  
  update sub\_account\_balances  
  set available\_balance \= v\_balance\_after,  
      last\_updated \= v\_now  
  where id \= v\_bal.id;

  \-- 6\) Write balance ledger  
  insert into balance\_ledger (  
    canonical\_user\_id, transaction\_type, amount, currency,  
    balance\_before, balance\_after, reference\_id, description, created\_at  
  )  
  values (  
    p\_canonical\_user\_id, 'debit', v\_total\_cost, 'USD',  
    v\_balance\_before, v\_balance\_after, p\_reservation\_id::text, 'Ticket purchase (balance confirmation)', v\_now  
  );

  \-- 7\) Insert tickets with deterministic tx\_id  
  v\_tx\_id := 'balance:' || p\_reservation\_id::text;

  with ins as (  
    insert into tickets (  
      competition\_id,  
      ticket\_number,  
      status,  
      canonical\_user\_id,  
      wallet\_address,  
      purchase\_price,  
      payment\_provider,  
      payment\_amount,  
      purchased\_at,  
      purchase\_date,  
      pending\_ticket\_id,  
      tx\_id  
    )  
    select  
      v\_competition\_id,  
      tnum,  
      'sold',  
      p\_canonical\_user\_id,  
      v\_res.wallet\_address,  
      v\_ticket\_price,  
      'balance',  
      v\_ticket\_price,  
      v\_now,  
      v\_now,  
      p\_reservation\_id,  
      v\_tx\_id  
    from unnest(v\_ticket\_numbers) as tnum  
    returning id  
  )  
  select array\_agg(id) into v\_inserted\_ids from ins;

  if v\_inserted\_ids is null or array\_length(v\_inserted\_ids,1) \<\> v\_items\_count then  
    raise exception 'Inserted tickets mismatch: expected %, got %', v\_items\_count, coalesce(array\_length(v\_inserted\_ids,1),0);  
  end if;

  \-- 8\) Write tickets\_sold for each ticket  
  insert into tickets\_sold (competition\_id, ticket\_number, purchaser\_id, sold\_at)  
  select v\_competition\_id, tnum, p\_canonical\_user\_id, v\_now  
  from unnest(v\_ticket\_numbers) as tnum;

  \-- 9\) Upsert competition\_entries (no VRF fields)  
  with data as (  
    select  
      v\_competition\_id as competition\_id,  
      p\_canonical\_user\_id as canonical\_user\_id,  
      v\_items\_count as add\_count,  
      v\_total\_cost as add\_amount,  
      array\_to\_string(v\_ticket\_numbers, ',') as add\_csv,  
      v\_now as ts,  
      v\_res.wallet\_address as wallet\_address  
  )  
  insert into competition\_entries (  
    id,  
    canonical\_user\_id,  
    competition\_id,  
    wallet\_address,  
    tickets\_count,  
    ticket\_numbers\_csv,  
    amount\_spent,  
    payment\_methods,  
    latest\_purchase\_at,  
    created\_at,  
    updated\_at  
  )  
  select  
    gen\_random\_uuid(),  
    d.canonical\_user\_id,  
    d.competition\_id,  
    d.wallet\_address,  
    d.add\_count,  
    d.add\_csv,  
    d.add\_amount,  
    'balance',  
    d.ts,  
    d.ts,  
    d.ts  
  from data d  
  on conflict (competition\_id, canonical\_user\_id)  
  do update  
  set tickets\_count \= competition\_entries.tickets\_count \+ excluded.tickets\_count,  
      amount\_spent \= coalesce(competition\_entries.amount\_spent, 0\) \+ excluded.amount\_spent,  
      latest\_purchase\_at \= excluded.latest\_purchase\_at,  
      updated\_at \= excluded.updated\_at,  
      payment\_methods \= case  
        when competition\_entries.payment\_methods is null or position('balance' in competition\_entries.payment\_methods) \= 0  
          then coalesce(competition\_entries.payment\_methods || ',balance', 'balance')  
        else competition\_entries.payment\_methods  
      end,  
      ticket\_numbers\_csv \= case  
        when competition\_entries.ticket\_numbers\_csv is null or length(competition\_entries.ticket\_numbers\_csv) \= 0  
          then excluded.ticket\_numbers\_csv  
        else competition\_entries.ticket\_numbers\_csv || ',' || excluded.ticket\_numbers\_csv  
      end  
  returning competition\_entries.id into v\_entry\_id;

  \-- 10\) Mark reservation confirmed  
  update pending\_tickets  
  set status \= 'confirmed',  
      confirmed\_at \= v\_now,  
      updated\_at \= v\_now,  
      total\_amount \= v\_total\_cost  
  where id \= p\_reservation\_id;

  \-- 11\) Return  
  inserted\_ticket\_ids := v\_inserted\_ids;  
  ticket\_numbers := v\_ticket\_numbers;  
  total\_cost := v\_total\_cost;  
  new\_available\_balance := v\_balance\_after;  
  entry\_id := v\_entry\_id;  
  return next;  
end;  
$function$  
"  
public,confirm\_pending\_to\_sold,p\_competition\_id text,p\_competition\_id text,void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.confirm\_pending\_to\_sold(p\_competition\_id text)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_competition\_uuid uuid;  
BEGIN  
  BEGIN  
    v\_competition\_uuid := p\_competition\_id::uuid;  
  EXCEPTION WHEN others THEN  
    RAISE EXCEPTION 'Invalid competition id format. Expected uuid, got: %', p\_competition\_id USING ERRCODE \= '22P02';  
  END;

  \-- Example update hardened to uuid on tickets and text on joincompetition  
  UPDATE public.tickets t  
     SET status \= 'sold'  
   WHERE t.competition\_id \= v\_competition\_uuid  
     AND t.status \= 'pending';

  \-- Any linkage with joincompetition must use text compare on jc.competitionid  
  PERFORM 1 FROM public.joincompetition jc  
   WHERE jc.competitionid \= v\_competition\_uuid::text  
   LIMIT 1;  
END;  
$function$  
"  
public,confirm\_pending\_to\_sold,"p\_reservation\_id uuid, p\_transaction\_hash text, p\_payment\_provider text, p\_wallet\_address text","p\_reservation\_id uuid, p\_transaction\_hash text DEFAULT NULL::text, p\_payment\_provider text DEFAULT 'balance'::text, p\_wallet\_address text DEFAULT NULL::text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.confirm\_pending\_to\_sold(p\_reservation\_id uuid, p\_transaction\_hash text DEFAULT NULL::text, p\_payment\_provider text DEFAULT 'balance'::text, p\_wallet\_address text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_reservation RECORD;  
  v\_ticket\_num INTEGER;  
  v\_tickets\_inserted INTEGER := 0;  
  v\_join\_uid UUID;  
BEGIN  
  \-- Lock and fetch reservation  
  SELECT \* INTO v\_reservation  
  FROM pending\_tickets  
  WHERE id \= p\_reservation\_id  
  FOR UPDATE NOWAIT;

  IF v\_reservation IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Reservation not found');  
  END IF;

  IF v\_reservation.status \= 'confirmed' THEN  
    RETURN jsonb\_build\_object('success', true, 'already\_confirmed', true);  
  END IF;

  IF v\_reservation.status NOT IN ('pending', 'confirming') THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Invalid reservation status: ' || v\_reservation.status);  
  END IF;

  IF v\_reservation.expires\_at \< NOW() THEN  
    UPDATE pending\_tickets SET status \= 'expired', updated\_at \= NOW() WHERE id \= p\_reservation\_id;  
    RETURN jsonb\_build\_object('success', false, 'error', 'Reservation expired', 'expired\_at', v\_reservation.expires\_at);  
  END IF;

  \-- Mark as confirming  
  UPDATE pending\_tickets SET status \= 'confirming', updated\_at \= NOW() WHERE id \= p\_reservation\_id;

  \-- Insert tickets using privy\_user\_id column (TEXT)  
  IF v\_reservation.ticket\_numbers IS NOT NULL THEN  
    FOREACH v\_ticket\_num IN ARRAY v\_reservation.ticket\_numbers  
    LOOP  
      BEGIN  
        INSERT INTO tickets (competition\_id, ticket\_number, privy\_user\_id, purchase\_price, payment\_tx\_hash, pending\_ticket\_id, created\_at)  
        VALUES (v\_reservation.competition\_id, v\_ticket\_num, v\_reservation.user\_id, v\_reservation.ticket\_price, p\_transaction\_hash, p\_reservation\_id, NOW());  
        v\_tickets\_inserted := v\_tickets\_inserted \+ 1;  
      EXCEPTION WHEN unique\_violation THEN NULL;  
      END;  
    END LOOP;  
  END IF;

  \-- Create joincompetition entry  
  v\_join\_uid := gen\_random\_uuid();  
  INSERT INTO joincompetition (uid, competitionid, userid, walletaddress, privy\_user\_id, numberoftickets, ticketnumbers, amountspent, chain, transactionhash, purchasedate, created\_at)  
  VALUES (  
    v\_join\_uid::TEXT,  
    v\_reservation.competition\_id::text,  
    v\_reservation.user\_id,  
    COALESCE(p\_wallet\_address, ''),  
    v\_reservation.user\_id,  
    COALESCE(array\_length(v\_reservation.ticket\_numbers, 1), 0),  
    array\_to\_string(COALESCE(v\_reservation.ticket\_numbers, ARRAY\[\]::INTEGER\[\]), ','),  
    COALESCE(v\_reservation.total\_amount, 0),  
    COALESCE(p\_payment\_provider, 'balance'),  
    COALESCE(p\_transaction\_hash, v\_reservation.id::text),  
    NOW(),  
    NOW()  
  );

  \-- Mark confirmed  
  UPDATE pending\_tickets SET status \= 'confirmed', confirmed\_at \= NOW(), updated\_at \= NOW() WHERE id \= p\_reservation\_id;

  RETURN jsonb\_build\_object('success', true, 'tickets\_inserted', v\_tickets\_inserted, 'ticket\_count', COALESCE(array\_length(v\_reservation.ticket\_numbers, 1), 0));  
EXCEPTION WHEN lock\_not\_available THEN  
  RETURN jsonb\_build\_object('success', false, 'error', 'Reservation locked by another process');  
END;  
$function$  
"  
public,confirm\_purchase\_by\_ref,"p\_provider text, p\_ref text, p\_amount numeric, p\_currency text, p\_event\_ts timestamp with time zone","p\_provider text, p\_ref text, p\_amount numeric, p\_currency text, p\_event\_ts timestamp with time zone",void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.confirm\_purchase\_by\_ref(p\_provider text, p\_ref text, p\_amount numeric, p\_currency text, p\_event\_ts timestamp with time zone)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_pending public.pending\_tickets%ROWTYPE;  
  v\_order\_id uuid;  
BEGIN  
  SELECT \* INTO v\_pending  
  FROM public.pending\_tickets  
  WHERE session\_id \= p\_ref OR reservation\_id::text \= p\_ref  
  ORDER BY created\_at DESC  
  LIMIT 1;

  IF NOT FOUND THEN  
    RAISE NOTICE 'No pending\_tickets for ref % from %', p\_ref, p\_provider;  
    RETURN;  
  END IF;

  INSERT INTO public.orders (id, payment\_session\_id, payment\_provider, status, payment\_status, completed\_at, amount, currency)  
  VALUES (gen\_random\_uuid(), p\_ref, p\_provider, 'completed', 'paid', COALESCE(p\_event\_ts, now()), p\_amount, p\_currency)  
  ON CONFLICT (payment\_session\_id) DO UPDATE  
    SET status \= 'completed',  
        payment\_status \= 'paid',  
        completed\_at \= EXCLUDED.completed\_at,  
        amount \= COALESCE(orders.amount, EXCLUDED.amount),  
        currency \= COALESCE(orders.currency, EXCLUDED.currency)  
  RETURNING id INTO v\_order\_id;

  UPDATE public.pending\_tickets  
  SET status \= 'confirmed',  
      confirmed\_at \= COALESCE(p\_event\_ts, now())  
  WHERE id \= v\_pending.id AND confirmed\_at IS NULL;  
END;  
$function$  
"  
public,confirm\_ticket\_purchase,"p\_pending\_ticket\_id uuid, p\_payment\_provider text","p\_pending\_ticket\_id uuid, p\_payment\_provider text DEFAULT 'balance'::text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.confirm\_ticket\_purchase(p\_pending\_ticket\_id uuid, p\_payment\_provider text DEFAULT 'balance'::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_pending RECORD;  
  v\_pending\_status TEXT;  
  v\_user\_balance RECORD;  
  v\_new\_balance NUMERIC;  
  v\_canonical\_user\_id TEXT;  
  v\_user\_uuid UUID;  
  v\_transaction\_hash TEXT;  
  v\_price\_per\_ticket NUMERIC;  
  v\_entry\_uid UUID;  
  v\_transaction\_id TEXT;  
BEGIN  
  \-- Get pending ticket with lock  
  SELECT \* INTO v\_pending   
  FROM pending\_tickets   
  WHERE id \= p\_pending\_ticket\_id   
  FOR UPDATE SKIP LOCKED;

  IF v\_pending IS NULL THEN  
    \-- Check if already confirmed  
    SELECT status INTO v\_pending\_status   
    FROM pending\_tickets   
    WHERE id \= p\_pending\_ticket\_id;  
      
    IF v\_pending\_status \= 'confirmed' THEN  
      RETURN jsonb\_build\_object(  
        'success', true,   
        'message', 'Already confirmed',   
        'already\_confirmed', true  
      );  
    END IF;  
      
    RETURN jsonb\_build\_object(  
      'success', false,   
      'error', 'Pending ticket not found or locked'  
    );  
  END IF;

  \-- Already confirmed check  
  IF v\_pending.status \= 'confirmed' THEN  
    RETURN jsonb\_build\_object(  
      'success', true,   
      'message', 'Already confirmed',   
      'already\_confirmed', true  
    );  
  END IF;

  \-- Must be pending status  
  IF v\_pending.status \!= 'pending' THEN  
    RETURN jsonb\_build\_object(  
      'success', false,   
      'error', 'Status is ' || v\_pending.status  
    );  
  END IF;

  \-- Check expiration  
  IF v\_pending.expires\_at \< NOW() THEN  
    UPDATE pending\_tickets   
    SET status \= 'expired', updated\_at \= NOW()   
    WHERE id \= p\_pending\_ticket\_id;  
      
    RETURN jsonb\_build\_object(  
      'success', false,   
      'error', 'Reservation expired'  
    );  
  END IF;

  v\_canonical\_user\_id := v\_pending.user\_id;

  \-- Get user balance with lock  
  SELECT \* INTO v\_user\_balance  
  FROM sub\_account\_balances  
  WHERE (  
    canonical\_user\_id \= v\_canonical\_user\_id   
    OR user\_id \= v\_canonical\_user\_id   
    OR privy\_user\_id \= v\_canonical\_user\_id  
  )  
  AND currency \= 'USD'  
  FOR UPDATE;

  IF v\_user\_balance IS NULL THEN  
    RETURN jsonb\_build\_object(  
      'success', false,   
      'error', 'User balance not found'  
    );  
  END IF;

  \-- Check sufficient balance  
  IF v\_user\_balance.available\_balance \< v\_pending.total\_amount THEN  
    RETURN jsonb\_build\_object(  
      'success', false,   
      'error', 'Insufficient balance'  
    );  
  END IF;

  \-- Calculate new balance  
  v\_new\_balance := v\_user\_balance.available\_balance \- v\_pending.total\_amount;  
  v\_transaction\_hash := 'BAL\_' || p\_pending\_ticket\_id::TEXT || '\_' || EXTRACT(EPOCH FROM NOW())::TEXT;  
  v\_price\_per\_ticket := v\_pending.total\_amount / GREATEST(v\_pending.ticket\_count, 1);  
  v\_entry\_uid := gen\_random\_uuid();  
  v\_transaction\_id := gen\_random\_uuid()::TEXT;

  \-- Update balance  
  UPDATE sub\_account\_balances   
  SET available\_balance \= v\_new\_balance, last\_updated \= NOW()   
  WHERE id \= v\_user\_balance.id;

  \-- Mark pending ticket as confirmed  
  UPDATE pending\_tickets  
  SET   
    status \= 'confirmed',   
    payment\_provider \= p\_payment\_provider,   
    transaction\_hash \= v\_transaction\_hash,   
    confirmed\_at \= NOW(),   
    updated\_at \= NOW()  
  WHERE id \= p\_pending\_ticket\_id;

  \-- Create tickets  
  INSERT INTO tickets (  
    id,   
    competition\_id,   
    ticket\_number,   
    status,   
    purchased\_at,   
    pending\_ticket\_id,   
    purchase\_price,   
    is\_active,   
    payment\_tx\_hash,   
    canonical\_user\_id,   
    created\_at  
  )  
  SELECT   
    gen\_random\_uuid(),   
    v\_pending.competition\_id,   
    unnest(v\_pending.ticket\_numbers),   
    'sold',   
    NOW(),   
    p\_pending\_ticket\_id,   
    v\_price\_per\_ticket,   
    true,   
    v\_transaction\_hash,   
    v\_canonical\_user\_id,   
    NOW();

  \-- Create joincompetition entry  
  INSERT INTO joincompetition (  
    uid,   
    competitionid,   
    userid,   
    numberoftickets,   
    ticketnumbers,   
    amountspent,   
    chain,   
    transactionhash,   
    purchasedate,   
    canonical\_user\_id  
  )  
  VALUES (  
    v\_entry\_uid::TEXT,   
    v\_pending.competition\_id,   
    v\_canonical\_user\_id,   
    v\_pending.ticket\_count,   
    array\_to\_string(v\_pending.ticket\_numbers, ','),   
    v\_pending.total\_amount,   
    p\_payment\_provider,   
    v\_transaction\_hash,   
    NOW(),   
    v\_canonical\_user\_id  
  );

  \-- CRITICAL: Create user\_transactions entry (needed for orders tab)  
  INSERT INTO user\_transactions (  
    id,  
    user\_id,  
    canonical\_user\_id,  
    type,  
    amount,  
    currency,  
    status,  
    competition\_id,  
    ticket\_count,  
    ticket\_numbers,  
    transaction\_hash,  
    payment\_method,  
    payment\_provider,  
    payment\_status,  
    created\_at,  
    updated\_at  
  )  
  VALUES (  
    v\_transaction\_id,  
    v\_canonical\_user\_id,  
    v\_canonical\_user\_id,  
    'purchase',  
    v\_pending.total\_amount,  
    'USD',  
    'completed',  
    v\_pending.competition\_id,  
    v\_pending.ticket\_count,  
    array\_to\_string(v\_pending.ticket\_numbers, ','),  
    v\_transaction\_hash,  
    p\_payment\_provider,  
    p\_payment\_provider,  
    'completed',  
    NOW(),  
    NOW()  
  );

  \-- Update canonical\_users balance and create ledger entry  
  SELECT id INTO v\_user\_uuid   
  FROM canonical\_users   
  WHERE canonical\_user\_id \= v\_canonical\_user\_id   
  LIMIT 1;  
    
  IF v\_user\_uuid IS NOT NULL THEN  
    UPDATE canonical\_users   
    SET usdc\_balance \= v\_new\_balance   
    WHERE id \= v\_user\_uuid;  
      
    INSERT INTO balance\_ledger (  
      user\_id,   
      balance\_type,   
      source,   
      amount,   
      metadata,   
      created\_at  
    )  
    VALUES (  
      v\_user\_uuid,   
      'real',   
      'ticket\_purchase',   
      \-v\_pending.total\_amount,  
      jsonb\_build\_object(  
        'pending\_ticket\_id', p\_pending\_ticket\_id,   
        'competition\_id', v\_pending.competition\_id,   
        'ticket\_count', v\_pending.ticket\_count,   
        'ticket\_numbers', v\_pending.ticket\_numbers,  
        'transaction\_id', v\_transaction\_id  
      ),   
      NOW()  
    );  
  END IF;

  RETURN jsonb\_build\_object(  
    'success', true,   
    'pending\_ticket\_id', p\_pending\_ticket\_id,   
    'transaction\_id', v\_transaction\_id,  
    'amount\_debited', v\_pending.total\_amount,   
    'new\_balance', v\_new\_balance,   
    'ticket\_count', v\_pending.ticket\_count,   
    'tickets\_created', array\_length(v\_pending.ticket\_numbers, 1),   
    'joincompetition\_uid', v\_entry\_uid  
  );  
END;  
$function$  
"  
public,confirm\_tickets,"p\_reservation\_id uuid, p\_payment\_id text, p\_provider text, p\_amount numeric","p\_reservation\_id uuid, p\_payment\_id text, p\_provider text, p\_amount numeric",json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.confirm\_tickets(p\_reservation\_id uuid, p\_payment\_id text, p\_provider text, p\_amount numeric)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  r record;  
begin  
  \-- lock & validate reservation  
  select \*  
    into r  
  from pending\_tickets  
  where id \= p\_reservation\_id  
    and status in ('pending','confirming')  
  for update;

  if not found then  
    return json\_build\_object('success', false, 'error', 'Reservation not found or finalized');  
  end if;

  if r.expires\_at is not null and r.expires\_at \< now() then  
    return json\_build\_object('success', false, 'error', 'Reservation expired');  
  end if;

  if p\_amount is null or p\_amount \< r.total\_amount then  
    return json\_build\_object('success', false, 'error', 'Insufficient amount', 'required', r.total\_amount, 'received', p\_amount);  
  end if;

  \-- move to confirming to signal in-flight commit  
  update pending\_tickets  
    set status \= 'confirming', updated\_at \= now()  
  where id \= r.id;

  begin  
    \-- 1\) enforce per-ticket uniqueness  
    insert into tickets\_sold (competition\_id, ticket\_number, purchaser\_id)  
    select r.competition\_id, unnest(r.ticket\_numbers), r.user\_id;

    \-- 2\) insert canonical purchase record  
    insert into joincompetition (  
      competitionid, ticketnumbers, canonical\_id, amount\_paid, payment\_id, payment\_provider, created\_at  
    ) values (  
      r.competition\_id,  
      array\_to\_string(r.ticket\_numbers, ','),  
      r.user\_id,  
      p\_amount,  
      p\_payment\_id,  
      p\_provider,  
      now()  
    );

    \-- 3\) finalize reservation  
    update pending\_tickets  
      set status \= 'confirmed',  
          payment\_id \= p\_payment\_id,  
          payment\_provider \= p\_provider,  
          updated\_at \= now()  
    where id \= r.id;

    return json\_build\_object('success', true, 'ticket\_numbers', r.ticket\_numbers);  
  exception when unique\_violation then  
    \-- tickets were taken in parallel (extremely rare)  
    update pending\_tickets  
      set status \= 'pending', updated\_at \= now()  
    where id \= r.id;

    return json\_build\_object('success', false, 'error', 'Tickets no longer available');  
  end;  
end;  
$function$  
"  
public,convert\_specific\_deposit,"tx\_id\_param text, usd\_value\_param numeric, wallet\_addr\_param text","tx\_id\_param text, usd\_value\_param numeric, wallet\_addr\_param text",text,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION public.convert\_specific\_deposit(tx\_id\_param text, usd\_value\_param numeric, wallet\_addr\_param text)  
 RETURNS text  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$ DECLARE v\_result TEXT:='failed'; BEGIN v\_result:='converted'; RETURN v\_result; END; $function$  
"  
public,count\_sold\_tickets\_for\_competition,p\_competition\_id uuid,p\_competition\_id uuid,int4,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.count\_sold\_tickets\_for\_competition(p\_competition\_id uuid)  
 RETURNS integer  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT COALESCE(  
    (  
      SELECT COUNT(\*)::int  
      FROM public.tickets t  
      WHERE t.competition\_id \= p\_competition\_id  
        AND (  
          t.status IN ('reserved','purchased')  
          OR t.purchased\_at IS NOT NULL  
        )  
    ), 0  
  );  
$function$  
"  
public,create\_entry\_charge,"p\_canonical\_user\_id text, p\_competition\_id uuid, p\_entry\_price numeric, p\_entry\_count integer, p\_payment\_method text, p\_tx\_ref text, p\_metadata jsonb","p\_canonical\_user\_id text, p\_competition\_id uuid, p\_entry\_price numeric, p\_entry\_count integer, p\_payment\_method text, p\_tx\_ref text DEFAULT NULL::text, p\_metadata jsonb DEFAULT '{}'::jsonb",uuid,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.create\_entry\_charge(p\_canonical\_user\_id text, p\_competition\_id uuid, p\_entry\_price numeric, p\_entry\_count integer, p\_payment\_method text, p\_tx\_ref text DEFAULT NULL::text, p\_metadata jsonb DEFAULT '{}'::jsonb)  
 RETURNS uuid  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_total numeric := p\_entry\_price \* p\_entry\_count;  
  v\_order\_id uuid := gen\_random\_uuid();  
  v\_ok boolean;  
BEGIN  
  \-- Optional: validate competition exists  
  PERFORM 1 FROM public.competitions WHERE id \= p\_competition\_id;  
  IF NOT FOUND THEN RAISE EXCEPTION 'Competition % not found', p\_competition\_id; END IF;

  IF p\_payment\_method \= 'balance' THEN  
    v\_ok := public.debit\_user\_balance(p\_canonical\_user\_id, v\_total, 'USD');  
    IF NOT v\_ok THEN  
      RAISE EXCEPTION 'INSUFFICIENT\_FUNDS';  
    END IF;  
  END IF;

  \-- Record transaction for audit  
  INSERT INTO public.user\_transactions (  
    id, user\_id, canonical\_user\_id, wallet\_address, type, amount, currency,  
    competition\_id, order\_id, description, status, metadata  
  ) VALUES (  
    gen\_random\_uuid(), NULL, p\_canonical\_user\_id, NULL,  
    CASE WHEN p\_payment\_method='balance' THEN 'debit' ELSE 'crypto' END,  
    v\_total, 'USD', p\_competition\_id, v\_order\_id,  
    'Competition entry', 'completed',  
    COALESCE(p\_metadata, '{}'::jsonb) || jsonb\_build\_object('provider', p\_payment\_method, 'tx\_ref', p\_tx\_ref)  
  );

  \-- Record order (optional)  
  INSERT INTO public.orders (id, user\_id, competition\_id, amount, currency, status, payment\_provider, payment\_method, ticket\_count)  
  VALUES (v\_order\_id, p\_canonical\_user\_id, p\_competition\_id, v\_total, 'USDC', 'completed', p\_payment\_method, p\_payment\_method, p\_entry\_count);

  RETURN v\_order\_id;  
END;  
$function$  
"  
public,create\_order\_for\_reservation,"p\_pending\_ticket\_id uuid, p\_payment\_provider text, p\_currency text","p\_pending\_ticket\_id uuid, p\_payment\_provider text, p\_currency text DEFAULT 'USDC'::text",record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.create\_order\_for\_reservation(p\_pending\_ticket\_id uuid, p\_payment\_provider text, p\_currency text DEFAULT 'USDC'::text)  
 RETURNS TABLE(order\_id uuid, amount numeric, ticket\_count integer)  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_amt numeric;  
  v\_cnt int;  
  v\_comp uuid;  
  v\_order uuid := gen\_random\_uuid();  
BEGIN  
  SELECT total\_amount, ticket\_count, competition\_id  
    INTO v\_amt, v\_cnt, v\_comp  
  FROM public.pending\_tickets  
  WHERE id \= p\_pending\_ticket\_id AND status \= 'pending' AND (expires\_at IS NULL OR expires\_at \> now());  
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation\_not\_found\_or\_expired'; END IF;

  INSERT INTO public.orders(id, user\_id, competition\_id, amount, currency, status, ticket\_count, payment\_provider)  
  VALUES (v\_order, (SELECT wallet\_address FROM public.pending\_tickets WHERE id=p\_pending\_ticket\_id), v\_comp, v\_amt, p\_currency, 'pending', v\_cnt, p\_payment\_provider);

  INSERT INTO public.order\_tickets(order\_id, ticket\_number)  
  SELECT v\_order, ticket\_number FROM public.pending\_ticket\_items WHERE pending\_ticket\_id \= p\_pending\_ticket\_id;

  RETURN QUERY SELECT v\_order, v\_amt, v\_cnt;  
END; $function$  
"  
public,create\_ticket\_hold,"p\_competition\_id uuid, p\_pending\_ticket\_id uuid, p\_numbers integer\[\], p\_hold\_minutes integer","p\_competition\_id uuid, p\_pending\_ticket\_id uuid, p\_numbers integer\[\], p\_hold\_minutes integer",record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.create\_ticket\_hold(p\_competition\_id uuid, p\_pending\_ticket\_id uuid, p\_numbers integer\[\], p\_hold\_minutes integer)  
 RETURNS TABLE(inserted\_numbers integer\[\], conflicting\_numbers integer\[\], expires\_at timestamp with time zone)  
 LANGUAGE plpgsql  
AS $function$  
DECLARE v\_expires\_at timestamptz := now() \+ (p\_hold\_minutes || ' minutes')::interval;  
BEGIN  
  UPDATE public.pending\_tickets  
    SET expires\_at \= v\_expires\_at, hold\_minutes \= p\_hold\_minutes, updated\_at \= now()  
  WHERE id \= p\_pending\_ticket\_id AND competition\_id \= p\_competition\_id;

  WITH ins AS (  
    INSERT INTO public.pending\_ticket\_items(pending\_ticket\_id, competition\_id, ticket\_number, status, expires\_at)  
    SELECT p\_pending\_ticket\_id, p\_competition\_id, n, 'pending', v\_expires\_at  
    FROM unnest(p\_numbers) AS n  
    ON CONFLICT DO NOTHING  
    RETURNING ticket\_number  
  )  
  SELECT array\_agg(ticket\_number),  
         ARRAY(SELECT n FROM unnest(p\_numbers) n EXCEPT SELECT ticket\_number FROM ins),  
         v\_expires\_at  
  INTO inserted\_numbers, conflicting\_numbers, expires\_at  
  FROM ins;

  RETURN;  
END $function$  
"  
public,create\_user\_if\_not\_exists,"p\_canonical\_user\_id text, p\_wallet\_address text, p\_email text","p\_canonical\_user\_id text, p\_wallet\_address text, p\_email text DEFAULT NULL::text",uuid,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.create\_user\_if\_not\_exists(p\_canonical\_user\_id text, p\_wallet\_address text, p\_email text DEFAULT NULL::text)  
 RETURNS uuid  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_user\_id UUID;  
  v\_existing\_id UUID;  
BEGIN  
  SELECT id INTO v\_existing\_id  
  FROM canonical\_users  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id  
     OR wallet\_address \= p\_wallet\_address  
  LIMIT 1;

  IF FOUND THEN  
    RETURN v\_existing\_id;  
  END IF;

  INSERT INTO canonical\_users (  
    canonical\_user\_id, wallet\_address, base\_wallet\_address,   
    eth\_wallet\_address, privy\_user\_id, email, username  
  ) VALUES (  
    p\_canonical\_user\_id, p\_wallet\_address, p\_wallet\_address,  
    p\_wallet\_address, p\_wallet\_address, LOWER(p\_email),   
    COALESCE(p\_email, 'user\_' || substring(p\_wallet\_address from 3 for 6))  
  )  
  RETURNING id INTO v\_user\_id;

  RETURN v\_user\_id;  
EXCEPTION WHEN OTHERS THEN  
  RETURN NULL;  
END;  
$function$  
"  
public,credit\_balance\_topup,"p\_user\_id text, p\_amount numeric, p\_tx\_ref text, p\_provider text, p\_privy\_user\_id text, p\_wallet\_address text, p\_canonical\_user\_id text, p\_notes text","p\_user\_id text, p\_amount numeric, p\_tx\_ref text, p\_provider text, p\_privy\_user\_id text, p\_wallet\_address text, p\_canonical\_user\_id text, p\_notes text",jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.credit\_balance\_topup(p\_user\_id text, p\_amount numeric, p\_tx\_ref text, p\_provider text, p\_privy\_user\_id text, p\_wallet\_address text, p\_canonical\_user\_id text, p\_notes text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_currency text := 'USDC';  
  v\_bonus\_amount numeric := 0;  
  v\_bonus\_applied boolean := false;  
  v\_prev\_available numeric := 0;  
  v\_new\_available numeric := 0;  
  v\_sub\_row\_exists boolean := false;  
BEGIN  
  \-- Idempotency: if we already have a tx with same provider+tx\_ref, return ok  
  IF EXISTS (  
    SELECT 1 FROM public.user\_transactions ut  
    WHERE (ut.metadata-\>\>'provider') \= p\_provider  
      AND (ut.metadata-\>\>'tx\_ref') \= p\_tx\_ref  
  ) THEN  
    RETURN jsonb\_build\_object('status','ok','idempotent',true,'provider',p\_provider,'tx\_ref',p\_tx\_ref);  
  END IF;

  \-- Lock or initialize the sub account row  
  SELECT true, COALESCE(s.available\_balance,0)  
  INTO v\_sub\_row\_exists, v\_prev\_available  
  FROM public.sub\_account\_balances s  
  WHERE s.canonical\_user\_id \= p\_canonical\_user\_id AND s.currency \= v\_currency  
  FOR UPDATE;

  IF NOT FOUND THEN  
    v\_sub\_row\_exists := false;  
    v\_prev\_available := 0;  
  END IF;

  \-- First deposit if row doesn't exist: 50% bonus, no cap  
  IF v\_sub\_row\_exists \= false THEN  
    v\_bonus\_amount := p\_amount \* 0.5;  
    v\_bonus\_applied := (v\_bonus\_amount \> 0);

    \-- Insert the sub account with initial available \= amount \+ bonus  
    INSERT INTO public.sub\_account\_balances(  
      user\_id, currency, available\_balance, pending\_balance, last\_updated, canonical\_user\_id, privy\_user\_id, wallet\_address, canonical\_user\_id\_norm  
    ) VALUES (  
      p\_user\_id, v\_currency, p\_amount \+ v\_bonus\_amount, 0, now(), p\_canonical\_user\_id, p\_privy\_user\_id, p\_wallet\_address, p\_canonical\_user\_id  
    );

    v\_new\_available := p\_amount \+ v\_bonus\_amount;  
  ELSE  
    \-- Subsequent deposits: no bonus, just upsert/update available\_balance  
    v\_bonus\_amount := 0;  
    v\_bonus\_applied := false;

    UPDATE public.sub\_account\_balances s  
    SET available\_balance \= COALESCE(s.available\_balance,0) \+ p\_amount,  
        last\_updated \= now(),  
        privy\_user\_id \= COALESCE(p\_privy\_user\_id, s.privy\_user\_id),  
        wallet\_address \= COALESCE(p\_wallet\_address, s.wallet\_address)  
    WHERE s.canonical\_user\_id \= p\_canonical\_user\_id AND s.currency \= v\_currency;

    SELECT COALESCE(s.available\_balance,0) INTO v\_new\_available  
    FROM public.sub\_account\_balances s  
    WHERE s.canonical\_user\_id \= p\_canonical\_user\_id AND s.currency \= v\_currency;  
  END IF;

  \-- Ledger entry for topup  
  INSERT INTO public.balance\_ledger(  
    canonical\_user\_id, transaction\_type, amount, currency, balance\_before, balance\_after, reference\_id, description, top\_up\_tx\_id  
  ) VALUES (  
    p\_canonical\_user\_id, 'topup', p\_amount, v\_currency, v\_prev\_available, v\_new\_available, COALESCE(p\_tx\_ref, gen\_random\_uuid()::text), p\_notes, p\_tx\_ref  
  )  
  ON CONFLICT (reference\_id) DO NOTHING;

  \-- Detailed user transaction audit  
  INSERT INTO public.user\_transactions (  
    user\_id, canonical\_user\_id, wallet\_address, type, amount, currency, balance\_before, balance\_after,  
    description, status, user\_privy\_id, metadata, notes, completed\_at, posted\_to\_balance  
  ) VALUES (  
    p\_user\_id, p\_canonical\_user\_id, p\_wallet\_address, 'topup', p\_amount, v\_currency, v\_prev\_available, v\_new\_available,  
    CONCAT('Top-up via ', p\_provider, CASE WHEN v\_bonus\_applied THEN ' (+50% first-deposit bonus)' ELSE '' END),  
    'completed', p\_privy\_user\_id,  
    jsonb\_build\_object('provider', p\_provider, 'tx\_ref', p\_tx\_ref, 'bonus\_amount', v\_bonus\_amount, 'bonus\_applied', v\_bonus\_applied),  
    p\_notes, now(), true  
  );

  RETURN jsonb\_build\_object(  
    'status','ok',  
    'amount', p\_amount,  
    'currency', v\_currency,  
    'provider', p\_provider,  
    'tx\_ref', p\_tx\_ref,  
    'bonus\_amount', v\_bonus\_amount,  
    'bonus\_applied', v\_bonus\_applied,  
    'balance\_before', v\_prev\_available,  
    'balance\_after', v\_new\_available  
  );  
EXCEPTION  
  WHEN unique\_violation THEN  
    RETURN jsonb\_build\_object('status','ok','idempotent',true,'provider',p\_provider,'tx\_ref',p\_tx\_ref);  
  WHEN OTHERS THEN  
    \-- Fallback path: try legacy helper for bonus then re-run minimal balance changes if needed  
    BEGIN  
      PERFORM public.credit\_sub\_account\_with\_bonus(p\_canonical\_user\_id, p\_amount, v\_currency);  
    EXCEPTION WHEN OTHERS THEN  
      \-- ignore fallback failure  
    END;  
    RETURN jsonb\_build\_object('status','error','message', SQLERRM);  
END;  
$function$  
"  
public,credit\_sub\_account\_balance,"p\_canonical\_user\_id text, p\_amount numeric, p\_currency text, p\_reference\_id text, p\_description text","p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text",record,plpgsql,true,v,false,true,Credits user sub\_account\_balance and creates balance\_ledger audit entry. Use for top-ups.,"CREATE OR REPLACE FUNCTION public.credit\_sub\_account\_balance(p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text)  
 RETURNS TABLE(success boolean, previous\_balance numeric, new\_balance numeric, error\_message text)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_record\_id UUID;  
  v\_previous\_balance NUMERIC;  
  v\_new\_balance NUMERIC;  
  search\_wallet TEXT;  
BEGIN  
  \-- Validate amount  
  IF p\_amount IS NULL OR p\_amount \<= 0 THEN  
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Amount must be positive'::TEXT;  
    RETURN;  
  END IF;

  \-- Extract wallet address from prize:pid: format if present  
  IF p\_canonical\_user\_id LIKE 'prize:pid:0x%' THEN  
    search\_wallet := LOWER(SUBSTRING(p\_canonical\_user\_id FROM 11));  
  ELSIF p\_canonical\_user\_id LIKE '0x%' AND LENGTH(p\_canonical\_user\_id) \= 42 THEN  
    search\_wallet := LOWER(p\_canonical\_user\_id);  
  ELSE  
    search\_wallet := NULL;  
  END IF;

  \-- Find the record to update  
  SELECT id, COALESCE(available\_balance, 0\)  
  INTO v\_record\_id, v\_previous\_balance  
  FROM public.sub\_account\_balances  
  WHERE currency \= p\_currency  
    AND (  
      canonical\_user\_id \= p\_canonical\_user\_id  
      OR canonical\_user\_id \= LOWER(p\_canonical\_user\_id)  
      OR (search\_wallet IS NOT NULL AND canonical\_user\_id \= 'prize:pid:' || search\_wallet)  
      OR user\_id \= p\_canonical\_user\_id  
      OR privy\_user\_id \= p\_canonical\_user\_id  
    )  
  ORDER BY  
    CASE  
      WHEN canonical\_user\_id \= p\_canonical\_user\_id THEN 0  
      WHEN canonical\_user\_id \= LOWER(p\_canonical\_user\_id) THEN 1  
      ELSE 2  
    END  
  LIMIT 1  
  FOR UPDATE;

  IF v\_record\_id IS NULL THEN  
    \-- No record found \- create one  
    v\_previous\_balance := 0;  
    v\_new\_balance := p\_amount;

    INSERT INTO public.sub\_account\_balances (  
      canonical\_user\_id,  
      user\_id,  
      currency,  
      available\_balance,  
      pending\_balance,  
      last\_updated  
    ) VALUES (  
      p\_canonical\_user\_id,  
      p\_canonical\_user\_id,  \-- Use same value for user\_id initially  
      p\_currency,  
      v\_new\_balance,  
      0,  
      NOW()  
    )  
    RETURNING id INTO v\_record\_id;  
  ELSE  
    \-- Calculate new balance  
    v\_new\_balance := ROUND(v\_previous\_balance \+ p\_amount, 2);

    \-- Update the record  
    UPDATE public.sub\_account\_balances  
    SET  
      available\_balance \= v\_new\_balance,  
      last\_updated \= NOW()  
    WHERE id \= v\_record\_id;  
  END IF;

  \-- CRITICAL: Create balance\_ledger audit entry  
  INSERT INTO public.balance\_ledger (  
    canonical\_user\_id,  
    transaction\_type,  
    amount,  
    currency,  
    balance\_before,  
    balance\_after,  
    reference\_id,  
    description,  
    created\_at  
  ) VALUES (  
    p\_canonical\_user\_id,  
    'credit',  
    p\_amount,  
    p\_currency,  
    v\_previous\_balance,  
    v\_new\_balance,  
    p\_reference\_id,  
    COALESCE(p\_description, 'Account balance credited'),  
    NOW()  
  );

  RETURN QUERY SELECT TRUE, v\_previous\_balance, v\_new\_balance, NULL::TEXT;  
END;  
$function$  
"  
public,credit\_sub\_account\_balance,"p\_canonical\_user\_id text, p\_currency text, p\_amount numeric","p\_canonical\_user\_id text, p\_currency text, p\_amount numeric",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.credit\_sub\_account\_balance(p\_canonical\_user\_id text, p\_currency text, p\_amount numeric)  
 RETURNS TABLE(balance\_before numeric, balance\_after numeric)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_before numeric;  
  v\_after numeric;  
BEGIN  
  IF p\_amount \<= 0 THEN  
    RAISE EXCEPTION 'Amount must be positive';  
  END IF;

  LOOP  
    BEGIN  
      SELECT available\_balance  
      INTO v\_before  
      FROM public.sub\_account\_balances  
      WHERE canonical\_user\_id \= p\_canonical\_user\_id  
        AND currency \= p\_currency  
      FOR UPDATE;

      IF NOT FOUND THEN  
        INSERT INTO public.sub\_account\_balances (canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated)  
        VALUES (p\_canonical\_user\_id, p\_currency, 0, 0, now())  
        ON CONFLICT (canonical\_user\_id, currency) DO NOTHING;  
        CONTINUE;  
      END IF;

      EXIT;  
    EXCEPTION WHEN unique\_violation THEN  
      CONTINUE;  
    END;  
  END LOOP;

  IF v\_before IS NULL THEN  
    v\_before := 0;  
  END IF;

  v\_after := v\_before \+ p\_amount;

  UPDATE public.sub\_account\_balances  
  SET available\_balance \= v\_after,  
      last\_updated \= now()  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id  
    AND currency \= p\_currency;

  RETURN QUERY SELECT v\_before, v\_after;  
END;  
$function$  
"  
public,credit\_sub\_account\_with\_bonus,"p\_canonical\_user\_id text, p\_amount numeric, p\_currency text","p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.credit\_sub\_account\_with\_bonus(p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text)  
 RETURNS TABLE(success boolean, previous\_balance numeric, new\_balance numeric, bonus\_amount numeric, bonus\_applied boolean)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user RECORD;  
  v\_has\_used\_bonus BOOLEAN;  
  v\_bonus\_amount NUMERIC := 0;  
  v\_total\_credit NUMERIC := 0;  
  v\_current\_balance NUMERIC := 0;  
  v\_new\_balance NUMERIC := 0;  
  v\_can\_log BOOLEAN := false;  
BEGIN  
  SELECT c.\* INTO v\_user  
  FROM canonical\_users c  
  WHERE c.canonical\_user\_id \= p\_canonical\_user\_id  
     OR (is\_uuid(p\_canonical\_user\_id) AND c.id \= p\_canonical\_user\_id::uuid)  
  LIMIT 1;

  IF v\_user IS NULL THEN  
    RETURN QUERY SELECT false, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, false;  
    RETURN;  
  END IF;

  v\_has\_used\_bonus := COALESCE(v\_user.has\_used\_new\_user\_bonus, false);  
  v\_current\_balance := COALESCE(v\_user.usdc\_balance, 0);

  IF v\_has\_used\_bonus \= false THEN  
    v\_bonus\_amount := COALESCE(p\_amount,0) \* 0.5;  
    v\_total\_credit := COALESCE(p\_amount,0) \+ v\_bonus\_amount;  
  ELSE  
    v\_total\_credit := COALESCE(p\_amount,0);  
  END IF;

  v\_new\_balance := v\_current\_balance \+ v\_total\_credit;

  UPDATE canonical\_users  
     SET usdc\_balance \= v\_new\_balance,  
         has\_used\_new\_user\_bonus \= CASE WHEN v\_bonus\_amount \> 0 THEN true ELSE has\_used\_new\_user\_bonus END,  
         updated\_at \= NOW()  
   WHERE id \= v\_user.id;

  SELECT EXISTS (  
    SELECT 1 FROM pg\_catalog.pg\_class cls  
    JOIN pg\_catalog.pg\_namespace ns ON ns.oid \= cls.relnamespace  
    WHERE ns.nspname \= 'public' AND cls.relname \= 'balance\_history' AND cls.relkind \= 'r'  
  ) INTO v\_can\_log;

  IF v\_can\_log THEN  
    IF COALESCE(p\_amount,0) \> 0 THEN  
      INSERT INTO public.balance\_history (user\_id, amount, type, reason, balance\_before, balance\_after, created\_at)  
      VALUES (v\_user.id, p\_amount, 'credit', 'topup', v\_current\_balance, v\_current\_balance \+ p\_amount, NOW());  
    END IF;

    IF v\_bonus\_amount \> 0 THEN  
      INSERT INTO public.balance\_history (user\_id, amount, type, reason, balance\_before, balance\_after, created\_at)  
      VALUES (v\_user.id, v\_bonus\_amount, 'credit', '50% first deposit bonus', v\_current\_balance \+ p\_amount, v\_new\_balance, NOW());  
    END IF;  
  ELSE  
    RAISE NOTICE 'balance\_history table not found in public schema — skipping audit logs';  
  END IF;

  RETURN QUERY SELECT true, v\_current\_balance, v\_new\_balance, v\_bonus\_amount, v\_bonus\_amount \> 0;  
END;$function$  
"  
public,credit\_user\_balance,"amount numeric, user\_id text","amount numeric, user\_id text",numeric,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION public.credit\_user\_balance(amount numeric, user\_id text)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE v\_new\_balance NUMERIC; BEGIN  
  UPDATE canonical\_users SET usdc\_balance \= COALESCE(usdc\_balance,0)+amount, updated\_at=NOW() WHERE id=user\_id::UUID RETURNING usdc\_balance INTO v\_new\_balance;  
  RETURN COALESCE(v\_new\_balance,0); END; $function$  
"  
public,credit\_user\_balance,"p\_canonical\_user\_id text, p\_amount numeric, p\_currency text","p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text",void,sql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.credit\_user\_balance(p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text)  
 RETURNS void  
 LANGUAGE sql  
AS $function$  
  INSERT INTO public.sub\_account\_balances (canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated)  
  VALUES (p\_canonical\_user\_id, p\_currency, p\_amount, 0, now())  
  ON CONFLICT (id) DO NOTHING;  
  \-- If row exists, increment  
  UPDATE public.sub\_account\_balances  
  SET available\_balance \= COALESCE(available\_balance,0) \+ p\_amount,  
      last\_updated \= now()  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id AND currency \= p\_currency;  
$function$  
"  
public,crypt,"text, text","text, text",text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.crypt(text, text)  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_crypt$function$  
"  
public,cu\_normalize\_and\_enforce,,,trigger,plpgsql,false,v,false,false,Comprehensive normalization with fallback logic to ensure data consistency (skips temp placeholders),"CREATE OR REPLACE FUNCTION public.cu\_normalize\_and\_enforce()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  \-- Normalize all wallet fields using util function for consistency  
  IF NEW.wallet\_address IS NOT NULL THEN  
    NEW.wallet\_address := util.normalize\_evm\_address(NEW.wallet\_address);  
  END IF;  
    
  IF NEW.base\_wallet\_address IS NOT NULL THEN  
    NEW.base\_wallet\_address := util.normalize\_evm\_address(NEW.base\_wallet\_address);  
  END IF;  
    
  IF NEW.eth\_wallet\_address IS NOT NULL THEN  
    NEW.eth\_wallet\_address := util.normalize\_evm\_address(NEW.eth\_wallet\_address);  
  END IF;

  \-- If primary wallet is missing but alternates exist, pick first non-null  
  IF NEW.wallet\_address IS NULL THEN  
    IF NEW.base\_wallet\_address IS NOT NULL THEN  
      NEW.wallet\_address := NEW.base\_wallet\_address;  
    ELSIF NEW.eth\_wallet\_address IS NOT NULL THEN  
      NEW.wallet\_address := NEW.eth\_wallet\_address;  
    END IF;  
  END IF;

  \-- Enforce canonical\_user\_id when we have a wallet  
  \-- IMPORTANT: Only set if NOT a temporary placeholder  
  IF NEW.wallet\_address IS NOT NULL AND (NEW.canonical\_user\_id IS NULL OR NEW.canonical\_user\_id NOT LIKE 'prize:pid:temp%') THEN  
    NEW.canonical\_user\_id := 'prize:pid:' || NEW.wallet\_address;  
  END IF;

  RETURN NEW;  
END;  
$function$  
"  
public,dearmor,text,text,bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.dearmor(text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_dearmor$function$  
"  
public,debit\_balance\_and\_confirm,"p\_user uuid, p\_competition uuid, p\_amount\_cents integer, p\_pending\_id uuid, p\_payment\_id text, p\_provider text","p\_user uuid, p\_competition uuid, p\_amount\_cents integer, p\_pending\_id uuid, p\_payment\_id text, p\_provider text DEFAULT 'balance'::text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.debit\_balance\_and\_confirm(p\_user uuid, p\_competition uuid, p\_amount\_cents integer, p\_pending\_id uuid, p\_payment\_id text, p\_provider text DEFAULT 'balance'::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  cur\_balance integer;  
  needed integer := p\_amount\_cents;  
  result jsonb;  
begin  
  if p\_amount\_cents \<= 0 then  
    raise exception 'amount must be positive';  
  end if;

  \-- Lock balance row  
  select balance\_cents into cur\_balance  
  from sub\_account\_balances  
  where user\_id \= p\_user and currency \= 'USD'  
  for update;

  if cur\_balance is null then  
    raise exception 'no USD balance row for user %', p\_user;  
  end if;  
  if cur\_balance \< needed then  
    raise exception 'insufficient funds';  
  end if;

  update sub\_account\_balances  
     set balance\_cents \= balance\_cents \- needed, updated\_at \= now()  
   where user\_id \= p\_user and currency \= 'USD';

  \-- Confirm tickets via existing business RPC if present; else mark pending\_tickets  
  perform 1;  
  update pending\_tickets  
     set status \= 'confirmed', payment\_provider \= coalesce(p\_provider,'balance'), payment\_id \= p\_payment\_id, updated\_at \= now()  
   where id \= p\_pending\_id and user\_id \= p\_user and competition\_id \= p\_competition;

  \-- Optionally insert tickets\_sold here if your flow requires; assuming another process handles issuance.  
  select jsonb\_build\_object('ok', true, 'debited', needed) into result;  
  return result;  
exception when others then  
  raise; \-- let caller see precise error  
end $function$  
"  
public,debit\_balance\_and\_confirm,"p\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_pending\_id uuid, p\_ticket\_count integer, p\_tx\_ref text, p\_provider text, p\_privy\_user\_id text, p\_wallet\_address text, p\_canonical\_user\_id text","p\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_pending\_id uuid, p\_ticket\_count integer, p\_tx\_ref text, p\_provider text DEFAULT 'balance'::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text",jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.debit\_balance\_and\_confirm(p\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_pending\_id uuid, p\_ticket\_count integer, p\_tx\_ref text, p\_provider text DEFAULT 'balance'::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_curr               constant text := 'USD';  
  v\_balance\_before     numeric;  
  v\_balance\_after      numeric;  
  v\_now                timestamptz := now();  
BEGIN  
  IF p\_amount \<= 0 THEN  
    RAISE EXCEPTION 'amount must be positive';  
  END IF;

  \-- Lock user balance row for update to enforce atomic debit  
  SELECT available\_balance  
    INTO v\_balance\_before  
  FROM public.sub\_account\_balances  
  WHERE user\_id \= p\_user\_id AND currency \= v\_curr  
  FOR UPDATE;

  IF v\_balance\_before IS NULL THEN  
    RAISE EXCEPTION 'balance row not found for user\_id=% and currency=%', p\_user\_id, v\_curr;  
  END IF;

  IF v\_balance\_before \< p\_amount THEN  
    RAISE EXCEPTION 'insufficient balance. have=%, need=%', v\_balance\_before, p\_amount;  
  END IF;

  \-- Perform debit and compute after  
  v\_balance\_after := v\_balance\_before \- p\_amount;

  UPDATE public.sub\_account\_balances  
     SET available\_balance \= v\_balance\_after,  
         last\_updated \= v\_now,  
         canonical\_user\_id \= COALESCE(p\_canonical\_user\_id, canonical\_user\_id),  
         privy\_user\_id     \= COALESCE(p\_privy\_user\_id, privy\_user\_id),  
         wallet\_address    \= COALESCE(LOWER(p\_wallet\_address), wallet\_address)  
   WHERE user\_id \= p\_user\_id AND currency \= v\_curr;

  \-- Confirm the reservation if provided  
  IF p\_pending\_id IS NOT NULL THEN  
    UPDATE public.pending\_tickets  
       SET status \= 'confirmed',  
           confirmed\_at \= v\_now,  
           payment\_id \= COALESCE(p\_tx\_ref, payment\_id),  
           payment\_provider \= COALESCE(p\_provider, payment\_provider),  
           transaction\_hash \= COALESCE(p\_tx\_ref, transaction\_hash),  
           updated\_at \= v\_now  
     WHERE id \= p\_pending\_id  
       AND user\_id \= p\_user\_id  
       AND competition\_id \= p\_competition\_id;  
  END IF;

  \-- Insert transaction audit  
  INSERT INTO public.user\_transactions (  
    user\_id,  
    canonical\_user\_id,  
    wallet\_address,  
    user\_privy\_id,  
    type,  
    amount,  
    currency,  
    competition\_id,  
    status,  
    description,  
    balance\_before,  
    balance\_after,  
    metadata  
  ) VALUES (  
    p\_user\_id,  
    NULLIF(p\_canonical\_user\_id, ''),  
    CASE WHEN p\_wallet\_address IS NOT NULL THEN LOWER(p\_wallet\_address) ELSE NULL END,  
    NULLIF(p\_privy\_user\_id, ''),  
    'purchase',  
    p\_amount,  
    v\_curr,  
    p\_competition\_id,  
    'completed',  
    CONCAT('provider=', COALESCE(p\_provider,'balance'), '; tx=', COALESCE(p\_tx\_ref,''), '; tickets=', COALESCE(p\_ticket\_count::text,'')),  
    v\_balance\_before,  
    v\_balance\_after,  
    jsonb\_build\_object(  
      'source', 'balance\_purchase',  
      'tx\_ref', p\_tx\_ref,  
      'provider', COALESCE(p\_provider,'balance'),  
      'ticket\_count', p\_ticket\_count,  
      'pending\_id', p\_pending\_id,  
      'wallet', CASE WHEN p\_wallet\_address IS NOT NULL THEN LOWER(p\_wallet\_address) ELSE NULL END,  
      'privy\_user\_id', p\_privy\_user\_id,  
      'canonical\_user\_id', p\_canonical\_user\_id  
    )  
  );

  RETURN jsonb\_build\_object(  
    'ok', true,  
    'user\_id', p\_user\_id,  
    'competition\_id', p\_competition\_id,  
    'amount', p\_amount,  
    'currency', v\_curr,  
    'balance\_before', v\_balance\_before,  
    'balance\_after', v\_balance\_after,  
    'tx\_ref', p\_tx\_ref,  
    'ticket\_count', p\_ticket\_count,  
    'provider', p\_provider  
  );  
EXCEPTION  
  WHEN OTHERS THEN  
    RETURN jsonb\_build\_object(  
      'ok', false,  
      'error', SQLERRM  
    );  
END;  
$function$  
"  
public,debit\_balance\_and\_confirm\_tickets,"p\_canonical\_user\_id text, p\_order\_id uuid, p\_competition\_id uuid, p\_amount\_usd numeric, p\_tx\_ref text, p\_currency text","p\_canonical\_user\_id text, p\_order\_id uuid, p\_competition\_id uuid, p\_amount\_usd numeric, p\_tx\_ref text, p\_currency text DEFAULT 'USD'::text",json,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.debit\_balance\_and\_confirm\_tickets(p\_canonical\_user\_id text, p\_order\_id uuid, p\_competition\_id uuid, p\_amount\_usd numeric, p\_tx\_ref text, p\_currency text DEFAULT 'USD'::text)  
 RETURNS json  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_balance\_row public.sub\_account\_balances%ROWTYPE;  
  v\_balance\_before numeric;  
  v\_balance\_after numeric;  
  v\_existing\_tx uuid;  
BEGIN  
  \-- Idempotency: skip if a matching user\_transactions exists for this order or tx\_ref  
  SELECT id INTO v\_existing\_tx  
  FROM public.user\_transactions  
  WHERE (order\_id \= p\_order\_id OR (metadata-\>\> 'tx\_ref') \= p\_tx\_ref)  
    AND type \= 'debit'  
    AND (metadata-\>\> 'source') \= 'balance\_payment'  
  LIMIT 1;

  IF v\_existing\_tx IS NOT NULL THEN  
    RETURN json\_build\_object('status','skipped','reason','already\_debited','order\_id',p\_order\_id);  
  END IF;

  \-- Lock the balance row for this user \+ currency  
  SELECT \* INTO v\_balance\_row  
  FROM public.sub\_account\_balances  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id AND currency \= p\_currency  
  FOR UPDATE;

  IF NOT FOUND THEN  
    RAISE EXCEPTION 'No sub\_account\_balances row for user % and currency %', p\_canonical\_user\_id, p\_currency;  
  END IF;

  v\_balance\_before := COALESCE(v\_balance\_row.available\_balance, 0);  
  IF v\_balance\_before \< p\_amount\_usd THEN  
    RETURN json\_build\_object('status','skipped','reason','insufficient\_funds','order\_id',p\_order\_id,'balance',v\_balance\_before);  
  END IF;

  \-- Debit  
  v\_balance\_after := v\_balance\_before \- p\_amount\_usd;  
  UPDATE public.sub\_account\_balances  
  SET available\_balance \= v\_balance\_after,  
      last\_updated \= now()  
  WHERE id \= v\_balance\_row.id;

  \-- Ledger  
  INSERT INTO public.user\_transactions (  
    user\_id,  
    canonical\_user\_id,  
    type,  
    amount,  
    currency,  
    balance\_before,  
    balance\_after,  
    competition\_id,  
    order\_id,  
    description,  
    status,  
    metadata  
  ) VALUES (  
    NULL,  
    p\_canonical\_user\_id,  
    'debit',  
    p\_amount\_usd,  
    p\_currency,  
    v\_balance\_before,  
    v\_balance\_after,  
    p\_competition\_id,  
    p\_order\_id,  
    'Balance payment for ticket order',  
    'completed',  
    jsonb\_build\_object(  
      'source','balance\_payment',  
      'tx\_ref', p\_tx\_ref  
    )  
  );

  \-- Confirm tickets for this order  
  UPDATE public.tickets t  
  SET status \= 'sold',  
      purchased\_by \= NULL,  
      purchased\_at \= COALESCE(t.purchased\_at, now()),  
      order\_id \= p\_order\_id,  
      purchase\_price \= COALESCE(t.purchase\_price, p\_amount\_usd / NULLIF(t.payment\_amount,0)),  
      is\_active \= true  
  WHERE t.order\_id \= p\_order\_id;

  \-- Broadcast via realtime (optional; will no-op if not authorized)  
  PERFORM realtime.send(  
    'user:' || p\_canonical\_user\_id || ':balance',  
    'balance\_updated',  
    jsonb\_build\_object('canonical\_user\_id', p\_canonical\_user\_id, 'balance', v\_balance\_after),  
    true  
  );

  RETURN json\_build\_object('status','debited','order\_id',p\_order\_id,'balance\_after',v\_balance\_after);  
END;  
$function$  
"  
public,debit\_balance\_confirm\_tickets,"p\_canonical\_user\_id text, p\_competition\_id uuid, p\_order\_id uuid, p\_amount numeric, p\_tx\_ref text, p\_currency text","p\_canonical\_user\_id text, p\_competition\_id uuid, p\_order\_id uuid, p\_amount numeric, p\_tx\_ref text, p\_currency text",json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.debit\_balance\_confirm\_tickets(p\_canonical\_user\_id text, p\_competition\_id uuid, p\_order\_id uuid, p\_amount numeric, p\_tx\_ref text, p\_currency text)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  v\_user\_id uuid;  
  v\_wallet text;  
  v\_balance\_before numeric;  
  v\_balance\_after numeric;  
  v\_now timestamptz := now();  
  v\_rows\_confirmed int := 0;  
  v\_tx\_id uuid := gen\_random\_uuid();  
begin  
  \-- Idempotency check  
  if p\_tx\_ref is not null and exists (  
    select 1 from public.user\_transactions ut where ut.tx\_ref \= p\_tx\_ref  
  ) then  
    return json\_build\_object('status','ok','idempotent',true,'message','tx\_ref already processed');  
  end if;

  \-- Resolve user id and wallet from canonical id  
  select au.id, lower(coalesce(up.wallet\_address,''))  
    into v\_user\_id, v\_wallet  
  from auth.users au  
  join public.user\_profiles up on up.auth\_user\_id \= au.id  
  where up.canonical\_user\_id \= p\_canonical\_user\_id  
  limit 1;

  if v\_user\_id is null then  
    raise exception 'canonical\_user\_id % not found', p\_canonical\_user\_id;  
  end if;

  \-- Lock the balance row  
  select available\_balance  
    into v\_balance\_before  
  from public.sub\_account\_balances  
  where user\_id \= v\_user\_id and currency \= p\_currency  
  for update;

  if v\_balance\_before is null then  
    raise exception 'No balance row for user % and currency %', v\_user\_id, p\_currency;  
  end if;

  if v\_balance\_before \< p\_amount then  
    raise exception 'Insufficient funds: balance % \< amount %', v\_balance\_before, p\_amount;  
  end if;

  v\_balance\_after := v\_balance\_before \- p\_amount;

  update public.sub\_account\_balances  
    set available\_balance \= v\_balance\_after,  
        updated\_at \= v\_now  
  where user\_id \= v\_user\_id and currency \= p\_currency;

  \-- Ledger insert  
  insert into public.user\_transactions(  
    id, user\_id, currency, amount, direction, balance\_before, balance\_after,  
    competition\_id, order\_id, tx\_ref, created\_at  
  ) values (  
    v\_tx\_id, v\_user\_id, p\_currency, p\_amount, 'debit', v\_balance\_before, v\_balance\_after,  
    p\_competition\_id, p\_order\_id, p\_tx\_ref, v\_now  
  );

  \-- Move pending\_tickets to tickets  
  with ins as (  
    insert into public.tickets (  
      id, competition\_id, user\_id, wallet\_address, canonical\_user\_id, status,  
      purchased\_at, order\_id, purchase\_price  
    )  
    select pt.id, pt.competition\_id, v\_user\_id, lower(coalesce(pt.wallet\_address, v\_wallet)), p\_canonical\_user\_id,  
           'sold', v\_now, p\_order\_id, coalesce(pt.price, 0\)  
    from public.pending\_tickets pt  
    where pt.competition\_id \= p\_competition\_id  
      and (pt.canonical\_user\_id \= p\_canonical\_user\_id or pt.user\_id \= v\_user\_id)  
    returning id, competition\_id  
  )  
  delete from public.pending\_tickets pt  
  using ins  
  where ins.id \= pt.id and ins.competition\_id \= pt.competition\_id;

  GET DIAGNOSTICS v\_rows\_confirmed \= ROW\_COUNT;

  return json\_build\_object(  
    'status','ok',  
    'idempotent', false,  
    'debited', p\_amount,  
    'currency', p\_currency,  
    'balance\_after', v\_balance\_after,  
    'tickets\_confirmed', v\_rows\_confirmed  
  );  
exception when others then  
  raise;  
end;  
$function$  
"  
public,debit\_sub\_account\_balance,"p\_canonical\_user\_id text, p\_amount numeric, p\_currency text, p\_reference\_id text, p\_description text","p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text",record,plpgsql,true,v,false,true,Debits user sub\_account\_balance and creates balance\_ledger audit entry. Use for purchases.,"CREATE OR REPLACE FUNCTION public.debit\_sub\_account\_balance(p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text)  
 RETURNS TABLE(success boolean, previous\_balance numeric, new\_balance numeric, error\_message text)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_record\_id UUID;  
  v\_previous\_balance NUMERIC;  
  v\_new\_balance NUMERIC;  
  search\_wallet TEXT;  
BEGIN  
  \-- Validate amount  
  IF p\_amount IS NULL OR p\_amount \<= 0 THEN  
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Amount must be positive'::TEXT;  
    RETURN;  
  END IF;

  \-- Extract wallet address from prize:pid: format if present  
  IF p\_canonical\_user\_id LIKE 'prize:pid:0x%' THEN  
    search\_wallet := LOWER(SUBSTRING(p\_canonical\_user\_id FROM 11));  
  ELSIF p\_canonical\_user\_id LIKE '0x%' AND LENGTH(p\_canonical\_user\_id) \= 42 THEN  
    search\_wallet := LOWER(p\_canonical\_user\_id);  
  ELSE  
    search\_wallet := NULL;  
  END IF;

  \-- Find the record to update (with row lock)  
  SELECT id, COALESCE(available\_balance, 0\)  
  INTO v\_record\_id, v\_previous\_balance  
  FROM public.sub\_account\_balances  
  WHERE currency \= p\_currency  
    AND (  
      canonical\_user\_id \= p\_canonical\_user\_id  
      OR canonical\_user\_id \= LOWER(p\_canonical\_user\_id)  
      OR (search\_wallet IS NOT NULL AND canonical\_user\_id \= 'prize:pid:' || search\_wallet)  
      OR user\_id \= p\_canonical\_user\_id  
      OR privy\_user\_id \= p\_canonical\_user\_id  
    )  
  ORDER BY  
    CASE  
      WHEN canonical\_user\_id \= p\_canonical\_user\_id THEN 0  
      WHEN canonical\_user\_id \= LOWER(p\_canonical\_user\_id) THEN 1  
      ELSE 2  
    END  
  LIMIT 1  
  FOR UPDATE;

  IF v\_record\_id IS NULL THEN  
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'User balance record not found'::TEXT;  
    RETURN;  
  END IF;

  \-- Check sufficient balance  
  IF v\_previous\_balance \< p\_amount THEN  
    RETURN QUERY SELECT FALSE, v\_previous\_balance, v\_previous\_balance,  
      format('Insufficient balance. Have: %s, Need: %s', v\_previous\_balance, p\_amount)::TEXT;  
    RETURN;  
  END IF;

  \-- Calculate new balance  
  v\_new\_balance := ROUND(v\_previous\_balance \- p\_amount, 2);

  \-- Update the record  
  UPDATE public.sub\_account\_balances  
  SET  
    available\_balance \= v\_new\_balance,  
    last\_updated \= NOW()  
  WHERE id \= v\_record\_id;

  \-- CRITICAL: Create balance\_ledger audit entry (negative amount for debit)  
  INSERT INTO public.balance\_ledger (  
    canonical\_user\_id,  
    transaction\_type,  
    amount,  
    currency,  
    balance\_before,  
    balance\_after,  
    reference\_id,  
    description,  
    created\_at  
  ) VALUES (  
    p\_canonical\_user\_id,  
    'debit',  
    \-p\_amount,  \-- Negative for debit  
    p\_currency,  
    v\_previous\_balance,  
    v\_new\_balance,  
    p\_reference\_id,  
    COALESCE(p\_description, 'Account balance debited'),  
    NOW()  
  );

  RETURN QUERY SELECT TRUE, v\_previous\_balance, v\_new\_balance, NULL::TEXT;  
END;  
$function$  
"  
public,debit\_sub\_account\_balance\_with\_entry,"p\_canonical\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_ticket\_count integer, p\_ticket\_numbers text, p\_transaction\_id text","p\_canonical\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_ticket\_count integer, p\_ticket\_numbers text DEFAULT ''::text, p\_transaction\_id text DEFAULT NULL::text",jsonb,plpgsql,true,v,false,false,Atomically debits user balance and creates competition entry. Returns success/error with balance details.,"CREATE OR REPLACE FUNCTION public.debit\_sub\_account\_balance\_with\_entry(p\_canonical\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_ticket\_count integer, p\_ticket\_numbers text DEFAULT ''::text, p\_transaction\_id text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_balance\_result RECORD;  
  v\_entry\_uid UUID;  
  v\_wallet\_address TEXT;  
BEGIN  
  \-- Step 1: Debit the balance (with ledger entry)  
  SELECT \*  
  INTO v\_balance\_result  
  FROM debit\_sub\_account\_balance(  
    p\_canonical\_user\_id,  
    p\_amount,  
    'USD',  
    p\_transaction\_id,  
    format('Purchase %s tickets for competition %s', p\_ticket\_count, p\_competition\_id)  
  );

  \-- Check if debit was successful  
  IF NOT v\_balance\_result.success THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', v\_balance\_result.error\_message,  
      'previous\_balance', v\_balance\_result.previous\_balance  
    );  
  END IF;

  \-- Extract wallet address if canonical\_user\_id is in prize:pid:0x... format  
  IF p\_canonical\_user\_id LIKE 'prize:pid:0x%' THEN  
    v\_wallet\_address := LOWER(SUBSTRING(p\_canonical\_user\_id FROM 11));  
  ELSIF p\_canonical\_user\_id LIKE '0x%' THEN  
    v\_wallet\_address := LOWER(p\_canonical\_user\_id);  
  ELSE  
    v\_wallet\_address := NULL;  
  END IF;

  \-- Step 2: Create competition entry in joincompetition table  
  v\_entry\_uid := gen\_random\_uuid();  
    
  INSERT INTO public.joincompetition (  
    uid,  
    competitionid,  
    userid,  
    canonical\_user\_id,  
    numberoftickets,  
    ticketnumbers,  
    amountspent,  
    walletaddress,  
    chain,  
    transactionhash,  
    purchasedate,  
    created\_at  
  ) VALUES (  
    v\_entry\_uid,  
    p\_competition\_id,  
    p\_canonical\_user\_id,  
    p\_canonical\_user\_id,  
    p\_ticket\_count,  
    p\_ticket\_numbers,  
    p\_amount,  
    v\_wallet\_address,  
    'balance',  \-- Payment method  
    COALESCE(p\_transaction\_id, v\_entry\_uid::TEXT),  \-- Use transaction\_id or entry uid  
    NOW(),  
    NOW()  
  );

  \-- Step 3: Return success with details  
  RETURN jsonb\_build\_object(  
    'success', true,  
    'entry\_uid', v\_entry\_uid,  
    'previous\_balance', v\_balance\_result.previous\_balance,  
    'new\_balance', v\_balance\_result.new\_balance,  
    'amount\_debited', p\_amount,  
    'ticket\_count', p\_ticket\_count,  
    'competition\_id', p\_competition\_id  
  );

EXCEPTION  
  WHEN OTHERS THEN  
    \-- If anything fails, the transaction will be rolled back automatically  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', SQLERRM,  
      'error\_detail', SQLSTATE  
    );  
END;  
$function$  
"  
public,debit\_user\_balance,"amount numeric, user\_id text","amount numeric, user\_id text",numeric,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION public.debit\_user\_balance(amount numeric, user\_id text)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE v\_new\_balance NUMERIC; BEGIN  
  UPDATE canonical\_users SET usdc\_balance \= GREATEST(0, COALESCE(usdc\_balance,0)-amount), updated\_at=NOW() WHERE id=user\_id::UUID RETURNING usdc\_balance INTO v\_new\_balance;  
  RETURN COALESCE(v\_new\_balance,0); END; $function$  
"  
public,debit\_user\_balance,"p\_canonical\_user\_id text, p\_amount numeric, p\_currency text","p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text",bool,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.debit\_user\_balance(p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text)  
 RETURNS boolean  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_current numeric;  
BEGIN  
  \-- Lock the balance row  
  SELECT available\_balance INTO v\_current  
  FROM public.sub\_account\_balances  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id AND currency \= p\_currency  
  FOR UPDATE;

  IF NOT FOUND THEN  
    RAISE EXCEPTION 'Balance row not found for % %', p\_canonical\_user\_id, p\_currency;  
  END IF;

  IF v\_current \< p\_amount THEN  
    RETURN FALSE; \-- insufficient funds  
  END IF;

  UPDATE public.sub\_account\_balances  
  SET available\_balance \= available\_balance \- p\_amount,  
      last\_updated \= now()  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id AND currency \= p\_currency;

  RETURN TRUE;  
END;  
$function$  
"  
public,decrypt,"bytea, bytea, text","bytea, bytea, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.decrypt(bytea, bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_decrypt$function$  
"  
public,decrypt\_iv,"bytea, bytea, bytea, text","bytea, bytea, bytea, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.decrypt\_iv(bytea, bytea, bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_decrypt\_iv$function$  
"  
public,digest,"bytea, text","bytea, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.digest(bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_digest$function$  
"  
public,digest,"text, text","text, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.digest(text, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_digest$function$  
"  
public,encrypt,"bytea, bytea, text","bytea, bytea, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.encrypt(bytea, bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_encrypt$function$  
"  
public,encrypt\_iv,"bytea, bytea, bytea, text","bytea, bytea, bytea, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.encrypt\_iv(bytea, bytea, bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_encrypt\_iv$function$  
"  
public,end\_competition\_and\_select\_winners,"p\_competition\_id uuid, p\_vrf\_seed text","p\_competition\_id uuid, p\_vrf\_seed text DEFAULT NULL::text",\_uuid,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.end\_competition\_and\_select\_winners(p\_competition\_id uuid, p\_vrf\_seed text DEFAULT NULL::text)  
 RETURNS TABLE(winner\_user\_ids uuid\[\])  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
    competition\_record RECORD;  
    ticket\_count INTEGER;  
    winner\_user\_ids UUID\[\];  
    prize\_amount DECIMAL(18,8);  
    winner\_ticket\_numbers INTEGER\[\];  
    selected\_tickets RECORD;  
BEGIN  
    \-- Get competition details  
    SELECT \* INTO competition\_record   
    FROM public.competitions   
    WHERE id \= p\_competition\_id;  
      
    IF NOT FOUND THEN  
        RAISE EXCEPTION 'Competition not found';  
    END IF;  
      
    IF competition\_record.status \!= 'active' THEN  
        RAISE EXCEPTION 'Competition is not active';  
    END IF;  
      
    \-- Check if competition has ended  
    IF competition\_record.end\_time \> NOW() THEN  
        RAISE EXCEPTION 'Competition has not ended yet';  
    END IF;  
      
    \-- Get total prize pool  
    prize\_amount := (competition\_record.tickets\_sold \* competition\_record.price\_per\_ticket) / competition\_record.num\_winners;  
      
    \-- Get all tickets for this competition  
    FOR selected\_tickets IN   
        SELECT t.user\_id, t.ticket\_number  
        FROM public.tickets t  
        WHERE t.competition\_id \= p\_competition\_id  
        ORDER BY t.ticket\_number  
    LOOP  
        \-- Simple selection for now \- can be enhanced with VRF  
        \-- This will be replaced by proper VRF integration  
        IF array\_length(winner\_user\_ids, 1\) IS NULL OR   
           array\_length(winner\_user\_ids, 1\) \< competition\_record.num\_winners THEN  
            winner\_user\_ids := array\_append(winner\_user\_ids, selected\_tickets.user\_id);  
            winner\_ticket\_numbers := array\_append(winner\_ticket\_numbers, selected\_tickets.ticket\_number);  
        END IF;  
    END LOOP;  
      
    \-- Create winner records  
    FOR i IN 1..array\_length(winner\_user\_ids, 1\) LOOP  
        INSERT INTO public.winners (  
            competition\_id,  
            user\_id,  
            ticket\_number,  
            prize\_amount,  
            currency  
        ) VALUES (  
            p\_competition\_id,  
            winner\_user\_ids\[i\],  
            winner\_ticket\_numbers\[i\],  
            prize\_amount,  
            competition\_record.currency  
        );  
    END LOOP;  
      
    \-- Update competition status  
    UPDATE public.competitions   
    SET status \= 'drawn',  
        updated\_at \= NOW()  
    WHERE id \= p\_competition\_id;  
      
    RETURN QUERY SELECT winner\_user\_ids;  
END;  
$function$  
"  
public,enqueue\_cdp\_event,"event\_name text, payload jsonb","event\_name text, payload jsonb",uuid,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.enqueue\_cdp\_event(event\_name text, payload jsonb)  
 RETURNS uuid  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  v\_id uuid;  
begin  
  insert into public.cdp\_event\_queue(event\_name, payload)  
  values (event\_name, payload)  
  returning id into v\_id;

  return v\_id;  
end;  
$function$  
"  
public,ensure\_canonical\_user,"p\_email text, p\_wallet text","p\_email text, p\_wallet text",canonical\_users,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.ensure\_canonical\_user(p\_email text, p\_wallet text)  
 RETURNS canonical\_users  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_email text := NULLIF(trim(p\_email), '');  
  v\_wallet text := NULLIF(lower(trim(p\_wallet)), '');  
  v\_cid text;  
  v\_existing public.canonical\_users;  
  v\_pre     public.canonical\_users;  
BEGIN  
  IF v\_wallet IS NULL THEN  
    RAISE EXCEPTION 'wallet required';  
  END IF;  
  v\_cid := 'prize:pid:' || v\_wallet;

  \-- 1\) Try to find existing canonical by canonical\_user\_id or wallet variants  
  SELECT \* INTO v\_existing  
  FROM public.canonical\_users  
  WHERE canonical\_user\_id \= v\_cid  
     OR lower(wallet\_address) \= v\_wallet  
     OR lower(base\_wallet\_address) \= v\_wallet  
     OR lower(eth\_wallet\_address) \= v\_wallet  
  LIMIT 1;

  IF v\_existing.id IS NOT NULL THEN  
    \-- Merge optional email-only pre-row if provided and different  
    IF v\_email IS NOT NULL THEN  
      SELECT \* INTO v\_pre  
      FROM public.canonical\_users  
      WHERE lower(email) \= lower(v\_email)  
        AND id \<\> v\_existing.id  
        AND wallet\_address IS NULL  
      LIMIT 1;

      IF v\_pre.id IS NOT NULL THEN  
        \-- Move any profile fields from pre to existing (conservative: only fill NULLs)  
        UPDATE public.canonical\_users x SET  
          email \= COALESCE(x.email, v\_pre.email),  
          username \= COALESCE(x.username, v\_pre.username),  
          avatar\_url \= COALESCE(x.avatar\_url, v\_pre.avatar\_url),  
          country \= COALESCE(x.country, v\_pre.country),  
          first\_name \= COALESCE(x.first\_name, v\_pre.first\_name),  
          last\_name \= COALESCE(x.last\_name, v\_pre.last\_name),  
          telegram\_handle \= COALESCE(x.telegram\_handle, v\_pre.telegram\_handle),  
          updated\_at \= NOW()  
        WHERE x.id \= v\_existing.id;

        DELETE FROM public.canonical\_users WHERE id \= v\_pre.id;  
      END IF;  
    END IF;

    \-- Ensure canonical fields are set on existing  
    UPDATE public.canonical\_users SET  
      wallet\_address \= v\_wallet,  
      canonical\_user\_id \= v\_cid,  
      base\_wallet\_address \= COALESCE(base\_wallet\_address, v\_wallet),  
      eth\_wallet\_address \= COALESCE(eth\_wallet\_address, v\_wallet),  
      updated\_at \= NOW()  
    WHERE id \= v\_existing.id;

    SELECT \* INTO v\_existing FROM public.canonical\_users WHERE id \= v\_existing.id;  
    RETURN v\_existing;  
  END IF;

  \-- 2\) No existing canonical; try promote pre-row by email  
  IF v\_email IS NOT NULL THEN  
    SELECT \* INTO v\_pre FROM public.canonical\_users  
    WHERE lower(email) \= lower(v\_email)  
      AND wallet\_address IS NULL  
    LIMIT 1;

    IF v\_pre.id IS NOT NULL THEN  
      UPDATE public.canonical\_users SET  
        wallet\_address \= v\_wallet,  
        canonical\_user\_id \= v\_cid,  
        base\_wallet\_address \= COALESCE(base\_wallet\_address, v\_wallet),  
        eth\_wallet\_address \= COALESCE(eth\_wallet\_address, v\_wallet),  
        updated\_at \= NOW()  
      WHERE id \= v\_pre.id  
      RETURNING \* INTO v\_existing;

      RETURN v\_existing;  
    END IF;  
  END IF;

  \-- 3\) Create brand-new canonical row  
  INSERT INTO public.canonical\_users (  
    id,  
    canonical\_user\_id,  
    email,  
    wallet\_address,  
    base\_wallet\_address,  
    eth\_wallet\_address,  
    created\_at,  
    updated\_at  
  ) VALUES (  
    gen\_random\_uuid(),  
    v\_cid,  
    v\_email,  
    v\_wallet,  
    v\_wallet,  
    v\_wallet,  
    NOW(),  
    NOW()  
  ) RETURNING \* INTO v\_existing;

  RETURN v\_existing;  
EXCEPTION WHEN unique\_violation THEN  
  \-- In case of race, re-select deterministically  
  SELECT \* INTO v\_existing  
  FROM public.canonical\_users  
  WHERE canonical\_user\_id \= v\_cid  
     OR lower(wallet\_address) \= v\_wallet  
  LIMIT 1;  
  RETURN v\_existing;  
END;  
$function$  
"  
public,ensure\_canonical\_user,"p\_email text, p\_wallet\_address text, p\_base\_wallet\_address text, p\_eth\_wallet\_address text, p\_privy\_user\_id text, p\_username text, p\_avatar\_url text, p\_country text, p\_first\_name text, p\_last\_name text, p\_telegram\_handle text","p\_email text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_username text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text",canonical\_users,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.ensure\_canonical\_user(p\_email text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_username text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text)  
 RETURNS canonical\_users  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
declare  
  v\_email text := nullif(lower(trim(p\_email)), '');  
  v\_wallet text := nullif(lower(trim(p\_wallet\_address)), '');  
  v\_base\_wallet text := nullif(lower(trim(p\_base\_wallet\_address)), '');  
  v\_eth\_wallet text := nullif(lower(trim(p\_eth\_wallet\_address)), '');  
  v\_privy text := nullif(trim(p\_privy\_user\_id), '');  
  v\_username text := nullif(trim(p\_username), '');  
  v\_avatar text := nullif(trim(p\_avatar\_url), '');  
  v\_country text := nullif(trim(p\_country), '');  
  v\_first text := nullif(trim(p\_first\_name), '');  
  v\_last text := nullif(trim(p\_last\_name), '');  
  v\_tg text := nullif(trim(p\_telegram\_handle), '');  
  v\_found canonical\_users;  
  v\_cuid text;  
begin  
  \-- Try to find existing canonical user by strongest identifiers  
  select \* into v\_found from public.canonical\_users cu  
   where (v\_email is not null and cu.email \= v\_email)  
      or (v\_privy is not null and cu.privy\_user\_id \= v\_privy)  
      or (v\_wallet is not null and cu.wallet\_address \= v\_wallet)  
      or (v\_base\_wallet is not null and cu.base\_wallet\_address \= v\_base\_wallet)  
      or (v\_eth\_wallet is not null and cu.eth\_wallet\_address \= v\_eth\_wallet)  
  limit 1;

  if v\_found.id is not null then  
    \-- Merge non-null provided fields into the existing row  
    update public.canonical\_users cu set  
      email \= coalesce(v\_email, cu.email),  
      wallet\_address \= coalesce(v\_wallet, cu.wallet\_address),  
      base\_wallet\_address \= coalesce(v\_base\_wallet, cu.base\_wallet\_address),  
      eth\_wallet\_address \= coalesce(v\_eth\_wallet, cu.eth\_wallet\_address),  
      privy\_user\_id \= coalesce(v\_privy, cu.privy\_user\_id),  
      username \= coalesce(v\_username, cu.username),  
      avatar\_url \= coalesce(v\_avatar, cu.avatar\_url),  
      country \= coalesce(v\_country, cu.country),  
      first\_name \= coalesce(v\_first, cu.first\_name),  
      last\_name \= coalesce(v\_last, cu.last\_name),  
      telegram\_handle \= coalesce(v\_tg, cu.telegram\_handle),  
      updated\_at \= now()  
    where cu.id \= v\_found.id  
    returning \* into v\_found;

    return v\_found;  
  end if;

  \-- Build canonical\_user\_id deterministically if a wallet exists  
  if v\_wallet is not null then  
    v\_cuid := 'prize:pid:' || v\_wallet;  
  elsif v\_base\_wallet is not null then  
    v\_cuid := 'prize:pid:' || v\_base\_wallet;  
  elsif v\_eth\_wallet is not null then  
    v\_cuid := 'prize:pid:' || v\_eth\_wallet;  
  else  
    \-- No wallet: generate a placeholder canonical id using a generated uuid suffix  
    v\_cuid := 'prize:pid:' || lpad(replace(encode(gen\_random\_bytes(20), 'hex'), '\\n', ''), 42, '0');  
  end if;

  insert into public.canonical\_users (  
    canonical\_user\_id, uid, privy\_user\_id, email,  
    wallet\_address, base\_wallet\_address, eth\_wallet\_address,  
    username, avatar\_url, country, first\_name, last\_name, telegram\_handle  
  ) values (  
    v\_cuid, gen\_random\_uuid()::text, v\_privy, v\_email,  
    v\_wallet, v\_base\_wallet, v\_eth\_wallet,  
    v\_username, v\_avatar, v\_country, v\_first, v\_last, v\_tg  
  )  
  returning \* into v\_found;

  return v\_found;  
exception when unique\_violation then  
  \-- In case of race: re-select and merge  
  select \* into v\_found from public.canonical\_users cu  
   where (v\_email is not null and cu.email \= v\_email)  
      or (v\_privy is not null and cu.privy\_user\_id \= v\_privy)  
      or (v\_wallet is not null and cu.wallet\_address \= v\_wallet)  
      or (v\_base\_wallet is not null and cu.base\_wallet\_address \= v\_base\_wallet)  
      or (v\_eth\_wallet is not null and cu.eth\_wallet\_address \= v\_eth\_wallet)  
  limit 1;

  if v\_found.id is null then  
    raise; \-- bubble up if truly unexpected  
  end if;

  update public.canonical\_users cu set  
      email \= coalesce(v\_email, cu.email),  
      wallet\_address \= coalesce(v\_wallet, cu.wallet\_address),  
      base\_wallet\_address \= coalesce(v\_base\_wallet, cu.base\_wallet\_address),  
      eth\_wallet\_address \= coalesce(v\_eth\_wallet, cu.eth\_wallet\_address),  
      privy\_user\_id \= coalesce(v\_privy, cu.privy\_user\_id),  
      username \= coalesce(v\_username, cu.username),  
      avatar\_url \= coalesce(v\_avatar, cu.avatar\_url),  
      country \= coalesce(v\_country, cu.country),  
      first\_name \= coalesce(v\_first, cu.first\_name),  
      last\_name \= coalesce(v\_last, cu.last\_name),  
      telegram\_handle \= coalesce(v\_tg, cu.telegram\_handle),  
      updated\_at \= now()  
    where cu.id \= v\_found.id  
    returning \* into v\_found;

  return v\_found;  
end;  
$function$  
"  
public,ensure\_index,sql text,sql text,void,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.ensure\_index(sql text)  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  \-- Only allow CREATE INDEX statements  
  IF position('CREATE INDEX' in upper(sql)) \= 0 THEN  
    RAISE EXCEPTION 'Only CREATE INDEX statements are allowed';  
  END IF;  
  EXECUTE sql;  
END;  
$function$  
"  
public,ensure\_pending\_tickets,,,void,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.ensure\_pending\_tickets()  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  \-- Create table if missing  
  EXECUTE '  
  CREATE TABLE IF NOT EXISTS public.pending\_tickets (  
    id UUID NOT NULL DEFAULT gen\_random\_uuid(),  
    user\_id UUID NOT NULL,  
    competition\_id UUID NOT NULL,  
    ticket\_number INTEGER NOT NULL,  
    status TEXT NOT NULL,  
    expires\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
    created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
    PRIMARY KEY (id)  
  );';

  \-- Index: competition\_id \+ status (partial)  
  EXECUTE '  
  CREATE INDEX IF NOT EXISTS idx\_pending\_tickets\_competition\_status  
    ON public.pending\_tickets (competition\_id, status)  
    WHERE status IN (''pending'', ''confirming'');';

  \-- Index: expires\_at (partial)  
  EXECUTE '  
  CREATE INDEX IF NOT EXISTS idx\_pending\_tickets\_expires\_at  
    ON public.pending\_tickets (expires\_at)  
    WHERE expires\_at \> now();';

  \-- Index: user\_id \+ competition\_id  
  EXECUTE '  
  CREATE INDEX IF NOT EXISTS idx\_pending\_tickets\_user\_competition  
    ON public.pending\_tickets (user\_id, competition\_id);';  
END;  
$function$  
"  
public,ensure\_sub\_account\_balance\_row,"p\_canonical text, p\_currency text","p\_canonical text, p\_currency text",uuid,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.ensure\_sub\_account\_balance\_row(p\_canonical text, p\_currency text)  
 RETURNS uuid  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_id uuid;  
BEGIN  
  SELECT id INTO v\_id  
  FROM public.sub\_account\_balances  
  WHERE canonical\_user\_id \= p\_canonical  
    AND currency \= p\_currency  
  LIMIT 1;

  IF v\_id IS NULL THEN  
    INSERT INTO public.sub\_account\_balances  
      (id, user\_id, currency, available\_balance, pending\_balance, last\_updated, canonical\_user\_id)  
    VALUES  
      (gen\_random\_uuid(), NULL, p\_currency, 0, 0, NOW(), p\_canonical)  
    RETURNING id INTO v\_id;  
  END IF;

  RETURN v\_id;  
END;  
$function$  
"  
public,enter\_competition,"p\_canonical\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_price numeric","p\_canonical\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_price numeric",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.enter\_competition(p\_canonical\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_price numeric)  
 RETURNS TABLE(ticket\_id uuid, ticket\_number integer, new\_balance numeric)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  v\_cost numeric := (coalesce(cardinality(p\_ticket\_numbers),0) \* p\_price);  
  v\_balance\_before numeric;  
  v\_balance\_after numeric;  
  v\_now timestamptz := now();  
  v\_ticket\_id uuid;  
  v\_comp\_total int;  
  v\_comp\_sold int;  
begin  
  if cardinality(p\_ticket\_numbers) \= 0 then  
    raise exception 'No tickets provided';  
  end if;

  \-- lock balance row for this canonical user  
  update public.sub\_account\_balances sab  
    set last\_updated \= v\_now  
  where sab.canonical\_user\_id \= p\_canonical\_user\_id  
  returning sab.available\_balance into v\_balance\_before;

  if not found then  
    raise exception 'Balance not found for %', p\_canonical\_user\_id;  
  end if;

  if v\_balance\_before is null or v\_balance\_before \< v\_cost then  
    raise exception 'Insufficient balance. Need %, have %', v\_cost, v\_balance\_before;  
  end if;

  \-- reserve or sell tickets atomically  
  foreach ticket\_number in array p\_ticket\_numbers loop  
    \-- prevent double sell; prefer updating existing row if present  
    update public.tickets t  
      set status \= 'sold',  
          purchased\_at \= v\_now,  
          purchase\_date \= v\_now,  
          payment\_amount \= p\_price,  
          is\_active \= true  
    where t.competition\_id \= p\_competition\_id  
      and t.ticket\_number \= ticket\_number  
      and t.status \<\> 'sold'  
    returning t.id into v\_ticket\_id;

    if not found then  
      raise exception 'Ticket % is not available', ticket\_number;  
    end if;

    v\_balance\_before := v\_balance\_before \- p\_price;

    \-- return row per ticket  
    v\_balance\_after := v\_balance\_before;  
    ticket\_id := v\_ticket\_id;  
    ticket\_number := ticket\_number;  
    new\_balance := v\_balance\_after;  
    return next;  
  end loop;

  \-- deduct balance once (already decremented per loop in v\_balance\_before)  
  update public.sub\_account\_balances sab  
    set available\_balance \= v\_balance\_after,  
        last\_updated \= v\_now  
  where sab.canonical\_user\_id \= p\_canonical\_user\_id;

  \-- ledger  
  insert into public.user\_transactions(  
    user\_id, canonical\_user\_id, type, amount, currency, balance\_before, balance\_after,  
    competition\_id, description, status, created\_at, metadata  
  ) values (  
    null, p\_canonical\_user\_id, 'debit', v\_cost, 'USDC', v\_balance\_after \+ v\_cost, v\_balance\_after,  
    p\_competition\_id, 'Competition entry', 'completed', v\_now,  
    jsonb\_build\_object('tickets', p\_ticket\_numbers)  
  );

  \-- sync denormalized counter from tickets table  
  select count(\*)::int into v\_comp\_sold  
  from public.tickets t  
  where t.competition\_id \= p\_competition\_id and t.status \= 'sold' and t.is\_active \= true;

  update public.competitions c  
  set tickets\_sold \= v\_comp\_sold, updated\_at \= v\_now  
  where c.id \= p\_competition\_id;

end;  
$function$  
"  
public,enter\_competition\_and\_deduct,"p\_competition\_id uuid, p\_canonical\_user\_id text, p\_quantity integer","p\_competition\_id uuid, p\_canonical\_user\_id text, p\_quantity integer",record,plpgsql,true,v,false,true,"Sub-account ONLY purchase. Atomically assigns tickets and deducts from sub\_account\_balances.available\_balance. Inputs: p\_competition\_id, p\_canonical\_user\_id, p\_quantity. Returns sold\_count, charged\_amount, new\_balance, ticket\_numbers.","CREATE OR REPLACE FUNCTION public.enter\_competition\_and\_deduct(p\_competition\_id uuid, p\_canonical\_user\_id text, p\_quantity integer)  
 RETURNS TABLE(sold\_count integer, charged\_amount numeric, new\_balance numeric, ticket\_numbers integer\[\])  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$DECLARE  
  v\_competition\_id uuid := p\_competition\_id::uuid;  
  v\_price numeric;  
  v\_balance numeric;  
  v\_now timestamptz := now();  
  v\_assigned int\[\] := '{}';  
  v\_sold int := 0;  
  v\_balance\_id uuid;  
BEGIN  
  \-- Validate inputs  
  if p\_quantity \<= 0 then  
    raise exception 'invalid\_quantity' using errcode \= '22023';  
  end if;  
  if position('prize:pid:0x' in lower(p\_canonical\_user\_id)) \<\> 1 then  
    raise exception 'invalid\_canonical\_user\_id, expected prize:pid:0x…' using errcode \= '22023';  
  end if;

  \-- Get price & lock competition row  
  select ticket\_price into v\_price from public.competitions where id \= p\_competition\_id for update;  
  if v\_price is null then  
    raise exception 'competition\_not\_found' using errcode \= '22023';  
  end if;

  \-- Lock the exact sub-account balance row by canonical\_user\_id (USD only)  
  select id, available\_balance into v\_balance\_id, v\_balance  
  from public.sub\_account\_balances  
  where canonical\_user\_id \= p\_canonical\_user\_id and currency \= 'USD'  
  for update;

  if v\_balance\_id is null then  
    raise exception 'sub\_account\_not\_found' using errcode \= '22023';  
  end if;

  if coalesce(v\_balance,0) \< (v\_price \* p\_quantity) then  
    raise exception 'insufficient\_balance' using errcode \= '22023';  
  end if;

  \-- Compute available ticket numbers (exclude sold \+ active holds)  
  v\_assigned := array(  
    with unavail as (  
      select t.ticket\_number  
      from public.tickets t  
      where t.competition\_id \= p\_competition\_id  
        and t.is\_active \= true  
        and t.status \= 'sold'  
      union  
      select h.ticket\_number  
      from public.pending\_ticket\_items h  
      where h.competition\_id \= p\_competition\_id  
        and h.status \= 'pending'  
        and (h.expires\_at is null or h.expires\_at \> v\_now)  
    ), all\_nums as (  
      select generate\_series(1, (select c.total\_tickets from public.competitions c where c.id \= p\_competition\_id))::int as n  
    )  
    select n from all\_nums a  
    where not exists (select 1 from unavail u where u.ticket\_number \= a.n)  
    order by n  
    limit p\_quantity  
  );

  if coalesce(array\_length(v\_assigned,1),0) \< p\_quantity then  
    raise exception 'no\_available\_tickets' using errcode \= '22023';  
  end if;

  \-- Insert sold tickets with correct canonical\_user\_id and purchase\_price  
  insert into public.tickets (  
    competition\_id, ticket\_number, status, is\_active, purchased\_at, purchase\_price, canonical\_user\_id  
  )  
  select p\_competition\_id, unnest(v\_assigned), 'sold', true, v\_now, v\_price, p\_canonical\_user\_id;

  v\_sold := coalesce(array\_length(v\_assigned,1),0);

  \-- Deduct balance atomically  
  update public.sub\_account\_balances  
  set available\_balance \= coalesce(available\_balance,0) \- (v\_price \* v\_sold),  
      last\_updated \= v\_now  
  where id \= v\_balance\_id  
  returning available\_balance into v\_balance;

  \-- Update sold counter  
  update public.competitions  
  set tickets\_sold \= coalesce(tickets\_sold,0) \+ v\_sold,  
      updated\_at \= v\_now  
  where id \= p\_competition\_id;

  return query select v\_sold::int, (v\_price \* v\_sold)::numeric, v\_balance::numeric, v\_assigned;  
END;$function$  
"  
public,exec\_sql,sql\_query text,sql\_query text,json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.exec\_sql(sql\_query text)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE result JSON;  
BEGIN  
  EXECUTE sql\_query;  
  RETURN json\_build\_object('success', true, 'message', 'SQL executed successfully');  
EXCEPTION WHEN OTHERS THEN  
  RETURN json\_build\_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);  
END;  
$function$  
"  
public,execute\_balance\_payment,"p\_amount numeric, p\_competition\_id uuid, p\_idempotency\_key text, p\_reservation\_id uuid, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_user\_identifier text","p\_amount numeric, p\_competition\_id uuid, p\_idempotency\_key text, p\_reservation\_id uuid, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_user\_identifier text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.execute\_balance\_payment(p\_amount numeric, p\_competition\_id uuid, p\_idempotency\_key text, p\_reservation\_id uuid, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_user\_identifier text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user\_canonical\_id text;  
  v\_currency text := 'USD';  
  v\_balance\_before numeric;  
  v\_balance\_after numeric;  
  v\_sub\_balance\_id uuid;  
  v\_existing jsonb;  
  v\_result jsonb := '{}'::jsonb;  
  v\_pending record;  
  v\_ticket\_price numeric;  
  v\_csv\_existing text;  
  v\_now timestamptz := now();  
  v\_join\_id uuid;  
  v\_ticket int;  
BEGIN  
  \-- Idempotency check  
  SELECT result INTO v\_existing  
  FROM public.payment\_idempotency  
  WHERE idempotency\_key \= p\_idempotency\_key;  
  IF FOUND AND v\_existing IS NOT NULL THEN  
    RETURN v\_existing || jsonb\_build\_object('idempotent', true);  
  END IF;

  \-- Resolve canonical user id from provided identifier  
  IF p\_user\_identifier \~ '^prize:pid:0x\[a-f0-9\]{40}$' THEN  
    v\_user\_canonical\_id := p\_user\_identifier;  
  ELSE  
    SELECT canonical\_user\_id INTO v\_user\_canonical\_id  
    FROM public.canonical\_users  
    WHERE primary\_wallet\_address \= p\_user\_identifier  
       OR wallet\_address \= p\_user\_identifier  
       OR email \= p\_user\_identifier  
       OR uid \= p\_user\_identifier  
    ORDER BY created\_at DESC  
    LIMIT 1;  
  END IF;  
  IF v\_user\_canonical\_id IS NULL THEN  
    RAISE EXCEPTION 'Could not resolve user from identifier %', p\_user\_identifier USING ERRCODE \= '22023';  
  END IF;

  \-- Load and lock reservation  
  SELECT \* INTO v\_pending  
  FROM public.pending\_tickets  
  WHERE reservation\_id \= p\_reservation\_id  
    AND competition\_id \= p\_competition\_id  
    AND (canonical\_user\_id \= v\_user\_canonical\_id OR canonical\_user\_id IS NULL)  
    AND status IN ('pending','confirming')  
  FOR UPDATE;  
  IF NOT FOUND THEN  
    RAISE EXCEPTION 'Valid pending reservation not found (reservation %, competition %, user %)', p\_reservation\_id, p\_competition\_id, v\_user\_canonical\_id;  
  END IF;

  \-- Validate counts, tickets, amount  
  IF v\_pending.ticket\_count IS DISTINCT FROM p\_ticket\_count THEN  
    RAISE EXCEPTION 'ticket\_count mismatch: pending %, got %', v\_pending.ticket\_count, p\_ticket\_count;  
  END IF;  
  IF v\_pending.ticket\_numbers IS DISTINCT FROM p\_selected\_tickets THEN  
    RAISE EXCEPTION 'selected\_tickets mismatch';  
  END IF;  
  v\_ticket\_price := COALESCE(v\_pending.ticket\_price, (SELECT ticket\_price FROM public.competitions WHERE id \= p\_competition\_id));  
  IF v\_ticket\_price IS NULL THEN  
    RAISE EXCEPTION 'ticket\_price not found for competition %', p\_competition\_id;  
  END IF;  
  IF COALESCE(v\_pending.total\_amount, v\_ticket\_price \* p\_ticket\_count) \<\> p\_amount THEN  
    RAISE EXCEPTION 'amount mismatch: expected %, got %', COALESCE(v\_pending.total\_amount, v\_ticket\_price \* p\_ticket\_count), p\_amount;  
  END IF;

  \-- Lock sub\_account\_balance row for update  
  SELECT id, available\_balance INTO v\_sub\_balance\_id, v\_balance\_before  
  FROM public.sub\_account\_balances  
  WHERE canonical\_user\_id \= v\_user\_canonical\_id AND currency \= v\_currency  
  FOR UPDATE;  
  IF v\_sub\_balance\_id IS NULL THEN  
    RAISE EXCEPTION 'Balance account not found for % in %', v\_user\_canonical\_id, v\_currency USING ERRCODE \= '22023';  
  END IF;  
  IF COALESCE(v\_balance\_before,0) \< p\_amount THEN  
    RAISE EXCEPTION 'Insufficient balance: have %, need %', v\_balance\_before, p\_amount USING ERRCODE \= '22023';  
  END IF;

  \-- Deduct balance  
  UPDATE public.sub\_account\_balances  
  SET available\_balance \= available\_balance \- p\_amount,  
      last\_updated \= v\_now  
  WHERE id \= v\_sub\_balance\_id;  
  SELECT available\_balance INTO v\_balance\_after FROM public.sub\_account\_balances WHERE id \= v\_sub\_balance\_id;

  \-- Insert ledger entry as ""entry""  
  INSERT INTO public.balance\_ledger (  
    id, canonical\_user\_id, transaction\_type, amount, currency, balance\_before, balance\_after, reference\_id, description, created\_at  
  ) VALUES (  
    gen\_random\_uuid(), v\_user\_canonical\_id, 'entry', p\_amount, v\_currency, v\_balance\_before, v\_balance\_after, p\_idempotency\_key,  
    'Execute balance payment', v\_now  
  );

  \-- Confirm reservation  
  UPDATE public.pending\_tickets  
  SET status \= 'confirmed', confirmed\_at \= v\_now, updated\_at \= v\_now, idempotency\_key \= COALESCE(v\_pending.idempotency\_key, p\_idempotency\_key), canonical\_user\_id \= COALESCE(v\_pending.canonical\_user\_id, v\_user\_canonical\_id)  
  WHERE id \= v\_pending.id;

  \-- Allocate tickets  
  FOREACH v\_ticket IN ARRAY p\_selected\_tickets LOOP  
    INSERT INTO public.tickets (id, competition\_id, ticket\_number, status, purchased\_at, user\_id, canonical\_user\_id, purchase\_price)  
    VALUES (gen\_random\_uuid(), p\_competition\_id, v\_ticket, 'sold', v\_now, NULL, v\_user\_canonical\_id, v\_ticket\_price)  
    ON CONFLICT (competition\_id, ticket\_number) DO UPDATE  
      SET status \= 'sold', purchased\_at \= EXCLUDED.purchased\_at, canonical\_user\_id \= EXCLUDED.canonical\_user\_id, purchase\_price \= EXCLUDED.purchase\_price;  
  END LOOP;

  \-- Upsert joincompetition row for aggregation  
  SELECT id INTO v\_join\_id FROM public.joincompetition  
  WHERE canonical\_user\_id \= v\_user\_canonical\_id AND competitionid \= p\_competition\_id  
  LIMIT 1;

  IF v\_join\_id IS NULL THEN  
    INSERT INTO public.joincompetition (id, userid, wallet\_address, competitionid, ticketnumbers, purchasedate, status, created\_at, numberoftickets, amountspent, canonical\_user\_id)  
    VALUES (gen\_random\_uuid(), NULL, NULL, p\_competition\_id, array\_to\_string(p\_selected\_tickets, ','), v\_now, 'active', v\_now, p\_ticket\_count, p\_amount, v\_user\_canonical\_id);  
  ELSE  
    SELECT ticketnumbers INTO v\_csv\_existing FROM public.joincompetition WHERE id \= v\_join\_id;  
    UPDATE public.joincompetition  
    SET numberoftickets \= COALESCE(numberoftickets,0) \+ p\_ticket\_count,  
        amountspent \= COALESCE(amountspent,0) \+ p\_amount,  
        ticketnumbers \= CASE WHEN v\_csv\_existing IS NULL OR v\_csv\_existing \= '' THEN array\_to\_string(p\_selected\_tickets, ',') ELSE v\_csv\_existing || ',' || array\_to\_string(p\_selected\_tickets, ',') END,  
        purchasedate \= v\_now,  
        updated\_at \= v\_now  
    WHERE id \= v\_join\_id;  
  END IF;

  \-- Assemble result  
  v\_result := jsonb\_build\_object(  
    'status', 'success',  
    'reservation\_id', p\_reservation\_id,  
    'competition\_id', p\_competition\_id,  
    'ticket\_count', p\_ticket\_count,  
    'selected\_tickets', COALESCE(to\_jsonb(p\_selected\_tickets), '\[\]'::jsonb),  
    'amount', p\_amount,  
    'currency', v\_currency,  
    'user', v\_user\_canonical\_id,  
    'balance\_after', v\_balance\_after  
  );

  INSERT INTO public.payment\_idempotency (id, idempotency\_key, user\_id, competition\_id, amount, ticket\_count, result, canonical\_user\_id)  
  VALUES (gen\_random\_uuid(), p\_idempotency\_key, p\_user\_identifier, p\_competition\_id, p\_amount, p\_ticket\_count, v\_result, v\_user\_canonical\_id)  
  ON CONFLICT (idempotency\_key) DO UPDATE SET result \= EXCLUDED.result;

  RETURN v\_result;  
EXCEPTION WHEN others THEN  
  v\_result := jsonb\_build\_object('status','error','message', SQLERRM, 'code', SQLSTATE);  
  INSERT INTO public.payment\_idempotency (id, idempotency\_key, user\_id, competition\_id, amount, ticket\_count, result, canonical\_user\_id)  
  VALUES (gen\_random\_uuid(), p\_idempotency\_key, p\_user\_identifier, p\_competition\_id, p\_amount, p\_ticket\_count, v\_result, v\_user\_canonical\_id)  
  ON CONFLICT (idempotency\_key) DO UPDATE SET result \= EXCLUDED.result;  
  RAISE;  
END;  
$function$  
"  
public,execute\_balance\_payment\_force,"p\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_ticket\_count integer, p\_selected\_tickets integer\[\], p\_idempotency\_key text","p\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_ticket\_count integer, p\_selected\_tickets integer\[\] DEFAULT NULL::integer\[\], p\_idempotency\_key text DEFAULT NULL::text",jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.execute\_balance\_payment\_force(p\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_ticket\_count integer, p\_selected\_tickets integer\[\] DEFAULT NULL::integer\[\], p\_idempotency\_key text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$declare  
  v\_selected int\[\] := coalesce(p\_selected\_tickets, '{}'::int\[\]);  
  v\_need int := case  
                  when array\_length(v\_selected,1) is null or array\_length(v\_selected,1) \= 0  
                    then greatest(coalesce(p\_ticket\_count,0),0)  
                  else array\_length(v\_selected,1)  
                end;  
  v\_claimed int\[\] := '{}'::int\[\];  
  v\_price numeric;  
  v\_expected numeric;  
  v\_err text;  
begin  
  \-- basic price lookup; adapt table/column as needed  
  select price into v\_price  
  from public.joincompetition  
  where id \= p\_competition\_id  
  for update;  
  if v\_price is null then  
    return jsonb\_build\_object('success', false, 'error', 'competition\_not\_found');  
  end if;

  v\_expected := v\_price \* v\_need;  
  if p\_amount is not null and p\_amount \<\> v\_expected then  
    return jsonb\_build\_object('success', false, 'error', 'amount\_mismatch', 'expected', v\_expected);  
  end if;

  \-- idempotency short-circuit  
  if p\_idempotency\_key is not null and exists (  
    select 1 from public.tickets where competition\_id \= p\_competition\_id and user\_id \= p\_user\_id  
      and idempotency\_key \= p\_idempotency\_key  
  ) then  
    return jsonb\_build\_object('success', true, 'idempotent', true);  
  end if;

  perform pg\_advisory\_xact\_lock(hashtext(p\_competition\_id::text));

  if v\_need \<= 0 then  
    return jsonb\_build\_object('success', false, 'error', 'no\_tickets\_requested');  
  end if;

  \-- ensure helper columns exist; if not, remove them or adjust  
  \-- pending\_tickets: (competition\_id uuid, ticket\_number int, user\_id text, idempotency\_key text)  
  \-- tickets: (competition\_id uuid, ticket\_number int, user\_id text, idempotency\_key text)

  \-- clear any stale pending rows for same idempotency\_key (retry safety)  
  if p\_idempotency\_key is not null then  
    delete from public.pending\_tickets  
    where competition\_id \= p\_competition\_id  
      and user\_id \= p\_user\_id  
      and idempotency\_key \= p\_idempotency\_key;  
  end if;

  if array\_length(v\_selected,1) is not null and array\_length(v\_selected,1) \> 0 then  
    \-- claim requested numbers  
    insert into public.pending\_tickets (competition\_id, ticket\_number, user\_id, idempotency\_key)  
    select p\_competition\_id, tnum, p\_user\_id, p\_idempotency\_key  
    from unnest(v\_selected) as tnum  
    where not exists (  
      select 1 from public.tickets t  
      where t.competition\_id \= p\_competition\_id and t.ticket\_number \= tnum  
    )  
    and not exists (  
      select 1 from public.pending\_tickets p  
      where p.competition\_id \= p\_competition\_id and p.ticket\_number \= tnum  
    )  
    on conflict do nothing;

    select coalesce(array\_agg(ticket\_number order by ticket\_number), '{}'::int\[\])  
    into v\_claimed  
    from public.pending\_tickets  
    where competition\_id \= p\_competition\_id  
      and user\_id \= p\_user\_id  
      and idempotency\_key \= p\_idempotency\_key;

    if array\_length(v\_claimed,1) \< v\_need then  
      delete from public.pending\_tickets  
      where competition\_id \= p\_competition\_id  
        and user\_id \= p\_user\_id  
        and idempotency\_key \= p\_idempotency\_key;  
      return jsonb\_build\_object('success', false, 'error', 'tickets\_unavailable', 'claimed', v\_claimed);  
    end if;  
  else  
    \-- allocate next available numbers  
    with next\_numbers as (  
      select n as ticket\_number  
      from generate\_series(1, 1000000\) g(n)  
      where not exists (  
        select 1 from public.tickets t  
        where t.competition\_id \= p\_competition\_id and t.ticket\_number \= g.n  
      )  
      and not exists (  
        select 1 from public.pending\_tickets p  
        where p.competition\_id \= p\_competition\_id and p.ticket\_number \= g.n  
      )  
      limit v\_need  
    ), ins as (  
      insert into public.pending\_tickets (competition\_id, ticket\_number, user\_id, idempotency\_key)  
      select p\_competition\_id, ticket\_number, p\_user\_id, p\_idempotency\_key from next\_numbers  
      on conflict do nothing  
      returning ticket\_number  
    )  
    select coalesce(array\_agg(ticket\_number order by ticket\_number), '{}'::int\[\])  
    into v\_claimed  
    from ins;

    if array\_length(v\_claimed,1) \< v\_need then  
      delete from public.pending\_tickets  
      where competition\_id \= p\_competition\_id  
        and user\_id \= p\_user\_id  
        and idempotency\_key \= p\_idempotency\_key;  
      return jsonb\_build\_object('success', false, 'error', 'insufficient\_available\_tickets', 'claimed', v\_claimed);  
    end if;  
  end if;

  \-- finalize into tickets  
  insert into public.tickets (competition\_id, ticket\_number, user\_id, idempotency\_key)  
  select competition\_id, ticket\_number, user\_id, p\_idempotency\_key  
  from public.pending\_tickets  
  where competition\_id \= p\_competition\_id  
    and user\_id \= p\_user\_id  
    and idempotency\_key \= p\_idempotency\_key  
  on conflict do nothing;

  delete from public.pending\_tickets  
  where competition\_id \= p\_competition\_id  
    and user\_id \= p\_user\_id  
    and idempotency\_key \= p\_idempotency\_key;

  return jsonb\_build\_object(  
    'success', true,  
    'tickets', v\_claimed,  
    'amount', v\_expected  
  );  
exception when others then  
  get stacked diagnostics v\_err \= message\_text;  
  return jsonb\_build\_object('success', false, 'error', v\_err);  
end;$function$  
"  
public,expire\_hold\_if\_needed,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.expire\_hold\_if\_needed()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.expires\_at \<= now() AND NEW.status \= 'pending' THEN  
    NEW.status := 'expired';  
  END IF;  
  RETURN NEW;  
END $function$  
"  
public,expire\_overdue\_pending\_tickets,,,int4,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.expire\_overdue\_pending\_tickets()  
 RETURNS integer  
 LANGUAGE plpgsql  
AS $function$  
DECLARE v\_now timestamptz := now(); v\_cnt int; BEGIN  
  UPDATE public.pending\_tickets pt  
  SET status \= 'expired', updated\_at \= v\_now,  
      note \= CONCAT(COALESCE(pt.note,''), CASE WHEN COALESCE(pt.note,'')='' THEN '' ELSE ' | ' END,  
                    'auto-expired at ', to\_char(v\_now, 'YYYY-MM-DD HH24:MI:SS TZ'))  
  WHERE pt.status \= 'pending' AND pt.expires\_at IS NOT NULL AND v\_now \> pt.expires\_at;  
  GET DIAGNOSTICS v\_cnt \= ROW\_COUNT;  
  RETURN v\_cnt;  
END; $function$  
"  
public,finalize\_order,"p\_reservation\_id uuid, p\_user\_id text, p\_competition\_id uuid, p\_unit\_price numeric","p\_reservation\_id uuid, p\_user\_id text, p\_competition\_id uuid, p\_unit\_price numeric",jsonb,plpgsql,true,v,false,false,Atomic checkout: deducts balance and finalizes ticket purchase for a pending reservation.,"CREATE OR REPLACE FUNCTION public.finalize\_order(p\_reservation\_id uuid, p\_user\_id text, p\_competition\_id uuid, p\_unit\_price numeric)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_reservation RECORD;  
  v\_reservation\_status TEXT;  
  v\_total\_amount NUMERIC;  
  v\_user\_balance NUMERIC;  
  v\_order\_id UUID;  
  v\_transaction\_id UUID;  
  v\_ticket\_num INTEGER;  
  v\_canonical\_user\_id TEXT;  
  v\_wallet\_address TEXT;  
  v\_found\_canonical\_user\_id TEXT;  
BEGIN  
  \-- 1\) Lock and fetch the pending reservation  
  SELECT \* INTO v\_reservation  
  FROM public.pending\_tickets  
  WHERE id \= p\_reservation\_id  
  FOR UPDATE SKIP LOCKED;

  IF v\_reservation IS NULL THEN  
    SELECT status INTO v\_reservation\_status  
    FROM public.pending\_tickets  
    WHERE id \= p\_reservation\_id;

    IF v\_reservation\_status \= 'confirmed' THEN  
      RETURN jsonb\_build\_object('success', true, 'message', 'Order already finalized', 'already\_confirmed', true, 'reservation\_id', p\_reservation\_id);  
    END IF;

    RETURN jsonb\_build\_object('success', false, 'error', 'Reservation not found or locked by another process');  
  END IF;

  IF v\_reservation.status \= 'confirmed' THEN  
    RETURN jsonb\_build\_object('success', true, 'message', 'Order already finalized', 'already\_confirmed', true, 'reservation\_id', p\_reservation\_id);  
  END IF;

  IF v\_reservation.status \<\> 'pending' THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Reservation status is ' || v\_reservation.status || ', cannot finalize');  
  END IF;

  IF v\_reservation.expires\_at \< NOW() THEN  
    UPDATE public.pending\_tickets  
    SET status \= 'expired', updated\_at \= NOW()  
    WHERE id \= p\_reservation\_id;

    RETURN jsonb\_build\_object('success', false, 'error', 'Reservation has expired');  
  END IF;

  \-- 2\) Compute total amount  
  v\_total\_amount := p\_unit\_price \* array\_length(v\_reservation.ticket\_numbers, 1);  
  IF v\_total\_amount IS NULL OR v\_total\_amount \<= 0 THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Invalid total amount calculated');  
  END IF;

  \-- 3\) Normalize user identifiers  
  IF p\_user\_id LIKE 'prize:pid:0x%' THEN  
    v\_canonical\_user\_id := p\_user\_id;  
    v\_wallet\_address := LOWER(SUBSTRING(p\_user\_id FROM 11));  
  ELSIF p\_user\_id LIKE '0x%' AND LENGTH(p\_user\_id) \= 42 THEN  
    v\_wallet\_address := LOWER(p\_user\_id);  
    v\_canonical\_user\_id := 'prize:pid:' || v\_wallet\_address;  
  ELSE  
    \-- Assume canonical id if it matches pattern, else treat as wallet address  
    IF p\_user\_id \~ '^prize:pid:0x\[a-f0-9\]{40}$' THEN  
      v\_canonical\_user\_id := p\_user\_id;  
      v\_wallet\_address := LOWER(SUBSTRING(p\_user\_id FROM 11));  
    ELSE  
      v\_wallet\_address := LOWER(p\_user\_id);  
      v\_canonical\_user\_id := 'prize:pid:' || v\_wallet\_address;  
    END IF;  
  END IF;

  \-- 4\) Fetch balance from canonical\_users using canonical\_user\_id or wallets  
  SELECT cu.canonical\_user\_id, cu.usdc\_balance  
    INTO v\_found\_canonical\_user\_id, v\_user\_balance  
  FROM public.canonical\_users cu  
  WHERE cu.canonical\_user\_id \= v\_canonical\_user\_id  
     OR LOWER(cu.wallet\_address) \= v\_wallet\_address  
     OR LOWER(cu.base\_wallet\_address) \= v\_wallet\_address  
     OR LOWER(cu.eth\_wallet\_address) \= v\_wallet\_address  
  LIMIT 1;

  IF v\_found\_canonical\_user\_id IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'User not found');  
  END IF;

  IF v\_user\_balance \< v\_total\_amount THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Insufficient balance', 'balance', v\_user\_balance, 'required', v\_total\_amount);  
  END IF;

  \-- 5\) Deduct balance  
  UPDATE public.canonical\_users  
  SET usdc\_balance \= usdc\_balance \- v\_total\_amount,  
      updated\_at \= NOW()  
  WHERE canonical\_user\_id \= v\_found\_canonical\_user\_id;

  \-- 6\) Create order (UUID FK)  
  v\_order\_id := gen\_random\_uuid();  
  INSERT INTO public.orders (  
    id,  
    user\_id,  
    competition\_id,  
    ticket\_count,  
    amount\_usd,  
    payment\_status,  
    payment\_method,  
    order\_type,  
    created\_at,  
    updated\_at,  
    status  
  ) VALUES (  
    v\_order\_id,  
    v\_found\_canonical\_user\_id,  
    p\_competition\_id,  
    array\_length(v\_reservation.ticket\_numbers, 1),  
    v\_total\_amount,  
    'completed',  
    'balance',  
    'competition\_purchase',  
    NOW(),  
    NOW(),  
    'completed'  
  );

  \-- 7\) Insert order\_tickets as TEXT ticket\_number  
  FOREACH v\_ticket\_num IN ARRAY v\_reservation.ticket\_numbers LOOP  
    INSERT INTO public.order\_tickets (order\_id, ticket\_number, created\_at)  
    VALUES (v\_order\_id, v\_ticket\_num::text, NOW());  
  END LOOP;

  \-- 8\) Insert tickets with proper UUID FK and INT ticket\_number  
  FOREACH v\_ticket\_num IN ARRAY v\_reservation.ticket\_numbers LOOP  
    INSERT INTO public.tickets (  
      id,  
      competition\_id,  
      ticket\_number,  
      status,  
      user\_id,  
      purchased\_at,  
      order\_id,  
      created\_at,  
      canonical\_user\_id,  
      wallet\_address,  
      purchase\_price,  
      payment\_amount,  
      payment\_provider,  
      payment\_tx\_hash,  
      purchase\_date  
    ) VALUES (  
      gen\_random\_uuid(),  
      p\_competition\_id,  
      v\_ticket\_num,  
      'sold',  
      v\_found\_canonical\_user\_id,  
      NOW(),  
      v\_order\_id,  
      NOW(),  
      v\_found\_canonical\_user\_id,  
      v\_wallet\_address,  
      p\_unit\_price,  
      v\_total\_amount,          \-- per row could be per ticket; keeping total is acceptable if you also keep purchase\_price per ticket  
      'balance',  
      'balance\_payment\_' || v\_order\_id::text,  
      NOW()  
    )  
    ON CONFLICT DO NOTHING; \-- Consider a unique index if needed  
  END LOOP;

  \-- 9\) Insert user\_transactions  
  v\_transaction\_id := gen\_random\_uuid();  
  INSERT INTO public.user\_transactions (  
    id,  
    user\_id,  
    canonical\_user\_id,  
    wallet\_address,  
    type,  
    amount,  
    currency,  
    balance\_before,  
    balance\_after,  
    competition\_id,  
    order\_id,  
    description,  
    status,  
    payment\_status,  
    ticket\_count,  
    created\_at,  
    updated\_at,  
    completed\_at,  
    payment\_provider,  
    tx\_id  
  ) VALUES (  
    v\_transaction\_id,  
    v\_found\_canonical\_user\_id,  
    v\_found\_canonical\_user\_id,  
    v\_wallet\_address,  
    'entry',  
    v\_total\_amount,  
    'USDC',  
    v\_user\_balance,  
    v\_user\_balance \- v\_total\_amount,  
    p\_competition\_id,  
    v\_order\_id,  
    'Competition purchase via balance',  
    'completed',  
    'completed',  
    array\_length(v\_reservation.ticket\_numbers, 1),  
    NOW(),  
    NOW(),  
    NOW(),  
    'balance',  
    'balance\_payment\_' || v\_order\_id::text  
  );

  \-- 10\) Mark pending\_tickets confirmed  
  UPDATE public.pending\_tickets  
  SET status \= 'confirmed',  
      confirmed\_at \= NOW(),  
      updated\_at \= NOW(),  
      transaction\_hash \= 'balance\_payment\_' || v\_order\_id::text  
  WHERE id \= p\_reservation\_id;

  RETURN jsonb\_build\_object(  
    'success', true,  
    'order\_id', v\_order\_id,  
    'transaction\_id', v\_transaction\_id,  
    'amount\_charged', v\_total\_amount,  
    'ticket\_count', array\_length(v\_reservation.ticket\_numbers, 1),  
    'remaining\_balance', v\_user\_balance \- v\_total\_amount  
  );

EXCEPTION  
  WHEN OTHERS THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Transaction failed: ' || SQLERRM);  
END;  
$function$  
"  
public,finalize\_purchase,p\_reservation\_id uuid,p\_reservation\_id uuid,jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.finalize\_purchase(p\_reservation\_id uuid)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_pending record;  
  v\_now timestamptz := now();  
  v\_total numeric;  
  v\_ticket\_price numeric;  
  v\_balance\_before numeric;  
  v\_balance\_after numeric;  
  v\_entry\_id uuid;  
  v\_existing\_entry uuid;  
  v\_comp\_id uuid;  
  v\_cuid text;  
  v\_ticket\_count int;  
  v\_tickets int\[\];  
  v\_reference text;  
  v\_updated\_rows int;  
BEGIN  
  if p\_reservation\_id is null then  
    raise exception 'reservation\_id is required';  
  end if;

  \-- lock the pending reservation  
  select \* into v\_pending  
  from public.pending\_tickets  
  where id \= p\_reservation\_id  
  for update;

  if not found then  
    raise exception 'Reservation % not found', p\_reservation\_id;  
  end if;

  if v\_pending.status \<\> 'pending' then  
    raise exception 'Reservation % is not pending (status=%)', p\_reservation\_id, v\_pending.status;  
  end if;

  if v\_pending.expires\_at is not null and v\_pending.expires\_at \< v\_now then  
    raise exception 'Reservation % expired at %', p\_reservation\_id, v\_pending.expires\_at;  
  end if;

  v\_comp\_id := v\_pending.competition\_id;  
  v\_cuid := coalesce(v\_pending.canonical\_user\_id, v\_pending.user\_id);  
  v\_ticket\_count := coalesce(v\_pending.ticket\_count, 0);  
  v\_ticket\_price := coalesce(v\_pending.ticket\_price, 0);  
  v\_total := coalesce(v\_pending.total\_amount, v\_ticket\_price \* v\_ticket\_count);

  if v\_cuid is null then  
    raise exception 'Reservation missing canonical user id';  
  end if;

  \-- derive ticket list; prefer pending\_ticket\_items if populated  
  select array\_agg(pti.ticket\_number order by pti.ticket\_number)  
    into v\_tickets  
  from public.pending\_ticket\_items pti  
  where pti.pending\_ticket\_id \= v\_pending.id;

  \-- balance snapshot before  
  select sab.available\_balance  
    into v\_balance\_before  
  from public.sub\_account\_balances sab  
  where sab.canonical\_user\_id \= v\_cuid and sab.currency \= 'USD'  
  for update;

  if v\_balance\_before is null then  
    \-- initialize balance row if missing  
    insert into public.sub\_account\_balances(id, user\_id, canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated)  
    values (gen\_random\_uuid(), v\_cuid, v\_cuid, 'USD', 0, 0, v\_now)  
    returning available\_balance into v\_balance\_before;  
  end if;

  \-- idempotency reference (time-based; callers should avoid repeating within same second if possible)  
  v\_reference := v\_cuid || '-' || v\_comp\_id || '-' || v\_total || '-' || v\_ticket\_count || '-' || extract(epoch from v\_now)::bigint::text;

  \-- Mark tickets as sold based on numbers if available  
  if v\_ticket\_count \> 0 then  
    if v\_tickets is not null and array\_length(v\_tickets,1) is not null then  
      update public.tickets t  
      set status \= 'sold', purchased\_by \= null, purchased\_at \= v\_now, purchase\_price \= v\_ticket\_price, payment\_amount \= v\_total / greatest(v\_ticket\_count,1), canonical\_user\_id \= v\_cuid  
      where t.competition\_id \= v\_comp\_id  
        and t.ticket\_number \= any(v\_tickets)  
        and t.status \= 'available';  
      GET DIAGNOSTICS v\_updated\_rows \= ROW\_COUNT;  
      if v\_updated\_rows \<\> v\_ticket\_count then  
        raise exception 'Could not mark all reserved tickets as sold (expected %, updated %)', v\_ticket\_count, v\_updated\_rows;  
      end if;  
    else  
      raise exception 'No ticket list found for reservation %', p\_reservation\_id;  
    end if;  
  end if;

  \-- upsert competition\_entries aggregate  
  select id into v\_existing\_entry  
  from public.competition\_entries  
  where canonical\_user\_id \= v\_cuid and competition\_id \= v\_comp\_id  
  for update;

  if v\_existing\_entry is null then  
    insert into public.competition\_entries(id, canonical\_user\_id, competition\_id, wallet\_address, tickets\_count, amount\_spent, latest\_purchase\_at, created\_at, updated\_at)  
    values (gen\_random\_uuid(), v\_cuid, v\_comp\_id, v\_pending.wallet\_address, v\_ticket\_count, v\_total, v\_now, v\_now, v\_now)  
    returning id into v\_entry\_id;  
  else  
    update public.competition\_entries  
    set tickets\_count \= coalesce(tickets\_count,0) \+ v\_ticket\_count,  
        amount\_spent \= coalesce(amount\_spent,0) \+ v\_total,  
        latest\_purchase\_at \= v\_now,  
        updated\_at \= v\_now  
    where id \= v\_existing\_entry  
    returning id into v\_entry\_id;  
  end if;

  \-- record user\_transactions  
  insert into public.user\_transactions(id, user\_id, canonical\_user\_id, wallet\_address, type, amount, currency, balance\_before, balance\_after, competition\_id, description, status, created\_at)  
  values (gen\_random\_uuid(), v\_cuid, v\_cuid, v\_pending.wallet\_address, 'entry', v\_total, 'USD', null, null, v\_comp\_id, 'Ticket purchase', 'completed', v\_now);

  \-- mark reservation confirmed  
  update public.pending\_tickets  
  set status \= 'confirmed', confirmed\_at \= v\_now, updated\_at \= v\_now  
  where id \= p\_reservation\_id;

  \-- adjust balances: available \-= total, pending \-= total  
  update public.sub\_account\_balances  
  set available\_balance \= coalesce(available\_balance,0) \- v\_total,  
      pending\_balance \= greatest(coalesce(pending\_balance,0) \- v\_total, 0),  
      last\_updated \= v\_now  
  where canonical\_user\_id \= v\_cuid and currency \= 'USD'  
  returning available\_balance into v\_balance\_after;

  \-- ledger entry (time-based reference)  
  if not exists (  
    select 1 from public.balance\_ledger bl  
    where bl.reference\_id \= v\_reference  
  ) then  
    insert into public.balance\_ledger(id, canonical\_user\_id, transaction\_type, amount, currency, balance\_before, balance\_after, reference\_id, description, created\_at)  
    values (gen\_random\_uuid(), v\_cuid, 'entry', v\_total, 'USD', v\_balance\_before, v\_balance\_after, v\_reference, 'Ticket purchase', v\_now);  
  end if;

  return jsonb\_build\_object(  
    'success', true,  
    'entry\_id', v\_entry\_id,  
    'tickets\_created', coalesce(v\_tickets, ARRAY\[\]::int\[\]),  
    'total\_cost', v\_total,  
    'balance\_before', v\_balance\_before,  
    'balance\_after', v\_balance\_after,  
    'competition\_id', v\_comp\_id  
  );

EXCEPTION WHEN others THEN  
  return jsonb\_build\_object(  
    'success', false,  
    'error', SQLERRM,  
    'reservation\_id', p\_reservation\_id  
  );  
END;  
$function$  
"  
public,finalize\_ticket\_hold,p\_pending\_ticket\_id uuid,p\_pending\_ticket\_id uuid,record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.finalize\_ticket\_hold(p\_pending\_ticket\_id uuid)  
 RETURNS TABLE(success boolean, conflicts integer\[\])  
 LANGUAGE plpgsql  
AS $function$  
DECLARE v\_comp uuid; v\_nums int\[\]; v\_inserted int\[\]; v\_conflicts int\[\];  
BEGIN  
  SELECT pti.competition\_id, array\_agg(pti.ticket\_number)  
  INTO v\_comp, v\_nums  
  FROM public.pending\_ticket\_items pti  
  WHERE pti.pending\_ticket\_id \= p\_pending\_ticket\_id AND pti.status \= 'pending' AND pti.expires\_at \> now()  
  GROUP BY pti.competition\_id;

  IF v\_nums IS NULL OR array\_length(v\_nums,1) IS NULL THEN  
    RETURN QUERY SELECT false, ARRAY\[\]::int\[\]; RETURN; END IF;

  WITH ins AS (  
    INSERT INTO public.tickets(competition\_id, ticket\_number, status, purchased\_at, pending\_ticket\_id)  
    SELECT v\_comp, n, 'purchased', now(), p\_pending\_ticket\_id  
    FROM unnest(v\_nums) AS n  
    ON CONFLICT DO NOTHING  
    RETURNING ticket\_number  
  )  
  SELECT array\_agg(ticket\_number) FROM ins INTO v\_inserted;

  v\_conflicts := ARRAY(SELECT n FROM unnest(v\_nums) n EXCEPT SELECT unnest(COALESCE(v\_inserted, ARRAY\[\]::int\[\])));

  UPDATE public.pending\_tickets SET status \= CASE WHEN COALESCE(array\_length(v\_inserted,1),0) \> 0 THEN 'confirmed' ELSE 'expired' END,  
                                  confirmed\_at \= CASE WHEN COALESCE(array\_length(v\_inserted,1),0) \> 0 THEN now() END,  
                                  updated\_at \= now()  
  WHERE id \= p\_pending\_ticket\_id;

  UPDATE public.pending\_ticket\_items SET status \= CASE WHEN COALESCE(array\_length(v\_inserted,1),0) \> 0 THEN 'confirmed' ELSE 'expired' END  
  WHERE pending\_ticket\_id \= p\_pending\_ticket\_id;

  RETURN QUERY SELECT COALESCE(array\_length(v\_inserted,1),0) \> 0, v\_conflicts; RETURN;  
END $function$  
"  
public,gen\_deterministic\_tx\_id,"p\_id uuid, p\_order\_id text, p\_canonical\_user\_id text, p\_wallet\_address text, p\_type text, p\_method text, p\_amount numeric, p\_currency text, p\_created\_at timestamp with time zone","p\_id uuid, p\_order\_id text, p\_canonical\_user\_id text, p\_wallet\_address text, p\_type text, p\_method text, p\_amount numeric, p\_currency text, p\_created\_at timestamp with time zone",text,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.gen\_deterministic\_tx\_id(p\_id uuid, p\_order\_id text, p\_canonical\_user\_id text, p\_wallet\_address text, p\_type text, p\_method text, p\_amount numeric, p\_currency text, p\_created\_at timestamp with time zone)  
 RETURNS text  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT '0x' ||  
         substring(  
           encode(  
             digest(  
               coalesce(p\_id::text,'') || '|' ||  
               coalesce(p\_order\_id,'') || '|' ||  
               coalesce(p\_canonical\_user\_id,'') || '|' ||  
               coalesce(lower(p\_wallet\_address),'') || '|' ||  
               coalesce(p\_type,'') || '|' ||  
               coalesce(p\_method,'') || '|' ||  
               coalesce(p\_amount::text,'') || '|' ||  
               coalesce(p\_currency,'') || '|' ||  
               extract(epoch from coalesce(p\_created\_at, to\_timestamp(0)))::text  
             , 'sha256'),  
           'hex'),  
           1, 64  
         );  
$function$  
"  
public,gen\_random\_bytes,integer,integer,bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.gen\_random\_bytes(integer)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_random\_bytes$function$  
"  
public,gen\_random\_uuid,,,uuid,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.gen\_random\_uuid()  
 RETURNS uuid  
 LANGUAGE c  
 PARALLEL SAFE  
AS '$libdir/pgcrypto', $function$pg\_random\_uuid$function$  
"  
public,gen\_salt,text,text,text,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.gen\_salt(text)  
 RETURNS text  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_gen\_salt$function$  
"  
public,gen\_salt,"text, integer","text, integer",text,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.gen\_salt(text, integer)  
 RETURNS text  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_gen\_salt\_rounds$function$  
"  
public,gen\_ticket\_tx\_id,"p\_id uuid, p\_competition\_id uuid, p\_ticket\_number bigint, p\_canonical\_user\_id text, p\_wallet\_address text, p\_payment\_provider text, p\_payment\_amount numeric, p\_payment\_tx\_hash text, p\_created\_at timestamp with time zone","p\_id uuid, p\_competition\_id uuid, p\_ticket\_number bigint, p\_canonical\_user\_id text, p\_wallet\_address text, p\_payment\_provider text, p\_payment\_amount numeric, p\_payment\_tx\_hash text, p\_created\_at timestamp with time zone",text,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.gen\_ticket\_tx\_id(p\_id uuid, p\_competition\_id uuid, p\_ticket\_number bigint, p\_canonical\_user\_id text, p\_wallet\_address text, p\_payment\_provider text, p\_payment\_amount numeric, p\_payment\_tx\_hash text, p\_created\_at timestamp with time zone)  
 RETURNS text  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT '0x' || substring(  
    encode(  
      digest(  
        coalesce(p\_id::text,'') || '|' ||  
        coalesce(p\_competition\_id::text,'') || '|' ||  
        coalesce(p\_ticket\_number::text,'') || '|' ||  
        coalesce(p\_canonical\_user\_id,'') || '|' ||  
        coalesce(p\_wallet\_address,'') || '|' ||  
        coalesce(p\_payment\_provider,'') || '|' ||  
        coalesce(p\_payment\_amount::text,'') || '|' ||  
        coalesce(p\_payment\_tx\_hash,'') || '|' ||  
        extract(epoch from coalesce(p\_created\_at, to\_timestamp(0)))::text  
      , 'sha256'), 'hex'), 1, 64);  
$function$  
"  
public,get\_active\_competitions\_for\_draw,,,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_active\_competitions\_for\_draw()  
 RETURNS TABLE(id uuid, onchain\_competition\_id bigint, end\_date timestamp with time zone, status text)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
    RETURN QUERY  
    SELECT   
        c.id,  
        c.onchain\_competition\_id,  
        c.end\_date,  
        c.status  
    FROM competitions c  
    WHERE c.onchain\_competition\_id IS NOT NULL  
        AND c.status \= 'active'  
    ORDER BY c.end\_date ASC;  
END;  
$function$  
"  
public,get\_available\_ticket\_numbers,"p\_competition\_id uuid, p\_limit integer","p\_competition\_id uuid, p\_limit integer DEFAULT NULL::integer",int4,sql,false,s,false,true,Returns ordered list of available ticket numbers (excludes sold \+ active holds).,"CREATE OR REPLACE FUNCTION public.get\_available\_ticket\_numbers(p\_competition\_id uuid, p\_limit integer DEFAULT NULL::integer)  
 RETURNS TABLE(ticket\_number integer)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  with unavail as (  
    select t.ticket\_number  
    from public.tickets t  
    where t.competition\_id \= p\_competition\_id  
      and t.is\_active \= true  
      and t.status \= 'sold'  
    union  
    select h.ticket\_number  
    from public.pending\_ticket\_items h  
    where h.competition\_id \= p\_competition\_id  
      and h.status \= 'pending'  
      and (h.expires\_at is null or h.expires\_at \> now())  
  ), all\_nums as (  
    select generate\_series(1, (select c.total\_tickets from public.competitions c where c.id \= p\_competition\_id))::int as n  
  )  
  select n as ticket\_number  
  from all\_nums a  
  where not exists (select 1 from unavail u where u.ticket\_number \= a.n)  
  order by n  
  limit coalesce(p\_limit, 2147483647);  
$function$  
"  
public,get\_available\_tickets,p\_competition\_id uuid,p\_competition\_id uuid,\_int4,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_available\_tickets(p\_competition\_id uuid)  
 RETURNS integer\[\]  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE v\_total INT; v\_sold INT\[\]; v\_pending INT\[\]; v\_available INT\[\];  
BEGIN  
  SELECT total\_tickets INTO v\_total FROM competitions WHERE id \= p\_competition\_id;  
  SELECT ARRAY\_AGG(ticket\_number) INTO v\_sold FROM tickets WHERE competition\_id \= p\_competition\_id;  
  SELECT ARRAY\_AGG(unnest) INTO v\_pending FROM (SELECT UNNEST(ticket\_numbers) FROM pending\_tickets WHERE competition\_id \= p\_competition\_id AND status \= 'pending' AND expires\_at \> NOW()) t;  
  SELECT ARRAY\_AGG(n) INTO v\_available FROM generate\_series(1, v\_total) n WHERE n \!= ALL(COALESCE(v\_sold, '{}')) AND n \!= ALL(COALESCE(v\_pending, '{}'));  
  RETURN v\_available;  
END;  
$function$  
"  
public,get\_balance\_by\_any\_id,p\_user\_id text,p\_user\_id text,numeric,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_balance\_by\_any\_id(p\_user\_id text)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_canonical TEXT;  
  v\_balance NUMERIC;  
BEGIN  
  v\_canonical := to\_canonical\_user\_id(p\_user\_id);  
    
  \-- Try canonical first  
  SELECT balance INTO v\_balance   
  FROM sub\_account\_balances   
  WHERE lower(user\_id) \= lower(v\_canonical);  
    
  IF v\_balance IS NOT NULL THEN  
    RETURN v\_balance;  
  END IF;  
    
  \-- Fallback to raw input  
  SELECT balance INTO v\_balance   
  FROM sub\_account\_balances   
  WHERE lower(user\_id) \= lower(p\_user\_id);  
    
  RETURN COALESCE(v\_balance, 0);  
END;  
$function$  
"  
public,get\_competition\_availability,"p\_competition\_id uuid, p\_total integer","p\_competition\_id uuid, p\_total integer",record,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_availability(p\_competition\_id uuid, p\_total integer)  
 RETURNS TABLE(competition\_id uuid, total integer, unavailable integer, available integer)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  WITH c AS (  
    SELECT COUNT(\*)::int AS cnt  
    FROM public.competition\_unavailable\_tickets  
    WHERE competition\_id \= p\_competition\_id  
  )  
  SELECT  
    p\_competition\_id,  
    p\_total,  
    COALESCE(c.cnt, 0),  
    p\_total \- COALESCE(c.cnt, 0\)  
  FROM c;  
$function$  
"  
public,get\_competition\_by\_id,p\_competition\_id uuid,p\_competition\_id uuid,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_by\_id(p\_competition\_id uuid)  
 RETURNS TABLE(id uuid, title text, total\_tickets integer, ticket\_price numeric, end\_date timestamp with time zone, is\_instant\_win boolean, onchain\_competition\_id bigint, status text, vrf\_tx\_hash text, vrf\_error text, created\_at timestamp with time zone, updated\_at timestamp with time zone)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
    RETURN QUERY  
    SELECT   
        c.id,  
        c.title,  
        c.total\_tickets,  
        c.price\_per\_ticket as ticket\_price,  
        c.end\_date,  
        c.is\_instant\_win,  
        c.onchain\_competition\_id,  
        c.status,  
        c.vrf\_tx\_hash,  
        c.vrf\_error,  
        c.created\_at,  
        c.updated\_at  
    FROM competitions c  
    WHERE c.id \= p\_competition\_id;  
END;  
$function$  
"  
public,get\_competition\_entries,competition\_id uuid,competition\_id uuid,record,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_entries(competition\_id uuid)  
 RETURNS TABLE(canonical\_user\_id text, wallet\_address text, tickets\_count integer, ticket\_numbers\_csv text, amount\_spent numeric, latest\_purchase\_at timestamp with time zone)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  WITH t AS (  
    SELECT  
      COALESCE(t.canonical\_user\_id, cu.canonical\_user\_id, 'unknown') AS canonical\_user\_id,  
      COALESCE(t.wallet\_address, cu.primary\_wallet\_address, cu.wallet\_address) AS wallet\_address,  
      COUNT(\*) FILTER (WHERE t.status \<\> 'available') AS tickets\_count,  
      string\_agg(t.ticket\_number::text, ',' ORDER BY t.ticket\_number) AS ticket\_numbers\_csv,  
      SUM(COALESCE(t.purchase\_price, t.payment\_amount, 0)) AS amount\_spent,  
      MAX(COALESCE(t.purchase\_date, t.purchased\_at, t.created\_at)) AS latest\_purchase\_at  
    FROM public.tickets t  
    LEFT JOIN public.canonical\_users cu  
      ON cu.canonical\_user\_id \= t.canonical\_user\_id  
    WHERE t.competition\_id \= get\_competition\_entries.competition\_id  
    GROUP BY 1,2  
  ),  
  j AS (  
    SELECT  
      j.canonical\_user\_id,  
      j.wallet\_address,  
      COALESCE(j.numberoftickets, array\_length(regexp\_split\_to\_array(COALESCE(j.ticketnumbers,''), E'\\\\s\*,\\\\s\*'),1)) AS tickets\_count,  
      COALESCE(j.ticketnumbers,'') AS ticket\_numbers\_csv,  
      j.amountspent AS amount\_spent,  
      MAX(j.purchasedate) AS latest\_purchase\_at  
    FROM public.joincompetition j  
    WHERE j.competitionid \= get\_competition\_entries.competition\_id  
      AND COALESCE(j.status,'active') \= 'active'  
    GROUP BY 1,2,3,4,5  
  )  
  SELECT  
    COALESCE(t.canonical\_user\_id, j.canonical\_user\_id) AS canonical\_user\_id,  
    COALESCE(t.wallet\_address, j.wallet\_address) AS wallet\_address,  
    COALESCE(t.tickets\_count,0) \+ COALESCE(j.tickets\_count,0) AS tickets\_count,  
    NULLIF(  
      concat\_ws(',', NULLIF(t.ticket\_numbers\_csv,''), NULLIF(j.ticket\_numbers\_csv,'')),  
      ''  
    ) AS ticket\_numbers\_csv,  
    COALESCE(t.amount\_spent,0) \+ COALESCE(j.amount\_spent,0) AS amount\_spent,  
    GREATEST(COALESCE(t.latest\_purchase\_at, to\_timestamp(0)), COALESCE(j.latest\_purchase\_at, to\_timestamp(0))) AS latest\_purchase\_at  
  FROM t  
  FULL OUTER JOIN j USING (canonical\_user\_id, wallet\_address);  
$function$  
"  
public,get\_competition\_entries,competition\_identifier text,competition\_identifier text,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_entries(competition\_identifier text)  
 RETURNS TABLE(uid text, competitionid text, userid text, privy\_user\_id text, numberoftickets integer, ticketnumbers text, amountspent numeric, walletaddress text, username text, chain text, transactionhash text, purchasedate timestamp with time zone, created\_at timestamp with time zone)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public', 'pg\_temp'  
AS $function$  
BEGIN  
  RETURN QUERY SELECT \* FROM get\_competition\_entries\_bypass\_rls(competition\_identifier);  
END;  
$function$  
"  
public,get\_competition\_entries,"p\_competition\_id text, p\_limit integer, p\_offset integer","p\_competition\_id text, p\_limit integer DEFAULT 50, p\_offset integer DEFAULT 0",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_entries(p\_competition\_id text, p\_limit integer DEFAULT 50, p\_offset integer DEFAULT 0\)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE v\_entries JSONB;  
BEGIN  
  SELECT jsonb\_agg(jsonb\_build\_object('canonical\_user\_id', ce.canonical\_user\_id, 'username', COALESCE(ce.username, cu.username, 'Anonymous'),  
    'wallet\_address', ce.wallet\_address, 'tickets\_count', ce.tickets\_count, 'amount\_spent', ce.amount\_spent, 'latest\_purchase\_at', ce.latest\_purchase\_at)) INTO v\_entries  
  FROM competition\_entries ce LEFT JOIN canonical\_users cu ON ce.canonical\_user\_id \= cu.canonical\_user\_id  
  WHERE ce.competition\_id \= p\_competition\_id ORDER BY ce.latest\_purchase\_at DESC LIMIT p\_limit OFFSET p\_offset;  
  RETURN jsonb\_build\_object('success', true, 'entries', COALESCE(v\_entries, '\[\]'::jsonb));  
END;  
$function$  
"  
public,get\_competition\_entries\_bypass\_rls,competition\_identifier text,competition\_identifier text,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_entries\_bypass\_rls(competition\_identifier text)  
 RETURNS TABLE(uid text, competitionid text, userid text, privy\_user\_id text, numberoftickets integer, ticketnumbers text, amountspent numeric, walletaddress text, username text, chain text, transactionhash text, purchasedate timestamp with time zone, created\_at timestamp with time zone)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  comp\_uuid uuid := NULL;  
  comp\_uid\_text text := NULL;  
BEGIN  
  BEGIN  
    comp\_uuid := competition\_identifier::uuid;  
  EXCEPTION WHEN invalid\_text\_representation THEN  
    comp\_uuid := NULL;  
  END;

  IF comp\_uuid IS NULL THEN  
    SELECT c.id, c.uid INTO comp\_uuid, comp\_uid\_text FROM competitions c WHERE c.uid \= competition\_identifier LIMIT 1;  
  ELSE  
    SELECT c.uid INTO comp\_uid\_text FROM competitions c WHERE c.id \= comp\_uuid LIMIT 1;  
  END IF;

  RETURN QUERY  
  SELECT  
    COALESCE(jc.uid, jc.id::text) as uid,  
    jc.competitionid::text as competitionid,  
    jc.userid,  
    jc.privy\_user\_id,  
    jc.numberoftickets,  
    jc.ticketnumbers,  
    jc.amountspent,  
    jc.wallet\_address as walletaddress,  
    cu.username as username,  
    jc.chain,  
    jc.transactionhash,  
    jc.purchasedate::timestamptz,  
    jc.created\_at::timestamptz  
  FROM joincompetition jc  
  LEFT JOIN canonical\_users cu ON (  
    cu.canonical\_user\_id \= jc.wallet\_address OR  
    LOWER(cu.wallet\_address) \= LOWER(jc.wallet\_address) OR  
    (jc.canonical\_user\_id IS NOT NULL AND cu.canonical\_user\_id \= jc.canonical\_user\_id) OR  
    (jc.privy\_user\_id IS NOT NULL AND cu.privy\_user\_id \= jc.privy\_user\_id)  
  )  
  WHERE  
    (comp\_uuid IS NOT NULL AND jc.competitionid \= comp\_uuid) OR  
    (comp\_uid\_text IS NOT NULL AND jc.competitionid::text \= comp\_uid\_text)

  UNION ALL

  SELECT  
    ('tickets-' || COALESCE(t.privy\_user\_id,'') || '-' || to\_char(MIN(t.created\_at), 'YYYY-MM-DD""T""HH24:MI:SS.MS'))::text as uid,  
    t.competition\_id::text as competitionid,  
    t.privy\_user\_id as userid,  
    t.privy\_user\_id as privy\_user\_id,  
    COUNT(\*)::integer as numberoftickets,  
    string\_agg(t.ticket\_number::text, ',' ORDER BY t.ticket\_number) as ticketnumbers,  
    COALESCE(SUM(t.purchase\_price), 0)::numeric as amountspent,  
    NULL::text as walletaddress,  
    cu.username as username,  
    'USDC'::text as chain,  
    NULL::text as transactionhash,  
    MIN(t.created\_at)::timestamptz as purchasedate,  
    MIN(t.created\_at)::timestamptz as created\_at  
  FROM tickets t  
  LEFT JOIN canonical\_users cu ON cu.privy\_user\_id \= t.privy\_user\_id  
  WHERE  
    (comp\_uuid IS NOT NULL AND t.competition\_id \= comp\_uuid)  
    OR (comp\_uid\_text IS NOT NULL AND t.competition\_id::text \= comp\_uid\_text)  
  AND NOT EXISTS (  
    SELECT 1 FROM joincompetition jc  
    WHERE jc.privy\_user\_id \= t.privy\_user\_id  
      AND (  
        (comp\_uuid IS NOT NULL AND jc.competitionid \= comp\_uuid)  
        OR (comp\_uid\_text IS NOT NULL AND jc.competitionid::text \= comp\_uid\_text)  
      )  
      AND jc.ticketnumbers LIKE '%' || t.ticket\_number || '%'  
  )  
  GROUP BY t.competition\_id, t.privy\_user\_id, cu.username

  ORDER BY purchasedate DESC;  
END;  
$function$  
"  
public,get\_competition\_entries\_legacy,p\_competition\_id uuid,p\_competition\_id uuid,record,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_entries\_legacy(p\_competition\_id uuid)  
 RETURNS TABLE(canonical\_user\_id text, wallet\_address text, tickets\_count integer, ticket\_numbers\_csv text, amount\_spent numeric, latest\_purchase\_at timestamp with time zone)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT \* FROM public.get\_competition\_entries(competition\_id := p\_competition\_id);  
$function$  
"  
public,get\_competition\_sold\_tickets,p\_competition\_id uuid,p\_competition\_id uuid,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_sold\_tickets(p\_competition\_id uuid)  
 RETURNS TABLE(sold\_count integer, pending\_count integer, total\_tickets integer, available\_count integer)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_tickets\_table\_count INTEGER;  
  v\_confirmed\_pending\_count INTEGER;  
  v\_pending\_count INTEGER;  
  v\_total INTEGER;  
BEGIN  
  \-- Count from tickets table  
  SELECT COUNT(\*)::INTEGER INTO v\_tickets\_table\_count  
  FROM tickets t WHERE t.competition\_id \= p\_competition\_id;  
    
  \-- Count confirmed from pending\_tickets (ticket\_count sum)  
  SELECT COALESCE(SUM(ticket\_count), 0)::INTEGER INTO v\_confirmed\_pending\_count  
  FROM pending\_tickets pt   
  WHERE pt.competition\_id \= p\_competition\_id   
  AND pt.status \= 'confirmed';  
    
  \-- Count still-pending tickets  
  SELECT COALESCE(SUM(ticket\_count), 0)::INTEGER INTO v\_pending\_count  
  FROM pending\_tickets pt   
  WHERE pt.competition\_id \= p\_competition\_id   
  AND pt.status \= 'pending'  
  AND pt.expires\_at \> NOW();  
    
  \-- Get total from competition  
  SELECT COALESCE(c.total\_tickets, 0)::INTEGER INTO v\_total  
  FROM competitions c WHERE c.id \= p\_competition\_id;  
    
  \-- Return combined sold count (tickets table \+ confirmed pending)  
  RETURN QUERY SELECT   
    (v\_tickets\_table\_count \+ v\_confirmed\_pending\_count)::INTEGER AS sold\_count,  
    v\_pending\_count::INTEGER AS pending\_count,  
    v\_total::INTEGER AS total\_tickets,  
    GREATEST(0, v\_total \- v\_tickets\_table\_count \- v\_confirmed\_pending\_count \- v\_pending\_count)::INTEGER AS available\_count;  
END;  
$function$  
"  
public,get\_competition\_ticket\_availability,p\_competition\_id uuid,p\_competition\_id uuid,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_ticket\_availability(p\_competition\_id uuid)  
 RETURNS TABLE(competition\_id uuid, total\_tickets integer, sold\_count integer, pending\_count integer, available\_count integer, available\_tickets integer\[\])  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
AS $function$  
declare  
  v\_total int;  
  sold int;  
  pend int;  
  av\_list int\[\];  
  av\_count int;  
begin  
  select total\_tickets into v\_total from public.competitions where id \= p\_competition\_id;  
  if v\_total is null then  
    raise exception 'Competition % not found', p\_competition\_id;  
  end if;

  select count(\*) into sold  
  from public.tickets  
  where competition\_id \= p\_competition\_id  
    and status in ('sold','purchased');

  select count(distinct pti.ticket\_number) into pend  
  from public.pending\_ticket\_items pti  
  join public.pending\_tickets pt on pt.id \= pti.pending\_ticket\_id  
  where pti.competition\_id \= p\_competition\_id  
    and pt.status in ('pending','awaiting\_payment')  
    and pt.expires\_at \> now();

  \-- Build arrays of sold and pending  
  with sold\_nums as (  
    select t.ticket\_number  
    from public.tickets t  
    where t.competition\_id \= p\_competition\_id and t.status in ('sold','purchased')  
  ), pending\_nums as (  
    select distinct pti.ticket\_number  
    from public.pending\_ticket\_items pti  
    join public.pending\_tickets pt on pt.id \= pti.pending\_ticket\_id  
    where pti.competition\_id \= p\_competition\_id and pt.status in ('pending','awaiting\_payment') and pt.expires\_at \> now()  
  ), blocked as (  
    select ticket\_number from sold\_nums  
    union  
    select ticket\_number from pending\_nums  
  ), universe as (  
    select generate\_series(1, v\_total) as n  
  )  
  select coalesce(array\_agg(n order by n), '{}') into av\_list  
  from universe u  
  where not exists (select 1 from blocked b where b.ticket\_number \= u.n);

  av\_count := coalesce(array\_length(av\_list,1),0);

  return query  
  select p\_competition\_id, v\_total, sold, pend, av\_count, av\_list;  
end;$function$  
"  
public,get\_competition\_ticket\_availability\_text,competition\_id\_text text,competition\_id\_text text,json,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_ticket\_availability\_text(competition\_id\_text text)  
 RETURNS json  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public', 'pg\_temp'  
AS $function$  
DECLARE  
  v\_competition\_uuid UUID;  
  v\_total\_tickets INTEGER;  
  v\_competition\_exists BOOLEAN;  
  v\_comp\_uid TEXT;  
  v\_sold\_tickets\_jc INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
  v\_sold\_tickets\_table INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
  v\_pending\_tickets INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
  v\_unavailable\_tickets INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
  v\_available\_tickets INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
  v\_sold\_count INTEGER := 0;  
  v\_available\_count INTEGER := 0;  
BEGIN  
  IF competition\_id\_text IS NULL OR TRIM(competition\_id\_text) \= '' THEN  
    RETURN json\_build\_object('competition\_id', competition\_id\_text,  
      'total\_tickets', 0, 'available\_tickets', ARRAY\[\]::INTEGER\[\],  
      'sold\_count', 0, 'available\_count', 0, 'error', 'Invalid competition ID');  
  END IF;

  BEGIN  
    v\_competition\_uuid := competition\_id\_text::UUID;  
  EXCEPTION WHEN invalid\_text\_representation THEN  
    SELECT id, uid INTO v\_competition\_uuid, v\_comp\_uid  
    FROM competitions WHERE uid \= competition\_id\_text LIMIT 1;  
    IF v\_competition\_uuid IS NULL THEN  
      RETURN json\_build\_object('competition\_id', competition\_id\_text,  
        'total\_tickets', 0, 'available\_tickets', ARRAY\[\]::INTEGER\[\],  
        'sold\_count', 0, 'available\_count', 0, 'error', 'Competition not found');  
    END IF;  
  END;

  SELECT TRUE, COALESCE(c.total\_tickets, 1000), c.uid  
  INTO v\_competition\_exists, v\_total\_tickets, v\_comp\_uid  
  FROM competitions c  
  WHERE c.id \= v\_competition\_uuid;

  IF NOT COALESCE(v\_competition\_exists, FALSE) THEN  
    RETURN json\_build\_object('competition\_id', competition\_id\_text,  
      'total\_tickets', 0, 'available\_tickets', ARRAY\[\]::INTEGER\[\],  
      'sold\_count', 0, 'available\_count', 0, 'error', 'Competition not found');  
  END IF;

  \-- joincompetition uses UUID competitionid in this DB  
  SELECT COALESCE(array\_agg(DISTINCT ticket\_num), ARRAY\[\]::INTEGER\[\])  
  INTO v\_sold\_tickets\_jc  
  FROM (  
    SELECT CAST(TRIM(unnest(string\_to\_array(ticketnumbers, ','))) AS INTEGER) AS ticket\_num  
    FROM joincompetition  
    WHERE competitionid \= v\_competition\_uuid  
      AND ticketnumbers IS NOT NULL  
      AND TRIM(ticketnumbers) \<\> ''  
  ) AS jc\_tickets  
  WHERE ticket\_num IS NOT NULL;

  v\_sold\_tickets\_jc := COALESCE(v\_sold\_tickets\_jc, ARRAY\[\]::INTEGER\[\]);

  SELECT COALESCE(array\_agg(DISTINCT ticket\_number), ARRAY\[\]::INTEGER\[\])  
  INTO v\_sold\_tickets\_table  
  FROM tickets t  
  WHERE t.competition\_id \= v\_competition\_uuid;

  v\_sold\_tickets\_table := COALESCE(v\_sold\_tickets\_table, ARRAY\[\]::INTEGER\[\]);

  v\_unavailable\_tickets := v\_sold\_tickets\_jc || v\_sold\_tickets\_table;

  BEGIN  
    SELECT COALESCE(array\_agg(DISTINCT ticket\_num), ARRAY\[\]::INTEGER\[\])  
    INTO v\_pending\_tickets  
    FROM (  
      SELECT unnest(ticket\_numbers) AS ticket\_num  
      FROM pending\_tickets pt  
      WHERE pt.competition\_id \= v\_competition\_uuid  
        AND pt.status \= 'pending'  
        AND pt.expires\_at \> NOW()  
    ) AS pending  
    WHERE ticket\_num IS NOT NULL;  
  EXCEPTION WHEN undefined\_table THEN  
    v\_pending\_tickets := ARRAY\[\]::INTEGER\[\];  
  END;

  v\_pending\_tickets := COALESCE(v\_pending\_tickets, ARRAY\[\]::INTEGER\[\]);  
  v\_unavailable\_tickets := v\_unavailable\_tickets || v\_pending\_tickets;

  IF array\_length(v\_unavailable\_tickets, 1\) IS NOT NULL AND array\_length(v\_unavailable\_tickets, 1\) \> 0 THEN  
    SELECT COALESCE(array\_agg(DISTINCT u ORDER BY u), ARRAY\[\]::INTEGER\[\])  
    INTO v\_unavailable\_tickets  
    FROM unnest(v\_unavailable\_tickets) AS u;  
  ELSE  
    v\_unavailable\_tickets := ARRAY\[\]::INTEGER\[\];  
  END IF;

  v\_sold\_count := COALESCE(array\_length(v\_unavailable\_tickets, 1), 0);  
  v\_available\_count := GREATEST(0, v\_total\_tickets \- v\_sold\_count);

  \-- Set-based available tickets build for performance  
  IF v\_available\_count \> 0 THEN  
    SELECT COALESCE(array\_agg(g.n ORDER BY g.n), ARRAY\[\]::INTEGER\[\])  
    INTO v\_available\_tickets  
    FROM (  
      SELECT n FROM generate\_series(1, LEAST(v\_total\_tickets, 50000)) AS g(n)  
      EXCEPT  
      SELECT unnest(v\_unavailable\_tickets)  
    ) AS g;  
  END IF;

  RETURN json\_build\_object(  
    'competition\_id', v\_competition\_uuid,  
    'total\_tickets', v\_total\_tickets,  
    'available\_tickets', COALESCE(v\_available\_tickets, ARRAY\[\]::INTEGER\[\]),  
    'sold\_count', v\_sold\_count,  
    'available\_count', v\_available\_count  
  );  
END;  
$function$  
"  
public,get\_competition\_unavailable\_tickets,p\_competition\_id text,p\_competition\_id text,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_competition\_unavailable\_tickets(p\_competition\_id text)  
 RETURNS TABLE(ticket\_number integer, source text)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_uuid UUID;  
BEGIN  
  \-- Try to cast to UUID  
  BEGIN  
    v\_uuid := p\_competition\_id::UUID;  
  EXCEPTION WHEN invalid\_text\_representation THEN  
    \-- If not a valid UUID, try to look up by uid  
    SELECT c.id INTO v\_uuid  
    FROM competitions c  
    WHERE c.uid \= p\_competition\_id  
    LIMIT 1;

    IF v\_uuid IS NULL THEN  
      RETURN; \-- Return empty if not found  
    END IF;  
  END;

  RETURN QUERY SELECT \* FROM get\_competition\_unavailable\_tickets(v\_uuid);  
END;  
$function$  
"  
public,get\_competition\_unavailable\_tickets,p\_competition\_id uuid,p\_competition\_id uuid,record,plpgsql,true,s,false,true,"Returns all unavailable ticket numbers for a competition with their source (sold/pending).  
Used by bulk allocation to know which tickets to exclude.","CREATE OR REPLACE FUNCTION public.get\_competition\_unavailable\_tickets(p\_competition\_id uuid)  
 RETURNS TABLE(ticket\_number integer, source text)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_comp\_uid TEXT;  
BEGIN  
  \-- Get the competition UID for legacy lookups  
  SELECT uid INTO v\_comp\_uid  
  FROM competitions  
  WHERE id \= p\_competition\_id;

  \-- Return all unavailable tickets with their source  
  RETURN QUERY

  \-- From joincompetition (confirmed purchases)  
  SELECT  
    CAST(trim(t\_num) AS INTEGER) AS ticket\_number,  
    'sold'::TEXT AS source  
  FROM (  
    SELECT unnest(string\_to\_array(ticketnumbers, ',')) AS t\_num  
    FROM joincompetition  
    WHERE (  
      competitionid::TEXT \= p\_competition\_id::TEXT  
      OR (v\_comp\_uid IS NOT NULL AND competitionid::TEXT \= v\_comp\_uid)  
    )  
    AND ticketnumbers IS NOT NULL  
    AND trim(ticketnumbers) \!= ''  
  ) jc\_parsed  
  WHERE trim(t\_num) \~ '^\[0-9\]+$'

  UNION ALL

  \-- From tickets table  
  SELECT  
    t.ticket\_number,  
    'sold'::TEXT AS source  
  FROM tickets t  
  WHERE t.competition\_id \= p\_competition\_id  
    AND t.ticket\_number IS NOT NULL

  UNION ALL

  \-- From pending\_tickets (active reservations)  
  SELECT  
    unnest(pt.ticket\_numbers) AS ticket\_number,  
    'pending'::TEXT AS source  
  FROM pending\_tickets pt  
  WHERE pt.competition\_id \= p\_competition\_id  
    AND pt.status IN ('pending', 'confirming')  
    AND pt.expires\_at \> NOW();  
END;  
$function$  
"  
public,get\_comprehensive\_user\_dashboard\_entries,p\_user\_identifier text,p\_user\_identifier text,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_comprehensive\_user\_dashboard\_entries(p\_user\_identifier text)  
 RETURNS TABLE(id text, competition\_id text, title text, description text, image text, status text, entry\_type text, is\_winner boolean, ticket\_numbers text, total\_tickets integer, total\_amount\_spent numeric, purchase\_date timestamp with time zone, transaction\_hash text, is\_instant\_win boolean, prize\_value numeric, competition\_status text, end\_date timestamp with time zone)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_canonical\_user\_id TEXT;  
  search\_wallet TEXT;  
BEGIN  
  \-- Extract wallet from prize:pid: format  
  IF p\_user\_identifier LIKE 'prize:pid:0x%' THEN  
    search\_wallet := LOWER(SUBSTRING(p\_user\_identifier FROM 11));  
  ELSIF p\_user\_identifier LIKE '0x%' THEN  
    search\_wallet := LOWER(p\_user\_identifier);  
  END IF;

  \-- Resolve canonical user ID  
  SELECT canonical\_user\_id INTO v\_canonical\_user\_id  
  FROM canonical\_users  
  WHERE canonical\_user\_id \= p\_user\_identifier  
     OR uid \= p\_user\_identifier  
     OR (search\_wallet IS NOT NULL AND LOWER(wallet\_address) \= search\_wallet)  
     OR (search\_wallet IS NOT NULL AND LOWER(base\_wallet\_address) \= search\_wallet)  
  LIMIT 1;

  IF v\_canonical\_user\_id IS NULL THEN  
    RETURN;  
  END IF;

  \-- Return dashboard entries from multiple sources INCLUDING joincompetition  
  RETURN QUERY  
  WITH user\_entries AS (  
    \-- Source 1: competition\_entries table  
    SELECT DISTINCT  
      ce.id,  
      ce.competition\_id,  
      c.title,  
      c.description,  
      c.image\_url AS image,  
      c.status AS competition\_status,  
      'competition\_entry' AS entry\_type,  
      ce.is\_winner,  
      ce.ticket\_numbers\_csv AS ticket\_numbers,  
      ce.tickets\_count AS total\_tickets,  
      ce.amount\_spent AS total\_amount\_spent,  
      ce.latest\_purchase\_at AS purchase\_date,  
      NULL::TEXT AS transaction\_hash,  
      c.is\_instant\_win,  
      NULL::NUMERIC AS prize\_value,  
      c.end\_time AS end\_date  
    FROM competition\_entries ce  
    LEFT JOIN competitions c ON ce.competition\_id \= c.id OR ce.competition\_id \= c.uid  
    WHERE ce.canonical\_user\_id \= v\_canonical\_user\_id

    UNION ALL

    \-- Source 2: user\_transactions table  
    SELECT DISTINCT  
      ut.id,  
      ut.competition\_id,  
      c.title,  
      c.description,  
      c.image\_url AS image,  
      c.status AS competition\_status,  
      'transaction' AS entry\_type,  
      false AS is\_winner,  
      ut.ticket\_numbers,  
      ut.ticket\_count AS total\_tickets,  
      ut.amount AS total\_amount\_spent,  
      ut.created\_at AS purchase\_date,  
      ut.transaction\_hash,  
      c.is\_instant\_win,  
      NULL::NUMERIC AS prize\_value,  
      c.end\_time AS end\_date  
    FROM user\_transactions ut  
    LEFT JOIN competitions c ON ut.competition\_id \= c.id OR ut.competition\_id \= c.uid  
    WHERE (ut.user\_id \= v\_canonical\_user\_id OR ut.canonical\_user\_id \= v\_canonical\_user\_id)  
      AND ut.payment\_status IN ('completed', 'confirmed')  
      AND ut.competition\_id IS NOT NULL

    UNION ALL

    \-- Source 3: joincompetition table (CRITICAL \- where old data is\!)  
    SELECT DISTINCT  
      jc.uid AS id,  
      jc.competitionid AS competition\_id,  
      c.title,  
      c.description,  
      c.image\_url AS image,  
      c.status AS competition\_status,  
      'joincompetition' AS entry\_type,  
      false AS is\_winner,  
      jc.ticketnumbers AS ticket\_numbers,  
      jc.numberoftickets AS total\_tickets,  
      jc.amountspent AS total\_amount\_spent,  
      jc.purchasedate AS purchase\_date,  
      jc.transactionhash AS transaction\_hash,  
      c.is\_instant\_win,  
      NULL::NUMERIC AS prize\_value,  
      c.end\_time AS end\_date  
    FROM joincompetition jc  
    LEFT JOIN competitions c ON jc.competitionid \= c.id::TEXT OR jc.competitionid \= c.uid  
    WHERE jc.canonical\_user\_id \= v\_canonical\_user\_id  
       OR jc.userid \= v\_canonical\_user\_id  
       OR jc.privy\_user\_id \= v\_canonical\_user\_id  
       OR (search\_wallet IS NOT NULL AND LOWER(jc.wallet\_address) \= search\_wallet)  
  )  
  SELECT DISTINCT ON (ue.competition\_id)  
    ue.id,  
    ue.competition\_id,  
    ue.title,  
    ue.description,  
    ue.image,  
    CASE   
      WHEN ue.competition\_status \= 'sold\_out' THEN 'sold\_out'  
      WHEN ue.competition\_status \= 'active' THEN 'live'  
      ELSE ue.competition\_status  
    END AS status,  
    ue.entry\_type,  
    ue.is\_winner,  
    ue.ticket\_numbers,  
    ue.total\_tickets,  
    ue.total\_amount\_spent,  
    ue.purchase\_date,  
    ue.transaction\_hash,  
    ue.is\_instant\_win,  
    ue.prize\_value,  
    ue.competition\_status,  
    ue.end\_date  
  FROM user\_entries ue  
  ORDER BY ue.competition\_id, ue.purchase\_date DESC;  
END;  
$function$  
"  
public,get\_comprehensive\_user\_dashboard\_entries,params jsonb,params jsonb,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_comprehensive\_user\_dashboard\_entries(params jsonb)  
 RETURNS TABLE(id text, competition\_id text, title text, description text, image text, status text, entry\_type text, is\_winner boolean, ticket\_numbers text, total\_tickets integer, total\_amount\_spent numeric, purchase\_date timestamp with time zone, transaction\_hash text, is\_instant\_win boolean, prize\_value numeric, competition\_status text, end\_date timestamp with time zone)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  user\_id\_param TEXT;  
BEGIN  
  \-- Extract user identifier from params  
  user\_id\_param := COALESCE(params-\>\>'user\_identifier', params-\>\>'userId', params-\>\>'user\_id');

  IF user\_id\_param IS NULL OR user\_id\_param \= '' THEN  
    RAISE EXCEPTION 'Missing required parameter: user\_identifier, userId, or user\_id';  
  END IF;

  \-- Delegate to the TEXT version  
  RETURN QUERY SELECT \* FROM public.get\_comprehensive\_user\_dashboard\_entries(user\_id\_param);  
END;  
$function$  
"  
public,get\_custody\_wallet\_summary,p\_user\_id text,p\_user\_id text,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_custody\_wallet\_summary(p\_user\_id text)  
 RETURNS TABLE(current\_balance numeric, last\_transaction\_at timestamp with time zone, pending\_transactions integer, total\_deposits numeric, total\_withdrawals numeric, total\_payouts numeric)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE v\_user\_uuid UUID; BEGIN  
  SELECT id INTO v\_user\_uuid FROM canonical\_users WHERE uid=p\_user\_id OR wallet\_address=p\_user\_id OR base\_wallet\_address=p\_user\_id LIMIT 1;  
  IF v\_user\_uuid IS NULL THEN RETURN QUERY SELECT 0::NUMERIC, NULL::TIMESTAMPTZ, 0, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC; RETURN; END IF;  
  RETURN QUERY WITH totals AS (  
    SELECT COALESCE(SUM(CASE WHEN transaction\_type='deposit' THEN amount ELSE 0 END),0) deposits,  
           COALESCE(SUM(CASE WHEN transaction\_type='withdrawal' THEN amount ELSE 0 END),0) withdrawals,  
           COALESCE(SUM(CASE WHEN transaction\_type='payout' THEN amount ELSE 0 END),0) payouts,  
           COUNT(CASE WHEN status='pending' THEN 1 END) pending,  
           MAX(created\_at) last\_tx  
    FROM custody\_transactions WHERE user\_id=v\_user\_uuid)  
  SELECT COALESCE(cu.usdc\_balance,0)::NUMERIC, totals.last\_tx, totals.pending::INTEGER, totals.deposits::NUMERIC, totals.withdrawals::NUMERIC, totals.payouts::NUMERIC  
  FROM canonical\_users cu, totals WHERE cu.id=v\_user\_uuid; END; $function$  
"  
public,get\_joincompetition\_entries\_for\_competition,p\_competition\_id uuid,p\_competition\_id uuid,joincompetition,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_joincompetition\_entries\_for\_competition(p\_competition\_id uuid)  
 RETURNS SETOF joincompetition  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT jc.\*  
  FROM public.joincompetition jc  
  WHERE jc.competitionid \= p\_competition\_id  
  ORDER BY jc.purchasedate DESC NULLS LAST, jc.created\_at DESC;  
$function$  
"  
public,get\_linked\_external\_wallet,user\_identifier text,user\_identifier text,text,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_linked\_external\_wallet(user\_identifier text)  
 RETURNS text  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT cu.eth\_wallet\_address  
  FROM public.canonical\_users cu  
  WHERE cu.canonical\_user\_id \= user\_identifier  
     OR cu.uid \= user\_identifier  
     OR lower(coalesce(cu.eth\_wallet\_address,'')) \= lower(coalesce(user\_identifier,''))  
  LIMIT 1;  
$function$  
"  
public,get\_sub\_account\_balance,"p\_canonical\_user\_id text, p\_user\_id text, p\_privy\_user\_id text","p\_canonical\_user\_id text DEFAULT NULL::text, p\_user\_id text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_sub\_account\_balance(p\_canonical\_user\_id text DEFAULT NULL::text, p\_user\_id text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text)  
 RETURNS TABLE(id uuid, user\_id uuid, currency text, available\_balance numeric, pending\_balance numeric, last\_updated timestamp with time zone, canonical\_user\_id text, privy\_user\_id text, wallet\_address text)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  uuid\_val UUID;  
BEGIN  
  \-- Try to cast p\_user\_id to UUID if valid  
  BEGIN  
    uuid\_val := p\_user\_id::UUID;  
  EXCEPTION WHEN OTHERS THEN  
    uuid\_val := NULL;  
  END;

  RETURN QUERY  
  SELECT sab.\*  
  FROM sub\_account\_balances sab  
  WHERE (p\_canonical\_user\_id IS NOT NULL AND sab.canonical\_user\_id \= p\_canonical\_user\_id)  
     OR (p\_privy\_user\_id IS NOT NULL AND sab.privy\_user\_id \= p\_privy\_user\_id)  
     OR (uuid\_val IS NOT NULL AND sab.user\_id \= uuid\_val)  
     OR (p\_user\_id IS NOT NULL AND sab.wallet\_address \= p\_user\_id);  
END;  
$function$  
"  
public,get\_sub\_account\_balance\_flexible,"p\_canonical\_user\_id text, p\_wallet\_address text, p\_currency text, p\_include\_pending boolean","p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_currency text DEFAULT 'USD'::text, p\_include\_pending boolean DEFAULT false",numeric,plpgsql,true,v,false,false,"Flexible balance lookup that accepts either canonical\_user\_id or wallet\_address.  
Parameters:  
\- p\_canonical\_user\_id: prize:pid: format user ID (preferred)  
\- p\_wallet\_address: Ethereum wallet address (0x...) for fallback lookup  
\- p\_currency: Currency code (default USD)  
\- p\_include\_pending: Include pending\_balance in result (default false)

Examples:  
\- By canonical ID: SELECT get\_sub\_account\_balance\_flexible('prize:pid:0xaa284ddd...', NULL, 'USD', true);  
\- By wallet: SELECT get\_sub\_account\_balance\_flexible(NULL, '0xaa284ddd...', 'USD', true);","CREATE OR REPLACE FUNCTION public.get\_sub\_account\_balance\_flexible(p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_currency text DEFAULT 'USD'::text, p\_include\_pending boolean DEFAULT false)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  resolved\_cid TEXT;  
  v\_balance NUMERIC := 0;  
  v\_pending NUMERIC := 0;  
  search\_wallet TEXT;  
BEGIN  
  \-- STEP 1: Resolve the canonical\_user\_id  
  \-- If p\_canonical\_user\_id is provided, use it directly  
  \-- If only p\_wallet\_address is provided, resolve it to canonical\_user\_id via canonical\_users

  IF p\_canonical\_user\_id IS NOT NULL AND p\_canonical\_user\_id \!= '' THEN  
    \-- Use the provided canonical\_user\_id  
    resolved\_cid := p\_canonical\_user\_id;  
  ELSIF p\_wallet\_address IS NOT NULL AND p\_wallet\_address \!= '' THEN  
    \-- Resolve wallet address to canonical\_user\_id via canonical\_users  
    SELECT cu.canonical\_user\_id INTO resolved\_cid  
    FROM public.canonical\_users cu  
    WHERE  
      LOWER(COALESCE(cu.wallet\_address, '')) \= LOWER(p\_wallet\_address)  
      OR LOWER(COALESCE(cu.base\_wallet\_address, '')) \= LOWER(p\_wallet\_address)  
      OR LOWER(COALESCE(cu.eth\_wallet\_address, '')) \= LOWER(p\_wallet\_address)  
    LIMIT 1;

    \-- If not found in canonical\_users, construct the canonical ID from wallet  
    IF resolved\_cid IS NULL THEN  
      resolved\_cid := 'prize:pid:' || LOWER(p\_wallet\_address);  
    END IF;  
  ELSE  
    \-- Neither provided, return 0  
    RETURN 0;  
  END IF;

  \-- STEP 2: Extract wallet for additional matching  
  IF resolved\_cid LIKE 'prize:pid:0x%' THEN  
    search\_wallet := LOWER(SUBSTRING(resolved\_cid FROM 11));  
  ELSIF resolved\_cid LIKE '0x%' AND LENGTH(resolved\_cid) \= 42 THEN  
    search\_wallet := LOWER(resolved\_cid);  
  ELSE  
    search\_wallet := NULL;  
  END IF;

  \-- STEP 3: Query sub\_account\_balances with multiple match strategies  
  SELECT  
    COALESCE(b.available\_balance, 0),  
    COALESCE(b.pending\_balance, 0\)  
  INTO v\_balance, v\_pending  
  FROM public.sub\_account\_balances b  
  WHERE b.currency \= COALESCE(p\_currency, 'USD')  
    AND (  
      \-- Match by canonical\_user\_id (exact)  
      b.canonical\_user\_id \= resolved\_cid  
      \-- Match by canonical\_user\_id (lowercase)  
      OR b.canonical\_user\_id \= LOWER(resolved\_cid)  
      \-- Match by wallet in canonical format  
      OR (search\_wallet IS NOT NULL AND b.canonical\_user\_id \= 'prize:pid:' || search\_wallet)  
      \-- Match by user\_id (legacy)  
      OR b.user\_id \= resolved\_cid  
      \-- Match by privy\_user\_id (legacy)  
      OR b.privy\_user\_id \= resolved\_cid  
    )  
  ORDER BY  
    CASE  
      WHEN b.canonical\_user\_id \= resolved\_cid THEN 0  
      WHEN b.canonical\_user\_id \= LOWER(resolved\_cid) THEN 1  
      WHEN search\_wallet IS NOT NULL AND b.canonical\_user\_id \= 'prize:pid:' || search\_wallet THEN 2  
      ELSE 3  
    END  
  LIMIT 1;

  \-- STEP 4: Return balance (with or without pending)  
  IF p\_include\_pending THEN  
    RETURN COALESCE(v\_balance, 0\) \+ COALESCE(v\_pending, 0);  
  ELSE  
    RETURN COALESCE(v\_balance, 0);  
  END IF;  
END;  
$function$  
"  
public,get\_ticket\_availability,p\_competition uuid,p\_competition uuid,jsonb,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_ticket\_availability(p\_competition uuid)  
 RETURNS jsonb  
 LANGUAGE sql  
 STABLE  
AS $function$  
  with comp as (  
    select c.id,  
           c.total\_tickets::int as total\_tickets  
    from public.competitions c  
    where c.id \= p\_competition  
  ),  
  sold as (  
    select count(\*)::int as sold\_count  
    from public.tickets t  
    where t.competition\_id \= p\_competition  
      and (  
        t.status \= 'sold'  
        or t.purchased\_at is not null  
        or t.order\_id is not null  
        or t.is\_active \= false  
      )  
  ),  
  pending as (  
    select count(\*)::int as pending\_count  
    from public.pending\_ticket\_items pti  
    join public.pending\_tickets pt on pt.id \= pti.pending\_ticket\_id  
    where pti.competition\_id \= p\_competition  
      and pti.status \= 'pending'  
      and (pt.expires\_at is null or pt.expires\_at \> now())  
  )  
  select jsonb\_build\_object(  
    'total\_tickets', coalesce(comp.total\_tickets, 0),  
    'sold\_count', coalesce(sold.sold\_count, 0),  
    'pending\_count', coalesce(pending.pending\_count, 0),  
    'available\_count', greatest(coalesce(comp.total\_tickets, 0\) \- (coalesce(sold.sold\_count,0) \+ coalesce(pending.pending\_count,0)), 0\)  
  )  
  from comp, sold, pending;  
$function$  
"  
public,get\_unavailable\_ticket\_numbers,p\_competition uuid,p\_competition uuid,int4,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_unavailable\_ticket\_numbers(p\_competition uuid)  
 RETURNS TABLE(ticket\_number integer)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT t.ticket\_number  
  FROM public.tickets t  
  WHERE t.competition\_id \= p\_competition AND t.status \<\> 'available'  
  UNION  
  SELECT pti.ticket\_number  
  FROM public.pending\_ticket\_items pti  
  JOIN public.pending\_tickets pt ON pt.id \= pti.pending\_ticket\_id  
  WHERE pti.competition\_id \= p\_competition  
    AND pt.status \= 'pending'  
    AND (pt.expires\_at IS NULL OR pt.expires\_at \> now())  
$function$  
"  
public,get\_unavailable\_tickets,competition\_id uuid,competition\_id uuid,int4,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_unavailable\_tickets(competition\_id uuid)  
 RETURNS TABLE(ticket\_number integer)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  \-- Unavailable \= sold tickets from tickets table OR currently held in pending items  
  SELECT t.ticket\_number  
  FROM public.tickets t  
  WHERE t.competition\_id \= competition\_id AND (t.status \<\> 'available' OR t.is\_active \= false)  
  UNION  
  SELECT pti.ticket\_number  
  FROM public.pending\_ticket\_items pti  
  WHERE pti.competition\_id \= competition\_id AND pti.status \= 'pending' AND (pti.expires\_at IS NULL OR pti.expires\_at \> now());  
$function$  
"  
public,get\_unavailable\_tickets,p\_competition\_id text,p\_competition\_id text,\_int4,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_unavailable\_tickets(p\_competition\_id text)  
 RETURNS integer\[\]  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_competition\_uuid UUID;  
  v\_comp\_uid TEXT;  
  v\_unavailable INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
  v\_sold\_jc INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
  v\_sold\_tickets INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
  v\_pending INTEGER\[\] := ARRAY\[\]::INTEGER\[\];  
BEGIN  
  IF p\_competition\_id IS NULL OR TRIM(p\_competition\_id) \= '' THEN   
    RETURN ARRAY\[\]::INTEGER\[\];   
  END IF;  
    
  \-- Try to parse as UUID  
  BEGIN   
    v\_competition\_uuid := p\_competition\_id::UUID;  
  EXCEPTION WHEN invalid\_text\_representation THEN  
    SELECT c.id, c.uid INTO v\_competition\_uuid, v\_comp\_uid   
    FROM competitions c WHERE c.uid \= p\_competition\_id LIMIT 1;  
    IF v\_competition\_uuid IS NULL THEN   
      RETURN ARRAY\[\]::INTEGER\[\];   
    END IF;  
  END;  
    
  IF v\_comp\_uid IS NULL THEN   
    SELECT c.uid INTO v\_comp\_uid FROM competitions c WHERE c.id \= v\_competition\_uuid;   
  END IF;

  \-- Get tickets from joincompetition  
  BEGIN   
    SELECT COALESCE(array\_agg(DISTINCT ticket\_num), ARRAY\[\]::INTEGER\[\]) INTO v\_sold\_jc  
    FROM (  
      SELECT CAST(TRIM(unnest(string\_to\_array(ticketnumbers::TEXT, ','))) AS INTEGER) AS ticket\_num   
      FROM joincompetition  
      WHERE (competitionid \= v\_competition\_uuid::TEXT OR (v\_comp\_uid IS NOT NULL AND competitionid \= v\_comp\_uid) OR competitionid \= p\_competition\_id)  
      AND ticketnumbers IS NOT NULL AND TRIM(ticketnumbers::TEXT) \!= ''  
    ) AS jc\_tickets   
    WHERE ticket\_num IS NOT NULL;  
  EXCEPTION WHEN OTHERS THEN   
    v\_sold\_jc := ARRAY\[\]::INTEGER\[\];   
  END;

  \-- Get tickets from tickets table  
  BEGIN   
    SELECT COALESCE(array\_agg(DISTINCT t.ticket\_number), ARRAY\[\]::INTEGER\[\]) INTO v\_sold\_tickets   
    FROM tickets t  
    WHERE t.competition\_id \= v\_competition\_uuid;  
  EXCEPTION WHEN OTHERS THEN   
    v\_sold\_tickets := ARRAY\[\]::INTEGER\[\];   
  END;

  \-- Get pending tickets  
  BEGIN   
    SELECT COALESCE(array\_agg(DISTINCT pti.ticket\_number), ARRAY\[\]::INTEGER\[\]) INTO v\_pending   
    FROM pending\_ticket\_items pti  
    INNER JOIN pending\_tickets pt ON pti.pending\_ticket\_id \= pt.id  
    WHERE pti.competition\_id \= v\_competition\_uuid  
    AND pt.status IN ('pending', 'confirming')   
    AND pt.expires\_at \> NOW()   
    AND pti.ticket\_number IS NOT NULL;  
  EXCEPTION WHEN OTHERS THEN   
    v\_pending := ARRAY\[\]::INTEGER\[\];   
  END;

  v\_unavailable := COALESCE(v\_sold\_jc, ARRAY\[\]::INTEGER\[\]) || COALESCE(v\_sold\_tickets, ARRAY\[\]::INTEGER\[\]) || COALESCE(v\_pending, ARRAY\[\]::INTEGER\[\]);  
    
  IF array\_length(v\_unavailable, 1\) IS NOT NULL AND array\_length(v\_unavailable, 1\) \> 0 THEN  
    SELECT COALESCE(array\_agg(DISTINCT u ORDER BY u), ARRAY\[\]::INTEGER\[\]) INTO v\_unavailable   
    FROM unnest(v\_unavailable) AS u WHERE u IS NOT NULL;  
  ELSE   
    v\_unavailable := ARRAY\[\]::INTEGER\[\];   
  END IF;  
    
  RETURN v\_unavailable;  
END;  
$function$  
"  
public,get\_unavailable\_tickets\_legacy,p\_competition\_id uuid,p\_competition\_id uuid,int4,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_unavailable\_tickets\_legacy(p\_competition\_id uuid)  
 RETURNS TABLE(ticket\_number integer)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT \* FROM public.get\_unavailable\_tickets(competition\_id := p\_competition\_id);  
$function$  
"  
public,get\_user\_active\_tickets,user\_identifier text,user\_identifier text,tickets,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_active\_tickets(user\_identifier text)  
 RETURNS SETOF tickets  
 LANGUAGE sql  
 STABLE  
AS $function$  
  WITH ident AS (  
    SELECT \* FROM public.to\_canonical\_filter(user\_identifier)  
  ), active\_pendings AS (  
    SELECT pt.id FROM public.pending\_tickets pt  
    WHERE pt.status \= 'pending' AND (pt.expires\_at IS NULL OR pt.expires\_at \> now())  
  )  
  SELECT t.\*  
  FROM public.tickets t  
  WHERE (  
    EXISTS (  
      SELECT 1 FROM ident i  
      WHERE (i.canonical\_user\_id IS NOT NULL AND i.canonical\_user\_id \= t.canonical\_user\_id)  
         OR (i.wallet\_address IS NOT NULL AND lower(i.wallet\_address) \= lower(t.wallet\_address))  
         OR (i.user\_id IS NOT NULL AND i.user\_id::text \= t.user\_id::text)  
         OR (i.privy\_user\_id IS NOT NULL AND i.privy\_user\_id \= t.privy\_user\_id)  
    )  
  )  
    AND t.is\_active IS TRUE  
    AND (t.status IN ('available','purchased') OR t.pending\_ticket\_id \= ANY (SELECT id FROM active\_pendings))  
  ORDER BY t.created\_at DESC  
$function$  
"  
public,get\_user\_balance,"p\_user\_identifier text, p\_canonical\_user\_id text","p\_user\_identifier text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_user\_balance(p\_user\_identifier text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  user\_balance NUMERIC := 0;  
  bonus\_bal NUMERIC := 0;  
  search\_wallet TEXT;  
  identifier TEXT;  
BEGIN  
  identifier := COALESCE(p\_user\_identifier, p\_canonical\_user\_id);  
  IF identifier IS NULL OR identifier \= '' THEN  
    RETURN jsonb\_build\_object('success', true, 'balance', 0, 'bonus\_balance', 0, 'total\_balance', 0);  
  END IF;

  IF identifier LIKE 'prize:pid:0x%' THEN search\_wallet := LOWER(SUBSTRING(identifier FROM 11));  
  ELSIF identifier LIKE '0x%' AND LENGTH(identifier) \= 42 THEN search\_wallet := LOWER(identifier);  
  ELSE search\_wallet := NULL; END IF;

  BEGIN  
    SELECT COALESCE(available\_balance, 0), COALESCE(sab.bonus\_balance, 0\) INTO user\_balance, bonus\_bal  
    FROM public.sub\_account\_balances sab WHERE currency \= 'USD'  
    AND (canonical\_user\_id \= identifier OR canonical\_user\_id \= LOWER(identifier) OR (search\_wallet IS NOT NULL AND canonical\_user\_id \= 'prize:pid:' || search\_wallet) OR user\_id \= identifier OR privy\_user\_id \= identifier)  
    ORDER BY available\_balance DESC NULLS LAST LIMIT 1;  
    IF user\_balance IS NOT NULL AND user\_balance \> 0 THEN  
      RETURN jsonb\_build\_object('success', true, 'balance', user\_balance, 'bonus\_balance', bonus\_bal, 'total\_balance', user\_balance \+ bonus\_bal);  
    END IF;  
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN  
    SELECT COALESCE(usdc\_balance, 0), COALESCE(cu.bonus\_balance, 0\) INTO user\_balance, bonus\_bal  
    FROM public.canonical\_users cu WHERE canonical\_user\_id \= identifier OR canonical\_user\_id \= LOWER(identifier)  
    OR (search\_wallet IS NOT NULL AND LOWER(wallet\_address) \= search\_wallet) OR (search\_wallet IS NOT NULL AND LOWER(base\_wallet\_address) \= search\_wallet)  
    OR LOWER(wallet\_address) \= LOWER(identifier) OR privy\_user\_id \= identifier  
    ORDER BY usdc\_balance DESC NULLS LAST LIMIT 1;  
  EXCEPTION WHEN OTHERS THEN user\_balance := 0; bonus\_bal := 0; END;

  RETURN jsonb\_build\_object('success', true, 'balance', COALESCE(user\_balance, 0), 'bonus\_balance', COALESCE(bonus\_bal, 0), 'total\_balance', COALESCE(user\_balance, 0\) \+ COALESCE(bonus\_bal, 0));  
END;  
$function$  
"  
public,get\_user\_balance,"user\_identifier uuid, in\_currency text","user\_identifier uuid, in\_currency text DEFAULT 'USD'::text",record,sql,false,s,false,true,UUID overload for compatibility; casts to text identifiers.,"CREATE OR REPLACE FUNCTION public.get\_user\_balance(user\_identifier uuid, in\_currency text DEFAULT 'USD'::text)  
 RETURNS TABLE(user\_id text, available\_balance numeric, pending\_balance numeric)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT  
    COALESCE(sab.canonical\_user\_id, sab.privy\_user\_id, sab.user\_id) AS user\_id,  
    COALESCE(sab.available\_balance, 0\) AS available\_balance,  
    COALESCE(sab.pending\_balance, 0\) AS pending\_balance  
  FROM public.sub\_account\_balances sab  
  WHERE sab.currency \= in\_currency  
    AND (  
      sab.canonical\_user\_id \= user\_identifier::text  
      OR sab.privy\_user\_id \= user\_identifier::text  
      OR sab.user\_id \= user\_identifier::text  
    )  
  ORDER BY sab.last\_updated DESC NULLS LAST  
  LIMIT 1;  
$function$  
"  
public,get\_user\_balance\_by\_canonical\_id,p\_canonical\_user\_id text,p\_canonical\_user\_id text,record,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_balance\_by\_canonical\_id(p\_canonical\_user\_id text)  
 RETURNS TABLE(canonical\_user\_id text, usdc\_balance numeric, bonus\_balance numeric)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  select cu.canonical\_user\_id, cu.usdc\_balance, cu.bonus\_balance  
  from public.canonical\_users cu  
  where cu.canonical\_user\_id \= p\_canonical\_user\_id  
$function$  
"  
public,get\_user\_by\_wallet,p\_wallet\_address text,p\_wallet\_address text,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_by\_wallet(p\_wallet\_address text)  
 RETURNS TABLE(id uuid, canonical\_user\_id text, wallet\_address text, usdc\_balance numeric, has\_used\_new\_user\_bonus boolean)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  RETURN QUERY  
  SELECT   
    cu.id, cu.canonical\_user\_id, cu.wallet\_address,  
    COALESCE(wb.balance, 0)::DECIMAL(20,8) AS usdc\_balance,  
    cu.has\_used\_new\_user\_bonus  
  FROM canonical\_users cu  
  LEFT JOIN wallet\_balances wb ON wb.canonical\_user\_id \= cu.canonical\_user\_id  
  WHERE cu.wallet\_address \= p\_wallet\_address  
     OR cu.base\_wallet\_address \= p\_wallet\_address  
     OR cu.eth\_wallet\_address \= p\_wallet\_address  
  LIMIT 1;  
END;  
$function$  
"  
public,get\_user\_competition\_entries,p\_user\_identifier text,p\_user\_identifier text,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_competition\_entries(p\_user\_identifier text)  
 RETURNS TABLE(competition\_id text, competition\_title text, tickets\_count integer, amount\_spent numeric, is\_winner boolean, latest\_purchase\_at timestamp with time zone)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_canonical\_user\_id TEXT;  
  search\_wallet TEXT;  
BEGIN  
  \-- Extract wallet  
  IF p\_user\_identifier LIKE 'prize:pid:0x%' THEN  
    search\_wallet := LOWER(SUBSTRING(p\_user\_identifier FROM 11));  
  ELSIF p\_user\_identifier LIKE '0x%' THEN  
    search\_wallet := LOWER(p\_user\_identifier);  
  END IF;

  \-- Resolve user  
  SELECT canonical\_user\_id INTO v\_canonical\_user\_id  
  FROM canonical\_users  
  WHERE canonical\_user\_id \= p\_user\_identifier  
     OR uid \= p\_user\_identifier  
     OR (search\_wallet IS NOT NULL AND LOWER(wallet\_address) \= search\_wallet)  
  LIMIT 1;

  \-- Return entries from both competition\_entries AND joincompetition  
  RETURN QUERY  
  WITH all\_entries AS (  
    \-- From competition\_entries  
    SELECT   
      ce.competition\_id,  
      c.title AS competition\_title,  
      ce.tickets\_count,  
      ce.amount\_spent,  
      ce.is\_winner,  
      ce.latest\_purchase\_at  
    FROM competition\_entries ce  
    LEFT JOIN competitions c ON ce.competition\_id \= c.id OR ce.competition\_id \= c.uid  
    WHERE ce.canonical\_user\_id \= v\_canonical\_user\_id

    UNION ALL

    \-- From joincompetition (where old data is\!)  
    SELECT  
      jc.competitionid AS competition\_id,  
      c.title AS competition\_title,  
      jc.numberoftickets AS tickets\_count,  
      jc.amountspent AS amount\_spent,  
      false AS is\_winner,  
      jc.purchasedate AS latest\_purchase\_at  
    FROM joincompetition jc  
    LEFT JOIN competitions c ON jc.competitionid \= c.id::TEXT OR jc.competitionid \= c.uid  
    WHERE jc.canonical\_user\_id \= v\_canonical\_user\_id  
       OR jc.userid \= v\_canonical\_user\_id  
       OR jc.privy\_user\_id \= v\_canonical\_user\_id  
       OR (search\_wallet IS NOT NULL AND LOWER(jc.wallet\_address) \= search\_wallet)  
  )  
  SELECT DISTINCT ON (ae.competition\_id)  
    ae.competition\_id,  
    ae.competition\_title,  
    ae.tickets\_count,  
    ae.amount\_spent,  
    ae.is\_winner,  
    ae.latest\_purchase\_at  
  FROM all\_entries ae  
  ORDER BY ae.competition\_id, ae.latest\_purchase\_at DESC;  
END;  
$function$  
"  
public,get\_user\_dashboard\_entries,"p\_canonical\_user\_id text, p\_include\_pending boolean","p\_canonical\_user\_id text, p\_include\_pending boolean DEFAULT false",jsonb,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_user\_dashboard\_entries(p\_canonical\_user\_id text, p\_include\_pending boolean DEFAULT false)  
 RETURNS jsonb  
 LANGUAGE sql  
 STABLE  
AS $function$  
  with u as (  
    select cu.id as user\_pk,  
           cu.canonical\_user\_id,  
           cu.wallet\_address,  
           cu.base\_wallet\_address,  
           cu.eth\_wallet\_address,  
           coalesce(cu.usdc\_balance, 0\) as usdc\_balance,  
           coalesce(cu.bonus\_balance, 0\) as bonus\_balance  
    from public.canonical\_users cu  
    where cu.canonical\_user\_id \= p\_canonical\_user\_id  
  ),  
  balances as (  
    select coalesce(sum(sab.available\_balance),0) as available\_balance,  
           coalesce(sum(sab.pending\_balance),0)   as pending\_balance  
    from public.sub\_account\_balances sab  
    join u on sab.canonical\_user\_id \= u.canonical\_user\_id  
    where sab.currency \= 'USD'  
  ),  
  entries\_from\_ce as (  
    select ce.competition\_id,  
           ce.tickets\_count as ticket\_count,  
           ce.amount\_spent,  
           ce.created\_at as first\_purchase\_at,  
           ce.latest\_purchase\_at as last\_purchase\_at,  
           c.title,  
           c.image\_url  
    from public.competition\_entries ce  
    join u on ce.canonical\_user\_id \= u.canonical\_user\_id  
    left join public.competitions c on c.id \= ce.competition\_id  
  ),  
  wins as (  
    select w.competition\_id,  
           count(\*)::int as win\_count,  
           jsonb\_agg(jsonb\_build\_object(  
             'ticket\_number', w.ticket\_number,  
             'prize', w.prize,  
             'prize\_value', w.prize\_value,  
             'won\_at', w.won\_at  
           ) order by w.won\_at) as details  
    from public.winners w  
    join u on (w.wallet\_address is not null and lower(w.wallet\_address) in (  
                 lower(u.wallet\_address), lower(u.base\_wallet\_address), lower(u.eth\_wallet\_address)  
               ))  
    group by w.competition\_id  
  ),  
  user\_json as (  
    select jsonb\_build\_object(  
      'canonical\_user\_id', u.canonical\_user\_id,  
      'wallet\_address', u.wallet\_address,  
      'base\_wallet\_address', u.base\_wallet\_address,  
      'eth\_wallet\_address', u.eth\_wallet\_address,  
      'usdc\_balance', u.usdc\_balance,  
      'bonus\_balance', u.bonus\_balance  
    ) as data  
    from u  
  ),  
  balances\_json as (  
    select jsonb\_build\_object(  
      'available', coalesce(balances.available\_balance,0),  
      'pending', coalesce(balances.pending\_balance,0)  
    ) as data  
    from balances  
  ),  
  entries\_json as (  
    select coalesce(jsonb\_agg(jsonb\_build\_object(  
      'competition\_id', e.competition\_id,  
      'ticket\_count', e.ticket\_count,  
      'amount\_spent', coalesce(e.amount\_spent, 0),  
      'title', e.title,  
      'image\_url', e.image\_url,  
      'first\_purchase\_at', e.first\_purchase\_at,  
      'last\_purchase\_at', e.last\_purchase\_at,  
      'wins', coalesce(wins.details, '\[\]'::jsonb)  
    ) order by e.last\_purchase\_at desc) filter (where e.competition\_id is not null), '\[\]'::jsonb) as data  
    from entries\_from\_ce e  
    left join wins on wins.competition\_id \= e.competition\_id  
  )  
  select jsonb\_build\_object(  
    'user', coalesce((select data from user\_json), '{}'::jsonb),  
    'balances', coalesce((select data from balances\_json), '{}'::jsonb),  
    'entries', coalesce((select data from entries\_json), '\[\]'::jsonb)  
  );  
$function$  
"  
public,get\_user\_stats,p\_wallet\_address text,p\_wallet\_address text,json,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_user\_stats(p\_wallet\_address text)  
 RETURNS json  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
    v\_user\_id UUID;  
    total\_spent DECIMAL(18,8);  
    total\_tickets INTEGER;  
    total\_wins INTEGER;  
    total\_prizes\_won DECIMAL(18,8);  
    result JSON;  
BEGIN  
    \-- Get user ID by wallet address  
    SELECT id INTO v\_user\_id   
    FROM users   
    WHERE wallet\_address \= p\_wallet\_address;  
      
    IF v\_user\_id IS NULL THEN  
        RETURN json\_build\_object(  
            'error', 'User not found',  
            'wallet\_address', p\_wallet\_address  
        );  
    END IF;  
      
    \-- Get comprehensive statistics  
    SELECT   
        COALESCE(SUM(t.purchase\_price), 0),  
        COUNT(t.id),  
        COUNT(CASE WHEN w.id IS NOT NULL THEN 1 END),  
        COALESCE(SUM(w.prize\_amount), 0\)  
    INTO total\_spent, total\_tickets, total\_wins, total\_prizes\_won  
    FROM tickets t  
    LEFT JOIN winners w ON t.user\_id \= w.user\_id AND t.competition\_id \= w.competition\_id  
    WHERE t.user\_id \= v\_user\_id  
      AND t.is\_cancelled \= FALSE;  
      
    result := json\_build\_object(  
        'user\_id', v\_user\_id,  
        'wallet\_address', p\_wallet\_address,  
        'total\_spent', total\_spent,  
        'total\_tickets\_purchased', total\_tickets,  
        'total\_wins', total\_wins,  
        'total\_prizes\_won', total\_prizes\_won,  
        'win\_rate', CASE   
            WHEN total\_tickets \> 0 THEN ROUND((total\_wins::DECIMAL / total\_tickets) \* 100, 2\)  
            ELSE 0   
        END  
    );  
      
    RETURN result;  
END;  
$function$  
"  
public,get\_user\_ticket\_count,user\_identifier text,user\_identifier text,int4,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_user\_ticket\_count(user\_identifier text)  
 RETURNS integer  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE v\_user\_uuid UUID; v\_count INTEGER:=0; BEGIN  
  SELECT id INTO v\_user\_uuid FROM canonical\_users WHERE uid=user\_identifier OR wallet\_address=user\_identifier OR base\_wallet\_address=user\_identifier LIMIT 1;  
  IF v\_user\_uuid IS NOT NULL THEN SELECT COUNT(\*) INTO v\_count FROM tickets t WHERE t.purchased\_by \= v\_user\_uuid AND t.status='sold'; END IF;  
  RETURN COALESCE(v\_count,0); END; $function$  
"  
public,get\_user\_tickets,"user\_identifier text, p\_identifier text","user\_identifier text DEFAULT NULL::text, p\_identifier text DEFAULT NULL::text",record,plpgsql,true,s,false,true,Returns all tickets for a user. Accepts user\_identifier OR p\_identifier parameter for backward compatibility.,"CREATE OR REPLACE FUNCTION public.get\_user\_tickets(user\_identifier text DEFAULT NULL::text, p\_identifier text DEFAULT NULL::text)  
 RETURNS TABLE(id uuid, competition\_id uuid, ticket\_number integer, user\_id text, canonical\_user\_id text, purchase\_price numeric, purchased\_at timestamp with time zone, is\_winner boolean, created\_at timestamp with time zone)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  lower\_identifier TEXT;  
  identifier TEXT;  
BEGIN  
  \-- Accept either parameter name  
  identifier := COALESCE(user\_identifier, p\_identifier);  
    
  IF identifier IS NULL THEN  
    RETURN;  
  END IF;

  lower\_identifier := LOWER(TRIM(identifier));  
    
  RETURN QUERY  
  SELECT   
    t.id,  
    t.competition\_id,  
    t.ticket\_number,  
    t.user\_id,  
    t.canonical\_user\_id,  
    t.purchase\_price,  
    t.purchased\_at,  
    t.is\_winner,  
    t.created\_at  
  FROM tickets t  
  WHERE   
    \-- Use LOWER() and eq instead of ilike to avoid UUID type errors  
    LOWER(t.user\_id) \= lower\_identifier  
    OR t.canonical\_user\_id \= identifier  
  ORDER BY t.purchased\_at DESC;  
END;  
$function$  
"  
public,get\_user\_tickets\_bypass\_rls,user\_identifier text,user\_identifier text,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_tickets\_bypass\_rls(user\_identifier text)  
 RETURNS TABLE(id text, competition\_id text, ticket\_number integer, ticket\_numbers text, number\_of\_tickets integer, amount\_spent numeric, purchase\_date timestamp with time zone, wallet\_address text, transaction\_hash text, is\_active boolean)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  lower\_identifier TEXT;  
BEGIN  
  IF user\_identifier IS NULL OR TRIM(user\_identifier) \= '' THEN  
    RETURN;  
  END IF;  
  user\_identifier := TRIM(user\_identifier);  
  lower\_identifier := LOWER(user\_identifier);

  RETURN QUERY  
  SELECT  
    COALESCE(jc.uid, 'jc-' || jc.competitionid::TEXT || '-' || jc.id::TEXT)::TEXT AS id,  
    jc.competitionid::TEXT AS competition\_id,  
    NULL::INTEGER AS ticket\_number,  
    jc.ticketnumbers::TEXT AS ticket\_numbers,  
    COALESCE(jc.numberoftickets, 1)::INTEGER AS number\_of\_tickets,  
    COALESCE(jc.amountspent, 0)::NUMERIC AS amount\_spent,  
    COALESCE(jc.purchasedate, jc.created\_at, NOW())::TIMESTAMPTZ AS purchase\_date,  
    jc.walletaddress::TEXT AS wallet\_address,  
    jc.transactionhash::TEXT AS transaction\_hash,  
    CASE  
      WHEN c.id IS NULL THEN FALSE  
      WHEN c.status IN ('completed', 'drawn', 'cancelled') THEN FALSE  
      WHEN c.end\_date IS NOT NULL AND c.end\_date \< NOW() THEN FALSE  
      ELSE TRUE  
    END AS is\_active  
  FROM joincompetition jc  
  LEFT JOIN competitions c ON (jc.competitionid::TEXT \= c.id::TEXT OR jc.competitionid::TEXT \= c.uid::TEXT)  
  WHERE (jc.privy\_user\_id \= user\_identifier OR jc.userid \= user\_identifier OR LOWER(jc.walletaddress) \= lower\_identifier)  
  AND jc.competitionid IS NOT NULL

  UNION ALL

  SELECT  
    ('t-' || t.id::TEXT) AS id,  
    t.competition\_id::TEXT AS competition\_id,  
    t.ticket\_number::INTEGER AS ticket\_number,  
    t.ticket\_number::TEXT AS ticket\_numbers,  
    1::INTEGER AS number\_of\_tickets,  
    COALESCE(t.purchase\_price, t.payment\_amount, 0)::NUMERIC AS amount\_spent,  
    COALESCE(t.purchase\_date, t.created\_at, NOW())::TIMESTAMPTZ AS purchase\_date,  
    NULL::TEXT AS wallet\_address,  
    t.payment\_tx\_hash::TEXT AS transaction\_hash,  
    CASE  
      WHEN c.id IS NULL THEN FALSE  
      WHEN c.status IN ('completed', 'drawn', 'cancelled') THEN FALSE  
      WHEN c.end\_date IS NOT NULL AND c.end\_date \< NOW() THEN FALSE  
      ELSE TRUE  
    END AS is\_active  
  FROM tickets t  
  LEFT JOIN competitions c ON t.competition\_id \= c.id  
  WHERE (t.privy\_user\_id \= user\_identifier OR LOWER(t.privy\_user\_id) \= lower\_identifier)  
  AND t.competition\_id IS NOT NULL  
  ORDER BY purchase\_date DESC;  
END;  
$function$  
"  
public,get\_user\_tickets\_for\_competition,"competition\_id uuid, user\_id text","competition\_id uuid, user\_id text",record,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_tickets\_for\_competition(competition\_id uuid, user\_id text)  
 RETURNS TABLE(ticket\_number integer, purchase\_date timestamp with time zone, wallet\_address text, user\_id\_out text, canonical\_user\_id text, transaction\_hash text)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  \-- Prefer normalized tickets  
  SELECT  
    t.ticket\_number,  
    COALESCE(t.purchase\_date, t.purchased\_at, t.created\_at) AS purchase\_date,  
    t.wallet\_address,  
    t.user\_id AS user\_id\_out,  
    t.canonical\_user\_id,  
    COALESCE(t.tx\_id, t.payment\_tx\_hash) AS transaction\_hash  
  FROM public.tickets t  
  WHERE t.competition\_id \= get\_user\_tickets\_for\_competition.competition\_id  
    AND t.ticket\_number IS NOT NULL  
    AND (  
      t.user\_id \= get\_user\_tickets\_for\_competition.user\_id  
      OR t.canonical\_user\_id \= get\_user\_tickets\_for\_competition.user\_id  
      OR t.wallet\_address \= get\_user\_tickets\_for\_competition.user\_id  
      OR t.privy\_user\_id \= get\_user\_tickets\_for\_competition.user\_id  
    )

  UNION ALL

  \-- Legacy joincompetition (ticketnumbers CSV)  
  SELECT  
    (regexp\_split\_to\_table(j.ticketnumbers, E'\\\\s\*,\\\\s\*'))::int AS ticket\_number,  
    j.purchasedate AS purchase\_date,  
    j.wallet\_address,  
    j.userid AS user\_id\_out,  
    j.canonical\_user\_id,  
    j.transactionhash AS transaction\_hash  
  FROM public.joincompetition j  
  WHERE j.competitionid \= get\_user\_tickets\_for\_competition.competition\_id  
    AND (  
      j.userid \= get\_user\_tickets\_for\_competition.user\_id  
      OR j.canonical\_user\_id \= get\_user\_tickets\_for\_competition.user\_id  
      OR j.wallet\_address \= get\_user\_tickets\_for\_competition.user\_id  
      OR j.privy\_user\_id \= get\_user\_tickets\_for\_competition.user\_id  
    );  
$function$  
"  
public,get\_user\_tickets\_for\_competition,"p\_user\_id text, p\_competition\_id uuid","p\_user\_id text, p\_competition\_id uuid",record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_tickets\_for\_competition(p\_user\_id text, p\_competition\_id uuid)  
 RETURNS TABLE(ticket\_number integer, purchase\_date timestamp with time zone)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
AS $function$  
BEGIN  
  RETURN QUERY  
  SELECT t.ticket\_number::INTEGER, t.created\_at as purchase\_date  
  FROM tickets t  
  WHERE t.competition\_id \= p\_competition\_id   
    AND (t.user\_id \= p\_user\_id OR t.user\_id ILIKE '%' || p\_user\_id || '%')  
  ORDER BY t.ticket\_number;  
END;  
$function$  
"  
public,get\_user\_tickets\_for\_competition\_legacy,"p\_competition\_id uuid, p\_user\_id text","p\_competition\_id uuid, p\_user\_id text",record,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_tickets\_for\_competition\_legacy(p\_competition\_id uuid, p\_user\_id text)  
 RETURNS TABLE(ticket\_number integer, purchase\_date timestamp with time zone, wallet\_address text, user\_id\_out text, canonical\_user\_id text, transaction\_hash text)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT \* FROM public.get\_user\_tickets\_for\_competition(competition\_id := p\_competition\_id, user\_id := p\_user\_id);  
$function$  
"  
public,get\_user\_transactions,user\_identifier text,user\_identifier text,jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_user\_transactions(user\_identifier text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE v\_transactions JSONB; v\_canonical\_user\_id TEXT; search\_wallet TEXT;  
BEGIN  
  IF user\_identifier LIKE 'prize:pid:0x%' THEN search\_wallet := LOWER(SUBSTRING(user\_identifier FROM 11));  
  ELSIF user\_identifier LIKE '0x%' THEN search\_wallet := LOWER(user\_identifier); END IF;

  SELECT cu.canonical\_user\_id INTO v\_canonical\_user\_id FROM canonical\_users cu  
  WHERE cu.canonical\_user\_id \= user\_identifier OR cu.uid \= user\_identifier  
  OR (search\_wallet IS NOT NULL AND LOWER(cu.wallet\_address) \= search\_wallet) LIMIT 1;

  SELECT jsonb\_agg(jsonb\_build\_object('id', id, 'type', type, 'amount', amount, 'currency', currency, 'status', status,  
    'competition\_id', competition\_id, 'ticket\_count', ticket\_count,  
    'created\_at', created\_at, 'payment\_method', method) ORDER BY created\_at DESC) INTO v\_transactions  
  FROM user\_transactions WHERE user\_id \= user\_identifier OR canonical\_user\_id \= v\_canonical\_user\_id OR user\_id \= v\_canonical\_user\_id LIMIT 100;

  \-- Return array directly instead of wrapped object  
  RETURN COALESCE(v\_transactions, '\[\]'::jsonb);  
END;  
$function$  
"  
public,get\_user\_transactions\_bypass\_rls,user\_identifier text,user\_identifier text,user\_transactions,sql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_user\_transactions\_bypass\_rls(user\_identifier text)  
 RETURNS SETOF user\_transactions  
 LANGUAGE sql  
 SECURITY DEFINER  
AS $function$  
  SELECT \*  
  FROM public.user\_transactions ut  
  WHERE  
    ut.canonical\_user\_id \= user\_identifier  
    OR ut.wallet\_address \= user\_identifier  
    OR ut.user\_id \= user\_identifier  
  ORDER BY ut.created\_at DESC;  
$function$  
"  
public,get\_user\_wallet\_balance,user\_identifier text,user\_identifier text,numeric,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_user\_wallet\_balance(user\_identifier text)  
 RETURNS numeric  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  balance NUMERIC;  
  resolved\_id TEXT;  
  lower\_identifier TEXT;  
BEGIN  
  resolved\_id := public.resolve\_canonical\_user\_id(user\_identifier);  
  lower\_identifier := LOWER(user\_identifier);

  SELECT COALESCE(sab.available\_balance, 0\) INTO balance  
  FROM public.sub\_account\_balances sab  
  WHERE sab.currency \= 'USD'  
    AND (  
      sab.canonical\_user\_id \= resolved\_id  
      OR sab.user\_id \= resolved\_id  
      OR LOWER(COALESCE(sab.user\_id, '')) \= lower\_identifier  
      OR LOWER(COALESCE(sab.wallet\_address, '')) \= lower\_identifier  
    )  
  ORDER BY (sab.canonical\_user\_id \= resolved\_id) DESC  
  LIMIT 1;

  RETURN COALESCE(balance, 0);  
END;  
$function$  
"  
public,get\_user\_wallets,user\_identifier text,user\_identifier text,json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.get\_user\_wallets(user\_identifier text)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user RECORD;  
  v\_result JSON;  
BEGIN  
  \-- Find user by various identifiers (case-insensitive for wallet addresses)  
  SELECT \* INTO v\_user  
  FROM canonical\_users cu  
  WHERE cu.canonical\_user\_id \= user\_identifier  
     OR LOWER(cu.wallet\_address) \= LOWER(user\_identifier)  
     OR LOWER(cu.base\_wallet\_address) \= LOWER(user\_identifier)  
     OR LOWER(cu.eth\_wallet\_address) \= LOWER(user\_identifier)  
     OR cu.privy\_user\_id \= user\_identifier  
     OR cu.email ILIKE user\_identifier  
     OR cu.uid::TEXT \= user\_identifier  
  LIMIT 1;

  IF v\_user IS NULL THEN  
    RETURN json\_build\_object('success', false, 'error', 'User not found');  
  END IF;

  \-- Build the response with all wallet information  
  SELECT json\_build\_object(  
    'success', true,  
    'wallets', COALESCE(v\_user.linked\_wallets, '\[\]'::JSONB),  
    'primary\_wallet', v\_user.primary\_wallet\_address,  
    'base\_wallet', v\_user.base\_wallet\_address,  
    'linked\_external\_wallet', v\_user.linked\_external\_wallet  
  ) INTO v\_result;

  RETURN v\_result;  
END;  
$function$  
"  
public,get\_vrf\_history,"p\_competition\_id uuid, p\_limit integer","p\_competition\_id uuid DEFAULT NULL::uuid, p\_limit integer DEFAULT 50",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_vrf\_history(p\_competition\_id uuid DEFAULT NULL::uuid, p\_limit integer DEFAULT 50\)  
 RETURNS TABLE(log\_id uuid, competition\_id uuid, source text, function\_name text, numbers\_generated integer\[\], context text, outcome text, security\_level text, vrf\_tx\_hash text, log\_timestamp timestamp with time zone)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
    RETURN QUERY  
    SELECT  
        rl.id as log\_id,  
        rl.competition\_id,  
        rl.source,  
        rl.function\_name,  
        rl.numbers\_generated,  
        rl.context,  
        rl.outcome,  
        rl.security\_level,  
        rl.vrf\_tx\_hash,  
        rl.timestamp AS log\_timestamp  
    FROM public.rng\_logs rl  
    WHERE (p\_competition\_id IS NULL OR rl.competition\_id \= p\_competition\_id)  
      AND rl.security\_level \= 'HIGH'  
    ORDER BY rl.timestamp DESC  
    LIMIT p\_limit;  
END;  
$function$  
"  
public,get\_winners\_by\_competition,p\_competition\_id uuid,p\_competition\_id uuid,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.get\_winners\_by\_competition(p\_competition\_id uuid)  
 RETURNS TABLE(id uuid, competition\_id uuid, ticket\_id uuid, user\_id uuid, wallet\_address text, prize\_value numeric, prize\_type text, claimed boolean, ticket\_number integer)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
    RETURN QUERY  
    SELECT   
        w.id,  
        w.competition\_id,  
        w.ticket\_id,  
        w.user\_id,  
        u.wallet\_address,  
        w.prize\_amount as prize\_value,  
        w.currency as prize\_type,  
        w.claimed,  
        w.ticket\_number  
    FROM winners w  
    JOIN users u ON w.user\_id \= u.id  
    WHERE w.competition\_id \= p\_competition\_id;  
END;  
$function$  
"  
public,handle\_canonical\_user\_insert,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.handle\_canonical\_user\_insert()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
begin  
  insert into public.sub\_account\_balances (  
    user\_id,  
    canonical\_user\_id,  
    currency,  
    available\_balance,  
    pending\_balance,  
    last\_updated  
  ) values (  
    new.id::text,  
    new.canonical\_user\_id,  
    'USDC',  
    0,  
    0,  
    now()  
  )  
  on conflict (canonical\_user\_id, currency)  
  do update set last\_updated \= excluded.last\_updated;

  return new;  
end;  
$function$  
"  
public,hmac,"bytea, bytea, text","bytea, bytea, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.hmac(bytea, bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_hmac$function$  
"  
public,hmac,"text, text, text","text, text, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.hmac(text, text, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pg\_hmac$function$  
"  
public,index\_exists,"table\_name text, index\_name text","table\_name text, index\_name text",bool,plpgsql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.index\_exists(table\_name text, index\_name text)  
 RETURNS boolean  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
DECLARE  
  exists\_bool boolean;  
BEGIN  
  SELECT EXISTS (  
    SELECT 1  
    FROM pg\_indexes  
    WHERE schemaname \= 'public'  
      AND tablename \= table\_name  
      AND indexname \= index\_name  
  ) INTO exists\_bool;  
  RETURN exists\_bool;  
END;  
$function$  
"  
public,init\_sub\_balance\_after\_canonical\_user,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.init\_sub\_balance\_after\_canonical\_user()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  INSERT INTO public.sub\_account\_balances (canonical\_user\_id, user\_id, currency, available\_balance, pending\_balance, last\_updated)  
  VALUES (NEW.canonical\_user\_id, NEW.uid, 'USD', 0, 0, now())  
  ON CONFLICT DO NOTHING;  
  RETURN NEW;  
END;  
$function$  
"  
public,insert\_rng\_log,"p\_timestamp timestamp with time zone, p\_source text, p\_function\_name text, p\_competition\_id uuid, p\_competition\_type text, p\_context text, p\_outcome text, p\_is\_winner boolean, p\_security\_level text","p\_timestamp timestamp with time zone, p\_source text, p\_function\_name text, p\_competition\_id uuid, p\_competition\_type text, p\_context text, p\_outcome text, p\_is\_winner boolean DEFAULT false, p\_security\_level text DEFAULT 'MEDIUM'::text",bool,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.insert\_rng\_log(p\_timestamp timestamp with time zone, p\_source text, p\_function\_name text, p\_competition\_id uuid, p\_competition\_type text, p\_context text, p\_outcome text, p\_is\_winner boolean DEFAULT false, p\_security\_level text DEFAULT 'MEDIUM'::text)  
 RETURNS boolean  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
    log\_id UUID;  
BEGIN  
    INSERT INTO rng\_logs (  
        timestamp, source, function\_name, competition\_id,   
        competition\_type, context, outcome, is\_winner, security\_level  
    ) VALUES (  
        p\_timestamp, p\_source, p\_function\_name, p\_competition\_id,  
        p\_competition\_type, p\_context, p\_outcome, p\_is\_winner, p\_security\_level  
    );  
      
    RETURN TRUE;  
END;  
$function$  
"  
public,is\_uuid,p text,p text,bool,plpgsql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.is\_uuid(p text)  
 RETURNS boolean  
 LANGUAGE plpgsql  
 IMMUTABLE  
AS $function$  
BEGIN  
  PERFORM p::uuid; RETURN true;  
EXCEPTION WHEN invalid\_text\_representation THEN  
  RETURN false;  
END;$function$  
"  
public,joincompetition\_sync\_wallet,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.joincompetition\_sync\_wallet()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.canonical\_user\_id IS NOT NULL AND (NEW.wallet\_address IS NULL OR NEW.wallet\_address \= '') THEN  
    NEW.wallet\_address := replace(NEW.canonical\_user\_id, 'prize:pid:', '');  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,link\_additional\_wallet,"user\_identifier text, p\_wallet\_address text, p\_wallet\_type text, p\_nickname text","user\_identifier text, p\_wallet\_address text, p\_wallet\_type text DEFAULT 'external'::text, p\_nickname text DEFAULT NULL::text",json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.link\_additional\_wallet(user\_identifier text, p\_wallet\_address text, p\_wallet\_type text DEFAULT 'external'::text, p\_nickname text DEFAULT NULL::text)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user RECORD;  
  v\_normalized\_address TEXT;  
  v\_new\_wallet JSONB;  
  v\_existing\_wallets JSONB;  
  v\_wallet\_exists BOOLEAN;  
BEGIN  
  \-- Normalize wallet address  
  v\_normalized\_address := LOWER(p\_wallet\_address);

  \-- Find user by various identifiers  
  SELECT \* INTO v\_user  
  FROM canonical\_users cu  
  WHERE cu.canonical\_user\_id \= user\_identifier  
     OR LOWER(cu.wallet\_address) \= LOWER(user\_identifier)  
     OR LOWER(cu.base\_wallet\_address) \= LOWER(user\_identifier)  
     OR cu.privy\_user\_id \= user\_identifier  
     OR cu.email ILIKE user\_identifier  
     OR cu.uid::TEXT \= user\_identifier  
  LIMIT 1;

  IF v\_user IS NULL THEN  
    RETURN json\_build\_object('success', false, 'error', 'User not found');  
  END IF;

  \-- Check if wallet already exists in linked\_wallets  
  v\_existing\_wallets := COALESCE(v\_user.linked\_wallets, '\[\]'::JSONB);

  SELECT EXISTS(  
    SELECT 1 FROM jsonb\_array\_elements(v\_existing\_wallets) AS w  
    WHERE LOWER(w-\>\>'address') \= v\_normalized\_address  
  ) INTO v\_wallet\_exists;

  IF v\_wallet\_exists THEN  
    RETURN json\_build\_object('success', false, 'error', 'Wallet already linked to this account');  
  END IF;

  \-- Check if wallet is already linked to another user  
  IF EXISTS(  
    SELECT 1 FROM canonical\_users cu  
    WHERE cu.uid \!= v\_user.uid  
    AND (  
      LOWER(cu.wallet\_address) \= v\_normalized\_address  
      OR LOWER(cu.base\_wallet\_address) \= v\_normalized\_address  
      OR LOWER(cu.linked\_external\_wallet) \= v\_normalized\_address  
      OR LOWER(cu.primary\_wallet\_address) \= v\_normalized\_address  
      OR EXISTS(  
        SELECT 1 FROM jsonb\_array\_elements(COALESCE(cu.linked\_wallets, '\[\]'::JSONB)) AS w  
        WHERE LOWER(w-\>\>'address') \= v\_normalized\_address  
      )  
    )  
  ) THEN  
    RETURN json\_build\_object('success', false, 'error', 'Wallet is already linked to another account');  
  END IF;

  \-- Build new wallet object  
  v\_new\_wallet := jsonb\_build\_object(  
    'address', v\_normalized\_address,  
    'type', p\_wallet\_type,  
    'nickname', COALESCE(p\_nickname,  
      CASE p\_wallet\_type  
        WHEN 'base' THEN 'Base Wallet'  
        WHEN 'external' THEN 'External Wallet'  
        ELSE 'Wallet'  
      END  
    ),  
    'is\_primary', (jsonb\_array\_length(v\_existing\_wallets) \= 0), \-- First wallet is primary  
    'linked\_at', NOW()  
  );

  \-- Add to linked\_wallets array  
  UPDATE canonical\_users  
  SET  
    linked\_wallets \= v\_existing\_wallets || jsonb\_build\_array(v\_new\_wallet),  
    primary\_wallet\_address \= CASE  
      WHEN primary\_wallet\_address IS NULL THEN v\_normalized\_address  
      ELSE primary\_wallet\_address  
    END,  
    updated\_at \= NOW()  
  WHERE uid \= v\_user.uid;

  RETURN json\_build\_object(  
    'success', true,  
    'message', 'Wallet linked successfully',  
    'wallet', v\_new\_wallet  
  );  
END;  
$function$  
"  
public,link\_external\_wallet,"p\_canonical\_user\_id text, p\_external\_wallet text","p\_canonical\_user\_id text, p\_external\_wallet text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.link\_external\_wallet(p\_canonical\_user\_id text, p\_external\_wallet text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_result JSONB;  
BEGIN  
  IF p\_canonical\_user\_id IS NULL OR p\_external\_wallet IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Missing required parameters');  
  END IF;

  UPDATE canonical\_users  
  SET eth\_wallet\_address \= LOWER(p\_external\_wallet), updated\_at \= NOW()  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id OR uid \= p\_canonical\_user\_id;

  IF NOT FOUND THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'User not found');  
  END IF;

  RETURN jsonb\_build\_object('success', true, 'wallet\_address', LOWER(p\_external\_wallet));  
END;  
$function$  
"  
public,link\_pending\_reservation\_to\_session,"p\_reservation\_id uuid, p\_session\_id text","p\_reservation\_id uuid, p\_session\_id text",void,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.link\_pending\_reservation\_to\_session(p\_reservation\_id uuid, p\_session\_id text)  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  UPDATE public.pending\_tickets  
  SET session\_id \= p\_session\_id,  
      updated\_at \= NOW()  
  WHERE reservation\_id \= p\_reservation\_id;

  IF NOT FOUND THEN  
    RAISE EXCEPTION 'Reservation not found for reservation\_id=%', p\_reservation\_id  
      USING ERRCODE \= 'P0002';  
  END IF;  
END;  
$function$  
"  
public,log\_confirmation\_incident,"p\_incident\_id text, p\_source text, p\_error\_type text, p\_error\_message text, p\_error\_stack text, p\_request\_context jsonb, p\_env\_context jsonb, p\_function\_context jsonb, p\_severity text, p\_status\_code integer, p\_created\_by text","p\_incident\_id text, p\_source text, p\_error\_type text DEFAULT NULL::text, p\_error\_message text DEFAULT NULL::text, p\_error\_stack text DEFAULT NULL::text, p\_request\_context jsonb DEFAULT '{}'::jsonb, p\_env\_context jsonb DEFAULT '{}'::jsonb, p\_function\_context jsonb DEFAULT '{}'::jsonb, p\_severity text DEFAULT 'error'::text, p\_status\_code integer DEFAULT NULL::integer, p\_created\_by text DEFAULT NULL::text",uuid,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.log\_confirmation\_incident(p\_incident\_id text, p\_source text, p\_error\_type text DEFAULT NULL::text, p\_error\_message text DEFAULT NULL::text, p\_error\_stack text DEFAULT NULL::text, p\_request\_context jsonb DEFAULT '{}'::jsonb, p\_env\_context jsonb DEFAULT '{}'::jsonb, p\_function\_context jsonb DEFAULT '{}'::jsonb, p\_severity text DEFAULT 'error'::text, p\_status\_code integer DEFAULT NULL::integer, p\_created\_by text DEFAULT NULL::text)  
 RETURNS uuid  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_id uuid;  
BEGIN  
  INSERT INTO public.confirmation\_incident\_log (  
    incident\_id, source, error\_type, error\_message, error\_stack,  
    request\_context, env\_context, function\_context, severity, status\_code, created\_by  
  ) VALUES (  
    p\_incident\_id, p\_source, p\_error\_type, p\_error\_message, p\_error\_stack,  
    COALESCE(p\_request\_context, '{}'::jsonb),  
    COALESCE(p\_env\_context, '{}'::jsonb),  
    COALESCE(p\_function\_context, '{}'::jsonb),  
    COALESCE(p\_severity, 'error'),  
    p\_status\_code,  
    p\_created\_by  
  ) RETURNING id INTO v\_id;  
  RETURN v\_id;  
END;  
$function$  
"  
public,log\_system\_event,"p\_level text, p\_message text, p\_context jsonb","p\_level text, p\_message text, p\_context jsonb",uuid,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.log\_system\_event(p\_level text, p\_message text, p\_context jsonb)  
 RETURNS uuid  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
    log\_id uuid;  
BEGIN  
    INSERT INTO system\_logs (log\_level, message, context)  
    VALUES (p\_level, p\_message, p\_context)  
    RETURNING id INTO log\_id;  
      
    RETURN log\_id;  
END;  
$function$  
"  
public,migrate\_privy\_users,p\_privy\_wallet\_mapping jsonb,p\_privy\_wallet\_mapping jsonb,int4,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.migrate\_privy\_users(p\_privy\_wallet\_mapping jsonb)  
 RETURNS integer  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
    mapping JSONB;  
    user\_id UUID;  
    migrated\_count INTEGER := 0;  
BEGIN  
    \-- Process each mapping  
    FOR mapping IN SELECT \* FROM jsonb\_array\_elements(p\_privy\_wallet\_mapping)  
    LOOP  
        BEGIN  
            \-- Try to find existing user by wallet address  
            SELECT id INTO user\_id   
            FROM users   
            WHERE wallet\_address \= (mapping-\>\>'wallet\_address')::TEXT;  
              
            IF user\_id IS NOT NULL THEN  
                \-- Update existing user with Privy migration info  
                UPDATE users   
                SET legacy\_privy\_id \= (mapping-\>\>'privy\_id')::TEXT,  
                    migrated\_from\_privy \= TRUE,  
                    migration\_date \= NOW(),  
                    updated\_at \= NOW()  
                WHERE id \= user\_id;  
                  
                migrated\_count := migrated\_count \+ 1;  
            ELSE  
                \-- Create new user with Privy migration info  
                INSERT INTO users (  
                    wallet\_address,   
                    legacy\_privy\_id,   
                    migrated\_from\_privy,   
                    migration\_date  
                ) VALUES (  
                    (mapping-\>\>'wallet\_address')::TEXT,  
                    (mapping-\>\>'privy\_id')::TEXT,  
                    TRUE,  
                    NOW()  
                );  
                  
                migrated\_count := migrated\_count \+ 1;  
            END IF;  
        EXCEPTION WHEN OTHERS THEN  
            \-- Continue with next mapping if one fails  
            CONTINUE;  
        END;  
    END LOOP;  
      
    RETURN migrated\_count;  
END;  
$function$  
"  
public,migrate\_user\_balance,"p\_old\_id text, p\_new\_id text","p\_old\_id text, p\_new\_id text",void,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.migrate\_user\_balance(p\_old\_id text, p\_new\_id text)  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  \-- Only migrate if old\_id exists and new\_id doesn't have a balance yet  
  UPDATE sub\_account\_balances  
  SET user\_id \= p\_new\_id  
  WHERE lower(user\_id) \= lower(p\_old\_id)  
    AND NOT EXISTS (SELECT 1 FROM sub\_account\_balances WHERE lower(user\_id) \= lower(p\_new\_id));  
    
  \-- If new\_id already exists, merge balances  
  IF EXISTS (SELECT 1 FROM sub\_account\_balances WHERE lower(user\_id) \= lower(p\_old\_id)) THEN  
    UPDATE sub\_account\_balances dest  
    SET balance \= dest.balance \+ src.balance  
    FROM sub\_account\_balances src  
    WHERE lower(dest.user\_id) \= lower(p\_new\_id)  
      AND lower(src.user\_id) \= lower(p\_old\_id);  
      
    DELETE FROM sub\_account\_balances WHERE lower(user\_id) \= lower(p\_old\_id);  
  END IF;  
END;  
$function$  
"  
public,move\_pending\_tickets\_atomic,p\_batch\_limit integer,p\_batch\_limit integer DEFAULT 200,int4,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.move\_pending\_tickets\_atomic(p\_batch\_limit integer DEFAULT 200\)  
 RETURNS integer  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_moved\_count int := 0;  
  r record;  
  v\_user\_id text;  
  v\_canonical\_user\_id text;  
  v\_wallet\_address text;  
  v\_competition\_id uuid;  
  v\_ticket\_numbers int\[\];  
  v\_inserted int;  
BEGIN  
  FOR r IN  
    SELECT id  
    FROM public.pending\_tickets  
    WHERE status \= 'pending'  
    ORDER BY created\_at ASC  
    LIMIT p\_batch\_limit  
  LOOP  
    BEGIN  
      \-- Lock this attempt to prevent concurrent processors  
      PERFORM 1 FROM public.pending\_tickets pt WHERE pt.id \= r.id FOR UPDATE;

      \-- Enforce 5-minute window regardless of hold\_minutes  
      UPDATE public.pending\_tickets  
      SET status \= 'expired', updated\_at \= now()  
      WHERE id \= r.id AND now() \> (created\_at \+ interval '5 minutes');

      IF FOUND THEN  
        CONTINUE; \-- expired; skip  
      END IF;

      \-- Load the row  
      SELECT user\_id, canonical\_user\_id, wallet\_address, competition\_id, ticket\_numbers  
      INTO v\_user\_id, v\_canonical\_user\_id, v\_wallet\_address, v\_competition\_id, v\_ticket\_numbers  
      FROM public.pending\_tickets  
      WHERE id \= r.id;

      IF v\_ticket\_numbers IS NULL OR array\_length(v\_ticket\_numbers,1) IS NULL THEN  
        UPDATE public.pending\_tickets SET status \= 'expired', updated\_at \= now() WHERE id \= r.id;  
        CONTINUE;  
      END IF;

      \-- All-or-nothing insert into tickets: must be free (status='available' or not existing yet)  
      WITH target AS (  
        SELECT unnest(v\_ticket\_numbers) AS tnum  
      ),  
      lock\_rows AS (  
        \-- Lock candidate rows if they exist to avoid races  
        SELECT t.tnum, tk.id AS existing\_id, tk.status AS existing\_status  
        FROM target t  
        LEFT JOIN public.tickets tk  
          ON tk.competition\_id \= v\_competition\_id AND tk.ticket\_number \= t.tnum  
        FOR UPDATE OF tk  
      ),  
      conflict\_check AS (  
        SELECT COUNT(\*) AS conflicts  
        FROM lock\_rows lr  
        WHERE lr.existing\_id IS NOT NULL AND lr.existing\_status \<\> 'available'  
      ),  
      cleared AS (  
        SELECT conflicts FROM conflict\_check  
      ),  
      ensure\_rows AS (  
        \-- Ensure rows exist and are available; insert missing ticket slots as available  
        INSERT INTO public.tickets (competition\_id, ticket\_number, status, is\_active)  
        SELECT v\_competition\_id, t.tnum, 'available', true  
        FROM target t  
        LEFT JOIN public.tickets tk  
          ON tk.competition\_id \= v\_competition\_id AND tk.ticket\_number \= t.tnum  
        WHERE tk.id IS NULL  
        ON CONFLICT DO NOTHING  
        RETURNING 1  
      ),  
      purchase AS (  
        UPDATE public.tickets tk  
        SET status \= 'sold',  
            purchased\_by \= NULL, \-- optional; not used  
            purchased\_at \= now(),  
            order\_id \= NULL,  
            user\_id \= v\_canonical\_user\_id,  
            wallet\_address \= COALESCE(v\_wallet\_address, wallet\_address),  
            purchase\_price \= COALESCE(purchase\_price, 0),  
            is\_active \= true,  
            pending\_ticket\_id \= r.id,  
            payment\_amount \= COALESCE(payment\_amount, 0),  
            payment\_provider \= COALESCE(payment\_provider, (SELECT payment\_provider FROM public.pending\_tickets WHERE id \= r.id)),  
            purchase\_date \= COALESCE(purchase\_date, now())  
        WHERE tk.competition\_id \= v\_competition\_id  
          AND tk.ticket\_number \= ANY(v\_ticket\_numbers)  
          AND tk.status \= 'available'  
        RETURNING tk.ticket\_number  
      )  
      SELECT COUNT(\*) INTO v\_inserted FROM purchase;

      IF v\_inserted IS DISTINCT FROM array\_length(v\_ticket\_numbers,1) THEN  
        \-- rollback effect: set any touched rows back to available  
        UPDATE public.tickets  
        SET status \= 'available',  
            purchased\_by \= NULL,  
            purchased\_at \= NULL,  
            order\_id \= NULL,  
            user\_id \= NULL,  
            wallet\_address \= NULL,  
            purchase\_price \= NULL,  
            pending\_ticket\_id \= NULL,  
            payment\_amount \= NULL,  
            payment\_provider \= NULL,  
            purchase\_date \= NULL  
        WHERE competition\_id \= v\_competition\_id  
          AND ticket\_number \= ANY(v\_ticket\_numbers)  
          AND pending\_ticket\_id \= r.id;

        UPDATE public.pending\_tickets SET status \= 'expired', updated\_at \= now() WHERE id \= r.id;  
        CONTINUE;  
      END IF;

      \-- Success: remove the pending row entirely  
      DELETE FROM public.pending\_tickets WHERE id \= r.id;  
      v\_moved\_count := v\_moved\_count \+ 1;  
    EXCEPTION WHEN others THEN  
      \-- On any error, make the attempt expire and revert touched rows  
      UPDATE public.tickets  
      SET status \= 'available',  
          purchased\_by \= NULL,  
          purchased\_at \= NULL,  
          order\_id \= NULL,  
          user\_id \= NULL,  
          wallet\_address \= NULL,  
          purchase\_price \= NULL,  
          pending\_ticket\_id \= NULL,  
          payment\_amount \= NULL,  
          payment\_provider \= NULL,  
          purchase\_date \= NULL  
      WHERE pending\_ticket\_id \= r.id;

      UPDATE public.pending\_tickets SET status \= 'expired', updated\_at \= now() WHERE id \= r.id;  
    END;  
  END LOOP;

  RETURN v\_moved\_count;  
END;  
$function$  
"  
public,normalize\_sub\_account\_currency,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.normalize\_sub\_account\_currency()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  \-- Default NULL to USD  
  IF NEW.currency IS NULL THEN  
    NEW.currency := 'USD';  
  END IF;

  \-- Force all non-USD currencies to USD  
  IF NEW.currency IS DISTINCT FROM 'USD' THEN  
    \-- If NEW.currency \= 'USDC', 1:1 so amounts unchanged.  
    \-- If any other currency sneaks in, we still coerce to USD without conversion.  
    NEW.currency := 'USD';  
  END IF;

  RETURN NEW;  
END  
$function$  
"  
public,normalize\_user\_identifier,input text,input text,uuid,plpgsql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.normalize\_user\_identifier(input text)  
 RETURNS uuid  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
DECLARE  
  out\_id uuid;  
BEGIN  
  \-- 1\) If valid UUID, accept directly  
  BEGIN  
    out\_id := input::uuid;  
    RETURN out\_id;  
  EXCEPTION WHEN invalid\_text\_representation THEN  
    \-- not a uuid, continue  
  END;

  \-- 2\) Try privy\_user\_id match on users/canonical\_users  
  SELECT cu.canonical\_user\_id INTO out\_id  
  FROM public.users u  
  JOIN public.canonical\_users cu ON cu.canonical\_user\_id \= u.canonical\_user\_id  
  WHERE u.privy\_id \= input OR u.privy\_user\_id \= input  
  LIMIT 1;  
  IF out\_id IS NOT NULL THEN  
    RETURN out\_id;  
  END IF;

  \-- 3\) Try wallet address (case-insensitive) on canonical\_users  
  SELECT cu.canonical\_user\_id INTO out\_id  
  FROM public.canonical\_users cu  
  WHERE lower(cu.wallet\_address) \= lower(input)  
     OR lower(cu.base\_wallet\_address) \= lower(input)  
     OR lower(cu.eth\_wallet\_address) \= lower(input)  
  LIMIT 1;  
  IF out\_id IS NOT NULL THEN  
    RETURN out\_id;  
  END IF;

  \-- 4\) Try username/email on canonical\_users  
  SELECT cu.canonical\_user\_id INTO out\_id  
  FROM public.canonical\_users cu  
  WHERE lower(cu.username) \= lower(input)  
     OR lower(cu.email) \= lower(input)  
  LIMIT 1;  
  IF out\_id IS NOT NULL THEN  
    RETURN out\_id;  
  END IF;

  \-- Nothing matched  
  RETURN NULL;  
END  
$function$  
"  
public,notify\_payment\_webhook,"p\_provider text, p\_event\_type text, p\_event\_id text, p\_payload jsonb","p\_provider text, p\_event\_type text, p\_event\_id text, p\_payload jsonb",uuid,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.notify\_payment\_webhook(p\_provider text, p\_event\_type text, p\_event\_id text, p\_payload jsonb)  
 RETURNS uuid  
 LANGUAGE plpgsql  
AS $function$  
DECLARE v\_id uuid := gen\_random\_uuid(); BEGIN  
  INSERT INTO public.payment\_webhook\_events(id, provider, event\_type, event\_id, payload)  
  VALUES (v\_id, p\_provider, p\_event\_type, p\_event\_id, p\_payload)  
  ON CONFLICT (event\_id) DO UPDATE SET payload \= EXCLUDED.payload, updated\_at \= now();  
  RETURN v\_id;  
END; $function$  
"  
public,on\_email\_verification\_merge,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.on\_email\_verification\_merge()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
declare  
  v\_email text;  
  v\_row public.canonical\_users;  
begin  
  \-- Only act when verification succeeds; prefer verified\_at, fallback to used\_at  
  if (NEW.verified\_at is not null) or (NEW.used\_at is not null) then  
    v\_email := lower(trim(NEW.email));  
    if v\_email is not null and v\_email \<\> '' then  
      \-- Call the canonical upsert with just the email for now  
      v\_row := public.ensure\_canonical\_user(p\_email \=\> v\_email);  
    end if;  
  end if;  
  return NEW;  
end;  
$function$  
"  
public,orders\_to\_user\_transactions,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.orders\_to\_user\_transactions()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
DECLARE   
  v\_cuid text;  
BEGIN  
  IF NEW.status \= 'completed' AND (TG\_OP \= 'INSERT' OR (OLD.status IS DISTINCT FROM NEW.status)) THEN  
    v\_cuid := COALESCE(NEW.user\_id, NEW.payment\_intent\_id);  
    SELECT cu.canonical\_user\_id  
      INTO v\_cuid  
    FROM public.canonical\_users cu  
    WHERE cu.canonical\_user\_id \= NEW.user\_id OR cu.email \= NEW.user\_id OR cu.wallet\_address \= NEW.user\_id  
    LIMIT 1;

    IF v\_cuid IS NOT NULL AND NEW.amount IS NOT NULL THEN  
      INSERT INTO public.user\_transactions (user\_id, canonical\_user\_id, wallet\_address, type, amount, currency, competition\_id, order\_id, description, status)  
      VALUES (NEW.user\_id, v\_cuid, NULL, 'purchase', NEW.amount, COALESCE(NEW.currency,'USDC'), NEW.competition\_id, NEW.id, 'Order purchase', 'completed');  
    END IF;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,pay\_balance\_transaction,"p\_canonical\_user\_id text, p\_amount numeric, p\_currency text, p\_description text, p\_order\_id uuid, p\_competition\_id uuid","p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_description text DEFAULT NULL::text, p\_order\_id uuid DEFAULT NULL::uuid, p\_competition\_id uuid DEFAULT NULL::uuid",record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.pay\_balance\_transaction(p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_description text DEFAULT NULL::text, p\_order\_id uuid DEFAULT NULL::uuid, p\_competition\_id uuid DEFAULT NULL::uuid)  
 RETURNS TABLE(transaction\_id uuid, balance\_before numeric, balance\_after numeric)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_balance\_id uuid;  
  v\_balance\_before numeric;  
  v\_balance\_after numeric;  
  v\_tx\_id uuid;  
BEGIN  
  \-- Validate positive amount  
  IF p\_amount IS NULL OR p\_amount \<= 0 THEN  
    RAISE EXCEPTION 'Amount must be positive.' USING ERRCODE \= '22023';  
  END IF;

  \-- Lock the balance row for this canonical user and currency  
  SELECT id, COALESCE(available\_balance, 0\)  
    INTO v\_balance\_id, v\_balance\_before  
  FROM sub\_account\_balances  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id AND currency \= p\_currency  
  FOR UPDATE;

  IF v\_balance\_id IS NULL THEN  
    RAISE EXCEPTION 'Balance row not found for user % and currency %', p\_canonical\_user\_id, p\_currency USING ERRCODE \= 'P0002';  
  END IF;

  \-- Ensure sufficient balance  
  IF v\_balance\_before \< p\_amount THEN  
    RAISE EXCEPTION 'Insufficient balance.' USING ERRCODE \= '22023';  
  END IF;

  v\_balance\_after := v\_balance\_before \- p\_amount;

  \-- Update the balance atomically  
  UPDATE sub\_account\_balances  
    SET available\_balance \= v\_balance\_after,  
        last\_updated \= now()  
  WHERE id \= v\_balance\_id;

  \-- Record the transaction as a real debit  
  INSERT INTO user\_transactions (  
    user\_id,  
    canonical\_user\_id,  
    type,  
    amount,  
    currency,  
    balance\_before,  
    balance\_after,  
    description,  
    status,  
    order\_id,  
    competition\_id,  
    created\_at  
  ) VALUES (  
    NULL, \-- user\_id (text) not provided; keeping null  
    p\_canonical\_user\_id,  
    'debit',  
    p\_amount,  
    p\_currency,  
    v\_balance\_before,  
    v\_balance\_after,  
    p\_description,  
    'completed',  
    p\_order\_id,  
    p\_competition\_id,  
    now()  
  ) RETURNING id INTO v\_tx\_id;

  RETURN QUERY SELECT v\_tx\_id, v\_balance\_before, v\_balance\_after;  
END;  
$function$  
"  
public,payment\_broadcast\_trigger,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.payment\_broadcast\_trigger()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  topic text;  
BEGIN  
  topic := 'user:' || NEW.owner\_canonical\_id || ':payments';  
  PERFORM realtime.send(  
    topic,  
    'payment\_status',  
    jsonb\_build\_object(  
      'reservation\_id', NEW.reservation\_id,  
      'payment\_id', NEW.id,  
      'status', NEW.status,  
      'error\_code', NEW.error\_code,  
      'idempotency\_key', NEW.idempotency\_key  
    ),  
    true  
  );  
  RETURN NEW;  
END;  
$function$  
"  
public,pending\_tickets\_before\_ins,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pending\_tickets\_before\_ins()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  \-- Replace all occurrences:  
  \-- NEW.walletaddress \-\> NEW.wallet\_address  
  \-- Any comparisons/assignments updated accordingly

  \-- Your existing logic preserved; only the column name changed.  
  RETURN NEW;  
END;  
$function$  
"  
public,pending\_tickets\_enforce\_expiry,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pending\_tickets\_enforce\_expiry()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.expires\_at IS NULL THEN  
    NEW.expires\_at := COALESCE(NEW.created\_at, now()) \+ interval '5 minutes';  
  END IF;  
  IF NEW.status \= 'pending' AND now() \> NEW.expires\_at THEN  
    NEW.status := 'expired';  
    NEW.updated\_at := now();  
    NEW.note := coalesce(NEW.note, '') || CASE WHEN NEW.note IS NULL OR NEW.note \= '' THEN '' ELSE ' | ' END ||  
      'auto-expired by trigger at ' || to\_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ');  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,pgp\_armor\_headers,"text, OUT key text, OUT value text","text, OUT key text, OUT value text",record,c,false,i,false,true,null,"CREATE OR REPLACE FUNCTION public.pgp\_armor\_headers(text, OUT key text, OUT value text)  
 RETURNS SETOF record  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_armor\_headers$function$  
"  
public,pgp\_key\_id,bytea,bytea,text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_key\_id(bytea)  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_key\_id\_w$function$  
"  
public,pgp\_pub\_decrypt,"bytea, bytea","bytea, bytea",text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_decrypt(bytea, bytea)  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_decrypt\_text$function$  
"  
public,pgp\_pub\_decrypt,"bytea, bytea, text","bytea, bytea, text",text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_decrypt(bytea, bytea, text)  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_decrypt\_text$function$  
"  
public,pgp\_pub\_decrypt,"bytea, bytea, text, text","bytea, bytea, text, text",text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_decrypt(bytea, bytea, text, text)  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_decrypt\_text$function$  
"  
public,pgp\_pub\_decrypt\_bytea,"bytea, bytea","bytea, bytea",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_decrypt\_bytea(bytea, bytea)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_decrypt\_bytea$function$  
"  
public,pgp\_pub\_decrypt\_bytea,"bytea, bytea, text","bytea, bytea, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_decrypt\_bytea(bytea, bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_decrypt\_bytea$function$  
"  
public,pgp\_pub\_decrypt\_bytea,"bytea, bytea, text, text","bytea, bytea, text, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_decrypt\_bytea(bytea, bytea, text, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_decrypt\_bytea$function$  
"  
public,pgp\_pub\_encrypt,"text, bytea","text, bytea",bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_encrypt(text, bytea)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_encrypt\_text$function$  
"  
public,pgp\_pub\_encrypt,"text, bytea, text","text, bytea, text",bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_encrypt(text, bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_encrypt\_text$function$  
"  
public,pgp\_pub\_encrypt\_bytea,"bytea, bytea","bytea, bytea",bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_encrypt\_bytea(bytea, bytea)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_encrypt\_bytea$function$  
"  
public,pgp\_pub\_encrypt\_bytea,"bytea, bytea, text","bytea, bytea, text",bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_pub\_encrypt\_bytea(bytea, bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_pub\_encrypt\_bytea$function$  
"  
public,pgp\_sym\_decrypt,"bytea, text","bytea, text",text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_sym\_decrypt(bytea, text)  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_sym\_decrypt\_text$function$  
"  
public,pgp\_sym\_decrypt,"bytea, text, text","bytea, text, text",text,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_sym\_decrypt(bytea, text, text)  
 RETURNS text  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_sym\_decrypt\_text$function$  
"  
public,pgp\_sym\_decrypt\_bytea,"bytea, text","bytea, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_sym\_decrypt\_bytea(bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_sym\_decrypt\_bytea$function$  
"  
public,pgp\_sym\_decrypt\_bytea,"bytea, text, text","bytea, text, text",bytea,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_sym\_decrypt\_bytea(bytea, text, text)  
 RETURNS bytea  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_sym\_decrypt\_bytea$function$  
"  
public,pgp\_sym\_encrypt,"text, text","text, text",bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_sym\_encrypt(text, text)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_sym\_encrypt\_text$function$  
"  
public,pgp\_sym\_encrypt,"text, text, text","text, text, text",bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_sym\_encrypt(text, text, text)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_sym\_encrypt\_text$function$  
"  
public,pgp\_sym\_encrypt\_bytea,"bytea, text","bytea, text",bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_sym\_encrypt\_bytea(bytea, text)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_sym\_encrypt\_bytea$function$  
"  
public,pgp\_sym\_encrypt\_bytea,"bytea, text, text","bytea, text, text",bytea,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.pgp\_sym\_encrypt\_bytea(bytea, text, text)  
 RETURNS bytea  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/pgcrypto', $function$pgp\_sym\_encrypt\_bytea$function$  
"  
public,post\_deposit\_and\_update\_balance,"p\_wallet\_address text, p\_amount numeric, p\_currency text, p\_reference text","p\_wallet\_address text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference text DEFAULT NULL::text",record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.post\_deposit\_and\_update\_balance(p\_wallet\_address text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference text DEFAULT NULL::text)  
 RETURNS TABLE(wallet\_address text, currency text, available\_balance numeric, pending\_balance numeric, last\_updated timestamp with time zone)  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_prev numeric := 0;  
  v\_new numeric := 0;  
BEGIN  
  \-- Read latest balance  
  SELECT available\_balance INTO v\_prev  
  FROM public.sub\_account\_balances  
  WHERE wallet\_address \= p\_wallet\_address AND currency \= p\_currency  
  ORDER BY last\_updated DESC NULLS LAST  
  LIMIT 1;

  v\_prev := COALESCE(v\_prev, 0);  
  v\_new := v\_prev \+ p\_amount;

  \-- Ledger deposit  
  INSERT INTO public.user\_transactions (user\_id, wallet\_address, type, amount, currency, description, balance\_before, balance\_after)  
  VALUES (p\_wallet\_address, p\_wallet\_address, 'deposit', p\_amount, p\_currency, p\_reference, v\_prev, v\_new);

  \-- Snapshot balances; triggers will handle bonus award if threshold crossed  
  INSERT INTO public.sub\_account\_balances (user\_id, wallet\_address, currency, available\_balance, pending\_balance, last\_updated)  
  VALUES (p\_wallet\_address, p\_wallet\_address, p\_currency, v\_new, 0, now())  
  RETURNING wallet\_address, currency, available\_balance, pending\_balance, last\_updated;  
END; $function$  
"  
public,post\_user\_transaction\_to\_balance,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.post\_user\_transaction\_to\_balance()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_currency text;  
  v\_effect numeric;  
  v\_bal\_id uuid;  
  v\_currency\_final text;  
BEGIN  
  \-- Prefer column currency if it exists; else metadata-\>currency; else 'USD'  
  BEGIN  
    EXECUTE 'SELECT ($1).' || quote\_ident('currency')  
    INTO v\_currency  
    USING NEW;  
  EXCEPTION WHEN others THEN  
    v\_currency := NULL;  
  END;

  v\_currency\_final := COALESCE(v\_currency, NEW.metadata-\>\>'currency', 'USD');

  IF NEW.status \= 'completed' AND NEW.posted\_to\_balance \= false THEN  
    IF NEW.type IN ('entry','payment') THEN  
      v\_effect := \- NEW.amount;  
    ELSIF NEW.type IN ('topup','refund','adjustment') THEN  
      v\_effect := NEW.amount;  
    ELSE  
      v\_effect := 0;  
    END IF;

    PERFORM public.ensure\_sub\_account\_balance\_row(NEW.canonical\_user\_id, v\_currency\_final);  
    SELECT id INTO v\_bal\_id  
    FROM public.sub\_account\_balances  
    WHERE canonical\_user\_id \= NEW.canonical\_user\_id  
      AND currency \= v\_currency\_final  
    LIMIT 1;

    UPDATE public.sub\_account\_balances b  
    SET available\_balance \= b.available\_balance \+ v\_effect,  
        last\_updated \= NOW()  
    WHERE b.id \= v\_bal\_id;

    NEW.posted\_to\_balance := true;  
    IF NEW.completed\_at IS NULL THEN  
      NEW.completed\_at := NOW();  
    END IF;  
  END IF;

  RETURN NEW;  
END;  
$function$  
"  
public,process\_pending\_tickets\_batch,p\_limit integer,p\_limit integer DEFAULT 1000,int4,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.process\_pending\_tickets\_batch(p\_limit integer DEFAULT 1000\)  
 RETURNS integer  
 LANGUAGE plpgsql  
AS $function$  
DECLARE v\_now timestamptz := now(); v\_processed int := 0; BEGIN  
  WITH \_pt AS (  
    SELECT id, competition\_id, user\_id, canonical\_user\_id, wallet\_address, privy\_user\_id, user\_privy\_id,  
           total\_amount, payment\_provider, ticket\_numbers, expires\_at, created\_at  
    FROM public.pending\_tickets  
    WHERE status \= 'pending'  
      AND (expires\_at IS NULL OR expires\_at \>= v\_now)  
    ORDER BY created\_at  
    LIMIT p\_limit  
  ), \_exp AS (  
    SELECT p.id AS pending\_ticket\_id,  
           p.competition\_id,  
           p.user\_id,  
           p.canonical\_user\_id,  
           p.wallet\_address,  
           p.privy\_user\_id,  
           p.user\_privy\_id,  
           p.total\_amount,  
           p.payment\_provider,  
           unnest(p.ticket\_numbers) AS ticket\_number  
    FROM \_pt p  
  ), ins AS (  
    INSERT INTO public.tickets (  
      id, competition\_id, ticket\_number, status, user\_id, privy\_user\_id, user\_privy\_id,  
      canonical\_user\_id, wallet\_address, payment\_amount, payment\_provider, pending\_ticket\_id,  
      created\_at, purchase\_date  
    )  
    SELECT gen\_random\_uuid(), e.competition\_id, e.ticket\_number, 'sold',  
           e.user\_id::text, COALESCE(e.privy\_user\_id, e.user\_privy\_id), COALESCE(e.user\_privy\_id, e.privy\_user\_id),  
           e.canonical\_user\_id, e.wallet\_address, e.total\_amount, e.payment\_provider, e.pending\_ticket\_id,  
           v\_now, v\_now  
    FROM \_exp e  
    ON CONFLICT (competition\_id, ticket\_number) DO NOTHING  
    RETURNING 1  
  )  
  UPDATE public.pending\_tickets pt  
  SET status \= CASE  
                 WHEN c.inserted \= 0 AND (pt.expires\_at IS NOT NULL AND v\_now \> pt.expires\_at) THEN 'expired'  
                 WHEN c.inserted \= c.requested THEN 'confirmed'  
                 WHEN c.inserted \> 0 THEN 'partial'  
                 ELSE pt.status  
               END,  
      updated\_at \= v\_now,  
      note \= CONCAT(  
        COALESCE(pt.note, ''),  
        CASE WHEN COALESCE(pt.note, '') \= '' THEN '' ELSE ' | ' END,  
        'batch at ', to\_char(v\_now, 'YYYY-MM-DD HH24:MI:SS TZ'),  
        ' — inserted ', c.inserted, ' of ', c.requested  
      )  
  FROM (  
    SELECT p.id,  
           cardinality(p.ticket\_numbers) AS requested,  
           (SELECT count(\*) FROM public.tickets t WHERE t.pending\_ticket\_id \= p.id) AS inserted  
    FROM \_pt p  
  ) c  
  WHERE pt.id \= c.id AND pt.status IN ('pending','partial');

  GET DIAGNOSTICS v\_processed \= ROW\_COUNT; RETURN v\_processed; END; $function$  
"  
public,process\_ticket\_purchase,"p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text","p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text",jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.process\_ticket\_purchase(p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_reservation\_uuid uuid;  
  v\_is\_uuid boolean;  
BEGIN  
  \-- Detect UUID format and cast safely when appropriate  
  v\_is\_uuid := p\_reservation\_id \~\* '^\[0-9a-f\]{8}-\[0-9a-f\]{4}-\[1-5\]\[0-9a-f\]{3}-\[89ab\]\[0-9a-f\]{3}-\[0-9a-f\]{12}$';  
  IF v\_is\_uuid THEN  
    v\_reservation\_uuid := p\_reservation\_id::uuid;  
  ELSE  
    v\_reservation\_uuid := NULL; \-- downstream code must handle NULL when not a UUID  
  END IF;

  \-- TODO: Replace the stub below with your actual purchase logic, ensuring  
  \-- any internal function calls accept TEXT for reservation id, or use v\_reservation\_uuid  
  \-- guardedly. Avoid ::uuid casts on p\_reservation\_id.

  RETURN jsonb\_build\_object(  
    'ok', true,  
    'reservation\_id\_text', p\_reservation\_id,  
    'reservation\_id\_uuid', v\_reservation\_uuid,  
    'is\_uuid', v\_is\_uuid  
  );  
END;  
$function$  
"  
public,process\_ticket\_purchase,"p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id uuid, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_user\_id text","p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id uuid, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_user\_id text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.process\_ticket\_purchase(p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id uuid, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_user\_id text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_unit\_price numeric;  
  v\_currency text := 'USD';  
  v\_total\_cost numeric := 0;  
  v\_ticket\_ids uuid\[\];  
  v\_balance\_after numeric := NULL;  
  v\_entry\_id uuid := NULL;  
  v\_transaction\_id uuid := NULL;  
  v\_now timestamptz := now();  
  v\_already purchase\_requests%ROWTYPE;  
BEGIN  
  \-- Basic validation  
  IF p\_competition\_id IS NULL OR p\_request\_id IS NULL OR p\_user\_id IS NULL THEN  
    RAISE EXCEPTION 'Missing required parameters' USING ERRCODE \= '22023';  
  END IF;  
  IF p\_ticket\_count IS NULL OR p\_ticket\_count \<= 0 THEN  
    RAISE EXCEPTION 'ticket\_count must be \> 0' USING ERRCODE \= '22023';  
  END IF;

  \-- Idempotency: if request already processed, return previous result  
  SELECT \* INTO v\_already  
  FROM public.purchase\_requests  
  WHERE request\_id \= p\_request\_id;

  IF FOUND THEN  
    IF v\_already.status \= 'success' THEN  
      RETURN jsonb\_build\_object(  
        'success', true,  
        'ticketsCreated', COALESCE(array\_length(v\_already.result\_ticket\_ids, 1), 0),  
        'ticketsPurchased', COALESCE(array\_length(v\_already.result\_ticket\_ids, 1), 0),  
        'totalCost', COALESCE(v\_already.total\_cost, 0),  
        'balanceAfterPurchase', v\_balance\_after,  
        'message', 'Idempotent replay',  
        'tickets', (  
          SELECT COALESCE(  
            jsonb\_agg(jsonb\_build\_object(  
              'id', t.id,  
              'number', t.number,  
              'competition\_id', t.competition\_id  
            )), '\[\]'::jsonb)  
          FROM public.tickets t  
          WHERE t.id \= ANY(COALESCE(v\_already.result\_ticket\_ids, ARRAY\[\]::uuid\[\]))  
        ),  
        'entryId', v\_already.entry\_id,  
        'transactionId', v\_already.transaction\_id  
      );  
    ELSIF v\_already.status \= 'pending' THEN  
      RAISE EXCEPTION 'Duplicate request: still pending' USING ERRCODE \= '40001';  
    ELSE  
      NULL;  
    END IF;  
  ELSE  
    INSERT INTO public.purchase\_requests(  
      request\_id, competition\_id, user\_id, reservation\_id, selected\_tickets, ticket\_count, created\_at, status  
    ) VALUES (  
      p\_request\_id, p\_competition\_id, p\_user\_id, p\_reservation\_id, COALESCE(p\_selected\_tickets, '{}'), p\_ticket\_count, v\_now, 'pending'  
    );  
  END IF;

  \-- Server-side price and currency  
  SELECT unit\_price, currency INTO v\_unit\_price, v\_currency  
  FROM public.\_get\_competition\_price(p\_competition\_id);  
  IF v\_unit\_price IS NULL THEN  
    UPDATE public.purchase\_requests SET status='failed', error\_message \= 'Competition price not found', processed\_at \= now()  
    WHERE request\_id \= p\_request\_id;  
    RAISE EXCEPTION 'Competition price not found' USING ERRCODE \= '22023';  
  END IF;  
  v\_total\_cost := v\_unit\_price \* p\_ticket\_count;

  \-- Execute purchase through existing SECURITY DEFINER function  
  v\_ticket\_ids := public.purchase\_tickets(  
    p\_user\_wallet\_address := p\_user\_id,  
    p\_competition\_id      := p\_competition\_id,  
    p\_ticket\_count        := p\_ticket\_count,  
    p\_payment\_amount      := v\_total\_cost,  
    p\_currency            := v\_currency,  
    p\_user\_email          := NULL  
  );

  \-- Mark success \+ store result  
  UPDATE public.purchase\_requests  
  SET status \= 'success',  
      processed\_at \= now(),  
      result\_ticket\_ids \= v\_ticket\_ids,  
      total\_cost \= v\_total\_cost,  
      currency \= v\_currency,  
      transaction\_id \= v\_transaction\_id,  
      entry\_id \= v\_entry\_id  
  WHERE request\_id \= p\_request\_id;

  RETURN jsonb\_build\_object(  
    'success', true,  
    'ticketsCreated', COALESCE(array\_length(v\_ticket\_ids, 1), 0),  
    'ticketsPurchased', COALESCE(array\_length(v\_ticket\_ids, 1), 0),  
    'totalCost', v\_total\_cost,  
    'balanceAfterPurchase', v\_balance\_after,  
    'message', 'Purchase completed',  
    'tickets', (  
      SELECT COALESCE(  
        jsonb\_agg(jsonb\_build\_object(  
          'id', t.id,  
          'number', t.number,  
          'competition\_id', t.competition\_id  
        )), '\[\]'::jsonb)  
      FROM public.tickets t  
      WHERE t.id \= ANY(COALESCE(v\_ticket\_ids, ARRAY\[\]::uuid\[\]))  
    ),  
    'entryId', v\_entry\_id,  
    'transactionId', v\_transaction\_id  
  );  
EXCEPTION  
  WHEN unique\_violation THEN  
    SELECT \* INTO v\_already FROM public.purchase\_requests WHERE request\_id \= p\_request\_id;  
    IF v\_already.status \= 'success' THEN  
      RETURN jsonb\_build\_object(  
        'success', true,  
        'ticketsCreated', COALESCE(array\_length(v\_already.result\_ticket\_ids, 1), 0),  
        'ticketsPurchased', COALESCE(array\_length(v\_already.result\_ticket\_ids, 1), 0),  
        'totalCost', COALESCE(v\_already.total\_cost, 0),  
        'balanceAfterPurchase', v\_balance\_after,  
        'message', 'Idempotent replay',  
        'tickets', (  
          SELECT COALESCE(  
            jsonb\_agg(jsonb\_build\_object(  
              'id', t.id,  
              'number', t.number,  
              'competition\_id', t.competition\_id  
            )), '\[\]'::jsonb)  
          FROM public.tickets t  
          WHERE t.id \= ANY(COALESCE(v\_already.result\_ticket\_ids, ARRAY\[\]::uuid\[\]))  
        ),  
        'entryId', v\_already.entry\_id,  
        'transactionId', v\_already.transaction\_id  
      );  
    ELSE  
      RAISE EXCEPTION 'Duplicate request id' USING ERRCODE \= '40001';  
    END IF;  
  WHEN OTHERS THEN  
    UPDATE public.purchase\_requests  
    SET status='failed', error\_message \= SQLERRM, processed\_at \= now()  
    WHERE request\_id \= p\_request\_id;  
    RAISE;  
END;  
$function$  
"  
public,process\_ticket\_purchase\_flex,"p\_competition\_id uuid, p\_request\_id text, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text","p\_competition\_id uuid, p\_request\_id text, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.process\_ticket\_purchase\_flex(p\_competition\_id uuid, p\_request\_id text, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public', 'auth', 'extensions'  
AS $function$  
begin  
  return public.process\_ticket\_purchase\_safe(  
    p\_competition\_id \=\> p\_competition\_id,  
    p\_request\_id \=\> coalesce(NULLIF(p\_request\_id, '')::uuid, util.uuid\_from\_text(p\_request\_id)),  
    p\_reservation\_id \=\> p\_reservation\_id,  
    p\_selected\_tickets \=\> p\_selected\_tickets,  
    p\_ticket\_count \=\> p\_ticket\_count,  
    p\_ticket\_price \=\> p\_ticket\_price,  
    p\_user\_id \=\> p\_user\_id  
  );  
exception when invalid\_text\_representation then  
  return public.process\_ticket\_purchase\_safe(  
    p\_competition\_id \=\> p\_competition\_id,  
    p\_request\_id \=\> util.uuid\_from\_text(p\_request\_id),  
    p\_reservation\_id \=\> p\_reservation\_id,  
    p\_selected\_tickets \=\> p\_selected\_tickets,  
    p\_ticket\_count \=\> p\_ticket\_count,  
    p\_ticket\_price \=\> p\_ticket\_price,  
    p\_user\_id \=\> p\_user\_id  
  );  
end;  
$function$  
"  
public,process\_ticket\_purchase\_safe,"p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text","p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text",jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.process\_ticket\_purchase\_safe(p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_result jsonb;  
BEGIN  
  \-- Call the safe main function without any casts  
  v\_result := public.process\_ticket\_purchase(  
    p\_competition\_id,  
    p\_request\_id,  
    p\_reservation\_id,  
    p\_selected\_tickets,  
    p\_ticket\_count,  
    p\_ticket\_price,  
    p\_user\_id  
  );

  RETURN v\_result;  
END;  
$function$  
"  
public,provision\_sub\_account\_balance,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.provision\_sub\_account\_balance()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
begin  
  insert into public.sub\_account\_balances as sab  
    (canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated)  
  values (new.canonical\_user\_id, 'USDC', 0, 0, now())  
  on conflict (canonical\_user\_id, currency) do update  
    set last\_updated \= now();  
  return new;  
end;  
$function$  
"  
public,purchase\_tickets,"p\_competition\_id uuid, p\_user\_wallet\_address text, p\_user\_email text, p\_ticket\_count integer, p\_payment\_amount numeric, p\_currency text","p\_competition\_id uuid, p\_user\_wallet\_address text, p\_user\_email text, p\_ticket\_count integer, p\_payment\_amount numeric, p\_currency text DEFAULT 'USDC'::text",\_uuid,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.purchase\_tickets(p\_competition\_id uuid, p\_user\_wallet\_address text, p\_user\_email text, p\_ticket\_count integer, p\_payment\_amount numeric, p\_currency text DEFAULT 'USDC'::text)  
 RETURNS TABLE(ticket\_ids uuid\[\])  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
    user\_id UUID;  
    available\_tickets INTEGER;  
    start\_ticket\_number INTEGER;  
    ticket\_id UUID;  
    new\_ticket\_ids UUID\[\] := ARRAY\[\]::UUID\[\];  
    comp\_total\_tickets INTEGER;  
    comp\_tickets\_sold INTEGER;  
    i INTEGER;  
BEGIN  
    \-- Get or create user (with Privy migration support)  
    SELECT id INTO user\_id   
    FROM users   
    WHERE wallet\_address \= p\_user\_wallet\_address;  
      
    IF user\_id IS NULL THEN  
        INSERT INTO users (wallet\_address, email, migrated\_from\_privy)   
        VALUES (p\_user\_wallet\_address, p\_user\_email, FALSE)  
        RETURNING id INTO user\_id;  
    END IF;  
      
    \-- Check ticket availability with locking  
    SELECT c.total\_tickets, c.tickets\_sold   
    INTO comp\_total\_tickets, comp\_tickets\_sold  
    FROM competitions c  
    WHERE c.id \= p\_competition\_id  
    FOR UPDATE; \-- Prevent race conditions  
      
    IF NOT FOUND THEN  
        RAISE EXCEPTION 'Competition not found';  
    END IF;  
      
    IF comp\_total\_tickets IS NULL THEN  
        RAISE EXCEPTION 'Competition not found';  
    END IF;  
      
    available\_tickets := comp\_total\_tickets \- comp\_tickets\_sold;  
      
    IF available\_tickets \< p\_ticket\_count THEN  
        RAISE EXCEPTION 'Not enough tickets available. Only % tickets remaining', available\_tickets;  
    END IF;  
      
    \-- Get next available ticket number  
    SELECT COALESCE(MAX(ticket\_number), 0\) \+ 1   
    INTO start\_ticket\_number   
    FROM tickets   
    WHERE competition\_id \= p\_competition\_id;  
      
    \-- Create tickets atomically  
    FOR i IN 0..p\_ticket\_count-1 LOOP  
        INSERT INTO tickets (  
            competition\_id,   
            user\_id,   
            ticket\_number,   
            purchase\_price,   
            currency  
        ) VALUES (  
            p\_competition\_id,  
            user\_id,  
            start\_ticket\_number \+ i,  
            p\_payment\_amount / p\_ticket\_count,  
            p\_currency  
        ) RETURNING id INTO ticket\_id;  
          
        new\_ticket\_ids := array\_append(new\_ticket\_ids, ticket\_id);  
    END LOOP;  
      
    \-- Update competition tickets\_sold  
    UPDATE competitions   
    SET tickets\_sold \= tickets\_sold \+ p\_ticket\_count,  
        updated\_at \= NOW()  
    WHERE id \= p\_competition\_id;  
      
    \-- Update user statistics  
    UPDATE users   
    SET total\_spent \= total\_spent \+ p\_payment\_amount,  
        total\_tickets \= total\_tickets \+ p\_ticket\_count,  
        updated\_at \= NOW()  
    WHERE id \= user\_id;  
      
    RETURN QUERY SELECT new\_ticket\_ids;  
END;  
$function$  
"  
public,purchase\_tickets,"p\_user\_wallet\_address text, p\_competition\_id uuid, p\_ticket\_count integer, p\_payment\_amount numeric, p\_currency text, p\_user\_email text","p\_user\_wallet\_address text, p\_competition\_id uuid, p\_ticket\_count integer, p\_payment\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_user\_email text DEFAULT NULL::text",\_uuid,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.purchase\_tickets(p\_user\_wallet\_address text, p\_competition\_id uuid, p\_ticket\_count integer, p\_payment\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_user\_email text DEFAULT NULL::text)  
 RETURNS uuid\[\]  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
    user\_id UUID;  
    available\_tickets INTEGER;  
    start\_ticket\_number INTEGER;  
    ticket\_id UUID;  
    new\_ticket\_ids UUID\[\] := ARRAY\[\]::UUID\[\];  
    comp\_total\_tickets INTEGER;  
    comp\_tickets\_sold INTEGER;  
    i INTEGER;  
BEGIN  
    \-- Get or create user (with Privy migration support)  
    SELECT id INTO user\_id   
    FROM users   
    WHERE wallet\_address \= p\_user\_wallet\_address;  
      
    IF user\_id IS NULL THEN  
        INSERT INTO users (wallet\_address, email, migrated\_from\_privy)   
        VALUES (p\_user\_wallet\_address, p\_user\_email, FALSE)  
        RETURNING id INTO user\_id;  
    END IF;  
      
    \-- Check ticket availability with locking  
    SELECT c.total\_tickets, c.tickets\_sold   
    INTO comp\_total\_tickets, comp\_tickets\_sold  
    FROM competitions c  
    WHERE c.id \= p\_competition\_id  
    FOR UPDATE; \-- Prevent race conditions  
      
    IF NOT FOUND THEN  
        RAISE EXCEPTION 'Competition not found';  
    END IF;  
      
    IF comp\_total\_tickets IS NULL THEN  
        RAISE EXCEPTION 'Competition not found';  
    END IF;  
      
    available\_tickets := comp\_total\_tickets \- comp\_tickets\_sold;  
      
    IF available\_tickets \< p\_ticket\_count THEN  
        RAISE EXCEPTION 'Not enough tickets available. Only % tickets remaining', available\_tickets;  
    END IF;  
      
    \-- Get next available ticket number  
    SELECT COALESCE(MAX(ticket\_number), 0\) \+ 1   
    INTO start\_ticket\_number   
    FROM tickets   
    WHERE competition\_id \= p\_competition\_id;  
      
    \-- Create tickets atomically  
    FOR i IN 0..p\_ticket\_count-1 LOOP  
        INSERT INTO tickets (  
            competition\_id,   
            user\_id,   
            ticket\_number,   
            purchase\_price,   
            currency  
        ) VALUES (  
            p\_competition\_id,  
            user\_id,  
            start\_ticket\_number \+ i,  
            p\_payment\_amount / p\_ticket\_count,  
            p\_currency  
        ) RETURNING id INTO ticket\_id;  
          
        new\_ticket\_ids := array\_append(new\_ticket\_ids, ticket\_id);  
    END LOOP;  
      
    \-- Update competition tickets\_sold  
    UPDATE competitions   
    SET tickets\_sold \= tickets\_sold \+ p\_ticket\_count,  
        updated\_at \= NOW()  
    WHERE id \= p\_competition\_id;  
      
    \-- Update user statistics  
    UPDATE users   
    SET total\_spent \= total\_spent \+ p\_payment\_amount,  
        total\_tickets \= total\_tickets \+ p\_ticket\_count,  
        updated\_at \= NOW()  
    WHERE id \= user\_id;  
      
    RETURN new\_ticket\_ids;  
END;  
$function$  
"  
public,purchase\_tickets\_with\_balance,"p\_user\_identifier text, p\_competition\_id text, p\_ticket\_price numeric, p\_ticket\_count integer, p\_ticket\_numbers integer\[\], p\_idempotency\_key text","p\_user\_identifier text, p\_competition\_id text, p\_ticket\_price numeric, p\_ticket\_count integer DEFAULT NULL::integer, p\_ticket\_numbers integer\[\] DEFAULT NULL::integer\[\], p\_idempotency\_key text DEFAULT NULL::text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.purchase\_tickets\_with\_balance(p\_user\_identifier text, p\_competition\_id text, p\_ticket\_price numeric, p\_ticket\_count integer DEFAULT NULL::integer, p\_ticket\_numbers integer\[\] DEFAULT NULL::integer\[\], p\_idempotency\_key text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_canonical\_user\_id TEXT; v\_user\_uuid TEXT; v\_current\_balance NUMERIC; v\_total\_cost NUMERIC; v\_new\_balance NUMERIC;  
  v\_final\_tickets INTEGER\[\]; v\_competition\_total\_tickets INTEGER; v\_competition\_status TEXT; v\_entry\_id TEXT;  
  v\_ticket\_numbers\_str TEXT; v\_used\_tickets INTEGER\[\]; v\_available\_tickets INTEGER\[\]; v\_needed\_count INTEGER;  
  v\_i INTEGER; v\_random\_index INTEGER; v\_ticket\_number INTEGER;  
BEGIN  
  IF p\_user\_identifier IS NULL OR LENGTH(TRIM(p\_user\_identifier)) \= 0 THEN RETURN jsonb\_build\_object('success', false, 'error', 'User identifier is required'); END IF;  
  IF p\_competition\_id IS NULL OR LENGTH(TRIM(p\_competition\_id)) \= 0 THEN RETURN jsonb\_build\_object('success', false, 'error', 'Competition ID is required'); END IF;  
  IF p\_ticket\_price IS NULL OR p\_ticket\_price \<= 0 THEN RETURN jsonb\_build\_object('success', false, 'error', 'Ticket price must be positive'); END IF;  
  IF (p\_ticket\_count IS NULL AND (p\_ticket\_numbers IS NULL OR array\_length(p\_ticket\_numbers, 1\) IS NULL)) THEN RETURN jsonb\_build\_object('success', false, 'error', 'Must provide either ticket\_count or ticket\_numbers'); END IF;

  IF p\_user\_identifier \~ '^0x\[a-fA-F0-9\]{40}$' THEN v\_canonical\_user\_id := 'prize:pid:' || LOWER(p\_user\_identifier);  
  ELSIF p\_user\_identifier LIKE 'prize:pid:%' THEN v\_canonical\_user\_id := LOWER(p\_user\_identifier);  
  ELSE v\_canonical\_user\_id := 'prize:pid:' || LOWER(p\_user\_identifier); END IF;

  SELECT available\_balance, id INTO v\_current\_balance, v\_user\_uuid FROM sub\_account\_balances WHERE canonical\_user\_id \= v\_canonical\_user\_id AND currency \= 'USD' FOR UPDATE;  
  IF NOT FOUND THEN  
    IF p\_user\_identifier \~ '^0x\[a-fA-F0-9\]{40}$' THEN  
      SELECT sab.available\_balance, sab.id INTO v\_current\_balance, v\_user\_uuid FROM sub\_account\_balances sab  
      JOIN canonical\_users cu ON cu.canonical\_user\_id \= sab.canonical\_user\_id  
      WHERE (LOWER(cu.wallet\_address) \= LOWER(p\_user\_identifier) OR LOWER(cu.base\_wallet\_address) \= LOWER(p\_user\_identifier) OR LOWER(cu.eth\_wallet\_address) \= LOWER(p\_user\_identifier))  
      AND sab.currency \= 'USD' LIMIT 1 FOR UPDATE;  
    END IF;  
    IF NOT FOUND THEN RETURN jsonb\_build\_object('success', false, 'error', 'User balance not found', 'error\_code', 'NO\_BALANCE\_RECORD'); END IF;  
  END IF;

  SELECT total\_tickets, status INTO v\_competition\_total\_tickets, v\_competition\_status FROM competitions WHERE id \= p\_competition\_id;  
  IF NOT FOUND THEN RETURN jsonb\_build\_object('success', false, 'error', 'Competition not found'); END IF;  
  IF v\_competition\_status \!= 'active' THEN RETURN jsonb\_build\_object('success', false, 'error', 'Competition is not active', 'competition\_status', v\_competition\_status); END IF;

  IF p\_ticket\_numbers IS NOT NULL AND array\_length(p\_ticket\_numbers, 1\) \> 0 THEN v\_final\_tickets := p\_ticket\_numbers;  
  ELSE  
    v\_final\_tickets := ARRAY\[\]::INTEGER\[\];  
    SELECT array\_agg(DISTINCT ticket\_number) INTO v\_used\_tickets FROM tickets WHERE competition\_id \= p\_competition\_id AND ticket\_number IS NOT NULL;  
    v\_available\_tickets := ARRAY\[\]::INTEGER\[\];  
    FOR v\_i IN 1..v\_competition\_total\_tickets LOOP  
      IF v\_used\_tickets IS NULL OR NOT (v\_i \= ANY(v\_used\_tickets)) THEN v\_available\_tickets := array\_append(v\_available\_tickets, v\_i); END IF;  
    END LOOP;  
    IF array\_length(v\_available\_tickets, 1\) \< p\_ticket\_count THEN  
      RETURN jsonb\_build\_object('success', false, 'error', 'Not enough tickets available', 'available\_count', COALESCE(array\_length(v\_available\_tickets, 1), 0), 'requested\_count', p\_ticket\_count);  
    END IF;  
    v\_needed\_count := p\_ticket\_count;  
    FOR v\_i IN 1..v\_needed\_count LOOP  
      v\_random\_index := 1 \+ floor(random() \* (array\_length(v\_available\_tickets, 1\) \- v\_i \+ 1))::INTEGER;  
      v\_ticket\_number := v\_available\_tickets\[v\_random\_index\];  
      v\_final\_tickets := array\_append(v\_final\_tickets, v\_ticket\_number);  
      v\_available\_tickets\[v\_random\_index\] := v\_available\_tickets\[array\_length(v\_available\_tickets, 1\) \- v\_i \+ 1\];  
    END LOOP;  
  END IF;

  v\_total\_cost := p\_ticket\_price \* array\_length(v\_final\_tickets, 1);  
  IF v\_current\_balance \< v\_total\_cost THEN RETURN jsonb\_build\_object('success', false, 'error', 'Insufficient balance', 'error\_code', 'INSUFFICIENT\_BALANCE', 'required', v\_total\_cost, 'available', v\_current\_balance); END IF;  
  v\_new\_balance := v\_current\_balance \- v\_total\_cost;

  UPDATE sub\_account\_balances SET available\_balance \= v\_new\_balance, updated\_at \= NOW() WHERE canonical\_user\_id \= v\_canonical\_user\_id AND currency \= 'USD';

  INSERT INTO balance\_ledger (canonical\_user\_id, transaction\_type, amount, currency, balance\_before, balance\_after, reference\_id, description, created\_at)  
  VALUES (v\_canonical\_user\_id, 'debit', \-v\_total\_cost, 'USD', v\_current\_balance, v\_new\_balance, COALESCE(p\_idempotency\_key, 'purchase\_' || gen\_random\_uuid()::TEXT), 'Purchase ' || array\_length(v\_final\_tickets, 1\) || ' tickets', NOW());

  v\_entry\_id := gen\_random\_uuid()::TEXT;  
  v\_ticket\_numbers\_str := array\_to\_string(v\_final\_tickets, ',');

  BEGIN  
    INSERT INTO joincompetition (uid, userid, competitionid, ticketnumbers, ticketcount, amountspent, transactionhash, createdat, updatedat)  
    VALUES (v\_entry\_id, v\_canonical\_user\_id, p\_competition\_id, v\_ticket\_numbers\_str, array\_length(v\_final\_tickets, 1), v\_total\_cost, COALESCE(p\_idempotency\_key, 'balance\_' || v\_entry\_id), NOW(), NOW());  
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN  
    INSERT INTO tickets (competition\_id, ticket\_number, user\_id, canonical\_user\_id, status, created\_at)  
    SELECT p\_competition\_id, unnest(v\_final\_tickets), v\_canonical\_user\_id, v\_canonical\_user\_id, 'sold', NOW();  
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb\_build\_object('success', true, 'entry\_id', v\_entry\_id, 'ticket\_numbers', v\_final\_tickets, 'ticket\_count', array\_length(v\_final\_tickets, 1), 'total\_cost', v\_total\_cost, 'previous\_balance', v\_current\_balance, 'new\_balance', v\_new\_balance, 'competition\_id', p\_competition\_id);  
EXCEPTION WHEN OTHERS THEN  
  RETURN jsonb\_build\_object('success', false, 'error', 'Internal error: ' || SQLERRM, 'error\_code', 'INTERNAL\_ERROR');  
END;  
$function$  
"  
public,record\_vrf\_callback,"p\_competition\_id uuid, p\_callback\_tx\_hash text, p\_random\_words text\[\], p\_winning\_ticket\_numbers integer\[\], p\_winner\_addresses text\[\], p\_callback\_block\_number bigint, p\_draw\_seed text, p\_raw\_event\_data jsonb","p\_competition\_id uuid, p\_callback\_tx\_hash text, p\_random\_words text\[\], p\_winning\_ticket\_numbers integer\[\], p\_winner\_addresses text\[\], p\_callback\_block\_number bigint DEFAULT NULL::bigint, p\_draw\_seed text DEFAULT NULL::text, p\_raw\_event\_data jsonb DEFAULT '{}'::jsonb",uuid,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.record\_vrf\_callback(p\_competition\_id uuid, p\_callback\_tx\_hash text, p\_random\_words text\[\], p\_winning\_ticket\_numbers integer\[\], p\_winner\_addresses text\[\], p\_callback\_block\_number bigint DEFAULT NULL::bigint, p\_draw\_seed text DEFAULT NULL::text, p\_raw\_event\_data jsonb DEFAULT '{}'::jsonb)  
 RETURNS uuid  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
    v\_callback\_id uuid;  
    v\_vrf\_request\_id uuid;  
    v\_count integer;  
BEGIN  
    \-- Find matching VRF request  
    SELECT id INTO v\_vrf\_request\_id  
    FROM public.vrf\_requests  
    WHERE competition\_id \= p\_competition\_id  
      AND status \= 'pending'  
    ORDER BY created\_at DESC  
    LIMIT 1;

    \-- Insert callback record  
    INSERT INTO public.vrf\_callbacks (  
        competition\_id,  
        vrf\_request\_id,  
        callback\_tx\_hash,  
        callback\_block\_number,  
        callback\_timestamp,  
        random\_words,  
        draw\_seed,  
        winning\_ticket\_numbers,  
        winner\_addresses,  
        raw\_event\_data,  
        processed,  
        processed\_at  
    ) VALUES (  
        p\_competition\_id,  
        v\_vrf\_request\_id,  
        p\_callback\_tx\_hash,  
        p\_callback\_block\_number,  
        now(),  
        p\_random\_words,  
        p\_draw\_seed,  
        p\_winning\_ticket\_numbers,  
        p\_winner\_addresses,  
        p\_raw\_event\_data,  
        true,  
        now()  
    )  
    RETURNING id INTO v\_callback\_id;

    \-- Update VRF request status if found  
    IF v\_vrf\_request\_id IS NOT NULL THEN  
        UPDATE public.vrf\_requests  
        SET status \= 'completed',  
            fulfillment\_transaction\_hash \= p\_callback\_tx\_hash,  
            completion\_timestamp \= now(),  
            random\_words \= p\_random\_words  
        WHERE id \= v\_vrf\_request\_id;  
    END IF;

    \-- Update competition status  
    UPDATE public.competitions  
    SET status \= 'drawn',  
        vrf\_verified \= true,  
        outcomes\_vrf\_seed \= p\_draw\_seed,  
        drawn\_at \= now(),  
        vrf\_error \= NULL  
    WHERE id \= p\_competition\_id;

    \-- Insert winners (handle NULL array lengths safely)  
    v\_count := LEAST(  
      COALESCE(array\_length(p\_winning\_ticket\_numbers, 1), 0),  
      COALESCE(array\_length(p\_winner\_addresses, 1), 0\)  
    );

    IF v\_count \> 0 THEN  
      FOR i IN 1..v\_count LOOP  
          INSERT INTO public.winners (  
              competition\_id,  
              wallet\_address,  
              ticket\_number,  
              is\_vrf\_verified,  
              vrf\_request\_id  
          ) VALUES (  
              p\_competition\_id,  
              p\_winner\_addresses\[i\],  
              p\_winning\_ticket\_numbers\[i\]::text,  
              true,  
              v\_vrf\_request\_id  
          )  
          ON CONFLICT (competition\_id, ticket\_number) DO UPDATE  
          SET wallet\_address \= EXCLUDED.wallet\_address,  
              is\_vrf\_verified \= true;  
      END LOOP;  
    END IF;

    \-- Log the VRF callback  
    INSERT INTO public.rng\_logs (  
        source,  
        function\_name,  
        competition\_id,  
        competition\_type,  
        numbers\_generated,  
        context,  
        outcome,  
        is\_winner,  
        security\_level,  
        vrf\_tx\_hash  
    ) VALUES (  
        'vrf\_callback',  
        'record\_vrf\_callback',  
        p\_competition\_id,  
        'draw',  
        p\_winning\_ticket\_numbers,  
        format('VRF callback processed. TX: %s, Winners: %s', p\_callback\_tx\_hash, v\_count),  
        'winner',  
        true,  
        'HIGH',  
        p\_callback\_tx\_hash  
    );

    RETURN v\_callback\_id;  
END;  
$function$  
"  
public,release\_reservation,"p\_reservation\_id uuid, p\_user\_id text","p\_reservation\_id uuid, p\_user\_id text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.release\_reservation(p\_reservation\_id uuid, p\_user\_id text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_reservation RECORD;  
BEGIN  
  SELECT \* INTO v\_reservation  
  FROM public.pending\_tickets  
  WHERE id \= p\_reservation\_id  
    AND user\_id \= p\_user\_id  
  FOR UPDATE SKIP LOCKED;

  IF v\_reservation IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Reservation not found or already locked');  
  END IF;

  IF v\_reservation.status \<\> 'pending' THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Reservation is already ' || v\_reservation.status);  
  END IF;

  UPDATE public.pending\_tickets  
  SET status \= 'cancelled',  
      updated\_at \= NOW()  
  WHERE id \= p\_reservation\_id;

  RETURN jsonb\_build\_object('success', true, 'message', 'Reservation cancelled successfully');  
EXCEPTION  
  WHEN OTHERS THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Failed to cancel reservation: ' || SQLERRM);  
END;  
$function$  
"  
public,repair\_topup\_provider\_and\_status,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.repair\_topup\_provider\_and\_status()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  has\_coinbase boolean := false;  
  ev\_id\_suffix text;  
  new\_meta jsonb;  
  new\_status text;  
BEGIN  
  \-- Only for topups; do not affect entries  
  IF NEW.type \<\> 'topup' THEN  
    RETURN NEW;  
  END IF;

  \-- Determine if Coinbase webhook exists for this transaction  
  ev\_id\_suffix := NEW.id::text;

  SELECT EXISTS (  
    SELECT 1  
    FROM public.payment\_webhook\_events pwe  
    WHERE pwe.provider \= 'coinbase-commerce'  
      AND (  
        (NEW.charge\_id IS NOT NULL AND pwe.transaction\_id \= NEW.charge\_id)  
        OR (pwe.event\_id LIKE 'TOPUP\_%\_' || ev\_id\_suffix)  
      )  
  ) INTO has\_coinbase;

  new\_meta := COALESCE(NEW.metadata, '{}'::jsonb);

  IF has\_coinbase THEN  
    IF COALESCE(new\_meta-\>\>'provider', '') \<\> 'coinbase' THEN  
      new\_meta := new\_meta || jsonb\_build\_object('provider', 'coinbase');  
    END IF;  
  END IF;

  \-- Auto-confirm when posted\_to\_balance is true  
  IF NEW.posted\_to\_balance IS TRUE THEN  
    new\_status := 'confirmed';  
  ELSE  
    new\_status := COALESCE(NEW.payment\_status, 'pending');  
  END IF;

  IF new\_meta IS DISTINCT FROM NEW.metadata OR new\_status IS DISTINCT FROM NEW.payment\_status THEN  
    NEW.metadata := new\_meta;  
    NEW.payment\_status := new\_status;  
  END IF;

  RETURN NEW;  
END;  
$function$  
"  
public,reservation\_broadcast\_trigger,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.reservation\_broadcast\_trigger()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  PERFORM realtime.broadcast\_changes(  
    'reservation:' || COALESCE(NEW.id, OLD.id)::text,  
    TG\_OP,  
    TG\_OP,  
    TG\_TABLE\_NAME,  
    TG\_TABLE\_SCHEMA,  
    NEW,  
    OLD  
  );  
  RETURN COALESCE(NEW, OLD);  
END;  
$function$  
"  
public,reserve\_competition\_tickets,"p\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_hold\_minutes integer","p\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_hold\_minutes integer DEFAULT 15",jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.reserve\_competition\_tickets(p\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_hold\_minutes integer DEFAULT 15\)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_parent\_id uuid := gen\_random\_uuid();  
  v\_now timestamptz := now();  
  v\_expires\_at timestamptz := v\_now \+ make\_interval(mins \=\> COALESCE(p\_hold\_minutes, 15));  
  v\_total integer := COALESCE(array\_length(p\_ticket\_numbers, 1), 0);  
  v\_conflicts int\[\];  
  v\_inserted\_count int := 0;  
  v\_status text;  
BEGIN  
  IF p\_user\_id IS NULL OR p\_competition\_id IS NULL OR v\_total \= 0 THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'invalid\_payload',  
      'message', 'user\_id, competition\_id and ticket\_numbers\[\] are required'  
    );  
  END IF;

  SELECT status INTO v\_status FROM public.competitions WHERE id \= p\_competition\_id;  
  IF v\_status IS NULL OR v\_status NOT IN ('active','live','running','open','ongoing') THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'competition\_not\_active',  
      'message', 'Competition is not accepting reservations'  
    );  
  END IF;

  INSERT INTO public.pending\_tickets (id, user\_id, competition\_id, status, hold\_minutes, expires\_at, created\_at, ticket\_count, ticket\_price, total\_amount, updated\_at, ticket\_numbers)  
  VALUES (v\_parent\_id, p\_user\_id, p\_competition\_id, 'pending', COALESCE(p\_hold\_minutes,15), v\_expires\_at, v\_now, v\_total, NULL, NULL, v\_now, NULL);

  WITH to\_try AS (  
    SELECT unnest(p\_ticket\_numbers) AS ticket\_number  
  ), ins AS (  
    INSERT INTO public.pending\_ticket\_items (id, pending\_ticket\_id, competition\_id, ticket\_number, status, expires\_at, created\_at)  
    SELECT gen\_random\_uuid(), v\_parent\_id, p\_competition\_id, t.ticket\_number, 'pending', v\_expires\_at, v\_now  
    FROM to\_try t  
    ON CONFLICT (competition\_id, ticket\_number, expires\_at) WHERE status='pending'  
    DO NOTHING  
    RETURNING ticket\_number  
  )  
  SELECT COUNT(\*) INTO v\_inserted\_count FROM ins;

  IF v\_inserted\_count \<\> v\_total THEN  
    SELECT ARRAY(  
      SELECT t.ticket\_number  
      FROM (SELECT unnest(p\_ticket\_numbers) AS ticket\_number) t  
      EXCEPT  
      SELECT i.ticket\_number FROM public.pending\_ticket\_items i  
      WHERE i.pending\_ticket\_id \= v\_parent\_id  
    ) INTO v\_conflicts;

    DELETE FROM public.pending\_ticket\_items WHERE pending\_ticket\_id \= v\_parent\_id;  
    DELETE FROM public.pending\_tickets WHERE id \= v\_parent\_id;

    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'conflict',  
      'message', 'Some requested tickets are no longer available',  
      'unavailableTickets', v\_conflicts  
    );  
  END IF;

  UPDATE public.pending\_tickets  
  SET ticket\_numbers \= p\_ticket\_numbers, ticket\_count \= v\_total, updated\_at \= now()  
  WHERE id \= v\_parent\_id;

  RETURN jsonb\_build\_object(  
    'success', true,  
    'reservationId', v\_parent\_id,  
    'reserved', p\_ticket\_numbers,  
    'expiresAt', v\_expires\_at  
  );  
EXCEPTION  
  WHEN unique\_violation THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'conflict',  
      'message', 'Requested tickets are no longer available'  
    );  
END;  
$function$  
"  
public,reserve\_selected\_tickets,"p\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_ticket\_price numeric, p\_hold\_minutes integer, p\_session\_id text","p\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_ticket\_price numeric DEFAULT 1, p\_hold\_minutes integer DEFAULT 15, p\_session\_id text DEFAULT NULL::text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.reserve\_selected\_tickets(p\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_ticket\_price numeric DEFAULT 1, p\_hold\_minutes integer DEFAULT 15, p\_session\_id text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_total\_tickets integer;  
  v\_unavailable integer\[\];  
  v\_conflicts integer\[\] := ARRAY\[\]::integer\[\];  
  v\_clean integer\[\];  
  v\_count int;  
  v\_reservation\_id uuid;  
  v\_expires\_at timestamptz;  
  v\_total\_amount numeric;  
  v\_inserted int;  
BEGIN  
  \-- Validate inputs  
  IF p\_ticket\_numbers IS NULL OR array\_length(p\_ticket\_numbers,1) IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'No tickets provided');  
  END IF;

  \-- Basic competition check and lock  
  SELECT total\_tickets INTO v\_total\_tickets  
  FROM competitions  
  WHERE id \= p\_competition\_id AND deleted \= false AND status \= 'active'  
  FOR UPDATE SKIP LOCKED;

  IF v\_total\_tickets IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Competition not found or locked', 'retryable', true);  
  END IF;

  \-- Normalize input: distinct, within range  
  SELECT array\_agg(DISTINCT t)  
  INTO v\_clean  
  FROM unnest(p\_ticket\_numbers) t  
  WHERE t BETWEEN 1 AND v\_total\_tickets;

  IF v\_clean IS NULL OR array\_length(v\_clean,1) IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'No valid tickets in range');  
  END IF;

  \-- Build current unavailable set  
  SELECT COALESCE(array\_agg(ticket\_number), ARRAY\[\]::int\[\])  
  INTO v\_unavailable  
  FROM get\_competition\_unavailable\_tickets(p\_competition\_id);

  \-- Pre-check conflicts vs current state  
  SELECT COALESCE(array\_agg(t), ARRAY\[\]::int\[\])  
  INTO v\_conflicts  
  FROM unnest(v\_clean) t  
  WHERE v\_unavailable @\> ARRAY\[t\];

  IF array\_length(v\_conflicts,1) IS NOT NULL AND array\_length(v\_conflicts,1) \> 0 THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'Some selected tickets are unavailable',  
      'status', 409,  
      'unavailableTickets', v\_conflicts,  
      'retryable', true  
    );  
  END IF;

  \-- Create reservation header  
  v\_reservation\_id := gen\_random\_uuid();  
  v\_count := array\_length(v\_clean,1);  
  v\_expires\_at := NOW() \+ make\_interval(mins \=\> LEAST(GREATEST(p\_hold\_minutes, 1), 60));  
  v\_total\_amount := v\_count \* p\_ticket\_price;

  INSERT INTO pending\_tickets (  
    id, user\_id, competition\_id, ticket\_numbers, ticket\_count, ticket\_price, total\_amount,  
    status, session\_id, expires\_at, created\_at, updated\_at  
  ) VALUES (  
    v\_reservation\_id, p\_user\_id, p\_competition\_id, v\_clean, v\_count, p\_ticket\_price, v\_total\_amount,  
    'pending', p\_session\_id, v\_expires\_at, NOW(), NOW()  
  );

  \-- Per-ticket locking via pending\_ticket\_items unique partial index  
  WITH ins AS (  
    INSERT INTO pending\_ticket\_items(competition\_id, pending\_ticket\_id, ticket\_number, status, created\_at, updated\_at)  
    SELECT p\_competition\_id, v\_reservation\_id, t, 'pending', NOW(), NOW()  
    FROM unnest(v\_clean) t  
    ON CONFLICT DO NOTHING  
    RETURNING ticket\_number  
  )  
  SELECT COUNT(\*) INTO v\_inserted FROM ins;

  IF v\_inserted \< v\_count THEN  
    \-- Determine which failed  
    SELECT COALESCE(array\_agg(t), ARRAY\[\]::int\[\])  
    INTO v\_conflicts  
    FROM unnest(v\_clean) t  
    WHERE t NOT IN (  
      SELECT ticket\_number FROM pending\_ticket\_items WHERE pending\_ticket\_id \= v\_reservation\_id  
    );

    \-- Cleanup header and any partial items  
    DELETE FROM pending\_ticket\_items WHERE pending\_ticket\_id \= v\_reservation\_id;  
    DELETE FROM pending\_tickets WHERE id \= v\_reservation\_id;

    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'Some selected tickets were claimed concurrently',  
      'status', 409,  
      'unavailableTickets', v\_conflicts,  
      'retryable', true  
    );  
  END IF;

  RETURN jsonb\_build\_object(  
    'success', true,  
    'reservation\_id', v\_reservation\_id,  
    'ticket\_numbers', v\_clean,  
    'ticket\_count', v\_count,  
    'total\_amount', v\_total\_amount,  
    'expires\_at', v\_expires\_at  
  );

EXCEPTION WHEN OTHERS THEN  
  \-- Cleanup on error if header exists  
  IF v\_reservation\_id IS NOT NULL THEN  
    DELETE FROM pending\_ticket\_items WHERE pending\_ticket\_id \= v\_reservation\_id;  
    DELETE FROM pending\_tickets WHERE id \= v\_reservation\_id;  
  END IF;  
  RETURN jsonb\_build\_object('success', false, 'error', 'Failed to reserve: ' || SQLERRM, 'retryable', true);  
END;  
$function$  
"  
public,reserve\_tickets,"p\_competition\_id uuid, p\_wallet\_address text, p\_ticket\_count integer, p\_hold\_minutes integer","p\_competition\_id uuid, p\_wallet\_address text, p\_ticket\_count integer, p\_hold\_minutes integer DEFAULT 15",record,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION public.reserve\_tickets(p\_competition\_id uuid, p\_wallet\_address text, p\_ticket\_count integer, p\_hold\_minutes integer DEFAULT 15\)  
 RETURNS TABLE(pending\_ticket\_id uuid, expires\_at timestamp with time zone, ticket\_numbers integer\[\])  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_price numeric;  
  v\_now timestamptz := now();  
  v\_pending\_id uuid := gen\_random\_uuid();  
  v\_expires timestamptz := v\_now \+ make\_interval(mins \=\> p\_hold\_minutes);  
  v\_numbers int\[\] := '{}';  
BEGIN  
  \-- Validate competition and price  
  SELECT ticket\_price INTO v\_price FROM public.competitions WHERE id \= p\_competition\_id AND deleted \= false AND status IN ('active','upcoming') LIMIT 1;  
  IF NOT FOUND THEN RAISE EXCEPTION 'competition\_not\_available'; END IF;

  \-- Create pending\_tickets shell  
  INSERT INTO public.pending\_tickets(id, user\_id, wallet\_address, competition\_id, status, hold\_minutes, expires\_at, ticket\_count, ticket\_price, total\_amount)  
  VALUES (v\_pending\_id, p\_wallet\_address, p\_wallet\_address, p\_competition\_id, 'pending', p\_hold\_minutes, v\_expires, p\_ticket\_count, v\_price, v\_price \* p\_ticket\_count);

  \-- Pick available numbers: prefer from tickets where status='available'; otherwise allocate next numbers  
  WITH avail AS (  
    SELECT ticket\_number FROM public.tickets  
    WHERE competition\_id \= p\_competition\_id AND status \= 'available'  
    ORDER BY ticket\_number  
    LIMIT p\_ticket\_count  
  ), fallback AS (  
    SELECT generate\_series(1, (SELECT total\_tickets FROM public.competitions WHERE id \= p\_competition\_id)) AS ticket\_number  
  ), chosen AS (  
    SELECT ticket\_number FROM avail  
    UNION  
    SELECT f.ticket\_number FROM fallback f  
    LEFT JOIN public.tickets t ON t.competition\_id \= p\_competition\_id AND t.ticket\_number \= f.ticket\_number  
    LEFT JOIN public.pending\_ticket\_items pti ON pti.competition\_id \= p\_competition\_id AND pti.ticket\_number \= f.ticket\_number AND pti.status='pending' AND pti.expires\_at \> v\_now  
    WHERE t.id IS NULL AND pti.id IS NULL  
    ORDER BY ticket\_number  
    LIMIT p\_ticket\_count  
  )  
  INSERT INTO public.pending\_ticket\_items(id, pending\_ticket\_id, competition\_id, ticket\_number, status, expires\_at)  
  SELECT gen\_random\_uuid(), v\_pending\_id, p\_competition\_id, ticket\_number, 'pending', v\_expires FROM chosen  
  RETURNING ticket\_number INTO v\_numbers;

  IF array\_length(v\_numbers,1) IS DISTINCT FROM p\_ticket\_count THEN  
    \-- Not enough tickets; cleanup  
    DELETE FROM public.pending\_ticket\_items WHERE pending\_ticket\_id \= v\_pending\_id;  
    DELETE FROM public.pending\_tickets WHERE id \= v\_pending\_id;  
    RAISE EXCEPTION 'insufficient\_tickets\_available';  
  END IF;

  RETURN QUERY SELECT v\_pending\_id, v\_expires, v\_numbers;  
END; $function$  
"  
public,resolve\_canonical\_identity,"p\_id uuid, p\_canonical\_user\_id text, p\_wallet\_address text, p\_privy\_user\_id text, p\_email text, p\_username text","p\_id uuid DEFAULT NULL::uuid, p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_username text DEFAULT NULL::text",record,plpgsql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.resolve\_canonical\_identity(p\_id uuid DEFAULT NULL::uuid, p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_username text DEFAULT NULL::text)  
 RETURNS TABLE(id uuid, canonical\_user\_id text, wallet\_address text, email text, privy\_user\_id text, username text, resolved\_via text)  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
declare  
  v\_row public.canonical\_users%rowtype;  
begin  
  \-- 1\) Match by internal UUID id  
  if p\_id is not null then  
    select \*  
      into v\_row  
    from public.canonical\_users cu  
    where cu.id \= p\_id  
    limit 1;

    if found then  
      return query  
      select v\_row.id, v\_row.canonical\_user\_id, v\_row.wallet\_address, v\_row.email,  
             v\_row.privy\_user\_id, v\_row.username, 'id'::text as resolved\_via;  
      return;  
    end if;  
  end if;

  \-- 2\) Match by canonical\_user\_id (exact)  
  if p\_canonical\_user\_id is not null then  
    select \*  
      into v\_row  
    from public.canonical\_users cu  
    where cu.canonical\_user\_id \= p\_canonical\_user\_id  
    limit 1;

    if found then  
      return query  
      select v\_row.id, v\_row.canonical\_user\_id, v\_row.wallet\_address, v\_row.email,  
             v\_row.privy\_user\_id, v\_row.username, 'canonical\_user\_id'::text as resolved\_via;  
      return;  
    end if;  
  end if;

  \-- 3\) Match by privy\_user\_id (exact)  
  if p\_privy\_user\_id is not null then  
    select \*  
      into v\_row  
    from public.canonical\_users cu  
    where cu.privy\_user\_id \= p\_privy\_user\_id  
    limit 1;

    if found then  
      return query  
      select v\_row.id, v\_row.canonical\_user\_id, v\_row.wallet\_address, v\_row.email,  
             v\_row.privy\_user\_id, v\_row.username, 'privy\_user\_id'::text as resolved\_via;  
      return;  
    end if;  
  end if;

  \-- 4\) Match by wallet\_address (case-insensitive)  
  if p\_wallet\_address is not null then  
    select \*  
      into v\_row  
    from public.canonical\_users cu  
    where lower(cu.wallet\_address) \= lower(p\_wallet\_address)  
    limit 1;

    if found then  
      return query  
      select v\_row.id, v\_row.canonical\_user\_id, v\_row.wallet\_address, v\_row.email,  
             v\_row.privy\_user\_id, v\_row.username, 'wallet\_address'::text as resolved\_via;  
      return;  
    end if;  
  end if;

  \-- 5\) Match by email (case-insensitive)  
  if p\_email is not null then  
    select \*  
      into v\_row  
    from public.canonical\_users cu  
    where lower(cu.email) \= lower(p\_email)  
    limit 1;

    if found then  
      return query  
      select v\_row.id, v\_row.canonical\_user\_id, v\_row.wallet\_address, v\_row.email,  
             v\_row.privy\_user\_id, v\_row.username, 'email'::text as resolved\_via;  
      return;  
    end if;  
  end if;

  \-- 6\) Match by username (case-insensitive)  
  if p\_username is not null then  
    select \*  
      into v\_row  
    from public.canonical\_users cu  
    where lower(cu.username) \= lower(p\_username)  
    limit 1;

    if found then  
      return query  
      select v\_row.id, v\_row.canonical\_user\_id, v\_row.wallet\_address, v\_row.email,  
             v\_row.privy\_user\_id, v\_row.username, 'username'::text as resolved\_via;  
      return;  
    end if;  
  end if;

  \-- If nothing matched, return no rows (NULL result)  
  return;  
end;  
$function$  
"  
public,resolve\_canonical\_user\_id,input\_id text,input\_id text,text,plpgsql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION public.resolve\_canonical\_user\_id(input\_id text)  
 RETURNS text  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
declare  
  cid text;  
begin  
  if input\_id is null then  
    return null;  
  end if;

  if input\_id \~ '^prize:pid:' then  
    return input\_id;  
  end if;

  if lower(input\_id) \~ '^0x\[a-f0-9\]{40}$' then  
    select cu.canonical\_user\_id into cid  
    from public.canonical\_users cu  
    where cu.wallet\_address \= lower(input\_id)  
       or cu.base\_wallet\_address \= lower(input\_id)  
       or cu.eth\_wallet\_address \= lower(input\_id);

    return cid;  
  end if;

  if input\_id \~ '^did:privy:' then  
    select cu.canonical\_user\_id into cid  
    from public.canonical\_users cu  
    where cu.privy\_user\_id \= input\_id;

    return cid;  
  end if;

  select cu.canonical\_user\_id into cid  
  from public.canonical\_users cu  
  where cu.canonical\_user\_id \= input\_id;

  return cid;  
end;  
$function$  
"  
public,resolve\_or\_create\_canonical\_user,p\_canonical\_user\_id text,p\_canonical\_user\_id text,canonical\_users,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.resolve\_or\_create\_canonical\_user(p\_canonical\_user\_id text)  
 RETURNS canonical\_users  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
declare  
  u public.canonical\_users;  
begin  
  if p\_canonical\_user\_id is null or p\_canonical\_user\_id \!\~ '^prize:pid:0x\[a-f0-9\]{40}$' then  
    raise exception 'Invalid canonical\_user\_id format';  
  end if;

  select \* into u  
  from public.canonical\_users  
  where canonical\_user\_id \= p\_canonical\_user\_id;

  if not found then  
    insert into public.canonical\_users (canonical\_user\_id)  
    values (p\_canonical\_user\_id)  
    returning \* into u;  
  end if;

  return u;  
end;  
$function$  
"  
public,rpc\_debit\_balance\_for\_order,p\_order\_id uuid,p\_order\_id uuid,json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.rpc\_debit\_balance\_for\_order(p\_order\_id uuid)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public', 'pg\_temp'  
AS $function$  
DECLARE  
  v\_order public.orders%ROWTYPE;  
  v\_canon text;  
  v\_amount numeric;  
BEGIN  
  v\_canon := (auth.jwt() \-\>\> 'canonical\_user\_id');  
  IF v\_canon IS NULL THEN  
    RAISE EXCEPTION 'Missing canonical\_user\_id claim';  
  END IF;

  SELECT \* INTO v\_order FROM public.orders WHERE id \= p\_order\_id;  
  IF NOT FOUND THEN  
    RAISE EXCEPTION 'Order not found';  
  END IF;  
  IF v\_order.user\_id \<\> v\_canon THEN  
    RAISE EXCEPTION 'Forbidden';  
  END IF;  
  IF NOT ((v\_order.payment\_method \= 'balance' OR v\_order.order\_type \= 'balance')  
          AND (v\_order.status ILIKE 'completed' OR COALESCE(v\_order.payment\_status,'') ILIKE 'paid%')) THEN  
    RAISE EXCEPTION 'Order is not marked completed/paid via balance';  
  END IF;

  v\_amount := COALESCE(v\_order.amount\_usd, v\_order.amount);  
  RETURN public.debit\_balance\_and\_confirm\_tickets(  
    v\_canon,  
    v\_order.id,  
    v\_order.competition\_id,  
    v\_amount,  
    md5(v\_order.id::text || '-balance'),  
    'USD'  
  );  
END;  
$function$  
"  
public,run\_competition\_entries\_batch,"batch\_limit\_per\_competition integer, order\_most\_recent\_first boolean","batch\_limit\_per\_competition integer DEFAULT 100, order\_most\_recent\_first boolean DEFAULT true",json,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.run\_competition\_entries\_batch(batch\_limit\_per\_competition integer DEFAULT 100, order\_most\_recent\_first boolean DEFAULT true)  
 RETURNS json  
 LANGUAGE plpgsql  
AS $function$  
declare  
  v\_processed\_users int := 0;  
  v\_processed\_tickets int := 0;  
  v\_competitions\_touched int := 0;  
begin  
  \-- Ensure progress table exists (idempotent)  
  perform 1 from pg\_catalog.pg\_class c  
   join pg\_catalog.pg\_namespace n on n.oid \= c.relnamespace  
  where n.nspname \= 'public' and c.relname \= '\_entries\_progress' and c.relkind \= 'r';  
  if not found then  
    create table if not exists public.\_entries\_progress (  
      competition\_id uuid not null,  
      canonical\_user\_id text not null,  
      last\_ticket\_number integer not null default 0,  
      last\_processed\_at timestamptz not null default now(),  
      primary key (competition\_id, canonical\_user\_id)  
    );  
  end if;

  with comp\_limits as (  
    select c.id as competition\_id,  
           batch\_limit\_per\_competition as batch\_limit  
    from public.competitions c  
    where coalesce(c.deleted, false) \= false  
  ),  
  base\_tickets as (  
    select t.competition\_id,  
           t.canonical\_user\_id,  
           t.ticket\_number,  
           t.wallet\_address,  
           t.purchase\_date,  
           t.purchase\_price,  
           coalesce(t.purchase\_price, c.ticket\_price) as effective\_price  
    from public.tickets t  
    join public.competitions c on c.id \= t.competition\_id  
    where t.canonical\_user\_id is not null  
      and (t.status is distinct from 'refunded')  
  ),  
  with\_progress as (  
    select b.\*, coalesce(p.last\_ticket\_number, 0\) as last\_ticket\_number  
    from base\_tickets b  
    left join public.\_entries\_progress p  
      on p.competition\_id \= b.competition\_id  
     and p.canonical\_user\_id \= b.canonical\_user\_id  
  ),  
  eligible as (  
    select wp.\*,  
           row\_number() over (  
             partition by wp.competition\_id  
             order by case when order\_most\_recent\_first then wp.purchase\_date end desc nulls last,  
                      case when order\_most\_recent\_first then wp.ticket\_number end desc,  
                      case when not order\_most\_recent\_first then wp.purchase\_date end nulls last,  
                      case when not order\_most\_recent\_first then wp.ticket\_number end  
           ) as rn\_comp  
    from with\_progress wp  
    where wp.ticket\_number \> wp.last\_ticket\_number  
  ),  
  limited as (  
    select e.\* from eligible e  
    join comp\_limits cl on cl.competition\_id \= e.competition\_id  
    where e.rn\_comp \<= cl.batch\_limit  
  ),  
  agg as (  
    select l.competition\_id,  
           l.canonical\_user\_id,  
           coalesce(max(l.wallet\_address), split\_part(l.canonical\_user\_id, 'prize:pid:', 2)) as wallet\_address,  
           count(\*)::int as add\_ticket\_count,  
           string\_agg(l.ticket\_number::text, ',' order by l.ticket\_number) as add\_ticket\_csv,  
           sum(coalesce(l.effective\_price, 0)) as add\_amount,  
           max(l.purchase\_date) as add\_latest\_purchase\_at,  
           max(l.ticket\_number) as new\_last\_ticket\_number  
    from limited l  
    group by l.competition\_id, l.canonical\_user\_id  
  ),  
  upserted as (  
    insert into public.competition\_entries as ce  
      (competition\_id, canonical\_user\_id, wallet\_address, tickets\_count, ticket\_numbers\_csv, amount\_spent, latest\_purchase\_at)  
    select a.competition\_id,  
           a.canonical\_user\_id,  
           a.wallet\_address,  
           a.add\_ticket\_count,  
           a.add\_ticket\_csv,  
           a.add\_amount,  
           a.add\_latest\_purchase\_at  
    from agg a  
    on conflict (competition\_id, canonical\_user\_id) do update  
    set tickets\_count \= coalesce(ce.tickets\_count, 0\) \+ excluded.tickets\_count,  
        ticket\_numbers\_csv \= case  
          when ce.ticket\_numbers\_csv is null or ce.ticket\_numbers\_csv \= '' then excluded.ticket\_numbers\_csv  
          else ce.ticket\_numbers\_csv || ',' || excluded.ticket\_numbers\_csv  
        end,  
        amount\_spent \= coalesce(ce.amount\_spent, 0\) \+ coalesce(excluded.amount\_spent, 0),  
        latest\_purchase\_at \= greatest(coalesce(ce.latest\_purchase\_at, excluded.latest\_purchase\_at), excluded.latest\_purchase\_at),  
        wallet\_address \= coalesce(ce.wallet\_address, excluded.wallet\_address),  
        updated\_at \= now()  
    returning ce.competition\_id, ce.canonical\_user\_id  
  )  
  insert into public.\_entries\_progress (competition\_id, canonical\_user\_id, last\_ticket\_number, last\_processed\_at)  
  select a.competition\_id, a.canonical\_user\_id, a.new\_last\_ticket\_number, now()  
  from agg a  
  on conflict (competition\_id, canonical\_user\_id) do update  
  set last\_ticket\_number \= greatest(coalesce(public.\_entries\_progress.last\_ticket\_number, 0), excluded.last\_ticket\_number),  
      last\_processed\_at \= now()  
  returning 1;

  get diagnostics v\_processed\_users \= row\_count; \-- users updated in progress

  select coalesce(sum(add\_ticket\_count),0), coalesce(count(distinct competition\_id),0)  
  into v\_processed\_tickets, v\_competitions\_touched  
  from agg;

  return json\_build\_object(  
    'processed\_users', v\_processed\_users,  
    'processed\_tickets', v\_processed\_tickets,  
    'competitions\_touched', v\_competitions\_touched,  
    'message', 'batch complete'  
  );  
end;  
$function$  
"  
public,set\_canonical\_user\_id\_from\_wallet,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.set\_canonical\_user\_id\_from\_wallet()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.canonical\_user\_id IS NULL AND NEW.wallet\_address IS NOT NULL THEN  
    \-- normalize wallet to lowercase  
    NEW.wallet\_address := lower(NEW.wallet\_address);  
    IF NEW.wallet\_address \~ '^0x\[a-f0-9\]{40}$' THEN  
      NEW.canonical\_user\_id := 'prize:pid:' || NEW.wallet\_address;  
    END IF;  
  END IF;  
  RETURN NEW;  
END;$function$  
"  
public,set\_payments\_updated\_at,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.set\_payments\_updated\_at()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  NEW.updated\_at := now();  
  RETURN NEW;  
END;$function$  
"  
public,set\_primary\_wallet,"user\_identifier text, p\_wallet\_address text","user\_identifier text, p\_wallet\_address text",json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.set\_primary\_wallet(user\_identifier text, p\_wallet\_address text)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user RECORD;  
  v\_normalized\_address TEXT;  
  v\_existing\_wallets JSONB;  
  v\_updated\_wallets JSONB;  
  v\_wallet\_found BOOLEAN := false;  
  v\_old\_canonical\_id TEXT;  
  v\_new\_canonical\_id TEXT;  
BEGIN  
  \-- Normalize wallet address  
  v\_normalized\_address := LOWER(p\_wallet\_address);

  \-- Find user by various identifiers  
  SELECT \* INTO v\_user  
  FROM canonical\_users cu  
  WHERE cu.canonical\_user\_id \= user\_identifier  
     OR LOWER(cu.wallet\_address) \= LOWER(user\_identifier)  
     OR LOWER(cu.base\_wallet\_address) \= LOWER(user\_identifier)  
     OR cu.privy\_user\_id \= user\_identifier  
     OR cu.email ILIKE user\_identifier  
     OR cu.uid::TEXT \= user\_identifier  
  LIMIT 1;

  IF v\_user IS NULL THEN  
    RETURN json\_build\_object('success', false, 'error', 'User not found');  
  END IF;

  \-- Get existing wallets  
  v\_existing\_wallets := COALESCE(v\_user.linked\_wallets, '\[\]'::JSONB);

  \-- Check if wallet exists in linked\_wallets or is the current base/external wallet  
  SELECT EXISTS(  
    SELECT 1 FROM jsonb\_array\_elements(v\_existing\_wallets) AS w  
    WHERE LOWER(w-\>\>'address') \= v\_normalized\_address  
  ) OR LOWER(v\_user.base\_wallet\_address) \= v\_normalized\_address  
    OR LOWER(v\_user.linked\_external\_wallet) \= v\_normalized\_address  
    OR LOWER(v\_user.wallet\_address) \= v\_normalized\_address  
  INTO v\_wallet\_found;

  IF NOT v\_wallet\_found THEN  
    RETURN json\_build\_object('success', false, 'error', 'Wallet not found in account');  
  END IF;

  \-- Store old canonical ID for reference  
  v\_old\_canonical\_id := v\_user.canonical\_user\_id;

  \-- Generate new canonical ID based on new primary wallet  
  v\_new\_canonical\_id := 'prize:pid:' || v\_normalized\_address;

  \-- Update is\_primary flag in linked\_wallets array  
  SELECT jsonb\_agg(  
    CASE  
      WHEN LOWER(w-\>\>'address') \= v\_normalized\_address  
      THEN w || '{""is\_primary"": true}'::JSONB  
      ELSE w || '{""is\_primary"": false}'::JSONB  
    END  
  )  
  INTO v\_updated\_wallets  
  FROM jsonb\_array\_elements(v\_existing\_wallets) AS w;

  \-- Update the user record  
  UPDATE canonical\_users  
  SET  
    primary\_wallet\_address \= v\_normalized\_address,  
    wallet\_address \= v\_normalized\_address,  
    canonical\_user\_id \= v\_new\_canonical\_id,  
    linked\_wallets \= COALESCE(v\_updated\_wallets, v\_existing\_wallets),  
    updated\_at \= NOW()  
  WHERE uid \= v\_user.uid;

  RETURN json\_build\_object(  
    'success', true,  
    'message', 'Primary wallet updated successfully',  
    'old\_canonical\_id', v\_old\_canonical\_id,  
    'new\_canonical\_id', v\_new\_canonical\_id,  
    'primary\_wallet', v\_normalized\_address  
  );  
END;  
$function$  
"  
public,staging\_auto\_cleanup,IN target\_schemas text\[\],IN target\_schemas text\[\] DEFAULT ARRAY\['public'::text\],void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE PROCEDURE public.staging\_auto\_cleanup(IN target\_schemas text\[\] DEFAULT ARRAY\['public'::text\])  
 LANGUAGE plpgsql  
AS $procedure$  
declare  
  dup\_idx record;  
  dup\_con record;  
  dup\_trg record;  
begin  
  \-- Drop duplicate non-constraint indexes  
  for dup\_idx in (  
    with idx as (  
      select  
        n.nspname as schema,  
        c.relname as index\_name,  
        i.indexrelid,  
        i.indrelid,  
        i.indisunique,  
        i.indisprimary,  
        i.indpred,  
        i.indisvalid,  
        i.indisready,  
        pg\_get\_indexdef(i.indexrelid) as idxdef,  
        pg\_get\_expr(i.indpred, i.indrelid) as predicate,  
        pg\_get\_indexdef(i.indexrelid) || ' WHERE ' || coalesce(pg\_get\_expr(i.indpred, i.indrelid), '') as identity,  
        pg\_get\_constraintdef(con.oid) as condef,  
        con.oid as conoid,  
        c2.relname as table\_name,  
        c2.oid as table\_oid,  
        c.reltuples  
      from pg\_index i  
      join pg\_class c on c.oid \= i.indexrelid  
      join pg\_namespace n on n.oid \= c.relnamespace  
      join pg\_class c2 on c2.oid \= i.indrelid  
      left join pg\_constraint con on con.conindid \= i.indexrelid  
      where n.nspname \= any(target\_schemas)  
        and con.oid is null  
        and i.indisvalid is true  
        and i.indisready is true  
    )  
    select \* from (  
      select \*, row\_number() over (partition by schema, indrelid, identity order by indexrelid) as rn  
      from idx  
    ) s  
    where s.rn \> 1  
  ) loop  
    begin  
      execute format('drop index if exists %I.%I;', dup\_idx.schema, dup\_idx.index\_name);  
    exception when others then null;  
    end;  
  end loop;

  \-- Drop duplicate constraints (same key columns and predicate). Keep the oldest by oid.  
  for dup\_con in (  
    with cons as (  
      select  
        n.nspname as schema,  
        c.relname as table\_name,  
        con.conname,  
        con.oid as conoid,  
        con.contype,  
        con.conindid,  
        pg\_get\_constraintdef(con.oid, true) as condef,  
        (  
          select string\_agg(a.attname, ',' order by x.k)  
          from unnest(con.conkey) with ordinality as x(attnum, k)  
          join pg\_attribute a on a.attrelid \= con.conrelid and a.attnum \= x.attnum  
        ) as keycols  
      from pg\_constraint con  
      join pg\_class c on c.oid \= con.conrelid  
      join pg\_namespace n on n.oid \= c.relnamespace  
      where n.nspname \= any(target\_schemas)  
        and con.contype in ('p','u')  
    ), grouped as (  
      select \*, row\_number() over (  
        partition by schema, table\_name, contype, keycols, condef order by conoid  
      ) rn  
      from cons  
    )  
    select \* from grouped where rn \> 1  
  ) loop  
    begin  
      execute format('alter table %I.%I drop constraint %I;', dup\_con.schema, dup\_con.table\_name, dup\_con.conname);  
    exception when others then null;  
    end;  
  end loop;

  \-- Drop duplicate triggers (same table, function, timing, events, when). Keep oldest by oid.  
  for dup\_trg in (  
    with trg as (  
      select  
        n.nspname as schema,  
        c.relname as table\_name,  
        t.tgname,  
        t.oid as tgoid,  
        t.tgenabled,  
        t.tgtype,  
        t.tgfoid,  
        pg\_get\_triggerdef(t.oid, true) as tgdef  
      from pg\_trigger t  
      join pg\_class c on c.oid \= t.tgrelid  
      join pg\_namespace n on n.oid \= c.relnamespace  
      where n.nspname \= any(target\_schemas)  
        and not t.tgisinternal  
    ), grouped as (  
      select \*, row\_number() over (  
        partition by schema, table\_name, tgdef order by tgoid  
      ) rn  
      from trg  
    )  
    select \* from grouped where rn \> 1  
  ) loop  
    begin  
      execute format('drop trigger if exists %I on %I.%I;', dup\_trg.tgname, dup\_trg.schema, dup\_trg.table\_name);  
    exception when others then null;  
    end;  
  end loop;  
end;  
$procedure$  
"  
public,sub\_account\_balances\_sync\_ids,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.sub\_account\_balances\_sync\_ids()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.user\_id IS NOT NULL THEN  
    NEW.user\_id := 'prize:pid:' || lower(replace(NEW.user\_id::text, 'prize:pid:', ''));  
    NEW.canonical\_user\_id := NEW.user\_id;  
  ELSIF NEW.canonical\_user\_id IS NOT NULL THEN  
    NEW.canonical\_user\_id := 'prize:pid:' || lower(replace(NEW.canonical\_user\_id::text, 'prize:pid:', ''));  
    NEW.user\_id := NEW.canonical\_user\_id;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,sub\_account\_bonus\_trigger,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.sub\_account\_bonus\_trigger()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_prev numeric := COALESCE((CASE WHEN TG\_OP \= 'UPDATE' THEN OLD.available\_balance ELSE NULL END), 0);  
  v\_new numeric := COALESCE(NEW.available\_balance, 0);  
BEGIN  
  \-- Only USD rows and only when crossing strictly above 3  
  IF NEW.currency \= 'USD' AND v\_new \> 3 AND COALESCE(v\_prev, 0\) \<= 3 THEN  
    PERFORM public.award\_welcome\_bonus(NEW.wallet\_address, 3, 100);  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,sync\_all\_external\_wallet\_balances,,,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.sync\_all\_external\_wallet\_balances()  
 RETURNS TABLE(privy\_user\_id text, wallet\_address text, external\_balance numeric, previous\_internal\_balance numeric, new\_internal\_balance numeric, difference numeric)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE v\_user RECORD; BEGIN  
  FOR v\_user IN SELECT \* FROM canonical\_users LOOP  
    RETURN QUERY SELECT v\_user.privy\_user\_id, v\_user.wallet\_address, 0::NUMERIC, COALESCE(v\_user.usdc\_balance,0)::NUMERIC, COALESCE(v\_user.usdc\_balance,0)::NUMERIC, 0::NUMERIC;  
  END LOOP; END; $function$  
"  
public,sync\_all\_user\_balances,,,record,plpgsql,true,v,false,true,null,"CREATE OR REPLACE FUNCTION public.sync\_all\_user\_balances()  
 RETURNS TABLE(canonical\_user\_id text, old\_balance numeric, new\_balance numeric)  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  RETURN QUERY  
  UPDATE public.canonical\_users cu  
  SET   
    usdc\_balance \= sab.available\_balance,  
    updated\_at \= now()  
  FROM public.sub\_account\_balances sab  
  WHERE cu.canonical\_user\_id \= sab.canonical\_user\_id  
    AND COALESCE(cu.usdc\_balance,0) \!= COALESCE(sab.available\_balance,0)  
  RETURNING   
    cu.canonical\_user\_id,  
    cu.usdc\_balance AS old\_balance,  
    sab.available\_balance AS new\_balance;  
END;  
$function$  
"  
public,sync\_canonical\_user\_balance,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.sync\_canonical\_user\_balance()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  UPDATE public.canonical\_users cu  
  SET   
    usdc\_balance \= NEW.available\_balance,  
    updated\_at \= now()  
  WHERE cu.canonical\_user\_id \= NEW.canonical\_user\_id;  
  RETURN NEW;  
END;  
$function$  
"  
public,sync\_competition\_status\_if\_ended,p\_competition\_id uuid,p\_competition\_id uuid,bool,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.sync\_competition\_status\_if\_ended(p\_competition\_id uuid)  
 RETURNS boolean  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  comp\_end\_date TIMESTAMPTZ;  
  comp\_status TEXT;  
BEGIN  
  SELECT status, end\_date INTO comp\_status, comp\_end\_date  
  FROM competitions  
  WHERE id \= p\_competition\_id;

  IF NOT FOUND THEN  
    RETURN FALSE;  
  END IF;

  IF comp\_status IN ('completed', 'drawn', 'cancelled') THEN  
    RETURN FALSE;  
  END IF;

  IF comp\_end\_date IS NOT NULL AND comp\_end\_date \< NOW() THEN  
    UPDATE competitions  
    SET  
      status \= 'completed',  
      updated\_at \= NOW()  
    WHERE id \= p\_competition\_id  
      AND status IN ('active', 'drawing', 'paused');

    IF FOUND THEN  
      RETURN TRUE;  
    END IF;  
  END IF;

  RETURN FALSE;  
END;  
$function$  
"  
public,sync\_completed\_deposits\_to\_usdc,wallet\_address\_param text,wallet\_address\_param text DEFAULT NULL::text,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.sync\_completed\_deposits\_to\_usdc(wallet\_address\_param text DEFAULT NULL::text)  
 RETURNS TABLE(wallet\_address text, transactions\_processed integer, total\_deposits\_converted numeric, new\_usdc\_balance numeric)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$ BEGIN  
  RETURN QUERY SELECT wallet\_address\_param::TEXT, 0::INTEGER, 0::NUMERIC, 0::NUMERIC; END; $function$  
"  
public,sync\_external\_wallet\_balances,privy\_user\_id\_param text,privy\_user\_id\_param text,record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.sync\_external\_wallet\_balances(privy\_user\_id\_param text)  
 RETURNS TABLE(user\_wallet\_address text, external\_balance numeric, previous\_internal\_balance numeric, new\_internal\_balance numeric, difference numeric)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE v\_user\_record RECORD; v\_ext NUMERIC; v\_prev NUMERIC; v\_new NUMERIC; BEGIN  
  SELECT \* INTO v\_user\_record FROM canonical\_users WHERE privy\_user\_id=privy\_user\_id\_param LIMIT 1;  
  IF v\_user\_record IS NULL THEN RETURN; END IF;  
  v\_ext := 0; v\_prev := COALESCE(v\_user\_record.usdc\_balance,0); v\_new := v\_prev \+ v\_ext;  
  UPDATE canonical\_users SET usdc\_balance=v\_new, updated\_at=NOW() WHERE id=v\_user\_record.id;  
  RETURN QUERY SELECT v\_user\_record.wallet\_address, v\_ext, v\_prev, v\_new, v\_new \- v\_prev; END; $function$  
"  
public,sync\_identity\_columns,,,trigger,plpgsql,true,v,false,false,"Robust identity sync function that enriches rows with canonical\_user\_id and wallet\_address  
by looking up users via any available identity field (canonical\_user\_id, privy\_user\_id,  
wallet\_address, base\_wallet\_address, or uid). Does not assume any specific column exists.","CREATE OR REPLACE FUNCTION public.sync\_identity\_columns()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
    v\_row\_json jsonb;  
    v\_canonical\_user canonical\_users%ROWTYPE;  
    v\_lookup\_id text;  
    v\_found boolean := false;  
BEGIN  
    \-- Convert the incoming row to JSON to check available fields  
    v\_row\_json := to\_jsonb(NEW);

    \-- Only proceed if we need to fill in missing identity information  
    \-- Check if canonical\_user\_id is NULL and we have something to look up  
    IF (v\_row\_json ? 'canonical\_user\_id' AND (v\_row\_json-\>\>'canonical\_user\_id') IS NULL) OR  
       (v\_row\_json ? 'wallet\_address' AND (v\_row\_json-\>\>'wallet\_address') IS NULL) THEN

        \-- Try lookup by canonical\_user\_id first (if present and not null)  
        IF v\_row\_json ? 'canonical\_user\_id' AND (v\_row\_json-\>\>'canonical\_user\_id') IS NOT NULL THEN  
            v\_lookup\_id := v\_row\_json-\>\>'canonical\_user\_id';  
            SELECT \* INTO v\_canonical\_user  
            FROM canonical\_users  
            WHERE canonical\_user\_id \= v\_lookup\_id  
            LIMIT 1;  
            v\_found := FOUND;  
        END IF;

        \-- Try lookup by privy\_user\_id if not found and field exists  
        IF NOT v\_found AND v\_row\_json ? 'privy\_user\_id' AND (v\_row\_json-\>\>'privy\_user\_id') IS NOT NULL THEN  
            v\_lookup\_id := v\_row\_json-\>\>'privy\_user\_id';  
            SELECT \* INTO v\_canonical\_user  
            FROM canonical\_users  
            WHERE privy\_user\_id \= v\_lookup\_id  
            LIMIT 1;  
            v\_found := FOUND;  
        END IF;

        \-- Try lookup by user\_id if not found and field exists (might be a wallet or canonical ID)  
        IF NOT v\_found AND v\_row\_json ? 'user\_id' AND (v\_row\_json-\>\>'user\_id') IS NOT NULL THEN  
            v\_lookup\_id := v\_row\_json-\>\>'user\_id';  
            \-- Try as canonical\_user\_id first  
            SELECT \* INTO v\_canonical\_user  
            FROM canonical\_users  
            WHERE canonical\_user\_id \= v\_lookup\_id  
            LIMIT 1;  
            v\_found := FOUND;

            \-- Try as wallet\_address (case insensitive)  
            IF NOT v\_found AND v\_lookup\_id LIKE '0x%' THEN  
                SELECT \* INTO v\_canonical\_user  
                FROM canonical\_users  
                WHERE LOWER(wallet\_address) \= LOWER(v\_lookup\_id)  
                   OR LOWER(base\_wallet\_address) \= LOWER(v\_lookup\_id)  
                LIMIT 1;  
                v\_found := FOUND;  
            END IF;

            \-- Try as privy\_user\_id  
            IF NOT v\_found THEN  
                SELECT \* INTO v\_canonical\_user  
                FROM canonical\_users  
                WHERE privy\_user\_id \= v\_lookup\_id  
                LIMIT 1;  
                v\_found := FOUND;  
            END IF;

            \-- Try as uid  
            IF NOT v\_found THEN  
                SELECT \* INTO v\_canonical\_user  
                FROM canonical\_users  
                WHERE uid::text \= v\_lookup\_id  
                LIMIT 1;  
                v\_found := FOUND;  
            END IF;  
        END IF;

        \-- Try lookup by wallet\_address if not found and field exists  
        IF NOT v\_found AND v\_row\_json ? 'wallet\_address' AND (v\_row\_json-\>\>'wallet\_address') IS NOT NULL THEN  
            v\_lookup\_id := v\_row\_json-\>\>'wallet\_address';  
            SELECT \* INTO v\_canonical\_user  
            FROM canonical\_users  
            WHERE LOWER(wallet\_address) \= LOWER(v\_lookup\_id)  
               OR LOWER(base\_wallet\_address) \= LOWER(v\_lookup\_id)  
            LIMIT 1;  
            v\_found := FOUND;  
        END IF;

        \-- Try lookup by uid if not found and field exists  
        IF NOT v\_found AND v\_row\_json ? 'uid' AND (v\_row\_json-\>\>'uid') IS NOT NULL THEN  
            v\_lookup\_id := v\_row\_json-\>\>'uid';  
            SELECT \* INTO v\_canonical\_user  
            FROM canonical\_users  
            WHERE uid::text \= v\_lookup\_id  
            LIMIT 1;  
            v\_found := FOUND;  
        END IF;

        \-- If we found a matching canonical user, enrich the row  
        IF v\_found THEN  
            \-- Fill canonical\_user\_id if column exists and is NULL  
            IF v\_row\_json ? 'canonical\_user\_id' AND (v\_row\_json-\>\>'canonical\_user\_id') IS NULL THEN  
                IF v\_canonical\_user.canonical\_user\_id IS NOT NULL THEN  
                    NEW.canonical\_user\_id := v\_canonical\_user.canonical\_user\_id;  
                END IF;  
            END IF;

            \-- Fill wallet\_address if column exists and is NULL  
            IF v\_row\_json ? 'wallet\_address' AND (v\_row\_json-\>\>'wallet\_address') IS NULL THEN  
                IF v\_canonical\_user.wallet\_address IS NOT NULL THEN  
                    NEW.wallet\_address := v\_canonical\_user.wallet\_address;  
                ELSIF v\_canonical\_user.base\_wallet\_address IS NOT NULL THEN  
                    NEW.wallet\_address := v\_canonical\_user.base\_wallet\_address;  
                END IF;  
            END IF;  
        END IF;  
    END IF;

    RETURN NEW;  
END;  
$function$  
"  
public,tickets\_finalize\_spend\_trigger,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.tickets\_finalize\_spend\_trigger()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_finalized boolean;  
  v\_amount numeric;  
  v\_cuid text;  
  v\_provider text;  
BEGIN  
  \-- Only act after insert or update to a finalized state  
  v\_finalized := (NEW.status IN ('sold','purchased')) AND NEW.payment\_amount IS NOT NULL;  
  IF NOT v\_finalized THEN  
    RETURN NEW;  
  END IF;

  v\_amount := NEW.payment\_amount;  
  v\_cuid := public.\_ticket\_cuid(NEW.user\_id, NEW.canonical\_user\_id, NEW.wallet\_address);  
  v\_provider := NEW.payment\_provider; \-- may be null; acceptable

  \-- Ensure we only process once per ticket id  
  \-- Type-safe comparison: match by canonical\_user\_id when present, otherwise compare user\_id::text  
  PERFORM 1 FROM public.user\_transactions ut  
  WHERE ut.type \= 'entry'  
    AND ut.status \= 'completed'  
    AND ut.amount \= v\_amount  
    AND (ut.order\_id \= NEW.order\_id OR (NEW.order\_id IS NULL AND ut.order\_id IS NULL))  
    AND (ut.description \= NEW.id::text OR ut.description IS NULL)  
    AND (  
      (ut.canonical\_user\_id IS NOT NULL AND ut.canonical\_user\_id \= v\_cuid)  
      OR (ut.canonical\_user\_id IS NULL AND ut.user\_id IS NOT NULL AND ut.user\_id::text \= v\_cuid)  
    );  
  IF FOUND THEN  
    RETURN NEW;  
  END IF;

  \-- Insert transaction (v\_cuid is canonical text id)  
  PERFORM public.\_insert\_user\_spend\_tx(v\_cuid, v\_amount, NEW.competition\_id, NEW.order\_id, NEW.id, v\_provider, NEW.wallet\_address);

  \-- Deduct from balance using canonical id text  
  PERFORM public.\_deduct\_sub\_account\_balance(v\_cuid, v\_amount);

  RETURN NEW;  
END;  
$function$  
"  
public,tickets\_sync\_wallet,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.tickets\_sync\_wallet()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.canonical\_user\_id IS NOT NULL AND (NEW.wallet\_address IS NULL OR NEW.wallet\_address \= '') THEN  
    NEW.wallet\_address := replace(NEW.canonical\_user\_id, 'prize:pid:', '');  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,tickets\_tx\_id\_fill,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.tickets\_tx\_id\_fill()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.tx\_id IS NULL OR NEW.tx\_id \= '' THEN  
    NEW.tx\_id := public.gen\_ticket\_tx\_id(  
      NEW.id::uuid,  
      NEW.competition\_id::uuid,  
      NEW.ticket\_number::bigint,  
      COALESCE(NEW.canonical\_user\_id, '')::text,  
      COALESCE(NEW.wallet\_address, '')::text,  
      COALESCE(NEW.payment\_provider, '')::text,  
      COALESCE(NEW.payment\_amount, 0)::numeric,  
      COALESCE(NEW.payment\_tx\_hash, '')::text,  
      COALESCE(NEW.created\_at, now())::timestamptz  
    );  
  END IF;  
  RETURN NEW;  
END;$function$  
"  
public,to\_canonical\_filter,p\_identifier text,p\_identifier text,record,sql,false,s,false,true,null,"CREATE OR REPLACE FUNCTION public.to\_canonical\_filter(p\_identifier text)  
 RETURNS TABLE(canonical\_user\_id text, privy\_user\_id text, wallet\_address text, user\_id uuid)  
 LANGUAGE sql  
 STABLE  
AS $function$  
  SELECT cu.canonical\_user\_id,  
         cu.privy\_user\_id,  
         COALESCE(cu.wallet\_address, cu.base\_wallet\_address, cu.eth\_wallet\_address) AS wallet\_address,  
         NULL::uuid as user\_id  
  FROM public.canonical\_users cu  
  WHERE p\_identifier IS NOT NULL AND (  
    cu.canonical\_user\_id \= p\_identifier OR  
    lower(cu.wallet\_address) \= lower(p\_identifier) OR  
    lower(cu.base\_wallet\_address) \= lower(p\_identifier) OR  
    lower(cu.eth\_wallet\_address) \= lower(p\_identifier) OR  
    cu.privy\_user\_id \= p\_identifier OR  
    cu.email \= p\_identifier  
  )  
  UNION ALL  
  SELECT NULL, NULL, NULL, u.id  
  FROM public.users u  
  WHERE p\_identifier \= u.user\_id  
$function$  
"  
public,to\_canonical\_user\_id,p\_input text,p\_input text,text,plpgsql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.to\_canonical\_user\_id(p\_input text)  
 RETURNS text  
 LANGUAGE plpgsql  
 IMMUTABLE  
AS $function$  
BEGIN  
  IF p\_input IS NULL OR p\_input \= '' THEN  
    RETURN NULL;  
  END IF;  
    
  \-- Already canonical  
  IF p\_input LIKE 'prize:pid:%' THEN  
    RETURN p\_input;  
  END IF;  
    
  \-- Privy DID  
  IF p\_input LIKE 'did:privy:%' THEN  
    RETURN 'prize:pid:' || substring(p\_input from 11);  
  END IF;  
    
  \-- Wallet address  
  IF p\_input LIKE '0x%' THEN  
    RETURN 'prize:pid:' || lower(p\_input);  
  END IF;  
    
  \-- Default  
  RETURN 'prize:pid:' || p\_input;  
END;  
$function$  
"  
public,trg\_fn\_confirm\_pending\_tickets,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.trg\_fn\_confirm\_pending\_tickets()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  tnum int;  
BEGIN  
  IF (TG\_OP \= 'UPDATE') AND (OLD.confirmed\_at IS NULL) AND (NEW.confirmed\_at IS NOT NULL) THEN  
    FOREACH tnum IN ARRAY COALESCE(NEW.ticket\_numbers, ARRAY\[\]::int\[\]) LOOP  
      INSERT INTO public.tickets (  
        competition\_id, ticket\_number, status, purchased\_at, order\_id,  
        canonical\_user\_id, wallet\_address  
      ) VALUES (  
        NEW.competition\_id, tnum, 'sold', NEW.confirmed\_at, NULL,  
        NEW.canonical\_user\_id,  
        COALESCE(NEW.wallet\_address,  
                 (SELECT cu.wallet\_address FROM public.canonical\_users cu  
                  WHERE cu.canonical\_user\_id \= NEW.canonical\_user\_id))  
      )  
      ON CONFLICT (competition\_id, ticket\_number) DO UPDATE  
      SET status \= 'sold',  
          purchased\_at \= EXCLUDED.purchased\_at,  
          canonical\_user\_id \= EXCLUDED.canonical\_user\_id,  
          wallet\_address \= EXCLUDED.wallet\_address;  
    END LOOP;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,trg\_sync\_joincompetition\_from\_pending,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.trg\_sync\_joincompetition\_from\_pending()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.transaction\_hash IS NULL THEN  
    RETURN NEW;  
  END IF;

  \-- Recompute aggregates for this tx  
  PERFORM public.upsert\_joincompetition\_by\_tx(NEW.transaction\_hash);  
  RETURN NEW;  
END;  
$function$  
"  
public,trg\_sync\_joincompetition\_from\_tickets,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.trg\_sync\_joincompetition\_from\_tickets()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_old\_tx text;  
  v\_new\_tx text;  
BEGIN  
  IF TG\_OP \= 'INSERT' THEN  
    v\_new\_tx := NEW.payment\_tx\_hash;  
    IF v\_new\_tx IS NOT NULL THEN  
      PERFORM public.upsert\_joincompetition\_by\_tx(v\_new\_tx);  
    END IF;  
    RETURN NEW;  
  ELSIF TG\_OP \= 'UPDATE' THEN  
    v\_old\_tx := OLD.payment\_tx\_hash;  
    v\_new\_tx := NEW.payment\_tx\_hash;  
    IF v\_old\_tx IS NOT DISTINCT FROM v\_new\_tx THEN  
      IF v\_new\_tx IS NOT NULL THEN  
        PERFORM public.upsert\_joincompetition\_by\_tx(v\_new\_tx);  
      END IF;  
    ELSE  
      IF v\_old\_tx IS NOT NULL THEN  
        PERFORM public.upsert\_joincompetition\_by\_tx(v\_old\_tx);  
      END IF;  
      IF v\_new\_tx IS NOT NULL THEN  
        PERFORM public.upsert\_joincompetition\_by\_tx(v\_new\_tx);  
      END IF;  
    END IF;  
    RETURN NEW;  
  ELSIF TG\_OP \= 'DELETE' THEN  
    v\_old\_tx := OLD.payment\_tx\_hash;  
    IF v\_old\_tx IS NOT NULL THEN  
      DELETE FROM public.joincompetition jc  
      WHERE jc.transactionhash IS NOT DISTINCT FROM v\_old\_tx  
        AND jc.competitionid::text \= OLD.competition\_id::text  
        AND NOT EXISTS (  
          SELECT 1 FROM public.tickets t  
          WHERE t.payment\_tx\_hash IS NOT DISTINCT FROM v\_old\_tx  
            AND t.competition\_id \= OLD.competition\_id  
        );  
    END IF;  
    RETURN OLD;  
  END IF;  
  RETURN NULL;  
END;  
$function$  
"  
public,trigger\_check\_competition\_sold\_out,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.trigger\_check\_competition\_sold\_out()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
BEGIN  
  IF TG\_OP \= 'INSERT' AND NEW.competition\_id IS NOT NULL THEN  
    PERFORM check\_and\_mark\_competition\_sold\_out(NEW.competition\_id);  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,unlink\_external\_wallet,p\_canonical\_user\_id text,p\_canonical\_user\_id text,jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.unlink\_external\_wallet(p\_canonical\_user\_id text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
BEGIN  
  IF p\_canonical\_user\_id IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'Missing user ID');  
  END IF;

  UPDATE canonical\_users  
  SET eth\_wallet\_address \= NULL, updated\_at \= NOW()  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id OR uid \= p\_canonical\_user\_id;

  IF NOT FOUND THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'User not found');  
  END IF;

  RETURN jsonb\_build\_object('success', true);  
END;  
$function$  
"  
public,unlink\_wallet,"user\_identifier text, p\_wallet\_address text","user\_identifier text, p\_wallet\_address text",json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.unlink\_wallet(user\_identifier text, p\_wallet\_address text)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user RECORD;  
  v\_normalized\_address TEXT;  
  v\_existing\_wallets JSONB;  
  v\_updated\_wallets JSONB;  
  v\_is\_primary BOOLEAN;  
  v\_wallet\_count INT;  
BEGIN  
  \-- Normalize wallet address  
  v\_normalized\_address := LOWER(p\_wallet\_address);

  \-- Find user  
  SELECT \* INTO v\_user  
  FROM canonical\_users cu  
  WHERE cu.canonical\_user\_id \= user\_identifier  
     OR LOWER(cu.wallet\_address) \= LOWER(user\_identifier)  
     OR LOWER(cu.base\_wallet\_address) \= LOWER(user\_identifier)  
     OR cu.privy\_user\_id \= user\_identifier  
     OR cu.email ILIKE user\_identifier  
     OR cu.uid::TEXT \= user\_identifier  
  LIMIT 1;

  IF v\_user IS NULL THEN  
    RETURN json\_build\_object('success', false, 'error', 'User not found');  
  END IF;

  v\_existing\_wallets := COALESCE(v\_user.linked\_wallets, '\[\]'::JSONB);  
  v\_wallet\_count := jsonb\_array\_length(v\_existing\_wallets);

  \-- Check if this is the primary wallet  
  SELECT (w-\>\>'is\_primary')::BOOLEAN INTO v\_is\_primary  
  FROM jsonb\_array\_elements(v\_existing\_wallets) AS w  
  WHERE LOWER(w-\>\>'address') \= v\_normalized\_address;

  \-- Don't allow unlinking the primary wallet if it's the only one  
  IF v\_is\_primary AND v\_wallet\_count \<= 1 THEN  
    RETURN json\_build\_object('success', false, 'error', 'Cannot unlink the only primary wallet. Link another wallet first.');  
  END IF;

  \-- Remove the wallet from the array  
  SELECT jsonb\_agg(w)  
  INTO v\_updated\_wallets  
  FROM jsonb\_array\_elements(v\_existing\_wallets) AS w  
  WHERE LOWER(w-\>\>'address') \!= v\_normalized\_address;

  \-- If we removed the primary wallet, set a new one  
  IF v\_is\_primary AND v\_updated\_wallets IS NOT NULL AND jsonb\_array\_length(v\_updated\_wallets) \> 0 THEN  
    \-- Set the first remaining wallet as primary  
    SELECT jsonb\_agg(  
      CASE  
        WHEN rn \= 1 THEN w || '{""is\_primary"": true}'::JSONB  
        ELSE w  
      END  
    )  
    INTO v\_updated\_wallets  
    FROM (  
      SELECT w, ROW\_NUMBER() OVER () AS rn  
      FROM jsonb\_array\_elements(v\_updated\_wallets) AS w  
    ) sub;

    \-- Update primary\_wallet\_address to the new primary  
    UPDATE canonical\_users  
    SET  
      linked\_wallets \= COALESCE(v\_updated\_wallets, '\[\]'::JSONB),  
      primary\_wallet\_address \= (v\_updated\_wallets-\>0-\>\>'address'),  
      wallet\_address \= (v\_updated\_wallets-\>0-\>\>'address'),  
      canonical\_user\_id \= 'prize:pid:' || (v\_updated\_wallets-\>0-\>\>'address'),  
      \-- Clear linked\_external\_wallet if that's what we're unlinking  
      linked\_external\_wallet \= CASE  
        WHEN LOWER(v\_user.linked\_external\_wallet) \= v\_normalized\_address THEN NULL  
        ELSE v\_user.linked\_external\_wallet  
      END,  
      updated\_at \= NOW()  
    WHERE uid \= v\_user.uid;  
  ELSE  
    \-- Just remove the wallet without changing primary  
    UPDATE canonical\_users  
    SET  
      linked\_wallets \= COALESCE(v\_updated\_wallets, '\[\]'::JSONB),  
      \-- Clear linked\_external\_wallet if that's what we're unlinking  
      linked\_external\_wallet \= CASE  
        WHEN LOWER(v\_user.linked\_external\_wallet) \= v\_normalized\_address THEN NULL  
        ELSE v\_user.linked\_external\_wallet  
      END,  
      updated\_at \= NOW()  
    WHERE uid \= v\_user.uid;  
  END IF;

  RETURN json\_build\_object(  
    'success', true,  
    'message', 'Wallet unlinked successfully'  
  );  
END;  
$function$  
"  
public,update\_avatar\_flex,payload jsonb,payload jsonb,jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_avatar\_flex(payload jsonb)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_avatar\_url text := COALESCE(  
    payload-\>\>'avatar\_url',  
    payload-\>\>'new\_avatar\_url',  
    payload-\>\>'p\_avatar\_url'  
  );  
  v\_identifier text := COALESCE(  
    payload-\>\>'identifier',  
    payload-\>\>'user\_identifier',  
    payload-\>\>'canonical\_user\_id',  
    payload-\>\>'p\_identifier',  
    payload-\>\>'p\_canonical\_user\_id',  
    payload-\>\>'email'  
  );  
BEGIN  
  IF v\_avatar\_url IS NULL OR v\_identifier IS NULL THEN  
    RAISE EXCEPTION 'missing\_fields' USING MESSAGE \= 'avatar\_url and identifier are required';  
  END IF;  
  RETURN public.update\_user\_avatar(v\_avatar\_url, v\_identifier);  
END; $function$  
"  
public,update\_competition\_onchain\_data,"p\_competition\_id uuid, p\_onchain\_competition\_id bigint, p\_vrf\_tx\_hash text, p\_vrf\_error text, p\_vrf\_error\_at timestamp with time zone, p\_updated\_at timestamp with time zone","p\_competition\_id uuid, p\_onchain\_competition\_id bigint DEFAULT NULL::bigint, p\_vrf\_tx\_hash text DEFAULT NULL::text, p\_vrf\_error text DEFAULT NULL::text, p\_vrf\_error\_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p\_updated\_at timestamp with time zone DEFAULT now()",bool,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_competition\_onchain\_data(p\_competition\_id uuid, p\_onchain\_competition\_id bigint DEFAULT NULL::bigint, p\_vrf\_tx\_hash text DEFAULT NULL::text, p\_vrf\_error text DEFAULT NULL::text, p\_vrf\_error\_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p\_updated\_at timestamp with time zone DEFAULT now())  
 RETURNS boolean  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
    rows\_updated INTEGER;  
BEGIN  
    UPDATE competitions   
    SET   
        onchain\_competition\_id \= p\_onchain\_competition\_id,  
        vrf\_tx\_hash \= p\_vrf\_tx\_hash,  
        vrf\_error \= p\_vrf\_error,  
        vrf\_error\_at \= p\_vrf\_error\_at,  
        updated\_at \= p\_updated\_at  
    WHERE id \= p\_competition\_id;  
      
    GET DIAGNOSTICS rows\_updated \= ROW\_COUNT;  
    RETURN rows\_updated \> 0;  
END;  
$function$  
"  
public,update\_competition\_status,"p\_competition\_id uuid, p\_status text, p\_updated\_at timestamp with time zone","p\_competition\_id uuid, p\_status text, p\_updated\_at timestamp with time zone DEFAULT now()",bool,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_competition\_status(p\_competition\_id uuid, p\_status text, p\_updated\_at timestamp with time zone DEFAULT now())  
 RETURNS boolean  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
    rows\_updated INTEGER;  
BEGIN  
    UPDATE competitions   
    SET   
        status \= p\_status,  
        updated\_at \= p\_updated\_at  
    WHERE id \= p\_competition\_id;  
      
    GET DIAGNOSTICS rows\_updated \= ROW\_COUNT;  
    RETURN rows\_updated \> 0;  
END;  
$function$  
"  
public,update\_custody\_balance,"p\_user\_id text, p\_amount numeric, p\_transaction\_type text, p\_reference\_id text","p\_user\_id text, p\_amount numeric, p\_transaction\_type text, p\_reference\_id text DEFAULT NULL::text",record,plpgsql,true,s,false,true,null,"CREATE OR REPLACE FUNCTION public.update\_custody\_balance(p\_user\_id text, p\_amount numeric, p\_transaction\_type text, p\_reference\_id text DEFAULT NULL::text)  
 RETURNS TABLE(success boolean, user\_id text, balance\_before numeric, balance\_after numeric)  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE v\_user\_uuid UUID; v\_before NUMERIC; v\_after NUMERIC; BEGIN  
  SELECT id INTO v\_user\_uuid FROM canonical\_users WHERE uid=p\_user\_id OR wallet\_address=p\_user\_id OR base\_wallet\_address=p\_user\_id LIMIT 1;  
  IF v\_user\_uuid IS NULL THEN RETURN QUERY SELECT false, p\_user\_id, 0::NUMERIC, 0::NUMERIC; RETURN; END IF;  
  SELECT COALESCE(usdc\_balance,0) INTO v\_before FROM canonical\_users WHERE id=v\_user\_uuid;  
  UPDATE canonical\_users SET usdc\_balance \= v\_before \+ p\_amount, updated\_at=NOW() WHERE id=v\_user\_uuid;  
  v\_after := v\_before \+ p\_amount;  
  INSERT INTO custody\_wallet\_balances (user\_id, transaction\_type, change\_amount, balance\_before, balance\_after, reference\_id)  
  VALUES (v\_user\_uuid, p\_transaction\_type, p\_amount, v\_before, v\_after, p\_reference\_id);  
  RETURN QUERY SELECT true, v\_user\_uuid::TEXT, v\_before, v\_after; END; $function$  
"  
public,update\_instant\_win\_grids\_updated\_at,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_instant\_win\_grids\_updated\_at()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
    NEW.updated\_at \= now();  
    RETURN NEW;  
END;  
$function$  
"  
public,update\_joincompetition\_updated\_at,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_joincompetition\_updated\_at()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
    NEW.updated\_at \= now();  
    RETURN NEW;  
END;  
$function$  
"  
public,update\_profile\_flex,payload jsonb,payload jsonb,jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_profile\_flex(payload jsonb)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_identifier text := COALESCE(  
    payload-\>\>'identifier', payload-\>\>'user\_identifier', payload-\>\>'canonical\_user\_id',  
    payload-\>\>'p\_identifier', payload-\>\>'p\_canonical\_user\_id', payload-\>\>'email'  
  );  
  v\_username text := COALESCE(payload-\>\>'username', payload-\>\>'p\_username');  
  v\_email text := COALESCE(payload-\>\>'email', payload-\>\>'p\_email');  
  v\_phone text := COALESCE(payload-\>\>'phone', payload-\>\>'telephone', payload-\>\>'telephone\_number', payload-\>\>'p\_phone');  
  v\_country text := COALESCE(payload-\>\>'country', payload-\>\>'p\_country');  
  v\_telegram text := payload-\>\>'telegram\_handle';  
  v\_telnum text := COALESCE(payload-\>\>'telephone\_number', payload-\>\>'p\_telephone\_number');  
BEGIN  
  IF v\_identifier IS NULL THEN  
    RAISE EXCEPTION 'missing\_identifier' USING MESSAGE \= 'identifier (canonical\_user\_id or email) is required';  
  END IF;  
  RETURN public.update\_user\_profile\_by\_identifier(v\_identifier, v\_username, v\_email, v\_phone, v\_country, v\_telegram, v\_telnum);  
END; $function$  
"  
public,update\_updated\_at\_column,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_updated\_at\_column()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN NEW.updated\_at \= NOW(); RETURN NEW; END;  
$function$  
"  
public,update\_user\_avatar\_by\_uid,"p\_canonical\_user\_id text, p\_new\_avatar\_url text","p\_canonical\_user\_id text, p\_new\_avatar\_url text",void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_user\_avatar\_by\_uid(p\_canonical\_user\_id text, p\_new\_avatar\_url text)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  UPDATE public.canonical\_users  
  SET avatar\_url \= p\_new\_avatar\_url, updated\_at \= now()  
  WHERE canonical\_user\_id \= p\_canonical\_user\_id;  
END;  
$function$  
"  
public,update\_user\_avatar\_by\_uid,"p\_uid uuid, p\_avatar\_url text","p\_uid uuid, p\_avatar\_url text",void,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_user\_avatar\_by\_uid(p\_uid uuid, p\_avatar\_url text)  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
begin  
  update public.canonical\_users  
     set avatar\_url \= p\_avatar\_url,  
         updated\_at \= now()  
   where uid \= p\_uid;  
end;  
$function$  
"  
public,update\_user\_profile\_by\_identifier,"p\_identifier text, p\_username text, p\_email text, p\_phone text, p\_country text","p\_identifier text, p\_username text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_phone text DEFAULT NULL::text, p\_country text DEFAULT NULL::text",jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_user\_profile\_by\_identifier(p\_identifier text, p\_username text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_phone text DEFAULT NULL::text, p\_country text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_profile\_id uuid;  
BEGIN  
  \-- Resolve profile by canonical\_user\_id first, then by email  
  SELECT p.id  
  INTO v\_profile\_id  
  FROM public.profiles p  
  WHERE p.canonical\_user\_id \= p\_identifier  
     OR (p.email IS NOT NULL AND lower(p.email) \= lower(p\_identifier))  
  ORDER BY CASE WHEN p.canonical\_user\_id \= p\_identifier THEN 0 ELSE 1 END  
  LIMIT 1;

  IF v\_profile\_id IS NULL THEN  
    RAISE EXCEPTION 'profile\_not\_found' USING ERRCODE \= 'P0002';  
  END IF;

  \-- Update with provided non-null values only  
  UPDATE public.profiles p  
  SET  
    username \= COALESCE(p\_username, p.username),  
    email \= COALESCE(p\_email, p.email),  
    phone \= COALESCE(p\_phone, p.phone),  
    country \= COALESCE(p\_country, p.country),  
    updated\_at \= now()  
  WHERE p.id \= v\_profile\_id;

  \-- Return the updated row as jsonb  
  RETURN (  
    SELECT to\_jsonb(p)  
    FROM public.profiles p  
    WHERE p.id \= v\_profile\_id  
  );  
END;  
$function$  
"  
public,update\_user\_profile\_by\_identifier,"p\_identifier text, p\_username text, p\_email text, p\_phone text, p\_country text, p\_telegram\_handle text, p\_telephone\_number text","p\_identifier text, p\_username text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_phone text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_telephone\_number text DEFAULT NULL::text",jsonb,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_user\_profile\_by\_identifier(p\_identifier text, p\_username text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_phone text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_telephone\_number text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_profile\_id uuid;  
BEGIN  
  \-- Resolve profile by canonical\_user\_id first, then by email  
  SELECT p.id  
  INTO v\_profile\_id  
  FROM public.profiles p  
  WHERE p.canonical\_user\_id \= p\_identifier  
     OR (p.email IS NOT NULL AND lower(p.email) \= lower(p\_identifier))  
  ORDER BY CASE WHEN p.canonical\_user\_id \= p\_identifier THEN 0 ELSE 1 END  
  LIMIT 1;

  IF v\_profile\_id IS NULL THEN  
    RAISE EXCEPTION 'profile\_not\_found' USING ERRCODE \= 'P0002';  
  END IF;

  \-- Update only provided values (null means keep existing)  
  UPDATE public.profiles p  
  SET  
    username \= COALESCE(p\_username, p.username),  
    email \= COALESCE(p\_email, p.email),  
    phone \= COALESCE(p\_phone, p.phone),  
    country \= COALESCE(p\_country, p.country),  
    telegram\_handle \= COALESCE(p\_telegram\_handle, p.telegram\_handle),  
    telephone\_number \= COALESCE(p\_telephone\_number, p.telephone\_number),  
    updated\_at \= now()  
  WHERE p.id \= v\_profile\_id;

  RETURN (  
    SELECT to\_jsonb(p)  
    FROM public.profiles p  
    WHERE p.id \= v\_profile\_id  
  );  
END;  
$function$  
"  
public,update\_user\_profile\_by\_identifier,"user\_identifier text, new\_username text, new\_email text, new\_telegram\_handle text, new\_country text, new\_telephone\_number text","user\_identifier text, new\_username text DEFAULT NULL::text, new\_email text DEFAULT NULL::text, new\_telegram\_handle text DEFAULT NULL::text, new\_country text DEFAULT NULL::text, new\_telephone\_number text DEFAULT NULL::text",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_user\_profile\_by\_identifier(user\_identifier text, new\_username text DEFAULT NULL::text, new\_email text DEFAULT NULL::text, new\_telegram\_handle text DEFAULT NULL::text, new\_country text DEFAULT NULL::text, new\_telephone\_number text DEFAULT NULL::text)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  user\_uid\_found TEXT;  
  normalized\_user\_id text;  
  search\_wallet text;  
  has\_country\_column boolean := false;  
  has\_telephone\_column boolean := false;  
  rows\_updated integer := 0;  
BEGIN  
  \-- Validate user\_identifier is provided  
  IF user\_identifier IS NULL OR TRIM(user\_identifier) \= '' THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'User identifier is required');  
  END IF;

  \-- Normalize for comparison (lowercase for wallet addresses)  
  normalized\_user\_id := LOWER(TRIM(user\_identifier));

  \-- Extract wallet address from prize:pid: format if present  
  IF user\_identifier LIKE 'prize:pid:0x%' THEN  
    search\_wallet := LOWER(SUBSTRING(user\_identifier FROM 11));  
  ELSIF user\_identifier LIKE '0x%' AND LENGTH(user\_identifier) \= 42 THEN  
    search\_wallet := LOWER(user\_identifier);  
  ELSE  
    search\_wallet := NULL;  
  END IF;

  \-- Find user by various identifier columns including canonical\_user\_id  
  SELECT uid INTO user\_uid\_found  
  FROM canonical\_users  
  WHERE  
    canonical\_user\_id \= user\_identifier  
    OR canonical\_user\_id \= LOWER(user\_identifier)  
    OR (search\_wallet IS NOT NULL AND LOWER(wallet\_address) \= search\_wallet)  
    OR (search\_wallet IS NOT NULL AND LOWER(base\_wallet\_address) \= search\_wallet)  
    OR LOWER(COALESCE(wallet\_address, '')) \= normalized\_user\_id  
    OR LOWER(COALESCE(base\_wallet\_address, '')) \= normalized\_user\_id  
    OR privy\_user\_id \= user\_identifier  
    OR uid \= user\_identifier  
  LIMIT 1;

  IF user\_uid\_found IS NULL THEN  
    RETURN jsonb\_build\_object('success', false, 'error', 'User not found for identifier: ' || LEFT(user\_identifier, 20\) || '...');  
  END IF;

  \-- Check if optional columns exist  
  SELECT EXISTS (  
    SELECT 1 FROM information\_schema.columns  
    WHERE table\_schema \= 'public'  
    AND table\_name \= 'canonical\_users'  
    AND column\_name \= 'country'  
  ) INTO has\_country\_column;

  SELECT EXISTS (  
    SELECT 1 FROM information\_schema.columns  
    WHERE table\_schema \= 'public'  
    AND table\_name \= 'canonical\_users'  
    AND column\_name \= 'telephone\_number'  
  ) INTO has\_telephone\_column;

  \-- Perform a direct UPDATE with only the profile fields  
  IF has\_country\_column AND has\_telephone\_column THEN  
    UPDATE canonical\_users  
    SET  
      username \= COALESCE(NULLIF(TRIM(new\_username), ''), username),  
      email \= COALESCE(NULLIF(TRIM(new\_email), ''), email),  
      telegram\_handle \= CASE  
        WHEN new\_telegram\_handle IS NOT NULL THEN TRIM(new\_telegram\_handle)  
        ELSE telegram\_handle  
      END,  
      country \= COALESCE(NULLIF(TRIM(new\_country), ''), country),  
      telephone\_number \= CASE  
        WHEN new\_telephone\_number IS NOT NULL THEN TRIM(new\_telephone\_number)  
        ELSE telephone\_number  
      END,  
      updated\_at \= NOW()  
    WHERE uid \= user\_uid\_found;  
  ELSIF has\_country\_column THEN  
    UPDATE canonical\_users  
    SET  
      username \= COALESCE(NULLIF(TRIM(new\_username), ''), username),  
      email \= COALESCE(NULLIF(TRIM(new\_email), ''), email),  
      telegram\_handle \= CASE  
        WHEN new\_telegram\_handle IS NOT NULL THEN TRIM(new\_telegram\_handle)  
        ELSE telegram\_handle  
      END,  
      country \= COALESCE(NULLIF(TRIM(new\_country), ''), country),  
      updated\_at \= NOW()  
    WHERE uid \= user\_uid\_found;  
  ELSE  
    UPDATE canonical\_users  
    SET  
      username \= COALESCE(NULLIF(TRIM(new\_username), ''), username),  
      email \= COALESCE(NULLIF(TRIM(new\_email), ''), email),  
      telegram\_handle \= CASE  
        WHEN new\_telegram\_handle IS NOT NULL THEN TRIM(new\_telegram\_handle)  
        ELSE telegram\_handle  
      END,  
      updated\_at \= NOW()  
    WHERE uid \= user\_uid\_found;  
  END IF;

  GET DIAGNOSTICS rows\_updated \= ROW\_COUNT;

  IF rows\_updated \> 0 THEN  
    RETURN jsonb\_build\_object(  
      'success', true,  
      'message', 'Profile updated successfully',  
      'user\_id', user\_uid\_found  
    );  
  ELSE  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'No rows updated \- user may have been deleted'  
    );  
  END IF;

EXCEPTION  
  WHEN OTHERS THEN  
    RETURN jsonb\_build\_object(  
      'success', false,  
      'error', 'Database error: ' || SQLERRM,  
      'detail', SQLSTATE  
    );  
END;  
$function$  
"  
public,update\_wallet\_nickname,"user\_identifier text, p\_wallet\_address text, p\_nickname text","user\_identifier text, p\_wallet\_address text, p\_nickname text",json,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_wallet\_nickname(user\_identifier text, p\_wallet\_address text, p\_nickname text)  
 RETURNS json  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user RECORD;  
  v\_normalized\_address TEXT;  
  v\_existing\_wallets JSONB;  
  v\_updated\_wallets JSONB;  
BEGIN  
  v\_normalized\_address := LOWER(p\_wallet\_address);

  \-- Find user  
  SELECT \* INTO v\_user  
  FROM canonical\_users cu  
  WHERE cu.canonical\_user\_id \= user\_identifier  
     OR LOWER(cu.wallet\_address) \= LOWER(user\_identifier)  
     OR cu.privy\_user\_id \= user\_identifier  
     OR cu.email ILIKE user\_identifier  
     OR cu.uid::TEXT \= user\_identifier  
  LIMIT 1;

  IF v\_user IS NULL THEN  
    RETURN json\_build\_object('success', false, 'error', 'User not found');  
  END IF;

  v\_existing\_wallets := COALESCE(v\_user.linked\_wallets, '\[\]'::JSONB);

  \-- Update the nickname for the specified wallet  
  SELECT jsonb\_agg(  
    CASE  
      WHEN LOWER(w-\>\>'address') \= v\_normalized\_address  
      THEN jsonb\_set(w, '{nickname}', to\_jsonb(p\_nickname))  
      ELSE w  
    END  
  )  
  INTO v\_updated\_wallets  
  FROM jsonb\_array\_elements(v\_existing\_wallets) AS w;

  UPDATE canonical\_users  
  SET  
    linked\_wallets \= COALESCE(v\_updated\_wallets, v\_existing\_wallets),  
    updated\_at \= NOW()  
  WHERE uid \= v\_user.uid;

  RETURN json\_build\_object('success', true, 'message', 'Nickname updated successfully');  
END;  
$function$  
"  
public,update\_winner\_payout\_status,"p\_winner\_id uuid, p\_claimed boolean, p\_payout\_status text, p\_payout\_error text, p\_tx\_hash text, p\_payout\_amount text, p\_payout\_token text, p\_payout\_network text, p\_payout\_explorer\_url text, p\_payout\_timestamp text, p\_updated\_at timestamp with time zone","p\_winner\_id uuid, p\_claimed boolean DEFAULT NULL::boolean, p\_payout\_status text DEFAULT NULL::text, p\_payout\_error text DEFAULT NULL::text, p\_tx\_hash text DEFAULT NULL::text, p\_payout\_amount text DEFAULT NULL::text, p\_payout\_token text DEFAULT NULL::text, p\_payout\_network text DEFAULT NULL::text, p\_payout\_explorer\_url text DEFAULT NULL::text, p\_payout\_timestamp text DEFAULT NULL::text, p\_updated\_at timestamp with time zone DEFAULT now()",bool,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.update\_winner\_payout\_status(p\_winner\_id uuid, p\_claimed boolean DEFAULT NULL::boolean, p\_payout\_status text DEFAULT NULL::text, p\_payout\_error text DEFAULT NULL::text, p\_tx\_hash text DEFAULT NULL::text, p\_payout\_amount text DEFAULT NULL::text, p\_payout\_token text DEFAULT NULL::text, p\_payout\_network text DEFAULT NULL::text, p\_payout\_explorer\_url text DEFAULT NULL::text, p\_payout\_timestamp text DEFAULT NULL::text, p\_updated\_at timestamp with time zone DEFAULT now())  
 RETURNS boolean  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
    rows\_updated INTEGER;  
BEGIN  
    UPDATE winners   
    SET   
        claimed \= COALESCE(p\_claimed, claimed),  
        claim\_tx\_hash \= COALESCE(p\_tx\_hash, claim\_tx\_hash),  
        updated\_at \= p\_updated\_at  
    WHERE id \= p\_winner\_id;  
      
    GET DIAGNOSTICS rows\_updated \= ROW\_COUNT;  
    RETURN rows\_updated \> 0;  
END;  
$function$  
"  
public,upsert\_canonical\_user,"p\_uid text, p\_canonical\_user\_id text, p\_email text, p\_username text, p\_wallet\_address text, p\_base\_wallet\_address text, p\_eth\_wallet\_address text, p\_privy\_user\_id text, p\_first\_name text, p\_last\_name text, p\_telegram\_handle text, p\_country text, p\_avatar\_url text, p\_auth\_provider text, p\_wallet\_linked boolean","p\_uid text, p\_canonical\_user\_id text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_username text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text, p\_auth\_provider text DEFAULT NULL::text, p\_wallet\_linked boolean DEFAULT false",jsonb,plpgsql,true,v,false,false,"Upserts canonical user, replacing placeholder canonical\_user\_id with wallet-based ID when wallet connects","CREATE OR REPLACE FUNCTION public.upsert\_canonical\_user(p\_uid text, p\_canonical\_user\_id text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_username text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text, p\_auth\_provider text DEFAULT NULL::text, p\_wallet\_linked boolean DEFAULT false)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
DECLARE  
  v\_user\_id TEXT;  
  v\_existing\_canonical\_id TEXT;  
  v\_final\_canonical\_id TEXT;  
BEGIN  
  \-- Check if user exists and get their current canonical\_user\_id  
  SELECT canonical\_user\_id INTO v\_existing\_canonical\_id  
  FROM canonical\_users  
  WHERE uid \= p\_uid;

  \-- Determine final canonical\_user\_id:  
  \-- 1\. If new canonical\_user\_id provided and it's a wallet-based ID (prize:pid:0x...), use it  
  \-- 2\. If existing ID is a placeholder (prize:pid:temp...) and we have a wallet, replace it  
  \-- 3\. Otherwise keep existing or use provided  
  IF p\_canonical\_user\_id IS NOT NULL AND p\_canonical\_user\_id LIKE 'prize:pid:0x%' THEN  
    \-- Wallet-based ID takes priority (replaces placeholder)  
    v\_final\_canonical\_id := p\_canonical\_user\_id;  
  ELSIF v\_existing\_canonical\_id IS NOT NULL AND v\_existing\_canonical\_id LIKE 'prize:pid:temp%' AND p\_wallet\_address IS NOT NULL THEN  
    \-- Replace placeholder with wallet-based ID  
    v\_final\_canonical\_id := 'prize:pid:' || util.normalize\_evm\_address(p\_wallet\_address);  
  ELSE  
    \-- Keep provided or use existing  
    v\_final\_canonical\_id := COALESCE(p\_canonical\_user\_id, v\_existing\_canonical\_id, p\_uid);  
  END IF;

  \-- Insert or update canonical user  
  INSERT INTO canonical\_users (  
    uid,  
    canonical\_user\_id,  
    email,  
    username,  
    wallet\_address,  
    base\_wallet\_address,  
    eth\_wallet\_address,  
    privy\_user\_id,  
    first\_name,  
    last\_name,  
    telegram\_handle,  
    country,  
    avatar\_url,  
    auth\_provider,  
    wallet\_linked,  
    created\_at,  
    updated\_at  
  )  
  VALUES (  
    p\_uid,  
    v\_final\_canonical\_id,  
    p\_email,  
    p\_username,  
    p\_wallet\_address,  
    p\_base\_wallet\_address,  
    p\_eth\_wallet\_address,  
    p\_privy\_user\_id,  
    p\_first\_name,  
    p\_last\_name,  
    p\_telegram\_handle,  
    p\_country,  
    p\_avatar\_url,  
    p\_auth\_provider,  
    p\_wallet\_linked,  
    NOW(),  
    NOW()  
  )  
  ON CONFLICT (uid) DO UPDATE SET  
    canonical\_user\_id \= v\_final\_canonical\_id,  
    email \= COALESCE(EXCLUDED.email, canonical\_users.email),  
    username \= COALESCE(EXCLUDED.username, canonical\_users.username),  
    wallet\_address \= COALESCE(EXCLUDED.wallet\_address, canonical\_users.wallet\_address),  
    base\_wallet\_address \= COALESCE(EXCLUDED.base\_wallet\_address, canonical\_users.base\_wallet\_address),  
    eth\_wallet\_address \= COALESCE(EXCLUDED.eth\_wallet\_address, canonical\_users.eth\_wallet\_address),  
    privy\_user\_id \= COALESCE(EXCLUDED.privy\_user\_id, canonical\_users.privy\_user\_id),  
    first\_name \= COALESCE(EXCLUDED.first\_name, canonical\_users.first\_name),  
    last\_name \= COALESCE(EXCLUDED.last\_name, canonical\_users.last\_name),  
    telegram\_handle \= COALESCE(EXCLUDED.telegram\_handle, canonical\_users.telegram\_handle),  
    country \= COALESCE(EXCLUDED.country, canonical\_users.country),  
    avatar\_url \= COALESCE(EXCLUDED.avatar\_url, canonical\_users.avatar\_url),  
    auth\_provider \= COALESCE(EXCLUDED.auth\_provider, canonical\_users.auth\_provider),  
    wallet\_linked \= COALESCE(EXCLUDED.wallet\_linked, canonical\_users.wallet\_linked),  
    updated\_at \= NOW()  
  RETURNING id INTO v\_user\_id;

  \-- Return user data  
  RETURN jsonb\_build\_object(  
    'id', v\_user\_id,  
    'canonical\_user\_id', v\_final\_canonical\_id  
  );  
END;  
$function$  
"  
public,upsert\_canonical\_user\_by\_username,"p\_username text, p\_email text, p\_country text, p\_canonical\_user\_id text, p\_wallet\_address text, p\_base\_wallet\_address text, p\_eth\_wallet\_address text, p\_avatar\_url text, p\_first\_name text, p\_last\_name text, p\_telegram\_handle text, p\_privy\_user\_id text, p\_uid uuid","p\_username text, p\_email text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_uid uuid DEFAULT NULL::uuid",canonical\_users,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.upsert\_canonical\_user\_by\_username(p\_username text, p\_email text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_uid uuid DEFAULT NULL::uuid)  
 RETURNS canonical\_users  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_row public.canonical\_users;  
  v\_id uuid;  
BEGIN  
  \-- 1\) Lookup by username first (your source of truth)  
  IF p\_username IS NOT NULL THEN  
    SELECT \* INTO v\_row FROM public.canonical\_users WHERE username \= p\_username;  
  END IF;

  \-- 2\) Fallback by email  
  IF v\_row.id IS NULL AND p\_email IS NOT NULL THEN  
    SELECT \* INTO v\_row FROM public.canonical\_users WHERE email \= p\_email;  
  END IF;

  \-- 3\) Fallback by canonical\_user\_id  
  IF v\_row.id IS NULL AND p\_canonical\_user\_id IS NOT NULL THEN  
    SELECT \* INTO v\_row FROM public.canonical\_users WHERE canonical\_user\_id \= p\_canonical\_user\_id;  
  END IF;

  \-- 4\) Insert if not found  
  IF v\_row.id IS NULL THEN  
    v\_id := COALESCE(p\_uid, gen\_random\_uuid());  
    INSERT INTO public.canonical\_users AS cu (  
      id, username, email, country, canonical\_user\_id,  
      wallet\_address, base\_wallet\_address, eth\_wallet\_address,  
      avatar\_url, first\_name, last\_name, telegram\_handle, privy\_user\_id  
    ) VALUES (  
      v\_id, p\_username, p\_email, p\_country, p\_canonical\_user\_id,  
      p\_wallet\_address, p\_base\_wallet\_address, p\_eth\_wallet\_address,  
      p\_avatar\_url, p\_first\_name, p\_last\_name, p\_telegram\_handle, p\_privy\_user\_id  
    )  
    RETURNING \* INTO v\_row;  
    RETURN v\_row;  
  END IF;

  \-- 5\) Merge non-null fields only  
  UPDATE public.canonical\_users cu  
  SET  
    username            \= COALESCE(p\_username, cu.username),  
    email               \= COALESCE(p\_email, cu.email),  
    country             \= COALESCE(p\_country, cu.country),  
    canonical\_user\_id   \= COALESCE(p\_canonical\_user\_id, cu.canonical\_user\_id),  
    wallet\_address      \= COALESCE(p\_wallet\_address, cu.wallet\_address),  
    base\_wallet\_address \= COALESCE(p\_base\_wallet\_address, cu.base\_wallet\_address),  
    eth\_wallet\_address  \= COALESCE(p\_eth\_wallet\_address, cu.eth\_wallet\_address),  
    avatar\_url          \= COALESCE(p\_avatar\_url, cu.avatar\_url),  
    first\_name          \= COALESCE(p\_first\_name, cu.first\_name),  
    last\_name           \= COALESCE(p\_last\_name, cu.last\_name),  
    telegram\_handle     \= COALESCE(p\_telegram\_handle, cu.telegram\_handle),  
    privy\_user\_id       \= COALESCE(p\_privy\_user\_id, cu.privy\_user\_id),  
    updated\_at          \= NOW()  
  WHERE cu.id \= v\_row.id  
  RETURNING \* INTO v\_row;

  RETURN v\_row;  
END;  
$function$  
"  
public,upsert\_canonical\_user\_with\_wallet,"p\_username text, p\_email text, p\_first\_name text, p\_last\_name text, p\_country text, p\_telegram\_handle text, p\_wallet\_address text, p\_base\_wallet\_address text, p\_eth\_wallet\_address text, p\_avatar\_url text","p\_username text, p\_email text, p\_first\_name text, p\_last\_name text, p\_country text, p\_telegram\_handle text, p\_wallet\_address text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text",uuid,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.upsert\_canonical\_user\_with\_wallet(p\_username text, p\_email text, p\_first\_name text, p\_last\_name text, p\_country text, p\_telegram\_handle text, p\_wallet\_address text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text)  
 RETURNS uuid  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_wallet text := lower(p\_wallet\_address);  
  v\_base\_wallet text := CASE WHEN p\_base\_wallet\_address IS NULL THEN NULL ELSE lower(p\_base\_wallet\_address) END;  
  v\_eth\_wallet text := CASE WHEN p\_eth\_wallet\_address IS NULL THEN NULL ELSE lower(p\_eth\_wallet\_address) END;  
  v\_canonical text := 'prize:pid:' || v\_wallet;  
  v\_id uuid;  
BEGIN  
  SELECT id INTO v\_id  
  FROM public.canonical\_users  
  WHERE canonical\_user\_id \= v\_canonical  
  LIMIT 1;

  IF v\_id IS NULL AND p\_email IS NOT NULL THEN  
    SELECT id INTO v\_id  
    FROM public.canonical\_users  
    WHERE lower(email) \= lower(p\_email)  
    LIMIT 1;  
  END IF;

  IF v\_id IS NULL AND p\_username IS NOT NULL THEN  
    SELECT id INTO v\_id  
    FROM public.canonical\_users  
    WHERE lower(username) \= lower(p\_username)  
    LIMIT 1;  
  END IF;

  IF v\_id IS NULL THEN  
    INSERT INTO public.canonical\_users (  
      canonical\_user\_id, email, username, first\_name, last\_name, country, telegram\_handle,  
      wallet\_address, base\_wallet\_address, eth\_wallet\_address, avatar\_url  
    )  
    VALUES (  
      v\_canonical,  
      NULLIF(p\_email, ''),  
      NULLIF(p\_username, ''),  
      NULLIF(p\_first\_name, ''),  
      NULLIF(p\_last\_name, ''),  
      NULLIF(p\_country, ''),  
      NULLIF(p\_telegram\_handle, ''),  
      v\_wallet,  
      v\_base\_wallet,  
      v\_eth\_wallet,  
      NULLIF(p\_avatar\_url, '')  
    )  
    RETURNING id INTO v\_id;  
  ELSE  
    UPDATE public.canonical\_users cu  
    SET  
      canonical\_user\_id   \= COALESCE(cu.canonical\_user\_id, v\_canonical),  
      email               \= CASE WHEN cu.email IS NULL OR cu.email \= '' THEN NULLIF(p\_email, '') ELSE cu.email END,  
      username            \= CASE WHEN cu.username IS NULL OR cu.username \= '' THEN NULLIF(p\_username, '') ELSE cu.username END,  
      first\_name          \= CASE WHEN cu.first\_name IS NULL OR cu.first\_name \= '' THEN NULLIF(p\_first\_name, '') ELSE cu.first\_name END,  
      last\_name           \= CASE WHEN cu.last\_name IS NULL OR cu.last\_name \= '' THEN NULLIF(p\_last\_name, '') ELSE cu.last\_name END,  
      country             \= CASE WHEN cu.country IS NULL OR cu.country \= '' THEN NULLIF(p\_country, '') ELSE cu.country END,  
      telegram\_handle     \= CASE WHEN cu.telegram\_handle IS NULL OR cu.telegram\_handle \= '' THEN NULLIF(p\_telegram\_handle, '') ELSE cu.telegram\_handle END,  
      wallet\_address      \= COALESCE(cu.wallet\_address, v\_wallet),  
      base\_wallet\_address \= COALESCE(cu.base\_wallet\_address, v\_base\_wallet),  
      eth\_wallet\_address  \= COALESCE(cu.eth\_wallet\_address, v\_eth\_wallet),  
      avatar\_url          \= CASE WHEN cu.avatar\_url IS NULL OR cu.avatar\_url \= '' THEN NULLIF(p\_avatar\_url, '') ELSE cu.avatar\_url END,  
      updated\_at          \= now()  
    WHERE cu.id \= v\_id;  
  END IF;

  RETURN v\_id;  
EXCEPTION  
  WHEN unique\_violation THEN  
    SELECT id INTO v\_id  
    FROM public.canonical\_users  
    WHERE canonical\_user\_id \= v\_canonical  
    LIMIT 1;

    IF v\_id IS NULL AND p\_email IS NOT NULL THEN  
      SELECT id INTO v\_id  
      FROM public.canonical\_users  
      WHERE lower(email) \= lower(p\_email)  
      LIMIT 1;  
    END IF;

    IF v\_id IS NULL AND p\_username IS NOT NULL THEN  
      SELECT id INTO v\_id  
      FROM public.canonical\_users  
      WHERE lower(username) \= lower(p\_username)  
      LIMIT 1;  
    END IF;

    RETURN v\_id;  
END  
$function$  
"  
public,upsert\_joincompetition\_by\_tx,p\_tx text,p\_tx text,void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.upsert\_joincompetition\_by\_tx(p\_tx text)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  v\_comp\_id uuid;  
  v\_uid text;  
  v\_wallet text;  
  v\_total integer;  
  v\_amount numeric;  
  v\_ticket\_numbers text;  
BEGIN  
  \-- Aggregate tickets by tx to upsert joincompetition without uuid=text comparisons  
  SELECT t.competition\_id, MIN(t.canonical\_user\_id)::text, MIN(t.wallet\_address)::text,  
         COUNT(\*)::int, SUM(COALESCE(t.payment\_amount, t.purchase\_price))::numeric,  
         string\_agg(t.ticket\_number::text, ',' ORDER BY t.ticket\_number)  
  INTO v\_comp\_id, v\_uid, v\_wallet, v\_total, v\_amount, v\_ticket\_numbers  
  FROM public.tickets t  
  WHERE t.payment\_tx\_hash IS NOT DISTINCT FROM p\_tx  
  GROUP BY t.competition\_id  
  LIMIT 1;

  IF v\_comp\_id IS NULL THEN  
    RETURN; \-- nothing to upsert  
  END IF;

  INSERT INTO public.joincompetition AS jc (  
    id, competitionid, userid, canonical\_user\_id, numberoftickets, ticketnumbers,  
    amountspent, walletaddress, chain, transactionhash, purchasedate, created\_at, status  
  ) VALUES (  
    gen\_random\_uuid(), v\_comp\_id::text, v\_uid, v\_uid, v\_total, v\_ticket\_numbers,  
    v\_amount, v\_wallet, 'balance', p\_tx, now(), now(), 'sold'  
  )  
  ON CONFLICT (transactionhash, competitionid)  
  DO UPDATE SET  
    numberoftickets \= EXCLUDED.numberoftickets,  
    ticketnumbers \= EXCLUDED.ticketnumbers,  
    amountspent \= EXCLUDED.amountspent,  
    walletaddress \= EXCLUDED.walletaddress,  
    status \= 'sold',  
    purchasedate \= now(),  
    updated\_at \= now();  
END;  
$function$  
"  
public,upsert\_sub\_account\_balance,"p\_canonical\_user\_id text, p\_currency text, p\_available\_balance numeric, p\_pending\_balance numeric","p\_canonical\_user\_id text, p\_currency text, p\_available\_balance numeric, p\_pending\_balance numeric",sub\_account\_balances,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.upsert\_sub\_account\_balance(p\_canonical\_user\_id text, p\_currency text, p\_available\_balance numeric, p\_pending\_balance numeric)  
 RETURNS sub\_account\_balances  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  r public.sub\_account\_balances;  
  v\_norm\_cuid text;  
BEGIN  
  \-- Normalize canonical\_user\_id into prize:pid:0x\[0-9a-f\]{40}  
  IF p\_canonical\_user\_id IS NULL THEN  
    RAISE EXCEPTION 'canonical\_user\_id cannot be NULL';  
  END IF;

  \-- Accept forms:  
  \-- 1\) prize:pid:0x\<40-hex\> (any case)  \-\> lower whole string  
  \-- 2\) 0x\<40-hex\> (any case)           \-\> prefix with prize:pid: and lower  
  \-- Reject everything else  
  IF p\_canonical\_user\_id \~\* '^prize:pid:0x\[0-9a-f\]{40}$' THEN  
    v\_norm\_cuid := lower(p\_canonical\_user\_id);  
  ELSIF p\_canonical\_user\_id \~\* '^0x\[0-9a-f\]{40}$' THEN  
    v\_norm\_cuid := 'prize:pid:' || lower(p\_canonical\_user\_id);  
  ELSE  
    RAISE EXCEPTION  
      'Invalid canonical\_user\_id format: ""%"". Expected prize:pid:0x\<40 lowercase hex\> or 0x\<40 hex\>',  
      p\_canonical\_user\_id;  
  END IF;

  \-- Upsert. Ensure user\_id matches canonical\_user\_id to satisfy chk\_user\_matches\_canonical  
  INSERT INTO public.sub\_account\_balances (  
    user\_id,  
    canonical\_user\_id,  
    currency,  
    available\_balance,  
    pending\_balance,  
    last\_updated  
  )  
  VALUES (  
    v\_norm\_cuid,  
    v\_norm\_cuid,  
    p\_currency,  
    p\_available\_balance,  
    COALESCE(p\_pending\_balance, 0),  
    now()  
  )  
  ON CONFLICT (canonical\_user\_id, currency) DO UPDATE  
  SET  
    available\_balance \= EXCLUDED.available\_balance,  
    pending\_balance   \= COALESCE(EXCLUDED.pending\_balance, public.sub\_account\_balances.pending\_balance),  
    last\_updated      \= now()  
  RETURNING \* INTO r;

  RETURN r;  
END;  
$function$  
"  
public,upsert\_sub\_account\_topup,"p\_canonical\_user\_id text, p\_amount numeric, p\_currency text","p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text",void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.upsert\_sub\_account\_topup(p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
begin  
  insert into public.sub\_account\_balances as sab  
    (canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated)  
  values (p\_canonical\_user\_id, p\_currency, p\_amount, 0, now())  
  on conflict (canonical\_user\_id, currency) do update  
    set available\_balance \= sab.available\_balance \+ excluded.available\_balance,  
        last\_updated \= now();  
end;  
$function$  
"  
public,user\_transactions\_cdp\_enqueue,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.user\_transactions\_cdp\_enqueue()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  PERFORM public.enqueue\_cdp\_event(  
    'transaction\_created',  
    jsonb\_build\_object(  
      'id', NEW.id,  
      'user\_id', NEW.user\_id,  
      'canonical\_user\_id', NEW.canonical\_user\_id,  
      'wallet\_address', NEW.wallet\_address,  
      'type', NEW.type,  
      'amount', NEW.amount,  
      'currency', NEW.currency,  
      'status', NEW.status,  
      'competition\_id', NEW.competition\_id,  
      'order\_id', NEW.order\_id,  
      'tx\_ref', NEW.tx\_ref,  
      'created\_at', NEW.created\_at  
    )  
  );  
  RETURN NEW;  
END;  
$function$  
"  
public,user\_transactions\_post\_to\_wallet,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.user\_transactions\_post\_to\_wallet()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_delta numeric;  
  v\_before numeric;  
  v\_after numeric;  
  v\_curr text;  
  v\_desc text;  
BEGIN  
  \-- Only act when status \= completed and not yet posted  
  IF NEW.status \<\> 'completed' OR COALESCE(NEW.posted\_to\_balance, false) IS TRUE THEN  
    RETURN NEW;  
  END IF;

  IF NEW.amount IS NULL OR NEW.amount \<= 0 THEN  
    RAISE EXCEPTION 'Amount must be positive';  
  END IF;

  v\_curr := COALESCE(NEW.currency, 'USDC');  
  v\_delta := public.\_wallet\_delta\_from\_txn(NEW.type, NEW.amount);

  \-- Apply to wallet  
  SELECT balance\_before, balance\_after  
    INTO v\_before, v\_after  
  FROM public.\_apply\_wallet\_delta(NEW.canonical\_user\_id, v\_curr, v\_delta);

  \-- Compose description  
  v\_desc := COALESCE(NEW.description,  
            CASE WHEN lower(NEW.type) IN ('topup','top\_up','top-up') THEN 'Wallet top up'  
                 WHEN lower(NEW.type) IN ('entry','entry\_payment','purchase') THEN 'Competition entry'  
                 ELSE 'User transaction'  
            END);

  \-- Insert ledger row  
  INSERT INTO public.balance\_ledger (  
    canonical\_user\_id,  
    transaction\_type,  
    amount,  
    currency,  
    balance\_before,  
    balance\_after,  
    reference\_id,  
    description,  
    created\_at,  
    top\_up\_tx\_id  
  ) VALUES (  
    NEW.canonical\_user\_id,  
    NEW.type,  
    NEW.amount,  
    v\_curr,  
    v\_before,  
    v\_after,  
    NEW.id::text,  
    v\_desc,  
    now(),  
    COALESCE(NEW.tx\_id, NEW.payment\_tx\_hash)  
  );

  \-- Mark as posted  
  NEW.posted\_to\_balance := true;  
  NEW.completed\_at := COALESCE(NEW.completed\_at, now());  
  RETURN NEW;  
END;  
$function$  
"  
public,user\_transactions\_sync\_wallet,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.user\_transactions\_sync\_wallet()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.canonical\_user\_id IS NOT NULL AND (NEW.wallet\_address IS NULL OR NEW.wallet\_address \= '') THEN  
    NEW.wallet\_address := replace(NEW.canonical\_user\_id, 'prize:pid:', '');  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,user\_transactions\_tx\_id\_fill,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.user\_transactions\_tx\_id\_fill()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.tx\_id IS NULL OR NEW.tx\_id \= '' THEN  
    IF coalesce(NEW.payment\_provider,'') \= 'unknown' THEN  
      NEW.tx\_id := public.gen\_deterministic\_tx\_id(  
        NEW.id::uuid,  
        NEW.order\_id::text,  
        NEW.canonical\_user\_id::text,  
        NEW.wallet\_address::text,  
        NEW.type::text,  
        NEW.method::text,  
        NEW.amount::numeric,  
        NEW.currency::text,  
        COALESCE(NEW.created\_at, now())::timestamptz  
      );  
    END IF;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,user\_tx\_autocomplete\_if\_expired,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.user\_tx\_autocomplete\_if\_expired()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.status \= 'pending' AND NEW.expires\_at IS NOT NULL AND NEW.expires\_at \<= NOW() THEN  
    NEW.status := 'completed';  
    NEW.completed\_at := NOW();  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,user\_tx\_before\_insert,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.user\_tx\_before\_insert()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  NEW.type := lower(COALESCE(NEW.type, 'entry'));  
  NEW.status := lower(COALESCE(NEW.status, 'pending'));

  IF NEW.status \= 'pending' AND NEW.expires\_at IS NULL THEN  
    NEW.expires\_at := NOW() \+ INTERVAL '2 minutes';  
  END IF;

  RETURN NEW;  
END;  
$function$  
"  
public,user\_tx\_guard\_no\_double\_post,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.user\_tx\_guard\_no\_double\_post()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF OLD.posted\_to\_balance \= true AND NEW.status \= 'completed' THEN  
    NEW.posted\_to\_balance := true;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,users\_autolink\_canonical\_before\_ins,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.users\_autolink\_canonical\_before\_ins()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
 SET search\_path TO 'public'  
AS $function$  
declare  
  v\_email text := nullif(lower(trim(new.email)), '');  
  v\_wallet text := nullif(lower(trim(new.wallet\_address)), '');  
  v\_row public.canonical\_users;  
begin  
  \-- If canonical\_user\_id already provided, allow  
  if new.canonical\_user\_id is not null and length(new.canonical\_user\_id) \> 0 then  
    return new;  
  end if;

  \-- Try to resolve via ensure\_canonical\_user using whatever is present  
  v\_row := public.ensure\_canonical\_user(  
    p\_email \=\> v\_email,  
    p\_wallet\_address \=\> v\_wallet  
  );

  new.canonical\_user\_id := v\_row.canonical\_user\_id;

  if new.canonical\_user\_id is null then  
    raise exception 'canonical\_user\_id could not be resolved for email=% wallet=%', v\_email, v\_wallet;  
  end if;

  return new;  
end;  
$function$  
"  
public,users\_normalize\_before\_write,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.users\_normalize\_before\_write()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
begin  
  if new.wallet\_address is not null then  
    new.wallet\_address := util.normalize\_evm\_address(new.wallet\_address);  
  end if;

  if new.wallet\_address is not null then  
    new.canonical\_user\_id := 'prize:pid:' || new.wallet\_address;  
  elsif new.canonical\_user\_id is not null then  
    \-- If only canonical provided, try to extract wallet  
    if position('prize:pid:' in new.canonical\_user\_id) \= 1 then  
      new.wallet\_address := replace(new.canonical\_user\_id, 'prize:pid:', '');  
    end if;  
  end if;

  return new;  
end;  
$function$  
"  
public,uuid\_generate\_v1,,,uuid,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_generate\_v1()  
 RETURNS uuid  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_generate\_v1$function$  
"  
public,uuid\_generate\_v1mc,,,uuid,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_generate\_v1mc()  
 RETURNS uuid  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_generate\_v1mc$function$  
"  
public,uuid\_generate\_v3,"namespace uuid, name text","namespace uuid, name text",uuid,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_generate\_v3(namespace uuid, name text)  
 RETURNS uuid  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_generate\_v3$function$  
"  
public,uuid\_generate\_v4,,,uuid,c,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_generate\_v4()  
 RETURNS uuid  
 LANGUAGE c  
 PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_generate\_v4$function$  
"  
public,uuid\_generate\_v5,"namespace uuid, name text","namespace uuid, name text",uuid,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_generate\_v5(namespace uuid, name text)  
 RETURNS uuid  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_generate\_v5$function$  
"  
public,uuid\_nil,,,uuid,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_nil()  
 RETURNS uuid  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_nil$function$  
"  
public,uuid\_ns\_dns,,,uuid,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_ns\_dns()  
 RETURNS uuid  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_ns\_dns$function$  
"  
public,uuid\_ns\_oid,,,uuid,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_ns\_oid()  
 RETURNS uuid  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_ns\_oid$function$  
"  
public,uuid\_ns\_url,,,uuid,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_ns\_url()  
 RETURNS uuid  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_ns\_url$function$  
"  
public,uuid\_ns\_x500,,,uuid,c,false,i,false,false,null,"CREATE OR REPLACE FUNCTION public.uuid\_ns\_x500()  
 RETURNS uuid  
 LANGUAGE c  
 IMMUTABLE PARALLEL SAFE STRICT  
AS '$libdir/uuid-ossp', $function$uuid\_ns\_x500$function$  
"  
public,validate\_reservation,"p\_reservation\_id uuid, p\_user\_id text, p\_competition\_id uuid","p\_reservation\_id uuid, p\_user\_id text, p\_competition\_id uuid",jsonb,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION public.validate\_reservation(p\_reservation\_id uuid, p\_user\_id text, p\_competition\_id uuid)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  rec record;  
  result jsonb := '{}'::jsonb;  
  now\_ts timestamptz := now();  
BEGIN  
  SELECT id, user\_id::text AS user\_id\_text, competition\_id, status, expires\_at, created\_at  
  INTO rec  
  FROM public.pending\_tickets  
  WHERE id \= p\_reservation\_id;

  IF NOT FOUND THEN  
    RETURN jsonb\_build\_object(  
      'ok', false,  
      'reason', 'not\_found'  
    );  
  END IF;

  result := jsonb\_build\_object(  
    'ok', true,  
    'reservation', jsonb\_build\_object(  
      'id', rec.id,  
      'user\_id', rec.user\_id\_text,  
      'competition\_id', rec.competition\_id,  
      'status', rec.status,  
      'expires\_at', rec.expires\_at,  
      'created\_at', rec.created\_at  
    )  
  );

  \-- user mismatch  
  IF rec.user\_id\_text IS DISTINCT FROM p\_user\_id THEN  
    result := result || jsonb\_build\_object('user\_mismatch', true);  
  END IF;

  \-- competition mismatch  
  IF rec.competition\_id IS DISTINCT FROM p\_competition\_id THEN  
    result := result || jsonb\_build\_object('competition\_mismatch', true);  
  END IF;

  \-- expired  
  IF rec.expires\_at \<= now\_ts THEN  
    result := result || jsonb\_build\_object('expired', true);  
  END IF;

  \-- invalid status (expects pending)  
  IF rec.status \<\> 'pending' THEN  
    result := result || jsonb\_build\_object('invalid\_status', rec.status);  
  END IF;

  RETURN result;  
END;  
$function$  
"  
public,winners\_sync\_wallet,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.winners\_sync\_wallet()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF TG\_OP IN ('INSERT','UPDATE') THEN  
    BEGIN  
      \-- Try to set from canonical\_user\_id if column exists  
      PERFORM 1 FROM information\_schema.columns WHERE table\_schema='public' AND table\_name=TG\_TABLE\_NAME AND column\_name='canonical\_user\_id';  
      IF FOUND THEN  
        IF NEW.canonical\_user\_id IS NOT NULL AND (NEW.wallet\_address IS NULL OR NEW.wallet\_address \= '') THEN  
          NEW.wallet\_address := replace(NEW.canonical\_user\_id, 'prize:pid:', '');  
        END IF;  
      END IF;  
    EXCEPTION WHEN undefined\_column THEN  
      \-- no-op if canonical\_user\_id not present  
      NULL;  
    END;  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
public,winners\_sync\_wallet\_from\_user\_id,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION public.winners\_sync\_wallet\_from\_user\_id()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.user\_id IS NOT NULL AND NEW.user\_id LIKE 'prize:pid:%' AND (NEW.wallet\_address IS NULL OR NEW.wallet\_address \= '') THEN  
    NEW.wallet\_address := replace(NEW.user\_id, 'prize:pid:', '');  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
realtime,apply\_rls,"wal jsonb, max\_record\_bytes integer","wal jsonb, max\_record\_bytes integer DEFAULT (1024 \* 1024)",wal\_rls,plpgsql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION realtime.apply\_rls(wal jsonb, max\_record\_bytes integer DEFAULT (1024 \* 1024))  
 RETURNS SETOF realtime.wal\_rls  
 LANGUAGE plpgsql  
AS $function$  
declare  
\-- Regclass of the table e.g. public.notes  
entity\_ regclass \= (quote\_ident(wal \-\>\> 'schema') || '.' || quote\_ident(wal \-\>\> 'table'))::regclass;

\-- I, U, D, T: insert, update ...  
action realtime.action \= (  
    case wal \-\>\> 'action'  
        when 'I' then 'INSERT'  
        when 'U' then 'UPDATE'  
        when 'D' then 'DELETE'  
        else 'ERROR'  
    end  
);

\-- Is row level security enabled for the table  
is\_rls\_enabled bool \= relrowsecurity from pg\_class where oid \= entity\_;

subscriptions realtime.subscription\[\] \= array\_agg(subs)  
    from  
        realtime.subscription subs  
    where  
        subs.entity \= entity\_;

\-- Subscription vars  
roles regrole\[\] \= array\_agg(distinct us.claims\_role::text)  
    from  
        unnest(subscriptions) us;

working\_role regrole;  
claimed\_role regrole;  
claims jsonb;

subscription\_id uuid;  
subscription\_has\_access bool;  
visible\_to\_subscription\_ids uuid\[\] \= '{}';

\-- structured info for wal's columns  
columns realtime.wal\_column\[\];  
\-- previous identity values for update/delete  
old\_columns realtime.wal\_column\[\];

error\_record\_exceeds\_max\_size boolean \= octet\_length(wal::text) \> max\_record\_bytes;

\-- Primary jsonb output for record  
output jsonb;

begin  
perform set\_config('role', null, true);

columns \=  
    array\_agg(  
        (  
            x-\>\>'name',  
            x-\>\>'type',  
            x-\>\>'typeoid',  
            realtime.cast(  
                (x-\>'value') \#\>\> '{}',  
                coalesce(  
                    (x-\>\>'typeoid')::regtype, \-- null when wal2json version \<= 2.4  
                    (x-\>\>'type')::regtype  
                )  
            ),  
            (pks \-\>\> 'name') is not null,  
            true  
        )::realtime.wal\_column  
    )  
    from  
        jsonb\_array\_elements(wal \-\> 'columns') x  
        left join jsonb\_array\_elements(wal \-\> 'pk') pks  
            on (x \-\>\> 'name') \= (pks \-\>\> 'name');

old\_columns \=  
    array\_agg(  
        (  
            x-\>\>'name',  
            x-\>\>'type',  
            x-\>\>'typeoid',  
            realtime.cast(  
                (x-\>'value') \#\>\> '{}',  
                coalesce(  
                    (x-\>\>'typeoid')::regtype, \-- null when wal2json version \<= 2.4  
                    (x-\>\>'type')::regtype  
                )  
            ),  
            (pks \-\>\> 'name') is not null,  
            true  
        )::realtime.wal\_column  
    )  
    from  
        jsonb\_array\_elements(wal \-\> 'identity') x  
        left join jsonb\_array\_elements(wal \-\> 'pk') pks  
            on (x \-\>\> 'name') \= (pks \-\>\> 'name');

for working\_role in select \* from unnest(roles) loop

    \-- Update \`is\_selectable\` for columns and old\_columns  
    columns \=  
        array\_agg(  
            (  
                c.name,  
                c.type\_name,  
                c.type\_oid,  
                c.value,  
                c.is\_pkey,  
                pg\_catalog.has\_column\_privilege(working\_role, entity\_, c.name, 'SELECT')  
            )::realtime.wal\_column  
        )  
        from  
            unnest(columns) c;

    old\_columns \=  
            array\_agg(  
                (  
                    c.name,  
                    c.type\_name,  
                    c.type\_oid,  
                    c.value,  
                    c.is\_pkey,  
                    pg\_catalog.has\_column\_privilege(working\_role, entity\_, c.name, 'SELECT')  
                )::realtime.wal\_column  
            )  
            from  
                unnest(old\_columns) c;

    if action \<\> 'DELETE' and count(1) \= 0 from unnest(columns) c where c.is\_pkey then  
        return next (  
            jsonb\_build\_object(  
                'schema', wal \-\>\> 'schema',  
                'table', wal \-\>\> 'table',  
                'type', action  
            ),  
            is\_rls\_enabled,  
            \-- subscriptions is already filtered by entity  
            (select array\_agg(s.subscription\_id) from unnest(subscriptions) as s where claims\_role \= working\_role),  
            array\['Error 400: Bad Request, no primary key'\]  
        )::realtime.wal\_rls;

    \-- The claims role does not have SELECT permission to the primary key of entity  
    elsif action \<\> 'DELETE' and sum(c.is\_selectable::int) \<\> count(1) from unnest(columns) c where c.is\_pkey then  
        return next (  
            jsonb\_build\_object(  
                'schema', wal \-\>\> 'schema',  
                'table', wal \-\>\> 'table',  
                'type', action  
            ),  
            is\_rls\_enabled,  
            (select array\_agg(s.subscription\_id) from unnest(subscriptions) as s where claims\_role \= working\_role),  
            array\['Error 401: Unauthorized'\]  
        )::realtime.wal\_rls;

    else  
        output \= jsonb\_build\_object(  
            'schema', wal \-\>\> 'schema',  
            'table', wal \-\>\> 'table',  
            'type', action,  
            'commit\_timestamp', to\_char(  
                ((wal \-\>\> 'timestamp')::timestamptz at time zone 'utc'),  
                'YYYY-MM-DD""T""HH24:MI:SS.MS""Z""'  
            ),  
            'columns', (  
                select  
                    jsonb\_agg(  
                        jsonb\_build\_object(  
                            'name', pa.attname,  
                            'type', pt.typname  
                        )  
                        order by pa.attnum asc  
                    )  
                from  
                    pg\_attribute pa  
                    join pg\_type pt  
                        on pa.atttypid \= pt.oid  
                where  
                    attrelid \= entity\_  
                    and attnum \> 0  
                    and pg\_catalog.has\_column\_privilege(working\_role, entity\_, pa.attname, 'SELECT')  
            )  
        )  
        \-- Add ""record"" key for insert and update  
        || case  
            when action in ('INSERT', 'UPDATE') then  
                jsonb\_build\_object(  
                    'record',  
                    (  
                        select  
                            jsonb\_object\_agg(  
                                \-- if unchanged toast, get column name and value from old record  
                                coalesce((c).name, (oc).name),  
                                case  
                                    when (c).name is null then (oc).value  
                                    else (c).value  
                                end  
                            )  
                        from  
                            unnest(columns) c  
                            full outer join unnest(old\_columns) oc  
                                on (c).name \= (oc).name  
                        where  
                            coalesce((c).is\_selectable, (oc).is\_selectable)  
                            and ( not error\_record\_exceeds\_max\_size or (octet\_length((c).value::text) \<= 64))  
                    )  
                )  
            else '{}'::jsonb  
        end  
        \-- Add ""old\_record"" key for update and delete  
        || case  
            when action \= 'UPDATE' then  
                jsonb\_build\_object(  
                        'old\_record',  
                        (  
                            select jsonb\_object\_agg((c).name, (c).value)  
                            from unnest(old\_columns) c  
                            where  
                                (c).is\_selectable  
                                and ( not error\_record\_exceeds\_max\_size or (octet\_length((c).value::text) \<= 64))  
                        )  
                    )  
            when action \= 'DELETE' then  
                jsonb\_build\_object(  
                    'old\_record',  
                    (  
                        select jsonb\_object\_agg((c).name, (c).value)  
                        from unnest(old\_columns) c  
                        where  
                            (c).is\_selectable  
                            and ( not error\_record\_exceeds\_max\_size or (octet\_length((c).value::text) \<= 64))  
                            and ( not is\_rls\_enabled or (c).is\_pkey ) \-- if RLS enabled, we can't secure deletes so filter to pkey  
                    )  
                )  
            else '{}'::jsonb  
        end;

        \-- Create the prepared statement  
        if is\_rls\_enabled and action \<\> 'DELETE' then  
            if (select 1 from pg\_prepared\_statements where name \= 'walrus\_rls\_stmt' limit 1\) \> 0 then  
                deallocate walrus\_rls\_stmt;  
            end if;  
            execute realtime.build\_prepared\_statement\_sql('walrus\_rls\_stmt', entity\_, columns);  
        end if;

        visible\_to\_subscription\_ids \= '{}';

        for subscription\_id, claims in (  
                select  
                    subs.subscription\_id,  
                    subs.claims  
                from  
                    unnest(subscriptions) subs  
                where  
                    subs.entity \= entity\_  
                    and subs.claims\_role \= working\_role  
                    and (  
                        realtime.is\_visible\_through\_filters(columns, subs.filters)  
                        or (  
                          action \= 'DELETE'  
                          and realtime.is\_visible\_through\_filters(old\_columns, subs.filters)  
                        )  
                    )  
        ) loop

            if not is\_rls\_enabled or action \= 'DELETE' then  
                visible\_to\_subscription\_ids \= visible\_to\_subscription\_ids || subscription\_id;  
            else  
                \-- Check if RLS allows the role to see the record  
                perform  
                    \-- Trim leading and trailing quotes from working\_role because set\_config  
                    \-- doesn't recognize the role as valid if they are included  
                    set\_config('role', trim(both '""' from working\_role::text), true),  
                    set\_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus\_rls\_stmt' into subscription\_has\_access;

                if subscription\_has\_access then  
                    visible\_to\_subscription\_ids \= visible\_to\_subscription\_ids || subscription\_id;  
                end if;  
            end if;  
        end loop;

        perform set\_config('role', null, true);

        return next (  
            output,  
            is\_rls\_enabled,  
            visible\_to\_subscription\_ids,  
            case  
                when error\_record\_exceeds\_max\_size then array\['Error 413: Payload Too Large'\]  
                else '{}'  
            end  
        )::realtime.wal\_rls;

    end if;  
end loop;

perform set\_config('role', null, true);  
end;  
$function$  
"  
realtime,broadcast\_changes,"topic\_name text, event\_name text, operation text, table\_name text, table\_schema text, new record, old record, level text","topic\_name text, event\_name text, operation text, table\_name text, table\_schema text, new record, old record, level text DEFAULT 'ROW'::text",void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION realtime.broadcast\_changes(topic\_name text, event\_name text, operation text, table\_name text, table\_schema text, new record, old record, level text DEFAULT 'ROW'::text)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
    \-- Declare a variable to hold the JSONB representation of the row  
    row\_data jsonb := '{}'::jsonb;  
BEGIN  
    IF level \= 'STATEMENT' THEN  
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';  
    END IF;  
    \-- Check the operation type and handle accordingly  
    IF operation \= 'INSERT' OR operation \= 'UPDATE' OR operation \= 'DELETE' THEN  
        row\_data := jsonb\_build\_object('old\_record', OLD, 'record', NEW, 'operation', operation, 'table', table\_name, 'schema', table\_schema);  
        PERFORM realtime.send (row\_data, event\_name, topic\_name);  
    ELSE  
        RAISE EXCEPTION 'Unexpected operation type: %', operation;  
    END IF;  
EXCEPTION  
    WHEN OTHERS THEN  
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;  
END;

$function$  
"  
realtime,build\_prepared\_statement\_sql,"prepared\_statement\_name text, entity regclass, columns realtime.wal\_column\[\]","prepared\_statement\_name text, entity regclass, columns realtime.wal\_column\[\]",text,sql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION realtime.build\_prepared\_statement\_sql(prepared\_statement\_name text, entity regclass, columns realtime.wal\_column\[\])  
 RETURNS text  
 LANGUAGE sql  
AS $function$  
      /\*  
      Builds a sql string that, if executed, creates a prepared statement to  
      tests retrive a row from \*entity\* by its primary key columns.  
      Example  
          select realtime.build\_prepared\_statement\_sql('public.notes', '{""id""}'::text\[\], '{""bigint""}'::text\[\])  
      \*/  
          select  
      'prepare ' || prepared\_statement\_name || ' as  
          select  
              exists(  
                  select  
                      1  
                  from  
                      ' || entity || '  
                  where  
                      ' || string\_agg(quote\_ident(pkc.name) || '=' || quote\_nullable(pkc.value \#\>\> '{}') , ' and ') || '  
              )'  
          from  
              unnest(columns) pkc  
          where  
              pkc.is\_pkey  
          group by  
              entity  
      $function$  
"  
realtime,cast,"val text, type\_ regtype","val text, type\_ regtype",jsonb,plpgsql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION realtime.""cast""(val text, type\_ regtype)  
 RETURNS jsonb  
 LANGUAGE plpgsql  
 IMMUTABLE  
AS $function$  
    declare  
      res jsonb;  
    begin  
      execute format('select to\_jsonb(%L::'|| type\_::text || ')', val)  into res;  
      return res;  
    end  
    $function$  
"  
realtime,check\_equality\_op,"op realtime.equality\_op, type\_ regtype, val\_1 text, val\_2 text","op realtime.equality\_op, type\_ regtype, val\_1 text, val\_2 text",bool,plpgsql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION realtime.check\_equality\_op(op realtime.equality\_op, type\_ regtype, val\_1 text, val\_2 text)  
 RETURNS boolean  
 LANGUAGE plpgsql  
 IMMUTABLE  
AS $function$  
      /\*  
      Casts \*val\_1\* and \*val\_2\* as type \*type\_\* and check the \*op\* condition for truthiness  
      \*/  
      declare  
          op\_symbol text \= (  
              case  
                  when op \= 'eq' then '='  
                  when op \= 'neq' then '\!='  
                  when op \= 'lt' then '\<'  
                  when op \= 'lte' then '\<='  
                  when op \= 'gt' then '\>'  
                  when op \= 'gte' then '\>='  
                  when op \= 'in' then '= any'  
                  else 'UNKNOWN OP'  
              end  
          );  
          res boolean;  
      begin  
          execute format(  
              'select %L::'|| type\_::text || ' ' || op\_symbol  
              || ' ( %L::'  
              || (  
                  case  
                      when op \= 'in' then type\_::text || '\[\]'  
                      else type\_::text end  
              )  
              || ')', val\_1, val\_2) into res;  
          return res;  
      end;  
      $function$  
"  
realtime,is\_visible\_through\_filters,"columns realtime.wal\_column\[\], filters realtime.user\_defined\_filter\[\]","columns realtime.wal\_column\[\], filters realtime.user\_defined\_filter\[\]",bool,sql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION realtime.is\_visible\_through\_filters(columns realtime.wal\_column\[\], filters realtime.user\_defined\_filter\[\])  
 RETURNS boolean  
 LANGUAGE sql  
 IMMUTABLE  
AS $function$  
    /\*  
    Should the record be visible (true) or filtered out (false) after \*filters\* are applied  
    \*/  
        select  
            \-- Default to allowed when no filters present  
            $2 is null \-- no filters. this should not happen because subscriptions has a default  
            or array\_length($2, 1\) is null \-- array length of an empty array is null  
            or bool\_and(  
                coalesce(  
                    realtime.check\_equality\_op(  
                        op:=f.op,  
                        type\_:=coalesce(  
                            col.type\_oid::regtype, \-- null when wal2json version \<= 2.4  
                            col.type\_name::regtype  
                        ),  
                        \-- cast jsonb to text  
                        val\_1:=col.value \#\>\> '{}',  
                        val\_2:=f.value  
                    ),  
                    false \-- if null, filter does not match  
                )  
            )  
        from  
            unnest(filters) f  
            join unnest(columns) col  
                on f.column\_name \= col.name;  
    $function$  
"  
realtime,list\_changes,"publication name, slot\_name name, max\_changes integer, max\_record\_bytes integer","publication name, slot\_name name, max\_changes integer, max\_record\_bytes integer",wal\_rls,sql,false,v,false,true,null,"CREATE OR REPLACE FUNCTION realtime.list\_changes(publication name, slot\_name name, max\_changes integer, max\_record\_bytes integer)  
 RETURNS SETOF realtime.wal\_rls  
 LANGUAGE sql  
 SET log\_min\_messages TO 'fatal'  
AS $function$  
      with pub as (  
        select  
          concat\_ws(  
            ',',  
            case when bool\_or(pubinsert) then 'insert' else null end,  
            case when bool\_or(pubupdate) then 'update' else null end,  
            case when bool\_or(pubdelete) then 'delete' else null end  
          ) as w2j\_actions,  
          coalesce(  
            string\_agg(  
              realtime.quote\_wal2json(format('%I.%I', schemaname, tablename)::regclass),  
              ','  
            ) filter (where ppt.tablename is not null and ppt.tablename not like '% %'),  
            ''  
          ) w2j\_add\_tables  
        from  
          pg\_publication pp  
          left join pg\_publication\_tables ppt  
            on pp.pubname \= ppt.pubname  
        where  
          pp.pubname \= publication  
        group by  
          pp.pubname  
        limit 1  
      ),  
      w2j as (  
        select  
          x.\*, pub.w2j\_add\_tables  
        from  
          pub,  
          pg\_logical\_slot\_get\_changes(  
            slot\_name, null, max\_changes,  
            'include-pk', 'true',  
            'include-transaction', 'false',  
            'include-timestamp', 'true',  
            'include-type-oids', 'true',  
            'format-version', '2',  
            'actions', pub.w2j\_actions,  
            'add-tables', pub.w2j\_add\_tables  
          ) x  
      )  
      select  
        xyz.wal,  
        xyz.is\_rls\_enabled,  
        xyz.subscription\_ids,  
        xyz.errors  
      from  
        w2j,  
        realtime.apply\_rls(  
          wal := w2j.data::jsonb,  
          max\_record\_bytes := max\_record\_bytes  
        ) xyz(wal, is\_rls\_enabled, subscription\_ids, errors)  
      where  
        w2j.w2j\_add\_tables \<\> ''  
        and xyz.subscription\_ids\[1\] is not null  
    $function$  
"  
realtime,quote\_wal2json,entity regclass,entity regclass,text,sql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION realtime.quote\_wal2json(entity regclass)  
 RETURNS text  
 LANGUAGE sql  
 IMMUTABLE STRICT  
AS $function$  
      select  
        (  
          select string\_agg('' || ch,'')  
          from unnest(string\_to\_array(nsp.nspname::text, null)) with ordinality x(ch, idx)  
          where  
            not (x.idx \= 1 and x.ch \= '""')  
            and not (  
              x.idx \= array\_length(string\_to\_array(nsp.nspname::text, null), 1\)  
              and x.ch \= '""'  
            )  
        )  
        || '.'  
        || (  
          select string\_agg('' || ch,'')  
          from unnest(string\_to\_array(pc.relname::text, null)) with ordinality x(ch, idx)  
          where  
            not (x.idx \= 1 and x.ch \= '""')  
            and not (  
              x.idx \= array\_length(string\_to\_array(nsp.nspname::text, null), 1\)  
              and x.ch \= '""'  
            )  
          )  
      from  
        pg\_class pc  
        join pg\_namespace nsp  
          on pc.relnamespace \= nsp.oid  
      where  
        pc.oid \= entity  
    $function$  
"  
realtime,send,"payload jsonb, event text, topic text, private boolean","payload jsonb, event text, topic text, private boolean DEFAULT true",void,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)  
 RETURNS void  
 LANGUAGE plpgsql  
AS $function$  
DECLARE  
  generated\_id uuid;  
  final\_payload jsonb;  
BEGIN  
  BEGIN  
    \-- Generate a new UUID for the id  
    generated\_id := gen\_random\_uuid();

    \-- Check if payload has an 'id' key, if not, add the generated UUID  
    IF payload ? 'id' THEN  
      final\_payload := payload;  
    ELSE  
      final\_payload := jsonb\_set(payload, '{id}', to\_jsonb(generated\_id));  
    END IF;

    \-- Set the topic configuration  
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    \-- Attempt to insert the message  
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)  
    VALUES (generated\_id, final\_payload, event, topic, private, 'broadcast');  
  EXCEPTION  
    WHEN OTHERS THEN  
      \-- Capture and notify the error  
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;  
  END;  
END;  
$function$  
"  
realtime,subscription\_check\_filters,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION realtime.subscription\_check\_filters()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
    /\*  
    Validates that the user defined filters for a subscription:  
    \- refer to valid columns that the claimed role may access  
    \- values are coercable to the correct column type  
    \*/  
    declare  
        col\_names text\[\] \= coalesce(  
                array\_agg(c.column\_name order by c.ordinal\_position),  
                '{}'::text\[\]  
            )  
            from  
                information\_schema.columns c  
            where  
                format('%I.%I', c.table\_schema, c.table\_name)::regclass \= new.entity  
                and pg\_catalog.has\_column\_privilege(  
                    (new.claims \-\>\> 'role'),  
                    format('%I.%I', c.table\_schema, c.table\_name)::regclass,  
                    c.column\_name,  
                    'SELECT'  
                );  
        filter realtime.user\_defined\_filter;  
        col\_type regtype;

        in\_val jsonb;  
    begin  
        for filter in select \* from unnest(new.filters) loop  
            \-- Filtered column is valid  
            if not filter.column\_name \= any(col\_names) then  
                raise exception 'invalid column for filter %', filter.column\_name;  
            end if;

            \-- Type is sanitized and safe for string interpolation  
            col\_type \= (  
                select atttypid::regtype  
                from pg\_catalog.pg\_attribute  
                where attrelid \= new.entity  
                      and attname \= filter.column\_name  
            );  
            if col\_type is null then  
                raise exception 'failed to lookup type for column %', filter.column\_name;  
            end if;

            \-- Set maximum number of entries for in filter  
            if filter.op \= 'in'::realtime.equality\_op then  
                in\_val \= realtime.cast(filter.value, (col\_type::text || '\[\]')::regtype);  
                if coalesce(jsonb\_array\_length(in\_val), 0\) \> 100 then  
                    raise exception 'too many values for \`in\` filter. Maximum 100';  
                end if;  
            else  
                \-- raises an exception if value is not coercable to type  
                perform realtime.cast(filter.value, col\_type);  
            end if;

        end loop;

        \-- Apply consistent order to filters so the unique constraint on  
        \-- (subscription\_id, entity, filters) can't be tricked by a different filter order  
        new.filters \= coalesce(  
            array\_agg(f order by f.column\_name, f.op, f.value),  
            '{}'  
        ) from unnest(new.filters) f;

        return new;  
    end;  
    $function$  
"  
realtime,to\_regrole,role\_name text,role\_name text,regrole,sql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION realtime.to\_regrole(role\_name text)  
 RETURNS regrole  
 LANGUAGE sql  
 IMMUTABLE  
AS $function$ select role\_name::regrole $function$  
"  
realtime,topic,,,text,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION realtime.topic()  
 RETURNS text  
 LANGUAGE sql  
 STABLE  
AS $function$  
select nullif(current\_setting('realtime.topic', true), '')::text;  
$function$  
"  
util,apply\_coinbase\_topups,p\_ids uuid\[\],p\_ids uuid\[\],void,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION util.apply\_coinbase\_topups(p\_ids uuid\[\])  
 RETURNS void  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  \-- Lock affected transactions to prevent race conditions  
  PERFORM 1 FROM public.user\_transactions WHERE id \= ANY(p\_ids) FOR UPDATE;

  WITH tgt AS (  
    SELECT id, user\_id, canonical\_user\_id, currency, COALESCE(amount, 0)::numeric AS amount  
    FROM public.user\_transactions  
    WHERE id \= ANY(p\_ids)  
      AND type \= 'topup'  
      AND (provider \= 'coinbase' OR payment\_provider \= 'coinbase')  
      AND status \= 'pending'  
      AND COALESCE(posted\_to\_balance, false) \= false  
  ), bal AS (  
    SELECT sab.canonical\_user\_id, sab.currency, COALESCE(sab.available\_balance, 0)::numeric AS curr\_balance  
    FROM public.sub\_account\_balances sab  
    WHERE (sab.canonical\_user\_id, sab.currency) IN (SELECT canonical\_user\_id, currency FROM tgt)  
  ), merged AS (  
    SELECT t.id,  
           t.user\_id,  
           t.canonical\_user\_id,  
           t.currency,  
           t.amount,  
           COALESCE(b.curr\_balance, 0)::numeric AS balance\_before,  
           (COALESCE(b.curr\_balance, 0)::numeric \+ t.amount)::numeric AS balance\_after  
    FROM tgt t  
    LEFT JOIN bal b ON b.canonical\_user\_id \= t.canonical\_user\_id AND b.currency \= t.currency  
  ), upd\_tx AS (  
    UPDATE public.user\_transactions ut  
    SET status \= 'completed',  
        completed\_at \= NOW(),  
        posted\_to\_balance \= true,  
        balance\_before \= m.balance\_before,  
        balance\_after  \= m.balance\_after  
    FROM merged m  
    WHERE ut.id \= m.id  
    RETURNING ut.id, m.user\_id, ut.canonical\_user\_id, ut.currency, ut.amount  
  ), sums AS (  
    SELECT user\_id, canonical\_user\_id, currency, SUM(amount) AS total\_amount  
    FROM upd\_tx  
    GROUP BY user\_id, canonical\_user\_id, currency  
  )  
  INSERT INTO public.sub\_account\_balances (user\_id, canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated)  
  SELECT s.user\_id, s.canonical\_user\_id, s.currency, s.total\_amount, 0, NOW()  
  FROM sums s  
  ON CONFLICT (canonical\_user\_id, currency)  
  DO UPDATE SET available\_balance \= public.sub\_account\_balances.available\_balance \+ EXCLUDED.available\_balance,  
                last\_updated \= NOW();  
END;  
$function$  
"  
util,broadcast\_table\_changes,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
BEGIN  
  PERFORM realtime.broadcast\_changes(  
    'table:' || TG\_TABLE\_NAME,  
    TG\_OP,  
    TG\_OP,  
    TG\_TABLE\_NAME,  
    TG\_TABLE\_SCHEMA,  
    NEW,  
    OLD  
  );  
  RETURN COALESCE(NEW, OLD);  
END;  
$function$  
"  
util,finalize\_pending\_user\_transactions,,,trigger,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION util.finalize\_pending\_user\_transactions()  
 RETURNS trigger  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_curr\_balance numeric;  
BEGIN  
  IF NEW.status \= 'pending' THEN  
    SELECT COALESCE(sab.available\_balance, 0\)  
      INTO v\_curr\_balance  
      FROM public.sub\_account\_balances sab  
     WHERE sab.canonical\_user\_id \= NEW.canonical\_user\_id  
       AND sab.currency \= NEW.currency  
     LIMIT 1;

    NEW.balance\_before := COALESCE(v\_curr\_balance, 0);  
    NEW.balance\_after  := COALESCE(v\_curr\_balance, 0\) \+ COALESCE(NEW.amount, 0);  
    NEW.status := 'completed';  
    NEW.completed\_at := NOW();  
    NEW.posted\_to\_balance := true;

    \-- Upsert balance atomically  
    INSERT INTO public.sub\_account\_balances (  
      user\_id, canonical\_user\_id, currency, available\_balance, pending\_balance, last\_updated  
    ) VALUES (  
      NEW.user\_id, NEW.canonical\_user\_id, NEW.currency, COALESCE(NEW.amount,0), 0, NOW()  
    )  
    ON CONFLICT (canonical\_user\_id, currency)  
    DO UPDATE SET available\_balance \= public.sub\_account\_balances.available\_balance \+ EXCLUDED.available\_balance,  
                  last\_updated \= NOW();  
  END IF;

  RETURN NEW;  
END;  
$function$  
"  
util,index\_identity,def regclass,def regclass,text,sql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION util.index\_identity(def regclass)  
 RETURNS text  
 LANGUAGE sql  
 STABLE  
AS $function$  
  select pg\_get\_indexdef(def) || ' WHERE ' || coalesce(pg\_get\_expr(indpred, indrelid), '')  
  from pg\_index i where i.indexrelid \= def;  
$function$  
"  
util,normalize\_evm\_address,addr text,addr text,text,sql,false,i,false,false,Normalize/trim to lowercase EVM address. No checksum validation.,"CREATE OR REPLACE FUNCTION util.normalize\_evm\_address(addr text)  
 RETURNS text  
 LANGUAGE sql  
 IMMUTABLE  
AS $function$  
  select case  
    when addr is null or length(trim(addr)) \= 0 then null  
    else lower(trim(addr))  
  end;  
$function$  
"  
util,normalize\_wallet,p\_wallet text,p\_wallet text,text,sql,false,i,false,false,null,"CREATE OR REPLACE FUNCTION util.normalize\_wallet(p\_wallet text)  
 RETURNS text  
 LANGUAGE sql  
 IMMUTABLE  
AS $function$  
  SELECT CASE  
    WHEN p\_wallet IS NULL OR length(trim(p\_wallet)) \= 0 THEN NULL  
    WHEN left(p\_wallet, 2\) \= '0x' THEN lower(p\_wallet)  
    ELSE '0x' || lower(p\_wallet)  
  END;  
$function$  
"  
util,resolve\_canonical\_user\_id,"p\_wallet text, p\_privy text","p\_wallet text, p\_privy text",text,plpgsql,true,s,false,false,null,"CREATE OR REPLACE FUNCTION util.resolve\_canonical\_user\_id(p\_wallet text, p\_privy text)  
 RETURNS text  
 LANGUAGE plpgsql  
 STABLE SECURITY DEFINER  
AS $function$  
    DECLARE  
      v\_wallet text := util.normalize\_wallet(p\_wallet);  
      v\_cuid text;  
    BEGIN  
      IF v\_wallet IS NOT NULL THEN  
        SELECT cu.canonical\_user\_id  
        INTO v\_cuid  
        FROM public.canonical\_users cu  
        WHERE v\_wallet \= ANY(ARRAY\[  
          cu.wallet\_address,  
          cu.base\_wallet\_address,  
          cu.eth\_wallet\_address,  
          cu.primary\_wallet\_address  
        \])  
        LIMIT 1;  
        IF v\_cuid IS NOT NULL THEN  
          RETURN v\_cuid;  
        END IF;

        SELECT cu.canonical\_user\_id  
        INTO v\_cuid  
        FROM public.canonical\_users cu  
        WHERE cu.linked\_wallets ? v\_wallet  
        LIMIT 1;  
        IF v\_cuid IS NOT NULL THEN  
          RETURN v\_cuid;  
        END IF;  
      END IF;

      IF p\_privy IS NOT NULL THEN  
        SELECT cu.canonical\_user\_id  
        INTO v\_cuid  
        FROM public.canonical\_users cu  
        WHERE cu.privy\_user\_id \= p\_privy  
        LIMIT 1;  
        IF v\_cuid IS NOT NULL THEN  
          RETURN v\_cuid;  
        END IF;  
      END IF;

      RETURN NULL;  
    END;  
    $function$  
"  
util,trg\_set\_cuid\_from\_context,,,trigger,plpgsql,false,v,false,false,null,"CREATE OR REPLACE FUNCTION util.trg\_set\_cuid\_from\_context()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.canonical\_user\_id IS NULL THEN  
    NEW.canonical\_user\_id := util.resolve\_canonical\_user\_id(  
      NEW.wallet\_address,  
      COALESCE(NEW.privy\_user\_id, NEW.user\_privy\_id)  
    );  
  END IF;  
  RETURN NEW;  
END;  
$function$  
"  
util,upsert\_canonical\_user\_from\_auth,"in\_p\_canonical\_id text, in\_p\_wallet\_address text, in\_p\_email text, in\_p\_auth\_provider text","in\_p\_canonical\_id text, in\_p\_wallet\_address text, in\_p\_email text, in\_p\_auth\_provider text DEFAULT NULL::text",uuid,plpgsql,true,v,false,false,null,"CREATE OR REPLACE FUNCTION util.upsert\_canonical\_user\_from\_auth(in\_p\_canonical\_id text, in\_p\_wallet\_address text, in\_p\_email text, in\_p\_auth\_provider text DEFAULT NULL::text)  
 RETURNS uuid  
 LANGUAGE plpgsql  
 SECURITY DEFINER  
AS $function$  
DECLARE  
  v\_id uuid;  
  v\_wallet text := util.normalize\_evm\_address(in\_p\_wallet\_address);  
  v\_email text := NULLIF(lower(trim(in\_p\_email)), '');  
  v\_canon text := CASE   
    WHEN in\_p\_canonical\_id IS NOT NULL AND length(trim(in\_p\_canonical\_id))\>0 THEN lower(trim(in\_p\_canonical\_id))  
    WHEN v\_wallet IS NOT NULL THEN 'prize:pid:' || v\_wallet  
    ELSE NULL  
  END;  
BEGIN  
  \-- Optional small delay to let client events settle  
  PERFORM pg\_sleep(2);

  \-- Try canonical id first  
  IF v\_canon IS NOT NULL THEN  
    SELECT id INTO v\_id FROM public.canonical\_users WHERE canonical\_user\_id \= v\_canon LIMIT 1;  
    IF FOUND THEN  
      UPDATE public.canonical\_users SET  
        wallet\_address \= COALESCE(wallet\_address, v\_wallet),  
        base\_wallet\_address \= COALESCE(base\_wallet\_address, v\_wallet),  
        eth\_wallet\_address \= COALESCE(eth\_wallet\_address, v\_wallet),  
        email \= COALESCE(email, v\_email),  
        auth\_provider \= COALESCE(auth\_provider, in\_p\_auth\_provider),  
        wallet\_linked \= COALESCE(wallet\_linked, (v\_wallet IS NOT NULL)),  
        updated\_at \= NOW()  
      WHERE id \= v\_id;  
      RETURN v\_id;  
    END IF;  
  END IF;

  \-- Try wallet next  
  IF v\_wallet IS NOT NULL THEN  
    SELECT id INTO v\_id FROM public.canonical\_users WHERE wallet\_address \= v\_wallet LIMIT 1;  
    IF FOUND THEN  
      UPDATE public.canonical\_users SET  
        canonical\_user\_id \= COALESCE(canonical\_user\_id, v\_canon),  
        email \= COALESCE(email, v\_email),  
        auth\_provider \= COALESCE(auth\_provider, in\_p\_auth\_provider),  
        wallet\_linked \= COALESCE(wallet\_linked, true),  
        updated\_at \= NOW()  
      WHERE id \= v\_id;  
      RETURN v\_id;  
    END IF;  
  END IF;

  \-- Try email last (case-insensitive)  
  IF v\_email IS NOT NULL THEN  
    SELECT id INTO v\_id FROM public.canonical\_users WHERE lower(email) \= v\_email LIMIT 1;  
    IF FOUND THEN  
      UPDATE public.canonical\_users SET  
        canonical\_user\_id \= COALESCE(canonical\_user\_id, v\_canon),  
        wallet\_address \= COALESCE(wallet\_address, v\_wallet),  
        base\_wallet\_address \= COALESCE(base\_wallet\_address, v\_wallet),  
        eth\_wallet\_address \= COALESCE(eth\_wallet\_address, v\_wallet),  
        auth\_provider \= COALESCE(auth\_provider, in\_p\_auth\_provider),  
        wallet\_linked \= COALESCE(wallet\_linked, (v\_wallet IS NOT NULL)),  
        updated\_at \= NOW()  
      WHERE id \= v\_id;  
      RETURN v\_id;  
    END IF;  
  END IF;

  \-- Insert new if none found. Enforce canonical id and wallet normalization.  
  INSERT INTO public.canonical\_users (  
    id, canonical\_user\_id, uid, email, wallet\_address, base\_wallet\_address, eth\_wallet\_address, auth\_provider, wallet\_linked  
  ) VALUES (  
    gen\_random\_uuid(), v\_canon, gen\_random\_uuid(), v\_email, v\_wallet, v\_wallet, v\_wallet, in\_p\_auth\_provider, (v\_wallet IS NOT NULL)  
  )  
  ON CONFLICT (canonical\_user\_id) DO UPDATE SET  
    email \= COALESCE(public.canonical\_users.email, EXCLUDED.email),  
    wallet\_address \= COALESCE(public.canonical\_users.wallet\_address, EXCLUDED.wallet\_address),  
    base\_wallet\_address \= COALESCE(public.canonical\_users.base\_wallet\_address, EXCLUDED.base\_wallet\_address),  
    eth\_wallet\_address \= COALESCE(public.canonical\_users.eth\_wallet\_address, EXCLUDED.eth\_wallet\_address),  
    auth\_provider \= COALESCE(public.canonical\_users.auth\_provider, EXCLUDED.auth\_provider),  
    wallet\_linked \= COALESCE(public.canonical\_users.wallet\_linked, EXCLUDED.wallet\_linked),  
    updated\_at \= NOW()  
  RETURNING id INTO v\_id;

  RETURN v\_id;  
END;  
$function$  
"  
util,uuid\_from\_text,p\_input text,p\_input text,uuid,plpgsql,false,s,false,false,null,"CREATE OR REPLACE FUNCTION util.uuid\_from\_text(p\_input text)  
 RETURNS uuid  
 LANGUAGE plpgsql  
 STABLE  
AS $function$  
declare  
  ns uuid := '6ba7b811-9dad-11d1-80b4-00c04fd430c8'; \-- DNS namespace as base  
  hash bytea;  
  bytes bytea;  
begin  
  if p\_input is null or length(p\_input) \= 0 then  
    return null;  
  end if;  
  \-- v5 uuid \= sha1(namespace || name)  
  hash := digest(convert\_to(ns::text || p\_input, 'utf8'), 'sha1');  
  bytes := substring(hash from 1 for 16);  
  \-- set version (0101 for v5) and variant (10xx)  
  bytes := set\_bit(bytes, 52, 1); \-- version bit 52..55 \-\> 0101; set 52 and 54  
  bytes := set\_bit(bytes, 53, 0);  
  bytes := set\_bit(bytes, 54, 1);  
  bytes := set\_bit(bytes, 55, 0);  
  bytes := set\_bit(bytes, 64, 1); \-- variant bits 64..65 \-\> 10  
  bytes := set\_bit(bytes, 65, 0);  
  bytes := set\_bit(bytes, 66, get\_bit(bytes,66));  
  bytes := set\_bit(bytes, 67, get\_bit(bytes,67));  
  return (  
    lpad(to\_hex(get\_byte(bytes,0)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,1)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,2)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,3)),2,'0') || '-' ||  
    lpad(to\_hex(get\_byte(bytes,4)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,5)),2,'0') || '-' ||  
    lpad(to\_hex(get\_byte(bytes,6)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,7)),2,'0') || '-' ||  
    lpad(to\_hex(get\_byte(bytes,8)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,9)),2,'0') || '-' ||  
    lpad(to\_hex(get\_byte(bytes,10)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,11)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,12)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,13)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,14)),2,'0') ||  
    lpad(to\_hex(get\_byte(bytes,15)),2,'0')  
  )::uuid;  
end;  
$function$  
"  
