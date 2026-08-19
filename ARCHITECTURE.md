# NVCI 图形工作台架构

## 目标

NVCI（Network Vendor Competitive Intelligence）是一个部署在局域网 NAS Docker 环境中的单用户资料治理工作台。它将网络厂商竞品情报分析 Skill 的厂商路径记忆、资料快照、PDF 主资料、产品/资源关联、哈希基线、路径健康检查、增量更新计划、人工缺口确认和发布日志统一到可视化界面。系统自身不绕过登录、验证码、付费墙或厂商访问控制；只对已允许的公开 URL 和已确认的资料路径进行最小化探测。

## 部署边界

系统以单个 Node.js 容器运行，使用 Docker 命名卷保存 `/data`，并通过局域网 HTTP 端口提供受密码保护的 Web 界面。代码与 Docker Compose 文件存放在 GitHub 仓库，机密配置通过 NAS 上独立 `.env` 文件提供，绝不写入 Git。资料文件进入 `/data/library` 后，系统扫描原始 PDF、CSV 和 JSON 记录文件；活动资料目录不存放 HTML、解析文本、临时探针或旧 patch 文件。

## 模块

| 模块 | 作用 | 主要数据 |
|---|---|---|
| 控制台 | 展示厂商、PDF、缺口、最近运行和路径健康状态 | `app-state.json`、运行日志 |
| 厂商记忆 | 管理官网入口、主证据优先级、下载方法、访问边界和已知例外 | `vendor-memories.json` |
| 资料库 | 浏览 PDF 元数据、产品/系列、官方 URL、资源 ID、哈希和归档路径 | `documents.json`、资料记录 CSV |
| 产品状态 | 区分已获 PDF、资源 404、无资源入口、受限、用户确认无彩页和待复核 | `products.json`、`collection_status.csv` |
| 更新中心 | 导入哈希基线、配置样本 URL、执行轻量 HTTP 健康检查、生成复用/下载/失效决策 | `collection-baseline.csv`、`path-health-log.csv`、`update-summary.csv` |
| 任务日志 | 记录采集、补采、人工确认与发布动作的输入、结果和时间 | `runs.json` |
| 设置 | 管理本地资料目录、轮询开关、只读模式和备份导出 | `settings.json` |

## 低消耗更新门禁

更新不触发全量重采集。每次运行先读取最近已发布基线，按照厂商抽取有限样本；对样本 URL 只检查 HTTP 状态、内容类型、ETag、Last-Modified、Content-Length 或首部哈希。无变化文件标记为 `reuse_unchanged`；仅元数据或内容发生变化的项目标记为 `download_candidate`；404 标记为 `source_unavailable`；出现登录或表单边界时标记为 `restricted`；路径特征异常时标记为 `needs_route_validation` 并停止该厂商的全量动作。任何自动运行都不会将网页内容送入大模型。

## 数据目录

```text
/data/
├── app-state.json
├── vendor-memories.json
├── documents.json
├── products.json
├── runs.json
├── settings.json
├── imports/
├── exports/
└── library/
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

## 安全

系统通过本地管理员密码登录，Cookie 仅使用 `HttpOnly` 与同源 `SameSite=Strict` 策略；生产环境必须指定随机 `NVCI_SESSION_SECRET` 和强 `NVCI_ADMIN_PASSWORD`。默认仅绑定局域网端口，不发布公网反向代理，不存储 NAS、GitHub、Google Drive 或厂商账户凭据。外部下载仅支持管理员在界面明确运行的轻量健康检查；完整下载、Git 推送和 NAS 项目部署均保留日志。

## 版本与备份

活动资料以 `resource_id + sha256` 去重；相同哈希仅增加关联而不重复保存；发生内容变更时保留旧文件至 `99 历史归档` 并增加变更记录。系统可导出一个不含密码的 ZIP 配置备份。容器升级通过 `docker compose pull/build && docker compose up -d` 执行，持久数据卷不随容器重建而删除。
