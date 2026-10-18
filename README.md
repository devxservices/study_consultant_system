# Study Visa Consultancy CRM

One platform replacing WhatsApp threads, Excel sheets and scattered folders for
study visa consultancies. It is multi-tenant: many independent consultancies run
on one codebase and one database, each on its own address, under its own brand,
with its data invisible to every other. Five roles share the system and each
sees only what is relevant to them:

| Role                 | Portal      | What they do                                                        |
| -------------------- | ----------- | ------------------------------------------------------------------- |
| **Client** (student) | `/portal`   | Track their case, upload documents, pay, chat with their consultant  |
| **Consultant**       | `/desk`     | Manage assigned clients, verify documents, move cases forward. Accountants and trainers are consultants with a role. |
| **Manager**          | `/overview` | Run the consultancy: every client, the team, finance, its branding and its own domain |
| **Partner**          | `/partner`  | Sub-agents: register students, follow them, see commission and payouts |
| **Platform admin**   | `/admin`    | Onboard consultancies, plans, branding and domains, suspend them     |

**Launching it on a server** so consultancies, staff and students can reach it:
put the project on an Ubuntu server and run `sudo bash deploy/install.sh` - it
installs Docker and everything else, asks for your domain and email settings,
and starts the platform with HTTPS. The step-by-step guide is
[deploy/README.md](deploy/README.md).

---

## Running it

You need **Node 20+**. You do **not** need Postgres, Docker, or an account with
any cloud provider — the app ships with an embedded Postgres for development.

```bash
npm install
npm run build:shared     # the shared domain package both apps import
npm run db:push          # create the schema
npm run db:seed          # 40+ clients across every pipeline stage
npm run dev              # API on :4000, web on :3000
```

`npm run dev` compiles each page the first time you open it, so tabs take
seconds. To use the app at full speed (pages in 0.1-0.4 s), run
`npm run fast` instead: it builds the web app once (about 4 minutes) and
serves the production build. Re-run it after changing web code.

The seed creates two consultancies and a platform admin. Each lives at its own
address - browsers resolve `*.localhost` to your machine, so there is nothing to
configure. Every password is `password123`:

| Address                               | Account                   | Role           |
| ------------------------------------- | ------------------------- | -------------- |
| <http://localhost:3000>               | `manager@consultancy.pk`  | Manager        |
| (Global Study Consultants, "main")    | `ayesha@consultancy.pk`   | Consultant     |
| <http://futurepath.localhost:3000>    | `manager@futurepath.pk`   | Manager        |
| (Future Path Education)               | `sana@futurepath.pk`      | Consultant     |
| <http://admin.localhost:3000>         | `admin@platform.test`     | Platform admin |

The seed also prints a client login for each consultancy. An account only signs
in at its own consultancy's address - that is the point.

In development no email leaves the machine: password resets, invitations and
receipts are written to `.data/outbox` as `.eml` files you can open. To start over:
`npm run db:reset && npm run db:push && npm run db:seed`.

**Already have data?** `npm run db:seed:extras` adds demo data for the newer
modules - the price list, invoices and payments, tasks,
announcements, subscription plans, student profiles and application dates -
without deleting or overwriting anything. Each part only fills what is empty,
so it is safe to run twice.

**Upgrading an existing database** (from before multi-tenancy): `npm run db:push`
moves everything already there into one consultancy, `main`, without losing a
row. Then create a platform admin to manage it:

```bash
npm run admin:create -- --email you@example.com --name "Your Name"
```

With no `--password` (or `ADMIN_PASSWORD`), a random one is generated and
printed once. The same command bootstraps the first admin in production.

> **Stop the API before running `db:push`, `db:seed` or `db:reset`.** The
> embedded development Postgres is a single-writer file. You no longer have to
> remember this — the second process is refused — but it is still the workflow.

The embedded database is guarded by a lock (`.data/pg.lock`), because two
writers do not fail loudly: they corrupt the directory, and the damage only
surfaces on the *next* boot as `RuntimeError: Aborted()` from inside PGlite's
WASM build, long after the command that caused it. Every restart then fails
identically and the only cure is deleting the data.

That was far too easy to trigger by accident — `npm run build` restarts the API
watcher mid-write, and a stray `db:seed` against a live server does the same —
so the first process to open the directory owns it. A second one stops and says
which PID holds the lock. `db:reset` checks the lock without opening the
database at all, since deleting the directory under a running server is the
worst of the three. A lock left by a crashed process is detected by PID and
taken over, so a hard kill never needs manual cleanup.

If a database does get damaged (a power loss mid-write still can), the error
says so in words and names the fix instead of printing a WASM stack trace:

```bash
npm run db:reset && npm run db:push && npm run db:seed
```

All of this is development scaffolding. Set `DATABASE_URL` to a real Postgres
and none of it runs — that server handles concurrency itself.

### Dates and the time zone

"Today" - due dates, overdue fees, paid-until dates, the books' entry dates,
monthly reports - is the server's calendar day in `TZ` (the deployment sets
`Asia/Karachi`), never the UTC date, which in Pakistan is still yesterday until
5 am. The API uses `today()` / `localIsoDate()` from `@crm/shared`, its
Postgres sessions run with `TimeZone=TZ` so `current_date` and date grouping
agree, and the browser's forms default to the user's own day the same way.
Never write `new Date().toISOString().slice(0, 10)` for a day.

---

## Architecture

```
packages/shared     Domain contract: roles, pipeline stages, document types,
                    stage checklists, Zod schemas. Imported by BOTH apps, so
                    the browser and the server can never disagree about rules.

apps/api            NestJS + Drizzle. Owns all authorisation and all data access.
apps/web            Next.js (App Router) + Tailwind v4. Server components only
                    fetch through the API; no direct database access.
```

The browser only ever talks to the web server on its own address. `/api/*` —
including the realtime sockets at `/api/socket.io` — is proxied to the NestJS
server, which keeps the session cookie same-origin: no CORS handling and no
third-party cookies in the browser. Same-origin is also what makes every
consultancy's address work, since each one's session cookie belongs to that
address alone.

---

## Multi-tenancy

Every consultancy is a **tenant**: a row in `tenants`, and a `tenant_id` on
every row it owns — users, consultants, clients, cases, stage history,
documents, comments, messages, notifications and audit entries.

### Which consultancy is this request for?

The address decides the *site*; the signed-in identity decides the *data*.

| Address                        | Site                                             |
| ------------------------------ | ------------------------------------------------ |
| `<slug>.PLATFORM_DOMAIN`       | That consultancy, always                          |
| A verified custom domain       | The consultancy that proved it owns the domain    |
| `ADMIN_HOST`                   | The platform admin site (no consultancy)          |
| Bare `PLATFORM_DOMAIN`         | `DEFAULT_TENANT_SLUG` if set (dev: `main`)        |
| Anything else                  | Nothing — a "not connected" page, no sign-in form |

The web middleware stamps each `/api` request with the host the browser asked
for (`x-tenant-host`, overwriting any value the browser sent). The API uses it
for exactly two things:

1. **Sign-in** checks credentials against that site's accounts only. The same
   email can be two different people in two consultancies; on the wrong site a
   correct password simply does not match.
2. **Every request** checks the session belongs to that site, and refuses it
   otherwise.

It never uses the host to decide what someone may read. Every query is scoped by
`tenant_id` taken from the signed-in user's own database row, re-read on every
request — so even a forged host header gets an attacker nothing they could not
already see with their own session.

### Where isolation is enforced

- **SQL, in one place per resource.** Each service's `scope()` now starts with
  the actor's tenant before any role rule, so a manager's "everything" means
  everything in *their* consultancy. `tenantOf(actor)` throws rather than
  returning null, because a query with no tenant condition would match every
  consultancy.
- **References across the line are refused.** A manager cannot assign a client
  to another consultancy's consultant, or open a case for another
  consultancy's client, by knowing an id.
- **Chat and notifications** inherit it: case access is chat access, the stuck
  case sweep alerts each case's own consultancy's managers only, and a manager
  triggering the sweep by hand sweeps only their consultancy.
- **Files** are stored under `tenants/<id>/…`, so one consultancy's documents
  can be exported, measured or removed on their own.
- **The platform admin belongs to no consultancy** and is refused every
  consultancy-data route. They see consultancies as accounts — branding,
  domains, status, and counts — never the clients inside them.

### Onboarding, branding, domains, suspension

The platform admin works from `/admin`; a consultancy's manager runs its own
branding and domain from **Branding** in `/overview` (the same controls,
always for their own consultancy only).

- **Add a consultancy** with its first manager, in one transaction. A retry
  with the same address is refused, never duplicated. Leave the manager's
  password empty and they are emailed a link to choose their own.
- **Branding**: name, logo (PNG/JPG/WEBP — never SVG, which can carry script),
  one brand colour and contact details. The colour becomes the whole `brand-*`
  ramp at request time, derived in OKLCH, with the button shade clamped so white
  text on it stays readable (≥ 5:1) whatever colour is picked. Every email goes
  out under the consultancy's name, with its contact email as the reply-to.
- **Custom domains** route only after proof of ownership, and are "live" only
  once public DNS also points them here. The card shows the exact records to
  add, named the way DNS providers ask for them:
  - a subdomain (`portal.theirname.com`) needs **one CNAME** to the
    consultancy's own address (`theirname.yourcrm.com`). That single record
    both points it here and proves ownership, because it names this
    consultancy;
  - a root domain (`theirname.com`, which cannot have a CNAME) needs an **A
    record** to the server (`PUBLIC_IP`) **and** the TXT record
    `_crm-verification.<domain> = crm-verification=<token>`.

  "Check now" asks public resolvers (1.1.1.1, 8.8.8.8, then the system's) and
  answers in words: what it found, where the domain leads now, and what is
  missing. `GET /api/tenancy/tls-check?domain=…` answers 200 only for addresses
  the platform serves; Caddy's `on_demand_tls { ask … }` points at it (see
  `deploy/Caddyfile`), so certificates are issued for those and nothing else.
