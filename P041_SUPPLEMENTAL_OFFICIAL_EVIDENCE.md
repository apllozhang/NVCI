# P0-4.1 直接候选补充官方证据

本文件仅记录 P0-4.1 审阅中用于补充现有审计基线的**官方资料**。它不自动批准、驳回或覆盖生产关系；最终关系仍须由产品经理在 NVCI 中人工审核。

## ALE OmniSwitch 6360

官方 Data sheet：<https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-6360-datasheet-en.pdf>

资料的 Commercial references 明确列出以下型号及字段：

| 型号 | 官方原文要点 | P0-4.1 可用字段 |
|---|---|---|
| OS6360-P24 | “Fixed 1RU chassis”；“24 RJ-45 PoE 10/100/1G BaseT”；“2 SFP+ (1G/10G) uplink or VFL ports”；“180W power budget” | 形态、下行、上行、PoE 预算、环境规格 |
| OS6360-P24X | “Fixed 1RU chassis”；“24 RJ-45 PoE 10/100/1G BaseT”；“2 1G/10G RJ45/SFP combo”；“2 SFP+ (1G/10G) uplink or VFL ports”；“380W power budget” | 形态、下行、上行、PoE 预算、环境规格 |
| OS6360-P48 | “Fixed 1RU chassis”；“48 RJ-45 PoE 10/100/1G BaseT”；“2 SFP+ (1G/10G) uplink or VFL ports”；“350W power budget” | 形态、下行、上行、PoE 预算、环境规格 |
| OS6360-PH24 | “Fixed 1RU chassis”；“24 RJ-45 PoE 10/100/1G BaseT”；“2 1G RJ45/SFP combo”（可通过性能许可升级）；“2 SFP+ (1G/10G) uplink or VFL ports”；“380W power budget” | 形态、下行、上行、PoE 预算、环境规格 |

资料的产品矩阵还对上述 24/48 端口机型给出工作温度 `0°C to 45°C` 和工作湿度 `5% to 95% non-condensing`。这些是型号矩阵字段，P0-4.1 可据此将原先系列级的环境待复核转为已核验，但不等同于工业或危险环境认证。

## ALE OmniSwitch 6560/6560E

官方 Data sheet：<https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-6560-6560e-datasheet-en.pdf>

| 型号 | 官方原文要点 | P0-4.1 可用字段 |
|---|---|---|
| OS6560-P24X4 | “Gigabit fixed chassis in 1RU size”；“24 RJ-45 10/100/1G BaseT PoE+”；“2xSFP(1G) and 4xSFP+ (1G/10G) uplink/stacking ports”；“600W AC supply”。电源表：`Up to 532 W`（1 PSU），`Up to 1085 W`（2 PSU）。 | 形态、下行、上行、PoE 预算的条件化口径、环境规格 |
| OS6560-P48X4 | “Gigabit fixed chassis in 1RU size”；“48 RJ-45 10/100/1G BaseT PoE+”；“2xSFP(1G) and 4xSFP+ (1G/10G) uplink/stacking ports”；“920W AC supply”。电源表：`Up to 815 W`（1 PSU），`Up to 1645 W`（2 PSU）。 | 形态、下行、上行、PoE 预算的条件化口径、环境规格 |

6560 资料的产品矩阵对上述型号给出 `0°C to 45°C`、`5% to 95% non-condensing`、1RU 尺寸，并明确说明 PoE 预算取决于 PoE 型号及电源配置。故 NVCI 关系中不得再把其 PoE 预算写作“未披露”；应记录单 PSU 与双 PSU 的条件，并将实际电源配置列为采购验证项。

## HPE Aruba CX 6200F

官方 Specifications：<https://support.hpe.com/hpesc/public/docDisplay?docId=a00099581en_us&docLocale=en_US>

HPE 规格表明确给出：

| 官方 SKU | 上行 | PoE 预算 | 环境和形态 |
|---|---|---|---|
| JL725A（Aruba 6200F 24G Class4 PoE 4SFP+ 370W） | `4x 1/10G SFP Ports` | 固定 500W 电源，`Up to 370 W of Class 4 PoE power` | 标准 19 英寸机架；0–45°C（5000 英尺内）；15–95% RH 非凝露 |
| JL727A（Aruba 6200F 48G Class4 PoE 4SFP+ 370W） | `4x 1/10G SFP Ports` | 固定 500W 电源，`Up to 370 W of Class 4 PoE power` | 同上 |
| JL728A（Aruba 6200F 48G Class4 PoE 4SFP+ 740W） | `4x 1/10G SFP Ports` | 固定 950W 电源，`Up to 740 W of Class 4 PoE power` | 同上 |

官方表中**没有** 24 端口 740W 型号。任何历史输入中名为 “CX 6200F 24G ... 740W” 的记录均应保留为型号身份待复核，不得自动映射到 JL725A。

## HPE Aruba CX 6200M

官方 QuickSpecs：<https://www.hpe.com/psnow/doc/a00097415enw>

| 官方 SKU | 上行 | PoE 预算 | 环境和形态 |
|---|---|---|---|
| R8Q68A（CX 6200M 24G Class4 PoE 4SFP+） | 4x 1G/10G SFP ports | Max 740W；两个可现场更换、热插拔电源位，最少一块电源 | 标准 19 英寸机架；0–45°C（5000 英尺内）；15–95% RH 非凝露 |
| R8Q70A（CX 6200M 48G Class4 PoE 4SFP+） | 4x 1G/10G SFP ports | Max 1440W；两个可现场更换、热插拔电源位，最少一块电源 | 同上 |

