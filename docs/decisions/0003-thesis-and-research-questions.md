# 0003 — 연구 주장과 연구 질문 동결

- 상태: 승인 대기
- 결정일: 2026-08-17 KST
- Owner: `@raymond1203`
- Reviewer: `@billy-baek`
- 관련 Issue: #7

## Context

멀티 툴 에이전트의 계획 이탈, 호출 단위 정책, 데이터 흐름, 런타임 규칙, 시간적 제약은 이미 Task Shield, DRIFT, Progent, AgentArmor, AgentSpec, CaMeL 등의 연구가 다룬다. 따라서 `최초의 multi-step guardrail`이나 `최초의 runtime policy`는 방어할 수 없는 주장이다.

MetaMask 트랙은 LLM 보안·형식 검증·AI 기반 스마트 계약 보안이 본 주제이며 Agent Wallet은 실제 적용 사례여야 한다. 연구 질문과 증거를 이 경계에 맞춰 고정한다.

## Decision

### 제목

- 국문: **IntentLock: 멀티 툴 LLM 에이전트의 누적 경제 효과 계약에 대한 런타임 검증 — MetaMask Agent Wallet 사례 연구**
- 영문: **IntentLock: Runtime Verification of Cumulative Economic Effect Contracts for Multi-Tool LLM Agents — A MetaMask Agent Wallet Case Study**

`IntentLock`은 임시 시스템명으로 유지하되, 핵심 개념인 `cumulative economic effect contract`는 변경하지 않는다.

### 한 문장 주장

> 개별적으로 정책을 준수하는 멀티 툴 호출도 조합되면 사용자 의도에 어긋난 온체인 결과를 만들 수 있으며, 시뮬레이션·실행에서 관찰한 누적 상태 전이에 대해 버전이 고정된 경제 의도 계약을 시행하면 호출·계획·흐름 단위 방어보다 정상 과업 효용을 크게 훼손하지 않으면서 unsafe execution을 줄일 수 있다.

### 핵심 가설

동일한 task suite와 공격 예산에서 전체 IntentLock은 가장 강한 비교군보다 낮은 `Unsafe Execution Rate`를 달성하고, 정상 과업 완료율 하락과 사용자 확인 부담은 사전 정의한 허용 범위 안에 머문다.

효용 허용 범위의 수치는 pilot 이후 사전 등록 문서에서 고정한다. 결과를 본 뒤 임계값을 바꾸지 않는다.

### 연구 기여

1. 잔액, allowance, debt, ownership, gas, chain, counterparty의 누적 변화를 표현하는 typed economic intent contract와 상태 기반 monitor.
2. calldata·batch·internal call·signature를 재귀적으로 해석하고 fork simulation의 예상 효과와 실제 receipt/post-state를 연결하는 검증 파이프라인 및 조건부 prefix-safety 명세.
3. 공격적 context manipulation과 비적대적 drift를 함께 포함하고 exact post-state oracle로 평가하는 재현 가능한 Agent Wallet 사례 벤치마크.

### 연구 질문과 측정치

| RQ  | 질문                                                                                      | 주 지표                                                      | 보조 지표·분석                                                                         |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| RQ1 | 개별 허용 호출의 조합이 누적 경제 의도를 위반하는 빈도와 유형은 무엇인가?                 | 조합 위반 발생률                                             | 공격 유형별 ASR, 최초 위반 step, unauthorized value, excess allowance exposure         |
| RQ2 | 누적 상태 계약은 호출·계획·흐름 단위 방어보다 어떤 security–utility trade-off를 보이는가? | Unsafe Execution Rate와 Benign Task Completion의 Pareto 비교 | false deny, pre-sign detection, confirmation burden, latency, token cost               |
| RQ3 | semantic·symbolic·stateful 구성요소 중 효과에 기여하는 것은 무엇인가?                     | 구성 제거별 Unsafe Execution Rate 변화                       | stateless/stateful, shallow/recursive decoder, pre/post-state verifier ablation        |
| RQ4 | 모델·프로토콜·체인·적응형 공격이 바뀔 때 보안과 명세 작성 품질이 유지되는가?              | unseen split의 Unsafe Execution Rate                         | critical-field recall, escalation precision, 사용자 수정 횟수, chain/protocol별 완료율 |

