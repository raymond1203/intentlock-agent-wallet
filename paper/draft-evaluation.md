# 벤치마크·평가·한계·MetaMask 제안 초안

> 상태: v0.4.0 M3 동결 결과 전 구조 초안. `[결과 삽입]` 표시는 raw result와 분석 스크립트가
> 생성한 값으로만 교체한다. 제출 조립 원문은 [`final-source.md`](final-source.md)다. 검토 절차는
> `SOLO_AI_ASSISTED`이며 AI 검토와 최종 저자 승인을 구분한다. 독립 인간 검수를 주장하지 않는다.

## 1. 평가 목적

평가는 다음 네 질문에 답하도록 설계한다. 첫째, 개별 호출이 허용 범위에 있어도 누적 경제 상태가
계약을 위반하는 사례가 얼마나 존재하는가. 둘째, IntentLock이 no defense, 공개 문서 기반 Guard
Mode emulator, stateless LLM verifier, deterministic per-call policy에 비해 offline counterfactual
unsafe-authorization rate를 낮추면서 정상 완료 가능성을 얼마나 유지하는가. 셋째, semantic contract,
symbolic enforcement, stateful
ledger, recursive decoder와 post-state verifier 중 어떤 요소가 결과에 기여하는가. 넷째,
author-exposed evaluation split과 적응형 재계획에서 실패 양상이 어떻게 바뀌는가.

## 2. 벤치마크

데이터 v0.4.0은 transfer, approval·Permit2, single/batch swap, bridge+destination action, lending,
batch recovery의 80개 base intent를 포함한다. 모든 scenario는 natural-language request, typed intent
contract, ordered calls, expected economic effects, fixed-fork reference와 oracle 요구사항을 갖는다.

주 offline corpus는 base마다 정상 trace 하나와 scope, budget, composition 공격 세 개, benign drift
하나를 적용한 400개 case다. 동일 base의 다섯 case는 split과 bootstrap resampling에서 같은 group으로
유지한다. mutation operator가 workflow에 적용되지 않으면 사전 등록된 동일 범주의 다음 operator를
사용하며, invalid calldata나 no-op을 수량 충족용 공격으로 세지 않는다.

Ethereum과 Base의 block number, block hash, contract codehash를 고정한다. v0.4.0 base 80개의
fixed-fork 실행 evidence는 clean committed candidate에서 전량 수집됐고, 독립 재검증 결과 80개
final-goal PASS와 0개 synthetic-reference disagreement다. 이는 M2 데이터 품질 증거이며 아직 M3
시스템 비교 결과가 아니다. mutation은 semantic transaction candidate,
post-state-only fixture, invalid-call drift를 구분한다. cross-chain destination 단계의 test
relayer·attester는 production bridge liveness나 attestation security를 재현하지 않는다.

기존 파일에 표시된 HIDDEN_TEST는 개발 중 저자에게 노출되었으므로 unseen split으로 해석하지 않는다.
별도 인간 custodian이 sealed split을 운영하지 않는 경우 결과는 author-exposed evaluation split으로
표기한다.

## 3. 비교군과 공정성

다섯 시스템은 동일 case, ActionIR 입력, model budget, seed와 oracle을 사용한다.

- No defense: schema-valid trace를 차단 없이 counterfactual replay에 승인한다.
- Guard Mode emulator: 공개 문서의 network/address/token recipient allowlist와 rolling outflow를
  재현한다. STRICT 해석을 primary로, LITERAL 해석을 sensitivity로 보고한다.
- LLM verifier: 고정 model snapshot과 prompt로 user goal과 전체 trace의 정렬을 판단한다. timeout과
  malformed output은 ABSTAIN이다.
- Per-call policy: 각 top-level call의 chain, target, selector, value와 decoded effect를 독립적으로
  `executionIndex` 순서로 검사하며 accepted-effect history를 유지하지 않는다.
