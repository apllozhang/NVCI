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

## 持续更新策略

不要为每次更新重新下载和重新解析整个产品线。推荐流程为：先读取上次 `collection_baseline.csv` 与最近成功快照；每个厂商随机选择 2–5 条具有代表性的公开 URL 做健康检查；路径健康且 HTTP 元数据未变则复用；仅对差异候选下载 PDF；只有新 PDF 或 SHA-256 变化的 PDF 才进入文本抽取和分析。路径异常时先小样本恢复方法，确认后才扩大范围。

## 升级、备份与回滚

代码升级：

```bash
git pull
npm ci
# 或只使用 Docker：
docker compose up -d --build
```

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
