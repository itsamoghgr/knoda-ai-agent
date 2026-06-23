#!/usr/bin/env bash
#
# deploy.sh — one-shot production deploy for Knoda AI on EC2.
#
# Usage (from the repo root, after `git pull`):
#   ./deploy.sh
#
# What it does:
#   1. Preflight: checks docker / docker compose / required tools and root dir.
#   2. Ensures docker/.env.prod exists and is filled in (creates from example if missing).
#   3. Ensures the Let's Encrypt TLS cert for the API domain exists (auto-issues if not).
#   4. Installs the cert auto-renew cron on first run.
#   5. Builds and starts the stack (api + nginx) via docker compose.
#   6. Waits for the backend health check and reports clear success / failure.
#
# Exits non-zero on any failure, with the relevant logs printed.

set -Eeuo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────
DOMAIN="api-knoda.itsamoghgr.com"
CERTBOT_EMAIL="itsamoghgr@gmail.com"
COMPOSE_FILE="docker/docker-compose.prod.yml"
ENV_FILE="docker/.env.prod"
ENV_EXAMPLE="docker/.env.prod.example"
HEALTH_URL="https://${DOMAIN}/api/v1/health"
HEALTH_RETRIES=30          # ~30 * 5s = 2.5 min max wait
HEALTH_INTERVAL=5

# ──────────────────────────────────────────────────────────────────────────────
# Pretty output helpers
# ──────────────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; BOLD=""; NC=""
fi

step()  { echo; echo "${BLUE}${BOLD}▶ $*${NC}"; }
info()  { echo "  $*"; }
ok()    { echo "  ${GREEN}✔${NC} $*"; }
warn()  { echo "  ${YELLOW}⚠${NC} $*"; }
fail()  { echo "  ${RED}✘ $*${NC}" >&2; }

# Trap: any unexpected error lands here with a clear message + the line number.
trap 'fail "Deployment failed at line ${LINENO}. See the output above for details."; exit 1' ERR

# Resolve to the repo root (directory this script lives in), so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# docker compose may be the v2 plugin ("docker compose") or legacy ("docker-compose").
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

# Run a command as root only when we aren't already root.
as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# 1. Preflight
# ──────────────────────────────────────────────────────────────────────────────
step "1/6  Preflight checks"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  fail "Cannot find $COMPOSE_FILE. Run this script from the repo root."
  exit 1
fi
ok "Running from repo root: $SCRIPT_DIR"

missing=()
for bin in docker curl; do
  command -v "$bin" >/dev/null 2>&1 || missing+=("$bin")
