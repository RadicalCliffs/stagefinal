schema\_name,table\_name,trigger\_name,enabled,trigger\_def,function\_schema,function\_name,function\_def,comment  
public,balance\_ledger,balance\_ledger\_broadcast,O,CREATE TRIGGER balance\_ledger\_broadcast AFTER INSERT OR DELETE OR UPDATE ON balance\_ledger FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,balance\_ledger,balance\_ledger\_broadcast\_trigger,O,CREATE TRIGGER balance\_ledger\_broadcast\_trigger AFTER INSERT OR DELETE OR UPDATE ON balance\_ledger FOR EACH ROW EXECUTE FUNCTION util.broadcast\_table\_changes(),util,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
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
",null  
public,balance\_ledger,trg\_balance\_ledger\_sync\_wallet,O,CREATE TRIGGER trg\_balance\_ledger\_sync\_wallet AFTER INSERT ON balance\_ledger FOR EACH ROW EXECUTE FUNCTION balance\_ledger\_sync\_wallet(),public,balance\_ledger\_sync\_wallet,"CREATE OR REPLACE FUNCTION public.balance\_ledger\_sync\_wallet()  
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
",null  
public,balance\_ledger,trg\_orders\_from\_balance\_ledger,O,CREATE TRIGGER trg\_orders\_from\_balance\_ledger AFTER INSERT ON balance\_ledger FOR EACH ROW EXECUTE FUNCTION \_orders\_from\_balance\_ledger(),public,\_orders\_from\_balance\_ledger,"CREATE OR REPLACE FUNCTION public.\_orders\_from\_balance\_ledger()  
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
",null  
public,canonical\_users,canonical\_users\_broadcast,O,CREATE TRIGGER canonical\_users\_broadcast AFTER INSERT OR DELETE OR UPDATE ON canonical\_users FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,canonical\_users,canonical\_users\_normalize\_before\_write,O,CREATE TRIGGER canonical\_users\_normalize\_before\_write BEFORE INSERT OR UPDATE ON canonical\_users FOR EACH ROW EXECUTE FUNCTION canonical\_users\_normalize\_before\_write(),public,canonical\_users\_normalize\_before\_write,"CREATE OR REPLACE FUNCTION public.canonical\_users\_normalize\_before\_write()  
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
",null  
public,canonical\_users,cu\_normalize\_and\_enforce\_trg,O,CREATE TRIGGER cu\_normalize\_and\_enforce\_trg BEFORE INSERT OR UPDATE ON canonical\_users FOR EACH ROW EXECUTE FUNCTION cu\_normalize\_and\_enforce(),public,cu\_normalize\_and\_enforce,"CREATE OR REPLACE FUNCTION public.cu\_normalize\_and\_enforce()  
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
",null  
public,canonical\_users,tr\_set\_canonical\_user\_id,O,CREATE TRIGGER tr\_set\_canonical\_user\_id BEFORE INSERT OR UPDATE ON canonical\_users FOR EACH ROW EXECUTE FUNCTION set\_canonical\_user\_id\_from\_wallet(),public,set\_canonical\_user\_id\_from\_wallet,"CREATE OR REPLACE FUNCTION public.set\_canonical\_user\_id\_from\_wallet()  
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
",null  
public,canonical\_users,trg\_canonical\_users\_normalize,O,CREATE TRIGGER trg\_canonical\_users\_normalize BEFORE INSERT OR UPDATE ON canonical\_users FOR EACH ROW EXECUTE FUNCTION canonical\_users\_normalize(),public,canonical\_users\_normalize,"CREATE OR REPLACE FUNCTION public.canonical\_users\_normalize()  
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
",null  
public,canonical\_users,trg\_init\_sub\_balance,O,CREATE TRIGGER trg\_init\_sub\_balance AFTER INSERT ON canonical\_users FOR EACH ROW EXECUTE FUNCTION init\_sub\_balance\_after\_canonical\_user(),public,init\_sub\_balance\_after\_canonical\_user,"CREATE OR REPLACE FUNCTION public.init\_sub\_balance\_after\_canonical\_user()  
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
",null  
public,canonical\_users,trg\_provision\_sub\_account\_balance,O,CREATE TRIGGER trg\_provision\_sub\_account\_balance AFTER INSERT ON canonical\_users FOR EACH ROW EXECUTE FUNCTION handle\_canonical\_user\_insert(),public,handle\_canonical\_user\_insert,"CREATE OR REPLACE FUNCTION public.handle\_canonical\_user\_insert()  
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
",null  
public,canonical\_users,update\_canonical\_users\_updated\_at,O,CREATE TRIGGER update\_canonical\_users\_updated\_at BEFORE UPDATE ON canonical\_users FOR EACH ROW EXECUTE FUNCTION update\_updated\_at\_column(),public,update\_updated\_at\_column,"CREATE OR REPLACE FUNCTION public.update\_updated\_at\_column()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN NEW.updated\_at \= NOW(); RETURN NEW; END;  
$function$  
",null  
public,competitions,competitions\_broadcast,O,CREATE TRIGGER competitions\_broadcast AFTER INSERT OR DELETE OR UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,competitions,competitions\_broadcast\_trigger,O,CREATE TRIGGER competitions\_broadcast\_trigger AFTER INSERT OR DELETE OR UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION util.broadcast\_table\_changes(),util,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
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
",null  
public,competitions,competitions\_sync\_num\_winners\_trg,O,CREATE TRIGGER competitions\_sync\_num\_winners\_trg BEFORE INSERT OR UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION competitions\_sync\_num\_winners(),public,competitions\_sync\_num\_winners,"CREATE OR REPLACE FUNCTION public.competitions\_sync\_num\_winners()  
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
",null  
public,competitions,competitions\_sync\_tickets\_sold\_trg,O,CREATE TRIGGER competitions\_sync\_tickets\_sold\_trg BEFORE INSERT OR UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION competitions\_sync\_tickets\_sold(),public,competitions\_sync\_tickets\_sold,"CREATE OR REPLACE FUNCTION public.competitions\_sync\_tickets\_sold()  
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
",null  
public,competitions,update\_competitions\_updated\_at,O,CREATE TRIGGER update\_competitions\_updated\_at BEFORE UPDATE ON competitions FOR EACH ROW EXECUTE FUNCTION update\_updated\_at\_column(),public,update\_updated\_at\_column,"CREATE OR REPLACE FUNCTION public.update\_updated\_at\_column()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN NEW.updated\_at \= NOW(); RETURN NEW; END;  
$function$  
",null  
public,custody\_transactions,trg\_award\_first\_topup\_bonus,O,"CREATE TRIGGER trg\_award\_first\_topup\_bonus AFTER UPDATE ON custody\_transactions FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status AND new.status \= 'completed'::text AND (new.transaction\_type \= ANY (ARRAY\['deposit'::text, 'top\_up'::text\])) AND new.currency \~\~\* 'USD%'::text) EXECUTE FUNCTION award\_first\_topup\_bonus()",public,award\_first\_topup\_bonus,"CREATE OR REPLACE FUNCTION public.award\_first\_topup\_bonus()  
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
",null  
public,email\_auth\_sessions,trg\_email\_auth\_sessions\_verified,O,CREATE TRIGGER trg\_email\_auth\_sessions\_verified AFTER UPDATE ON email\_auth\_sessions FOR EACH ROW WHEN (new.verified\_at IS NOT NULL OR new.used\_at IS NOT NULL) EXECUTE FUNCTION on\_email\_verification\_merge(),public,on\_email\_verification\_merge,"CREATE OR REPLACE FUNCTION public.on\_email\_verification\_merge()  
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
",null  
public,instant\_win\_grids,trigger\_instant\_win\_grids\_updated\_at,O,CREATE TRIGGER trigger\_instant\_win\_grids\_updated\_at BEFORE UPDATE ON instant\_win\_grids FOR EACH ROW EXECUTE FUNCTION update\_instant\_win\_grids\_updated\_at(),public,update\_instant\_win\_grids\_updated\_at,"CREATE OR REPLACE FUNCTION public.update\_instant\_win\_grids\_updated\_at()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
    NEW.updated\_at \= now();  
    RETURN NEW;  
