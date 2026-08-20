# NVCI · 网络厂商竞品情报工作台

NVCI 是一个面向局域网 NAS Docker 部署的图形化资料治理工作台。它将厂商采集记忆、产品/彩页状态、PDF 资料库、资料缺口、路径健康检查和低消耗增量更新汇总到一个本地 Web 界面。

> 系统只管理公开资料、历史基线和本地归档。它不会绕过登录、验证码、付费墙或厂商访问控制；也不会将 NAS、GitHub、Google Drive 或厂商账户密码写入源代码或 Git 仓库。

## 核心能力

| 功能 | 说明 |
|---|---|
| 厂商采集记忆 | 保存 ALE、HPE Networking、Cisco、H3C、锐捷等厂商的官网入口、主证据、下载方法、访问边界和小样本健康检查 URL。 |
| 产品与彩页状态 | 区分已获公开 PDF、资源 404、访问受限、未发现资源入口、产品页访问缺口及“用户确认无彩页素材”。 |
| PDF 优先资料库 | 活动目录只保留 PDF、分类资料记录 CSV 和 JSON 审计记录；旧文件、来源 HTML 和历史版本应转入历史归档。 |
| 低消耗更新 | 先对有限样本执行 HTTP 元数据检查；仅在 URL、资源 ID、ETag、日期、长度或哈希变化时，将资料纳入下载候选。 |
| 审计与备份 | 记录每次路径健康检查、导入和人工确认；可导出本地状态 JSON。 |
| NAS 本地自动采集 | 后台采集器在 NAS 同一 Docker 编排内执行固定公开来源的增量检查、SHA-256 核验、不可变快照发布和活动资料库入库。 |
| 受控字段事实（P0-3） | 对已批准的字段范围，将 ALE 官方 Data sheet / Order information 的字段证据写入独立 SQLite；预览不写入，执行必须确认，且保留证据定位与导入审计。 |
| 三态覆盖率与审核 | 技术字段必须明确区分已核验、未披露和待复核；未披露不得推断为不支持，待复核项自动进入审核队列。 |

> 当前发布版本：**v0.9.1**。P0-3 的详细门禁、字段范围和验收标准见 [`P03_ALE_CONTROLLED_FIELD_FACT_IMPORT.md`](./P03_ALE_CONTROLLED_FIELD_FACT_IMPORT.md)。

## NAS Docker 部署

在 NAS 上创建独立项目目录，例如 `/vol1/1000/docker/nvci`。将本仓库的文件复制或克隆到该目录后执行以下操作：

```bash
cp .env.example .env
# 编辑 .env：设置唯一的 NVCI_ADMIN_PASSWORD 和随机 NVCI_SESSION_SECRET
openssl rand -hex 32

docker compose up -d --build
```

部署完成后，从局域网浏览器打开：

```text
http://NAS_IP:8787
```

默认端口为 `8787`。如果端口冲突，请修改 NAS 项目目录内 `.env` 的 `NVCI_PORT`，然后运行 `docker compose up -d`。不要把本系统直接映射到公网；如需远程访问，应使用 VPN、受认证的反向代理或 NAS 自身的安全访问方案。

## fnOS Docker Compose 导入

在飞牛 fnOS 的 Docker 应用中进入 **Compose**，创建一个独立项目。选择项目目录后导入 `docker-compose.yml`，并在项目目录创建 `.env` 文件。部署前确认：项目名为 `nvci`；容器名为 `nvci-workbench`；端口 `8787` 未被现有容器占用；不修改已有 Docker 项目、网络、镜像或卷。

## 资料导入

容器数据使用命名卷 `nvci_data`。如需由 NAS 文件管理器维护 PDF，可改造 Compose 卷映射为指定共享目录，例如：

```yaml
volumes:
  - /vol1/1000/nvci-data:/data
```

资料推荐结构如下：

```text
/data/library/
├── 01 交换机/
├── 02 无线/
├── 03 云桌面/
├── 04 安全/
├── 05 路由器/
├── 06 软件/
├── 07 AI+数据/
├── 08 更新与缺口记录/
└── 99 历史归档/
```

活动目录只保留 PDF、分类五列表格、`document_manifest.csv`、`collection_status.csv`、`resource_product_linkage.csv`、`change_log.csv`、资料缺口和用户确认记录。每次新增资料应先检查 `resource_id + sha256`：未变化则复用旧文件；发生变化则记录旧文件版本并新增变更记录。

