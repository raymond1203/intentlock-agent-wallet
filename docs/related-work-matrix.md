# 선행연구 비교표와 baseline 선정

- 기준일: 2026-08-17 KST
- 관련 Issue: #9
- 인용 목록: [`paper/references.md`](../paper/references.md)

이 문서는 survey가 아니라 IntentLock의 claim boundary와 평가 비교군을 정하는 작업 문서다. 수치보다 원 논문이 제공하는 enforcement unit과 guarantee를 우선 비교한다.

## 1. 가장 가까운 방어

| 연구·버전                                                       | Enforcement unit / 핵심 방법                                                                                 | 핵심 보장·평가                                                                    | IntentLock과의 정확한 차이                                                                                                        | Baseline 결정                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [Task Shield](https://arxiv.org/abs/2412.16682) v1, ACL 2025    | 각 instruction·tool call이 사용자 goal에 기여하는지 test-time에 검증                                         | AgentDojo에서 GPT-4o ASR 2.07%, utility 69.79% 보고                               | call-to-goal contribution이 중심이며 EVM state delta, allowance, 누적 budget의 결정론 oracle가 아님                               | **Tier A**: 저자 구현 또는 paper-faithful adapter        |
| [DRIFT](https://arxiv.org/abs/2506.12104) v3, NeurIPS 2025      | minimal function trajectory, node별 parameter checklist, dynamic validator, memory injection isolator        | AgentDojo·ASB·AgentDyn에서 security–utility 평가                                  | 이미 multi-step plan drift를 다루므로 `sequence`는 gap이 아님. 차이는 simulated/actual economic post-state와 cumulative invariant | **Tier A**: plan/checklist baseline                      |
| [Progent](https://arxiv.org/abs/2504.11703) v3                  | tool name·typed argument의 symbolic policy, deterministic check, SMT로 narrowing/expansion 판정              | 승인 없는 effective action space의 monotonic confinement                          | 최소 권한 안에서 조합된 경제 효과와 실행 뒤 state delta는 별도 명세가 필요                                                        | **Tier A**: deterministic per-call policy baseline       |
| [AgentSpec](https://arxiv.org/abs/2503.18666) v3, ICSE 2026     | trigger/predicate/enforcement DSL을 runtime checkpoint에 적용                                                | 다양한 domain에서 구조화 규칙의 경량 runtime enforcement                          | generic rule engine 자체는 신규성이 아님. 우리는 wallet effect label, 누적 ledger, NL contract quality를 평가                     | **Tier A**: stateless rule baseline과 재사용 가능성 조사 |
| [CaMeL](https://arxiv.org/abs/2503.18813) v2                    | trusted query에서 control/data flow를 추출하고 untrusted data가 흐름을 바꾸지 못하게 격리, capability policy | AgentDojo task의 77%를 provable security와 함께 해결, undefended system은 84%     | control/data-flow 보호와 달리 허용된 gadget의 cumulative economic outcome을 직접 bound하지 않음                                   | **Tier B**: 환경 이식 비용 확인 후 포함                  |
| [AgentArmor](https://arxiv.org/abs/2508.01249) v3               | runtime trace를 CFG/DFG/PDG 형태 IR로 만들고 metadata·type system으로 검사                                   | AgentDojo에서 ASR 3%, utility drop 1% 보고                                        | trace program analysis도 이미 존재. 우리의 단위는 dependency graph가 아니라 recursively decoded EVM effect와 exact post-state     | **Tier B**: 공개 artifact 성숙도에 따라 포함             |
| [ScopeGate](https://arxiv.org/abs/2606.28679) v1                | concrete argument의 per-call authorization, money ceiling, idempotency, default deny                         | 작은 static/adaptive corpus에서 fail-closed value gate 평가                       | 호출별 value gate는 가깝지만 wallet-specific cross-call state·allowance·final asset contract는 범위 밖                            | **Tier B**: payment-style value-gate adapter             |
| [Formal Methods Meet LLMs](https://arxiv.org/abs/2605.16198) v1 | LLM labeler와 LTL 기반 temporally extended rule monitor·intervention                                         | constraint distance·개수가 늘 때 LLM temporal reasoning 저하, formal monitor 우위 | temporal/formal monitoring 자체는 신규성이 아님. guarantee는 event label과 spec 정확성에 조건부이며 wallet authorization은 별도   | 구현 baseline보다 **formal design reference**            |

## 2. Benchmark와 Web3 직접 선행

| 연구·버전                                                                                                            | 범위                                                                                           | 핵심 가치                                                                              | 이 연구에 남는 gap                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AgentDojo](https://arxiv.org/abs/2406.13352) v3, NeurIPS 2024 D&B                                                   | 97 realistic tasks, 629 security test cases, stateful tool environment                         | prompt injection attack/defense의 대표 재현 환경                                       | e-banking은 있으나 calldata, allowance, bridge, slippage, exact EVM post-state oracle는 없음. `기존 benchmark는 single-step`이라고 주장하면 안 됨 |
| [Agent Security Bench](https://arxiv.org/abs/2410.02644) v4, ICLR 2025                                               | 10 scenarios, 10 agents, 400+ tools, 27 attack/defense types, 7 metrics                        | agent lifecycle의 다양한 attack surface와 security–utility 평가                        | finance scenario가 wallet semantic state contract를 대체하지 않음                                                                                 |
| [AgentDyn](https://arxiv.org/abs/2602.03117) v3                                                                      | 60 open-ended tasks, 560 injection tests, dynamic planning과 helpful third-party instruction   | static/simple benchmark의 over-defense를 드러냄                                        | shopping/GitHub/daily-life 중심이며 immutable financial post-state가 없음                                                                         |
| [Real AI Agents with Fake Memories](https://arxiv.org/abs/2503.16248) v3                                             | ElizaOS/Web3, 150+ blockchain tasks, 500+ context-manipulation tests                           | prompt·memory·external feed 조작이 unauthorized transfer와 protocol violation을 일으킴 | 가장 직접적인 도메인 근거지만 cumulative effect contract를 signer에서 deterministic enforce하는 연구는 아님                                       |
| [MetaMask Agent Wallet architecture](https://docs.metamask.io/agent-wallet/reference/architecture/), 확인 2026-08-17 | server wallet, transaction simulation, Blockaid scanning, ERC-7821 batch와 sequential fallback | 현실적인 case-study architecture와 enforcement point 제공                              | 공개 API와 local emulator로 제한되며 production backend 내부 구현을 추정하지 않음                                                                 |
| [MetaMask trading modes](https://docs.metamask.io/agent-wallet/reference/trading-modes/), 확인 2026-08-17            | Guard Mode의 network/address/token-recipient allowlist, rolling 24h outflow, 2FA               | 제품 정책과 사용자 확인 baseline                                                       | 공개 정책은 자연어 goal의 final-state semantics 전체가 아님                                                                                       |
| [MetaMask outflow policy](https://docs.metamask.io/agent-wallet/reference/outflow-policy/), 확인 2026-08-17          | 실행 전 simulation, confirmed 후 rolling outflow 반영                                          | stateful monetary budget baseline                                                      | backend 밖 거래 추적·simulation failure의 한계가 있고 Permit2 같은 signature는 outflow에 포함되지 않는다고 문서화                                 |

## 3. 확정한 신규성 gap

### G1. 권한 정책과 경제 의도의 차이

Capability, IFC, tool/argument policy는 `어떤 호출이 허용되는가`를 통제한다. 하지만 허용 권한 안에서도 route, counterparty, slippage, allowance, final asset, chain을 잘못 선택할 수 있다. IntentLock은 이 semantic misuse를 contract field와 state delta로 관찰한다.

### G2. Trace 구조와 누적 post-state의 차이

DRIFT와 AgentArmor도 sequence와 trace를 본다. 따라서 차별점은 trace 관찰 여부가 아니다. IntentLock은 다음 상태를 simulation과 receipt에서 추출하고 accepted prefix 전체에 누적한다.

- asset balance와 total outflow
- allowance·Permit 권한과 expiry
- debt·collateral·LP·ownership
- final recipient·asset·chain
- gas/fee와 execution count
- pending concurrent reservation

### G3. 허용 gadget의 조합적 의도 세탁

Approve, swap, bridge, transfer가 각각 허용되어도 반복·순서·batch·retry·residual allowance를 합치면 계약을 위반할 수 있다. 이 공격군을 `intent laundering`으로 정의하되 용어 자체의 최초성은 주장하지 않는다.

### G4. Specification gap

Formal monitor의 보장은 입력 contract와 event label이 맞다는 조건에만 성립한다. 따라서 NL intent compiler의 critical-field recall, 사용자 수정, escalation burden을 monitor 성능과 분리해 측정한다.

### G5. 공격 없는 drift

Hallucination, stale quote, ambiguous intent, retry non-idempotence, tool error 뒤 replan도 동일한 경제적 위반을 만든다. 공격 ASR과 benign drift failure rate를 별도로 보고한다.

### G6. Wallet-specific exact oracle

주 평가는 LLM judge가 아니라 forked-chain simulation과 actual post-state diff로 수행한다. 지원 protocol 범위와 decoder completeness는 결과와 함께 공개한다.

## 4. Baseline 실행 우선순위

### 최소 비교군 — 반드시 완료

1. **No defense**: agent output를 validation 없이 simulator/executor에 전달한다.
2. **Guard Mode emulator**: 공식 문서의 network/address/token recipient allowlist와 rolling 24h outflow를 재현한다. MetaMask production과 동등하다고 부르지 않는다.
3. **Task Shield adapter**: action-to-user-goal contribution을 LLM이 판정한다.
4. **DRIFT adapter**: 사전 plan과 parameter checklist 이탈을 LLM validator가 판정한다.
5. **Progent-like policy**: tool name과 typed argument를 deterministic per-call policy로 검사한다.
6. **IntentLock full**: recursive effect extraction, cumulative ledger, post-state verification을 모두 사용한다.

이 6개만으로 `none / product-public-policy / LLM call alignment / LLM plan alignment / deterministic call policy / cumulative effect contract` 축이 형성된다.

### 확장 비교군 — 일정이 허용할 때

- AgentSpec: 동일 invariant를 stateless checkpoint rule로 표현
- CaMeL: trusted-plan/capability runtime을 wallet adapter에 이식
- AgentArmor: runtime dependency graph adapter
- ScopeGate: money ceiling·idempotency value gate

### 구현 공정성

- 가능한 경우 저자 공식 저장소와 pin된 commit을 사용한다.
- wallet adapter가 원 연구의 보장을 약화하면 결과 표에 `adapted`로 표시한다.
- 동일한 agent model, user task, tool response, random seed, retry budget을 사용한다.
- baseline이 지원하지 않는 signature·state를 무조건 실패로 세지 않고 `unsupported`와 `unsafe allow`를 구분한다.
- LLM 기반 baseline에는 동일 model과 inference budget을 제공한다.

## 5. 안전한 차별화 문장

> 기존 시스템이 tool, argument, control/data flow, plan alignment를 통제하는 반면, IntentLock은 Agent Wallet의 시뮬레이션된·실행된 온체인 상태 변화에 대해 누적 경제 의도 계약을 시행하고, 허용 권한 내부의 조합적 의도 세탁과 비적대적 drift를 함께 평가한다.

## 6. Reviewer 사실 확인 항목

- [ ] 논문 version과 venue가 원문과 일치한다.
- [ ] 숫자를 서로 다른 arXiv version에서 섞지 않았다.
- [ ] `sequence`, `runtime`, `formal`, `multi-step` 최초 주장이 없다.
- [ ] MetaMask 공개 문서의 limitation을 production 취약점으로 과장하지 않았다.
- [ ] baseline adapter와 원 시스템을 구분했다.
- [ ] Web3 직접 선행을 누락하지 않았다.