- **Suspend or deactivate** locks everyone in the consultancy out on their next
  click and deletes nothing. Reactivating puts them back exactly as they were.

### Tests

```bash
npm test --workspace @crm/api
```

Boots the real API against a throwaway embedded database holding two
consultancies and attacks each from the other: reading, writing, filtering,
aggregating, cross-referencing, joining chat rooms, marking notifications,
triggering sweeps, and signing in on the wrong site - then does the same for
every module: price list, invoices, the payments ledger, tasks,
announcements, and plan enforcement - and checks the change marker that kept
pages are verified against (a write is news in its own consultancy only,
reading and socket reads with nothing unread are not, clients learn nothing
from it). 34 tests.

A second suite, `security.test.ts`, checks the owner's controls: every
permission refused by the API (not just hidden), changes taking effect on the
next request, the override order, the audit log refusing edits even from SQL,
exports scoped and formula-safe, two-step sign-in, replayed codes, burnt
challenges, single-use recovery codes, the policy gate, resets, and clients
staying inside their own record whatever staff are allowed. 30 tests.

A third, `rate-limit.test.ts`, checks the per-account request ceiling (see
"Running it for many people") without booting the API: the burst, the refill,
that hammering while limited costs nothing extra, that accounts never share a
budget, and that idle accounts are forgotten. 4 tests.

`foundations.test.ts` covers role templates (the layer between a consultancy's
defaults and one person's overrides), the partner role being closed by
default, encrypted storage at rest, the virus-scan gate, Word uploads, and
email delivery to the outbox. 11 tests.

`drive.test.ts` covers the documents drive end to end: folder structure and
auto-filing, classification by file name, duplicate detection, isolation
between consultancies and between consultants, restricted folders and
per-person grants, the review flow with versions and emails, trash and purge,
rename/move/copy/tags/stars/search, bulk actions, renamed downloads and ZIPs,
share links (password lockout, view-only, revoke, access log, wrong host),
resumable chunked uploads, the agency's upload rules, expiry reminders, and
checklist matching. 18 tests.

Each module since has its own suite - `workflows`, `finance`, `commissions`,
`partners`, `courses` and `student-process` (see the module sections below).

`accounts.test.ts` covers getting in and the white label: "Forgot password"
(the same answer for unknown emails, the link only on its own consultancy's
site, single use, only the newest works, expiry, three an hour, nothing for a
switched-off login), every old session ending on a password change or reset
and with "Sign out everywhere else", invitations for a client, a colleague and
a new consultancy's manager, a manager's own branding and domain (refused to
everyone else), the DNS check (a CNAME to the consultancy's own address
connects in one step, ownership without pointing is not live, a CNAME to
another consultancy proves nothing), and the plan code the web app turns into
a plain page. 18 tests.

The full run is 237 tests.

None of the suites touches your development data or `DATABASE_URL`.

### Everything swappable is behind one seam

The stack is deliberately built so that each hosted service can be adopted later
without a rewrite:

| Concern      | Today (local, offline)                | Swap by                                                   |
| ------------ | ------------------------------------- | --------------------------------------------------------- |
| **Database** | Embedded Postgres (PGlite) in `.data/` | Setting `DATABASE_URL`. Same schema, same migrations.      |
| **Auth**     | `LocalAuthProvider` (bcrypt)           | Writing one more `AuthProvider` and changing one binding in `auth.module.ts`. |
| **Storage**  | Local disk under `storage/`, AES-256-GCM encrypted when `STORAGE_ENCRYPTION_KEY` is set (required in production) | Setting `STORAGE_DRIVER=s3` (S3 / R2 / B2 all work); `S3_SSE` / `S3_KMS_KEY_ID` turn on server-side encryption. |
| **Virus scan** | Off (`VIRUS_SCAN=off`)               | `VIRUS_SCAN=clamav` with `CLAMAV_HOST` / `CLAMAV_PORT`. Fails closed: if the scanner is unreachable, the upload is refused. |
| **Email**    | Written as `.eml` files to `MAIL_OUTBOX_DIR` | `MAIL_DRIVER=smtp` with `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`. |
| **SMS / WhatsApp** | Logged only                     | `MESSAGING_DRIVER=twilio` with `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` and `TWILIO_SMS_FROM` / `TWILIO_WHATSAPP_FROM`. |

`apps/api/src/auth/auth-provider.ts` documents the auth seam. No controller,
guard or service deals in passwords — they all deal in an `AuthUser`.

The built-in email-and-password login is production-ready: bcrypt hashes,
two-step verification (TOTP with recovery codes, enforceable per consultancy),
sign-in throttling, sessions bound to their site and re-checked on every
request, "Forgot password" by email, invitations instead of shared passwords,
and every session ending when the password changes. A hosted provider (Clerk,
Auth0, Supabase Auth) or company SSO can still be added behind the seam above.

---

## Security model

Role checks in the browser are **UX only**. The real boundary is the API:

- Every route is authenticated by default (`AuthGuard` is global). An endpoint
  must opt out explicitly with `@Public()`, so a new endpoint cannot be left
  open by forgetting a guard.
- The signed-in user is re-read from the database on **every** request, so a
  deactivated account or a changed role takes effect immediately rather than
  when a token expires.
- Row scoping happens **in SQL**, in one place per resource
  (`ClientsService.scope`, `CasesService.findAccessible`), and starts with the
  consultancy. A consultant asking for another consultant's client by id — or a
  manager asking for another consultancy's — gets a `404`: the API does not even
  confirm the record exists.
- A session is honoured only on the site it was issued for, and a suspended
  consultancy's sessions stop working on their next request.
- Reassigning a client needs the "Reassign clients" permission (managers
  always have it), rejected server-side regardless of what the UI shows.
- **Sessions end with the password.** Changing a password, choosing one from a
  reset link, a manager setting a new one, and "Sign out everywhere else" all
  move `users.sessions_valid_after` forward; a session signed before it is
  refused on its next request. The person who made the change gets a fresh
  session, so they carry on where they are.
- **Getting in without a shared password.** "Forgot password" on any sign-in
  page emails a link (one hour, single use, only the newest works, at most three
  an hour per account, the same answer whether or not the email has an
  account). Staff invite a client from Portal access, a colleague from Team,
  and the platform admin a consultancy's manager: the person gets an email
  (seven days) to choose their own password, and staff see the same link to
  send by WhatsApp. Only a SHA-256 of each link is stored; a link works only on
  its own consultancy's addresses; it never signs anyone in by itself, so
  two-step verification still applies.
- **Writes from another site are refused.** The session cookie is
  `SameSite=Lax`, which stops other sites - but every consultancy's subdomain
  is the same *site* as every other. So a write (anything but GET/HEAD/OPTIONS)
  that carries a session and names another host in its `Origin` header is
  refused with a 403 (`common/cross-site.ts`). Writes with no session (payment
  webhooks, sign-in) and clients that send no `Origin` (scripts, the
  server-side renderer) are unaffected.
- **Students and partners do not learn the consultancy's business.**
  `/tenancy/entitlements` gives them the module list only - not the plan,
  staff and client counts, or whether the consultancy has paid the platform.

Verified against a running server: unauthenticated `/clients` → 401; consultant
fetching another consultant's client by id → 404; consultant attempting a
reassignment → 403; client role sees exactly one client (themselves).

### Permissions

The role decides which portal someone lands in; permissions decide what a
consultant can do inside it. The list lives in one place,
`packages/shared/src/permissions.ts` - 23 permissions in six groups (clients,
applications, documents, messages, money, team and oversight).

- **Three layers, most specific first:** the person's own Allow or Deny, then
  the consultancy's default for consultants (Security → Default permissions),
  then the built-in default. The built-in defaults let a consultant work their
  own clients fully; seeing every client, reassigning, managing staff, the
  audit trail and exports are off until a manager turns them on.
- **Managers are the owners and always have everything.** Nobody - not even
  another manager - can restrict them, so a consultancy can never be locked out
  of its own data. Only managers change permissions, so nobody can grant
  themselves more.
- **The API enforces every one.** Routes declare what they need with
  `@RequirePermission(...)`; the global guard refuses with `403` and
  `code: "PERMISSION_DENIED"`, naming the permission. Services that are reached
  without the guard (the chat socket) call `assertCan`, and the socket re-reads
  the person on every message rather than trusting its handshake.
- **Changes are immediate.** Permissions are resolved as part of loading the
  signed-in user on every request - the next click, not the next sign-in.
- **"See every client"** is the one permission that widens lists: it gives a
  consultant the manager's view of clients, applications, documents,
  conversations and money. Dashboards stay personal.
- **Clients have no permissions.** Their reach is structural - their own
  record, applications, documents, messages and payments - and denying staff a
  permission never takes a client's own actions away.
- The web app hides what someone cannot do (menus, buttons, whole panels), and a
  page they reach anyway says which permission it needs. That is a courtesy;
  the API is the rule. **Preview access** on the permission editor shows the
  result - in words and as the menu they will see - before anything is saved.

### The audit trail

Append-only **in the database**: a trigger refuses `UPDATE`, `DELETE` and
`TRUNCATE` on `audit_log`, from the API, a manager, or a stray script. (The dev
seed wipes it by opting in with `SET LOCAL app.audit_maintenance = 'on'` inside
its own transaction.) Every row carries the IP address and browser it came
from. Recorded:

- sign-ins, sign-outs and **failed sign-ins** (against the consultancy they were
  tried on, with the email);
- **staff opening** a client's record, an application or a document - folded to
  one event per person per record per 15 minutes, so a refresh is not news;
  clients reading their own file are not recorded;
- messages sent (that one was sent, never what it said);
- every document decision, stage move, invoice and payment, as before;
- staff added, passwords reset, **every permission change** (who, whose, which,
  from what to what), the two-step policy, two-step on/off/reset, recovery codes
  used, and every export with its row count.

Managers - and consultants given "See the audit trail" - filter it by kind of
event, person, dates and free text (client, person or IP), and read it as
sentences. Each member's page (Team → the person, also at
`/overview/team/:id/permissions` and `/overview/team/:id/activity`) shows:

