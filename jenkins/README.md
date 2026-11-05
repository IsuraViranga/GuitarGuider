# Jenkins: checks and deploys for Melantha Guitar Academy

The pipeline is in the repository's [`Jenkinsfile`](../Jenkinsfile):

```
every branch:  secret scan ─► server checks + tests (PostgreSQL 18) ┐
                              app checks + tests (Node 22)           ┴─► done
main only (DEPLOY_ENABLED=yes):
   ─► deploy staging ─► smoke test ─► owner approves ─► deploy production ─► smoke test
                                                                    (fails → rollback)
```

Each step runs in its own clean Docker container. The same checks run on your PC with
`bash scripts/ci.sh`.

## 1. Run Jenkins on your PC (free phase)

Needs Docker Desktop.

```bash
cd jenkins
cp .env.example .env          # set a long JENKINS_ADMIN_PASSWORD (this file is never committed)
docker compose up -d --build  # first time: a few minutes
```

Open http://localhost:8080 and sign in as `admin` with the password from `jenkins/.env`.
`docker compose stop` stops Jenkins; `docker compose up -d` starts it again. Jobs and settings
are kept in the `jenkins_home` Docker volume.

## 2. Connect the private GitHub repository

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
   Only the repository `GuitarGuider`. Permissions:
   - Contents: Read
   - Metadata: Read
   - Commit statuses: Read and write
   - Pull requests: Read
2. Jenkins → Manage Jenkins → **Credentials** → System → Global → Add Credentials:
   - Kind **Username with password**
   - Username `IsuraViranga`
   - Password: the token
   - ID `github-token`
3. Jenkins → **New Item** → name `melantha` → **Multibranch Pipeline**:
   - Branch Sources → Add source → **GitHub**: credentials `github-token`, repository URL
     `https://github.com/IsuraViranga/GuitarGuider`.
   - Scan Repository Triggers → **Periodically if not otherwise run**: 5 minutes. On your PC,
     GitHub can't call Jenkins, so Jenkins checks for new commits itself. On the VPS a webhook
     does it at once.
   - Save. Jenkins finds `main` and every branch, and runs the checks. A green tick then shows
     on GitHub next to each commit.

So far Jenkins only checks: Render and Netlify still deploy from GitHub as before.

## 3. Staging (free plans)

Staging is a second, separate copy of the app, for trying a release before players get it. It
never touches production data, recordings or emails.

| Part | How (free) | Settings |
|---|---|---|
| Database | Neon → **New project** `melantha-staging` (empty; no real accounts) | copy its *pooled* connection string |
| API | Render → New → **Web Service** from the same repo, name `melantha-guitar-api-staging`, Free; **Auto-Deploy: Off** | see below |
| Website | Netlify → Add new site → **Deploy manually** (drop any folder once), name `melantha-guitar-staging` | note its Site ID (Site configuration) |
| Recordings | none needed: staging keeps test recordings on its own disk | `DATASET_STORAGE=local` |
| Email | links are written in the log, never sent | `EMAIL_LOG_LINKS=true`, no `EMAIL_API_KEY` |

Render staging environment variables:
- `DATABASE_URL` (staging Neon)
- `COOKIE_SECURE=true`
- `APP_URL=https://melantha-guitar-staging.netlify.app`
- `EMAIL_LOG_LINKS=true`
- `DATASET_STORAGE=local`
- `SENTRY_DSN` (optional), `SENTRY_ENVIRONMENT=staging`

Build command `pip install -r requirements.txt`, root `backend`, start command as in
`render.yaml`.

**Free hours.** Render gives one workspace 750 free hours a month, and production's 5-minute
check already uses about 740. A staging server only uses hours while awake (after a deploy or a
test, then it sleeps after 15 minutes), but to be safe, create staging in a **second Render
workspace** (its own free hours). Check its Billing page after a week.

## 4. Let Jenkins deploy (after staging works)

Do steps 1–3 together, so a push is never deployed twice.

