public

Search for a function  
public

Search for a function

Return Type

Security

Create a new function

Name	Arguments	Return type	Security	

\_apply\_wallet\_delta  
p\_canonical\_user\_id text, p\_currency text, p\_delta numeric

TABLE(balance\_before numeric, balance\_after numeric)

Invoker

\_deduct\_sub\_account\_balance  
\_cuid text, \_amount numeric

void

Invoker

\_get\_competition\_price  
p\_competition\_id uuid

TABLE(unit\_price numeric, currency text)

Invoker

\_get\_user\_competition\_entries\_unified  
p\_user\_identifier text

TABLE(id uuid, competition\_id uuid, user\_id text, canonical\_user\_id text, wallet\_address text, ticket\_numbers integer\[\], ticket\_count integer, amount\_paid numeric, currency text, transaction\_hash text, payment\_provider text, entry\_status text, is\_winner boolean, prize\_claimed boolean, created\_at timestamp with time zone, updated\_at timestamp with time zone, competition\_title text, competition\_description text, competition\_image\_url text, competition\_status text, competition\_end\_date timestamp with time zone, competition\_prize\_value numeric, competition\_is\_instant\_win boolean)

Definer

\_insert\_user\_spend\_tx  
\_cuid text, \_amount numeric, \_competition\_id uuid, \_order\_id uuid, \_ticket\_id uuid, \_payment\_provider text, \_wallet\_address text

uuid

Invoker

\_test\_block  
p\_ticket\_count integer DEFAULT 0

void

Invoker

\_ticket\_cuid  
\_user\_id text, \_canonical\_user\_id text, \_wallet\_address text

text

Invoker

\_wallet\_delta\_from\_txn  
tx\_type text, amt numeric

numeric

Invoker

allocate\_lucky\_dip\_tickets\_batch  
p\_user\_id text, p\_competition\_id uuid, p\_count integer, p\_ticket\_price numeric DEFAULT 1, p\_hold\_minutes integer DEFAULT 15, p\_session\_id text DEFAULT NULL::text, p\_excluded\_tickets integer\[\] DEFAULT NULL::integer\[\]

jsonb

Definer

apply\_wallet\_mutation  
p\_canonical\_user\_id text, p\_currency text, p\_amount numeric, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text, p\_top\_up\_tx\_id text DEFAULT NULL::text

TABLE(ledger\_id uuid, canonical\_user\_id text, currency text, amount numeric, balance\_before numeric, balance\_after numeric, available\_balance numeric, top\_up\_tx\_id text)

Definer

armor  
bytea

text

Invoker

armor  
bytea, text\[\], text\[\]

text

Invoker

attach\_identity\_after\_auth  
in\_canonical\_user\_id text, in\_wallet\_address text, in\_email text DEFAULT NULL::text, in\_privy\_user\_id text DEFAULT NULL::text, in\_prior\_payload jsonb DEFAULT NULL::jsonb, in\_base\_wallet\_address text DEFAULT NULL::text, in\_eth\_wallet\_address text DEFAULT NULL::text

jsonb

Definer

auto\_debit\_on\_balance\_order  
–

trigger	  
Invoker

auto\_expire\_reservations  
–

trigger	  
Invoker

award\_first\_topup\_bonus  
–

trigger	  
Definer

award\_first\_topup\_bonus  
p\_canonical\_user\_id text, p\_topup\_amount numeric, p\_bonus\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_provider text DEFAULT 'topup'::text, p\_tx\_ref text DEFAULT NULL::text

TABLE(balance\_before numeric, balance\_after numeric, bonus\_applied boolean, bonus\_amount numeric)

Invoker

award\_first\_topup\_bonus\_via\_webhook  
p\_provider\_event\_id text, p\_preferred\_currency text DEFAULT 'USDC'::text, p\_bonus\_amount numeric DEFAULT NULL::numeric

TABLE(success boolean, bonus\_applied boolean, bonus\_amount numeric, balance\_before numeric, balance\_after numeric, canonical\_user\_id text, credited\_amount numeric, credited\_currency text)

Definer

award\_welcome\_bonus  
p\_wallet text, p\_threshold numeric DEFAULT 3, p\_bonus numeric DEFAULT 100

void

Invoker

award\_welcome\_bonus  
p\_wallet text, p\_threshold numeric DEFAULT 3

void

Invoker

backfill\_competition\_entries  
p\_competition\_id uuid DEFAULT NULL::uuid

void

Invoker

balance\_ledger\_sync\_wallet  
–

trigger	  
Definer

bcast\_ticket\_changes  
–

trigger	  
Definer

bcast\_winner\_changes  
–

trigger	  
Definer

broadcast\_table\_changes  
–

trigger	  
Definer

call\_profiles\_processor\_async  
–

trigger	  
Invoker

canonical\_users\_normalize  
–

trigger	  
Invoker

canonical\_users\_normalize\_before\_write  
–

trigger	  
Invoker

check\_and\_mark\_competition\_sold\_out  
p\_competition\_id uuid

boolean

Definer

check\_and\_mark\_competition\_sold\_out  
p\_competition\_id text

boolean

Definer

check\_balance\_health  
p\_canonical\_user\_id text

jsonb

Definer

check\_database\_health  
–

json

Definer

check\_external\_usdc\_balance  
wallet\_address text

numeric

Definer

check\_first\_deposit\_bonus\_eligibility  
p\_canonical\_user\_id text

jsonb

Definer

check\_ticket\_availability  
p\_competition\_id uuid, p\_ticket\_numbers integer\[\]

