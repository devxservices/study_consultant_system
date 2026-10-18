# Launching the platform

This puts the whole platform on one server, so your consultancies, their staff,
students and partners can reach it from anywhere. You need about an hour,
mostly waiting for DNS.

What you end up with:

| Address | Who uses it |
| --- | --- |
| `https://admin.yourcrm.com` | You, the platform owner: add consultancies, plans, branding, domains |
| `https://<name>.yourcrm.com` | Each consultancy's portal: its staff, students and partners sign in here |
| `https://portal.theirdomain.com` | Optional: a consultancy's own domain, once connected |

HTTPS certificates are issued automatically for every one of these.

---

## 1. What you need

- **A domain** for the platform, e.g. `yourcrm.com` (any registrar).
- **A server** with Ubuntu 22.04 or 24.04, at least 2 CPUs, 4 GB RAM, 40 GB disk
  (Hetzner, DigitalOcean, Vultr, AWS Lightsail and similar all work). Note its
  public IP address.
- **An SMTP account** for email (Brevo, Mailgun, SendGrid, Amazon SES, Zoho or
  Google Workspace). Without it, "Forgot password" and invitations cannot be
  emailed.

## 2. Point your domain at the server

At your domain's DNS provider, add two records (replace the IP with yours):

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `203.0.113.10` |
| A | `*` | `203.0.113.10` |

The `*` record is what makes every `<name>.yourcrm.com` work without adding a
record per consultancy. If you use Cloudflare, set both to **DNS only** (grey
cloud).

## 3. Put the code on the server

Sign in to the server (`ssh root@203.0.113.10`) and put the project in
`/opt/crm`. Either:

- **From a private Git repository** (GitHub, GitLab, Bitbucket - recommended,
  because updating is then one `git pull`):

  ```bash
  apt-get update && apt-get install -y git
  git clone https://github.com/<you>/<repository>.git /opt/crm
  ```

- **Or copy the folder** from your computer with WinSCP or `scp`. Leave out
  `node_modules`, `.next`, `.data`, `storage` and `deploy/.env` - the server
  builds and creates its own.

## 4. Run the installer

```bash
cd /opt/crm
sudo bash deploy/install.sh
```

It asks a few questions - your domain, your email and name, the server's IP
address (it finds it for you), the time zone, and your SMTP details - and then
does everything else by itself:

1. checks the server (memory, disk) and adds a swap file on a small one;
2. installs Docker if it is not there;
3. writes `deploy/.env` with your answers and four freshly generated secret
   keys (readable by root only);
4. opens ports 80 and 443 if the `ufw` firewall is on;
5. checks your DNS records and tells you exactly what to add if they are
   missing;
6. builds and starts the database, the API, the web app and Caddy - the first
   build takes 5-10 minutes - and waits until they answer;
7. creates your platform admin account and shows its password **once**;
8. schedules a backup every night at 02:15;
9. fetches the HTTPS certificate for `admin.yourcrm.com`.

At the end it prints the address to sign in at. Sign in, change the password
under your account and switch on two-step verification. The admin home shows
a **Platform setup** card: every line should say "Set" before you invite real
people.

**Keep a copy of `deploy/.env` somewhere safe** (a password manager): it holds
the encryption keys. If they are lost, stored files and two-step sign-in
cannot be recovered.

The installer is safe to run again at any time. It never changes an existing
`deploy/.env`, backs up before it rebuilds, and leaves an existing admin's
password alone. If something stops it, it says what and where; fix that and
run the same command again.

*No questions at all* (for example from a provisioning script): give the
answers as variables.

```bash
sudo CRM_DOMAIN=yourcrm.com CRM_ADMIN_EMAIL=you@yourcrm.com CRM_ADMIN_NAME="Your Name" \
     CRM_SMTP_HOST=smtp-relay.brevo.com CRM_SMTP_USER=you@yourcrm.com CRM_SMTP_PASS='...' \
     CRM_YES=1 bash deploy/install.sh
```

`CRM_PUBLIC_IP`, `CRM_TZ` (default `Asia/Karachi`), `CRM_SMTP_PORT` (default
587), `CRM_MAIL_FROM` and `CRM_VIRUS_SCAN=1` (ClamAV) can be given too.
Without `CRM_SMTP_HOST`, email is left off and the summary says so.

## 5. Your settings: how you get paid, terms and privacy

In the admin, open **Settings**:

- **How consultancies pay you**: your bank account / wallet details and where
  to send the slip. Managers see this on their **Subscription** page and in
  every renewal reminder. Also the **grace days** (default 7) and the **free
  trial** new consultancies start with (default 14 days).
- **Terms and privacy policy**: your business name and both documents. Start
  from the templates, fill in every `[bracket]` and have them checked by a
  lawyer for the countries you work in - the platform holds students'
  passports and bank statements. Once saved they are published at `/terms` and
  `/privacy` and linked from every sign-in page and public form.

## 6. Email that arrives

Invitations and password links are useless in a spam folder. (If you skipped
email in the installer: add the `SMTP_*` lines to `deploy/.env`, set
`MAIL_DRIVER=smtp` and run `sudo bash deploy/install.sh` again.) At your DNS
provider, for the domain in `MAIL_FROM`, add the records your SMTP service
gives you:

- **SPF** (a TXT record on the domain, e.g. `v=spf1 include:spf.brevo.com ~all`),
- **DKIM** (one or two records the service generates),
- **DMARC** (a TXT record on `_dmarc`, e.g. `v=DMARC1; p=none; rua=mailto:you@yourcrm.com`).

