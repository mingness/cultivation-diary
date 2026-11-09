#!/bin/sh
# Writes deploy/.env for a server deploy, with freshly generated keys. Run once per server, with the diary's
# and the mantra site's hostnames (docs/ARCHITECTURE.md §8.11):
#   sh deploy/make-env.sh diary.gcdr.org.au mantra.gcdr.org.au
# Then copy deploy/.env somewhere safe off the server: losing DIARY_KEYRING or PROFILE_KEYRING loses every
# diary and profile, and the database backups can't be read without them.
set -eu

domain=${1:-}
mantra_domain=${2:-}
if [ -z "$domain" ] || [ -z "$mantra_domain" ]; then
  echo "Usage: sh deploy/make-env.sh <diary domain> <mantra domain>" >&2
  echo "   e.g. diary.gcdr.org.au mantra.gcdr.org.au, or diary.203-0-113-7.sslip.io mantra.203-0-113-7.sslip.io" >&2
  exit 1
fi

target="$(dirname "$0")/.env"
if [ -e "$target" ]; then
  echo "$target already exists; leaving it alone. New keys would make the existing data unreadable." >&2
  exit 1
fi

hex() { openssl rand -hex "$1"; }

umask 077
cat >"$target" <<ENV
# Written by deploy/make-env.sh on $(date -u +%Y-%m-%d). Secrets: keep a copy offline, never commit.
DOMAIN=$domain
MANTRA_DOMAIN=$mantra_domain
# The diary's sign-in page links here for people who only take part in 報數.
MANTRA_URL=https://$mantra_domain
LOG_LEVEL=info
# Registering on the mantra site, which only ever makes mantra-only accounts (D30). Set to false to close it,
# e.g. against spam signups. Diary accounts are always created by admins under 用戶.
REGISTRATION_OPEN=true

POSTGRES_PASSWORD=$(hex 16)
# Losing either keyring loses the data it protects. Back them up separately from database backups.
DIARY_KEYRING=v1:$(hex 32)
PROFILE_KEYRING=v1:$(hex 32)
SESSION_SECRET=$(hex 32)
CRON_SECRET=$(hex 32)

# Optional: admin alert emails (see .env.example). Both or neither.
SMTP_URL=
MAIL_FROM=

# Optional: translation (see .env.example). All three or none; the URL must be https://.
TRANSLATE_API_URL=
TRANSLATE_API_KEY=
TRANSLATE_MODEL=
ENV

echo "Wrote $target. Copy it somewhere safe off this server now."