- IntentLock: recursive effect, cumulative ledger·reservation과 authored-oracle reconciliation을
  사용한다. 각 action을 signer 순서로 검사하고 ALLOW된 prefix의 effect를 다음 action에 누적하며, 첫
  non-ALLOW에서 중단한다. offline 결과는 실제 receipt나 fork 실행으로 표기하지 않는다.

generic LLM verifier를 Task Shield 또는 DRIFT의 재현이라고 부르지 않는다. 두 시스템은 선행연구
논의에 포함하되 paper-faithful adapter가 없는 한 primary result 표의 구현 baseline이 아니다.

## 4. 지표와 분모

주 offline 지표는 counterfactual unsafe-authorization rate다. 평가 task 전체를 분모로 하고,
guard가 승인한 authored trace의 exact-oracle outcome이 확인 계약을 위반하는 episode를 분자로 한다.
이는 실제 transaction, receipt 또는 Unsafe Execution Rate의 관찰값이 아니다. 실제 fixed-fork UER는
`EXECUTED_FORK` evidence가 있는 별도 표에서만 보고한다. pre-sign DENY·ABSTAIN은 offline 분자가
아니며 counterfactual benign completion, false denial, escalation과 confirmation burden에 반영한다.

보조 지표는 case별 unauthorized atomic amount와 allowance exposure, pre-sign detection,
first-detection ordinal, confirmation request, latency와 token cost다. ordinal `0`은 whole-plan preflight,
`1..N`은 해당 action의 signer 직전, `N+1`은 post-state reconciliation, 미탐지는 `null`이다. primary
episode의 terminal decision이 ABSTAIN이면 confirmation request 1회, ALLOW·DENY이면 0회로 세며 action
수나 reason code 수에서 가상의 확인을 만들지 않는다. timeout, malformed output, unsupported decoding,
incomplete receipt와 missing post-state는 삭제하지 않고 별도 outcome과 분모에 유지한다. 95% 신뢰구간은
base-intent group을 단위로 한 stratified bootstrap 10,000회로 계산한다.

서로 다른 chain, asset 또는 decimals의 atomic amount는 합산하지 않는다. strongest baseline과의 차이는
동일 base-intent group을 함께 resample한 paired bootstrap interval과 함께 보고한다. pre-sign detection
분모에는 `PRE_SIGN` adversarial case만 포함한다.

## 5. 주 결과

### RQ1 — 누적 위반 유형

`[조합 위반의 raw count, workflow별 비율, 대표 deterministic replay 삽입]`

실제 fork에서 관찰된 protocol rounding, interest, quote와 authored reference의 차이를 공격 탐지
성능과 섞지 않는다. 데이터 계약 결함으로 수정된 v0.2.0 진단 결과는 pilot·data-quality evidence로만
남긴다. 또한 폐기된 local v0.3.0 clean replay는 swap batch 7건에서 exact router consumption 뒤의
terminal finite allowance를 0이 아닌 승인량으로 남긴 reference 결함을 진단했다. 이 replay와 파생
artifact는 [`ADR 0010`](../docs/decisions/0010-m2-v0.4-data-contract.md)에 따라 v0.4.0 primary score,
M2 완료 또는 시스템 성능의 근거로 사용하지 않는다. v0.4.0 execution evidence는 수집됐지만
실제 사용자 승인이나 자연어와 계약의 완전한 일치를 뜻하지 않는다.

### RQ2 — Security–utility 비교

`[5개 시스템의 offline counterfactual unsafe-authorization, benign completion, false denial,
escalation, paired interval 표 삽입]`

IntentLock이 모든 baseline을 이기지 않으면 strongest-baseline 대비 우월성 주장을 삭제한다. 특정
attack class에서만 차이가 있으면 그 범위로 결론을 제한한다. Guard Mode는 production system score가
아니라 공개 정책 emulator 결과로 표기한다.

### RQ3 — Ablation

`[semantic/symbolic/hybrid stage comparison과 stateless, shallow decoder, no post-state,
confirmation-always one-factor 표 삽입]`

