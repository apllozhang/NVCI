# NVCI NAS 本地自动采集设计

## 目标与边界

本设计将公开官网资料的增量检查、内容哈希核验、PDF 镜像、版本化审计和 NVCI 资料库入库放在 NAS 的同一 Docker 编排中运行。自动化任务只访问预先登记的官方 HTTPS 域名与文件 URL；它不登录厂商门户、不绕过验证码或访问控制、不处理付费资料，也不会在元数据未变化时重复下载 PDF。

首个自动化配置文件仅覆盖 **ALE OmniSwitch 公开 Data sheet**。资料发现入口为官方产品页；型号事实主证据为官方 Data sheet 与其中的 Order information。后续厂商或产品线必须单独添加受审计的来源配置文件，不能由通用爬虫扩大范围。

## 运行结构

| 组件 | 职责 | 持久化位置 |
|---|---|---|
| `nvci` | 本地 Web 工作台、认证、资料库扫描、自动任务状态和手动触发 API。 | `/data/` |
| `nvci-collector` | 同一镜像中的后台受控采集器；轮询任务请求并执行计划检查。 | `/data/automation/`、`/data/snapshots/` |
| `automation/source-profiles/ale_omniswitch.json` | 固定 15 份官方 PDF、产品页、历史 SHA-256 与 HTTP 元数据基线。 | `/data/automation/source-profiles/` |
| `snapshots/ale-omniswitch/<run-id>/` | 每次运行独立的清单、计划、日志、结果和仅在变化时存在的原始 PDF。 | `/data/snapshots/` |
| `library/ALE产品彩页/01 交换机/` | 当前公开 PDF、五列表格与更新审计记录，供 NVCI 资料库扫描。 | `/data/library/` |

> NAS 绑定挂载的宿主根目录为 `/vol2/1000/NVCI/`，因此容器内 `/data/snapshots/` 与 `/data/library/` 都属于用户可见且可备份的存储空间 2。

## 自动化流程

每次计划或手动运行都只处理受限来源配置中的条目。采集器首先对每个 URL 发送低频 `HEAD` 请求，记录状态、Content-Type、ETag、Last-Modified 与 Content-Length。若这些元数据均未变化，则标记为复用；若来源不可用或类型异常，则记录 `needs_route_validation`，不会删除历史文件。

只有元数据有差异、来源首次初始化或用户明确要求强制核验时，采集器才会下载该 PDF、检查 `%PDF-` 文件签名并计算完整 SHA-256。哈希与基线一致时只更新元数据；哈希变化时才将新 PDF 写入本次不可变快照，并复制到活动资料库的当前公开彩页目录。任何运行均不覆盖旧快照。每次运行产出 `manifest.json`、`update_summary.csv`、`path_health_log.csv`、`change_log.csv`、五列表格和运行日志。

## 首次 NAS 初始化

当前 NAS 活动库中尚未保存 ALE OmniSwitch 的 15 份基线 PDF，因此启动自动化后第一次运行采用“**验证型初始镜像**”：逐份下载、验证 SHA-256 与固定基线一致后，写入 NAS 当前公开彩页目录；若任一文件哈希不一致，则该文件作为变化资料写入新的快照并在日志中标记，不覆盖已知基线。初始化完成后才写入 `bootstrap_complete` 状态，未来运行回到纯增量模式。

## 计划、手动触发与可观测性

默认计划为每周一次，使用 NAS 本地时间在周一 02:15 执行；该设置可在 NVCI 设置中修改或关闭。页面中的“立即运行 ALE OmniSwitch”只写入受控的本地请求队列，由后台采集器执行，不允许网页提供任意 URL 或 shell 命令。

后台任务会将状态写入 `/data/automation/status.json` 和 `/data/automation/runs/`。Web 页面读取这些文件显示下次运行时间、最近结果、变化文件数和异常来源。单个 HTTP 请求头与响应体读取均有明确超时上限；超时会记录为该来源的 `needs_route_validation`，而不是无限等待。容器重启或异常中断后，超过五分钟仍处于 `claimed` 的队列请求会自动标记为 `interrupted`，保留错误说明并允许管理员重新发起任务。失败只会隔离在本次运行日志中，历史库、已发布快照和活动 PDF 不会被删除。

## 安全与回滚

来源配置只能以仓库版本或经认证的本地设置更新。采集器限制允许域名为 `www.al-enterprise.com` 与 `al-enterprise.com`，限制 HTTPS、最大响应体和单请求超时，并采用固定 User-Agent 与顺序请求。它不会执行下载文件中的代码。

回滚不需要删除数据：停止 `nvci-collector` 服务即可停止后续自动采集，NVCI Web 工作台和既有资料库继续可用。由于每次运行是独立快照，错误资料可通过将活动库中的对应当前 PDF 替换为上一个已验证版本恢复；自动化不会主动清理历史快照。
