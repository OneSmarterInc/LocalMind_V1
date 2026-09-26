# LocalMind on AWS EC2 with nginx: Production Runbook

For someone doing this for the first time. Follow the parts in order and tick each box. Every command is copy and paste. Replace `localmind.onesmarter.com` with your real domain everywhere, and `<ELASTIC-IP>` with your server's address.

Written for branch `deploy/aws-ec2` of `LocalMind_V1` (September 26, 2026).

## The plan in one paragraph

One EC2 server (t3a.xlarge: 4 vCPUs, 16 GB memory, Ubuntu 24.04) runs three Docker containers: PostgreSQL (the database), the Django API with the small AI model and the built website, and a maintenance loop. nginx runs directly on the server (not in Docker) in front of the API, and certbot gives it a free https certificate from Let's Encrypt that renews itself. Students' browsers and phones download the 1.1 GB AI model from Hugging Face, not from your server.

## What you need before you start

| Item | Where to get it |
|---|---|
| Git for Windows on your laptop | `winget install Git.Git` in PowerShell, then reopen PowerShell |
| Write access to `github.com/OneSmarterInc/LocalMind_V1` | Your GitHub account |
| A GitHub personal access token | GitHub, Settings, Developer settings, Personal access tokens, Fine-grained, give it read access to `LocalMind_V1` contents. Needed only if the repo is private |
| An AWS account you can log in to | aws.amazon.com |
| Access to the DNS settings for `onesmarter.com` | Whoever manages the domain (GoDaddy, Cloudflare, Route 53 or similar) |
| The production settings file `localmind-production.env` | From the project owner, through a password manager or encrypted share |

## Part A. Put the new branch on GitHub (laptop, 10 minutes)

Already done on September 26, 2026: `deploy/aws-ec2` is on GitHub. Skip to Part B.


The branch `deploy/aws-ec2` was made in a sandbox that cannot log in to GitHub, so it exists only inside `deploy-aws-ec2.bundle`. This part copies it to GitHub. Nothing touches `main`.

- [ ] A1. Save `deploy-aws-ec2.bundle` into your Downloads folder.
- [ ] A2. Open PowerShell and go to your existing LocalMind_V1 folder (the one that has `backend` and `frontend` in it):

```powershell
cd C:\path\to\LocalMind_V1
git status          # must say "nothing to commit"; if not, ask before continuing
git checkout main
git pull
```

If you have no local copy, clone one first: `git clone https://github.com/OneSmarterInc/LocalMind_V1.git`, then `cd LocalMind_V1`.

- [ ] A3. Bring the branch in from the bundle and push it:

```powershell
git fetch "$env:USERPROFILE\Downloads\deploy-aws-ec2.bundle" deploy/aws-ec2:deploy/aws-ec2
git push -u origin deploy/aws-ec2
git checkout main
```

- [ ] A4. Refresh the GitHub page. It should now say **12 Branches**, and `deploy/aws-ec2` appears in the branch list.

If `git fetch` says the bundle "requires" a commit you do not have, run `git fetch origin` and try A3 again.

## Part B. Secure the AWS account (15 minutes)

- [ ] B1. Turn on MFA for the root user (AWS Console, top-right account menu, Security credentials).
- [ ] B2. Create a budget alert: Billing and Cost Management, Budgets, Create budget, monthly cost budget of $150, email alert at 80%. Free.

## Part C. Launch the server (20 minutes)

- [ ] C1. Top right of the AWS Console, choose the region: **US East (Ohio) `us-east-2`** for US users, **Asia Pacific (Mumbai) `ap-south-1`** for India. Create everything below in that same region.
- [ ] C2. EC2, **Launch instance**:
  - Name: `localmind-prod`
  - Image: **Ubuntu Server 24.04 LTS**, **64-bit (x86)** (not Arm)
  - Instance type: `t3a.xlarge`
  - Key pair: **Create new key pair**, name `localmind-prod-key`, RSA, `.pem`. It downloads once; keep it safe
  - Network settings, **Edit**: default VPC, **Auto-assign public IP: Enable**, create security group `localmind-web` with SSH (22) from **My IP**, HTTP (80) from **Anywhere**, HTTPS (443) from **Anywhere**
  - Storage: **60 GiB**, **gp3**, tick **Encrypted**
  - Advanced details: **Termination protection: Enable**, **Credit specification: Standard**
  - **Launch instance**
- [ ] C3. EC2, **Elastic IPs**, **Allocate Elastic IP address**, **Allocate**. Then **Actions**, **Associate Elastic IP address**, choose `localmind-prod`, **Associate**. Write the address down; this is `<ELASTIC-IP>`.

