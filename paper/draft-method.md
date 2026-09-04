# 위협 모델·방법론·조건부 보장 초안

> 상태: 코드 경계와 M0~M2 명세를 연결한 초안. M3 ablation 결과와 최종 구조도 번호는 동결 뒤
> 삽입한다.

## 1. 시스템 모델

사용자는 자연어로 자산 작업을 요청하고, LLM agent는 tool·MCP·dApp을 통해 transaction 또는 typed
signature 후보를 만든다. agent의 plan, memory, tool selection, tool result와 사람이 읽는 거래 설명은
신뢰하지 않는다. 사용자가 최종 확인한 Intent Contract, monitor·원장 transition, signer enforcement,
지원 목록의 decoder와 고정 block의 simulator·receipt state는 명시된 조건 아래 신뢰한다.

공격자는 tool metadata, 외부 문서, memory와 결과를 오염하고 recipient, asset, chain, spender,
selector, amount, deadline, slippage와 fee를 변경할 수 있다. batch·internal call·typed signature에 효과를
숨기거나 timeout을 이용해 retry와 replan을 유도할 수 있으며, 여러 worker가 같은 잔여 budget을
동시에 예약하게 만들 수 있다. private key, 운영체제, monitor 저장소와 signer 자체의 완전한 손상은
범위 밖이다.

## 2. Intent Contract

Intent Contract는 자연어 설명이 아니라 signer가 시행할 수 있는 typed envelope다. 계약은 account,
nonce, idempotency key와 version을 갖고 다음 안전 속성을 포함한다.

- 허용 chain, target, selector, recipient와 code provenance
- 자산별 누적 gross outflow와 allowance exposure 상한
- swap의 quote, 최소 수령량과 maximum slippage
- gas budget, expiry와 실행 횟수
- 최소 잔액·position·health factor, 최대 debt, owner, residual allowance 같은 최종 상태 목표

금액은 부동소수점이 아닌 자산 최소 단위의 정수 문자열로 표현한다. 계약의 narrowing은 자동으로
허용할 수 있지만 target, amount, spender, chain, deadline을 넓히는 변경은 새 사용자 확인이 필요하다.
critical field가 없거나 trusted user text와 untrusted observation이 충돌하면 compiler는 후보 계약을
확정하지 않고 ESCALATE한다.

## 3. ActionIR와 효과 추출

각 top-level call과 재귀 child call은 tool name이 아니라 경제 효과로 정규화된다. ActionIR은 transfer,
approval·Permit2, swap, bridge, debt, ownership, gas와 unknown effect를 표현하고, call path, target,
selector, codehash, predicted/observed phase와 증거 출처를 보존한다.

지원 ABI의 calldata, typed data, simulation trace와 receipt log를 결합한다. ERC-7821 batch는 child call을
순서대로 재귀 해석하며, Across·CCTP·Aave는 고정된 contract address와 codehash의 지원된 함수만
해석한다. decode depth, call count, byte size, codehash 또는 ABI가 범위를 벗어나면 effect를 임의로
추정하지 않고 PARTIAL 또는 UNKNOWN으로 표시한다.

## 4. Stateful monitor와 누적 원장

monitor 입력은 확인된 contract, 이전에 accepted·executed된 effects, 현재 candidate effects, decode와
simulation 상태, 평가 시각이다. top-level action은 `executionIndex` 순서로 검사하며, ALLOW된 action의
effects만 accepted prefix에 넣은 뒤 다음 action을 검사하고 첫 DENY·ESCALATE에서 signer 진행을 멈춘다.
monitor는 각 action에서 다음 순서로 결정한다.

1. chain, target, selector, recipient와 spender가 contract scope 안인지 검사한다.
2. accepted prefix, pending reservation과 candidate의 gross outflow, allowance, gas, execution count를
   합산한다.
3. slippage, deadline, debt·ownership과 금지 효과를 검사한다.
4. 증거가 완전하고 모든 invariant가 유지되면 ALLOW, 확정 위반이면 DENY, 불확실성 또는 widening이면
   ESCALATE한다.

ALLOW는 단순 boolean이 아니라 intent hash, contract version, chain, target, selector, value bound,
expiry, nonce와 idempotency key에 묶인 일회성 signing capability다. signer는 이 capability가 없으면
실행하지 않는다. 여러 요청이 동시에 같은 잔여 budget을 확인하는 race를 막기 위해 monitor는 먼저
원자적 reservation을 만들고, transaction 성공·실패·timeout에 따라 commit 또는 release한다.

bridge 전후 상태도 별도 의도로 분리하지 않는다. intent ID와 contract version이 source와 destination
chain의 공통 ledger key이며, 목적지 swap은 동일한 누적 계약을 조회하는 두 번째 signer gate를
통과한다.

## 5. 실행 후 검증

