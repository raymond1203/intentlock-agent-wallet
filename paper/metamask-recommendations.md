# MetaMask Agent Wallet design recommendations

> 상태: 공개 문서와 IntentLock 연구 설계에서 도출한 **case-study design proposals**.
> MetaMask production backend를 시험하거나 내부 구현을 검토한 결과가 아니며, 취약점·bypass·누락 기능
> 보고가 아니다. 실험 결과가 필요한 판단은 `RESULT_PLACEHOLDER`로 남긴다.

## 1. 근거와 해석 경계

2026-09-04에 다음 1차 출처를 다시 열어 확인했다.

- [Architecture — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/architecture/):
  server-wallet async signing, transaction simulation, threat scanning, ERC-7821 batch와 sequential fallback
- [Trading modes — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/trading-modes/):
  Guard Mode allowlists, rolling outflow, 정책 밖 거래의 2FA approval
- [Outflow policy — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/outflow-policy/):
  signing 전 simulated outflow, confirmation 뒤 accounting, backend 밖 추적·simulation failure·signature의
  공개 limitation
- [Commands reference](https://docs.metamask.io/agent-wallet/reference/commands/)와
  [Sign messages and transactions](https://docs.metamask.io/agent-wallet/guides/sign-messages-and-transactions/):
  raw transaction, EIP-712 typed-data signing, calldata decode와 async request watch의 공개 경계
- [ERC-7821](https://eips.ethereum.org/EIPS/eip-7821): atomic batch 준비를 위한 최소 executor interface.
  2026-09-04 현재 Draft다.
- [ISignatureTransfer.sol — Uniswap Permit2](https://github.com/Uniswap/permit2/blob/main/src/interfaces/ISignatureTransfer.sol):
  token, maximum amount, nonce, deadline, spender/caller 의미

공개 문서가 설명하지 않는 production 내부 동작을 “없다”고 결론내리지 않는다. 아래 권고는 기존
simulation, scanning, allowlist와 outflow policy를 대체하는 방안이 아니라, 연구에서 시험할 수 있는
상보적 enforcement pattern이다.

## 2. 우선순위 요약

| 순위 | 제안                                                            | 적용 경계                                  | 기대 효과                                                               | 현재 증거 상태                                                         |
| ---- | --------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1    | Transaction과 signature를 함께 보는 authorization-effect ledger | `send-transaction`, `sign-typed-data` 직전 | 자산 유출 전에도 생기는 권한 노출을 명시적으로 bound                    | 공개 문서·Permit2 semantics 근거, 성능은 `RESULT_PLACEHOLDER:MM_REC_1` |
| 2    | Versioned intent digest에 묶인 one-time signing authorization   | 모든 signer path                           | 사람이 확인한 범위와 실제 payload의 결합, 재사용·widening 방지          | 설계 제안, `RESULT_PLACEHOLDER:MM_REC_2`                               |
| 3    | Async request용 reservation·idempotency ledger                  | submit → polling → receipt reconciliation  | timeout·retry·동시 요청의 중복 효과 통제                                | 공개 async 경계 근거, `RESULT_PLACEHOLDER:MM_REC_3`                    |
| 4    | Batch와 sequential fallback에 동일한 prefix invariant 적용      | quote/execute와 ERC-7821 fallback          | partial completion·중간 allowance 상태를 execution mode와 무관하게 통제 | 공개 fallback 근거, `RESULT_PLACEHOLDER:MM_REC_4`                      |
| 5    | Effect-level escalation과 post-state reconciliation             | decode/simulation → approval → receipt     | 불확실성을 field diff로 보여주고 mismatch 뒤 후속 실행을 제한           | 설계 제안, `RESULT_PLACEHOLDER:MM_REC_5`                               |

우선순위는 production impact나 발견 심각도가 아니라 IntentLock case study의 연구상 직접성과 구현
의존성 순서다. MetaMask 내부 telemetry·threat model·UX 비용을 반영하면 순서가 바뀔 수 있다.

## 3. 제안 1 — Transaction과 signature를 함께 보는 authorization-effect ledger

### 공개 관찰

공식 outflow 문서는 transaction simulation으로 account token outflow를 추정한다고 설명하는 한편,
현재 Permit2 같은 signature는 outflow 계산에 포함되지 않는다고 명시한다. 공식 command 표면에는
EIP-712 typed-data signing과 raw transaction submission이 모두 있다. Permit2 공식 interface에서
SignatureTransfer는 token·maximum amount·nonce·deadline을 서명하고 spender 의미를 caller와 결합한다.

### 설계 제안

outflow 금액과 별도로 `authorization effect`를 first-class ledger entry로 둔다. 최소 필드는 다음과 같다.

| 필드                             | 의미                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| owner, chain, verifying contract | 권한 domain과 주체                                                   |
| token, spender, recipient        | 영향을 받는 자산·권한 행사자·최종 수취 범위                          |
| maximum amount                   | 즉시 outflow와 독립적인 최대 권한 노출                               |
| nonce, deadline/expiration       | 재생과 유효 기간 bound                                               |
| signature kind                   | Permit2 SignatureTransfer, AllowanceTransfer, 기타 지원 EIP-712 유형 |
| intent/version digest            | 사용자가 확인한 계약과의 결합                                        |
| status                           | reserved, signed, consumed, expired, revoked, uncertain              |

`sign-typed-data` 전에 domain, primary type와 message를 지원 decoder로 정규화하고, spender·amount·expiry가
사용자 확인 범위보다 넓으면 구체적 field diff와 함께 ESCALATE한다. 모르는 typed data를 정상 outflow
0으로 취급하지 않고 unsupported로 분류한다.

### 검증 조건

- Permit2 amount/spender/deadline/nonce substitution에서 unsafe signature가 자동 실행되지 않는가
- 정상 exact-amount·short-expiry signature의 completion과 확인 부담은 얼마인가
- signature consumption·expiry·revocation을 ledger가 중복 또는 잔존 권한으로 잘못 계산하지 않는가
- 기존 threat scanning/2FA와 결합했을 때 중복 경고가 사용성을 과도하게 해치지 않는가

주장 가능한 결과: `RESULT_PLACEHOLDER:MM_REC_1`. 결과가 없으면 “검증할 제안”으로만 남긴다.

### 제한

공개 limitation은 signature가 rolling outflow에 포함되지 않는다는 뜻이지, MetaMask의 다른 scanner나
approval flow가 이를 검사하지 않는다는 뜻이 아니다. 따라서 이 제안을 production security fix 또는
Permit2 bypass 대응이라고 부르지 않는다.

## 4. 제안 2 — Versioned intent digest에 묶인 one-time signing authorization

### 공개 관찰

공식 command는 transaction·typed-data request에 사람이 읽는 `--intent`를 붙일 수 있고, policy 또는
threat 판단에 따라 request가 approval 상태로 대기할 수 있음을 설명한다. 공개 문서는 IntentLock이
제안하는 typed economic contract digest와 payload capability 결합을 설명하지 않지만, 이 사실만으로
production에 그런 결합이 없다고 추정하지 않는다.

### 설계 제안

사람이 확인한 versioned intent의 canonical digest와 실제 action digest를 signer authorization에 함께
묶는다. authorization은 한 번만 쓸 수 있고 최소한 다음 값에 bound한다.

- account, chain ID, target, selector와 native value
- decoded economic effects와 상한
- contract version, expiry, nonce와 idempotency key
- batch child-call commitment 또는 ordered-call commitment
- simulation block/freshness 조건과 policy version

contract narrowing은 새 버전에 자동 반영할 수 있지만 target, chain, spender, amount, deadline 또는
허용 effect를 넓히는 변경은 새 field-level confirmation을 요구한다. 사람이 읽는 summary는 보조 UX이고
canonical digest의 대체물이 아니다.

### 검증 조건

- 승인된 payload의 recipient·amount·chain·selector를 바꾸면 authorization이 무효가 되는가
- 같은 capability를 retry, 다른 chain 또는 다른 batch ordering에 재사용할 수 없는가
- benign re-quote·gas adjustment처럼 사전 정의한 non-semantic change를 과도하게 막지 않는가
- policy·contract version 변경 중 pending request를 일관되게 취소 또는 재확인하는가

주장 가능한 결과: `RESULT_PLACEHOLDER:MM_REC_2`.

### 제한

이 패턴은 contract가 사용자 의도를 충분히 표현한다는 전제에 의존한다. 빠진 final asset, spender 또는
recovery preference를 digest로 고정해도 specification error는 해결되지 않는다.

## 5. 제안 3 — Async request용 reservation·idempotency ledger

### 공개 관찰

server-wallet 공개 흐름은 long-running request에 polling ID를 반환하고 `requests watch`로 상태를
조회한다. swap command 문서는 timeout 뒤 작업이 계속 완료될 수 있으므로 recovery hint를 따르고 execute를
다시 실행하지 말라고 경고한다. outflow는 confirmation 뒤 rolling total에 반영된다.

### 설계 제안

signing request를 제출하기 전에 intent budget과 execution count를 원자적으로 `reserved` 상태로
전환한다. polling·receipt 결과에 따라 다음 transition만 허용한다.

| 입력 상태 | 관찰                                     | 다음 상태                                     |
| --------- | ---------------------------------------- | --------------------------------------------- |
| reserved  | confirmed receipt·effect match           | committed                                     |
| reserved  | definite rejection/failure before effect | released                                      |
| reserved  | timeout 또는 ambiguous transport result  | uncertain; 같은 idempotency key의 재실행 금지 |
| uncertain | receipt/history에서 confirmation 발견    | committed                                     |
| uncertain | bounded reconciliation 뒤 미실행 증명    | released 또는 사용자 escalation               |

동일 intent의 병렬 worker가 같은 remaining budget을 각각 사용하지 못하도록 reservation transition에는
하나의 linearization point가 필요하다. polling ID, action digest, idempotency key와 onchain receipt를
같은 record로 연결한다.

### 검증 조건

- timeout 후 duplicate retry, 두 worker의 concurrent submission과 delayed receipt에서 누적 한도를
  넘기지 않는가
- definite failure의 reservation이 영구적으로 묶여 정상 과업을 막지 않는가
- `uncertain` 상태의 평균 지속 시간과 추가 확인 부담은 얼마인가
- backend request history와 onchain receipt가 불일치할 때 fail-safe transition이 결정적인가

주장 가능한 결과: `RESULT_PLACEHOLDER:MM_REC_3`.

### 제한

공개 CLI의 retry warning은 운영상 위험 표면을 보여주지만, production backend가 idempotency나 reservation을
갖지 않는다는 증거가 아니다. 제안은 공개 async boundary와 연구 위협 모델을 잇는 architecture pattern이다.

## 6. 제안 4 — Batch와 sequential fallback에 동일한 prefix invariant 적용

### 공개 관찰

공식 architecture와 command 문서는 eligible approval+trade를 ERC-7821 atomic `execute()`로 묶고,
batching이 불가능하면 sequential submission으로 되돌린다고 설명한다. ERC-7821 자체는 atomic batch
preparation interface이며 현재 Draft다.

### 설계 제안

economic intent는 execution mode와 독립적으로 한 번 정의하고, 다음 세 구간에 같은 계약을 적용한다.

1. **Batch pre-sign:** 모든 child call을 재귀 decode하고 child 순서·합산 effect·unknown call을 검사한다.
2. **Sequential prefix:** approval만 성공하고 trade가 실패하는 등 각 중간 상태가 허용된 recovery
   envelope 안에 있는지 검사한다.
3. **Completion:** final asset, recipient, minimum received, residual allowance와 total fee가 계약을
   만족하는지 receipt/post-state로 확인한다.

sequential fallback으로 mode가 바뀌면 원래 atomic assumption을 그대로 유지하지 않는다. 사용자가
허용한 partial order와 recoverable intermediate state가 없으면 새 확인을 요구한다.

### 검증 조건

- hidden child transfer·unlimited approval·wrong recipient가 batch 내부에서도 보이는가
- approval 성공 후 swap 실패 시 residual allowance가 명시된 recovery envelope를 넘지 않는가
- batch와 sequential의 정상 completion 차이·latency·confirmation burden은 얼마인가
- mode 전환이 기존 intent budget을 새로 초기화하지 않는가

주장 가능한 결과: `RESULT_PLACEHOLDER:MM_REC_4`.

### 제한

이 제안은 MetaMask의 현재 batch decoder나 fallback policy가 불완전하다는 주장이 아니다. 본 연구의
emulator·fixed-fork 범위에서 execution-mode-independent contract가 제공할 수 있는 추가 검증을 묻는다.

## 7. 제안 5 — Effect-level escalation과 post-state reconciliation

### 공개 관찰

공식 architecture는 실행 전 simulation과 threat scanning을 설명하고, signing guide는 모르는 calldata를
decode한 뒤 확인하라고 안내한다. 공식 outflow 문서는 simulation 불가 시 allowlist에 의존하라고
설명한다. 이들은 불확실성·승인 경계의 공개 근거지만 내부 decision procedure를 공개하지는 않는다.

### 설계 제안

approval UI/API가 단일 위험 점수 대신 다음 effect diff를 machine-readable하게 제공하도록 검토한다.

- requested vs decoded chain, asset, recipient, target와 selector
- requested vs simulated gross outflow, minimum received, allowance와 debt delta
- accepted prefix와 candidate를 합친 remaining budget
- unsupported selector/signature/proxy와 decoder provenance
- simulation fingerprint, freshness와 predicted/actual mismatch

결정은 `ALLOW`, `DENY`, `ESCALATE`를 구분한다. ESCALATE는 전체 payload를 다시 읽게 하기보다 바뀌는
critical field와 위험 증가분을 보여준다. 실행 뒤 actual effect가 predicted bound를 벗어나면 이미 발생한
거래를 되돌린다고 주장하지 않고, 같은 intent의 후속 signing을 동결한 뒤 recovery 선택지를 요청한다.

### 검증 조건

- field-level diff가 정상 사용자의 수정 횟수와 확인 시간을 줄이는가
- unknown·partial decode가 ALLOW로 잘못 축약되지 않는가
- post-state mismatch 뒤 동일 intent의 follow-up이 실제로 정지되는가
- stale-state false alarm과 반복 escalation이 정상 completion을 얼마나 낮추는가

주장 가능한 결과: `RESULT_PLACEHOLDER:MM_REC_5`.

### 제한

post-state reconciliation은 이미 확정된 자산 이동을 복구하지 못한다. 또한 공개 문서만으로 MetaMask의
현재 approval UI, scanner label, simulator coverage를 완전하게 알 수 없으므로 구체적 UX·API 선택은
내부 telemetry와 threat model 검증이 필요하다.

## 8. 결과에 따른 권고 강도 결정표

| IntentLock case-study 결과                                                                                             | 최종 원고에서 허용되는 권고 강도                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| offline counterfactual unsafe-authorization 개선과 benign utility 유지, 해당 failure class의 deterministic replay 있음 | “production 검토 가치가 있는 설계 패턴”으로 제안; 실제 UER·취약점·동등성 주장은 금지 |
| 특정 attack class에서만 개선                                                                                           | 해당 class와 supported decoder 범위로 제안 축소                                      |
| offline rate 차이 없음, escalation/false denial 증가                                                                   | negative result를 공개하고 연구 prototype의 utility trade-off로 설명                 |
| authored fixture에서만 차이, executed evidence 없음                                                                    | “가설 및 검증 계획”으로만 유지                                                       |
| Guard Mode emulator 해석에 민감                                                                                        | STRICT/LITERAL 양쪽 결과를 제시하고 MetaMask 동작 추론을 중단                        |

현재 판정은 `RESULT_PLACEHOLDER:RECOMMENDATION_STRENGTH`다.

## 9. 명시적으로 하지 않는 주장

- MetaMask Agent Wallet 또는 Guard Mode에 production 취약점이 있다.
- 공개 outflow limitation이 실제 exploitation 가능성을 입증한다.
- IntentLock emulator가 MetaMask service와 기능·정책·성능 면에서 동등하다.
- threat scanning, 2FA, Transaction Protection 또는 비공개 backend 방어를 IntentLock이 대체한다.
- 두 fixed fork 결과가 모든 chain, protocol, signature와 계정 상태에 일반화된다.
- post-state mismatch detection이 이미 확정된 거래를 되돌린다.
- 위 다섯 제안이 production UX·latency·비용을 개선한다고 이미 검증됐다.

## 10. Human review gate

아래 검수는 자동으로 완료 처리하지 않는다.

- Reviewer: `PENDING HUMAN`
- 공식 문서를 직접 다시 열었는가: `PENDING`
- 각 문장의 public fact / research inference / proposal 구분이 명확한가: `PENDING`
- production-equivalence 또는 vulnerability로 오해할 문장이 있는가: `PENDING`
- 가장 반대하는 권고와 이유: `PENDING`
- MetaMask 내부 검증 없이는 삭제해야 할 구체적 구현 추정: `PENDING`
- 저자 adjudication과 원고 diff: `PENDING`

주저자의 self-review는 품질 점검으로 남길 수 있지만 independent human gate를 대신하지 않는다.
