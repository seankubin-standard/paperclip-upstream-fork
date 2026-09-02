#!/usr/bin/env bash
# setup-email.sh — interactive installer for email transport (password reset).
#
# Run once at install time (or whenever you need to rotate credentials):
#   bash scripts/setup-email.sh
#
# Writes non-secret config to .env.local; writes the API key / SMTP password
# to a gitignored secrets file (default: .secrets/email.env) so credentials
# never enter version control.
#
# Usage in server startup: dotenv loads .env.local then .secrets/email.env.
# Both files are in .gitignore.

set -euo pipefail

ENV_FILE="${PAPERCLIP_ENV_FILE:-$(dirname "$0")/../.env.local}"
SECRETS_DIR="$(dirname "$0")/../.secrets"
SECRETS_FILE="${SECRETS_DIR}/email.env"

mkdir -p "$SECRETS_DIR"

echo ""
echo "=== Dr. Clippy — Email transport setup ==="
echo ""
echo "This script configures the transactional email provider used to send"
echo "password-reset emails. Credentials are written to gitignored files"
echo "and never committed to the repository."
echo ""
echo "Choose an email provider:"
echo "  1) Resend (recommended — scoped API key, easy to rotate)"
echo "  2) SMTP   (self-hosted or any SMTP-compatible provider)"
echo "  3) None   (disable email; password reset will not work)"
echo ""
read -rp "Choice [1]: " CHOICE
CHOICE="${CHOICE:-1}"

write_env_var() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    # Replace existing line
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

case "$CHOICE" in
  1)
    echo ""
    echo "Resend setup — create an API key at https://resend.com/api-keys"
    echo "Scope the key to 'Send access' for the drclippy.com domain only."
    echo ""
    read -rp "Resend API key (re_...): " RESEND_KEY
    if [[ -z "$RESEND_KEY" ]]; then
      echo "Error: API key cannot be empty." >&2
      exit 1
    fi
    read -rp "From address [Dr. Clippy <noreply@drclippy.com>]: " FROM_ADDR
    FROM_ADDR="${FROM_ADDR:-Dr. Clippy <noreply@drclippy.com>}"

    write_env_var "$ENV_FILE" EMAIL_PROVIDER resend
    write_env_var "$ENV_FILE" EMAIL_FROM     "$FROM_ADDR"
    # API key goes to the secrets file, not the shared env file.
    write_env_var "$SECRETS_FILE" RESEND_API_KEY "$RESEND_KEY"

    echo ""
    echo "✓ Resend configured."
    echo "  Config  → $ENV_FILE"
    echo "  API key → $SECRETS_FILE  (gitignored)"
    ;;

  2)
    echo ""
    read -rp "SMTP host:              " SMTP_HOST
    read -rp "SMTP port [587]:        " SMTP_PORT
    SMTP_PORT="${SMTP_PORT:-587}"
    read -rp "SMTP username:          " SMTP_USER
    read -rsp "SMTP password:          " SMTP_PASS; echo ""
    read -rp "From address [Dr. Clippy <noreply@drclippy.com>]: " FROM_ADDR
    FROM_ADDR="${FROM_ADDR:-Dr. Clippy <noreply@drclippy.com>}"

    if [[ -z "$SMTP_HOST" || -z "$SMTP_USER" || -z "$SMTP_PASS" ]]; then
      echo "Error: host, user, and password are required." >&2
      exit 1
    fi

    write_env_var "$ENV_FILE" EMAIL_PROVIDER smtp
    write_env_var "$ENV_FILE" EMAIL_FROM     "$FROM_ADDR"
    write_env_var "$ENV_FILE" SMTP_HOST      "$SMTP_HOST"
    write_env_var "$ENV_FILE" SMTP_PORT      "$SMTP_PORT"
    write_env_var "$ENV_FILE" SMTP_USER      "$SMTP_USER"
    # Password goes to the secrets file.
    write_env_var "$SECRETS_FILE" SMTP_PASS  "$SMTP_PASS"

    echo ""
    echo "✓ SMTP configured."
    echo "  Config   → $ENV_FILE"
    echo "  Password → $SECRETS_FILE  (gitignored)"
    ;;

  3)
    echo ""
    echo "Email transport disabled. Password reset emails will not be sent."
    write_env_var "$ENV_FILE" EMAIL_PROVIDER none
    ;;

  *)
    echo "Invalid choice." >&2
    exit 1
    ;;
esac

# Ensure secrets dir/file are not world-readable.
chmod 700 "$SECRETS_DIR"
chmod 600 "$SECRETS_FILE" 2>/dev/null || true

echo ""
echo "Done. Restart the server to pick up changes."
echo ""
echo "NOTE: $SECRETS_FILE is gitignored and must be provisioned on every"
echo "new server instance. Back it up securely (e.g. in a secrets manager)."