END;  
$function$  
",null  
public,joincompetition,joincompetition\_broadcast,O,CREATE TRIGGER joincompetition\_broadcast AFTER INSERT OR DELETE OR UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,joincompetition,joincompetition\_broadcast\_trigger,O,CREATE TRIGGER joincompetition\_broadcast\_trigger AFTER INSERT OR DELETE OR UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION util.broadcast\_table\_changes(),util,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
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
",null  
public,joincompetition,trg\_joincompetition\_set\_cuid,O,CREATE TRIGGER trg\_joincompetition\_set\_cuid BEFORE INSERT OR UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION util.trg\_set\_cuid\_from\_context(),util,trg\_set\_cuid\_from\_context,"CREATE OR REPLACE FUNCTION util.trg\_set\_cuid\_from\_context()  
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
",null  
public,joincompetition,trg\_joincompetition\_wallet\_bi,O,"CREATE TRIGGER trg\_joincompetition\_wallet\_bi BEFORE INSERT OR UPDATE OF canonical\_user\_id, wallet\_address ON joincompetition FOR EACH ROW EXECUTE FUNCTION joincompetition\_sync\_wallet()",public,joincompetition\_sync\_wallet,"CREATE OR REPLACE FUNCTION public.joincompetition\_sync\_wallet()  
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
",null  
public,joincompetition,trigger\_joincompetition\_updated\_at,O,CREATE TRIGGER trigger\_joincompetition\_updated\_at BEFORE UPDATE ON joincompetition FOR EACH ROW EXECUTE FUNCTION update\_joincompetition\_updated\_at(),public,update\_joincompetition\_updated\_at,"CREATE OR REPLACE FUNCTION public.update\_joincompetition\_updated\_at()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
    NEW.updated\_at \= now();  
    RETURN NEW;  
