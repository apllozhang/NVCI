# P0-4.1 直接候选审阅建议包

**状态：**受控建议已完成，待产品经理人工决定；本建议包不自动改变 P0-4 生产关系。  
**范围：**ALE OmniSwitch 6360 / 6560(E) 与 HPE Aruba CX 6100 / 6200F / 6200M 的 36 条 `direct_candidate` 关系。  
**建议基线：**`intelligence/baselines/p041-direct-candidate-advisories.json`。  
**证据策略：**仅使用官方 Data sheet、官方 Specifications、官方 QuickSpecs、官方商城 SKU 页面及随版本发布的不可变资料快照。

## 1. 结论摘要

本轮重审将 P0-4 中的 36 条直接候选关系分为两类建议。**18 条建议保留为直接候选并进入人工批准环节，18 条建议降级为部分候选。** 所有 36 条生产关系的 `match_status` 与 `review_state` 保持原值；P0-4.1 只向独立建议表和审核队列写入审阅意见。

| 审阅建议 | 数量 | 决策含义 |
|---|---:|---|
| 建议保留直接候选 | 18 | 硬门槛没有发现已核验的决定性降档，但必须在批准前确认上行、PoE 负载、电源配置与部署环境。 |
| 建议降级为部分候选 | 18 | 已核验到型号身份、上行速率、堆叠或条件化 PoE 等重要偏离；不可无条件用作一对一替代。 |
| P1 验证 | 9 | HPE CX 6200F `4SFP` 商业变体的上行是 `100M/1G SFP`，与 `4SFP+` 或 ALE 的 `1G/10G SFP+` 不可混同。 |
| P2 验证 | 9 | OS6560 的上行、堆叠与单/双 PSU 条件化 PoE 预算需要结合项目拓扑和供电负载验证。 |
| P3 验证 | 18 | 现场 PoE 负载、上行模块兼容性及已核验环境参数与项目条件的匹配。 |

> **审批门禁：**P0-4.1 的“建议保留直接候选”不等于“已批准”。只有产品经理在 NVCI 关系详情中审阅双方硬门槛、原文、SHA-256、偏离项和采购验证问题，并明确填写理由后，才可将关系转为 `approved`。

## 2. 已核验的关键勘误

### 2.1 `4SFP` 与 `4SFP+` 必须是不同技术身份

HPE 官方 QuickSpecs 与官方商城将 CX 6200F 的 `4SFP` 和 `4SFP+` 明确为不同商业 SKU。`S0M82A`、`S0M84A` 与 `S0M85A` 的 4 个上行端口是 **100M/1G SFP**；`JL725A/JL725B`、`JL727A`、`JL728A` 等 `4SFP+` 型号的上行是 **1G/10G SFP**。因此，历史候选中凡明确为 `4SFP` 的关系均不能借用 `4SFP+` 的 10G 上行证据。[1] [2]

| 官方 SKU 示例 | 已核验上行 | P0-4.1 处理 |
|---|---|---|
| S0M82A / S0M84A / S0M85A | 4 × 100M/1G SFP | 建议降为部分候选；若项目要求 10G 上行，则不得批准为直接映射。 |
| JL725A/JL725B / JL727A / JL728A | 4 × 1G/10G SFP 或 SFP+ | 可保留直接候选的技术前提，但仍须结合 PoE、模块和环境确认。 |

### 2.2 OS6560 的 PoE 预算是电源条件化字段

ALE OmniSwitch 6560 Data sheet 明确 OS6560-P24X4 与 OS6560-P48X4 采用固定 1RU 形态、`2x 1G SFP + 4x 1G/10G SFP+` 上行/堆叠端口，但 PoE 预算取决于单/双 PSU 配置；例如 P24X4 的上限为单 PSU 532W、双 PSU 1085W。该数值不得被简化为无条件基础型号能力。[3]

| 风险点 | P0-4.1 处理 |
|---|---|
| 双 PSU 最大预算被误用为默认预算 | P2 审核项：批准前确认实际电源配置和 PoE 总负载。 |
| 2 × 1G SFP + 4 × 1G/10G SFP+ 与 4 上行端口的差异 | P2 审核项：确认项目所需 10G 数量、堆叠拓扑和模块兼容性。 |
| HPE 候选未能一对一映射至具体官方 SKU | 保持待复核或建议部分候选，不作自动型号替换。 |

## 3. NVCI 写入边界

P0-4.1 新增 `comparison_relationship_advisories` 独立表，并在 P1/P2 建议时生成 `relationship_advisory` 审核项。其写入约束如下。

| 对象 | P0-4.1 会写入 | P0-4.1 不会写入 |
|---|---|---|
| 审阅建议 | 建议类型、优先级、证据说明、验证问题、基线来源 | 不会覆盖 P0-4 的原始算法结论。 |
| 审核队列 | 9 项 P1 与 9 项 P2 的人工验证项 | 不会自动关闭既有审核项。 |
| 生产关系 | 保持 `match_status` 与 `review_state` 不变 | 不会自动批准、驳回、替代或删除关系。 |
| 资料资产 | 不修改 PDF、资料库、采集配置、历史快照或 Google Drive 归档 | 不下载、不覆盖、不重命名原始资料。 |

## 4. 产品经理批准前检查表

对于“建议保留直接候选”的关系，至少确认以下问题后才能批准：实际终端的 PoE 合计功耗是否落在设备、所选电源和冗余设计的可用预算内；上行速率、端口数量、SFP/SFP+ 模块和堆叠拓扑是否满足项目；设备的温湿度、机架和环境条件是否与项目一致。对于“建议降级为部分候选”的关系，如项目需要 10G 上行，`4SFP` 型号必须排除为直接映射。

## References

[1]: https://www.hpe.com/psnow/doc/a00059762enw.html "HPE Aruba Networking CX 6200 Switch Series QuickSpecs"
[2]: https://support.hpe.com/hpesc/public/docDisplay?docId=a00099581en_us&docLocale=en_US "HPE Aruba Networking CX 6200 Switch Series Specifications"
[3]: https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-6560-6560e-datasheet-en.pdf "ALE OmniSwitch 6560/6560E Data Sheet"
[4]: https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-6360-datasheet-en.pdf "ALE OmniSwitch 6360 Data Sheet"