TABLE(ticket\_number integer, available boolean)

Invoker

claim\_prize  
p\_competition\_id uuid, p\_user\_wallet\_address text

boolean

Invoker

cleanup\_expired\_holds  
p\_competition\_id uuid

void

Definer

cleanup\_expired\_idempotency  
–

integer

Definer

cleanup\_expired\_pending\_tickets  
–

integer

Definer

cleanup\_expired\_reservations  
–

integer

Invoker

cleanup\_old\_data  
–

void

Definer

cleanup\_orphaned\_pending\_tickets  
–

integer

Definer

cleanup\_stale\_transactions  
–

void

Definer

competitions\_sync\_num\_winners  
–

trigger	  
Invoker

competitions\_sync\_tickets\_sold  
–

trigger	  
Invoker

complete\_topup\_on\_webhook\_ref  
–

trigger	  
Definer

confirm\_payment\_and\_issue\_tickets  
p\_order\_id uuid, p\_payment\_tx\_hash text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text

TABLE(ticket\_id uuid, ticket\_number integer)

Invoker

confirm\_pending\_tickets  
p\_reservation\_id uuid, p\_order\_id uuid, p\_tx\_hash text

boolean

Definer

confirm\_pending\_tickets\_with\_balance  
p\_reservation\_id uuid, p\_canonical\_user\_id text

TABLE(inserted\_ticket\_ids uuid\[\], ticket\_numbers integer\[\], total\_cost numeric, new\_available\_balance numeric, entry\_id uuid)

Definer

confirm\_pending\_to\_sold  
p\_competition\_id text

void

Invoker

confirm\_pending\_to\_sold  
p\_reservation\_id uuid, p\_transaction\_hash text DEFAULT NULL::text, p\_payment\_provider text DEFAULT 'balance'::text, p\_wallet\_address text DEFAULT NULL::text

jsonb

Definer

confirm\_purchase\_by\_ref  
p\_provider text, p\_ref text, p\_amount numeric, p\_currency text, p\_event\_ts timestamp with time zone

void

Invoker

confirm\_ticket\_purchase  
p\_pending\_ticket\_id uuid, p\_payment\_provider text DEFAULT 'balance'::text

jsonb

Definer

confirm\_tickets  
p\_reservation\_id uuid, p\_payment\_id text, p\_provider text, p\_amount numeric

json

Definer

convert\_specific\_deposit  
tx\_id\_param text, usd\_value\_param numeric, wallet\_addr\_param text

text

Definer

count\_sold\_tickets\_for\_competition  
p\_competition\_id uuid

integer

Invoker

create\_entry\_charge  
p\_canonical\_user\_id text, p\_competition\_id uuid, p\_entry\_price numeric, p\_entry\_count integer, p\_payment\_method text, p\_tx\_ref text DEFAULT NULL::text, p\_metadata jsonb DEFAULT '{}'::jsonb

uuid

Invoker

create\_order\_for\_reservation  
p\_pending\_ticket\_id uuid, p\_payment\_provider text, p\_currency text DEFAULT 'USDC'::text

TABLE(order\_id uuid, amount numeric, ticket\_count integer)

Invoker

create\_ticket\_hold  
p\_competition\_id uuid, p\_pending\_ticket\_id uuid, p\_numbers integer\[\], p\_hold\_minutes integer

TABLE(inserted\_numbers integer\[\], conflicting\_numbers integer\[\], expires\_at timestamp with time zone)

Invoker

create\_user\_if\_not\_exists  
p\_canonical\_user\_id text, p\_wallet\_address text, p\_email text DEFAULT NULL::text

uuid

Definer

credit\_balance\_topup  
p\_user\_id text, p\_amount numeric, p\_tx\_ref text, p\_provider text, p\_privy\_user\_id text, p\_wallet\_address text, p\_canonical\_user\_id text, p\_notes text

jsonb

Invoker

credit\_sub\_account\_balance  
p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text

TABLE(success boolean, previous\_balance numeric, new\_balance numeric, error\_message text)

Definer

credit\_sub\_account\_balance  
p\_canonical\_user\_id text, p\_currency text, p\_amount numeric

TABLE(balance\_before numeric, balance\_after numeric)

Definer

credit\_sub\_account\_with\_bonus  
p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text

TABLE(success boolean, previous\_balance numeric, new\_balance numeric, bonus\_amount numeric, bonus\_applied boolean)

Definer

credit\_user\_balance  
p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text

void

Invoker

credit\_user\_balance  
amount numeric, user\_id text

numeric

Definer

crypt  
text, text

text

Invoker

cu\_normalize\_and\_enforce  
–

trigger	  
Invoker

dearmor  
text

bytea

Invoker

debit\_balance\_and\_confirm  
p\_user uuid, p\_competition uuid, p\_amount\_cents integer, p\_pending\_id uuid, p\_payment\_id text, p\_provider text DEFAULT 'balance'::text

jsonb

Definer

debit\_balance\_and\_confirm  
p\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_pending\_id uuid, p\_ticket\_count integer, p\_tx\_ref text, p\_provider text DEFAULT 'balance'::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text

jsonb

Invoker

debit\_balance\_and\_confirm\_tickets  
p\_canonical\_user\_id text, p\_order\_id uuid, p\_competition\_id uuid, p\_amount\_usd numeric, p\_tx\_ref text, p\_currency text DEFAULT 'USD'::text

json

Invoker

