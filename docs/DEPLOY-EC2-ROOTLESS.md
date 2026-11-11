# Rootless Docker on the EC2 server

An alternative to step 3 of [DEPLOY-EC2.md](DEPLOY-EC2.md). Here the Docker daemon and every container run as
the `ubuntu` user, so a container escape doesn't give root on the server. It takes more setup than the
default (Docker's root daemon), and a reinstall is fiddly. Every other step of the guide stays the same.

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

Everything else in [the guide](DEPLOY-EC2.md) is the same in rootless mode, with three differences:

- Images, containers and volumes (the database included) live in `~/.local/share/docker`, not
  `/var/lib/docker`.
- Manage the daemon with `systemctl --user` (`status`, `restart`, `stop` docker), never `sudo systemctl`.
- Cron doesn't read `~/.bashrc`, so the nightly backup line needs `DOCKER_HOST` (below).

After the first sign-in (step 6 of the guide), check that the server sees real addresses:
`docker compose -f deploy/compose.yaml logs server | grep remoteAddress | tail -n 3` should show your own
public address, not one starting `10.0.2.` or `172.`. If it shows an internal one, the override above isn't
in effect: check `systemctl --user cat docker`.

## Nightly backups

Cron doesn't read `~/.bashrc`. Put this line above the backup line in `crontab -e` so cron can find the
daemon (1000 is `ubuntu`'s user ID; check with `id -u`):

```
DOCKER_HOST=unix:///run/user/1000/docker.sock
```
