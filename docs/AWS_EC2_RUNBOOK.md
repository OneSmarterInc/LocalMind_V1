# LocalMind on AWS EC2: Production Runbook

Written for someone doing this for the first time. Follow the steps in order. Every command is copy-and-paste. Replace `localmind.onesmarter.com` with your real domain everywhere.

Written for branch `deploy/aws-ec2` of `LocalMind_V1`, where the config files below are already in the repo (September 26, 2026).

## The plan in one paragraph

One EC2 server (t3a.xlarge: 4 vCPUs, 16 GB memory, Ubuntu) runs four Docker containers: PostgreSQL (the database), the Django API with the small AI model, a maintenance loop, and Caddy (which gives you free https). The website is served by the same server, so there is no Vercel, no load balancer and no RDS. Students' phones and browsers download the 1.1 GB model from Hugging Face, not from AWS, and lessons and quizzes are generated on their devices. Expected cost is about $122 a month on-demand, dropping to about $82 to $92 once you buy a 1-year Savings Plan.

## Files you will use

| File in the repo | Where it goes on the server | What it is |
|---|---|---|
| `backend/.env.example` | copy to `deploy/.env` | Production settings. Fill in every `CHANGE_ME`. |
| `deploy/docker-compose.yml` | already in place | PostgreSQL, API, maintenance loop and Caddy. |
| `deploy/Caddyfile` | already in place; check the domain on line 3 | Tells Caddy your domain. Gets the https certificate automatically. |

## What changed from the laptop `.env`

| Setting | Laptop | Production | Why |
|---|---|---|---|
| `DJANGO_SECRET_KEY` | old value | new value | The old one was shared in chat. Never reuse it. |
| `DJANGO_ALLOWED_HOSTS` | `*` | your domain | `*` lets anyone point any hostname at you. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Tailscale address | `https://` + your domain | Admin sign-in fails otherwise. |
| `DJANGO_CORS_ALLOWED_ORIGINS` | localhost dev ports | your domain | Dev ports are not needed on a server. |
| `DATABASE_URL`, `SQLITE_BUSY_TIMEOUT_SECONDS` | SQLite on `C:` | removed | PostgreSQL is set by docker-compose from `POSTGRES_PASSWORD`. |
| `POSTGRES_PASSWORD` | not present | new | Database password. |
| `MEDIA_ROOT`, `WEB_DIST` | Windows paths | removed | docker-compose sets Linux paths. |
| `INITIAL_USER_PASSWORD` | old value | new value | The default is printed in the public README. |
| `BOOTSTRAP_ADMIN_EMAIL` | not present | admin email | Creates the first admin automatically. |
| `ACCESS_TOKEN_MINUTES` | 180 | 60 | 180 was for tester comfort. |
| `AI_THREADS` | 8 | 4 | Must match the t3a.xlarge's 4 vCPUs. |
| `OLLAMA_TIMEOUT_SECONDS` | 90 | 150 | 90 was a Cloudflare workaround. Caddy has no 100-second limit. |
| `HF_HUB_OFFLINE` | off | `1` | Models are copied in, so no Hugging Face calls at runtime. |
| `STUDY_SIGNING_KEY_PATH` / `_ID` | `C:` path, `localmind-test-1` | `/app/keys/publisher.pem`, `localmind-prod-1` | New key made on the server. The test key stays on the laptop. |

Everything else is unchanged.

## Step 0. Before you start (15 minutes)

1. **Decide the domain.** For example `localmind.onesmarter.com`. You need access to the DNS settings for `onesmarter.com`.
2. **Decide: fresh start or move the laptop data?** A fresh start is much easier. Move data only if the test content (books, users, quiz results) must be kept. See Step 12.
3. **Secure the AWS account.** Turn on MFA for the root user. Create a budget alert: AWS Console, then Billing and Cost Management, then Budgets, then create a monthly cost budget of $150 with an email alert at 80%. This is free and catches surprises.

## Step 1. Launch the EC2 server (20 minutes)

