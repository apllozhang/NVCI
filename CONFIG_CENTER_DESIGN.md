# NVCI 多层级来源配置中心设计

## 目标

NVCI 将公开资料自动化从单一预置来源扩展为由本地管理员维护的受控配置。配置颗粒度是“品牌 → 产品线 → 子系列 → 型号/资料条目”。每个资料条目必须指向已登记官方 HTTPS 域名中的公开资料 URL；配置仅在样本检查通过并由管理员审核后，才能进入 NAS 自动镜像队列。

> 配置中心不是通用爬虫。它不发现任意 URL、不绕过登录、验证码或访问控制，也不将未审核的产品页或营销页写入活动资料库。

## 配置对象

| 对象 | 必填字段 | 用途 |
|---|---|---|
| 品牌 | `vendorId`、`vendorName`、`officialDomains` | 固定可访问的官方 HTTPS 域名白名单。 |
| 产品线 | `productLine.id`、`productLine.name`、`libraryRootName` | 定义资料库品牌根目录与产品线目录。 |
| 子系列 | `subseries.id`、`subseries.name` | 将同一产品线内的系列分组，例如 OmniSwitch 6370、Aruba CX 6300。 |
| 型号 | `modelNames[]` | 记录本资料条目覆盖的精确型号；同一彩页可覆盖多个 SKU。 |
| 资料条目 | `productPageUrl`、`pdfUrl`、`officialFileName`、`evidencePolicy` | 是自动镜像和哈希核验的最小单位。 |

每个配置文件单独保存于 `/data/automation/source-profiles/<profileId>.json`。在活动资料库中，PDF 仍按“品牌根目录/产品线/官方彩页/子系列/文件”保存；快照与审计日志按“品牌根目录/产品线/更新与缺口记录/运行标识”保存。

## 生命周期与门禁

| 状态 | 可执行操作 | 约束 |
|---|---|---|
| `draft` | 编辑、删除、样本检查 | 不可排程、不可执行全量镜像。 |
| `sample_verified` | 编辑、审核 | 最近一次样本检查必须全部成功。 |
| `approved` | 手动运行、计划运行、暂停 | 仅允许已批准的官方资料条目进入下载队列。 |
| `suspended` | 查看、编辑、重新样本检查 | 停止后续自动运行，不删除历史快照或活动资料。 |

样本检查最多处理 5 条资料，只执行受限 `HEAD` 请求，保存 HTTP 状态、Content-Type、ETag、Last-Modified、Content-Length 与耗时。只有全部样本为公开 PDF 且无超时/域名问题时，管理员才能点击“批准并启用”。批准本身不自动下载资料；管理员仍可选择按需执行首次镜像或配置计划。

## 兼容性

已验证的 ALE OmniSwitch 预置配置保留原文件格式和运行状态，视为 `approved`。新建配置会增加层级字段，例如：

```json
{
  "profileId": "hpe_aruba_cx_6300",
  "vendorId": "hpe",
  "vendorName": "HPE Networking",
  "displayName": "HPE Aruba CX 6300 官方 Data sheet",
  "approvalStatus": "draft",
  "productLine": { "id": "switches", "name": "交换机", "libraryRootName": "HPE Networking彩页" },
  "subseries": { "id": "cx_6300", "name": "Aruba CX 6300" },
  "officialDomains": ["www.hpe.com", "hpe.com"],
  "sources": [
    {
      "documentId": "hpe-cx6300-ds",
      "series": "Aruba CX 6300",
      "modelNames": ["JL658A", "JL659A"],
      "productPageUrl": "https://www.hpe.com/...",
      "pdfUrl": "https://www.hpe.com/psnow/doc/...pdf",
      "officialFileName": "Aruba_CX_6300_Data_Sheet.pdf",
      "evidencePolicy": "official_datasheet"
    }
  ]
}
```

## 安全与审计

所有写入动作均要求本地管理员会话。`profileId`、目录片段和文件名会进行安全规范化，资料 URL 必须为 HTTPS，且 URL 主机名必须匹配该配置的 `officialDomains`。每一次新建、样本检查、批准、暂停、运行和计划修改均写入 NVCI 任务日志。未通过样本检查的配置与失败证据保留在配置状态中，但不会写入活动资料库。
