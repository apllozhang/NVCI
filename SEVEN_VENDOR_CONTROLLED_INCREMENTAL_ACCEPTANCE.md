# 七家厂商受控增量采集能力验收契约

## 目标

将 ALE、HPE Networking、Cisco、新华三 H3C、锐捷网络、华为企业网络与 Extreme Networks 全部提升为“可审批、可运行、可审计、可回滚”的官方公开 PDF 增量采集能力。每个厂商的具体资料路径可以不同，但执行控制、资料状态与归档结果必须统一。

## 统一五道运行时门禁

| 门禁 | 运行时必须验证 | 失败状态 | 是否允许写入活动资料库 |
|---|---|---|---|
| 1. 官方资料链 | 产品/资料页与 PDF URL 均为 HTTPS，主机匹配来源配置的官方白名单；受控重定向只允许到明确声明的存储域 | `needs_route_validation` / `source_unavailable` | 否 |
| 2. PDF 真实性 | 响应成功、内容类型为 PDF 或允许的等效响应，文件含 `%PDF-` 签名且非空 | `non_pdf_response` / `restricted_excluded` | 否 |
| 3. 基础可读性 | PDF 页数大于零，并可完成基础解析 | `parse_failed` | 否 |
| 4. 适用范围匹配 | 文件名、PDF 标题或资料页标题与声明的系列/型号匹配；厂商专用规则可以进一步收紧 | `source_series_mismatch` / `applicability_needs_review` | 否 |
| 5. 审计完整性 | 保存来源链、下载方法、HTTP 元数据、SHA-256、时间、型号/系列、归档路径及不可变 manifest | `audit_incomplete` | 否 |

## 每厂商最低配置契约

每家厂商至少有一个版本受控的 `source-profile`，包含品牌 ID/名称、官方域名白名单、产品线、子系列、准确产品页、资料页（如有）、官方 PDF URL、官方文件名、系列/型号、证据规则、历史 SHA-256/HTTP 基线与健康检查入口。每个新配置默认 `draft + disabled`，仅能按“样本检查 → 批准 → 首次镜像/计划运行”启用。

## Drive 前置归档与运行验收

首次进入 NAS 草稿来源之前，资料必须已通过本地五道门禁并完成 Google Drive 回读核验。Drive 每个产品域快照必须按“品牌根目录 → 产品线 → 类别 → 独立快照”存放，包含 PDF、五列表格、`document_manifest.csv`、路径健康日志与变更日志。回读必须确认文件名、父目录、MIME、云端字节数与未进回收站状态。

每个已批准配置必须能够在 NAS 完成一次验证型首次镜像，随后完成一次无变化复用检查。每次运行输出路径健康日志、资料清单、五列表格、变更日志、运行结果与不可变 `manifest.json`；活动资料库仅保留当前有效 PDF，历史快照不得覆盖。

## 厂商专用补充规则

| 厂商 | 必须保留的专用门禁 |
|---|---|
| ALE | 型号事实只以 Data sheet 与其中 Order information 为准。 |
| HPE Networking | Data sheet → Specifications → QuickSpecs；商城只作为固定优先级补洞。 |
| Cisco | Data sheet 页面与同页 c/dam 原始 PDF 一对一；无 PDF 才保留 HTML。 |
| H3C | 下载 ID 必须由准确产品页发现；保留中文官方文件名和跨类别归档副本。 |
| 锐捷 | 资源 ID 不可枚举；PreviewFile 与用户可见下载按钮必须分别审计，禁止猜测签名 URL。 |
| 华为企业网络 | 企业网络资料页链、PDF 签名、SHA-256、URL 解码后的文件名/系列匹配等五道专用门禁；来源默认草稿禁用。 |
| Extreme Networks | 仅使用 Products 产品目录发现的 Wired Access、Wireless Access 与 Management 精确系列页；必须由页面实际 View Data Sheet 链接指向 `extr-p-001.sitecorecontenthub.cloud` 公共 PDF，禁止构造内容名或版本参数。进入 NAS 前必须已通过 Drive 回读核验。 |

## 发布标准

只有满足“来源配置已批准、五道门禁均通过、首次镜像与无变化复用均成功、NAS 资料库和厂商记忆可见状态一致”的厂商或产品域，才可标记为 `controlled_incremental_ready`。
