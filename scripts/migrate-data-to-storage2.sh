#!/usr/bin/env sh
# Migrate NVCI persistent state from the named Docker volume to a NAS-visible bind mount.
# Run as root on the NAS after confirming the actual Storage Space 2 mount path.
set -eu

PROJECT_DIR="${NVCI_PROJECT_DIR:-/vol1/1000/docker/nvci}"
SOURCE_VOLUME="${NVCI_SOURCE_VOLUME:-nvci_data}"
STORAGE2_ROOT="${NVCI_STORAGE2_ROOT:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请先切换到 root：sudo -i"
  exit 1
fi

if [ ! -d "$PROJECT_DIR" ] || [ ! -f "$PROJECT_DIR/docker-compose.yml" ]; then
  echo "未找到 NVCI Docker 项目目录：$PROJECT_DIR"
  echo "请通过 NVCI_PROJECT_DIR 指定包含 docker-compose.yml 的实际目录。"
  exit 1
fi

# 旧部署的 Compose 文件未包含 NVCI_DATA_BIND_PATH；先同步已发布配置。
if ! grep -q 'NVCI_DATA_BIND_PATH' "$PROJECT_DIR/docker-compose.yml"; then
  if ! command -v git >/dev/null 2>&1 || [ ! -d "$PROJECT_DIR/.git" ]; then
    echo "当前项目未包含绑定挂载配置，且无法通过 Git 同步更新。"
    echo "请先在 $PROJECT_DIR 执行 git pull --ff-only origin main 后重试。"
    exit 1
  fi
  echo "同步支持存储空间 2 绑定挂载的 NVCI 配置。"
  git -C "$PROJECT_DIR" pull --ff-only origin main
fi

if ! grep -q 'NVCI_DATA_BIND_PATH' "$PROJECT_DIR/docker-compose.yml"; then
  echo "Compose 配置仍未包含 NVCI_DATA_BIND_PATH，迁移已停止。"
  exit 1
fi

if [ -z "$STORAGE2_ROOT" ]; then
  echo "请先确认“存储空间 2”的实际挂载路径。可先执行：df -hT"
  echo "确认后按以下格式重试："
  echo "NVCI_STORAGE2_ROOT=/实际/存储空间2/路径 sh $0"
  exit 1
fi

if [ ! -d "$STORAGE2_ROOT" ]; then
  echo "目标存储空间目录不存在：$STORAGE2_ROOT"
  exit 1
fi

TARGET_DIR="$STORAGE2_ROOT/NVCI"
BACKUP_DIR="$STORAGE2_ROOT/NVCI-migration-backups/$(date +%Y%m%d_%H%M%S)"

if ! docker volume inspect "$SOURCE_VOLUME" >/dev/null 2>&1; then
  echo "未找到原始 Docker 命名卷：$SOURCE_VOLUME"
  exit 1
fi

mkdir -p "$TARGET_DIR"

if [ "$(find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  echo "目标目录并非空目录：$TARGET_DIR"
  echo "为防止覆盖现有资料，迁移已停止。请指定新的空目录或先人工核对目录内容。"
  exit 1
fi

echo "[1/6] 停止 NVCI 容器；原始命名卷不会删除。"
cd "$PROJECT_DIR"
docker compose down

echo "[2/6] 将原始命名卷完整备份到：$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
docker run --rm -v "$SOURCE_VOLUME":/from:ro -v "$BACKUP_DIR":/to alpine sh -c 'cp -a /from/. /to/'

echo "[3/6] 将备份恢复为新的活动数据目录：$TARGET_DIR"
docker run --rm -v "$BACKUP_DIR":/from:ro -v "$TARGET_DIR":/to alpine sh -c 'cp -a /from/. /to/'

echo "[4/6] 读取容器内 NVCI 非特权用户 UID/GID，并授予活动目录写权限。"
NVCI_UID="$(docker run --rm --entrypoint sh nvci-workbench:0.1.0 -c 'id -u nvci')"
NVCI_GID="$(docker run --rm --entrypoint sh nvci-workbench:0.1.0 -c 'id -g nvci')"
chown -R "$NVCI_UID:$NVCI_GID" "$TARGET_DIR"
chmod 750 "$TARGET_DIR"

if [ ! -f .env ]; then
  echo "未找到 $PROJECT_DIR/.env，无法安全写入绑定挂载配置。"
  echo "保留已复制的备份与活动数据；请恢复 .env 后重试。"
  exit 1
fi

echo "[5/6] 在 .env 中启用绑定挂载：$TARGET_DIR"
TMP_ENV="$(mktemp)"
grep -v '^NVCI_DATA_BIND_PATH=' .env > "$TMP_ENV" || true
printf '\n# NVCI persistent state and library on Storage Space 2\nNVCI_DATA_BIND_PATH=%s\n' "$TARGET_DIR" >> "$TMP_ENV"
mv "$TMP_ENV" .env
chmod 600 .env

echo "[6/6] 重新构建并启动 NVCI。"
docker compose up -d --build

printf '\n等待容器健康检查：\n'
for _ in $(seq 1 20); do
  STATUS="$(docker inspect nvci-workbench --format='{{.State.Health.Status}}' 2>/dev/null || true)"
  printf '%s ' "${STATUS:-starting}"
  [ "$STATUS" = "healthy" ] && break
  sleep 2
done
printf '\n\n'
docker compose ps

if [ "${STATUS:-}" = "healthy" ]; then
  echo "迁移完成。"
  echo "新活动资料根目录：$TARGET_DIR/library"
  echo "原命名卷仍保留，独立迁移备份位于：$BACKUP_DIR"
  echo "验证登录和数据无误前，请不要删除原命名卷或迁移备份。"
else
  echo "容器尚未变为 healthy。请执行：docker compose logs --tail=80"
  echo "原命名卷与迁移备份均已保留，可用于回滚。"
  exit 2
fi
