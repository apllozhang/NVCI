# P0-4.1 直接候选关系审阅建议包

本建议包不改变 P0-4 生产关系的 `match_status` 或 `review_state`。每一条关系仍须由产品经理在 NVCI 中明确批准、驳回或继续保持待复核。

## 建议汇总

| 建议 | 数量 | 审阅含义 |
|---|---:|---|
| 保持直接候选，进入人工批准 | 18 | 决定性能力没有已核验的降档；仍需核实项目上行、PoE 与部署条件。 |
| 建议降级为部分候选 | 18 | 已存在上行、端口数、供电预算或电源冗余的结构性差异。 |

## 优先级

| 优先级 | 数量 | 优先处理事项 |
|---|---:|---|
| P1 | 9 | HPE CX 6200F 4SFP 商业变体的 100M/1G 上行能力与 ALE 10G 上行存在已核验差异。 |
| P2 | 9 | OS6560 的单/双 PSU 条件化 PoE、六端口上行/堆叠结构及对端供电架构需按项目确认。 |
| P3 | 18 | 可进入产品经理人工审核，但不能自动批准。 |

## 关键治理结论

HPE 官方 QuickSpecs 已确认 CX 6200F 的 `4SFP`（S0M82A、S0M84A、S0M85A）是 100M/1G SFP 上行商业变体，而 `4SFP+` 是不同的型号身份。前者不得再被当作 1G/10G 上行的直接候选。

ALE OS6560-P24X4 与 OS6560-P48X4 的 PoE 预算并非“未披露”：它们取决于所装电源数量。任何对标、评分或采购结论都必须分别核验单 PSU 与双 PSU 的实际配置和供电负载。

## 官方资料

1. [ALE OmniSwitch 6360 Data sheet](https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-6360-datasheet-en.pdf)
2. [ALE OmniSwitch 6560/6560E Data sheet](https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-6560-6560e-datasheet-en.pdf)
3. [HPE Aruba CX 6200F Specifications](https://support.hpe.com/hpesc/public/docDisplay?docId=a00099581en_us&docLocale=en_US)
4. [HPE Aruba CX 6200 QuickSpecs](https://www.hpe.com/psnow/doc/a00059762enw.html)
5. [HPE Aruba CX 6100 Data sheet](https://www.hpe.com/psnow/doc/PSN1013114991WWEN.pdf?jumpid=in_pdp-psnow-dds)

