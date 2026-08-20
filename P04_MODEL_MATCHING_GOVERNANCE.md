# P0-4：型号级对标关系库治理规范

> 首批范围：ALE OmniSwitch 6360、6370、6560/6560E；HPE Aruba CX 6100、6200、6300。
>
> 关系库目的：将基础技术型号之间的对标关系、硬门槛结果、偏离项与两侧官方证据绑定，支持产品经理审阅，而不是生成自动化“胜负”结论。

## 1. 受控输入与证据边界

首批输入继承不可变历史快照 `horizontal-ale-aruba-ethernet-switches-full-2026-08-17-v3-switch-portfolio-order`。其 `manifest.json` 指定 ALE 仅以官方产品页、Data sheet 与其中 Order information/型号表为依据；HPE Aruba 以官方 Data sheet 为主，并以商城的 Data sheet → Specifications → QuickSpecs 顺序仅作导航或字段补证。对输入 CSV 的 SHA-256 已在 `intelligence/baselines/p04-pilot-input-audit.json` 中记录。

HPE 当前官方资料页仍公开提供以下三个系列的 Data sheet 下载入口：CX 6100、CX 6200、CX 6300。[1] [2] [3] 该核验仅确认官方资料链仍有效；本期型号事实仍以带哈希的历史原始 PDF、型号级摘录和其对应 Data sheet URL 为可追溯导入基线。

| 厂商 | 系列 | 基础技术型号数 | 允许的型号级证据 | 限制 |
|---|---:|---:|---|---|
| ALE | OmniSwitch 6360 | 10 | 官方 Data sheet 内 Order information/型号表 | 3 个非 PoE 型号的 PoE 字段未在历史主表显式填充，不能自动当作不支持。 |
| ALE | OmniSwitch 6370 | 16 | 官方 Data sheet 内 Order information/型号表 | 硬门槛字段完整；软件/许可仍不得从系列资料下沉为 SKU 事实。 |
| ALE | OmniSwitch 6560/6560E | 9 | 官方 Data sheet 内 Order information/型号表 | 多个型号的 PoE 预算未披露；不允许生成依赖预算的确定性匹配。 |
| HPE Aruba | CX 6100 | 6 | 官方型号 Data sheet | PoE 预算有部分未披露。 |
| HPE Aruba | CX 6200 | 21 | 官方型号 Data sheet | 仅导入基础技术型号，TAA/区域/包装变体不重复计数。 |
| HPE Aruba | CX 6300 | 19 | 官方型号 Data sheet | 仅导入基础技术型号，软件许可/版本保持独立证据粒度。 |

## 2. 关系状态与硬门槛

每条关系使用稳定键 `vendor | series | sku` 指向两侧的基础技术型号；同一型号允许存在多条候选关系。关系状态仅可为：`direct_candidate`、`partial_candidate`、`adjacent_upgrade`、`not_comparable` 或 `insufficient_evidence`。

首层硬门槛依次为：**固定/模块化形态、部署环境、下行介质、下行端口数量窗口、下行速率带相交，以及 PoE 需求。** 固定与模块化、普通园区与工业加固、铜缆与全光下行不得被判为直接对标。任何硬门槛缺少型号级证据时，关系必须为 `insufficient_evidence`；任何硬门槛不通过时，关系必须为 `not_comparable`，并记录具体排除原因。

通过硬门槛后，系统只记录端口、上联、PoE、性能、堆叠/虚拟化、三层与 OSPF、自动化、网管、安全及许可的匹配状态与偏离项。系列或平台级软件资料只能标记 `series_or_platform_only`，不得升级为 SKU 级功能对等结论。

## 3. 存储与审核原则

对标关系必须分别关联：双方型号实体、双方 Data sheet 文档修订、字段级证据，以及导入快照。已核验硬件事实可以用于直接候选；未披露字段保持未披露；待复核事实或关系自动写入审核队列。关系库不允许通过删除或覆盖历史关系静默修正；修订以新的导入运行与治理审计记录实现。

## References

[1]: https://www.hpe.com/psnow/doc/a00106853enw "HPE Aruba Networking CX 6100 Switch Series"
[2]: https://www.hpe.com/psnow/doc/a00097415enw "HPE Aruba Networking CX 6200 Switch Series"
[3]: https://www.hpe.com/psnow/doc/a00085162enw "HPE Aruba Networking CX 6300 Switch Series"