debit\_balance\_confirm\_tickets  
p\_canonical\_user\_id text, p\_competition\_id uuid, p\_order\_id uuid, p\_amount numeric, p\_tx\_ref text, p\_currency text

json

Definer

debit\_sub\_account\_balance  
p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference\_id text DEFAULT NULL::text, p\_description text DEFAULT NULL::text

TABLE(success boolean, previous\_balance numeric, new\_balance numeric, error\_message text)

Definer

debit\_sub\_account\_balance\_with\_entry  
p\_canonical\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_ticket\_count integer, p\_ticket\_numbers text DEFAULT ''::text, p\_transaction\_id text DEFAULT NULL::text

jsonb

Definer

debit\_user\_balance  
p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text

boolean

Invoker

debit\_user\_balance  
amount numeric, user\_id text

numeric

Definer

decrypt  
bytea, bytea, text

bytea

Invoker

decrypt\_iv  
bytea, bytea, bytea, text

bytea

Invoker

digest  
text, text

bytea

Invoker

digest  
bytea, text

bytea

Invoker

encrypt  
bytea, bytea, text

bytea

Invoker

encrypt\_iv  
bytea, bytea, bytea, text

bytea

Invoker

end\_competition\_and\_select\_winners  
p\_competition\_id uuid, p\_vrf\_seed text DEFAULT NULL::text

TABLE(winner\_user\_ids uuid\[\])

Invoker

enqueue\_cdp\_event  
event\_name text, payload jsonb

uuid

Definer

ensure\_canonical\_user  
p\_email text, p\_wallet text

canonical\_users

Invoker

ensure\_canonical\_user  
p\_email text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_username text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text

canonical\_users

Definer

ensure\_index  
sql text

void

Definer

ensure\_pending\_tickets  
–

void

Definer

ensure\_sub\_account\_balance\_row  
p\_canonical text, p\_currency text

uuid

Invoker

enter\_competition  
p\_canonical\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_price numeric

TABLE(ticket\_id uuid, ticket\_number integer, new\_balance numeric)

Definer

enter\_competition\_and\_deduct  
p\_competition\_id uuid, p\_canonical\_user\_id text, p\_quantity integer

TABLE(sold\_count integer, charged\_amount numeric, new\_balance numeric, ticket\_numbers integer\[\])

Definer

exec\_sql  
sql\_query text

json

Definer

execute\_balance\_payment  
p\_amount numeric, p\_competition\_id uuid, p\_idempotency\_key text, p\_reservation\_id uuid, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_user\_identifier text

jsonb

Definer

execute\_balance\_payment\_force  
p\_user\_id text, p\_competition\_id uuid, p\_amount numeric, p\_ticket\_count integer, p\_selected\_tickets integer\[\] DEFAULT NULL::integer\[\], p\_idempotency\_key text DEFAULT NULL::text

jsonb

Invoker

expire\_hold\_if\_needed  
–

trigger	  
Invoker

expire\_overdue\_pending\_tickets  
–

integer

Invoker

finalize\_order  
p\_reservation\_id uuid, p\_user\_id text, p\_competition\_id uuid, p\_unit\_price numeric

jsonb

Definer

finalize\_purchase  
p\_reservation\_id uuid

jsonb

Invoker

finalize\_ticket\_hold  
p\_pending\_ticket\_id uuid

TABLE(success boolean, conflicts integer\[\])

Invoker

gen\_deterministic\_tx\_id  
p\_id uuid, p\_order\_id text, p\_canonical\_user\_id text, p\_wallet\_address text, p\_type text, p\_method text, p\_amount numeric, p\_currency text, p\_created\_at timestamp with time zone

text

Invoker

gen\_random\_bytes  
integer

bytea

Invoker

gen\_random\_uuid  
–

uuid

Invoker

gen\_salt  
text

text

Invoker

gen\_salt  
text, integer

text

Invoker

gen\_ticket\_tx\_id  
p\_id uuid, p\_competition\_id uuid, p\_ticket\_number bigint, p\_canonical\_user\_id text, p\_wallet\_address text, p\_payment\_provider text, p\_payment\_amount numeric, p\_payment\_tx\_hash text, p\_created\_at timestamp with time zone

text

Invoker

get\_active\_competitions\_for\_draw  
–

TABLE(id uuid, onchain\_competition\_id bigint, end\_date timestamp with time zone, status text)

Definer

get\_available\_ticket\_numbers  
p\_competition\_id uuid, p\_limit integer DEFAULT NULL::integer

TABLE(ticket\_number integer)

Invoker

get\_available\_tickets  
p\_competition\_id uuid

integer\[\]

Definer

get\_balance\_by\_any\_id  
p\_user\_id text

numeric

Definer

get\_competition\_availability  
p\_competition\_id uuid, p\_total integer

TABLE(competition\_id uuid, total integer, unavailable integer, available integer)

Invoker

get\_competition\_by\_id  
p\_competition\_id uuid

TABLE(id uuid, title text, total\_tickets integer, ticket\_price numeric, end\_date timestamp with time zone, is\_instant\_win boolean, onchain\_competition\_id bigint, status text, vrf\_tx\_hash text, vrf\_error text, created\_at timestamp with time zone, updated\_at timestamp with time zone)

Definer

get\_competition\_entries  
competition\_id uuid

TABLE(canonical\_user\_id text, wallet\_address text, tickets\_count integer, ticket\_numbers\_csv text, amount\_spent numeric, latest\_purchase\_at timestamp with time zone)

Invoker

