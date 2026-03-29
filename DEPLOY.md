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
- Connect your GitHub account → select `itsamoghgr/db-discovery-agent`
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
["https://your-app.vercel.app"]
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
- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs**: `https://your-app.vercel.app/auth/callback`

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
- Supabase project set up (migrations already run)
- GitHub repo: `itsamoghgr/db-discovery-agent`
- Vercel account

---

## Step 1 — Launch EC2 Instance

1. Go to [AWS Console](https://console.aws.amazon.com) → **EC2 → Launch Instance**
2. Settings:
   - **AMI**: Ubuntu Server 22.04 LTS (recommended) or Amazon Linux 2023
   - **Instance type**: `t3.small` (2GB RAM — required for LangGraph agents)
   - **Key pair**: Create new → download `.pem` file → store securely
   - **Security group inbound rules**:
     - SSH (22) — My IP only
     - HTTP (80) — 0.0.0.0/0
     - Custom TCP (8000) — 0.0.0.0/0 (optional, for direct API access)
3. Launch and note the **Public IPv4 address**

---

## Step 2 — SSH into the Server

```bash
chmod 400 ~/Downloads/knoda-key.pem
ssh -i ~/Downloads/knoda-key.pem ubuntu@YOUR-EC2-IP
```

---

## Step 3 — Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Step 4 — Add Deploy Key (no GitHub login needed)

```bash
ssh-keygen -t ed25519 -C "knoda-ec2-deploy" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub   # copy this output

cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_key
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

Add the public key to GitHub: `repo → Settings → Deploy keys → Add deploy key`

---

## Step 5 — Clone and Configure

```bash
git clone git@github.com:itsamoghgr/db-discovery-agent.git
cd db-discovery-agent

# Create production env file (never commit this file)
cat > docker/.env.prod << 'EOF'
DATABASE_URL=postgresql+asyncpg://postgres.[ref]:PASSWORD@aws-0-[region].pooler.supabase.com:5432/postgres
ALEMBIC_DATABASE_URL=postgresql+asyncpg://postgres.[ref]:PASSWORD@aws-0-[region].pooler.supabase.com:5432/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
LLM_PROVIDER=openai
LLM_API_KEY=
LLM_MODEL=gpt-4o
CORS_ORIGINS=["https://your-app.vercel.app"]
MAX_ROWS_PER_QUERY=1000
QUERY_TIMEOUT_SECONDS=30
EOF
```

> **Important:** If your Supabase password contains `$`, escape it as `$$` in the env file.

---

## Step 6 — Start the Backend

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d --build
```

**Verify it's running:**
```bash
docker compose -f docker/docker-compose.prod.yml logs api --tail=30
curl http://localhost:80/api/v1/health
```

---

## Step 7 — Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import `itsamoghgr/db-discovery-agent`
2. Set **Root Directory** to `frontend`
3. Add **Environment Variables**:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://[ref].supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
| `NEXT_PUBLIC_API_URL` | `http://YOUR-EC2-IP/api/v1` |

4. Click **Deploy**

---

## Step 8 — Update Supabase Auth

In Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs**: `https://your-app.vercel.app/auth/callback`

---

## Updating the Backend (after code changes)

```bash
ssh -i ~/Downloads/knoda-key.pem ubuntu@YOUR-EC2-IP
cd db-discovery-agent
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
