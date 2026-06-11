# Knoda.ai — Deployment Guide

Two backend deployment options are supported. Choose one:

| Option | Cost | Complexity | HTTPS | Auto-deploy |
|--------|------|------------|-------|-------------|
| **DigitalOcean App Platform** | ~$15/month | Low — deploy from GitHub, done | Automatic | Yes |
| **AWS EC2** | ~$15/month | Medium — SSH + Docker setup | Manual (Nginx) | No |

---

## Option A — DigitalOcean App Platform (Recommended)

### Architecture

```
User → Vercel (Next.js frontend)
         ↓ HTTPS API calls
       DigitalOcean App Platform (FastAPI, auto-HTTPS, auto-deploy)
         ↓ SQL queries
       Supabase (PostgreSQL + Auth + Vault)
```

### Steps

**1. Create a DigitalOcean account** at [cloud.digitalocean.com](https://cloud.digitalocean.com)

**2. Create the App**
- Go to **Apps → Create App**
- Connect your GitHub account → select `itsamoghgr/knoda-ai`
- Branch: `main` — enable **Autodeploy**
- DigitalOcean will detect `.do/app.yaml` automatically and pre-fill the config

**3. Set the secret environment variables**

The `.do/app.yaml` defines all variables. For the ones marked `SECRET`, paste the real values in the DO dashboard:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql+asyncpg://postgres.[ref]:PASSWORD@aws-0-[region].pooler.supabase.com:5432/postgres` |
| `ALEMBIC_DATABASE_URL` | Same as DATABASE_URL |
| `SUPABASE_URL` | `https://[ref].supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |

Also update `CORS_ORIGINS` to your Vercel URL:
```
["https://db-discovery-agent.vercel.app"]
```

**4. Deploy**
- Click **Create Resources** — DO builds and deploys automatically (~3-5 min)
- Your backend URL will be: `https://knoda-backend-xxxxx.ondigitalocean.app`

**5. Update Vercel env var**

In Vercel → your project → **Settings → Environment Variables**:
```
NEXT_PUBLIC_API_URL=https://knoda-backend-xxxxx.ondigitalocean.app/api/v1
```
Then redeploy Vercel.

**6. Update Supabase Auth**

Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://db-discovery-agent.vercel.app`
- **Redirect URLs**: `https://db-discovery-agent.vercel.app/auth/callback`

### Updating after code changes
Push to `main` → DigitalOcean auto-deploys. No SSH needed.

---

## Option B — AWS EC2 (Manual)

### Architecture

```
User → Vercel (Next.js frontend)
         ↓ HTTPS API calls
       AWS EC2 t3.small (FastAPI backend via Docker + Nginx)
         ↓ SQL queries
       Supabase (PostgreSQL + Auth + Vault)
```

## Prerequisites

- AWS account with EC2 access
- Supabase project set up with pgvector enabled (migrations already run)
- GitHub repo: `itsamoghgr/knoda-ai`
- Vercel account
- A domain you control — this guide uses `api.knoda.ai` for the backend and
  `https://db-discovery-agent.vercel.app` for the frontend

---

## Step 1 — Launch EC2 Instance

1. Go to [AWS Console](https://console.aws.amazon.com) → **EC2 → Launch Instance**
2. Settings:
   - **AMI**: Ubuntu Server 22.04 LTS
   - **Instance type**: `t3.small` minimum (2GB RAM — required for the LangGraph
     agents and Playwright/Chromium used by meeting mode). Use `t3.medium` if you
     rely on meeting/presentation mode heavily.
   - **Storage**: 20 GB (the backend image installs Chromium; the default 8 GB is tight)
   - **Key pair**: Create new → download `.pem` file → store securely
   - **Security group inbound rules**:
     - SSH (22) — My IP only
     - HTTP (80) — 0.0.0.0/0 (required for Let's Encrypt + HTTP→HTTPS redirect)
     - HTTPS (443) — 0.0.0.0/0
3. Launch and note the **Public IPv4 address**. Attach an **Elastic IP** so the
   address survives reboots (your DNS record depends on it).

---

## Step 2 — Point DNS at the instance

At your DNS provider, add an **A record**:

```
api.knoda.ai  →  <your EC2 Elastic IP>
```

Confirm it resolves before issuing the certificate in Step 7:

```bash
dig +short api.knoda.ai   # must return your EC2 IP
```

---

## Step 3 — SSH into the Server

```bash
chmod 400 ~/Downloads/your-key.pem
ssh -i ~/Downloads/your-key.pem ubuntu@YOUR-EC2-IP
```

---

## Step 4 — Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Step 5 — Clone and Configure

The repo is public, so an HTTPS clone needs no deploy key:

```bash
git clone https://github.com/itsamoghgr/knoda-ai.git
cd knoda-ai

# Create the production env file (gitignored — never commit it)
cp docker/.env.prod.example docker/.env.prod
nano docker/.env.prod   # fill in your Supabase + LLM values
```

Set `CORS_ORIGINS=["https://db-discovery-agent.vercel.app"]` and your real
Supabase `DATABASE_URL` / `ALEMBIC_DATABASE_URL` / `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY`.

> **Important:** If your Supabase password contains `$`, escape it as `$$` in the env file
> (docker compose interpolates the env file).

The shipped `docker/nginx.conf` is already set to `server_name api.knoda.ai`. If you
use a different subdomain, update it:

```bash
sed -i 's/api\.knoda\.ai/api.your-domain.com/g' docker/nginx.conf
```

---

## Step 6 — Issue the TLS certificate

`nginx.conf` references a Let's Encrypt cert that doesn't exist yet, so Nginx won't
start until it's issued. Use standalone certbot (port 80 must be free and DNS must
already resolve to this box):

```bash
sudo apt-get update && sudo apt-get install -y certbot
sudo certbot certonly --standalone -d api.knoda.ai \
  --non-interactive --agree-tos -m itsamoghgr@gmail.com
```

Certs are written to `/etc/letsencrypt/live/api.knoda.ai/`, which the prod compose
file already mounts read-only into the Nginx container.

---

## Step 7 — Start the Backend

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d --build
```

The API container runs `alembic upgrade head` then starts uvicorn. The first build is
slow (it installs Chromium). Verify:

```bash
docker compose -f docker/docker-compose.prod.yml ps
docker compose -f docker/docker-compose.prod.yml logs api --tail=40
curl https://api.knoda.ai/api/v1/health   # expect {"status":"ok",...}
```

---

## Step 8 — Auto-renew the certificate

Let's Encrypt certs expire after 90 days. Reload Nginx automatically on renewal:

```bash
echo '0 3 * * * root certbot renew --quiet --deploy-hook "docker compose -f /home/ubuntu/knoda-ai/docker/docker-compose.prod.yml restart nginx"' | sudo tee /etc/cron.d/certbot-renew
```

---

## Step 9 — Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import `itsamoghgr/knoda-ai`
2. Set **Root Directory** to `frontend`
3. Add **Environment Variables**:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://[ref].supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
| `NEXT_PUBLIC_API_URL` | `https://api.knoda.ai/api/v1` |

4. Click **Deploy**

---

## Step 10 — Update Supabase Auth

In Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://db-discovery-agent.vercel.app`
- **Redirect URLs**: `https://db-discovery-agent.vercel.app/auth/callback`

---

## Updating the Backend (after code changes)

```bash
ssh -i ~/Downloads/your-key.pem ubuntu@YOUR-EC2-IP
cd knoda-ai
git pull origin main
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d --build
```

---

## Useful Commands

```bash
# View logs
docker compose -f docker/docker-compose.prod.yml logs api -f

# Restart containers
docker compose -f docker/docker-compose.prod.yml restart

# Stop everything
docker compose -f docker/docker-compose.prod.yml down

# Check container status
docker compose -f docker/docker-compose.prod.yml ps
```

---

## Environment Variables Reference

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase session pooler URL (asyncpg, port 5432) |
| `ALEMBIC_DATABASE_URL` | Same as DATABASE_URL for migrations |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (backend auth) |
| `LLM_PROVIDER` | Default: `openai` (overridden per-user via Settings UI) |
| `LLM_API_KEY` | Optional fallback API key |
| `LLM_MODEL` | Default model name |
| `CORS_ORIGINS` | JSON array of allowed frontend origins |
| `MAX_ROWS_PER_QUERY` | Safety limit for query results |
| `QUERY_TIMEOUT_SECONDS` | Query execution timeout |