get\_competition\_entries  
p\_competition\_id text, p\_limit integer DEFAULT 50, p\_offset integer DEFAULT 0

jsonb

Definer

get\_competition\_entries  
competition\_identifier text

TABLE(uid text, competitionid text, userid text, privy\_user\_id text, numberoftickets integer, ticketnumbers text, amountspent numeric, walletaddress text, username text, chain text, transactionhash text, purchasedate timestamp with time zone, created\_at timestamp with time zone)

Definer

get\_competition\_entries\_bypass\_rls  
competition\_identifier text

TABLE(uid text, competitionid text, userid text, privy\_user\_id text, numberoftickets integer, ticketnumbers text, amountspent numeric, walletaddress text, username text, chain text, transactionhash text, purchasedate timestamp with time zone, created\_at timestamp with time zone)

Definer

get\_competition\_entries\_legacy  
p\_competition\_id uuid

TABLE(canonical\_user\_id text, wallet\_address text, tickets\_count integer, ticket\_numbers\_csv text, amount\_spent numeric, latest\_purchase\_at timestamp with time zone)

Invoker

get\_competition\_sold\_tickets  
p\_competition\_id uuid

TABLE(sold\_count integer, pending\_count integer, total\_tickets integer, available\_count integer)

Definer

get\_competition\_ticket\_availability  
p\_competition\_id uuid

TABLE(competition\_id uuid, total\_tickets integer, sold\_count integer, pending\_count integer, available\_count integer, available\_tickets integer\[\])

Definer

get\_competition\_ticket\_availability\_text  
competition\_id\_text text

json

Definer

get\_competition\_unavailable\_tickets  
p\_competition\_id uuid

TABLE(ticket\_number integer, source text)

Definer

get\_competition\_unavailable\_tickets  
p\_competition\_id text

TABLE(ticket\_number integer, source text)

Definer

get\_comprehensive\_user\_dashboard\_entries  
params jsonb

TABLE(id text, competition\_id text, title text, description text, image text, status text, entry\_type text, is\_winner boolean, ticket\_numbers text, total\_tickets integer, total\_amount\_spent numeric, purchase\_date timestamp with time zone, transaction\_hash text, is\_instant\_win boolean, prize\_value numeric, competition\_status text, end\_date timestamp with time zone)

Definer

get\_comprehensive\_user\_dashboard\_entries  
p\_user\_identifier text

TABLE(id uuid, competition\_id text, title text, description text, image text, status text, entry\_type text, is\_winner boolean, ticket\_numbers text, total\_tickets integer, total\_amount\_spent numeric, purchase\_date timestamp with time zone, transaction\_hash text, is\_instant\_win boolean, prize\_value numeric, competition\_status text, end\_date timestamp with time zone)

Definer

get\_custody\_wallet\_summary  
p\_user\_id text

TABLE(current\_balance numeric, last\_transaction\_at timestamp with time zone, pending\_transactions integer, total\_deposits numeric, total\_withdrawals numeric, total\_payouts numeric)

Definer

get\_joincompetition\_entries\_for\_competition  
p\_competition\_id uuid

SETOF joincompetition

Invoker

get\_linked\_external\_wallet  
user\_identifier text

text

Invoker

get\_sub\_account\_balance  
p\_canonical\_user\_id text DEFAULT NULL::text, p\_user\_id text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text

TABLE(id uuid, user\_id uuid, currency text, available\_balance numeric, pending\_balance numeric, last\_updated timestamp with time zone, canonical\_user\_id text, privy\_user\_id text, wallet\_address text)

Definer

get\_sub\_account\_balance\_flexible  
p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_currency text DEFAULT 'USD'::text, p\_include\_pending boolean DEFAULT false

numeric

Definer

get\_ticket\_availability  
p\_competition uuid

jsonb

Invoker

get\_unavailable\_ticket\_numbers  
p\_competition uuid

TABLE(ticket\_number integer)

Invoker

get\_unavailable\_tickets  
competition\_id uuid

TABLE(ticket\_number integer)

Invoker

get\_unavailable\_tickets  
p\_competition\_id text

integer\[\]

Definer

get\_unavailable\_tickets\_legacy  
p\_competition\_id uuid

TABLE(ticket\_number integer)

Invoker

get\_user\_active\_tickets  
user\_identifier text

SETOF tickets

Invoker

get\_user\_balance  
user\_identifier uuid, in\_currency text DEFAULT 'USD'::text

TABLE(user\_id text, available\_balance numeric, pending\_balance numeric)

Invoker

get\_user\_balance  
p\_user\_identifier text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text

jsonb

Definer

get\_user\_balance\_by\_canonical\_id  
p\_canonical\_user\_id text

TABLE(canonical\_user\_id text, usdc\_balance numeric, bonus\_balance numeric)

Invoker

get\_user\_by\_wallet  
p\_wallet\_address text

TABLE(id uuid, canonical\_user\_id text, wallet\_address text, usdc\_balance numeric, has\_used\_new\_user\_bonus boolean)

Definer

get\_user\_competition\_entries  
p\_user\_identifier text

TABLE(id uuid, competition\_id uuid, competition\_title text, competition\_description text, competition\_image\_url text, competition\_status text, competition\_end\_date timestamp with time zone, competition\_prize\_value numeric, competition\_is\_instant\_win boolean, ticket\_count integer, ticket\_numbers text, amount\_paid numeric, entry\_status text, is\_winner boolean, created\_at timestamp with time zone, wallet\_address text, transaction\_hash text)

Definer

