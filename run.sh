#!/usr/bin/env bash
# Runs the whole stack locally in Docker.
#   ./run.sh          build and start (diary :8080, API :3000)
#   ./run.sh --seed   same, then wipe and load sample users/entries (password: password123)
#   ./run.sh down     stop it
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "down" ]]; then
  docker compose down
  exit 0
fi

# Writes .env with throwaway keys the first time; leaves an existing one alone.
node scripts/dev-setup.mjs

docker compose up -d --wait --build

if [[ "${1:-}" == "--seed" ]]; then
  npm run seed -- --reset
fi

cat <<'EOF'

Running:
  Diary        http://localhost:8080
  API explorer http://localhost:3000/docs
Stop with: ./run.sh down
EOF