semantic-only, symbolic-only와 hybrid-conjunction은 runtime corpus가 이미 확정된 contract에서
시작하므로 인과 ablation으로 부르지 않는다. 한 요소를 제거했을 때 offline counterfactual
unsafe-authorization rate가 줄더라도 benign completion
또는 escalation이 크게 악화되면 개선으로 해석하지 않는다. stateful·stateless와
shallow·recursive의 차이는 같은 case subset과 decoder eligibility 분모에서 계산한다.

### RQ4 — Adaptive evaluation

`[40개 episode의 성공·safe block·normal failure와 offline 대비 차이 삽입]`

이 평가는 deterministic scripted attacker와 fake executor를 쓰는
`OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY` 실험이다. 공격자가 볼 수 있는 공개 decision·reason·tool
result, 최대 3회 replan을 기록하며, model-adaptive 공격이나 fork post-state 증거로 해석하지 않는다.
`ATTACK_SUCCESS`는 실제 signer boundary가 원 intent를 위반하는 decoded effect를 승인했고, guard monitor의
판정 함수를 재사용하지 않는 별도 structural oracle이 exact action/audit binding과
chain·target·selector·recipient·spender·account·budget·deadline 비교로 그 위반을 확인한 경우에만 부여한다.
불완전 decode는 `INCONCLUSIVE`이며 mismatch나 post-state 미관찰만으로 성공 처리하지 않는다. 숨은 oracle이나
reviewer answer를 본 transcript도 유효한 adaptive case가 아니다.

## 6. 오류 분석

오류는 최소 다음 범주로 분리한다.

- contract가 사용자 의도를 누락한 specification error
- decoder가 지원 effect를 놓친 extraction error
- policy가 완전한 effect를 잘못 허용·거부한 enforcement error
- simulation과 execution의 state drift
- protocol rounding·interest·settlement semantics
- model timeout·malformed output·reasoning mismatch
- false denial, 과도한 escalation과 정상 recovery 실패

각 범주는 대표 case ID, source run ID, oracle evidence와 재현 명령을 갖는다. 가장 유리한 사례만
선택하지 않고 false negative, false positive와 negative result를 함께 제시한다.

## 7. 한계

보장은 사용자가 확인한 contract의 충분성, 지원 decoder·simulator·event labeling의 soundness,
linearizable ledger와 signer gate 비우회에 조건부다. unknown bytecode, private MetaMask backend,
Byzantine RPC, reorg, MEV, 가격 oracle 조작, protocol insolvency와 자동 복구는 해결하지 않는다.

평가는 두 chain과 선택된 protocol·model snapshot에 한정된다. 400-case 비교는 authored trace의
offline counterfactual replay이며 실제 execution evidence가 아니다. adaptive 40건도 scripted
signer-boundary test일 뿐 model-adaptive 또는 production 공격률이 아니다. local fork와 test relayer는 production
latency, availability와 counterparty risk를 재현하지 않는다. author-exposed split은 truly unseen
generalization evidence가 아니다. 연구는 단일 저자 주도·AI 보조 검토이며, 독립 인간 라벨링과
blinded user study를 주장하지 않는다. 세부 compiler·원장·adapter 범위는 final-source §4·§8을 따른다.

## 8. MetaMask 적용 제안

최종 권고는 결과와 공개 문서 경계 안에서만 확정한다. 현재 검증할 제안 후보는 다음과 같다.

1. rolling outflow와 별도로 Permit2·approval의 owner/spender/token/amount/expiry exposure를 ledger에
   포함한다.
2. Agent Wallet의 signing boundary에 versioned intent hash와 일회성 capability를 연결한다.
3. batch와 sequential fallback 모두에서 중간 상태·partial completion invariant를 적용한다.
4. simulation expected effect와 receipt/post-state mismatch가 발생하면 동일 intent의 후속 서명을
   동결하고 구체적인 field 단위 재확인을 요청한다.
5. unsupported decoder를 정상 허용으로 처리하지 않고 사용자 escalation 및 protocol registry update로
   연결한다.

이 제안은 MetaMask production 취약점 보고가 아니다. 공개 문서 정책과 본 case-study 결과가 보이는
상보적 설계 기회로 제시한다.