get\_user\_dashboard\_entries  
p\_canonical\_user\_id text, p\_include\_pending boolean DEFAULT false

jsonb

Invoker

get\_user\_stats  
p\_wallet\_address text

json

Invoker

get\_user\_ticket\_count  
user\_identifier text

integer

Definer

get\_user\_tickets  
user\_identifier text DEFAULT NULL::text, p\_identifier text DEFAULT NULL::text

TABLE(id uuid, competition\_id uuid, ticket\_number integer, user\_id text, canonical\_user\_id text, purchase\_price numeric, purchased\_at timestamp with time zone, is\_winner boolean, created\_at timestamp with time zone)

Definer

get\_user\_tickets\_bypass\_rls  
user\_identifier text

TABLE(id text, competition\_id text, ticket\_number integer, ticket\_numbers text, number\_of\_tickets integer, amount\_spent numeric, purchase\_date timestamp with time zone, wallet\_address text, transaction\_hash text, is\_active boolean)

Definer

get\_user\_tickets\_for\_competition  
competition\_id uuid, user\_id text

TABLE(ticket\_number integer, purchase\_date timestamp with time zone, wallet\_address text, user\_id\_out text, canonical\_user\_id text, transaction\_hash text)

Invoker

get\_user\_tickets\_for\_competition  
p\_user\_id text, p\_competition\_id uuid

TABLE(ticket\_number integer, purchase\_date timestamp with time zone)

Definer

get\_user\_tickets\_for\_competition\_legacy  
p\_competition\_id uuid, p\_user\_id text

TABLE(ticket\_number integer, purchase\_date timestamp with time zone, wallet\_address text, user\_id\_out text, canonical\_user\_id text, transaction\_hash text)

Invoker

get\_user\_transactions  
user\_identifier text

jsonb

Definer

get\_user\_transactions\_bypass\_rls  
user\_identifier text

SETOF user\_transactions

Definer

get\_user\_wallet\_balance  
user\_identifier text

numeric

Definer

get\_user\_wallets  
user\_identifier text

json

Definer

get\_vrf\_history  
p\_competition\_id uuid DEFAULT NULL::uuid, p\_limit integer DEFAULT 50

TABLE(log\_id uuid, competition\_id uuid, source text, function\_name text, numbers\_generated integer\[\], context text, outcome text, security\_level text, vrf\_tx\_hash text, log\_timestamp timestamp with time zone)

Definer

get\_winners\_by\_competition  
p\_competition\_id uuid

TABLE(id uuid, competition\_id uuid, ticket\_id uuid, user\_id uuid, wallet\_address text, prize\_value numeric, prize\_type text, claimed boolean, ticket\_number integer)

Definer

handle\_canonical\_user\_insert  
–

trigger	  
Definer

hmac  
text, text, text

bytea

Invoker

hmac  
bytea, bytea, text

bytea

Invoker

index\_exists  
table\_name text, index\_name text

boolean

Invoker

init\_sub\_balance\_after\_canonical\_user  
–

trigger	  
Invoker

insert\_rng\_log  
p\_timestamp timestamp with time zone, p\_source text, p\_function\_name text, p\_competition\_id uuid, p\_competition\_type text, p\_context text, p\_outcome text, p\_is\_winner boolean DEFAULT false, p\_security\_level text DEFAULT 'MEDIUM'::text

boolean

Definer

is\_uuid  
p text

boolean

Invoker

joincompetition\_sync\_wallet  
–

trigger	  
Invoker

link\_additional\_wallet  
user\_identifier text, p\_wallet\_address text, p\_wallet\_type text DEFAULT 'external'::text, p\_nickname text DEFAULT NULL::text

json

Definer

link\_external\_wallet  
p\_canonical\_user\_id text, p\_external\_wallet text

jsonb

Definer

link\_pending\_reservation\_to\_session  
p\_reservation\_id uuid, p\_session\_id text

void

Definer

log\_confirmation\_incident  
p\_incident\_id text, p\_source text, p\_error\_type text DEFAULT NULL::text, p\_error\_message text DEFAULT NULL::text, p\_error\_stack text DEFAULT NULL::text, p\_request\_context jsonb DEFAULT '{}'::jsonb, p\_env\_context jsonb DEFAULT '{}'::jsonb, p\_function\_context jsonb DEFAULT '{}'::jsonb, p\_severity text DEFAULT 'error'::text, p\_status\_code integer DEFAULT NULL::integer, p\_created\_by text DEFAULT NULL::text

uuid

Definer

log\_system\_event  
p\_level text, p\_message text, p\_context jsonb

uuid

Definer

migrate\_privy\_users  
p\_privy\_wallet\_mapping jsonb

integer

Invoker

migrate\_user\_balance  
p\_old\_id text, p\_new\_id text

void

Definer

move\_pending\_tickets\_atomic  
p\_batch\_limit integer DEFAULT 200

integer

Invoker

normalize\_sub\_account\_currency  
–

trigger	  
Invoker

normalize\_user\_identifier  
input text

uuid

Invoker

notify\_payment\_webhook  
p\_provider text, p\_event\_type text, p\_event\_id text, p\_payload jsonb

uuid

Invoker

on\_email\_verification\_merge  
–

trigger	  
Definer

orders\_to\_user\_transactions  
–

trigger	  
Invoker

pay\_balance\_transaction  
p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_description text DEFAULT NULL::text, p\_order\_id uuid DEFAULT NULL::uuid, p\_competition\_id uuid DEFAULT NULL::uuid

TABLE(transaction\_id uuid, balance\_before numeric, balance\_after numeric)