## Part D. Point the domain at the server (5 minutes, then wait)

- [ ] D1. In the DNS settings for `onesmarter.com`, add an **A record**: name `localmind`, value `<ELASTIC-IP>`, TTL 300 (or the lowest offered).
- [ ] D2. Wait until it works. From PowerShell: `nslookup localmind.onesmarter.com` must return `<ELASTIC-IP>`. This can take a few minutes to an hour. The https step in Part J fails until it does, so do Parts E to I meanwhile.

## Part E. Prepare the server (20 minutes)

- [ ] E1. Connect: EC2, select the instance, **Connect**, **EC2 Instance Connect**, user `ubuntu`, **Connect**. A terminal opens in the browser. (From your laptop instead: first `icacls C:\path\to\localmind-prod-key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"`, then `ssh -i C:\path\to\localmind-prod-key.pem ubuntu@<ELASTIC-IP>`.)
- [ ] E2. Update, add a 4 GB swap file, install Docker, nginx and certbot:

```bash
sudo apt-get update && sudo apt-get -y upgrade

sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu

sudo apt-get install -y nginx certbot python3-certbot-nginx
exit
```

- [ ] E3. Reconnect (so the Docker permission takes effect) and check:

```bash
docker --version
docker compose version
nginx -v
free -h          # about 15 Gi memory and 4 Gi swap
```

## Part F. Get the code and build the website (15 minutes)

- [ ] F1. Clone the branch:

```bash
cd ~
git clone -b deploy/aws-ec2 https://github.com/OneSmarterInc/LocalMind_V1.git
cd LocalMind_V1
```

If the repo is private, git asks for a username (your GitHub username) and a password (paste the personal access token, not your GitHub password).

- [ ] F2. Install Node 20 and build the website:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
cd ~/LocalMind_V1/frontend
npm ci
npm run export:web
ls dist/index.html      # must exist
```

## Part G. Put the settings file in place (5 minutes)

- [ ] G1. Copy the settings file you were given to the server as `deploy/.env`. From your own computer (PowerShell, same key file as Part E):

```powershell
scp -i C:\path\to\localmind-prod-key.pem C:\path\to\localmind-production.env ubuntu@<ELASTIC-IP>:/home/ubuntu/LocalMind_V1/deploy/.env
```

(Or on the server run `nano ~/LocalMind_V1/deploy/.env`, paste the whole file, save with Ctrl+O, Enter, Ctrl+X.)

- [ ] G2. On the server:

```bash
cd ~/LocalMind_V1/deploy
chmod 600 .env
mkdir -p keys
grep -c "^DJANGO_SECRET_KEY=" .env     # must print 1
grep CHANGE_ME .env                    # must print nothing
```

If you were not given a settings file, make one instead: `cp ../backend/.env.example .env`, then replace every `CHANGE_ME` with the output of `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` (a different value for each).

## Part H. Build, download the AI models, create the signing key (30 minutes)

- [ ] H1. Build the containers (10 to 15 minutes the first time):

```bash
cd ~/LocalMind_V1/deploy
docker compose build
docker images | grep api        # shows an image called deploy-api
```

- [ ] H2. Download the AI models straight onto the server from Hugging Face (about 2 GB; a few minutes on AWS):

```bash
cd ~/LocalMind_V1/deploy          # or wherever the repo is: cd <repo>/deploy
REPO="$(cd .. && pwd)"            # the repo folder, whatever path it lives at
mkdir -p "$REPO/backend/models"
docker run --rm -u root \
  -e DJANGO_DEBUG=true -e HF_HUB_OFFLINE=0 \
  -v "$REPO/backend/models:/app/models" \
  --entrypoint "" deploy-api \
  python manage.py fetch_model --docling
ls -lh "$REPO/backend/models"     # Qwen3-1.7B-Q4_K_M.gguf (about 1.1 GB) and docling/
```

The `REPO` line matters: the models must land in the same repo folder that `docker compose` runs from, because the compose file mounts `../backend/models`. If the repo is at `/var/www/LocalMind_V1`, do not use `$HOME` in the mount.

`DJANGO_DEBUG=true` applies to this one download command only; the real server still runs with the settings in `deploy/.env`. If `docker images` showed a different name than `deploy-api`, use that name.

The download ends with the Qwen3 model and a `docling/` folder holding layout, table and OCR models. If it stops with `libxcb.so.1: cannot open shared object file`, the image predates the fix in commit `ec-libgl`: run `git pull` and `docker compose build` again, then repeat this step.

- [ ] H3. Create the production signing key:

```bash
cd ~/LocalMind_V1/deploy
docker compose run --rm -u root --entrypoint "" api sh -c \
  "python manage.py study_signing_key /app/keys/publisher.pem --key-id localmind-prod-1 && chown -R localmind:localmind /app/keys"
