

| Table | Columns | Name |  |
| :---- | :---- | :---- | :---- |
| \_entries\_progress | competition\_id, canonical\_user\_id | \_entries\_progress\_pkey | View definition |
| \_payment\_settings | key | \_payment\_settings\_pkey | View definition |
| admin\_sessions | id | admin\_sessions\_pkey | View definition |
| admin\_sessions | token | admin\_sessions\_token\_key | View definition |
| admin\_users\_audit | id | admin\_users\_audit\_pkey | View definition |
| admin\_users | email | admin\_users\_email\_key | View definition |
| admin\_users | id | admin\_users\_pkey | View definition |
| balance\_ledger | id | balance\_ledger\_pkey | View definition |
| balance\_ledger | reference\_id | balance\_ledger\_reference\_unique | View definition |
| bonus\_award\_audit | id | bonus\_award\_audit\_pkey | View definition |
| canonical\_users | base\_wallet\_address | canonical\_users\_base\_wallet\_address\_key | View definition |
| canonical\_users | canonical\_user\_id | canonical\_users\_canonical\_user\_id\_key | View definition |
| canonical\_users | email | canonical\_users\_email\_key | View definition |
| canonical\_users | eth\_wallet\_address | canonical\_users\_eth\_wallet\_address\_key | View definition |
| canonical\_users | id | canonical\_users\_pkey | View definition |
| canonical\_users | uid | canonical\_users\_uid\_key | View definition |
| canonical\_users | wallet\_address | canonical\_users\_wallet\_address\_key | View definition |
| cdp\_event\_queue | id | cdp\_event\_queue\_pkey | View definition |
| enqueue\_cdp\_event | id | cdp\_outbox\_pkey | View definition |
| competition\_entries | id | competition\_entries\_pkey | View definition |
| competition\_entries | canonical\_user\_id, competition\_id | competition\_entries\_unique | View definition |
| competitions | id | competitions\_pkey | View definition |
| confirmation\_incident\_log | id | confirmation\_incident\_log\_pkey | View definition |
| custody\_transactions | id | custody\_transactions\_pkey | View definition |
| email\_auth\_sessions | id | email\_auth\_sessions\_pkey | View definition |
| faqs | id | faqs\_pkey | View definition |
| hero\_competitions | id | hero\_competitions\_pkey | View definition |
| balance\_ledger | canonical\_user\_id | idx\_balance\_ledger\_canonical | View definition |
| balance\_ledger | canonical\_user\_id, created\_at | idx\_balance\_ledger\_user\_created | View definition |
| canonical\_users | canonical\_user\_id | idx\_canonical\_users\_canonical\_id | View definition |
| canonical\_users | privy\_user\_id | idx\_canonical\_users\_privy\_user\_id | View definition |
| canonical\_users | wallet\_address | idx\_canonical\_users\_wallet | View definition |
| competition\_entries | canonical\_user\_id, competition\_id | idx\_comp\_entries\_user\_comp | View definition |
| competition\_entries | competition\_id, canonical\_user\_id | idx\_competition\_entries\_unique | View definition |
| competition\_entries | canonical\_user\_id, competition\_id | idx\_competition\_entries\_user\_comp | View definition |
| competitions | end\_date | idx\_competitions\_end\_date | View definition |
| competitions | status | idx\_competitions\_status | View definition |
| competitions | status, start\_time, end\_time | idx\_competitions\_status\_dates | View definition |
| competitions | vrf\_completed\_at | idx\_competitions\_vrf\_completed\_at | View definition |
| competitions | vrf\_draw\_requested\_at | idx\_competitions\_vrf\_draw\_requested\_at | View definition |
| canonical\_users | wallet\_address | idx\_cu\_wallet | View definition |
| custody\_transactions | canonical\_user\_id | idx\_custody\_transactions\_canonical | View definition |
| custody\_transactions | status | idx\_custody\_transactions\_status | View definition |
| custody\_transactions | user\_id, status, transaction\_type, created\_at | idx\_custody\_tx\_user\_status\_type\_created | View definition |
| email\_auth\_sessions | email | idx\_email\_auth\_sessions\_email | View definition |
| hero\_competitions | competition\_id | idx\_hero\_competitions\_competition\_id | View definition |
| Prize\_Instantprizes | competitionId, winningTicket | idx\_instant\_prizes\_winning\_ticket | View definition |
| instant\_win\_grids | competition\_id | idx\_instant\_win\_grids\_competition\_id | View definition |
| instant\_win\_grids | is\_active | idx\_instant\_win\_grids\_is\_active | View definition |
| joincompetition | canonical\_user\_id | idx\_joincompetition\_canonical\_user\_id | View definition |
| joincompetition | competitionid | idx\_joincompetition\_comp | View definition |
| joincompetition | competitionid, userid, canonical\_user\_id, wallet\_address | idx\_joincompetition\_comp\_user\_wallet | View definition |
| joincompetition | competitionid | idx\_joincompetition\_competitionid | View definition |
| joincompetition | competitionid | idx\_joincompetition\_competitionid\_tickets | View definition |
| joincompetition | canonical\_user\_id | idx\_joincompetition\_cuid | View definition |
| joincompetition | privy\_user\_id | idx\_joincompetition\_privy\_user\_id | View definition |
| joincompetition | purchasedate | idx\_joincompetition\_purchasedate | View definition |
| joincompetition | transactionhash | idx\_joincompetition\_transactionhash | View definition |
| joincompetition | canonical\_user\_id, competitionid | idx\_joincompetition\_user\_comp | View definition |
| joincompetition | userid | idx\_joincompetition\_userid | View definition |
| joincompetition | wallet\_address | idx\_joincompetition\_wallet | View definition |
| joincompetition | wallet\_address | idx\_joincompetition\_wallet\_address | View definition |
| joincompetition | (expression) | idx\_joincompetition\_walletaddress\_lower | View definition |
| joined\_competitions | canonical\_user\_id | idx\_joined\_competitions\_canonical | View definition |
| joined\_competitions | competition\_id | idx\_joined\_competitions\_competition\_id | View definition |
| balance\_ledger | canonical\_user\_id, created\_at | idx\_ledger\_user\_created | View definition |
| notifications | canonical\_user\_id | idx\_notifications\_cuid | View definition |
| notifications | user\_id, read | idx\_notifications\_read | View definition |
| participants | canonical\_user\_id | idx\_participants\_canonical | View definition |
| participants | competition\_id | idx\_participants\_competition\_id | View definition |
| payment\_idempotency | idempotency\_key | idx\_payment\_idempotency\_key | View definition |
| payment\_webhook\_events | created\_at | idx\_payment\_webhook\_events\_created\_at | View definition |
| payments | idempotency\_key | idx\_payments\_idem | View definition |
| payments | reservation\_id | idx\_payments\_reservation | View definition |
| pending\_ticket\_items | competition\_id, ticket\_number | idx\_pending\_items\_competition\_ticket | View definition |
| pending\_ticket\_items | pending\_ticket\_id | idx\_pending\_items\_pending | View definition |
| pending\_ticket\_items | pending\_ticket\_id | idx\_pending\_ticket\_items\_header | View definition |
| pending\_tickets | competition\_id, expires\_at | idx\_pending\_tickets\_active\_partial | View definition |
| pending\_tickets | canonical\_user\_id | idx\_pending\_tickets\_canonical\_user\_id | View definition |
| pending\_tickets | competition\_id | idx\_pending\_tickets\_comp\_id | View definition |
| pending\_tickets | competition\_id, status | idx\_pending\_tickets\_comp\_status | View definition |
| pending\_tickets | competition\_id, status, expires\_at | idx\_pending\_tickets\_comp\_status\_exp | View definition |
| pending\_tickets | competition\_id, status, user\_id | idx\_pending\_tickets\_comp\_status\_user | View definition |
| pending\_tickets | competition\_id, user\_id, canonical\_user\_id | idx\_pending\_tickets\_comp\_user | View definition |
| pending\_tickets | competition\_id | idx\_pending\_tickets\_competition | View definition |
| pending\_tickets | expires\_at | idx\_pending\_tickets\_expires | View definition |
| pending\_tickets | canonical\_user\_id, user\_id | idx\_pending\_tickets\_identifiers | View definition |
| pending\_tickets | (expression) | idx\_pending\_tickets\_privy | View definition |
| pending\_tickets | reservation\_id | idx\_pending\_tickets\_reservation | View definition |
| pending\_tickets | status | idx\_pending\_tickets\_status | View definition |
| pending\_tickets | status, expires\_at | idx\_pending\_tickets\_status\_expires | View definition |
| pending\_tickets | (expression) | idx\_pending\_tickets\_wallet\_lower | View definition |
| profiles | canonical\_user\_id | idx\_profiles\_canonical\_user\_id | View definition |
| pending\_ticket\_items | status, expires\_at | idx\_pti\_pending\_not\_exp | View definition |
| payment\_webhook\_events | received\_at | idx\_pwe\_received\_time | View definition |
| rng\_logs | competition\_id | idx\_rng\_logs\_competition\_id | View definition |
| rng\_logs | competition\_type | idx\_rng\_logs\_competition\_type | View definition |
| rng\_logs | is\_winner | idx\_rng\_logs\_is\_winner | View definition |
| rng\_logs | outcome | idx\_rng\_logs\_outcome | View definition |
| rng\_logs | timestamp | idx\_rng\_logs\_timestamp | View definition |
| sub\_account\_balances | canonical\_user\_id | idx\_sub\_account\_balances\_canonical | View definition |
| sub\_account\_balances | currency | idx\_sub\_account\_balances\_currency | View definition |
| sub\_account\_balances | privy\_user\_id | idx\_sub\_account\_balances\_privy\_user\_id | View definition |
| sub\_account\_balances | user\_id | idx\_sub\_account\_balances\_user\_id | View definition |
| sub\_account\_balances | wallet\_address | idx\_sub\_account\_balances\_wallet\_address | View definition |
| sub\_account\_balances | wallet\_address, currency, last\_updated | idx\_sub\_bal\_wallet\_currency | View definition |
| sub\_account\_balances | canonical\_user\_id, currency | idx\_sub\_balances\_cuid\_currency | View definition |
| tickets | canonical\_user\_id | idx\_tickets\_canonical\_user | View definition |
| tickets | canonical\_user\_id | idx\_tickets\_canonical\_user\_id | View definition |
| tickets | competition\_id, status, is\_active | idx\_tickets\_comp\_status\_active | View definition |
| tickets | competition\_id, ticket\_number | idx\_tickets\_comp\_ticket | View definition |
| tickets | competition\_id | idx\_tickets\_competition | View definition |
| tickets | competition\_id, status, ticket\_number | idx\_tickets\_competition\_status\_tn | View definition |
| tickets | canonical\_user\_id, purchased\_at | idx\_tickets\_cuid\_purchased\_at | View definition |
| tickets | purchased\_at | idx\_tickets\_purchased\_at | View definition |
| tickets | status | idx\_tickets\_status | View definition |
| tickets | canonical\_user\_id, competition\_id | idx\_tickets\_user\_comp | View definition |
| tickets | (expression) | idx\_tickets\_user\_id\_lower | View definition |
| tickets | wallet\_address | idx\_tickets\_wallet | View definition |
| user\_notifications | user\_id | idx\_user\_notifications\_user\_id | View definition |
| user\_transactions | canonical\_user\_id | idx\_user\_transactions\_canonical | View definition |
| user\_transactions | competition\_id | idx\_user\_transactions\_competition\_id | View definition |
| user\_transactions | created\_at | idx\_user\_transactions\_created\_at | View definition |
| user\_transactions | canonical\_user\_id, user\_id, user\_privy\_id | idx\_user\_transactions\_identifiers | View definition |
| user\_transactions | status | idx\_user\_transactions\_status | View definition |
| user\_transactions | tx\_id | idx\_user\_transactions\_tx\_id | View definition |
| user\_transactions | type | idx\_user\_transactions\_type | View definition |
| user\_transactions | type, tx\_id | idx\_user\_transactions\_type\_txid | View definition |
| user\_transactions | user\_id | idx\_user\_transactions\_user | View definition |
| user\_transactions | canonical\_user\_id, competition\_id | idx\_user\_transactions\_user\_comp | View definition |
| user\_transactions | wallet\_address | idx\_user\_transactions\_wallet | View definition |
| user\_transactions | canonical\_user\_id, created\_at | idx\_user\_transactions\_wallet\_credited | View definition |
| user\_transactions | competition\_id, created\_at | idx\_user\_tx\_competition\_completed | View definition |
| user\_transactions | tx\_id | idx\_user\_tx\_topup\_txid\_unique | View definition |
| user\_transactions | canonical\_user\_id, created\_at | idx\_user\_tx\_user\_created | View definition |
| user\_transactions | status, type | idx\_ut\_status\_type | View definition |
| wallet\_balances\_table\_backup | canonical\_user\_id | idx\_wallet\_balances\_canonical | View definition |
| webhook\_logs | status | idx\_webhook\_logs\_status | View definition |
| webhook\_logs | webhook\_type, created\_at | idx\_webhook\_logs\_type\_created | View definition |
| winners | competition\_id | idx\_winners\_competition | View definition |
| instant\_win\_grids | competition\_id | instant\_win\_grids\_competition\_id\_key | View definition |
| instant\_win\_grids | id | instant\_win\_grids\_pkey | View definition |
| internal\_transfers | id | internal\_transfers\_pkey | View definition |
| internal\_transfers | transfer\_id | internal\_transfers\_transfer\_id\_key | View definition |
| joincompetition | id | joincompetition\_pkey | View definition |
| joined\_competitions | id | joined\_competitions\_pkey | View definition |
| notifications | id | notifications\_pkey | View definition |
| order\_tickets | id | order\_tickets\_pkey | View definition |
| orders | id | orders\_pkey | View definition |
| participants | id | participants\_pkey | View definition |
| partners | id | partners\_pkey | View definition |
| payment\_idempotency | idempotency\_key | payment\_idempotency\_idempotency\_key\_key | View definition |
| payment\_idempotency | id | payment\_idempotency\_pkey | View definition |
| payment\_webhook\_events | event\_id | payment\_webhook\_events\_event\_id\_key | View definition |
| payment\_webhook\_events | id | payment\_webhook\_events\_pkey | View definition |
| payments\_jobs | id | payments\_jobs\_pkey | View definition |
| payments | id | payments\_pkey | View definition |
| pending\_ticket\_items | id | pending\_ticket\_items\_pkey | View definition |
| pending\_tickets | id | pending\_tickets\_pkey | View definition |
| platform\_statistics | id | platform\_statistics\_pkey | View definition |
| Prize\_Instantprizes | UID | Prize\_Instantprizes\_pkey | View definition |
| profiles | id | profiles\_pkey | View definition |
| purchase\_idempotency | idempotency\_key | purchase\_idempotency\_idempotency\_key\_key | View definition |
| purchase\_idempotency | id | purchase\_idempotency\_pkey | View definition |
| purchase\_requests | request\_id | purchase\_requests\_pkey | View definition |
| reservations | id | reservations\_pkey | View definition |
| rng\_logs | id | rng\_logs\_pkey | View definition |
| site\_metadata | id | site\_metadata\_pkey | View definition |
| site\_stats | id | site\_stats\_pkey | View definition |
| sub\_account\_balances | id | sub\_account\_balances\_pkey | View definition |
| testimonials | id | testimonials\_pkey | View definition |
| tickets | competition\_id, ticket\_number | tickets\_competition\_id\_ticket\_number\_key | View definition |
| tickets | id | tickets\_pkey | View definition |
| tickets\_sold | competition\_id, ticket\_number | tickets\_sold\_pkey | View definition |
| balance\_ledger | reference\_id | u\_balance\_ledger\_reference\_id | View definition |
| joincompetition | transactionhash, competitionid | uniq\_joincompetition\_tx\_comp | View definition |
| sub\_account\_balances | canonical\_user\_id, currency | uniq\_sub\_account\_balances\_cuid\_currency | View definition |
| canonical\_users | canonical\_user\_id | uq\_canonical\_users\_canonical | View definition |
| pending\_ticket\_items | competition\_id, ticket\_number, expires\_at | uq\_pending\_ticket\_items\_active | View definition |
| sub\_account\_balances | canonical\_user\_id, currency | uq\_sub\_balances\_cuid\_currency | View definition |
| sub\_account\_balances | user\_id, currency | uq\_sub\_balances\_user\_currency | View definition |
| sub\_account\_balances | canonical\_user\_id, currency | uq\_subacct\_can\_user\_currency | View definition |
| user\_notifications | id | user\_notifications\_pkey | View definition |
| user\_transactions | charge\_id | user\_transactions\_charge\_id\_key | View definition |
| user\_transactions | id | user\_transactions\_pkey | View definition |
| user\_transactions | webhook\_ref | user\_transactions\_webhook\_ref\_key | View definition |
| users | email | users\_email\_key | View definition |
| users | id | users\_pkey | View definition |
| users | privy\_id | users\_privy\_id\_key | View definition |
| users | user\_id | users\_user\_id\_key | View definition |
| users | wallet\_address | users\_wallet\_address\_key | View definition |
| competition\_entries | competition\_id, canonical\_user\_id | ux\_comp\_entries\_comp\_user | View definition |
| competition\_entries | competition\_id, canonical\_user\_id | ux\_competition\_entries\_comp\_user | View definition |
| pending\_ticket\_items | competition\_id, ticket\_number | ux\_pending\_pending\_hold | View definition |
| pending\_tickets | reservation\_id | ux\_pending\_tickets\_reservation\_id | View definition |
| wallet\_balances\_table\_backup | canonical\_user\_id | wallet\_balances\_canonical\_user\_id\_key | View definition |
| wallet\_balances\_table\_backup | id | wallet\_balances\_pkey | View definition |
| webhook\_logs | id | webhook\_logs\_pkey | View definition |
| winners | competition\_id, prize\_position | winners\_competition\_prize\_position\_key | View definition |
| winners | id | winners\_pkey | View definition |

