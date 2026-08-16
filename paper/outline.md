# IntentLock 논문 개요

## 제목

**IntentLock: 멀티 툴 LLM 에이전트의 누적 경제 효과 계약에 대한 런타임 검증 — MetaMask Agent Wallet 사례 연구**

## 0. 제출 메타데이터 자리표시자

- 팀 EVM 주소: `[SUBMISSION_WALLET]`
- 참가 인원: `2`
- 트랙: `MetaMask`
- 동아리 코드: `[CLUB_CODE]`

실제 값은 제출용 Notion에만 넣고 저장소 원고에는 커밋하지 않는다.

## 1. 초록

문제, 기존 방어의 경계, IntentLock, 평가 방법, 핵심 결과를 5문장으로 요약한다. 결과 수치는 실험 동결 전 넣지 않는다.

핵심 메시지: 개별적으로 허용된 approve, swap, bridge, transfer가 조합될 때 수취인·누적액·allowance·chain·최종 자산 의도를 위반할 수 있다. IntentLock은 LLM 판단에 자금 게이트를 맡기지 않고, 시뮬레이션된 온체인 효과와 누적 계약을 결정론적으로 비교한다.

## 2. 서론

1. 멀티 툴 LLM 에이전트와 불변 금융 상태 전이의 위험
2. prompt injection뿐 아니라 hallucination, stale quote, retry, replan이 만드는 drift
3. 기존 tool/argument/plan/flow policy와 누적 economic post-state 사이의 gap
4. MetaMask Agent Wallet을 practical case study로 택한 이유
5. 한 문장 주장과 기여 3개

## 3. 배경과 동기 사례

### 3.1 MetaMask Agent Wallet 공개 구조

- 서버 지갑과 SDK/CLI
- transaction simulation과 threat scanning
- Guard Mode의 allowlist·rolling 24h outflow
- batch execution과 sequential fallback

### 3.2 공개 Guard Mode 정책의 관찰 경계

- backend 밖 실행의 추적 한계
- simulation failure 시 allowlist 의존
- Permit2 같은 signature가 outflow에 포함되지 않는 한계

### 3.3 Intent laundering 동기 사례

사용자는 `1 ETH 이내로 USDC를 사고 남은 권한을 제거`하라고 요청한다. agent는 허용된 approve, multi-hop swap, retry를 각각 호출하지만 unlimited allowance, 중복 실행, 다른 최종 token으로 이어진다. 각 호출의 tool/argument가 부분 목표에 기여해도 누적 post-state는 의도를 위반한다.

## 4. 문제 정의와 위협 모델

- trusted user request, untrusted agent context, signer trust boundary
- trace, simulated effect, actual effect, cumulative ledger 정의
- adversarial manipulation과 benign drift 분리
- safety invariant, liveness, escalation 정의
- 조건부 prefix-safety 보장과 non-goal

근거: [`docs/threat-model.md`](../docs/threat-model.md)

## 5. IntentLock 설계

### 5.1 Intent Contract

- goal/end-state
- asset와 cumulative max amount
- minimum received와 slippage
- gas budget
- chain, target, selector, code hash, counterparty
- allowance·ownership·debt 제한
- deadline, nonce, idempotency key
- partial order와 forbidden effects
- widening 시 확인 정책

### 5.2 Intent compiler와 사용자 확인

- LLM은 후보 계약만 생성한다.
- 불확실한 critical field는 구체적인 질문으로 확인한다.
- narrowing은 자동, widening은 재확인한다.
- confirmation burden과 critical-field recall을 독립 평가한다.

### 5.3 Recursive effect extraction

- calldata, multicall, internal call, proxy/delegatecall, event, typed signature
- fork simulation으로 expected `ActionIR` 생성
- unsupported effect는 fail-closed 또는 escalation

### 5.4 Stateful monitor

- accepted prefix와 reservation ledger
- concurrent calls의 원자적 budget reservation
- `ALLOW`, `DENY`, `ESCALATE`
- intent hash에 묶인 one-time signing capability

### 5.5 Post-state verification

- receipt와 actual state diff를 expected effect와 대조
- mismatch 기록, 후속 호출 동결, 사용자 escalation

## 6. 보안 분석

- invariant별 enforcement point
- conditional prefix-safety 정리와 증명 개요
- individually allowed gadget composition 차단 예시
- TOCTOU, retry, concurrency 분석
- decoder/simulator/specification failure의 잔여 위험

## 7. 평가 방법

### 7.1 RQ

- RQ1: 조합 위반의 빈도와 유형
- RQ2: security–utility 비교
- RQ3: ablation
- RQ4: 일반화·적응형 공격·명세 품질

### 7.2 Workflows

- transfer
- approve/Permit2 + swap
- multi-hop swap
- bridge + destination swap
- stake/unstake
- lend/repay
- DCA/retry
- batch execution

### 7.3 실패·공격

- indirect prompt injection, malicious tool metadata, memory poisoning
- recipient/token/chain substitution
- amount/slippage/gas inflation, unlimited allowance
- hidden batch/internal call, proxy/delegatecall
- stale quote/TOCTOU, duplicate retry, concurrency race
- hallucination, tool error 뒤 잘못된 replan

### 7.4 비교군

- No defense
- 공개 문서 기반 Guard Mode emulator
- Task Shield
- DRIFT
- Progent
- AgentSpec
- CaMeL 또는 AgentArmor

### 7.5 지표와 통계

- 주 지표: Unsafe Execution Rate
- 효용: Benign Task Completion
- 위해 규모: unauthorized value, excess allowance exposure
- 탐지: pre-sign detection, detection step
- 사용성: false deny, escalation, confirmation burden
- 비용: latency, token cost
- compiler: critical-field precision/recall
- exact fork/post-state oracle를 주 평가자로 사용하고 LLM judge는 정성 분석에만 사용

## 8. 결과

결과 표는 RQ 순서로 배치한다. pilot 결과와 final 결과를 분리하고, 실패 사례와 negative result를 숨기지 않는다.

## 9. 논의

- specification gap과 사용자 확인 UX
- Guard Mode와의 상보성
- protocol coverage·decoder registry 유지 비용
- 실제 signer integration 전의 외적 타당도
- responsible disclosure와 재현성 공개 시점

## 10. 관련 연구

- agent security benchmark
- task/plan alignment
- privilege, capability, IFC
- runtime/formal monitor
- Web3 agent context manipulation

근거: [`docs/related-work-matrix.md`](../docs/related-work-matrix.md)

## 11. 한계와 윤리

- 조건부 보장
- 실제 자금·메인넷 사용 금지
- 악성 calldata와 공격 fixture 공개 범위
- 재현성 자료에서 익명성·secret 제거

## 12. 결론

`sequence를 본다`가 아니라 `누적 경제 효과를 검증한다`는 차별점을 다시 제시한다. MetaMask Agent Wallet은 LLM 보안 연구의 현실적인 사례로 정리한다.