1. Jenkins → Credentials → Global → Add Credentials, each of kind **Secret text**:

   | ID | Value |
   |---|---|
   | `render-api-key` | Render → Account settings → API Keys → Create |
   | `netlify-auth-token` | Netlify → User settings → Applications → Personal access tokens |
   | `staging-render-service-id` | staging service's ID (`srv-…`, in its URL) |
   | `staging-netlify-site-id` | staging site → Site configuration → Site ID |
   | `production-render-service-id` | production service's ID |
   | `production-netlify-site-id` | production site's ID |

   One Render key and one Netlify token can reach both environments. To keep production
   apart, put staging in its own Render workspace and Netlify team, and use separate keys.
   Then name the staging keys `render-api-key-staging` and so on, and change `deployKeys()` in
   the Jenkinsfile.
2. In `jenkins/.env`:
   - `DEPLOY_ENABLED=yes`
   - `STAGING_API_URL=https://melantha-guitar-api-staging.onrender.com`
   - `STAGING_SITE_URL=https://melantha-guitar-staging.netlify.app`

   Then run `docker compose up -d`.
3. Production stops deploying by itself:
   - **Render**, production service → Settings → **Auto-Deploy: Off**.
   - **Netlify**, production site → Site configuration → Build & deploy → **Stop builds**.

From now on: merge to `main` → Jenkins tests → deploys staging → smoke test → **you click
"Deploy to production"** in Jenkins → it deploys production and checks it. If the production
check fails, Jenkins offers **Roll back now**. The same can be done by hand with
`scripts/rollback.sh` (it needs the same keys).

Database changes run on the server's start, under a database lock. They are always made
backward compatible, so a rollback never needs a database rollback. Before a release that
deletes data, make a backup first (`scripts/backup-db.sh`).

## 5. Moving to the VPS (paid phase)

Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB+ disk (for example Hetzner or DigitalOcean), and a domain
name such as `jenkins.example.com` pointing at it.

```bash
# as root, once
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx ufw git
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable    # only SSH and HTTPS are open
adduser deploy && usermod -aG docker deploy                    # work as this user, not root
# as deploy
git clone https://github.com/IsuraViranga/GuitarGuider.git && cd GuitarGuider/jenkins
cp .env.example .env   # long password, JENKINS_URL=https://jenkins.example.com/, same settings as on the PC
```

Changes for the VPS:
- In `docker-compose.yml`, replace `user: root` with
  `group_add: ["<number from: getent group docker | cut -d: -f3>"]`.
- In `casc.yaml`, set `numExecutors: 0` and add a build agent.

Then:
```bash
docker compose up -d --build
```

Nginx in front, with HTTPS from Let's Encrypt. Jenkins itself listens only on 127.0.0.1:8080.
```nginx
server {
  server_name jenkins.example.com;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```
```bash
certbot --nginx -d jenkins.example.com    # HTTPS, renewed automatically
```

Then:
- **Webhook:** GitHub → repository → Settings → Webhooks → `https://jenkins.example.com/github-webhook/`,
  content type JSON, events "Push" and "Pull requests". Jenkins starts within seconds of a push,
  so the 5-minute check can be removed.
- **Move the settings:** add the same credentials again on the VPS. Never copy them in chat or
  email.
- **Backups of Jenkins:** each night, copy the volume to another place.
  ```bash
  docker run --rm -v jenkins_jenkins_home:/data -v /home/deploy/backups:/backup alpine tar czf /backup/jenkins-$(date +%F).tgz -C /data .
  ```
  The pipeline itself is in git, so a lost Jenkins is rebuilt from `jenkins/` plus this backup.
- **Updates, monthly:** `docker compose build --pull && docker compose up -d`, which brings a
  new Jenkins LTS and new plugins. Also run `apt upgrade` on the server.

## Security

- **Keys:** keys live only in Jenkins Credentials. Jenkins masks them in logs, and the
  Jenkinsfile hands them to a step only while it runs.
- **Pull requests:** pull-request builds run only the checks. Deploy keys are used only in
  `main` stages, after the checks pass.
- **Production approval:** only users in `PRODUCTION_APPROVERS` (the admin) can approve a
  production deploy or a rollback.
- **Access:** anonymous visitors see nothing. Sign-ups are off. Access goes through HTTPS only
  (VPS), with the firewall open only for SSH and HTTPS.