### 주 지표의 운영 정의

`Unsafe Execution Rate (UER)`는 실행된 episode 중 사용자 확인 계약의 safety invariant를 위반하는 실제 post-state 또는 서명된 권한 효과가 발생한 episode의 비율이다.

- 분자: exact oracle이 위반으로 판정한 실행 episode 수
- 분모: agent가 실행을 시도한 평가 episode 수
- pre-sign 차단과 escalation은 unsafe execution이 아니다. 별도로 utility·burden에 반영한다.
- 실행 전 시뮬레이션만 위험했지만 실제 서명이 일어나지 않은 경우는 detection 성능에 포함하고 UER 분자에는 넣지 않는다.

## 비주장 항목

- 최초의 멀티스텝·trajectory guardrail이라고 주장하지 않는다. DRIFT와 AgentArmor는 이미 실행 궤적을 다룬다.
- 최초의 결정론적 runtime policy 또는 formal monitor라고 주장하지 않는다. Progent, AgentSpec, CaMeL 및 LTL monitor 선행이 있다.
- 기존 benchmark가 모두 single-step이라고 쓰지 않는다. AgentDojo와 AgentDyn은 다단계·동적 과업을 포함한다.
- 자연어 사용자 의도를 완전하게 추출하거나 증명한다고 주장하지 않는다.
- 모든 EVM 프로토콜, unknown proxy, Byzantine RPC, MEV와 가격 위험을 해결한다고 주장하지 않는다.
- MetaMask의 비공개 production backend 또는 Guard Mode와 동등한 구현이라고 주장하지 않는다. 공개 문서에 따른 case-study emulator로 한정한다.
- conditional guarantee를 unconditional·end-to-end safety guarantee로 표현하지 않는다.

## Track fit 문장

> 본 연구의 주제는 멀티 툴 LLM 에이전트가 형식화된 사용자 안전 속성을 지키도록 하는 런타임 보안 검증이며, MetaMask Agent Wallet은 금전적 상태 전이가 명확하고 실패 비용이 큰 practical case study로 사용한다.

## Alternatives

- **Agent Wallet 제품 기능 연구:** 대회 안내가 Agent Wallet을 primary focus로 삼지 말라고 하므로 기각했다.
- **prompt injection detector:** 메모리·실행 오류·허용 호출 조합을 포함하지 못하고 기존 연구와 겹쳐 기각했다.
- **tool sequence alignment:** sequence 자체는 선행이 강하므로, sequence가 만든 누적 post-state 의미로 범위를 좁혔다.

## Consequences

- 구현은 tool name보다 `ActionIR`과 누적 state delta를 중심으로 설계한다.
- 모든 실험 결과는 [`docs/claim-to-evidence.md`](../claim-to-evidence.md)의 주장과 연결한다.
- 새로운 기능이 RQ 또는 조건부 보장에 기여하지 않으면 M1 이후 범위에 넣지 않는다.

## Evidence

- [대회 규칙 결정문](0002-competition-rules-and-deadline.md)
- [Task Shield](https://arxiv.org/abs/2412.16682), v1, 확인 2026-08-17
- [DRIFT](https://arxiv.org/abs/2506.12104), v3, 확인 2026-08-17
- [Progent](https://arxiv.org/abs/2504.11703), v3, 확인 2026-08-17
- [AgentArmor](https://arxiv.org/abs/2508.01249), v3, 확인 2026-08-17
- [AgentSpec](https://arxiv.org/abs/2503.18666), v3, 확인 2026-08-17
- [CaMeL](https://arxiv.org/abs/2503.18813), v2, 확인 2026-08-17