- **Permissions**, with an **Access history** underneath: every change made to
  what they can do - permissions, login switched off or on, password resets -
  and which manager made it;
- **Activity**: their sign-ins, records opened, documents opened and messages
  over the last 30 days, then the full timeline of what they did;
- **Sign-in and security**: where they signed in from, failed codes, and every
  two-step change, including resets by a manager.

The Security page lists the latest team and security changes across the
consultancy.

Set `CLIENT_IP_HEADER` to the header your edge proxy sets (e.g. `x-real-ip`);
without it the recorded address is the web server's, which is honest rather
than a header any browser could forge.

### Two-step verification

Authenticator apps (TOTP, RFC 6238), set up from Account settings: scan a QR
code, confirm with a code - nothing is switched on until the code checks out -
then keep ten one-time recovery codes.

- The secret is **encrypted at rest** (AES-256-GCM, `MFA_ENCRYPTION_KEY`);
  recovery codes are stored as SHA-256 hashes and shown once.
- A correct password returns a **5-minute challenge, not a session**; five wrong
  codes burn it. Each accepted code's 30-second window is remembered, so no code
  works twice.
- **Policy per consultancy** (Security page): optional, required for staff, or
  required for everyone. Anyone it covers who has not set it up can do nothing
  but set it up - the API refuses everything else with
  `code: "MFA_SETUP_REQUIRED"` and the web app sends them to `/security/setup`.
  A manager must use it themselves before requiring it of others, so saving the
  policy can never lock them out.
- **Lost phone and codes:** a manager resets a consultant's or client's; the
  platform admin resets a consultancy manager's. Every reset is audited.

### Exports

The Export page (managers, and consultants given "Export data"): CSV for
clients, applications, invoices, payments and the audit trail, optionally for a
date range. A consultant exports only what they could see on screen; money and
the audit trail need their own permissions on top. Cells a spreadsheet would
run as a formula are neutralised, and every export is audited.

---

## Modules

The core - clients, cases, documents, chat, dashboards - is in every plan. On
top of it, four modules a plan can switch on or off; the API refuses a module
the consultancy's plan does not include (the menus hide it too, but that is a
courtesy, not the rule).

### Finance: invoices, payments and the books

`/overview/finance` (managers) and `/desk/finance` (staff with a finance
permission - the seeded **Accountant** role has them) is the accountant's
workspace; consultants keep `/desk/invoices` for their own students; students
see everything they owe under Payments.

**What is billed.** The consultancy's own fees are income. Fees it pays on a
student's behalf and invoices back (an application or visa fee) are
**disbursements**: invoiced and tracked like any line, but booked to
"Disbursements recoverable", never to income. Tuition the student pays the
university directly does not belong here.

- **Fee catalogue** (Finance settings): each package has a kind (service,
  course, application, visa, disbursement) - which decides where it is booked -
  and a default tax.
- **Invoices** (`INV-2026-0001`): lines with quantity, price, a line discount
  and a tax (added on top, or included in the price); a **promotion code** from
  the consultancy's list (percent or amount off, dates, a use limit), shared
  over the lines so tax is charged on what is actually paid; an optional rate to
  the base currency. Lines and total are fixed once issued.
- **Discounts over the consultancy's limit wait for approval** by someone with
  "Approve refunds and discounts" - never whoever gave them. Until then the
  student does not see the invoice and nothing can be paid against it.
- **Installments**: an invoice can be paid in dated parts (set when issuing or
  later), adding up to the total. Payments settle them in date order; each part
  is reminded and charged late fees on its own.
- **Quotes and proforma invoices** (`QUO-…`), priced exactly like invoices. The
  student accepts or declines in the portal; an accepted quote becomes the
  invoice at the quoted prices even if a rate changed since.
- **Credit notes** (`CN-…`) give part of an invoice back without voiding it,
  with their share of the tax. Voiding an invoice needs its payments and credit
  notes voided first.
- **PDFs** of invoices, receipts, quotes and statements carry the consultancy's
  logo, colour, contacts, bank details and terms, are attached to the emails
  the student receives, and download from every page. A student's **statement**
  shows every charge, credit and payment with a running balance.

**How money comes in.**

- Staff record payments (cash, transfer, cheque, card, wallet) into a chosen
  cash, bank or online account; the receipt (`RCT-…`) is emailed with its PDF.
- **Proof of payment**: the student uploads a bank slip or screenshot against an
  invoice. It is filed in their Financial folder and waits under **To verify**;
  someone with "Verify payments" checks it against the bank and either records
  the payment (with the amount and date that actually arrived) or sends it back
  with a reason. A proof can only be decided there, not from the document review.
- **Online payment**: with Stripe switched on (the consultancy's own keys,
  encrypted at rest), the student pays the next installment or the balance on
  Stripe's page; money is recorded only on Stripe's signed webhook, once,
  however many times it arrives. A **test** driver simulates the provider in
  development (refused on a live server). JazzCash and Easypaisa are paid by
  wallet and uploaded as proof until merchant credentials exist.
- **Reminders** go to the student before and after each due date (the
  consultancy's offsets, e.g. 3 days before, on the day, a week late), once per
  date; their consultant hears about late ones. A **late fee** (fixed or a
  percentage, after a grace period) is charged once per late installment as its
  own invoice. Both run from the hourly sweep and are claimed in the database,
  so several API instances never send or charge twice.

**Refunds** are asked for (with a reason, up to what was paid) by someone with
"Request refunds" and approved by someone else with "Approve refunds and
discounts"; only then is money recorded going out (`RFD-…`). A consultancy can
let managers record refunds directly, or require approval for every one.

**The books.** Under the invoices sits a **double-entry journal** that every
money event posts to in the same database transaction as the document itself:
invoices, payments, refunds, credit notes, voids (as reversing entries),
expenses, bills and their payments, bank charges and cash counts (and, in the
next modules, commissions and partner payouts). The database refuses an entry
that does not balance, any change or deletion of a posted entry, and anything
dated inside a closed period. Each entry is in one currency; nothing ever adds
rupees to pounds.

- **Chart of accounts** per consultancy (cash, bank, online, receivables,
  disbursements, payables, sales tax, equity, the income kinds, expense
  headings); renamable, extendable (another bank account, a new heading).
- **Expenses** (`EXP-…`, with the receipt attached) and **bills** (`BIL-…`,
  owed to suppliers and paid later), with reclaimable tax taken off tax payable.
- **Bank reconciliation**: import a statement CSV (column mapping, three date
  formats, signed or split amounts, previewed before import, re-imports
  skipped); each line is matched to its ledger line (likely matches suggested)
  or booked straight from the statement (charges, interest).
- **Cash count**: the drawer counted at the end of the day against the books;
  a difference is booked to "Cash over and short".
- **Period lock**: closing a month stops anything being dated in it; only a
  manager reopens. Manual journal entries (owner's capital, corrections) must
  balance and are reversed, never edited.
- **Reports**: profit and loss, balance sheet, trial balance, receivables
  aging (installment by installment), collections vs dues, revenue by income
  account and month, tax, cash flow and payables - per currency, or converted
  to the base currency at each entry's own rate (entries without a rate are
  counted and left out). Each report states its checks (debits equal credits,
  aging agrees with the receivables account...). CSV downloads, and the journal
  exports as CSV, a Xero manual-journal file or a QuickBooks IIF file.

Migration `0010` backfilled the journal from every existing invoice and
payment (and their voids) and gave each consultancy its chart of accounts; on
a copy of the development data, receivables in the books equal what invoices
say is outstanding to the paisa.

### University commissions

What universities pay the consultancy for the students it sends them. In every
plan. `/overview/universities` and `/overview/commissions` for managers;
`/desk/universities` for all staff and `/desk/commissions` for staff with
**See commissions**. Building the catalogue and agreements needs **Manage
universities**; confirming, claiming and recording money needs **Manage
commissions**; paying staff their share needs **Pay partners**.

- **The catalogue.** Each institution has its country, type, the currency it
  pays in, an aggregator if the consultancy works through one, and its contacts.
  An application chooses its institution from the catalogue and records the
  first-year tuition, any scholarship and the course start - what commission is
  worked out on. Migration `0011` created an institution for every university
  already named on an application (paying in its country's currency) and linked
  those applications to it.
- **Agreements** (with the signed copy attached) run between two dates and hold
  **rules**, first match wins: a percentage of tuition net of scholarship or a
  fixed amount; the first year only or each year for N years; **volume tiers**
  (e.g. 20% from the fifth student); a **bonus** at a number of students; a
  **retention period** inside which a student leaving means a clawback; the step
  at which commission becomes expected (the deposit, by default); and
  conditions on level, country, intake and the rest. Editing the rules makes a
  new version; commission already worked out keeps the terms it was earned
  under.
- **Expected → to claim → claimed → received.** When an application reaches the
  rule's step, its commission is **expected** (one per year of the course for
  each-year rules), dated from the course start plus the agreement's claim
  window and payment terms. While only expected it follows the application: new
  fees or dates re-price and re-date it, and a move to another institution or a
  withdrawal cancels it. **Confirming** (the student enrolled) applies the
  volume tier, books it - Dr commission receivable, Cr commission income, in
  the agreement's currency with its rate to the base currency - and adds the
  bonus when this student reaches the threshold.
- **Claims** (`CLM-…`) gather confirmed commissions for one institution in one
  currency, download as a PDF on the consultancy's letterhead, and once sent
  fall due by the agreement's payment terms. Commissions whose claim window has
  not opened are offered but left unticked. Late claims are chased (the
  consultancy chooses how often), and staff are told when a commission's claim
  window opens.
- **Receipts** (`CRX-…`): money from an institution is matched commission by
  commission (oldest first in one click), net of the bank's charges (booked to
  bank charges), with anything unmatched left as a credit with them. Paid at a
  different rate than it was booked, the difference is a realised exchange gain
  or loss, posted in the base currency so the receivable clears in base-currency
  reports too. A deduction for an earlier clawback is matched as a negative
  amount. Voiding a receipt reverses it and its exchange difference.