Definer

payment\_broadcast\_trigger  
–

trigger	  
Definer

pending\_tickets\_before\_ins  
–

trigger	  
Definer

pending\_tickets\_enforce\_expiry  
–

trigger	  
Invoker

pgp\_armor\_headers  
text, OUT key text, OUT value text

SETOF record

Invoker

pgp\_key\_id  
bytea

text

Invoker

pgp\_pub\_decrypt  
bytea, bytea

text

Invoker

pgp\_pub\_decrypt  
bytea, bytea, text

text

Invoker

pgp\_pub\_decrypt  
bytea, bytea, text, text

text

Invoker

pgp\_pub\_decrypt\_bytea  
bytea, bytea

bytea

Invoker

pgp\_pub\_decrypt\_bytea  
bytea, bytea, text

bytea

Invoker

pgp\_pub\_decrypt\_bytea  
bytea, bytea, text, text

bytea

Invoker

pgp\_pub\_encrypt  
text, bytea

bytea

Invoker

pgp\_pub\_encrypt  
text, bytea, text

bytea

Invoker

pgp\_pub\_encrypt\_bytea  
bytea, bytea

bytea

Invoker

pgp\_pub\_encrypt\_bytea  
bytea, bytea, text

bytea

Invoker

pgp\_sym\_decrypt  
bytea, text

text

Invoker

pgp\_sym\_decrypt  
bytea, text, text

text

Invoker

pgp\_sym\_decrypt\_bytea  
bytea, text

bytea

Invoker

pgp\_sym\_decrypt\_bytea  
bytea, text, text

bytea

Invoker

pgp\_sym\_encrypt  
text, text

bytea

Invoker

pgp\_sym\_encrypt  
text, text, text

bytea

Invoker

pgp\_sym\_encrypt\_bytea  
bytea, text

bytea

Invoker

pgp\_sym\_encrypt\_bytea  
bytea, text, text

bytea

Invoker

post\_deposit\_and\_update\_balance  
p\_wallet\_address text, p\_amount numeric, p\_currency text DEFAULT 'USD'::text, p\_reference text DEFAULT NULL::text

TABLE(wallet\_address text, currency text, available\_balance numeric, pending\_balance numeric, last\_updated timestamp with time zone)

Invoker

post\_user\_transaction\_to\_balance  
–

trigger	  
Invoker

process\_pending\_tickets\_batch  
p\_limit integer DEFAULT 1000

integer

Invoker

process\_ticket\_purchase  
p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id uuid, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_user\_id text

jsonb

Definer

process\_ticket\_purchase  
p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text

jsonb

Invoker

process\_ticket\_purchase\_flex  
p\_competition\_id uuid, p\_request\_id text, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text

jsonb

Definer

process\_ticket\_purchase\_safe  
p\_competition\_id uuid, p\_request\_id uuid, p\_reservation\_id text, p\_selected\_tickets integer\[\], p\_ticket\_count integer, p\_ticket\_price numeric, p\_user\_id text

jsonb

Invoker

provision\_sub\_account\_balance  
–

trigger	  
Invoker

purchase\_tickets  
p\_competition\_id uuid, p\_user\_wallet\_address text, p\_user\_email text, p\_ticket\_count integer, p\_payment\_amount numeric, p\_currency text DEFAULT 'USDC'::text

TABLE(ticket\_ids uuid\[\])

Invoker

purchase\_tickets  
p\_user\_wallet\_address text, p\_competition\_id uuid, p\_ticket\_count integer, p\_payment\_amount numeric, p\_currency text DEFAULT 'USDC'::text, p\_user\_email text DEFAULT NULL::text

uuid\[\]

Definer

purchase\_tickets\_with\_balance  
p\_user\_identifier text, p\_competition\_id text, p\_ticket\_price numeric, p\_ticket\_count integer DEFAULT NULL::integer, p\_ticket\_numbers integer\[\] DEFAULT NULL::integer\[\], p\_idempotency\_key text DEFAULT NULL::text

jsonb

Definer

record\_vrf\_callback  
p\_competition\_id uuid, p\_callback\_tx\_hash text, p\_random\_words text\[\], p\_winning\_ticket\_numbers integer\[\], p\_winner\_addresses text\[\], p\_callback\_block\_number bigint DEFAULT NULL::bigint, p\_draw\_seed text DEFAULT NULL::text, p\_raw\_event\_data jsonb DEFAULT '{}'::jsonb

uuid

Definer

release\_reservation  
p\_reservation\_id uuid, p\_user\_id text

jsonb

Definer

repair\_topup\_provider\_and\_status  
–

trigger	  
Definer

reservation\_broadcast\_trigger  
–

trigger	  
Definer

reserve\_competition\_tickets  
p\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_hold\_minutes integer DEFAULT 15

jsonb

Invoker

reserve\_selected\_tickets  
p\_user\_id text, p\_competition\_id uuid, p\_ticket\_numbers integer\[\], p\_ticket\_price numeric DEFAULT 1, p\_hold\_minutes integer DEFAULT 15, p\_session\_id text DEFAULT NULL::text

jsonb

Definer

reserve\_tickets  
p\_competition\_id uuid, p\_wallet\_address text, p\_ticket\_count integer, p\_hold\_minutes integer DEFAULT 15

TABLE(pending\_ticket\_id uuid, expires\_at timestamp with time zone, ticket\_numbers integer\[\])

Invoker

resolve\_canonical\_identity  
p\_id uuid DEFAULT NULL::uuid, p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_username text DEFAULT NULL::text

