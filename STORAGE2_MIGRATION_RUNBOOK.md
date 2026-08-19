# NVCI 迁移至 fnOS 存储空间 2：操作清单

## 已完成事项

已在 fnOS 文件管理器中创建根级目录 **`NVCI`**，其“所在位置”为 **存储空间 2**。该存储空间为 ZFS Stripe，文件管理器显示约 377.73 GB 可用。

> 本次迁移将保留现有 NVCI 登录状态、厂商记忆、产品状态、任务日志、导出文件和资料库，并将它们从 Docker 命名卷迁移至存储空间 2 的可见目录。NVCI 应用代码仍留在原项目目录，只有持久化数据迁移；这是更安全、也更容易升级的结构。

## 第一步：确认 fnOS 的实际主机挂载路径

以 NAS `root` 身份在 SSH 终端执行以下命令，并将全部输出发回：

```bash
df -hT
printf '\n--- NVCI visible directory ---\n'
ls -ld /vol*/1000/NVCI 2>/dev/null || true
```

不要依据“存储空间 2”自行猜测挂载路径。常见路径可能类似 `/vol2/1000`，但必须以实际命令输出为准。

## 第二步：执行迁移

在确认的 `NVCI_STORAGE2_ROOT` 替换为存储空间 2 的实际根路径后，以 `root` 执行：

```bash
cd /vol1/1000/docker/nvci
git pull --ff-only origin main
NVCI_STORAGE2_ROOT=/实际/存储空间2根路径 sh scripts/migrate-data-to-storage2.sh
```

例如，**仅当**第一步确认 `NVCI` 位于 `/vol2/1000/NVCI` 时，命令才是：

```bash
cd /vol1/1000/docker/nvci
git pull --ff-only origin main
NVCI_STORAGE2_ROOT=/vol2/1000 sh scripts/migrate-data-to-storage2.sh
```

迁移脚本将按下表执行：

| 阶段 | 操作 | 数据保护措施 |
|---|---|---|
| 1 | 停止 `nvci-workbench` 容器 | 只停止 NVCI，不影响其他 Docker 项目。 |
| 2 | 从 `nvci_data` 命名卷复制完整备份 | 备份保存到 `<存储空间2根路径>/NVCI-migration-backups/<时间戳>/`。 |
| 3 | 复制为新活动数据目录 | 新目录为 `<存储空间2根路径>/NVCI/`。 |
| 4 | 设置非特权容器用户权限 | 确保 NVCI 可以安全写入新目录。 |
| 5 | 写入 `.env` 的 `NVCI_DATA_BIND_PATH` | Docker Compose 改用绑定挂载。 |
| 6 | 重建并启动 NVCI | 等待并显示容器健康检查结果。 |

脚本会保留原始命名卷 `nvci_data` 和迁移备份；在人工验收完成前，**不要删除任何一个**。

## 第三步：验收

脚本结束后，执行：

```bash
cd /vol1/1000/docker/nvci
docker compose ps
docker inspect nvci-workbench --format='{{.State.Health.Status}}'
find /实际/存储空间2根路径/NVCI -maxdepth 2 -type d | sort
```

浏览器重新访问：

```text
http://10.10.10.218:8787
```

确认能够登录，且控制台仍显示厂商路径记忆、产品状态和已有任务日志。预期健康状态为 `healthy`，资料库目录结构至少会包含 `library/`、`imports/`、`exports/` 以及 NVCI 的状态 JSON 文件。

## 迁移后资料保存路径

迁移完成后，以可见的 NAS 文件路径维护资料：

```text
<存储空间2根路径>/NVCI/
├── library/
│   └── ALE产品彩页/
│       └── 01 交换机/
├── imports/
├── exports/
├── vendor-memories.json
├── products.json
├── documents.json
├── runs.json
└── settings.json
```

对于 ALE OmniSwitch 彩页，活动资料建议存入：

```text
<存储空间2根路径>/NVCI/library/ALE产品彩页/01 交换机/
```

其下按 **接入层 → 汇聚层 → 核心层 → 精确系列** 分层。当前有效 PDF 和 CSV/JSON 审计清单留在活动目录；旧 PDF、旧 HTML 与旧快照移至 `99 历史归档/`，不覆盖已发布快照。

## 回滚原则

若容器在迁移后未达到 `healthy`，不要删除备份。迁移脚本已保留原命名卷与存储空间 2 的备份，可基于 `.env` 中的绑定挂载配置回退为命名卷后重新启动。先保留错误日志并反馈 `docker compose logs --tail=80` 的输出，再实施回滚。