Then use "Forgot your password?" on the admin sign-in page and check the email
arrives in the inbox, not spam.

## 7. Add your first consultancy

In the admin: **Add consultancy** - name, address (e.g. `globalstudy` becomes
`globalstudy.yourcrm.com`) and its manager's email. The manager signs in at that
address and from there:

- **Branding**: logo, colour and contact details - shown on the sign-in page,
  every screen and every email.
- **Branding -> Web address**: their own domain, with the exact DNS record to
  add and a "Check now" button. A subdomain such as `portal.theirdomain.com`
  needs a single CNAME record; a root domain needs an A record (your
  `PUBLIC_IP`) and a TXT record.
- **Team**: add colleagues; each gets an email to choose their own password.
- **Clients -> Portal access -> Invite to the portal**: students get an email
  (and staff get the link to send by WhatsApp) to choose their password.

The new consultancy's overview shows a **Getting started** list until it is
branded and has its first student.

**Billing them.** A consultancy starts on your free trial. On its page in the
admin, choose a **Plan** and, when money arrives, **Record a payment**: it
moves "paid until" on by the months paid for and emails the managers a
receipt. When "paid until" passes, managers are reminded; after the grace days
the consultancy's staff can still see and export everything but not change it
until you record a payment. "Renewals to chase" on the admin home lists who is
due.

## 8. Backups

The installer already runs `deploy/backup.sh` every night at 02:15 (see
`/etc/cron.d/consultancy-crm`; the log is `/var/log/crm-backup.log`). To take
one now: `sudo bash /opt/crm/deploy/backup.sh`.

This keeps 14 days of database dumps and uploaded files in `deploy/backups`.
Copy that folder off the server as well (for example with `rclone` to
Backblaze B2 or S3).

**Restoring** (onto a fresh install with the same `.env`):

```bash
docker compose up -d db
docker compose exec -T db pg_restore -U crm -d crm --clean --if-exists < backups/db_YYYY-MM-DD_HHMM.dump
docker compose run --rm -T --no-deps --user root -v "$PWD/backups:/backup" --entrypoint tar api xzf /backup/files_YYYY-MM-DD_HHMM.tgz -C /app
docker compose up -d
```

**Test it once, before you need it.** After the first night's backup, restore
the dump into a scratch database and check it holds your data:

```bash
docker compose exec -T db createdb -U crm restore_test
docker compose exec -T db pg_restore -U crm -d restore_test < backups/$(ls -t backups | grep '^db_' | head -1)
docker compose exec -T db psql -U crm -d restore_test -c "select (select count(*) from tenants) tenants, (select count(*) from clients) clients, (select count(*) from documents) documents"
docker compose exec -T db dropdb -U crm restore_test
```

The counts should match the admin home. (This could not be run where the
platform was built - Docker was not available there.)

## Know when it is down

Point a free uptime monitor (UptimeRobot, Better Stack, Healthchecks.io) at
`https://admin.yourcrm.com/api/health` every few minutes. It answers
`{"status":"ok","database":"up"}` when the API and database are healthy, and
the monitor emails or messages you when it does not.

## 9. Updating

```bash
cd /opt/crm && git pull
sudo bash deploy/install.sh
```

It asks nothing the second time: it backs up, rebuilds and restarts.
Database changes are applied automatically when the API restarts. They only
ever add; nothing existing is removed.

---

## When something is wrong

| Symptom | Check |
| --- | --- |
| The browser says the connection is not secure | DNS has not reached the server yet (`ping admin.yourcrm.com` should show your IP), or port 80/443 is closed in the server's firewall. `docker compose logs caddy` names the problem. |
| "This address is not connected" | The consultancy's address is spelled differently, or it was suspended. Check it in the admin. |
| A consultancy's own domain does not open | Branding -> Web address -> Check now: it says what DNS currently shows and what to change. Cloudflare must be "DNS only". |
| Reset or invitation emails do not arrive | The admin's Platform setup card shows the email line; check `SMTP_*` in `.env`, then `docker compose up -d`. Ask the recipient to look in spam. Staff can always copy the link and send it by WhatsApp. |
| The API keeps restarting | `docker compose logs api`: a missing setting is named in plain words at the top. |

## What runs where

- `db`: PostgreSQL 16, data in the `pgdata` volume.
- `api`: the NestJS API on port 4000 (inside the network only).
- `web`: the Next.js app on port 3000 (inside the network only).
- `caddy`: the only service open to the internet, on ports 80 and 443. It sends
  `/api/*` to the API and everything else to the web app, and issues HTTPS
  certificates on demand - but only for addresses the API confirms are served
  by the platform (`/api/tenancy/tls-check`).
- `clamav` (optional): virus scanning of uploads.

One server comfortably serves dozens of consultancies. For more, see "Running
it for many people" in the main README: the API and web app can run as several
copies behind the same Caddy, with the database on a managed PostgreSQL.

## Appendix: doing it by hand

What the installer does, step by step, for a server where you prefer to type
each command (from `/opt/crm/deploy`):

```bash
curl -fsSL https://get.docker.com | sh            # Docker
cp .env.example .env && nano .env                  # every REQUIRED line; secrets: openssl rand -hex 32
chmod 600 .env
docker compose up -d --build                       # add --profile scan for ClamAV
docker compose exec api node dist/db/scripts/create-admin.js --email you@yourcrm.com --name "Your Name"
echo "15 2 * * * root bash /opt/crm/deploy/backup.sh >> /var/log/crm-backup.log 2>&1" > /etc/cron.d/consultancy-crm
```