TABLE(id uuid, canonical\_user\_id text, wallet\_address text, email text, privy\_user\_id text, username text, resolved\_via text)

Invoker

resolve\_canonical\_user\_id  
input\_id text

text

Invoker

resolve\_or\_create\_canonical\_user  
p\_canonical\_user\_id text

canonical\_users

Definer

rpc\_debit\_balance\_for\_order  
p\_order\_id uuid

json

Definer

run\_competition\_entries\_batch  
batch\_limit\_per\_competition integer DEFAULT 100, order\_most\_recent\_first boolean DEFAULT true

json

Invoker

set\_canonical\_user\_id\_from\_wallet  
–

trigger	  
Invoker

set\_payments\_updated\_at  
–

trigger	  
Invoker

set\_primary\_wallet  
user\_identifier text, p\_wallet\_address text

json

Definer

sub\_account\_balances\_sync\_ids  
–

trigger	  
Invoker

sub\_account\_bonus\_trigger  
–

trigger	  
Invoker

sync\_all\_external\_wallet\_balances  
–

TABLE(privy\_user\_id text, wallet\_address text, external\_balance numeric, previous\_internal\_balance numeric, new\_internal\_balance numeric, difference numeric)

Definer

sync\_all\_user\_balances  
–

TABLE(canonical\_user\_id text, old\_balance numeric, new\_balance numeric)

Definer

sync\_canonical\_user\_balance  
–

trigger	  
Definer

sync\_competition\_status\_if\_ended  
p\_competition\_id uuid

boolean

Definer

sync\_completed\_deposits\_to\_usdc  
wallet\_address\_param text DEFAULT NULL::text

TABLE(wallet\_address text, transactions\_processed integer, total\_deposits\_converted numeric, new\_usdc\_balance numeric)

Definer

sync\_external\_wallet\_balances  
privy\_user\_id\_param text

TABLE(user\_wallet\_address text, external\_balance numeric, previous\_internal\_balance numeric, new\_internal\_balance numeric, difference numeric)

Definer

sync\_identity\_columns  
–

trigger	  
Definer

tickets\_finalize\_spend\_trigger  
–

trigger	  
Invoker

tickets\_sync\_wallet  
–

trigger	  
Invoker

tickets\_tx\_id\_fill  
–

trigger	  
Invoker

to\_canonical\_filter  
p\_identifier text

TABLE(canonical\_user\_id text, privy\_user\_id text, wallet\_address text, user\_id uuid)

Invoker

to\_canonical\_user\_id  
p\_input text

text

Invoker

trg\_fn\_confirm\_pending\_tickets  
–

trigger	  
Invoker

trg\_sync\_joincompetition\_from\_pending  
–

trigger	  
Invoker

trg\_sync\_joincompetition\_from\_tickets  
–

trigger	  
Invoker

trigger\_check\_competition\_sold\_out  
–

trigger	  
Definer

unlink\_external\_wallet  
p\_canonical\_user\_id text

jsonb

Definer

unlink\_wallet  
user\_identifier text, p\_wallet\_address text

json

Definer

update\_avatar\_flex  
payload jsonb

jsonb

Invoker

update\_competition\_onchain\_data  
p\_competition\_id uuid, p\_onchain\_competition\_id bigint DEFAULT NULL::bigint, p\_vrf\_tx\_hash text DEFAULT NULL::text, p\_vrf\_error text DEFAULT NULL::text, p\_vrf\_error\_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p\_updated\_at timestamp with time zone DEFAULT now()

boolean

Definer

update\_competition\_status  
p\_competition\_id uuid, p\_status text, p\_updated\_at timestamp with time zone DEFAULT now()

boolean

Definer

update\_custody\_balance  
p\_user\_id text, p\_amount numeric, p\_transaction\_type text, p\_reference\_id text DEFAULT NULL::text

TABLE(success boolean, user\_id text, balance\_before numeric, balance\_after numeric)

Definer

update\_instant\_win\_grids\_updated\_at  
–

trigger	  
Invoker

update\_joincompetition\_updated\_at  
–

trigger	  
Invoker

update\_profile\_flex  
payload jsonb

jsonb

Invoker

update\_updated\_at\_column  
–

trigger	  
Invoker

update\_user\_avatar\_by\_uid  
p\_canonical\_user\_id text, p\_new\_avatar\_url text

void

Invoker

update\_user\_avatar\_by\_uid  
p\_uid uuid, p\_avatar\_url text

void

Definer

update\_user\_profile\_by\_identifier  
user\_identifier text, new\_username text DEFAULT NULL::text, new\_email text DEFAULT NULL::text, new\_telegram\_handle text DEFAULT NULL::text, new\_country text DEFAULT NULL::text, new\_telephone\_number text DEFAULT NULL::text

jsonb

Definer

update\_user\_profile\_by\_identifier  
p\_identifier text, p\_username text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_phone text DEFAULT NULL::text, p\_country text DEFAULT NULL::text

jsonb

Invoker

update\_user\_profile\_by\_identifier  
p\_identifier text, p\_username text DEFAULT NULL::text, p\_email text DEFAULT NULL::text, p\_phone text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_telephone\_number text DEFAULT NULL::text

jsonb

Invoker

update\_wallet\_nickname  
user\_identifier text, p\_wallet\_address text, p\_nickname text

json

Definer

