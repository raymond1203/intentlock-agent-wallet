# 0004 — 보안 보장 경계

- 상태: 승인 대기
- 결정일: 2026-08-17 KST
- Owner: `@raymond1203`
- Reviewer: `@billy-baek`
- 관련 Issue: #8

## Context

자연어 의도를 계약으로 바꾸는 과정과 EVM 효과를 해석하는 과정에는 specification gap이 있다. 형식 monitor의 transition이 정확해도 계약에 필드가 빠지거나 decoder가 hidden effect를 놓치면 실제 사용자 의도까지 보장할 수 없다. 반대로 모든 불확실성을 거부하면 정상 과업 효용이 사라진다.

연구가 증명하려는 것과 실험으로만 보이려는 것을 분리해야 한다.

## Decision

### 보장의 단위

- 단위는 tool call 이름이나 agent의 자연어 plan이 아니라 `ActionIR`로 label된 예상·실제 온체인 효과다.
- monitor는 단일 호출과 함께 accepted trace prefix, confirmed effects, pending reservations를 검사한다.
- 안전 속성은 잔액, allowance, 수취인, chain, min received, gas, debt, ownership, 실행 횟수의 계약 invariant다.

### 조건부 prefix-safety

다음 전제를 둔다.

1. 확정된 contract `C`가 보호하려는 사용자 safety intent를 충분히 표현한다.
2. 지원된 후보 실행 `a`에 대해 decoder와 simulator가 effect label `E(a)`를 sound하게 생성한다.
3. ledger transition과 reservation이 선형화 가능하며 signer는 monitor의 capability 없이는 실행하지 않는다.
4. monitor가 contract predicate를 정확히 구현한다.

그러면 초기 상태가 `C`를 만족하고 monitor가 trace의 각 transition을 ALLOW한 경우, 모든 authorized trace prefix의 누적 효과는 `C`의 safety invariant를 만족한다.

논문에서는 이를 **조건부 prefix-safety**로 부른다. 자연어 사용자 의도 전체의 보장으로 확장하지 않는다.

### 불확실성 정책

- `ALLOW`: effect가 완전히 지원되고 모든 누적 invariant를 만족한다.
- `DENY`: 위반이 확정적이거나 안전한 upper bound를 만들 수 없다.
- `ESCALATE`: specification ambiguity, unsupported semantics, contract widening, state mismatch가 있다.
- 기존 권한의 narrowing은 자동 적용할 수 있다. widening은 구체적 diff를 보여주고 사용자의 새 확인과 contract version을 요구한다.

### 실행 후 경계

Receipt/post-state verification은 예상과 실제의 불일치를 탐지하고 다음 실행을 막지만, 이미 확정된 비가역 상태를 되돌린다고 보장하지 않는다. 복구 가능성은 workflow별로 별도 보고한다.

## Alternatives

- **LLM judge가 최종 서명 결정:** 확률적 판정이 자금 안전의 마지막 게이트가 되므로 기각했다.
- **모든 unsupported call 거부:** security baseline으로는 유지할 수 있으나 실사용 utility 비교를 위해 ESCALATE를 둔다.
- **transaction별 stateless budget:** 허용 gadget의 반복·retry·동시성 합성을 놓치므로 기각했다.
- **자연어 의도 완전 증명:** 검증 가능한 전제가 아니므로 기각했다.

## Consequences

- decoder coverage와 contract compiler 품질을 monitor 정확도와 분리해 평가한다.
- 실험 실패를 `policy violation`, `unsupported effect`, `specification error`, `post-state mismatch`로 구분한다.
- 모든 보안 주장에는 전제와 out-of-scope를 함께 둔다.
- 구현은 signer capability와 atomic reservation을 제외하고는 end-to-end 보장을 주장할 수 없다.

## Evidence

- 상세 위협 모델: [`docs/threat-model.md`](../threat-model.md)
- [AgentSpec](https://arxiv.org/abs/2503.18666): 구조화된 trigger/predicate/enforcement 기반 runtime rule
- [Progent](https://arxiv.org/abs/2504.11703): deterministic policy check와 monotonic confinement
- [CaMeL](https://arxiv.org/abs/2503.18813): trusted control/data flow와 capability policy
- [Formal Methods Meet LLMs](https://arxiv.org/abs/2605.16198): temporally extended constraint의 LTL monitoring과 labeler 경계
- [MetaMask Agent Wallet architecture](https://docs.metamask.io/agent-wallet/reference/architecture/): simulation·threat scanning·server wallet 구조
- [MetaMask outflow policy](https://docs.metamask.io/agent-wallet/reference/outflow-policy/): rolling budget와 공개된 추적 한계
