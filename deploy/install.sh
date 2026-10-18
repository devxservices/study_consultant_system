#!/usr/bin/env bash
# Puts the whole platform on a fresh Ubuntu or Debian server with one command,
# and updates it when run again:
#
#   sudo bash deploy/install.sh
#
# It installs Docker if it is missing, asks for your domain and email
# settings (once - they are kept in deploy/.env), generates the secret keys,
# builds and starts everything (database, API, web app, HTTPS), creates your
# platform admin account and schedules a nightly backup. Safe to run again at
# any time: nothing that exists is overwritten, and an update backs up first.
#
# Every question can be answered ahead of time, for a run with no questions:
#   sudo CRM_DOMAIN=yourcrm.com CRM_ADMIN_EMAIL=you@yourcrm.com CRM_ADMIN_NAME="Your Name" \
#        CRM_SMTP_HOST=smtp-relay.brevo.com CRM_SMTP_USER=... CRM_SMTP_PASS=... \
#        CRM_YES=1 bash deploy/install.sh
# (CRM_PUBLIC_IP, CRM_TZ, CRM_SMTP_PORT, CRM_MAIL_FROM and CRM_VIRUS_SCAN=1 too.)

set -Eeuo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT_DIR="$(dirname "$DEPLOY_DIR")"
ENV_FILE="$DEPLOY_DIR/.env"
CRON_FILE=/etc/cron.d/consultancy-crm
ZONEINFO_DIR=/usr/share/zoneinfo

# ---------------------------------------------------------------------------
# Talking to the person running it
# ---------------------------------------------------------------------------

bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
[[ -t 1 ]] || { bold=''; green=''; yellow=''; red=''; reset=''; }