```

Save the printed public key and fingerprint. Back up `deploy/keys/publisher.pem` offline (encrypted USB or password-manager attachment) and send the project owner a copy through the same secure route as the settings file.

## Part I. Start LocalMind (10 minutes)

- [ ] I1. Start the containers:

```bash
cd ~/LocalMind_V1/deploy
docker compose up -d
docker compose logs -f api     # wait for gunicorn "Listening at", then Ctrl+C
docker compose ps              # db, api and maintenance running or healthy
```

- [ ] I2. Check the API answers on the server itself: `curl -s http://127.0.0.1:8000/api/health/` shows `"status": "ok"`.

## Part J. Put nginx and https in front (10 minutes)

- [ ] J1. Install the site config:

```bash
cd ~/LocalMind_V1
sudo cp deploy/nginx-host.conf /etc/nginx/sites-available/localmind
sudo nano /etc/nginx/sites-available/localmind     # check the domain on the server_name line
sudo ln -s /etc/nginx/sites-available/localmind /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

- [ ] J2. Open `http://localmind.onesmarter.com/api/health/` in your browser (http, not https yet). It should show `"status": "ok"`. If not, Part D has not finished.
- [ ] J3. Get the certificate (use a real email; Let's Encrypt sends expiry warnings there):

```bash
sudo certbot --nginx -d localmind.onesmarter.com --redirect --agree-tos -m you@onesmarter.com
sudo certbot renew --dry-run      # proves automatic renewal works
```

certbot edits the nginx file for you: it adds the https block and the http-to-https redirect.

## Part K. Check it works (15 minutes)

- [ ] K1. `https://localmind.onesmarter.com/api/health/` shows `"status": "ok"`.
- [ ] K2. Open `https://localmind.onesmarter.com`, sign in with `BOOTSTRAP_ADMIN_EMAIL` and your `INITIAL_USER_PASSWORD`, and change the password when asked.
- [ ] K3. As admin, create one faculty and one student account.
- [ ] K4. As faculty, upload a small PDF, publish a module, press Synchronize all.
- [ ] K5. As the student, open the module, go to Offline AI, download the model, select Check and save offline app files, take a quiz.
- [ ] K6. Switch that computer to airplane mode, reopen the site in the same browser, read a module, take a quiz. Reconnect and check the result reaches the faculty view.
- [ ] K7. Repeat from a phone on mobile data.

## Part L. Backups and alarms (20 minutes)

- [ ] L1. Daily disk snapshots: EC2, **Volumes**, select the server's volume, **Tags**, add `Backup` = `daily`. Then **Lifecycle Manager**, **Create lifecycle policy**, **EBS snapshot policy**, target tag `Backup` = `daily`, every 24 hours at 03:00 UTC, keep 7.
- [ ] L2. Nightly database dump:

```bash
mkdir -p ~/backups
crontab -e
```

Add this line, save, exit:

```
0 2 * * * cd /home/ubuntu/LocalMind_V1/deploy && docker compose exec -T db pg_dump -U localmind localmind | gzip > /home/ubuntu/backups/db-$(date +\%F).sql.gz && find /home/ubuntu/backups -mtime +14 -delete
```

- [ ] L3. Auto-recover alarm: select the instance, **Actions**, **Monitor and troubleshoot**, **Manage CloudWatch alarms**, alarm on **Status check failed (system)** with action **Recover** and an email.
- [ ] L4. CPU alarm: CPU utilization above 80% for 30 minutes, email only.
- [ ] L5. Free uptime monitor (for example UptimeRobot) on `https://localmind.onesmarter.com/api/health/`.

## Part M. Phone app (when the website works)

- [ ] M1. `frontend/eas.json` and `frontend/app.json` on `deploy/aws-ec2` already point at `https://localmind.onesmarter.com`. Change both only if your domain differs.
- [ ] M2. Build the APK from the `deploy/aws-ec2` branch (see `frontend/MOBILE_BUILD.md`, `npm run build:android`). Release builds are https-only and cannot reach a plain-http laptop server.

## Part N. Merge into main

- [ ] N1. When Parts K and M pass, open a pull request on GitHub from `deploy/aws-ec2` into `main` and merge it.
- [ ] N2. On the server: `cd ~/LocalMind_V1 && git checkout main && git pull`.

## Updating later

```bash
cd ~/LocalMind_V1
git pull
cd frontend && npm ci && npm run export:web && cd ..
cd deploy && docker compose up -d --build
```

Take a manual snapshot before any big update (EC2, Volumes, Actions, Create snapshot).

## If something goes wrong

| Symptom | Check |
|---|---|
| `502 Bad Gateway` from nginx | The API is not running: `cd ~/LocalMind_V1/deploy && docker compose ps` and `docker compose logs api` |
| API container keeps restarting | `docker compose logs api`. Usually a `CHANGE_ME` left in `.env`, or the model missing from `backend/models` |
| certbot fails | DNS not pointing at the server yet (`nslookup`), or port 80 not open in the security group |
| `DisallowedHost` error | `DJANGO_ALLOWED_HOSTS` in `deploy/.env` does not match the domain; fix, then `docker compose up -d` |
| Admin sign-in fails with CSRF error | `DJANGO_CSRF_TRUSTED_ORIGINS` must be `https://` plus your domain |
| Uploads fail with `413` | `client_max_body_size` in the nginx file is smaller than `MAX_UPLOAD_MB` |

## Repo changes on `deploy/aws-ec2`

1. `backend/.env.example` added (the production template).
2. `models/` added to `backend/.dockerignore`.
3. `deploy/docker-compose.yml` publishes the API on 127.0.0.1:8000 only for host nginx, mounts `deploy/keys/`, and has no web container; `deploy/nginx-host.conf` added; `deploy/keys/` and `deploy/.env` are git-ignored.
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
| nginx, Let's Encrypt certificate, PostgreSQL in Docker, model downloads from Hugging Face | $0 |
| **Total, on-demand** | **about $122** |
| **Total with a 1-year Savings Plan** (see below) | **about $82 to $92** |

### Savings already built into this plan

| Choice | Saves per month | Instead of |
|---|---|---|
| t3a (AMD) instead of t3 (Intel) | about $11 | t3.xlarge at about $121 |
| PostgreSQL inside Docker | $15 to $30 or more | RDS |
| nginx and certbot for https on the server | about $16 or more | An Application Load Balancer (hourly charge plus usage) |
| Public subnet, no NAT Gateway | about $32 or more | A private-subnet design that needs a NAT Gateway |
| Website served by the same server | about $20 | Vercel Pro (Vercel's free plan is meant for non-commercial use) |
| gp3 disk | about 20% on storage | Older gp2 disks |
| Model downloaded from Hugging Face | about $0.09 per GB | Hosting the 1.1 GB model on AWS (500 students is about 550 GB, roughly $40 to $50) |
| `DEVICE_AUTHORING_ONLY=true` and the 7B judge off | about $110 | A 32 GiB server to run heavier AI on the server |

### Savings you should take, in this order

1. **Budget alert on day one.** Already in Part B. Free.
2. **Credit specification: Standard.** t3a servers earn CPU credits and can burst. In the default "Unlimited" mode, sustained high CPU (a long AI run) is billed extra with no warning. "Standard" caps it, so the bill is predictable. If the site feels slow during busy periods, check the `CPUCreditBalance` metric; if it sits near zero, switch to Unlimited or move to a non-burstable size.
3. **Right-size after two weeks.** Watch memory with `free -h` and `docker stats`. The server AI now only answers some tutor questions, builds outlines, parses PDFs (Docling peaks at 4 to 5 GB) and runs a 5% monitor check. If memory stays well under 8 GB, move to **t3a.large** (2 vCPUs, 8 GiB, about $55/month): stop the instance, **Actions, Instance settings, Change instance type**, start it. Also change `AI_THREADS` to 2. This takes five minutes and nothing is lost, which is one real advantage of EC2.
4. **Buy a 1-year Savings Plan once the size is settled** (not before). Billing and Cost Management, **Savings Plans**, **Purchase**. A **Compute Savings Plan**, no upfront, cuts the instance price by about 28% (about $79/month for t3a.xlarge). An **EC2 Instance Savings Plan** cuts about 37% (about $69/month) but locks you to the t3a family in that region. I would pick the Compute plan for flexibility.
5. **Stop test servers at night.** A stopped EC2 instance costs nothing for compute (you still pay for the disk and the Elastic IP). Do this for any test or staging server, never for production.
6. **Later, test Arm (Graviton).** t4g.xlarge is about 20% cheaper than t3a.xlarge. It needs the Docker image rebuilt and the AI library tested on Arm first, so it is a project, not a setting.
7. **Do not use Spot instances for production.** Spot is up to 70% cheaper but AWS can take the server back with two minutes' notice, mid-class.