> P0-4.1 重审原则：上述证据可补齐固定形态、标准机架环境、端口与 PoE 字段；但关系是否应维持“直接候选”仍取决于 PoE 预算是否满足项目负载、上行接口与模块配置是否相容，以及历史候选名称能否与官方 SKU 一对一映射。


## HPE Aruba CX 6200F 的 4SFP 与 4SFP+ 商业变体核验

HPE 官方商城确认，历史候选中“4SFP”并非同一名称下的排版差异，而是独立的商业 SKU：

| 官方商城 SKU | 官方商城产品名称 | 资料入口 | P0-4.1 含义 |
|---|---|---|---|
| S0M82A | HPE Aruba Networking CX 6200F 24G Class‑4 PoE **4SFP** 370W Switch | <https://buy.hpe.com/us/en/networking/switches/fixed-port-l3-managed-ethernet-switches/hpe-aruba-networking-cx-6200f-24g-class%E2%80%914-poe-4sfp-370w-switch/p/s0m82a> | 该名称存在官方 SKU 映射；不可自动等同于 4SFP+ SKU。 |
| S0M84A | HPE Aruba Networking CX 6200F 48G Class‑4 PoE **4SFP** 370W Switch | <https://buy.hpe.com/us/en/networking/switches/fixed-port-l3-managed-ethernet-switches/6000-switch-products/hpe-aruba-networking-cx-6200f-48g-class%E2%80%914-poe-4sfp-370w-switch/p/s0m84a> | 该名称存在官方 SKU 映射；不可自动等同于 4SFP+ SKU。 |
| JL725B | HPE Aruba Networking CX 6200F 24G Class‑4 PoE **4SFP+** 370W Switch | <https://buy.hpe.com/us/en/networking/switches/fixed-port-l3-managed-ethernet-switches/hpe-aruba-networking-cx-6200f-24g-class%E2%80%914-poe-4sfp-370w-switch/p/jl725b> | 这是 4SFP+ 商业 SKU，不应与 S0M82A 自动合并。 |

HPE 官方 QuickSpecs（版本 37，2026-07-13）说明，CX 6200 系列同时包含“built-in 1G/10G uplinks on fixed power switches”和“additional cost-efficient **1G uplink** switch models”。因此，P0-4.1 将 `4SFP` 与 `4SFP+` 视为不同的型号身份与上行能力桶。除非 HPE 官方 Data sheet/Specifications 对具体 SKU 明确给出端口规格，否则不得将 4SFP 候选嫁接到 4SFP+ 的 1G/10G 端口证据。

官方 QuickSpecs：<https://www.hpe.com/psnow/doc/a00059762enw.html>

## HPE Aruba CX 6100 与 4SFP 上行口径补充

P0-4 审计基线已保留 HPE 官方 CX 6100 Data sheet 的型号级证据：

| 官方 SKU | 官方型号 | 官方原文要点 | 来源 |
|---|---|---|---|
| JL677A | HPE Aruba Networking CX 6100 24G Class4 PoE 4SFP+ 370W Switch | `24 x 10/100/1000BASE-T; 4 x 1G/10G SFP ports`；PoE 预算 370W | <https://www.hpe.com/psnow/doc/PSN1013114991WWEN.pdf?jumpid=in_pdp-psnow-dds> |
| JL675A | HPE Aruba Networking CX 6100 48G Class4 PoE 4SFP+ 370W Switch | `48 x 10/100/1000BASE-T; 4 x 1G/10G SFP ports`；PoE 预算 370W | <https://www.hpe.com/psnow/doc/PSN1013114991WWEN.pdf?jumpid=in_pdp-psnow-dds> |

HPE 官方 QuickSpecs 对新商业 SKU 给出更精确的 4SFP 口径：

| SKU | 官方原文 | P0-4.1 判断 |
|---|---|---|
| S0M82A | “24x ports 10/100/1000BASE-T Class 4 PoE Ports ... **4x 100M/1G SFP ports**” | 4SFP 是 100M/1G 上行型号，不得当作 1G/10G SFP+。 |
| S0M84A | “48x ports 10/100/1000BASE-T Class 4 PoE Ports ... **4x 100M/1G SFP ports**” | 4SFP 是 100M/1G 上行型号，不得当作 1G/10G SFP+。 |

QuickSpecs：<https://www.hpe.com/psnow/doc/a00059762enw.html>，版本 37，2026-07-13。

因此，历史关系中明确为 CX 6100 **4SFP+** 的 JL677A/JL675A，可使用其 Data sheet 的 1G/10G 上行证据；而历史关系中明确为 CX 6200F **4SFP** 的 S0M82A/S0M84A/S0M85A，属于 100M/1G 上行商业变体，应与 ALE 10G 上行/堆叠能力分开审阅。

HPE 官方 QuickSpecs 还明确列出 S0M85A（CX 6200F 48G Class‑4 PoE **4SFP** 740W Switch）的产品描述：`48x ports 10/100/1000BASE-T Class 4 PoE Ports ... 4x 100M/1G SFP ports`。因此 S0M85A 也属于 100M/1G 上行商业变体，不能被视为 JL728A（4SFP+、1G/10G）的同一型号或直接技术替代。[QuickSpecs](https://www.hpe.com/psnow/doc/a00059762enw.html)
