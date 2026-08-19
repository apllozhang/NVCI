# ALE OmniSwitch 彩页采集操作指南

> 适用范围：Alcatel-Lucent Enterprise（ALE）OmniSwitch 交换机公开官方彩页（PDF）采集、版本化本地镜像与 NVCI 资料库归档。

## 1. 先明确当前 NVCI 的作用边界

NVCI 当前版本是**资料治理、路径健康检查、状态管理与本地资料库浏览工作台**。控制台中的“运行路径健康检查”只对有限样本 URL 做 HTTP 元数据检查，不会批量下载 PDF；这是为避免无差别重复抓取而设计的门禁。

因此，正式发起 ALE 交换机彩页采集，应在本对话中调用 `network-vendor-competitive-intelligence` 工作流。采集完成后，再将通过哈希核验的 PDF 与清单导入 NAS 的 NVCI 资料库。不要把“运行路径健康检查”误当作“开始全量采集”。

## 2. 推荐的发起方式

在本对话中直接发送以下指令，并按需要收窄或扩大系列范围：

```text
/network-vendor-competitive-intelligence
执行纵向（vertical）资料采集：ALE OmniSwitch 交换机官方彩页。

范围：现行公开 OmniSwitch 交换机产品页及其对应 Data sheet PDF；需要时以产品页和数据表中的 Order information 核验具体型号/SKU。
优先级：ALE 仅以官网 Data sheet 与其中 Order information 作为型号参照；官方 PDF 优先。仅当不存在公开 PDF 时，才保留官方 HTML，并在清单中注明原因。
采集目标：先执行路径健康检查和历史 SHA-256/HTTP 元数据差异判断；仅下载新增或变化的资料。为本次创建独立、不可变快照和 manifest。
归档：按“接入层 → 汇聚层 → 核心层”建立目录；同一系列内保持铜缆下联优先、端口数低到高、非 PoE→PoE、全光在铜缆之后的排序。输出 PDF、document_manifest、五列表格和更新摘要。
```

如只采集某一个精确系列，可将“范围”替换为例如：`OmniSwitch 6360 与 OmniSwitch 6370`。如希望同时更新已归档资料，应保留“路径健康检查和历史差异判断”这一句。

## 3. 官方资料与下载规则

| 项目 | 固定规则 |
|---|---|
| 官方入口 | ALE 官网产品页，用于产品树发现和产品在售状态核验。 |
| 型号主证据 | 对应官方 Data sheet PDF 及其中的 Order information。 |
| 首选格式 | 原始公开 PDF。 |
| HTML 的处理 | 仅当官网不存在公开 PDF 时保留官方 HTML，并在 `document_manifest` 中写明 `official_html_no_public_pdf` 与原因。 |
| 型号/SKU | Order information 决定型号说明、SKU、地区/电源/附件变体；不得用系列最大值替代具体型号。 |
| 更新方法 | 先用最近基线的 URL、资源 ID、HTTP 元数据、SHA-256 做 2–5 个样本健康检查；只有变化候选才下载。 |
| 访问边界 | 只采集匿名公开资料；不绕过登录、验证码、表单或其他访问控制。 |

## 4. 本地采集快照的保存位置

每次采集创建新的、不可变的独立运行包。建议目录模板如下，其中日期使用实际执行日期；已发布快照绝不覆盖。

```text
/home/ubuntu/runs/
└── ale-omniswitch-brochures-YYYY-MM-DD/
    ├── scope.json
    ├── manifest.json
    ├── official_materials/
    │   └── ALE产品彩页/
    │       └── 01 交换机/
    │           ├── 接入层/
    │           │   ├── OmniSwitch 2260/
    │           │   ├── OmniSwitch 2360/
    │           │   ├── OmniSwitch 6360/
    │           │   ├── OmniSwitch 6370/
    │           │   └── OmniSwitch 6560/
    │           ├── 汇聚层/
    │           │   ├── OmniSwitch 6870/
    │           │   ├── OmniSwitch 6900/
    │           │   └── OmniSwitch 6970/
    │           └── 核心层/
    │               └── OmniSwitch 9900/
    ├── document_manifest.csv
    ├── document_manifest.json
    ├── document_download_log.csv
    ├── collection_baseline.csv
    ├── path_health_log.csv
    ├── update_summary.csv
    └── analysis/
```