- **When it goes wrong**: disputed and settled; written off (a bad debt);
  **clawed back** (the income reversed); cancelled when it was never earned.
  Nothing with money against it can be cancelled.
- **Staff incentives.** Each commission can be shared - by default the
  student's consultant gets the consultancy's chosen percentage. A share is
  owed once the institution has paid in full, paid from a bank or cash account
  (booked to staff incentives), and shown to the person under **My
  incentives**.
- **The dashboard**: totals per currency (never added across currencies), the
  forecast by month, each institution's balance, and the claims to chase.

A notification's link opens the reader's own portal: a consultant who handles
commissions lands on `/desk/commissions/…` even when the link was written for
managers, and the same holds for finance pages.

### Partner consultants

Sub-agents and referral partners who bring students and are paid a share for
it. In every plan. `/overview/partners` for managers; `/desk/partners` for
staff with **See partners**. Approving and changing partners needs **Manage
partners**; anything that moves money to them needs **Pay partners**. Each
partner's people sign in to their own portal at `/partner`.

- **Applying.** A public form at `/partners/apply` on the consultancy's own site
  (a hidden field turns bots away, and submissions are rate-limited) creates
  the partner as *applied* and tells staff. Staff can also add partners
  directly. A sub-agent sits under a master partner, one level deep, and the
  master earns an override on its students.
- **Onboarding.** The partner uploads its registration papers (business
  registration, the owner's ID and a bank letter are required), which staff
  approve or send back with a reason. Staff write the **partner agreement** from
  the consultancy's template and send it; the terms are then frozen and
  fingerprinted (SHA-256). The partner's owner or administrator signs in the
  portal - typing their name or drawing it - and the signature is kept with the
  time, IP address, browser and fingerprint; a signature against terms changed
  after sending is refused. The signed copy downloads as a PDF with a signature
  certificate. A partner becomes **active** only with approved papers, a signed
  agreement and a login; it can be **suspended** (no new students, no payouts)
  or **terminated** (its logins are switched off).
- **The portal** (`/partner`): a dashboard (students, offers, visas, enrolments,
  what it is owed, an estimate of commission still to come, the next tier),
  its students and their applications, documents it uploads for them,
  commissions, payouts with statements, the consultancy's marketing material
  (drive folders shared with partners), messages, the agreement, its team and
  its papers and bank account. Owners and administrators see money and manage
  the team; counsellors work with students. Partner logins are refused
  everything outside the portal - the API is closed to them by default.
- **Who a student belongs to.** A partner registers students in the portal,
  with the student's consent. A student the consultancy already has (the same
  email, phone or passport) is not created again: the first to register keeps
  them and the claim goes to a queue where staff decide, seeing whether the
  first registration has lapsed (older than the attribution window with no live
  application). Staff can also credit a student to a partner from the student's
  page.
- **What partners earn** comes from **versioned rules**: a share of the
  university commission, earned as the university pays it (converted at the
  rate it was received at when the partner is paid in the base currency); a
  fixed amount when a student's enrolment is confirmed; a share of the
  consultancy's own fees the student pays - never of money passed through to
  universities or embassies, and never of tax. The most specific rule applies:
  one partner, then its tier, then everyone. Each earning is booked as it is
  made (Dr partner commission, Cr partner payable). When the money it came from
  is voided or refunded, or the university claws its commission back, an unpaid
  earning is reversed and a paid one is taken back from the next payout.
- **Payouts** gather what a partner is owed in one currency, withhold tax (its
  rate or the consultancy's default), take back any **advance**, and are
  approved by someone other than whoever prepared them before they are paid:
  Dr partner payable, Cr withholding payable, Cr partner advances, Cr the bank.
  Each has a statement PDF, emailed to the partner when it is paid. Voiding one
  reverses it and puts its earnings and the advance back.
- **Performance**: a leaderboard ranked by enrolments over any period, with
  each partner's students, applications, offers, visas, conversion and what it
  earned, and the tier its results reach (tier thresholds are a setting).
- **Announcements** can be addressed to partners only.

Migration `0012` adds the partner tables and the student's partner (nothing to
backfill: no partners existed). Its rollback refuses while any partner exists.

### Courses and test preparation

IELTS, PTE, TOEFL, Duolingo and the rest - or any course of the consultancy's
own (spoken English, interview preparation). In every plan.
`/overview/courses` for managers; `/desk/courses` for staff with **See
courses**, and as **My batches** for trainers (**Teach batches**); students see
theirs at `/portal/courses`. **Manage courses** builds the catalogue and
batches; **Enrol students** enrols the students one works with.

- **The catalogue**: each course has the test it prepares for (which decides
  how its mock tests are scored), level, mode, length, hours, seats and a fee -
  or a course package from the fee catalogue to bill it by (bundles of several
  courses at one price live there).
- **Batches** are runs of a course: dates, the days and times it meets, a room
  or an online link, seats and trainers. Their sessions are made from the
  timetable; a changed timetable redoes the sessions still to come and leaves
  held ones alone. Sessions can be given topics, cancelled, or added (a make-up
  class). A batch starts running on its first day and is finished by hand.
- **Enrolment**: a seat while there is one, else the **waiting list**; a seat
  that frees (a drop, a move, more seats) goes to the first in line, who is
  told. The fees go on one invoice - each course's own, or a bundle's single
  price, with a discount and its reason - booked as **course income** through
  finance. Students can be **moved** to another batch, **paused** (keeping
  their seat; the daily sweep brings them back on the date) or **dropped**.
- **Attendance** session by session by the batch's trainer (present, late,
  absent, excused; a paused student is excused). After the consultancy's number
  of absences in a row, the student's consultant (by email too) and the student
  are told - once per run of absences.
- **Mock tests** are scored part by part on the real scale - IELTS bands 0-9 in
  halves, with the overall the IELTS way (the average rounded to the nearest
  half band, a quarter rounding up); TOEFL sections added up; PTE, Duolingo and
  others' overall entered as they report it - and refused off the scale. Each
  student's scores show as a line against their target.
- **Homework and materials**: trainers set homework (with a file, a due date and
  a mark out of) or share material; students hand it in from the portal (late
  is marked late); trainers mark it or send it back with a reason, and the
  student is told.
- **Official tests**: bookings and results per student. A result updates the
  student's profile, files the score report (TRF) with their documents expiring
  two years after the test (the document expiry reminders then follow it), and
  is checked against the language minimums of the countries the student wants -
  "United Kingdom: overall 6 of 6.5 needed" - from the country settings.
- **Completion**: finishing a batch completes everyone in it; a certificate
  (PDF, numbered) is issued where attendance reached the consultancy's minimum.
- **The report**: per course, batches, enrolments, completions and drops,
  attendance, the average improvement from first to latest mock, how many
  reached their target in the official test, and what was billed.

Migration `0013` adds the course tables and copies the English test scores
already on student profiles into official results (IELTS on a profile is taken
to be Academic), so their expiry and eligibility show from the start.

#### The course student, start to finish

1. **Enquiry.** Taken by staff (Courses → Enquiries → New enquiry) for a
   walk-in, call or message, or sent from the public form at
   `/courses/enquire` on the consultancy's own address. Only a name and phone
   are needed. The same phone never makes a second open enquiry; asking again
   adds to the open one. Website enquiries notify the managers.
2. **Follow-ups.** Each call or note sets the next follow-up date. Whoever has
   the enquiry is reminded once on the day it falls due, and the list puts due
   ones first.
3. **Trial class.** Booked into a real class in the next three weeks. The
   trainer sees the guest on that class's attendance page and marks whether
   they came.
4. **Enrolling.** From the enquiry: their student record is made (marked
   *course only*, unless they also want to study abroad), then the usual
   enrolment - a seat or the waiting list, with the fees on an invoice. An
   enquiry that goes nowhere is closed with the reason, and can be reopened.
5. **In class.** Courses → Students lists everyone across batches (waiting,
   starting soon, in class, paused, completed, dropped) with attendance, latest
   mock and fees (unpaid, part paid, paid, overdue, not billed, from the
   invoice and what has been paid on it), and filters for each.
6. **After the course.** A course-only student stays out of the study-abroad
   pipeline. "Finished, could study abroad" lists those who completed a course;
   handing one over tells their consultant (with their course and official
   score) and opens their first application. Opening an application any other
   way does the same.

