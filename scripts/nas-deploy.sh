#!/usr/bin/env sh
# NVCI NAS Docker bootstrap script.
# Run as root on fnOS or another Linux NAS with Docker Compose installed.
set -eu

APP_DIR="${NVCI_APP_DIR:-/vol1/1000/docker/nvci}"
REPO_URL="${NVCI_REPO_URL:-https://github.com/apllozhang/NVCI.git}"
BRANCH="${NVCI_BRANCH:-main}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请先以 root 身份运行：sudo -i"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 Docker。请先在 fnOS 应用中心启用 Docker。"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "未检测到 Docker Compose v2。请确认 Docker Compose 已启用。"
  exit 1
fi

if [ -d "$APP_DIR/.git" ]; then
  echo "更新现有 NVCI 代码：$APP_DIR"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  if ! command -v git >/dev/null 2>&1; then
    echo "未检测到 git，无法从 GitHub 拉取公开源代码。请安装 git 后重试。"
    exit 1
  fi
  if [ -e "$APP_DIR" ] && [ "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    echo "目标目录非空且不是 NVCI Git 仓库：$APP_DIR"
    echo "请清空该目录或设置 NVCI_APP_DIR 指向新的应用目录。"
    exit 1
  fi
  mkdir -p "$(dirname "$APP_DIR")"
  echo "克隆 NVCI 代码至：$APP_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  printf '请设置 NVCI 本地管理员密码（至少 12 位，不回显）： '
  stty -echo
  read -r NVCI_ADMIN_PASSWORD
  stty echo
  printf '\n'

  if [ "${#NVCI_ADMIN_PASSWORD}" -lt 12 ]; then
    echo "管理员密码长度不足 12 位，已取消部署。"
    exit 1
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "未检测到 openssl，无法安全生成会话密钥。"
    exit 1
  fi

  NVCI_SESSION_SECRET="$(openssl rand -hex 32)"
  umask 077
  cat > .env <<EOF
NVCI_PORT=8787
NVCI_BIND_IP=0.0.0.0
NVCI_ADMIN_PASSWORD=${NVCI_ADMIN_PASSWORD}
NVCI_SESSION_SECRET=${NVCI_SESSION_SECRET}
EOF
  unset NVCI_ADMIN_PASSWORD NVCI_SESSION_SECRET
  echo "已生成仅保留在 NAS 本地的 .env。"
else
  echo "检测到现有 .env：保留原管理员密码和会话密钥。"
fi

docker compose up -d --build --remove-orphans

echo "\nNVCI 部署完成。"
docker compose ps
printf '\n请在局域网访问：http://<NAS-IP>:8787\n'
