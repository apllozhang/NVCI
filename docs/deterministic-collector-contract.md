# 无模型公开资料采集器契约

## 目标

采集器是确定性 Node.js 脚本，仅执行已批准来源配置中的公开官方 PDF URL。它不使用 AI 模型、不发现任意 URL、不解析营销文案形成技术结论，也不生成竞争关系、评分或产品映射。

## 输入

| 输入 | 说明 | 门禁 |
|---|---|---|
| `profileId` | 已批准来源配置的唯一标识 | 必须存在、已批准、已启用 |
| `vendor` / `product-line` / `subseries` | 可选筛选器，用于选择一组预配置来源 | 仅匹配已批准来源 |
| `task-file` | 含 `profileIds` 的可复用 JSON 任务文件 | 不接受自定义 URL |
| `queue` / `run` | 写入 NAS Worker 队列或当前进程串行执行 | 两种方式互斥 |
| `force` | 对 `run` 忽略 HTTP 元数据复用，重新验证下载 | 不绕过 PDF 与适用性门禁 |

## 固定门禁

1. 只允许 HTTPS、官方域名和显式受控重定向域。
2. 先读取 HTTP 元数据；URL、ETag、日期、长度和 SHA-256 未变化时复用历史资料。
3. 下载时验证 PDF 签名、结束标记、页对象和系列/型号匹配词。
4. 任一失败记录为 `needs_route_validation`、`source_unavailable`、`non_pdf_response`、`parse_failed` 或 `source_series_mismatch`；不得用猜测替代证据。
5. 全部资料顺序执行，遵守每个来源配置的超时、文件体积和最大文档数限制。

## 标准资产输出

每次运行写入不可变快照、活动资料目录和审计目录：PDF、`document_manifest.csv`、`path_health_log.csv`、`change_log.csv`、五列表、`update_summary.csv`、`run.json` 与带文件哈希的 `manifest.json`。产品页 URL、PDF URL、系列、型号、文件名和证据规则保留在来源配置和任务详情中。

## 非目标

本阶段不做技术参数自动抽取、不调用大模型、不进行跨厂商竞争对比、不生成评分、不推荐候选型号。后续参数整理与竞争对比只能消费本采集器产出的可审计资料资产。