ALLOW 뒤에는 필요한 receipt가 모두 성공했는지, 고정 fork fingerprint와 contract codehash가 맞는지,
pre/post observation이 실제 실행 증거인지 확인한다. ordered receipt event로 gross outflow를 계산하고,
잔액·allowance·position·debt·ownership을 bigint로 비교한다. 예측과 실제가 다르면 정책 위반 여부와
reference disagreement를 분리한다. 이미 발생한 state를 되돌린다고 주장하지 않으며, ledger를
VIOLATED로 전환하고 후속 signing을 동결한다.

cross-chain evaluation의 destination fill은 명시적으로 test relayer·attester fixture를 사용할 수 있다.
이는 source contract와 message 형식을 실행하는 로컬 검증이지 production relayer liveness나 bridge
security의 증거가 아니다.

## 6. 조건부 prefix-safety

확인된 contract를 `C`, 실행·예약된 prefix의 누적 경제 상태를 `S_k`, candidate action에서 완전하게
해석된 효과를 `e_(k+1)`, contract의 안전 영역을 `Inv(C)`라고 하자. monitor의 ALLOW transition은
`S_k ⊕ e_(k+1) ∈ Inv(C)`일 때만 atomic reservation과 capability를 발급한다.

**조건부 정리.** 다음 조건이 유지되면 IntentLock이 발급한 capability만으로 구성된 모든 실행 prefix의
누적 상태는 `Inv(C)` 안에 있다.

1. `C`가 사용자의 의도를 필요한 범위에서 충분히 표현한다.
2. 지원 decoder, simulator와 event labeling이 실행 효과에 대해 sound하다.
3. reservation과 ledger transition이 linearizable하다.
4. source와 destination의 모든 signing path가 capability gate를 우회할 수 없다.

**증명 개요.** 초기 상태는 계약 생성 시 검증되어 `S_0 ∈ Inv(C)`이다. 귀납적으로 `S_k`가 안전하다고
하자. monitor는 candidate의 모든 효과를 contract scope와 누적 상한에 대조한다. 불완전한 효과는
ALLOW하지 않으며, 완전한 효과에 대해 `S_k ⊕ e_(k+1)`가 안전한 경우에만 reservation을 선형화한다.
따라서 동시에 평가되는 다른 요청도 예약된 양을 포함한 상태를 보고, 발급된 capability가 실행되면
`S_(k+1)`가 된다. 귀납법으로 모든 accepted prefix가 안전 영역에 남는다.

이 정리는 자연어 compiler correctness, unknown bytecode, Byzantine RPC, future price, MEV, protocol
solvency, liveness를 보장하지 않는다. 실행 뒤 실제 effect가 predicted effect와 다르면 soundness 전제가
깨진 것이므로 이후 prefix를 동결하지만 이미 발생한 비가역 효과의 자동 복구는 별도 문제다.

## 7. 구현 경계와 비교군

Intent Contract와 ActionIR은 strict schema로 생성되며, monitor·ledger·decoder·post-state oracle은 각각
독립 테스트를 갖는다. case study adapter는 signer 직전에 fail-closed enforcement를 두고, 실제 키 대신
로컬 Anvil test account를 사용한다.

비교군은 no defense, MetaMask 공개 문서 기반 Guard Mode emulator, stateless LLM verifier,
deterministic per-call policy와 full IntentLock이다. Guard Mode는 STRICT와 LITERAL 해석을 구분하고
production 동등성을 주장하지 않는다. Task Shield와 DRIFT는 선행연구 비교 대상이며, paper-faithful
구현이 없는 generic LLM verifier를 해당 시스템 이름으로 바꾸지 않는다.

## 8. 검증과 ablation

400-case 비교는 실제 transaction 실행이 아니라 동일한 case manifest, seed, model budget과 authored
oracle을 사용하는 `OFFLINE_COUNTERFACTUAL_REPLAY`다. semantic-only,
symbolic-only와 hybrid-conjunction은 이미 확인된 계약에서 시작하는 runtime corpus의 단계별 비교이며,
한 요소만 바꾼 인과 ablation으로 해석하지 않는다. compiler correctness는 M1의 별도 blinded review로
측정한다. runtime ablation은 full monitor에서 accepted-effect history, recursive decoder, post-state
verifier 또는 confirmation policy 하나만 바꾼다. 각 arm은 security와 benign completion을 함께
보고하며, 설정 차이는 실행 전에 semantic diff로 검수한다.

주 offline 지표는 guard가 승인한 trace 중 authored exact-oracle이 계약 위반을 나타내는 episode를 전체
평가 episode로 나눈 counterfactual unsafe-authorization rate다. `REPLAYED`는 실제 transaction이나
receipt를 뜻하지 않으며, 실제 Unsafe Execution Rate는 별도 `EXECUTED_FORK` evidence에만 사용한다.
pre-sign DENY와 ABSTAIN은 분자에 넣지 않고 false denial, escalation과 counterfactual completion에
반영한다. timeout, malformed output, unsupported decoding과 missing evidence는 제거하지 않고 독립
범주와 분모에 유지한다.