END;  
$function$  
",null  
public,orders,orders\_broadcast,O,CREATE TRIGGER orders\_broadcast AFTER INSERT OR DELETE OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,orders,trg\_auto\_debit\_on\_balance\_order,O,CREATE TRIGGER trg\_auto\_debit\_on\_balance\_order AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION auto\_debit\_on\_balance\_order(),public,auto\_debit\_on\_balance\_order,"CREATE OR REPLACE FUNCTION public.auto\_debit\_on\_balance\_order()  
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
",null  
public,orders,trg\_orders\_to\_user\_transactions,O,CREATE TRIGGER trg\_orders\_to\_user\_transactions AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders\_to\_user\_transactions(),public,orders\_to\_user\_transactions,"CREATE OR REPLACE FUNCTION public.orders\_to\_user\_transactions()  
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
",null  
public,payment\_webhook\_events,payment\_webhook\_events\_broadcast,O,CREATE TRIGGER payment\_webhook\_events\_broadcast AFTER INSERT OR DELETE OR UPDATE ON payment\_webhook\_events FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,payments,payments\_broadcast,O,CREATE TRIGGER payments\_broadcast AFTER INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payment\_broadcast\_trigger(),public,payment\_broadcast\_trigger,"CREATE OR REPLACE FUNCTION public.payment\_broadcast\_trigger()  
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
",null  
public,payments,payments\_set\_updated\_at,O,CREATE TRIGGER payments\_set\_updated\_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set\_payments\_updated\_at(),public,set\_payments\_updated\_at,"CREATE OR REPLACE FUNCTION public.set\_payments\_updated\_at()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  NEW.updated\_at := now();  
  RETURN NEW;  
END;$function$  
",null  
public,pending\_ticket\_items,trg\_expire\_hold\_on\_write,O,CREATE TRIGGER trg\_expire\_hold\_on\_write BEFORE INSERT OR UPDATE ON pending\_ticket\_items FOR EACH ROW EXECUTE FUNCTION expire\_hold\_if\_needed(),public,expire\_hold\_if\_needed,"CREATE OR REPLACE FUNCTION public.expire\_hold\_if\_needed()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.expires\_at \<= now() AND NEW.status \= 'pending' THEN  
    NEW.status := 'expired';  
  END IF;  
  RETURN NEW;  
END $function$  
",null  
public,pending\_tickets,check\_reservation\_expiry,O,CREATE TRIGGER check\_reservation\_expiry BEFORE INSERT OR UPDATE ON pending\_tickets FOR EACH ROW EXECUTE FUNCTION auto\_expire\_reservations(),public,auto\_expire\_reservations,"CREATE OR REPLACE FUNCTION public.auto\_expire\_reservations()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN  
  IF NEW.expires\_at IS NOT NULL AND NEW.expires\_at \< NOW() AND NEW.status \= 'pending' THEN NEW.status := 'expired'; END IF;  
  RETURN NEW;  