Migration `0014` adds the enquiry tables and `clients.programme` (every
existing client is `study_abroad`).

### Tasks and follow-ups

Due time, priority, assignee, linked to a client or case. Overdue ones alert
their assignee once per due date (a 15-minute sweep, safe on several API
instances at once). A consultant can escalate a task to every manager. The
consultant dashboard leads with what is overdue or due today.

### Announcements

A manager posts to clients, staff or everyone, optionally pinned and with an
end date. It shows on the dashboards and rings the bell once.

### Plans

Set by the platform admin at `/admin/plans`: price, which modules are
included, and limits on staff, active clients and document storage. Limits are
enforced where the growth happens (adding a consultant, adding or un-archiving
a client, uploading a document). A consultancy with no plan has every module
and no limits.

### Paying for the platform

What a consultancy can do follows the date it has paid until
(`tenants.current_period_end`, `subscriptionState` in `@crm/shared`):

| Where it stands | What happens |
| --- | --- |
| Paid until a date in the future (or a trial) | Everything works. In the last 7 days managers see "paid until ..." on every screen and get one email. |
| The date has passed, within the grace days (default 7) | Everything still works. Managers see "payment overdue - works until ..." and get one email. |
| Grace days over (or the subscription was cancelled and its paid time is used up) | **Read-only for staff**: they sign in, see and export everything, reply to students, change their own password and two-step settings - every other write is refused (`SUBSCRIPTION_LAPSED`, in `AuthGuard`). Students and partners are not affected: they are the consultancy's customers. Managers get one email. |
| No date at all | Never restricted by date - the behaviour before this existed. |

Suspending a consultancy (the existing status switch) is still the full stop.

- **New consultancies** start on the platform's trial (`trialDays`, default 14)
  unless the admin sets another "Free trial until" date or clears it.
- **Recording a payment** (`/admin/tenants/:id`, "Record a payment") stores it
  in `subscription_payments` with the period it covers and moves the date on:
  from the old date if the payment arrived before the grace days ran out
  (paying early or a little late loses nothing), otherwise from the day it was
  received. The consultancy is open again on its next request, and every
  manager is emailed a receipt. Payments are append-only and audited.
- **Managers** see their plan, usage against its limits, the date paid until,
  the platform's payment instructions and every payment at
  `/overview/subscription`.
- **The platform admin** sees "Renewals to chase" and each consultancy's state
  on `/admin`, and sets the payment instructions, grace days and trial length
  under `/admin/settings`.
- Reminders run in the hourly sweep (`subscription-renewals`); each stage is
  claimed in `tenants.renewal_notice_key` first, so none is sent twice.

There is no card-payment gateway for the platform's own billing: consultancies
pay by bank transfer or wallet and the admin records it.

### Terms and privacy policy

The platform admin writes them under `/admin/settings` (starting templates
are provided, written from what this software stores; they are not legal
advice). Once published they are at `/terms` and `/privacy` on every address,
linked from every sign-in page and under the public course-enquiry and
partner-application forms, and the "Platform setup" checklist stays amber
until both exist.

### Also in every plan

- **Student profile** - date of birth, passport and its expiry (flagged under
  six months, since most visas need that much validity), education and grades,
  English test and score, intended level and subject, preferred countries,
  budget, lead source, emergency contact.
- **Application dates** - application deadline, offer type and conditions,
  offer acceptance deadline, visa appointment, travel date. These feed the
  "Coming up" lists on every dashboard.
- **Portal access** - staff give a client their login (or reset or switch it
  off) from the client's page.
- **Staff management** - a manager (or a consultant given "Manage
  consultants") adjusts a consultant's capacity, resets their password or
  switches their login off - never a manager's login, and never permissions.
  Everyone can change their own password and set up two-step verification under
  Account settings.
- **Dashboards** - money collected and owed, overdue follow-ups, deadlines this
  week, applications by destination with outcomes, and lead sources with their
  conversion rate.

---

## Data model

The parts worth knowing:

- **`clients`** exist before they have a login (`user_id` is nullable) because a
  consultant adds them during the first phone call.
- **Target country/university live on `cases`, not on `clients`**, because one
  client may pursue several countries in parallel.
- **`case_stage_events`** is append-only: one row per stage entered, stamped
  with who moved it and whether it was automatic or a manual override.
- **`documents`** keeps rejected files rather than overwriting them, so the
  audit trail survives a re-upload.
- **`audit_log`** records every document action and stage change with an actor
  and a timestamp, so a dispute months later is settled from data.
- **`tenant_sync`** is one timestamp per consultancy: when anything in it last
  changed. The browser checks pages it kept against it (migration `0006`,
  additive; undo with `DROP TABLE tenant_sync`).

Migrations are generated from `apps/api/src/db/schema.ts`:

```bash
npm run db:generate --workspace @crm/api   # after editing the schema
npm run db:migrate  --workspace @crm/api
```

---

## Performance

```bash
npm run bench --workspace @crm/api                  # seeded data
BENCH_SCALE=25 npm run bench --workspace @crm/api   # 25x the records
BENCH_OUT=run.json npm run bench --workspace @crm/api
```

`apps/api/test/perf.bench.ts` seeds a throwaway embedded database, optionally
multiplies the main consultancy's records, boots the real API in-process and
times 40 endpoints as the manager, a consultant and a client. Every SQL
statement is counted, so "queries per request" is exact. Like the tests, it
never touches your development data.

The milliseconds are for PGlite running inside the API process on whatever
machine ran it: compare runs with each other, taken in the same conditions, and
not with a production server. **A laptop on battery runs the whole table about
three times slower than on mains**, so a before/after pair is only a fair
comparison if both were taken the same way. The query counts do not move.

What the first pass changed, measured before and after (`.bench/`). The
"after" run was taken on battery, so the times below are compared after
dividing by the slowdown of the 33 endpoints whose queries did not change
(2.9x) - estimates, until both runs are repeated on mains. The query counts
need no such correction.

- **One pass through the 40 endpoints: 134 queries, now 122.**
- **Signing a consultant in to a request: 3 queries, now 1.** Their
  consultancy's permission defaults and their own overrides arrive in the query
  that loads the user (`AuthService.loadUser`), so every consultant request is
  two round trips shorter.
- **Deadlines: 6 queries, now 2.** One pass over the live cases instead of five
  scans with the same joins, one per kind of date.
- **Billing totals and revenue** aggregate the payments ledger once and join it
  in, instead of a correlated subquery run up to three times per invoice;
  revenue no longer computes every total just to learn the main currency. With
  1,050 clients both take roughly a quarter of the time they did.
- **The message inbox** finds each case's newest message once, through the
  `(case_id, sent_at desc)` index, instead of three correlated subqueries per
  case. One more query than before (unread counts, for the page only) and about
  30% less time at 1,050 clients.
- **A staff view is recorded in the audit trail with one conditional insert**:
  the fifteen-minute de-duplication happens inside that same statement.
- **`payments_invoice_idx`** (migration `0004`): "what has been paid on this
  invoice" is looked up by invoice alone, which the tenant-led index could not
  serve.

### Pages

```bash
npm run bench --workspace @crm/web                  # builds the web app first
BENCH_SKIP_BUILD=1 npm run bench --workspace @crm/web
```

`apps/web/bench/pages.bench.mjs` seeds a throwaway database, starts the real
API and a production build of the web app, and renders 25 screens as the
three roles. A proxy between the two counts API calls, and the API counts its
SQL, so both per-render figures are exact. It also totals the browser bundle.

A page render is dominated by the API work behind it, not by React: the
embedded database runs one statement at a time, so a page costs roughly the
sum of its queries. Next already de-duplicates identical calls within a
render and renders the layout and the page in parallel, so neither needed
changing. The second pass therefore cut queries per page:

- **One pass through the 25 pages: 573 queries, now 470 (−18%).** Every page
  is 3–5 queries lighter; 228 API calls either way.
- **Public routes no longer read the session.** None of them (site branding,
  sign-in, health, logo) uses the caller, and a bad session never stopped one,
  so `/tenancy/current` - asked for on every page - costs no query.
- **Plan usage in one round trip.** `/tenancy/entitlements`, on every page for
  the menu, ran three separate counts; they are now subqueries of one.
- **Notifications in one round trip.** The unread count rides along with the
  feed.
- **Funnel in one scan** instead of two, **case detail** takes the consultant's
  name from the access query instead of a query of its own, and **trends**
  issues its three independent reads together.

Every changed endpoint was checked by snapshotting 141 responses (every call
the pages and benchmarks make, as each role, including refusals) from the old
build and the new one on byte-identical copies of one database: the only
differences are the sign-in timestamps each run creates, which differ between
two runs of the old build too.

Tried and taken out: letting a page's simultaneous requests share one
identity read. Done safely (never reusing a read issued before a request
arrived) it saved nothing measurable here, so it was not worth the added
machinery on the authorisation path.

Still proportional to the size of the consultancy, by design or not yet
addressed: the inbox (it must rank every case with a conversation to find the
newest 50), the dashboard figures, and the client CSV export, which writes
every client. (The browser bundle noted here before is dealt with below.)

### The browser, with the redesign

The redesign (see Design system) was measured with the same page benchmark,
before and after, plus the build's own per-route figures.

- **No new load on the API.** 219 API calls and 453 queries per pass, before
  and after - every figure on the new dashboards comes from data the pages
  already fetched.
- **`@crm/shared` is compiled from source by the web app**
  (`apps/web/next.config.ts`), and marked side-effect free, so a page ships
  only the exports it uses. It was CommonJS, which cannot be tree-shaken, so
  one imported constant pulled in the whole package and `zod`. The API still
  runs the CommonJS build. First-load script, gzipped, for the page entries:
  sign-in 132 → 109 KB, client list 135 → 110 KB, a case 158 → 138 KB,
  finance 132 → 111 KB, the consultant dashboard 140 → 128 KB; the manager
  overview gained 1 KB of new charts (108 → 110 KB).
- **The realtime client loads after the page is interactive.** The bell is in
  every portal's chrome, so `socket.io-client` (13 KB gzipped) was in the first
  load of every screen; it is now its own chunk, fetched when the bell
  connects. Nothing depends on it to render.
- **Every section had a loading skeleton** (since removed): measured clicking
  through the consultant's rail, the highlight moved 3-13 ms after the click,
  the screen's outline followed at about 50 ms, and the page landed in
  340-510 ms. That last figure was put down to the API's queries here; it was
  not. The server answers those clicks in 14-120 ms - the rest was React
  holding each skeleton on screen for its 300 ms minimum. See "Clicks, tabs
  and filters" below.
- **What it costs:** the stylesheet grew from 54 to 76 KB (14 KB gzipped) with
  the motion system and new components, and Rubik adds one 35 KB font file,
  cached for good. Pages carry their skeleton and richer markup, so HTML grew
  (the manager overview from 151 to 196 KB uncompressed); compressed, it is
  25 KB.
- **Render time did not move measurably.** The two runs taken on battery, on
  the old code and the new, sum to 2,550 and 2,628 ms of medians across the 25
  pages (+3%, inside run-to-run noise). Today's mains-powered "before" run
  (1,150 ms) is not comparable, for the reason given above.

Each figure comes from `.bench/redesign-before-pages.log`,
`.bench/redesign-after-pages.log` and the matching `-routes.txt` files.

> The page benchmark builds the web app with `API_URL` pointing at its own
> counting proxy, and Next bakes the `/api` rewrite into the build. After a
> benchmark, run `npm run build --workspace @crm/web` before
> `npm run start --workspace @crm/web`, or the browser's API calls go to a
> port nothing is listening on.

### Clicks, tabs and filters

The fourth pass measured what a person feels: a real browser clicking
through each portal against a production build
(`apps/web/bench/browser-timing.mjs`), timing when the page *lands* - the
new page painted - and counting every request each click causes.

**What was slow was not the data.** Every rail click took about 350 ms, and
going back to a tab already seen was no faster (352 ms vs 370 ms). Yet the
server answered the click itself in 14-120 ms and the API's calls in 3-23 ms.
The gap was a rule inside React: once a loading fallback has been shown, the
real content is held back until the fallback has been up for 300 ms
(`FALLBACK_THROTTLE_MS` in react-dom), so a fast page never flickers. Every
section's `loading.tsx` skeleton was such a fallback, committed the instant
the link was clicked - so every click cost 300 ms however fast its data came.

| Manager, median of the rail | Before | After |
| --- | --- | --- |
| A tab not yet seen | 370 ms | 94 ms |
| A tab seen in the last minute | 352 ms | 39 ms, no page request |
| After hovering the link first | 370 ms | lands 22-59 ms after the click |
| Filter by stage, sort | 53-161 ms | 64-101 ms |

The consultant's desk: 70 ms for a tab not yet seen, 19 ms for one seen. The
client's portal: 98 ms and 20 ms. (`.bench/perf4-*-browser-*.log`; the
laptop was on mains.)