1. Open the AWS Console. Top right, pick the region closest to your users: **US East (Ohio) `us-east-2`** for US users, **Asia Pacific (Mumbai) `ap-south-1`** for India. Everything below must be created in that same region.
2. Go to **EC2**, then **Launch instance**.
3. **Name:** `localmind-prod`.
4. **Image (AMI):** Ubuntu Server **24.04 LTS**, architecture **64-bit (x86)**. Do not pick Arm; the AI library in this project is built for x86.
5. **Instance type:** `t3a.xlarge` (4 vCPUs, 16 GiB).
6. **Key pair:** click **Create new key pair**, name `localmind-prod-key`, type RSA, format `.pem`. It downloads once. Keep it safe; you cannot download it again.
7. **Network settings:** click **Edit**. Keep the default VPC and a public subnet, **Auto-assign public IP: Enable**. Create a new security group called `localmind-web` with three rules:
   - SSH, port 22, source **My IP**
   - HTTP, port 80, source **Anywhere (0.0.0.0/0)**
   - HTTPS, port 443, source **Anywhere (0.0.0.0/0)**
8. **Storage:** **60 GiB**, volume type **gp3**, and tick **Encrypted**.
9. **Advanced details:**
   - **Termination protection:** Enable (stops anyone deleting it by accident).
   - **Credit specification:** **Standard** (see the cost section; this prevents surprise CPU charges).
10. Click **Launch instance**.

## Step 2. Give it a fixed address and point your domain at it (10 minutes, then wait)

1. In EC2, go to **Elastic IPs**, then **Allocate Elastic IP address**, then **Allocate**.
2. Select the new address, **Actions**, **Associate Elastic IP address**, choose `localmind-prod`, **Associate**. Without this, the address changes every time the server stops.
3. In your DNS provider for `onesmarter.com`, add an **A record**: name `localmind`, value = the Elastic IP. It can take a few minutes to an hour to work. Check with `ping localmind.onesmarter.com`.

## Step 3. Connect to the server and install Docker (15 minutes)

Easiest way: in EC2, select the instance, click **Connect**, tab **EC2 Instance Connect**, user `ubuntu`, **Connect**. A terminal opens in the browser.

From your own laptop instead (PowerShell), first lock the key file so SSH accepts it, then connect:

```powershell
icacls C:\path\to\localmind-prod-key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i C:\path\to\localmind-prod-key.pem ubuntu@<ELASTIC-IP>
```

On the server:

```bash
sudo apt-get update && sudo apt-get -y upgrade

# 4 GB swap file: a safety net so a big PDF upload slows down instead of crashing
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Reconnect (so the Docker permission takes effect) and check:

```bash
docker --version
docker compose version
free -h          # should show about 15 Gi memory and 4 Gi swap
```

## Step 4. Get the code and build the website (15 minutes)

```bash
cd ~
git clone https://github.com/OneSmarterInc/LocalMind_V1.git
cd LocalMind_V1
git checkout deploy/aws-ec2      # until this branch is merged into main

# Node 20 for building the web client
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

cd frontend
npm ci
npm run export:web
cd ..
ls frontend/dist/index.html   # must exist
```

The repo is private, so `git clone` will ask for your GitHub username and a personal access token (not your password).

## Step 5. Copy the AI models from the laptop (20 to 40 minutes)

The laptop already has `backend\models` (the `.gguf` file and the `docling` folder). Copying it is faster and more reliable than downloading on the server.

On the laptop, in PowerShell (same key file as Step 3):

```powershell
scp -i C:\path\to\localmind-prod-key.pem -r C:\path\to\LocalMind_V1\backend\models ubuntu@<ELASTIC-IP>:/home/ubuntu/LocalMind_V1/backend/
```

On the server, check:

```bash
ls ~/LocalMind_V1/backend/models            # Qwen3-1.7B-Q4_K_M.gguf and docling/
```

## Step 6. Fill in the settings (10 minutes)

```bash
cd ~/LocalMind_V1/deploy
cp ../backend/.env.example .env
nano .env              # fill in every CHANGE_ME, save with Ctrl+O, Enter, Ctrl+X
nano Caddyfile         # check the domain on the first line
mkdir -p keys
chmod 600 .env
```

To make each secret, run this three times (secret key, database password, first-login password):

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Save these three values in your password manager. You will need them again.

## Step 7. Create the production signing key (5 minutes)

```bash
cd ~/LocalMind_V1/deploy
docker compose build
docker compose run --rm -u root --entrypoint "" api sh -c \
  "python manage.py study_signing_key /app/keys/publisher.pem --key-id localmind-prod-1 && chown -R localmind:localmind /app/keys"
