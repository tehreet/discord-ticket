#!/usr/bin/env bash
# One-time VPS setup. Run as the target user (joshf), not root.
set -euo pipefail

APP_DIR="/home/joshf/discord-ticket"
DATA_DIR="/home/joshf/.discord-ticket"
REPO_URL="https://github.com/tehreet/promptionary.git"
CLONE_DIR="${DATA_DIR}/promptionary"

cd "$APP_DIR"

echo "==> bun install"
/home/joshf/.bun/bin/bun install

echo "==> data dir"
mkdir -p "$DATA_DIR"

if [ ! -d "$CLONE_DIR/.git" ]; then
  echo "==> cloning promptionary"
  git clone "$REPO_URL" "$CLONE_DIR"
else
  echo "==> clone exists, pulling latest"
  git -C "$CLONE_DIR" pull --ff-only
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> creating .env from template"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "    EDIT $APP_DIR/.env with real values before starting the service."
fi

echo "==> installing systemd unit"
sudo cp "$APP_DIR/systemd/discord-ticket.service" /etc/systemd/system/
sudo systemctl daemon-reload

echo ""
echo "Setup complete. Next steps:"
echo "  1. vi $APP_DIR/.env              # fill in real secrets"
echo "  2. sudo systemctl enable --now discord-ticket.service"
echo "  3. journalctl -u discord-ticket.service -f"
