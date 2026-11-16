# Deploying to one EC2 server

A test deployment on a single AWS EC2 instance: the same Docker images as development, in production mode,
behind Caddy for HTTPS. Everything lives in [`deploy/`](../deploy/). This is for trying the app in other
regions, not yet the production setup (that is slice 18 in ARCHITECTURE.md §11: Hong Kong, off-site backups,
key rotation, monitoring).

**Treat the data on a test server as disposable** unless you keep backups and keys as described below.

## What runs

```
internet ──443──▶ caddy (HTTPS) ──▶ web:8080 (nginx: the diary) ── /api ──▶ server ──▶ db
```

- Caddy gets a certificate for the hostname and passes requests to nginx, which serves the app, adds the
  security headers and forwards `/api` to the server. (The community's 報數 site is a separate app since
  2026-11-16, with its own deploy: ARCHITECTURE.md §8.11.)
- Only Caddy publishes ports (80 and 443). The database, API and nginx are reachable only inside Docker.
- `/internal/` (the 報數 job trigger) is blocked at Caddy; the job runs on the server's own timer anyway.
- The server runs with `NODE_ENV=production`: the CAPTCHA and authenticator shortcuts are refused, the API
  explorer is off, and it won't start with placeholder keys.
- `TRUST_PROXY_HOPS=2` lets the per-IP sign-in limits see each visitor's real address through Caddy and
  nginx.

## 1. Launch the instance

In the EC2 console, **Launch instance**:

- **Image:** Ubuntu Server 24.04 LTS (64-bit x86).
- **Type:** `t3.small` (2 GB memory) or larger. Building the images needs the memory; `t3.micro` runs out.
- **Key pair:** create or choose one, for SSH.
- **Storage:** 20 GB gp3.
- **Security group:** allow
  - SSH (22) from **My IP** only;
  - HTTP (80) and HTTPS (443) from anywhere (Caddy needs 80 to get the certificate, then redirects it to
    HTTPS). Optionally UDP 443 too, for HTTP/3.

Then **Elastic IPs → Allocate**, and associate it with the instance, so its address survives restarts.

## 2. A name for the site

HTTPS needs a domain name pointing at the Elastic IP. Either:

- **Your own domain:** add an `A` record to the Elastic IP, e.g. `diary.gcdr.org.au` (or a test name such as
  `diary-test.example.com`); or
- **No domain:** use `sslip.io`, which turns an address into a name and answers for any name under it. For
  `203.0.113.7`, use `diary.203-0-113-7.sslip.io`. If Let's Encrypt refuses a certificate (it limits how many it
  issues per domain), use your own domain instead.

Caddy gets the certificate on the first visit, so the name must resolve before you open it.

## 3. Install Docker

Ubuntu's own packages are enough:

```sh
ssh -i <key.pem> ubuntu@<elastic-ip>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu

# Rotate container logs; by default they grow until the disk is full.
echo '{ "log-driver": "local" }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker

exit    # sign in again so the docker group applies
```

The Docker daemon starts at boot, and `restart: unless-stopped` brings the app back up with it.

**What this means for security.** The daemon runs as root, so keep these in mind:

- **The docker group is as powerful as root.** On EC2 that adds nothing new for `ubuntu`, which already has
  passwordless `sudo`. Don't add other users to the group, keep SSH limited to your own IP, and keep the key
  safe.
- **A container escape would give root on the server.** Little is exposed: only Caddy is reachable from
  outside, and the API runs as the unprivileged `node` user inside its container. For stronger isolation,
  use [rootless Docker](DEPLOY-EC2-ROOTLESS.md) instead of this step.
- **Docker bypasses `ufw`.** It writes its own firewall rules for published ports, so a `ufw deny` won't
  block them. The EC2 security group is the firewall that matters. Only Caddy publishes ports (80 and 443).

After the first sign-in (step 6), check that the server sees real visitor addresses (the per-IP sign-in
limits depend on them): `docker compose -f deploy/compose.yaml logs server | grep remoteAddress | tail -n 3`
should show your own public address, not one starting `172.`. An internal address usually means the request
came in over IPv6, which Docker relays through a proxy that hides the real address. Give both names only
`A` records, no `AAAA`.

### Switching a server from rootless Docker

If the server already runs the app under [rootless Docker](DEPLOY-EC2-ROOTLESS.md), move it over like this.
Its images and volumes stay in the rootless daemon's storage, so the data comes across as a backup.