```

It prints a public key and a fingerprint. Save that output. Then back up `deploy/keys/publisher.pem` somewhere offline (an encrypted USB drive or password manager attachment). If this file is lost, new study packages cannot be signed with the same identity.

## Step 8. Start it (10 minutes)

```bash
cd ~/LocalMind_V1/deploy
docker compose up -d
docker compose logs -f api      # watch until you see gunicorn "Listening at"; Ctrl+C to stop watching
docker compose ps               # all four services should be "running" or "healthy"
```

The first start takes a few minutes because it creates the database tables and loads the model.

## Step 9. Check it works (10 minutes)

1. Open `https://localmind.onesmarter.com/api/health/`. You should see `"status": "ok"`.
2. Open `https://localmind.onesmarter.com`. Sign in with `BOOTSTRAP_ADMIN_EMAIL` and the `INITIAL_USER_PASSWORD` you set. Change the password when asked.
3. As admin, create one faculty and one student account.
4. As faculty, upload a small PDF, publish a module, synchronize.
5. As the student, open the module and take a quiz.
6. Test from a phone on mobile data (not Wi-Fi) to be sure it works from outside.

## Step 10. Nightly database backup (10 minutes)

Two layers. First, daily disk snapshots, set up once in the console:

1. In EC2, go to **Volumes**, select the server's volume, **Tags**, add tag `Backup` = `daily`.
2. Go to **Lifecycle Manager** (under Elastic Block Store), **Create lifecycle policy**, **EBS snapshot policy**.
3. Target resource type **Volume**, target tag `Backup` = `daily`.
4. Schedule: every 24 hours at 03:00 UTC, retain **7** snapshots. Create.

Second, a nightly database dump, because a dump restores cleanly even if a snapshot caught the database mid-write:

```bash
mkdir -p ~/backups
crontab -e
```

Add this line, save, exit:

```
0 2 * * * cd /home/ubuntu/LocalMind_V1/deploy && docker compose exec -T db pg_dump -U localmind localmind | gzip > /home/ubuntu/backups/db-$(date +\%F).sql.gz && find /home/ubuntu/backups -mtime +14 -delete
```

Test a restore once, on a test instance, before you need it.

## Step 11. Point the phone app at the server

On branch `deploy/aws-ec2`, `frontend/eas.json` (preview and production profiles) and `frontend/app.json` already point at `https://localmind.onesmarter.com`. If your domain is different, change it in those two files, then build the APK (see `frontend/MOBILE_BUILD.md`). Release builds are https-only.

## Step 12. Only if you are moving the laptop data

Skip this for a fresh start. Otherwise ask a developer, because it needs care:

1. On the laptop (with the server stopped): `python manage.py dumpdata --natural-foreign --natural-primary -e contenttypes -e auth.permission -e admin.logentry -e sessions --indent 2 -o data.json`
2. Copy `data.json` and `C:\LocalMindData\media` to the server.
3. On the server, into a fresh database: copy media into the `media` volume, then `docker compose exec api python manage.py loaddata /path/data.json`.
4. Note that content signed with the laptop's test key will not match the production key. Re-synchronize after the move.

## Step 13. How to update later

```bash
cd ~/LocalMind_V1
git pull
cd frontend && npm ci && npm run export:web && cd ..
cd deploy && docker compose up -d --build
```

Take a manual snapshot before any big update: EC2, **Volumes**, select the volume, **Actions**, **Create snapshot**.

## Step 14. Keep it healthy

1. **Auto-recover:** in EC2, select the instance, **Actions**, **Monitor and troubleshoot**, **Manage CloudWatch alarms**. Create an alarm on **Status check failed (system)** with the action **Recover** and an email notification. If the underlying AWS hardware fails, the server moves itself.
2. **CPU alarm:** another alarm on **CPU utilization** above 80% for 30 minutes, email only.
3. Add a free uptime monitor (for example UptimeRobot) on `https://localmind.onesmarter.com/api/health/`.
4. Once a month: `sudo apt-get update && sudo apt-get -y upgrade`, then reboot during a quiet time.
5. After one week of working https, set `SECURE_HSTS_SECONDS=31536000` in `.env` and run `docker compose up -d`.
6. Never open port 5432 (the database) in the security group. It does not need to be reachable from outside.

## Repo changes already made on `deploy/aws-ec2`