### 迁移到 fnOS 存储空间 2

初始部署使用 Docker 命名卷 `nvci_data`。如需让 NVCI 的状态、资料库和导出文件保存在存储空间 2 的可见目录，先在 NAS 上确认该存储空间的实际挂载路径（不要根据“存储空间 2”的名称猜测路径），然后以 root 身份在 NVCI 项目目录运行：

```bash
NVCI_STORAGE2_ROOT=/实际/存储空间2挂载路径 sh scripts/migrate-data-to-storage2.sh
```

脚本会停止服务、完整备份命名卷、将数据迁移至 `<存储空间2>/NVCI`、写入本地 `.env` 的 `NVCI_DATA_BIND_PATH`、重启服务并等待 `healthy`。原命名卷和独立迁移备份会保留；在确认登录、资料和导出文件均正常之前不得删除。迁移成功后，NAS 可见资料根目录为 `<存储空间2>/NVCI/library/`。

## NAS 本地自动采集器

从 **0.2.0** 起，Docker Compose 会额外启动 `nvci-collector` 后台服务。它与 Web 工作台共享 `/data` 绑定挂载，因此不需要 Manus、浏览器文件上传或临时 ZIP 才能将资料写入 NAS。本地自动化只会读取 `/data/automation/source-profiles/` 中已登记的公开官方 HTTPS 来源；不能从网页提交任意 URL，也不会使用厂商账号、绕过登录、验证码或访问控制。

首个已登记的来源为 **ALE OmniSwitch 官方 Data sheet**，包括 15 份已验证的公开 PDF。首次在 NVCI 的 **更新中心**点击“立即运行 ALE OmniSwitch”时，采集器会逐份下载、检查 PDF 文件签名和 SHA-256，并将匹配基线的初始镜像写入：

```text
/data/library/ALE产品彩页/01 交换机/01 官方彩页/
```

同时，每次运行都会创建独立不可覆盖快照：

```text
/data/snapshots/ale_omniswitch/<run-id>/
/data/library/ALE产品彩页/01 交换机/08 更新与缺口记录/<日期_run-id>/
```

默认计划为 NAS 本地时间的每周一 `02:15`。该计划、来源启用状态和“立即运行”按钮均可在 **更新中心**管理。首次部署保持 `NVCI_AUTOMATION_RUN_ON_START=false`，避免容器升级后未经管理员确认便下载资料；首次镜像完成后，未来计划任务仅对 HTTP 元数据发生变化的资料下载完整 PDF。采集器出现来源异常时只记录 `attention` 和本次审计日志，不删除历史快照或活动资料。

如需临时停止自动任务而不影响 NVCI Web 工作台，可执行：

```bash
docker compose stop nvci-collector
```

恢复后台任务：

```bash
docker compose up -d nvci-collector
```

## 持续更新策略

不要为每次更新重新下载和重新解析整个产品线。推荐流程为：先读取上次 `collection_baseline.csv` 与最近成功快照；每个厂商随机选择 2–5 条具有代表性的公开 URL 做健康检查；路径健康且 HTTP 元数据未变则复用；仅对差异候选下载 PDF；只有新 PDF 或 SHA-256 变化的 PDF 才进入文本抽取和分析。路径异常时先小样本恢复方法，确认后才扩大范围。

## 升级、备份与回滚

代码升级：

```bash
# NAS Docker 部署：不要在宿主机直接执行 npm ci。
# v0.9.1 会在 Alpine 构建阶段强制 better-sqlite3 从源码编译，避开 prebuild-install 的外部预编译包等待。
docker compose --progress=plain build nvci
docker compose up -d --no-deps nvci
docker compose up -d nvci-collector
docker compose ps
```

> Compose 服务名是 `nvci` 与 `nvci-collector`；`nvci-workbench` 是容器名，不可作为 `docker compose build` 的服务参数。

备份：从界面导出 JSON 状态，并定期备份 Docker 卷或绑定的 `/data` 目录。回滚：保留旧镜像和 `99 历史归档`；不要删除历史 PDF 或覆盖已发布快照。

## 开发验证

```bash
npm install
NVCI_DATA_DIR=./.test-data \
NVCI_ADMIN_PASSWORD=local-test-password \
NVCI_SESSION_SECRET=local-test-session-secret-0123456789 \
PORT=8788 npm start

node test/smoke.js
```

## License

Private project. Internal use only.