What changed:

- **The skeletons are gone.** A click keeps the current page until the next
  is ready and swaps in one step. The rail highlight still moves on the click
  itself; a hairline progress bar appears only if a page takes over 120 ms
  (`components/navigation-progress.tsx`). Measured on a throttled connection
  (400 ms latency, 50 KB/s): highlight at 12 ms, bar at 127 ms, page at
  1,070 ms with the old page readable throughout.
- **The browser keeps pages for a minute** (`staleTimes` in
  `apps/web/next.config.ts`), so going back to a tab, or pressing Back, shows
  it at once with no request to the server.
- **The rail fetches on intent.** Resting the pointer on a destination for
  60 ms, focusing it, or touching it fetches that page in full, so the click
  finds it already here. Only the rail does this: its destinations are lists
  and dashboards. A client or case page records a view in the audit trail, so
  fetching one because a pointer passed over it would log a visit that never
  happened.
- **The page arrival animation is 0.2 s**, from 0.38 s plus a 0.15 s cascade:
  half-faded content reads as content that has not arrived.
- **Search waits 200 ms after typing stops** (was 300 ms). The list itself
  dims while a search or filter is on its way, and the box never waits.

**A kept page is never trusted as it is.** Each page carries the time its
data was read (`lib/render-clock.ts`, placed by `PageHeader` or `PageStamp`).
When a page is shown from the browser's keep - a tab revisited, Back, a hover
prefetch more than 2 s old, or the tab coming back into view after 15 s away
- `components/freshness.tsx` asks `GET /api/sync/changes?since=<that time>`.
The answer comes from one row per consultancy, `tenant_sync`, which every
write request moves forward (a global interceptor, `sync/`, before the
response leaves) and so does every chat message sent or marked read over the
socket. If anything changed, the page re-renders in place a moment later:
measured, a colleague's rename appears 170-300 ms after returning to the tab
or pressing Back (`apps/web/bench/freshness.check.mjs`). If nothing changed,
the kept copy is already right and nothing more is fetched. Back used to show
the browser's copy with no check at all; it is now corrected the same way.

- **Coarse on purpose.** Any change anywhere in the consultancy re-checks every
  kept page. A needless refresh costs one round trip; a missed one would show
  wrong data.
- **Safe failures.** A failed write is marked too, and a missing row means
  "changed". A page that carries no stamp is re-rendered rather than trusted
  (`FreshnessFallback`). If the check itself cannot be answered (offline,
  rate-limited) the kept page stays - it is at most a minute old - rather than
  being swapped for an error.
- **Clients always re-check.** The marker moves with anything staff do, so a
  client polling it would learn when the office is busy. Clients are always
  told "changed": their kept pages still appear at once and are re-rendered
  behind it. The platform admin, whose pages span every consultancy, is
  treated the same way.
- **Writes no page shows are exempt**, with `@NoChangeMarker()`: marking a
  notification read (the bell updates itself over its socket). Opening a chat
  thread marks it read every time; only a read that marked a message counts.
- Saving something in this tab already clears the browser's keep, as before
  (`router.refresh()` after each save).

Filters, search and sort still ask the server every time. Next keeps
search-parameter pages under the bare path and always refetches their data,
rather than risk showing one filter's results for another, and the list is
paginated on the server so a filter is correct over every client, not just
the 25 on screen. Those requests are 35-100 ms.

Unchanged on the server: the API benchmark's 39 endpoints issue 115 queries,
before and after (`.bench/perf4-after-api.json`). The check is two queries,
the session and a primary-key read, and a write adds one upsert.

What is left: a first visit to a tab is the server's render time, 40-150 ms
here, dominated by the API's queries on the embedded database; the response
is 8-9 KB gzipped (152 KB raw, half of it repeated class names). Filters are
round trips. In a busy consultancy almost every kept page will find a change
and re-render - correct, and still shown at once, but it saves less work
there than in a quiet one.

---

## Running it for many people

What the code does so that adding servers adds capacity, and what a
deployment has to provide. Both tiers are stateless per request: the session
travels in its cookie and the API re-reads the person every time, so web and
API instances can be added behind a load balancer - with the exceptions
listed under "needs".

**In place**

- **A ceiling per account** (`RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_BURST`,
  `apps/api/src/common/rate-limit.ts`): token buckets keyed by the signed-in
  person, checked after authentication - 600 a minute after a burst of 120 by
  default, far above any person's pace. A refused request gets `429` with
  `Retry-After` and does not push the wait further out. Checked against the
  running server: 160 simultaneous requests from one account, 134 served and
  26 refused, while another account carried on. Per instance, so N instances
  allow N times the setting. It is deliberately not per IP address: behind the
  web server every request comes from that server, so a per-IP budget would be
  one bucket for everyone. Unauthenticated traffic belongs at the edge proxy;
  sign-in keeps its own tighter throttle. Off under `NODE_ENV=test`.
- **Pooled database connections**, `DB_POOL_MAX` per instance, and a bounded
  wait for one, `DB_CONNECT_TIMEOUT_MS` (10 s): under a saturated database a
  request fails instead of queueing without limit. Keep `DB_POOL_MAX` times
  the number of API instances under Postgres's `max_connections`, or put
  PgBouncer in transaction mode in front of it.
- **The site lookup is cached** in each API process for 30 seconds, and public
  routes read no session, so the branding every page asks for costs no query.
- **The browser keeps recently seen pages** and checks them against a change
  marker held in Postgres (`tenant_sync`, see "Clicks, tabs and filters"), so
  it is correct with any number of API instances and needs no Redis. It is one
  row per consultancy, moved forward by one upsert per write request: in a
  very large consultancy writing many times a second that row is contended,
  and the marker could move to Redis behind the same `SyncService`.
- **Static assets are content-hashed** (`/_next/static`, served with a
  year-long immutable cache header), so a CDN in front serves them; logos are
  public with a one-day cache and a version in the URL. Pages and API
  responses are private and per person by design, so they are never shared
  between people.
- **Queries are counted**, not guessed: both benchmarks above count every
  statement.
- **A failed page recovers in place**: each portal has an error screen that
  keeps the rail and retries the page on the server.

**What a multi-instance deployment needs**