1. `backend/.env.example` added (the production template).
2. `models/` added to `backend/.dockerignore`.
3. `deploy/docker-compose.yml` uses Caddy; `deploy/Caddyfile` added; `deploy/keys/` and `deploy/.env` are git-ignored.
4. Phone app points at the EC2 domain and is https-only in release builds; Android offline storage raised to 200 MB (kept through `expo prebuild` by `frontend/plugins/withAsyncStorageSize.js`).
5. `INITIAL_USER_PASSWORD` is required when `DJANGO_DEBUG=false`.
6. README, `docs/DEPLOYMENT.md` and `docs/ENVIRONMENT.md` updated; launcher points at the EC2 domain.

## Where the money goes, and where to save it

Prices are for US East (Ohio), Linux, on-demand, September 2026. Mumbai is roughly 5 to 10% higher.

### Expected monthly bill

| Item | Cost per month |
|---|---|
| EC2 t3a.xlarge (4 vCPUs, 16 GiB), $0.1504/hour | about $110 |
| EBS disk, 60 GiB gp3 (about $0.08 per GiB) | about $5 |
| Elastic IP (AWS charges about $0.005/hour for every public IPv4) | about $3.65 |
| Daily snapshots, 7 kept (incremental, about $0.05 per GiB) | about $3 to $5 |
| Data out to the internet (first 100 GB/month free, then about $0.09/GB) | $0 at pilot scale |
| Caddy https, PostgreSQL in Docker, model downloads from Hugging Face | $0 |
| **Total, on-demand** | **about $122** |
| **Total with a 1-year Savings Plan** (see below) | **about $82 to $92** |

### Savings already built into this plan

| Choice | Saves per month | Instead of |
|---|---|---|
| t3a (AMD) instead of t3 (Intel) | about $11 | t3.xlarge at about $121 |
| PostgreSQL inside Docker | $15 to $30 or more | RDS |
| Caddy for https on the server | about $16 or more | An Application Load Balancer (hourly charge plus usage) |
| Public subnet, no NAT Gateway | about $32 or more | A private-subnet design that needs a NAT Gateway |
| Website served by the same server | about $20 | Vercel Pro (Vercel's free plan is meant for non-commercial use) |
| gp3 disk | about 20% on storage | Older gp2 disks |
| Model downloaded from Hugging Face | about $0.09 per GB | Hosting the 1.1 GB model on AWS (500 students is about 550 GB, roughly $40 to $50) |
| `DEVICE_AUTHORING_ONLY=true` and the 7B judge off | about $110 | A 32 GiB server to run heavier AI on the server |

### Savings you should take, in this order

1. **Budget alert on day one.** Already in Step 0. Free.
2. **Credit specification: Standard.** t3a servers earn CPU credits and can burst. In the default "Unlimited" mode, sustained high CPU (a long AI run) is billed extra with no warning. "Standard" caps it, so the bill is predictable. If the site feels slow during busy periods, check the `CPUCreditBalance` metric; if it sits near zero, switch to Unlimited or move to a non-burstable size.
3. **Right-size after two weeks.** Watch memory with `free -h` and `docker stats`. The server AI now only answers some tutor questions, builds outlines, parses PDFs (Docling peaks at 4 to 5 GB) and runs a 5% monitor check. If memory stays well under 8 GB, move to **t3a.large** (2 vCPUs, 8 GiB, about $55/month): stop the instance, **Actions, Instance settings, Change instance type**, start it. Also change `AI_THREADS` to 2. This takes five minutes and nothing is lost, which is one real advantage of EC2.
4. **Buy a 1-year Savings Plan once the size is settled** (not before). Billing and Cost Management, **Savings Plans**, **Purchase**. A **Compute Savings Plan**, no upfront, cuts the instance price by about 28% (about $79/month for t3a.xlarge). An **EC2 Instance Savings Plan** cuts about 37% (about $69/month) but locks you to the t3a family in that region. I would pick the Compute plan for flexibility.
5. **Stop test servers at night.** A stopped EC2 instance costs nothing for compute (you still pay for the disk and the Elastic IP). Do this for any test or staging server, never for production.
6. **Later, test Arm (Graviton).** t4g.xlarge is about 20% cheaper than t3a.xlarge. It needs the Docker image rebuilt and the AI library tested on Arm first, so it is a project, not a setting.
7. **Do not use Spot instances for production.** Spot is up to 70% cheaper but AWS can take the server back with two minutes' notice, mid-class.