done
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  missing+=("docker compose")
fi
if (( ${#missing[@]} > 0 )); then
  fail "Missing required tools: ${missing[*]}"
  info "Install them and re-run. (Docker: https://docs.docker.com/engine/install/)"
  exit 1
fi
ok "docker, docker compose, curl present"

if ! docker info >/dev/null 2>&1; then
  fail "Cannot talk to the Docker daemon."
  info "Start it (sudo systemctl start docker) or add your user to the 'docker' group."
  exit 1
fi
ok "Docker daemon reachable"

# ──────────────────────────────────────────────────────────────────────────────
# 2. Environment file
# ──────────────────────────────────────────────────────────────────────────────
step "2/6  Environment (${ENV_FILE})"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    warn "Created ${ENV_FILE} from the example."
    fail "Fill in real values (Supabase URL/keys, LLM key, CORS) then re-run ./deploy.sh"
    info "Edit it with:  nano ${ENV_FILE}"
    exit 1
  else
    fail "${ENV_FILE} is missing and no ${ENV_EXAMPLE} to copy from."
    exit 1
  fi
fi
ok "${ENV_FILE} exists"

# Catch the common mistake of leaving example placeholders in place.
placeholder_hits=$(grep -nE '\[ref\]|\[region\]|your-service-role-key|PASSWORD@' "$ENV_FILE" || true)
if [[ -n "$placeholder_hits" ]]; then
  fail "${ENV_FILE} still contains placeholder values:"
  echo "$placeholder_hits" | sed 's/^/      /'
  info "Replace them with real values and re-run."
  exit 1
fi

# Required keys must be present and non-empty.
required_keys=(DATABASE_URL ALEMBIC_DATABASE_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CORS_ORIGINS)
for key in "${required_keys[@]}"; do
  val=$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)
  if [[ -z "${val//[[:space:]]/}" ]]; then
    fail "Required env var ${key} is missing or empty in ${ENV_FILE}"
    exit 1
  fi
done
ok "Required env vars present"

# ──────────────────────────────────────────────────────────────────────────────
# 3. TLS certificate (nginx won't start without it)
# ──────────────────────────────────────────────────────────────────────────────
step "3/6  TLS certificate for ${DOMAIN}"

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if as_root test -f "$CERT_PATH"; then
  ok "Certificate already present"
else
  warn "No certificate found — issuing one with certbot (standalone)."

  if ! command -v certbot >/dev/null 2>&1; then
    info "Installing certbot..."
    if command -v apt-get >/dev/null 2>&1; then
      as_root apt-get update -y
      as_root apt-get install -y certbot
    elif command -v dnf >/dev/null 2>&1; then
      as_root dnf install -y certbot
    elif command -v yum >/dev/null 2>&1; then
      as_root yum install -y certbot
    else
      fail "Could not auto-install certbot (no apt/dnf/yum). Install it manually and re-run."
      exit 1
    fi
  fi

  # DNS must point at this box before Let's Encrypt's HTTP-01 challenge can succeed.
  info "Checking DNS for ${DOMAIN}..."
  resolved=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ -z "$resolved" ]]; then
    fail "${DOMAIN} does not resolve. Add an A record pointing at this server's IP, then re-run."
    exit 1
  fi
  ok "DNS resolves to ${resolved}"

  # certbot standalone needs port 80 free — stop nginx if it's already running.
  info "Freeing port 80 (stopping nginx container if running)..."
  compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop nginx >/dev/null 2>&1 || true

  info "Requesting certificate..."
  as_root certbot certonly --standalone \
    -d "$DOMAIN" \
    --non-interactive --agree-tos -m "$CERTBOT_EMAIL"

  if as_root test -f "$CERT_PATH"; then
    ok "Certificate issued"
  else
    fail "certbot ran but the certificate is still missing at ${CERT_PATH}"
    exit 1
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
# 4. Cert auto-renew cron (install once)
# ──────────────────────────────────────────────────────────────────────────────
step "4/6  Cert auto-renew cron"

CRON_FILE="/etc/cron.d/certbot-renew"
RENEW_LINE="0 3 * * * root certbot renew --quiet --deploy-hook \"cd ${SCRIPT_DIR} && $(command -v docker) compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} restart nginx\""

if as_root test -f "$CRON_FILE"; then
  ok "Renew cron already installed"
else
  echo "$RENEW_LINE" | as_root tee "$CRON_FILE" >/dev/null
  as_root chmod 0644 "$CRON_FILE"
  ok "Installed renew cron at ${CRON_FILE}"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 5. Build & start the stack
# ──────────────────────────────────────────────────────────────────────────────
step "5/6  Build & start (docker compose)"

info "Building images and starting containers (this can take a few minutes)..."
compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

ok "Containers started"
compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

# ──────────────────────────────────────────────────────────────────────────────
# 6. Health check
# ──────────────────────────────────────────────────────────────────────────────
step "6/6  Health check"

info "Polling ${HEALTH_URL} ..."
healthy=false
for ((i=1; i<=HEALTH_RETRIES; i++)); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  printf "  ...attempt %d/%d not ready yet\n" "$i" "$HEALTH_RETRIES"
  sleep "$HEALTH_INTERVAL"
done

echo
if [[ "$healthy" == true ]]; then
  echo "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "${GREEN}${BOLD}  ✅  DEPLOY SUCCESSFUL${NC}"
  echo "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "  API:     ${HEALTH_URL}"
  echo "  Health:  $(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || echo 'ok')"
  echo "  Logs:    $(command -v docker) compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} logs -f api"
  echo
  # Disarm the ERR trap so a clean exit doesn't print the failure message.
  trap - ERR
  exit 0
else
  echo "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "${RED}${BOLD}  ❌  DEPLOY FAILED — backend did not become healthy${NC}"
  echo "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo
  warn "Last 40 lines of the API container logs:"
  compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=40 api || true
  echo
  warn "Container status:"
  compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps || true
  echo
  info "Common causes: bad DATABASE_URL, wrong Supabase keys, or CORS_ORIGINS mismatch in ${ENV_FILE}."
  trap - ERR
  exit 1
fi