- **The Socket.IO Redis adapter**: the chat and notification gateways keep room
  membership in process memory, so with several API instances a broadcast
  must be able to reach sockets held by the others (see Chat). Until it is
  configured, run one API instance for the sockets.
- **One scheduler for the stuck-case sweep**: it runs in every API process, so
  with several, drive it from one place through `POST /analytics/stuck/sweep`.
  The overdue-task sweep is already safe on several instances.
- **Shared limits, if wanted**: the account ceiling and the sign-in throttle
  are per process today; a shared budget means moving their buckets to Redis.
- **A real Postgres** (`DATABASE_URL`). The embedded database is single-writer
  development scaffolding. Read replicas for the heavy read paths (dashboards,
  the inbox) would be the next step; today everything goes through one pool.

**Not done:** no load test at the scale of 100,000 concurrent people has been
run - this machine runs the API on embedded Postgres. The figures above are
per request and per page; capacity at that scale comes from the number of
instances, the size of the database, and the Redis adapter above.

---

## Design system

Tokens live in `apps/web/src/app/globals.css` and nothing outside them is used.
The look is a modern admin dashboard: a navy rail, a pale blue-grey canvas,
white cards with tinted icon tiles, and a top bar of white tiles.

- **The brand colour is for what you can press**: primary buttons, links, the
  active menu item, "New". Royal blue by default, or the consultancy's own
  colour, set per tenant from `/admin`.
- **Info blue is for what you read**: counts, tags ("Pinned", "Manager"),
  avatars and the first chart series. It is fixed, never the consultancy's
  colour - a consultancy may brand itself green or red, and an informational
  tag must never read as a status.
- **Three status colours, each meaning exactly one thing everywhere:**
  green = verified/complete, amber = pending/attention, red = rejected/blocked.
  A tinted tile, row or pill is never decoration: the tint is the tone the
  figure carries everywhere else, so the amber "Awaiting review" tile and an
  amber "Pending" pill mean the same thing. That is also why the floating
  messages button is blue, not the amber of the dashboard it is modelled on.
- **Rubik**, one 35 KB variable file served from the app's own origin
  (`app/fonts`, OFL), preloaded, with a size-adjusted fallback so nothing
  reflows when it lands. No third-party request; the app still works offline.
- **Three chart series colours** in fixed order - blue, teal, coral - validated
  with the dataviz palette checker against the card surface in each theme,
  every pair: light worst colour-blind separation ΔE 8.4, normal vision 28.6;
  dark ΔE 8.4 and 23.1; all three at least 3:1 in both. A fourth series is
  never added. Every chart has a hover, touch and arrow-key readout and a table
  view.
- **Text contrast**: body and secondary text are at least 4.5:1 on cards in
  both themes. Captions (`ink-400`, about 3:1) carry only what is said again
  elsewhere.
- **A navy rail in every portal**, its destinations grouped under headings, and
  collapsible to icons. On a phone it becomes a bottom bar of four destinations
  plus "More".
- **Full width.** The content is the whole plane beside the rail, never a
  column in the middle of it.
- Status is always a **word**, never a bare colour — for colour-blind users and
  for anyone reading a phone in sunlight.
- **Mobile-first.** The client portal answers "where is my application?" above
  the fold with no navigation. Dense tables become stacked cards on phones
  rather than scrolling sideways.

### Motion

- **Only `transform` and `opacity` move**, the two properties a browser
  animates on the compositor, so no animation competes with a click for the
  main thread or re-lays-out the page. Nothing waits for an animation: every
  element is clickable from its first frame.
- **A press answers on the first frame** (`.press`), clickable cards lift on a
  pre-rendered shadow layer (`.lift`), menus open from their button and play a
  short exit before unmounting (`components/popover.tsx`), and switching theme
  cross-fades where the browser has view transitions.
- **The menu highlight moves on the click**, before the next page has arrived,
  and a small spinner shows if it takes a moment.
- **No placeholder screens.** The current page stays until the next one is
  ready and then swaps in one step - usually within 40-150 ms of the click. A
  slow page (a phone on a bad connection) gets a hairline progress bar across
  the top after 120 ms, and nothing else. Skeleton screens were tried and
  removed: once React has shown a loading fallback it keeps it for at least
  300 ms, so they made every click that slow (see "Clicks, tabs and filters").
- **The page's blocks settle in** over 0.2 s, barely staggered, because
  content that is still fading reads as content that has not arrived.
- **The top bar** is transparent over the canvas and frosts once content
  scrolls beneath it, driven by the scroll position in CSS - no listener.
- **Charts draw themselves once** on arrival - lines trace, bars and rings grow.
- **`prefers-reduced-motion` is honoured everywhere**: every animation is
  written so that switching it off leaves the final state, never an element
  stuck invisible.

---

## Build status

Implemented and verified end to end:

1. Data model and Postgres schema
2. Auth, role-based routing, and three correctly gated portal shells
3. Client management CRUD (search, stage filter, sort, pagination)
4. Case pipeline: manual stage override, auto-advancement, stage history,
   case status, multiple applications per client
5. Documents: upload with browser-side compression, storage, and the
   verify / reject / comment workflow that drives auto-advancement
6. Manager dashboard: headline figures, an intake/outcome trend chart, the
   case-health split, the pipeline funnel, stuck-case alerts, team workload,
   recent activity, and the system-wide audit trail
7. Consultant dashboard: the review queue and stalled cases first, then the
   same charts scoped to that consultant
8. Live chat over Socket.IO, one thread per case, with typing indicators,
   read receipts and unread badges
9. In-app notifications: live-pushed, per-user, with a bell in the app chrome,
   including the scheduled `case_stuck` sweep
10. Global client search in the app chrome, scoped by the same SQL as the list
11. Multi-tenancy: per-consultancy isolation of every table, host-based site
    resolution, the platform admin portal (onboarding, branding, custom domains
    with DNS verification, suspension), and a cross-tenant test suite
12. Invoices, receipts and an append-only payments ledger, with a price list and
    the client's Payments tab
13. Tasks and follow-ups with overdue alerts and escalation
14. Announcements to clients, staff or both
15. Subscription plans with module switches and enforced limits
16. Student profiles, application key dates, portal access management, staff
    management and account settings
17. The documents drive: folders, review, versions and sharing (see Documents)
18. Countries and per-country workflows, the pipeline board and automations
19. The finance workspace and double-entry books (see Finance)
20. University commissions: agreements, claims, receipts and staff incentives
21. Partner consultants: onboarding, the partner portal, attribution, earnings and payouts
22. Courses and test preparation: batches, enrolment, attendance, mock tests, homework, official results
23. Launch readiness: "Forgot password" and invitations by email (with the link
    for WhatsApp), sessions that end with the password, each consultancy's own
    branding and domain with a DNS check in words, accountants and trainers
    starting on their own work, and the `deploy/` package (Docker, Caddy with
    automatic HTTPS for every domain, backups, launch guide). Verified on
    PostgreSQL 16 with a crawl of every portal as every role.