step() { printf '\n%s==> %s%s\n' "$bold" "$*" "$reset"; }
say() { printf '    %s\n' "$*"; }
ok() { printf '    %s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '    %s!%s %s\n' "$yellow" "$reset" "$*"; }
die() { printf '\n%sStopped:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

has_tty() { { : </dev/tty; } 2>/dev/null; }

# Someone is there to answer: a terminal, and not told to take the defaults.
interactive() { [[ ${CRM_YES-} != 1 ]] && has_tty; }

# ask VAR "Question" [default] [secret] - leaves VAR alone if it is already set.
ask() {
  local var=$1 question=$2 default=${3-} secret=${4-} answer=''
  [[ -n ${!var-} ]] && return 0
  if ! interactive; then
    [[ -n $default ]] || die "No answer for \"$question\". Set ${var} and run it again."
    printf -v "$var" '%s' "$default"
    return 0
  fi
  local prompt="    $question"
  [[ -n $default ]] && prompt+=" [$default]"
  if [[ $secret == secret ]]; then
    read -r -s -p "$prompt: " answer </dev/tty
    printf '\n' >/dev/tty
  else
    read -r -p "$prompt: " answer </dev/tty
  fi
  printf -v "$var" '%s' "${answer:-$default}"
}

# confirm "Question" [Y|N] - true for yes. Unattended runs take the default.
confirm() {
  local default=${2:-Y} answer
  if ! interactive; then [[ $default == Y ]]; return; fi
  read -r -p "    $1 [$([[ $default == Y ]] && echo Y/n || echo y/N)]: " answer </dev/tty
  [[ ${answer:-$default} =~ ^[Yy] ]]
}

# ---------------------------------------------------------------------------
# deploy/.env
# ---------------------------------------------------------------------------

# The value of KEY in deploy/.env, without quotes - read, never executed.
env_get() {
  [[ -f $ENV_FILE ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed -e "s/^'\(.*\)'\$/\1/" -e 's/^"\(.*\)"$/\1/'
}

# A value as Docker Compose reads it literally: single-quoted. Callers make
# sure it holds no single quote first (see no_quote) - a check in here would
# run in a $(...) subshell, where stopping stops only the subshell.
quote() { printf "'%s'" "$1"; }

no_quote() {
  [[ $1 != *"'"* ]] || die "The $2 cannot contain a single quote ('). Choose another one and run it again."
}

new_secret() { openssl rand -hex 32; }

valid_domain() { [[ $1 =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; }
valid_email() { [[ $1 =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; }
valid_ip() { [[ $1 =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }

detect_ip() {
  local ip=''
  for url in https://api.ipify.org https://ifconfig.co https://icanhazip.com; do
    ip=$(curl -4 -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]') || true
    valid_ip "$ip" && { printf '%s' "$ip"; return; }
  done
  hostname -I 2>/dev/null | awk '{print $1}' || true
}

configure() {
  step "Settings"
  if [[ -f $ENV_FILE ]]; then
    for key in PLATFORM_DOMAIN WEB_ORIGIN ACME_EMAIL POSTGRES_PASSWORD JWT_SECRET MFA_ENCRYPTION_KEY STORAGE_ENCRYPTION_KEY; do
      [[ -n $(env_get "$key") ]] || die "deploy/.env has no $key. Add it, or move the file away to answer the questions again (keep the secrets: files and two-step sign-in depend on them)."
    done
    ok "Using deploy/.env (delete it only if you know what you are doing - it holds the encryption keys)"
    return
  fi

  say "A few questions - the answers are kept in deploy/.env."
  local domain=${CRM_DOMAIN-} email=${CRM_ADMIN_EMAIL-} name=${CRM_ADMIN_NAME-} ip=${CRM_PUBLIC_IP-} tz=${CRM_TZ-}
  while :; do
    ask domain "Your platform's domain, e.g. yourcrm.com"
    domain=$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]' | sed -e 's#^https\?://##' -e 's#/.*$##' -e 's/\.$//')
    valid_domain "$domain" && break
    interactive || die "\"$domain\" is not a domain name."
    warn "\"$domain\" is not a domain name. Try again, e.g. yourcrm.com"; domain=''
  done
  while :; do
    ask email "Your email (you sign in with it; certificate notices go there)"
    valid_email "$email" && break
    interactive || die "\"$email\" is not an email address."
    warn "That is not an email address."; email=''
  done
  ask name "Your name" "Platform admin"
  local found_ip; found_ip=$(detect_ip || true)
  while :; do
    ask ip "This server's public IP address" "$found_ip"
    valid_ip "$ip" && break
    interactive || die "\"$ip\" is not an IPv4 address."
    warn "That is not an IPv4 address."; ip=''
  done
  while :; do
    ask tz "Time zone for dates" "Asia/Karachi"
    [[ -f $ZONEINFO_DIR/$tz ]] && break
    interactive || die "\"$tz\" is not a time zone (see /usr/share/zoneinfo)."
    warn "Unknown time zone. Examples: Asia/Karachi, Asia/Dubai, Europe/London"; tz=''
  done

  # Email: without it, invitations and "forgot password" links are not sent.
  local smtp_host=${CRM_SMTP_HOST-} smtp_port=${CRM_SMTP_PORT-} smtp_user=${CRM_SMTP_USER-} smtp_pass=${CRM_SMTP_PASS-} mail_from=${CRM_MAIL_FROM-}
  local mail_driver=log want_mail=0
  if [[ -n $smtp_host ]]; then
    want_mail=1
  elif interactive && confirm "Set up email (SMTP) now? Needed for invitations and password links" Y; then
    want_mail=1
  fi
  if (( want_mail )); then
    ask smtp_host "SMTP server, e.g. smtp-relay.brevo.com"
    ask smtp_port "SMTP port" "587"
    ask smtp_user "SMTP username"
    ask smtp_pass "SMTP password" "" secret
    ask mail_from "Send emails from" "no-reply@$domain"
    mail_driver=smtp
  else
    warn "Email skipped: add SMTP_* to deploy/.env later and run this again."
    mail_from=${mail_from:-no-reply@$domain}
  fi
  smtp_port=${smtp_port:-587}
  [[ $smtp_port =~ ^[0-9]{2,5}$ ]] || die "The SMTP port must be a number, like 587 or 465."
  local smtp_secure=false
  [[ $smtp_port == 465 ]] && smtp_secure=true

  local scan=none
  if [[ ${CRM_VIRUS_SCAN-} == 1 ]] || confirm "Scan uploaded files for viruses with ClamAV? (needs about 1.5 GB more memory)" N; then scan=clamav; fi

  # Everything is checked and generated before the file is written, here in
  # this shell, so a problem stops the install instead of leaving a blank.
  name=${name//\'/’}
  no_quote "$smtp_host" "SMTP server"
  no_quote "$smtp_user" "SMTP username"
  no_quote "$smtp_pass" "SMTP password"
  no_quote "$mail_from" "sender address"
  local pg_pass jwt mfa_key storage_key
  pg_pass=$(new_secret); jwt=$(new_secret); mfa_key=$(new_secret); storage_key=$(new_secret)
  for key in "$pg_pass" "$jwt" "$mfa_key" "$storage_key"; do
    [[ $key =~ ^[0-9a-f]{64}$ ]] || die "Could not generate the secret keys (openssl rand)."
  done

  # Written to a temporary file and moved into place, so a failure can never
  # leave a half-written deploy/.env behind.
  local tmp="$ENV_FILE.new"
  umask 077
  cat >"$tmp" <<EOF
# Written by deploy/install.sh on $(date -u +%Y-%m-%d). See deploy/.env.example
# for what each line means. Keep a copy somewhere safe: without the three keys
# below, stored files and two-step sign-in cannot be recovered.

# --- Your platform ---
PLATFORM_DOMAIN=$(quote "$domain")
WEB_ORIGIN=$(quote "https://$domain")
PUBLIC_IP=$(quote "$ip")
ACME_EMAIL=$(quote "$email")
TZ=$(quote "$tz")
PLATFORM_ADMIN_EMAIL=$(quote "$email")
PLATFORM_ADMIN_NAME=$(quote "$name")

# --- Secrets: never change these after launch ---
POSTGRES_PASSWORD=$pg_pass
JWT_SECRET=$jwt
MFA_ENCRYPTION_KEY=$mfa_key
STORAGE_ENCRYPTION_KEY=$storage_key

# --- Email ---
MAIL_DRIVER=$mail_driver
MAIL_FROM=$(quote "$mail_from")
SMTP_HOST=$(quote "$smtp_host")
SMTP_PORT=$smtp_port
SMTP_SECURE=$smtp_secure
SMTP_USER=$(quote "$smtp_user")
SMTP_PASS=$(quote "$smtp_pass")

# --- Files ---
STORAGE_DRIVER=local

# --- Virus scanning ---
VIRUS_SCAN=$scan
CLAMAV_HOST=clamav
EOF
  umask 022
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
  ok "Saved deploy/.env (readable by root only)"
}

# ---------------------------------------------------------------------------
# The server
# ---------------------------------------------------------------------------

need_root() {
  (( EUID == 0 )) || die "Run it as root: sudo bash deploy/install.sh"
}

check_system() {
  step "Checking the server"
  [[ -f $ROOT_DIR/package.json && -f $DEPLOY_DIR/docker-compose.yml ]] ||
    die "Run it from the project folder you copied to the server: sudo bash deploy/install.sh"
  if [[ -r /etc/os-release ]]; then
    local id
    # shellcheck source=/dev/null
    id=$(. /etc/os-release && echo "${ID:-}")
    if [[ $id == ubuntu || $id == debian ]]; then
      # shellcheck source=/dev/null
      ok "$(. /etc/os-release && echo "$PRETTY_NAME")"
    else
      warn "Made for Ubuntu or Debian; this is ${id:-unknown}."
      confirm "Carry on anyway?" N || exit 1
    fi
  fi
  local mem_mb disk_gb
  mem_mb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 ))
  disk_gb=$(( $(df -Pk / | awk 'NR==2 {print $4}') / 1024 / 1024 ))
  if (( mem_mb >= 1800 )); then ok "Memory: ${mem_mb} MB"; else warn "Memory: ${mem_mb} MB - 4 GB is recommended; a swap file is added below."; fi
  if (( disk_gb >= 10 )); then ok "Free disk: ${disk_gb} GB"; else die "Only ${disk_gb} GB of disk is free; at least 10 GB is needed."; fi
}

install_basics() {
  local missing=()
  for cmd in curl openssl git; do command -v "$cmd" >/dev/null || missing+=("$cmd"); done
  command -v crontab >/dev/null || missing+=(cron)
  ((${#missing[@]})) || return 0
  step "Installing ${missing[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates "${missing[@]}" >/dev/null
  ok "Installed"
}

# Building the web app needs about 2 GB of memory; small servers get a swap file.
ensure_swap() {
  local mem_kb swap_kb
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  swap_kb=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)
  (( mem_kb < 3500000 && swap_kb == 0 )) || return 0
  step "Adding a 2 GB swap file (this server has little memory)"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "Swap on"
}

install_docker() {
  step "Docker"
  if ! command -v docker >/dev/null; then
    say "Installing Docker (about 2 minutes)..."
    curl -fsSL https://get.docker.com | sh >/dev/null
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || {
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin >/dev/null
  }
  ok "$(docker --version | sed 's/,.*//'), compose $(docker compose version --short)"
}

open_firewall() {
  command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active' || return 0
  step "Opening ports 80 and 443 in the firewall"
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ok "ufw: 22, 80, 443 open"
}

# Does each address the platform uses lead to this server?
check_dns() {
  step "Checking DNS"
  local domain ip; domain=$(env_get PLATFORM_DOMAIN); ip=$(env_get PUBLIC_IP)
  DNS_OK=1
  local host label found
  for host in "$domain" "admin.$domain" "anything-$RANDOM.$domain"; do
    label=$host
    [[ $host == anything-* ]] && label="*.$domain (every consultancy)"
    found=$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR==1 {print $1}' || true)
    if [[ $found == "$ip" ]]; then
      ok "$label -> $ip"
    else
      warn "$label -> ${found:-nothing} (should be $ip)"
      DNS_OK=0
    fi
  done
  if (( ! DNS_OK )); then
    say ""
    say "At your domain's DNS provider, add (or correct) these two records:"
    say "    A    @    $ip"
    say "    A    *    $ip"
    say "If you use Cloudflare, set both to \"DNS only\" (grey cloud)."
    say "Everything below still works; HTTPS starts by itself once DNS points here."
  fi
}

# ---------------------------------------------------------------------------
# The platform
# ---------------------------------------------------------------------------

compose() { (cd "$DEPLOY_DIR" && docker compose "$@"); }

profiles() { [[ $(env_get VIRUS_SCAN) == clamav ]] && echo "--profile scan" || true; }

backup_if_running() {
  [[ -n $(compose ps --status running -q db 2>/dev/null || true) ]] || return 0
  step "Backing up before the update"
  bash "$DEPLOY_DIR/backup.sh"
}

start_platform() {
  step "Building and starting the platform"
  say "The first build takes 5-10 minutes; later updates are quicker."
  # shellcheck disable=SC2046
  compose $(profiles) up -d --build --remove-orphans
  say "Waiting for the API (it creates or updates the database tables first)..."
  local tries=0
  until compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
    if (( ++tries > 60 )); then
      compose logs --tail=40 api || true
      die "The API did not start within 5 minutes. Its log is above - a missing setting is named at the top."
    fi
    sleep 5
  done
  ok "API running"
  tries=0
  until compose exec -T web node -e "fetch('http://127.0.0.1:3000/sign-in').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
    if (( ++tries > 24 )); then
      compose logs --tail=40 web || true
      die "The web app did not start within 2 minutes. Its log is above."
    fi
    sleep 5
  done
  ok "Web app running"
}

create_admin() {
  step "Your platform admin account"
  local email name out
  email=$(env_get PLATFORM_ADMIN_EMAIL); name=$(env_get PLATFORM_ADMIN_NAME)
  if [[ -z $email ]]; then
    ask CRM_ADMIN_EMAIL "Email for your platform admin account"
    email=$CRM_ADMIN_EMAIL
    valid_email "$email" || die "\"$email\" is not an email address."
    name=${CRM_ADMIN_NAME:-Platform admin}
    name=${name//\'/’}
    printf 'PLATFORM_ADMIN_EMAIL=%s\nPLATFORM_ADMIN_NAME=%s\n' "$(quote "$email")" "$(quote "$name")" >>"$ENV_FILE"
  fi
  out=$(compose exec -T api node dist/db/scripts/create-admin.js --email "$email" --name "${name:-Platform admin}" 2>&1 || exit $?) ||
    { printf '%s\n' "$out"; die "Could not create the admin account."; }
  ADMIN_EMAIL=$email
  ADMIN_PASSWORD=$(printf '%s\n' "$out" | sed -n 's/^\[admin\] password: \([^ ]*\).*/\1/p')
  if [[ -n $ADMIN_PASSWORD ]]; then ok "Created $email"; else ok "$email already exists - its password is unchanged"; fi
}

schedule_backups() {
  step "Nightly backups"
  chmod +x "$DEPLOY_DIR/backup.sh"
  cat >"$CRON_FILE" <<EOF
# Nightly backup of the consultancy CRM (database and uploaded files, 14 days
# kept in $DEPLOY_DIR/backups). Written by deploy/install.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 2 * * * root bash '$DEPLOY_DIR/backup.sh' >> /var/log/crm-backup.log 2>&1
EOF
  chmod 644 "$CRON_FILE"
  ok "Every night at 02:15 into deploy/backups (log: /var/log/crm-backup.log)"
}

# Asking for the admin address over HTTPS is also what makes Caddy fetch its
# certificate, so the first visitor does not wait for it.
check_https() {
  (( DNS_OK )) || return 0
  step "HTTPS"
  local domain; domain=$(env_get PLATFORM_DOMAIN)
  local tries=0
  until curl -fsS --max-time 20 "https://admin.$domain/api/health" >/dev/null 2>&1; do
    if (( ++tries > 6 )); then
      warn "https://admin.$domain does not answer yet. Check that ports 80 and 443 are open in your hosting provider's firewall; 'docker compose logs caddy' (in deploy/) names the problem."
      HTTPS_OK=0
      return 0
    fi
    sleep 10
  done
  ok "https://admin.$domain has a certificate"
  HTTPS_OK=1
}

summary() {
  local domain; domain=$(env_get PLATFORM_DOMAIN)
  printf '\n%s%s%s\n' "$green$bold" "The platform is running." "$reset"
  printf '\n    Admin:     https://admin.%s\n' "$domain"
  printf '    Sign in:   %s\n' "$ADMIN_EMAIL"
  if [[ -n ${ADMIN_PASSWORD-} ]]; then
    printf '    Password:  %s%s%s   (shown once - write it down)\n' "$bold" "$ADMIN_PASSWORD" "$reset"
  fi
  printf '\n    Next:\n'
  printf '     1. Sign in, change the password under your account, switch on two-step verification.\n'
  printf '     2. Settings: how consultancies pay you, and your terms and privacy policy.\n'
  printf '     3. Add your first consultancy.\n'
  if [[ $(env_get MAIL_DRIVER) != smtp ]]; then
    printf '\n    %s!%s Email is not set up, so invitations and password links are not sent.\n' "$yellow" "$reset"
    printf '      Add the SMTP_* lines to deploy/.env, set MAIL_DRIVER=smtp, and run this again.\n'
  fi
  if (( ! DNS_OK )); then
    printf '\n    %s!%s DNS does not point here yet (see above). HTTPS starts by itself once it does.\n' "$yellow" "$reset"
  elif (( ! HTTPS_OK )); then
    printf "\n    %s!%s HTTPS did not answer yet: open ports 80 and 443 in your hosting provider's firewall.\n" "$yellow" "$reset"
  fi
  printf '\n    Backups:   nightly in %s/backups - copy them off this server too.\n' "$DEPLOY_DIR"
  printf '    Update:    git pull, then run  sudo bash deploy/install.sh  again.\n'
  printf '    Keep a copy of deploy/.env somewhere safe: it holds the encryption keys.\n\n'
}

main() {
  trap 'die "Something failed on line $LINENO (above). Fix it and run the same command again - it is safe to repeat."' ERR
  printf '%sConsultancy CRM - install and update%s\n' "$bold" "$reset"
  need_root
  check_system
  install_basics
  ensure_swap
  install_docker
  configure
  open_firewall
  check_dns
  backup_if_running
  start_platform
  create_admin
  schedule_backups
  HTTPS_OK=0
  check_https
  summary
}

# Sourcing the file (the tests do) defines the functions without running anything.
if [[ ${BASH_SOURCE[0]:-$0} == "$0" ]]; then main "$@"; fi