END;  
$function$  
",null  
public,pending\_tickets,pending\_tickets\_broadcast,O,CREATE TRIGGER pending\_tickets\_broadcast AFTER INSERT OR DELETE OR UPDATE ON pending\_tickets FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,pending\_tickets,pending\_tickets\_broadcast\_trigger,O,CREATE TRIGGER pending\_tickets\_broadcast\_trigger AFTER INSERT OR DELETE OR UPDATE ON pending\_tickets FOR EACH ROW EXECUTE FUNCTION util.broadcast\_table\_changes(),util,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
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
",null  
public,pending\_tickets,trg\_confirm\_pending\_tickets,O,CREATE TRIGGER trg\_confirm\_pending\_tickets AFTER UPDATE ON pending\_tickets FOR EACH ROW EXECUTE FUNCTION trg\_fn\_confirm\_pending\_tickets(),public,trg\_fn\_confirm\_pending\_tickets,"CREATE OR REPLACE FUNCTION public.trg\_fn\_confirm\_pending\_tickets()  
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
",null  
public,pending\_tickets,trg\_pending\_sync\_joincompetition,O,CREATE TRIGGER trg\_pending\_sync\_joincompetition AFTER INSERT OR UPDATE ON pending\_tickets FOR EACH ROW EXECUTE FUNCTION trg\_sync\_joincompetition\_from\_pending(),public,trg\_sync\_joincompetition\_from\_pending,"CREATE OR REPLACE FUNCTION public.trg\_sync\_joincompetition\_from\_pending()  
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
",null  
public,pending\_tickets,trg\_pending\_tickets\_enforce\_expiry\_biu,O,CREATE TRIGGER trg\_pending\_tickets\_enforce\_expiry\_biu BEFORE INSERT OR UPDATE ON pending\_tickets FOR EACH ROW EXECUTE FUNCTION pending\_tickets\_enforce\_expiry(),public,pending\_tickets\_enforce\_expiry,"CREATE OR REPLACE FUNCTION public.pending\_tickets\_enforce\_expiry()  
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
",null  
public,pending\_tickets,trg\_pending\_tickets\_set\_cuid,O,CREATE TRIGGER trg\_pending\_tickets\_set\_cuid BEFORE INSERT OR UPDATE ON pending\_tickets FOR EACH ROW EXECUTE FUNCTION util.trg\_set\_cuid\_from\_context(),util,trg\_set\_cuid\_from\_context,"CREATE OR REPLACE FUNCTION util.trg\_set\_cuid\_from\_context()  
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
",null  
public,pending\_tickets,update\_pending\_tickets\_updated\_at,O,CREATE TRIGGER update\_pending\_tickets\_updated\_at BEFORE UPDATE ON pending\_tickets FOR EACH ROW EXECUTE FUNCTION update\_updated\_at\_column(),public,update\_updated\_at\_column,"CREATE OR REPLACE FUNCTION public.update\_updated\_at\_column()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN NEW.updated\_at \= NOW(); RETURN NEW; END;  
$function$  
",null  
public,profiles,trg\_profiles\_after\_upsert,O,CREATE TRIGGER trg\_profiles\_after\_upsert AFTER INSERT OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION call\_profiles\_processor\_async(),public,call\_profiles\_processor\_async,"CREATE OR REPLACE FUNCTION public.call\_profiles\_processor\_async()  
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
",null  
public,reservations,reservations\_broadcast,O,CREATE TRIGGER reservations\_broadcast AFTER INSERT OR DELETE OR UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION reservation\_broadcast\_trigger(),public,reservation\_broadcast\_trigger,"CREATE OR REPLACE FUNCTION public.reservation\_broadcast\_trigger()  
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
",null  
public,sub\_account\_balances,sub\_account\_balances\_award\_insert,O,CREATE TRIGGER sub\_account\_balances\_award\_insert AFTER INSERT ON sub\_account\_balances FOR EACH ROW EXECUTE FUNCTION sub\_account\_bonus\_trigger(),public,sub\_account\_bonus\_trigger,"CREATE OR REPLACE FUNCTION public.sub\_account\_bonus\_trigger()  
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
",null  
public,sub\_account\_balances,sub\_account\_balances\_award\_update,O,CREATE TRIGGER sub\_account\_balances\_award\_update AFTER UPDATE OF available\_balance ON sub\_account\_balances FOR EACH ROW EXECUTE FUNCTION sub\_account\_bonus\_trigger(),public,sub\_account\_bonus\_trigger,"CREATE OR REPLACE FUNCTION public.sub\_account\_bonus\_trigger()  
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
",null  
public,sub\_account\_balances,sub\_account\_balances\_broadcast\_trigger,O,CREATE TRIGGER sub\_account\_balances\_broadcast\_trigger AFTER INSERT OR DELETE OR UPDATE ON sub\_account\_balances FOR EACH ROW EXECUTE FUNCTION util.broadcast\_table\_changes(),util,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
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
",null  
public,sub\_account\_balances,sync\_balance\_to\_canonical\_users,O,CREATE TRIGGER sync\_balance\_to\_canonical\_users AFTER INSERT OR UPDATE OF available\_balance ON sub\_account\_balances FOR EACH ROW EXECUTE FUNCTION sync\_canonical\_user\_balance(),public,sync\_canonical\_user\_balance,"CREATE OR REPLACE FUNCTION public.sync\_canonical\_user\_balance()  
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
",null  
public,sub\_account\_balances,trg\_normalize\_sub\_account\_currency,O,CREATE TRIGGER trg\_normalize\_sub\_account\_currency BEFORE INSERT OR UPDATE ON sub\_account\_balances FOR EACH ROW EXECUTE FUNCTION normalize\_sub\_account\_currency(),public,normalize\_sub\_account\_currency,"CREATE OR REPLACE FUNCTION public.normalize\_sub\_account\_currency()  
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
",null  
public,sub\_account\_balances,trg\_sub\_account\_balances\_sync\_ids,O,CREATE TRIGGER trg\_sub\_account\_balances\_sync\_ids BEFORE INSERT OR UPDATE ON sub\_account\_balances FOR EACH ROW EXECUTE FUNCTION sub\_account\_balances\_sync\_ids(),public,sub\_account\_balances\_sync\_ids,"CREATE OR REPLACE FUNCTION public.sub\_account\_balances\_sync\_ids()  
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
",null  
public,tickets,tickets\_broadcast,O,CREATE TRIGGER tickets\_broadcast AFTER INSERT OR DELETE OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,tickets,tickets\_broadcast\_trigger,O,CREATE TRIGGER tickets\_broadcast\_trigger AFTER INSERT OR DELETE OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION util.broadcast\_table\_changes(),util,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
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
",null  
public,tickets,trg\_bcast\_ticket\_changes,O,CREATE TRIGGER trg\_bcast\_ticket\_changes AFTER INSERT OR DELETE OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION bcast\_ticket\_changes(),public,bcast\_ticket\_changes,"CREATE OR REPLACE FUNCTION public.bcast\_ticket\_changes()  
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
",null  
public,tickets,trg\_check\_sold\_out\_on\_ticket\_insert,O,CREATE TRIGGER trg\_check\_sold\_out\_on\_ticket\_insert AFTER INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION trigger\_check\_competition\_sold\_out(),public,trigger\_check\_competition\_sold\_out,"CREATE OR REPLACE FUNCTION public.trigger\_check\_competition\_sold\_out()  
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
",null  
public,tickets,trg\_tickets\_finalize\_spend,O,"CREATE TRIGGER trg\_tickets\_finalize\_spend AFTER INSERT OR UPDATE OF status, payment\_amount ON tickets FOR EACH ROW EXECUTE FUNCTION tickets\_finalize\_spend\_trigger()",public,tickets\_finalize\_spend\_trigger,"CREATE OR REPLACE FUNCTION public.tickets\_finalize\_spend\_trigger()  
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
",null  
public,tickets,trg\_tickets\_set\_cuid,O,CREATE TRIGGER trg\_tickets\_set\_cuid BEFORE INSERT OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION util.trg\_set\_cuid\_from\_context(),util,trg\_set\_cuid\_from\_context,"CREATE OR REPLACE FUNCTION util.trg\_set\_cuid\_from\_context()  
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
",null  
public,tickets,trg\_tickets\_sync\_joincompetition,O,CREATE TRIGGER trg\_tickets\_sync\_joincompetition AFTER INSERT OR DELETE OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION trg\_sync\_joincompetition\_from\_tickets(),public,trg\_sync\_joincompetition\_from\_tickets,"CREATE OR REPLACE FUNCTION public.trg\_sync\_joincompetition\_from\_tickets()  
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
",null  
public,tickets,trg\_tickets\_txid\_fill,O,CREATE TRIGGER trg\_tickets\_txid\_fill BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION tickets\_tx\_id\_fill(),public,tickets\_tx\_id\_fill,"CREATE OR REPLACE FUNCTION public.tickets\_tx\_id\_fill()  
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
",null  
public,tickets,trg\_tickets\_wallet\_bi,O,"CREATE TRIGGER trg\_tickets\_wallet\_bi BEFORE INSERT OR UPDATE OF canonical\_user\_id, wallet\_address ON tickets FOR EACH ROW EXECUTE FUNCTION tickets\_sync\_wallet()",public,tickets\_sync\_wallet,"CREATE OR REPLACE FUNCTION public.tickets\_sync\_wallet()  
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
",null  
public,user\_transactions,trg\_complete\_topup\_on\_webhook\_ref\_ins,O,CREATE TRIGGER trg\_complete\_topup\_on\_webhook\_ref\_ins BEFORE INSERT ON user\_transactions FOR EACH ROW EXECUTE FUNCTION complete\_topup\_on\_webhook\_ref(),public,complete\_topup\_on\_webhook\_ref,"CREATE OR REPLACE FUNCTION public.complete\_topup\_on\_webhook\_ref()  
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
",null  
public,user\_transactions,trg\_complete\_topup\_on\_webhook\_ref\_upd,O,"CREATE TRIGGER trg\_complete\_topup\_on\_webhook\_ref\_upd BEFORE UPDATE OF webhook\_ref, status, provider, type ON user\_transactions FOR EACH ROW EXECUTE FUNCTION complete\_topup\_on\_webhook\_ref()",public,complete\_topup\_on\_webhook\_ref,"CREATE OR REPLACE FUNCTION public.complete\_topup\_on\_webhook\_ref()  
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
",null  
public,user\_transactions,trg\_finalize\_pending\_user\_transactions,O,CREATE TRIGGER trg\_finalize\_pending\_user\_transactions BEFORE INSERT ON user\_transactions FOR EACH ROW EXECUTE FUNCTION util.finalize\_pending\_user\_transactions(),util,finalize\_pending\_user\_transactions,"CREATE OR REPLACE FUNCTION util.finalize\_pending\_user\_transactions()  
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
",null  
public,user\_transactions,trg\_orders\_from\_user\_transactions,O,CREATE TRIGGER trg\_orders\_from\_user\_transactions AFTER INSERT OR UPDATE OF payment\_status ON user\_transactions FOR EACH ROW EXECUTE FUNCTION \_orders\_from\_user\_transactions(),public,\_orders\_from\_user\_transactions,"CREATE OR REPLACE FUNCTION public.\_orders\_from\_user\_transactions()  
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
",null  
public,user\_transactions,trg\_repair\_topup\_provider\_and\_status,O,"CREATE TRIGGER trg\_repair\_topup\_provider\_and\_status BEFORE INSERT OR UPDATE OF posted\_to\_balance, metadata, charge\_id, webhook\_ref ON user\_transactions FOR EACH ROW EXECUTE FUNCTION repair\_topup\_provider\_and\_status()",public,repair\_topup\_provider\_and\_status,"CREATE OR REPLACE FUNCTION public.repair\_topup\_provider\_and\_status()  
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
",null  
public,user\_transactions,trg\_sync\_identity\_user\_tx,O,CREATE TRIGGER trg\_sync\_identity\_user\_tx BEFORE INSERT OR UPDATE ON user\_transactions FOR EACH ROW EXECUTE FUNCTION sync\_identity\_columns(),public,sync\_identity\_columns,"CREATE OR REPLACE FUNCTION public.sync\_identity\_columns()  
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
",Trigger to automatically sync identity columns on user\_transactions inserts/updates  
public,user\_transactions,trg\_user\_transactions\_cdp\_enqueue,O,CREATE TRIGGER trg\_user\_transactions\_cdp\_enqueue AFTER INSERT ON user\_transactions FOR EACH ROW EXECUTE FUNCTION user\_transactions\_cdp\_enqueue(),public,user\_transactions\_cdp\_enqueue,"CREATE OR REPLACE FUNCTION public.user\_transactions\_cdp\_enqueue()  
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
",null  
public,user\_transactions,trg\_user\_transactions\_post\_to\_wallet,O,"CREATE TRIGGER trg\_user\_transactions\_post\_to\_wallet AFTER INSERT OR UPDATE OF status, amount, type ON user\_transactions FOR EACH ROW EXECUTE FUNCTION user\_transactions\_post\_to\_wallet()",public,user\_transactions\_post\_to\_wallet,"CREATE OR REPLACE FUNCTION public.user\_transactions\_post\_to\_wallet()  
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
",null  
public,user\_transactions,trg\_user\_transactions\_set\_cuid,O,CREATE TRIGGER trg\_user\_transactions\_set\_cuid BEFORE INSERT OR UPDATE ON user\_transactions FOR EACH ROW EXECUTE FUNCTION util.trg\_set\_cuid\_from\_context(),util,trg\_set\_cuid\_from\_context,"CREATE OR REPLACE FUNCTION util.trg\_set\_cuid\_from\_context()  
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
",null  
public,user\_transactions,trg\_user\_transactions\_txid\_fill,O,CREATE TRIGGER trg\_user\_transactions\_txid\_fill BEFORE INSERT ON user\_transactions FOR EACH ROW EXECUTE FUNCTION user\_transactions\_tx\_id\_fill(),public,user\_transactions\_tx\_id\_fill,"CREATE OR REPLACE FUNCTION public.user\_transactions\_tx\_id\_fill()  
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
",null  
public,user\_transactions,trg\_user\_transactions\_wallet\_bi,O,"CREATE TRIGGER trg\_user\_transactions\_wallet\_bi BEFORE INSERT OR UPDATE OF canonical\_user\_id, wallet\_address ON user\_transactions FOR EACH ROW EXECUTE FUNCTION user\_transactions\_sync\_wallet()",public,user\_transactions\_sync\_wallet,"CREATE OR REPLACE FUNCTION public.user\_transactions\_sync\_wallet()  
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
",null  
public,user\_transactions,trg\_user\_tx\_autocomplete\_bi,O,CREATE TRIGGER trg\_user\_tx\_autocomplete\_bi BEFORE INSERT ON user\_transactions FOR EACH ROW EXECUTE FUNCTION user\_tx\_autocomplete\_if\_expired(),public,user\_tx\_autocomplete\_if\_expired,"CREATE OR REPLACE FUNCTION public.user\_tx\_autocomplete\_if\_expired()  
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
",null  
public,user\_transactions,trg\_user\_tx\_autocomplete\_bu,O,"CREATE TRIGGER trg\_user\_tx\_autocomplete\_bu BEFORE UPDATE OF expires\_at, status ON user\_transactions FOR EACH ROW EXECUTE FUNCTION user\_tx\_autocomplete\_if\_expired()",public,user\_tx\_autocomplete\_if\_expired,"CREATE OR REPLACE FUNCTION public.user\_tx\_autocomplete\_if\_expired()  
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
",null  
public,user\_transactions,trg\_user\_tx\_before\_insert,O,CREATE TRIGGER trg\_user\_tx\_before\_insert BEFORE INSERT ON user\_transactions FOR EACH ROW EXECUTE FUNCTION user\_tx\_before\_insert(),public,user\_tx\_before\_insert,"CREATE OR REPLACE FUNCTION public.user\_tx\_before\_insert()  
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
",null  
public,user\_transactions,trg\_user\_tx\_guard\_bu,O,CREATE TRIGGER trg\_user\_tx\_guard\_bu BEFORE UPDATE ON user\_transactions FOR EACH ROW EXECUTE FUNCTION user\_tx\_guard\_no\_double\_post(),public,user\_tx\_guard\_no\_double\_post,"CREATE OR REPLACE FUNCTION public.user\_tx\_guard\_no\_double\_post()  
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
",null  
public,user\_transactions,trg\_user\_tx\_post\_ai,O,CREATE TRIGGER trg\_user\_tx\_post\_ai BEFORE INSERT ON user\_transactions FOR EACH ROW EXECUTE FUNCTION post\_user\_transaction\_to\_balance(),public,post\_user\_transaction\_to\_balance,"CREATE OR REPLACE FUNCTION public.post\_user\_transaction\_to\_balance()  
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
",null  
public,user\_transactions,trg\_user\_tx\_post\_au,O,CREATE TRIGGER trg\_user\_tx\_post\_au BEFORE UPDATE OF status ON user\_transactions FOR EACH ROW EXECUTE FUNCTION post\_user\_transaction\_to\_balance(),public,post\_user\_transaction\_to\_balance,"CREATE OR REPLACE FUNCTION public.post\_user\_transaction\_to\_balance()  
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
",null  
public,user\_transactions,update\_user\_transactions\_updated\_at,O,CREATE TRIGGER update\_user\_transactions\_updated\_at BEFORE UPDATE ON user\_transactions FOR EACH ROW EXECUTE FUNCTION update\_updated\_at\_column(),public,update\_updated\_at\_column,"CREATE OR REPLACE FUNCTION public.update\_updated\_at\_column()  
 RETURNS trigger  
 LANGUAGE plpgsql  