24. Commercial readiness (2026-10-18): paying for the platform (trial,
    paid-until date, grace days, read-only for staff when it lapses, payments
    with receipts, reminders, the manager's Subscription page), published
    terms and privacy policy, a "Getting started" card for new consultancies,
    cross-site write protection, dates in the local calendar (`TZ`) instead of
    UTC everywhere "today" is meant, and the dependency security updates.
    Verified in production mode behind Caddy over HTTPS on PostgreSQL 16: a
    whole first day through the browser, and a crawl of every portal.

### Notifications

Rows are written by the actions themselves — document verified/rejected/
commented/uploaded, stage changed, message received, client reassigned — and
delivered over a second socket namespace with **one room per user**, so someone
with the app open on a phone and a laptop sees the same badge on both, and
clearing the bell in one tab clears it in the others.

The database row is the source of truth and the socket only saves a refresh, so
a dropped event costs nothing worse than a slightly stale badge until the next
page load. The feed is server-rendered into the shell, so the count is correct
on first paint rather than popping in.

Ownership is enforced in the `WHERE` clause: marking a notification read is
scoped to `userId`, so posting someone else's notification id returns `204` and
changes nothing. That is deliberate — a `404` would confirm whether the id
exists.

`case_stuck` is the one alert no action can raise, because *nothing happening*
is the cause. It runs on a clock instead: a daily sweep at 08:00 local, so the
alert is waiting when the office opens rather than arriving at 3am.

The rule that makes a daily job bearable is **one alert per stalling episode,
not per day**: a case is skipped if a `case_stuck` row already exists for it
since it entered its current stage. Move the case and let it stall again and it
alerts again; leave it stuck and it does not re-nag every morning. Without that
the bell fills with the same six cases daily and people learn to ignore it,
which is worse than no alert.

The consultant and the manager get the same alert pointing at different paths —
`/desk/cases/:id` and `/overview/cases/:id` — because sending a manager to the
consultant's route would bounce them to their own home and lose the case they
clicked.

`POST /analytics/stuck/sweep` (manager-only) runs it on demand. It is safe to
call repeatedly, and it is the hook for an external scheduler: the in-process
timer runs on every instance, so a multi-instance deployment should drive one
instance through that endpoint instead.

### Chat

One thread per case, because that is the unit everything else is scoped to —
which means **case access is chat access**, and the socket gateway resolves
through the exact same check as the HTTP endpoints. A socket can never
subscribe to a conversation its owner could not already read, so the realtime
layer adds no new attack surface. Verified: an unauthenticated socket is
disconnected by the server before it reaches a handler, and a consultant who
does not own the case is refused the room and receives nothing broadcast to it.

**The socket is the fast path, not the only path.** History loads over HTTP so
the thread renders before the websocket is up, and sending falls back to HTTP
when the socket is down — on a patchy mobile connection, a message that
silently "didn't send" is the worst outcome this product can produce. Messages
send optimistically and carry a `clientRef` that the server echoes back, so the
optimistic bubble is replaced rather than duplicated when the broadcast
arrives. A failed send says so and offers a retry.

> **Scaling note:** the gateway keeps room membership in the process's memory,
> which is correct for one API instance. Running several behind a load balancer
> needs the Socket.IO Redis adapter so a broadcast reaches clients connected to
> other instances — a configuration change, not a rewrite.

### "Stuck" is per-stage, not one global number

A case sitting two weeks in Documents Collection is normal; two weeks waiting
on an offer letter is not. Each stage carries its own `stuckAfterDays` in
`@crm/shared`, and the alert query builds a SQL `CASE` expression from that
same config — so the threshold a manager is alerted on is the identical number
the consultant sees on the case and the client's progress bar is measured
against. Inquiry flags at 7 days, Documents Collection at 14, Application
Submitted at 30.

The stalled list leads with whether the hold-up is **ours or the client's** —
a case with documents sitting unreviewed is a different problem from one where
the client has sent nothing.

### The funnel chart

Horizontal bars, not a tapering funnel shape: a funnel's width reads as area,
which misrepresents the counts, and these stages are not a strict drop-off
anyway — cases enter partway through and move backwards. Two series only
(moving / stalled), with the stalled segment in the reserved status red. The
palette was checked with a colour-vision validator rather than by eye (worst
adjacent pair ΔE 21.4 under protanopia, against a floor of 8), every bar
carries its number directly so colour is never the only channel, empty stages
still render a tick so the chart does not jump between loads, and the same
numbers are available as a table for screen readers and printing.

Clicking any stage drills through to that stage's clients.

### Documents

Upload is the one flow a non-technical client performs unaided, so it is built
for a phone on a slow connection: photos are downscaled in the browser before
upload (a typical 7 MB passport photo lands at a few hundred KB), a real
progress bar reports bytes sent, and the row states what to do next in plain
words rather than status codes.

Review has three outcomes, matching how consultants actually work:

- **Verify** — optimistic in the UI, because clearing a queue of thirty
  documents should never wait on a round trip. This is what triggers
  auto-advancement.
- **Reject** — requires a reason of at least a full sentence, because a
  rejection without one just produces the "what was wrong?" message this
  product exists to eliminate. The text is sent to the client verbatim.
- **Comment** — a clarifying question that leaves the document pending and does
  not tell the client to re-upload.

Files are validated by their **leading bytes, not their content type** — an
executable renamed `passport.pdf` is refused. Storage keys are server-generated
UUIDs, never derived from user input, and every read goes through an authorised
route (or a 5-minute presigned URL on S3). Nothing is public except through a
share link someone chose to create (below).

#### The documents drive

`/overview/documents`, `/desk/documents` and `/portal/documents` are one drive
seen through each person's access:

- **Folders.** Every student gets a standard set (Passport and ID, Academic,
  Language tests, Financial, Application documents, Offer letters, Visa,
  Other) the first time anything is filed for them. A consultancy can replace
  the set with its own template, per destination country. Uploads are filed
  into the right folder by type; the type is guessed from the file name when
  not chosen. Staff can add sub-folders, colour, rename, move, star and trash
  them. The agency has its own area for templates, forms and marketing.
- **Who sees what.** A consultant sees the students assigned to them (or on a
  case they hold), plus the agency area; managers see everything. A folder can
  be marked **restricted** — then only managers and people granted access to
  it (or a parent) see it. Grants are per person, view or edit.
- **Views.** All documents, To review, Expiring, Starred, Recent, Shared
  outside, Trash; filters by type, status, country, uploader, tag and date;
  sort by name, date, size, status or expiry (Expiring sorts soonest-first).
- **Review.** Uploaded → Under review → Approved, or Re-upload requested /
  Rejected with a written reason the student receives by email and in the
  portal. A new upload of the same document becomes the next version; earlier
  versions stay viewable and can be restored.
- **Checklists.** Required documents are set per destination (and optionally
  per study level and visa type); the most specific matching list applies. The
  student, their consultant and the manager all see the same percentage.
- **Expiry.** Passports, test results and bank statements carry an expiry
  date. Reminders go to the student and their consultant at 90, 30, 7 and 0
  days (configurable), once per window.
- **Sharing outside.** A document or folder can be shared with, say, a
  university's admissions office: a random link, valid 1–90 days, optionally
  password-protected (five wrong tries lock it for 15 minutes) and view-only.
  Every open and download is logged, and the link only works on the
  consultancy's own address. Revoking takes effect immediately.
- **Large files and bad connections.** Files over 4 MB go up in 2 MB chunks
  that retry and resume after a dropped connection or a closed tab.
- **Downloads** are renamed to the agency's pattern (default
  `{student}_{type}`), and many files can be fetched as one ZIP (up to 200
  files / 500 MB).
- **Rules per agency** (Document settings): accepted file types, size limit
  (25 MB ceiling), rename pattern, trash retention, reminder days, document
  types, folder templates and checklists.

Deletion: the uploader — student or staff — may remove their own file until it
is approved; a manager may remove anything. An approved document cannot be
removed by anyone else, because it is the evidence the case was allowed to move
on. Removing a folder follows the same rule for everything inside it. Removing a file moves it — with all its versions — to
**Trash**, where it can be restored for the retention period (30 days by
default); after that the hourly sweep deletes the bytes. The row and its audit
trail always survive.

The plan's storage allowance is checked on every upload; a consultancy at its
limit is told so before the file is stored.

Time-based work (expiry reminders, trash purge, abandoned chunked uploads)
runs from one hourly sweep (`apps/api/src/reminders`). Each job claims its work
with a conditional update, so two API instances never send the same reminder
twice. A platform admin can trigger it with `POST /api/admin/reminders/run`.

### How stages move

A case advances **on its own** the moment every required document for its
current stage is verified — the consultant never clicks "next stage" in the
normal path. Two rules keep that safe:

- A stage with **no** required documents never auto-advances. "Application
  Submitted" moves when a human says the university replied, not because there
  was nothing to collect. This also bounds the cascade, so one verification
  cannot run a case down the whole pipeline.
- Auto-advancement is wrapped so that a failure inside it can never fail the
  document review that triggered it.

Manual override is always available to staff, including moving a case
backwards. Anything other than a single step forward — going back, or skipping
ahead of an unfinished checklist — **requires a written reason**, which is
stored on the stage history row and in the audit log.

`case_stage_events` is append-only: exactly one open row at a time, and
re-entering a stage creates a new row rather than editing the old one, so the
history reads as what actually happened.

### Countries and workflows

`/overview/workflows` (and `/desk/workflows` for staff with **Build
workflows**) is where a consultancy with several destinations sets up how each
kind of application runs. Every consultancy starts with **Standard** — exactly
the ten stages above, with the same limits, required documents and US-only
interview — and every application that existed before workflows is on it
(migration `0009` backfills it; nothing about those applications changed).

- **Countries** (`/overview/countries`): intakes and their deadlines, typical
  fees, proof-of-funds rules (amount, basis, holding days), language test
  minimums, visa routes, processing time, work rights and post-study work, and
  free notes. Destinations students are already applying to but that have no
  entry are listed so they can be added in one click.
- **Workflows** per country, and optionally per study level and visa type. A
  new application runs on the **most specific** published workflow that fits
  it (country + level + visa beats country + level beats country alone;
  Standard takes the rest). Staff can still pick another when opening it.
- **Stages** are built in a drag-and-drop editor. Each has the name staff see,
  the label and description the student sees, a colour, a time limit, the
  documents that must be approved before it moves on, whether it moves on by
  itself, whether someone with **Approve gated stages** must sign it off,
  whether only managers may move applications in or out, conditions under which
  it applies at all (e.g. "Biometrics" only when the study level is master),
  tasks created on entry, fees (a task to collect, or an invoice issued
  straight away), and messages (in-app, email, SMS, WhatsApp) with
  placeholders such as `{first_name}` and `{reference}`.
- **Every stage belongs to one of the ten standard steps** as its category, so
  the dashboards, funnel, "Not moving" list and client progress bar read every
  workflow the same way, and the order of categories cannot run backwards.
- **Versions.** Editing makes a draft; publishing makes the next version. A
  published version is never edited (a database trigger refuses it), so an
  application keeps the stages it was promised. Publishing can move open
  applications onto the new version; otherwise each one is moved from its own
  page, with a reason that goes into its history. Workflows can be copied and
  archived.
- **The pipeline board** (`/overview/pipeline`, `/desk/pipeline`) shows one
  workflow's applications as columns, with the time each has spent in its
  stage, overdue and awaiting-sign-off flags, and drag-to-move that follows the
  same rules as the stage control (reasons for going back or skipping).
  Consultants see their own students unless they may see everyone.
- **Performance** per workflow: how many reached each stage, the median time
  spent there, and how often the stage's limit was breached.
- **Automations**: when an application is opened, enters or leaves a stage,
  changes status, has a document uploaded, approved or rejected, or goes past
  its stage's limit — and the conditions hold — create a task, notify, send a
  message, move it, or change its status. Every run (and every stage's own
  tasks, fees and messages) is written to the **run log** with what each
  action did or why it did not. An event is handled once even if it is
  delivered twice, and a chain of automations stops after a few steps so two
  rules cannot move an application back and forth for ever.

The time limit that drives "Not moving" is the stage's own (`stage_sla_days` on
the application), so a two-day "GIC and medicals" stage is flagged after two
days, not after the standard step's 21.