目录中的 PDF 使用官方中文文件名（UTF-8）；若原始文件无中文名，则保留官方原始文件名，不人为改写产品技术名称。`document_manifest.csv` 至少记录产品系列/型号、PDF 文件名、官方 URL、下载时间、SHA-256、资料版本/日期、资料类型、适用粒度与存储相对路径。

## 5. Google Drive 的固定归档路径

如本次需要上云归档，应先在本地完成 SHA-256 核验，再上传至下列品牌根目录；每次快照使用独立目录。

```text
Google Drive
└── ALE产品彩页（根目录 ID：1rH1uBoiVH795Ugp4K_vRzSjXzfKFhWlB）
    └── 01 交换机/
        └── <产品类别>/
            └── <快照目录，例如 2026-08-19_ale-omniswitch-brochures>/
                ├── 官方 PDF 彩页
                └── 彩页资料清单.csv
```

每个快照目录必须包含五列表格：**序号、型号/系列、彩页文件名、下载链接 URL、下载时间**。跨类别产品在每个适用类别中保留 PDF 副本；不使用快捷方式代替副本。旧 PDF、历史 HTML 与旧快照迁入 `99 历史归档`，不得永久删除。

## 6. NAS NVCI 资料库的保存路径

当前 NVCI 容器采用命名卷 `nvci_data`，容器内的资料库根路径是：

```text
/data/library/
```

建议导入后的活动库路径如下：

```text
/data/library/
└── ALE产品彩页/
    ├── 01 交换机/
    │   ├── 接入层/
    │   ├── 汇聚层/
    │   └── 核心层/
    ├── 08 更新与缺口记录/
    └── 99 历史归档/
```

不要直接编辑 Docker 引擎的内部命名卷目录。若需要长期通过 fnOS 文件管理器维护资料，推荐将 Compose 中的卷改为绑定挂载：`/vol1/1000/nvci-data:/data`；然后使用 NAS 的可见路径 `/vol1/1000/nvci-data/library/ALE产品彩页/` 管理资料。变更卷映射前需先备份当前命名卷数据，并在变更后执行 `docker compose up -d`。

## 7. 单次采集后的最小验收

| 验收项 | 合格标准 |
|---|---|
| 产品与资料范围 | 已列明产品树、精确系列和排除项；不混入其他厂商或其他产品域。 |
| 资料格式 | 公开官方 PDF 优先；保留 HTML 的项目已标注无公开 PDF 的原因。 |
| 文件审计 | 每份 PDF 有官方 URL、下载时间、SHA-256、文件名和相对路径。 |
| 更新审计 | 有路径健康检查、差异决策与更新摘要；未变化文件复用而非重复下载。 |
| 版本管理 | 有独立 `manifest.json` 与快照标识；不覆盖已发布快照。 |
| 云端归档 | Google Drive 中存在原始 PDF 和五列表格，并完成上传回读核验。 |
| NAS 导入 | 活动资料只保留当前有效 PDF 和 CSV/JSON 审计记录；历史文件位于 `99 历史归档`。 |

## 8. 推荐的最短操作顺序

先在对话中按第 2 节的模板发起 `vertical` 采集；收到本地资料镜像、清单和更新摘要后，确认需要归档的范围；再上传至 Google Drive 的 ALE 根目录；最后把活动 PDF 和清单复制或同步到 NAS NVCI 的 `/data/library/ALE产品彩页/`。之后在 NVCI 中运行路径健康检查，并把变化候选作为下一次增量采集的输入。