update\_winner\_payout\_status  
p\_winner\_id uuid, p\_claimed boolean DEFAULT NULL::boolean, p\_payout\_status text DEFAULT NULL::text, p\_payout\_error text DEFAULT NULL::text, p\_tx\_hash text DEFAULT NULL::text, p\_payout\_amount text DEFAULT NULL::text, p\_payout\_token text DEFAULT NULL::text, p\_payout\_network text DEFAULT NULL::text, p\_payout\_explorer\_url text DEFAULT NULL::text, p\_payout\_timestamp text DEFAULT NULL::text, p\_updated\_at timestamp with time zone DEFAULT now()

boolean

Definer

upsert\_canonical\_user  
p\_uid text, p\_canonical\_user\_id text, p\_email text DEFAULT NULL::text, p\_username text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_wallet\_linked boolean DEFAULT NULL::boolean

jsonb

Definer

upsert\_canonical\_user\_by\_username  
p\_username text, p\_email text DEFAULT NULL::text, p\_country text DEFAULT NULL::text, p\_canonical\_user\_id text DEFAULT NULL::text, p\_wallet\_address text DEFAULT NULL::text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text, p\_first\_name text DEFAULT NULL::text, p\_last\_name text DEFAULT NULL::text, p\_telegram\_handle text DEFAULT NULL::text, p\_privy\_user\_id text DEFAULT NULL::text, p\_uid uuid DEFAULT NULL::uuid

canonical\_users

Invoker

upsert\_canonical\_user\_with\_wallet  
p\_username text, p\_email text, p\_first\_name text, p\_last\_name text, p\_country text, p\_telegram\_handle text, p\_wallet\_address text, p\_base\_wallet\_address text DEFAULT NULL::text, p\_eth\_wallet\_address text DEFAULT NULL::text, p\_avatar\_url text DEFAULT NULL::text

uuid

Invoker

upsert\_joincompetition\_by\_tx  
p\_tx text

void

Invoker

upsert\_sub\_account\_balance  
p\_canonical\_user\_id text, p\_currency text, p\_available\_balance numeric, p\_pending\_balance numeric

sub\_account\_balances

Invoker

upsert\_sub\_account\_topup  
p\_canonical\_user\_id text, p\_amount numeric, p\_currency text DEFAULT 'USDC'::text

void

Invoker

user\_transactions\_cdp\_enqueue  
–

trigger	  
Definer

user\_transactions\_post\_to\_wallet  
–

trigger	  
Definer

user\_transactions\_sync\_wallet  
–

trigger	  
Invoker

user\_transactions\_tx\_id\_fill  
–

trigger	  
Invoker

user\_tx\_autocomplete\_if\_expired  
–

trigger	  
Invoker

user\_tx\_before\_insert  
–

trigger	  
Invoker

user\_tx\_guard\_no\_double\_post  
–

trigger	  
Invoker

users\_autolink\_canonical\_before\_ins  
–

trigger	  
Definer

users\_normalize\_before\_write  
–

trigger	  
Invoker

uuid\_generate\_v1  
–

uuid

Invoker

uuid\_generate\_v1mc  
–

uuid

Invoker

uuid\_generate\_v3  
namespace uuid, name text

uuid

Invoker

uuid\_generate\_v4  
–

uuid

Invoker

uuid\_generate\_v5  
namespace uuid, name text

uuid

Invoker

uuid\_nil  
–

uuid

Invoker

uuid\_ns\_dns  
–

uuid

Invoker

uuid\_ns\_oid  
–

uuid

Invoker

uuid\_ns\_url  
–

uuid

Invoker

uuid\_ns\_x500  
–

uuid

Invoker

validate\_reservation  
p\_reservation\_id uuid, p\_user\_id text, p\_competition\_id uuid

jsonb

Definer

winners\_sync\_wallet  
–

trigger	  
Invoker

winners\_sync\_wallet\_from\_user\_id  
–

trigger	  
Invoker

Return Type

Security

Create a new function

Name	Arguments	Return type	Security	

\_apply\_wallet\_delta  
p\_canonical\_user\_id text, p\_currency text, p\_delta numeric

TABLE(balance\_before numeric, balance\_after numeric)

Invoker

\_deduct\_sub\_account\_balance  
\_cuid text, \_amount numeric

void

Invoker

\_get\_competition\_price  
p\_competition\_id uuid

TABLE(unit\_price numeric, currency text)

Invoker

\_get\_user\_competition\_entries\_unified  
p\_user\_identifier text

TABLE(id uuid, competition\_id uuid, user\_id text, canonical\_user\_id text, wallet\_address text, ticket\_numbers integer\[\], ticket\_count integer, amount\_paid numeric, currency text, transaction\_hash text, payment\_provider text, entry\_status text, is\_winner boolean, prize\_claimed boolean, created\_at timestamp with time zone, updated\_at timestamp with time zone, competition\_title text, competition\_description text, competition\_image\_url text, competition\_status text, competition\_end\_date timestamp with time zone, competition\_prize\_value numeric, competition\_is\_instant\_win boolean)

Definer

\_insert\_user\_spend\_tx  
\_cuid text, \_amount numeric, \_competition\_id uuid, \_order\_id uuid, \_ticket\_id uuid, \_payment\_provider text, \_wallet\_address text

uuid

Invoker

\_test\_block  
p\_ticket\_count integer DEFAULT 0

void

Invoker

\_ticket\_cuid  
\_user\_id text, \_canonical\_user\_id text, \_wallet\_address text

text

Invoker

\_wallet\_delta\_from\_txn  
tx\_type text, amt numeric

numeric

Invoker

