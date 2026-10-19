# Deploying to one EC2 server

A test deployment on a single AWS EC2 instance: the same Docker images as development, in production mode,
behind Caddy for HTTPS. Everything lives in [`deploy/`](../deploy/). This is for trying the app in other
regions, not yet the production setup (that is slice 18 in ARCHITECTURE.md §11: Hong Kong, off-site backups,
key rotation, monitoring).

**Treat the data on a test server as disposable** unless you keep backups and keys as described below.

## What runs

```
internet ──443──▶ caddy (HTTPS, certificates) ──▶ web (nginx: the app, security headers) ──/api──▶ server ──▶ db
```

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

## 2. A name for the server

HTTPS needs a domain name pointing at the Elastic IP. Either:

- **Your own domain:** add an `A` record, e.g. `diary-test.example.com` → the Elastic IP; or
- **No domain:** use `sslip.io`, which turns an address into a name. For `203.0.113.7`, use
  `203-0-113-7.sslip.io`. If Let's Encrypt refuses a certificate for it (it limits how many it issues per
  domain), use your own domain instead.

## 3. Install Docker

Pick one. **Rootless** (3b) is safer: the Docker daemon and every container run as the `ubuntu` user, so a
container escape doesn't hand over root on the server. The **docker group** (3a) is quicker to set up, but
anyone in that group is effectively root.

### 3a. Docker with the docker group

```sh
ssh -i <key.pem> ubuntu@<elastic-ip>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu
exit    # sign in again so the docker group applies
```

### 3b. Rootless Docker

Rootless mode comes from Docker's own packages (`docker-ce-rootless-extras`), not Ubuntu's `docker.io`.
Sign in as `ubuntu` over SSH and stay that user throughout: rootless Docker needs a real login session, so
don't switch to it with `sudo su`.

**Install the packages** (Docker's apt repository, then Docker plus what rootless mode needs):

```sh
ssh -i <key.pem> ubuntu@<elastic-ip>
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  docker-ce-rootless-extras uidmap dbus-user-session slirp4netns git
```

**Turn off the root daemon** the packages started; only the rootless one should run:

```sh
sudo systemctl disable --now docker.service docker.socket
sudo rm -f /var/run/docker.sock
```

**Prepare the system** (once, as root):

```sh
# Ubuntu 24.04 blocks unprivileged user namespaces; allow them for rootlesskit only.
sudo tee /etc/apparmor.d/usr.bin.rootlesskit >/dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

/usr/bin/rootlesskit flags=(unconfined) {
  userns,

  include if exists <local/usr.bin.rootlesskit>
}
EOF
sudo systemctl restart apparmor.service

# Caddy listens on 80 and 443, which normally only root may use.
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-rootless-docker.conf
sudo sysctl --system

# Keep ubuntu's services (the Docker daemon) running after you sign out, and start them at boot.
sudo loginctl enable-linger ubuntu
```

Lowering the port limit lets any user on the server listen on 80 and up. That's fine on a server that
only runs this app; the alternative (`setcap` on `rootlesskit`) is undone by every package upgrade.

**Set up the daemon** (as `ubuntu`, no `sudo`):

```sh
dockerd-rootless-setuptool.sh install

# Pass each visitor's real address through to the containers. The default port forwarding replaces it
# with an internal one, so every visitor would share one address and the per-IP sign-in limits would
# lock everyone out together.
mkdir -p ~/.config/systemd/user/docker.service.d
cat > ~/.config/systemd/user/docker.service.d/override.conf <<'EOF'
[Service]
Environment="DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns"
Environment="DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns"
EOF
systemctl --user daemon-reload
systemctl --user enable docker
systemctl --user restart docker

echo 'export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock' >> ~/.bashrc
. ~/.bashrc
docker info --format '{{.SecurityOptions}}'    # should include name=rootless
```

If `dockerd-rootless-setuptool.sh install` stops with a message about missing requirements, it prints
the command that fixes them; run that and try again.

Everything else in this guide is the same in rootless mode, with three differences:

- Images, containers and volumes (the database included) live in `~/.local/share/docker`, not
  `/var/lib/docker`.
- Manage the daemon with `systemctl --user` (`status`, `restart`, `stop` docker), never `sudo systemctl`.
- Cron doesn't read `~/.bashrc`, so the nightly backup line needs `DOCKER_HOST` (see [Backups](#backups)).

After the first sign-in (step 6), check that the server sees real addresses:
`docker compose -f deploy/compose.yaml logs server | grep remoteAddress | tail -n 3` should show your own
public address, not one starting `10.0.2.` or `172.`. If it shows an internal one, the override above isn't
in effect: check `systemctl --user cat docker`.

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

Sign in at `https://<domain>` as that admin, and create accounts under 用戶. Self-registration is **off** on a
deploy (`REGISTRATION_OPEN=false`, written by `make-env.sh`): the sign-in screen has no register link and the
server refuses registrations. To open it, set `REGISTRATION_OPEN=true` in `deploy/.env` and run
`docker compose -f deploy/compose.yaml up -d server`; set it back to `false` the same way. To install the app on a phone, open the address in Chrome (Android: menu → Install
app) or Safari (iPhone: Share → Add to Home Screen).

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

With rootless Docker (3b), tell cron where the daemon is by adding this line above it (1000 is `ubuntu`'s
user ID; check with `id -u`):

```
DOCKER_HOST=unix:///run/user/1000/docker.sock
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
that isn't attached to a running instance). If you used your own domain, remove its `A` record.