AS $function$  
BEGIN NEW.updated\_at \= NOW(); RETURN NEW; END;  
$function$  
",null  
public,user\_transactions,user\_transactions\_broadcast,O,CREATE TRIGGER user\_transactions\_broadcast AFTER INSERT OR DELETE OR UPDATE ON user\_transactions FOR EACH ROW EXECUTE FUNCTION broadcast\_table\_changes(),public,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION public.broadcast\_table\_changes()  
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
",null  
public,user\_transactions,user\_transactions\_broadcast\_trigger,O,CREATE TRIGGER user\_transactions\_broadcast\_trigger AFTER INSERT OR DELETE OR UPDATE ON user\_transactions FOR EACH ROW EXECUTE FUNCTION util.broadcast\_table\_changes(),util,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
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
",null  
public,users,trg\_users\_autolink\_before\_ins,O,CREATE TRIGGER trg\_users\_autolink\_before\_ins BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION users\_autolink\_canonical\_before\_ins(),public,users\_autolink\_canonical\_before\_ins,"CREATE OR REPLACE FUNCTION public.users\_autolink\_canonical\_before\_ins()  
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
",null  
public,users,users\_normalize\_before\_write,O,CREATE TRIGGER users\_normalize\_before\_write BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users\_normalize\_before\_write(),public,users\_normalize\_before\_write,"CREATE OR REPLACE FUNCTION public.users\_normalize\_before\_write()  
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
",null  
public,winners,trg\_bcast\_winner\_changes,O,CREATE TRIGGER trg\_bcast\_winner\_changes AFTER INSERT OR DELETE OR UPDATE ON winners FOR EACH ROW EXECUTE FUNCTION bcast\_winner\_changes(),public,bcast\_winner\_changes,"CREATE OR REPLACE FUNCTION public.bcast\_winner\_changes()  
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
",null  
public,winners,trg\_winners\_wallet\_bi,O,"CREATE TRIGGER trg\_winners\_wallet\_bi BEFORE INSERT OR UPDATE OF user\_id, wallet\_address ON winners FOR EACH ROW EXECUTE FUNCTION winners\_sync\_wallet\_from\_user\_id()",public,winners\_sync\_wallet\_from\_user\_id,"CREATE OR REPLACE FUNCTION public.winners\_sync\_wallet\_from\_user\_id()  
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
",null  
public,winners,winners\_broadcast\_trigger,O,CREATE TRIGGER winners\_broadcast\_trigger AFTER INSERT OR DELETE OR UPDATE ON winners FOR EACH ROW EXECUTE FUNCTION util.broadcast\_table\_changes(),util,broadcast\_table\_changes,"CREATE OR REPLACE FUNCTION util.broadcast\_table\_changes()  
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
",null  
realtime,subscription,tr\_check\_filters,O,CREATE TRIGGER tr\_check\_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription\_check\_filters(),realtime,subscription\_check\_filters,"CREATE OR REPLACE FUNCTION realtime.subscription\_check\_filters()  
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
",null  