1. **Back up**, with the rootless daemon still running: `cd ~/diary-app && sh deploy/backup.sh`. Copy the
   new file in `deploy/backups/` and `deploy/.env` off the server (see [Backups](#backups)).
2. **Remove the rootless daemon and its data** (as `ubuntu`):

   ```sh
   docker compose -f deploy/compose.yaml down
   dockerd-rootless-setuptool.sh uninstall
   rootlesskit rm -rf ~/.local/share/docker          # its images, containers and volumes
   rm -rf ~/.config/systemd/user/docker.service.d
   sed -i '/DOCKER_HOST/d' ~/.bashrc && unset DOCKER_HOST
   crontab -e                                        # delete the DOCKER_HOST= line
   ```

3. **Undo the system changes and turn the root daemon back on.** Docker's packages (`docker-ce`) are
   already installed and replace `docker.io`. Don't install `docker.io`: the two conflict.

   ```sh
   sudo rm -f /etc/sysctl.d/99-rootless-docker.conf /etc/apparmor.d/usr.bin.rootlesskit
   sudo loginctl disable-linger ubuntu
   sudo apt-get remove -y docker-ce-rootless-extras
   sudo systemctl enable --now docker.service docker.socket
   sudo usermod -aG docker ubuntu
   echo '{ "log-driver": "local" }' | sudo tee /etc/docker/daemon.json
   sudo reboot                                       # applies the group and the default port limit
   ```

4. **Start the app** (step 5), then **restore** the backup as in [Backups](#backups). Skip step 6: the
   accounts come back with the data. Caddy asks for fresh certificates, because its old ones were in the
   removed volumes.

## 4. Get the code and make the settings

```sh
git clone <repository URL> diary-app      # for a private repository, use a deploy key or access token
cd diary-app
git checkout <branch>
sh deploy/make-env.sh <domain>            # writes deploy/.env with freshly generated keys
```

**Copy `deploy/.env` somewhere safe off the server now** (e.g. a password manager):
`cat deploy/.env` and paste it. The two keyrings in it are the only way to read the diaries and profiles. Lose
them and the data is gone, backups included. `make-env.sh` refuses to overwrite an existing file for that
reason.

Optional settings go in the same file (see [`.env.example`](../.env.example) for each one):
`TRANSLATE_API_URL`, `TRANSLATE_API_KEY`, `TRANSLATE_MODEL` for translation, and `SMTP_URL`, `MAIL_FROM` for
admin alert emails.

## 5. Start it

```sh
docker compose -f deploy/compose.yaml up -d --build --wait
```

The first build takes a few minutes. The server applies the database migrations as it starts. Then open
`https://<domain>`: Caddy gets the certificate on the first visit, which can take a few seconds.

## 6. The first administrator

A production database starts empty, with no sample users. Create the first SYS_ADMIN on the server; it asks
for a password, then shows a QR code for your authenticator app and asks for a code from it:

```sh
docker compose -f deploy/compose.yaml exec server node server/dist/cli.js create-sysadmin <username>
```

Sign in at `https://<domain>` as that admin, and create the diary's accounts under 用戶: the diary is
curated, so nobody registers for it.

To install the app on a phone, open the address in Chrome (Android: menu → Install app) or Safari (iPhone:
Share → Add to Home Screen). It installs as 修行日記.

## Everyday tasks

All commands run in `~/diary-app` on the server. `dc` below stands for `docker compose -f deploy/compose.yaml`
(you can set it up with `alias dc='docker compose -f deploy/compose.yaml'`).

| Task | Command |
| --- | --- |
| Status | `dc ps` |
| Logs (follow) | `dc logs -f server` (also `web`, `caddy`, `db`) |
| Update to the latest code | `git pull`, `sh deploy/backup.sh`, then `dc up -d --build --wait` |
| Free disk from old images | `docker image prune -f` |
| Change a setting in `deploy/.env` | edit it, then `dc up -d server` |
| Recover an account | `dc exec server node server/dist/cli.js set-password <name>` (or `reset-totp <name>`) |
| Stop / start everything | `dc stop` / `dc up -d --wait` |

## Backups

```sh
sh deploy/backup.sh     # writes deploy/backups/diary-<time>.sql.gz, keeps the newest 14
```

To back up every night at 03:00 (server time), add this with `crontab -e`:

```
0 3 * * * cd /home/ubuntu/diary-app && sh deploy/backup.sh >/dev/null 2>&1
```

Backups on the server vanish with the server, so copy them off from your own computer:

```sh
scp -i <key.pem> 'ubuntu@<elastic-ip>:diary-app/deploy/backups/*.sql.gz' .
```

A backup holds encrypted diaries and is useless without the keyrings in `deploy/.env`. Keep the two apart,
so that neither one alone exposes anything.

**Restore** a backup (this replaces the current data):

```sh
gunzip -c deploy/backups/<file>.sql.gz | dc exec -T db psql -q -U diary -d diary -v ON_ERROR_STOP=1
dc restart server
```

A restore onto a new server needs the original `deploy/.env` (same keyrings) in place before starting.

## Removing the test server

In the EC2 console, terminate the instance, then **release the Elastic IP** (AWS charges for an address
that isn't attached to a running instance). If you used your own domain, remove the `A` record.
