# Claim-to-evidence 초안

이 표는 논문의 주장과 이를 허용하는 증거를 연결한다. `Required evidence`가 채워지지 않은 주장은 결과 원고에 넣지 않는다.

| ID  | 허용할 주장                                                            | Required evidence                                                  | RQ/지표                           | 실패·완화 기준                                                |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------- |
| C1  | 개별 허용 호출의 조합이 누적 경제 의도를 위반하는 사례가 존재한다      | 최소 3개 workflow에서 deterministic replay와 exact post-state diff | RQ1; 조합 위반 발생률             | 사례가 synthetic fixture에만 있으면 범위를 synthetic으로 제한 |
| C2  | IntentLock이 offline counterfactual unsafe-authorization rate를 줄인다 | 동일 case manifest의 baseline 대비 offline rate와 신뢰구간         | RQ2; offline unsafe authorization | 개선이 없으면 우월성 주장을 삭제하고 음의 결과를 공개한다     |
| C3  | 보안 개선이 정상 과업을 과도하게 훼손하지 않는다                       | benign completion, false deny, escalation, confirmation burden     | RQ2; security–utility Pareto      | 허용 범위는 pilot 후 사전 등록하고 결과 뒤 변경 금지          |
| C4  | 누적 statefulness가 호출 단위 검사보다 추가 효과가 있다                | stateless vs stateful matched one-factor ablation                  | RQ3; Δoffline rate, Δcompletion   | 차이가 없으면 특정 attack class에서만 효과로 축소             |
| C5  | recursive decoding이 hidden composition을 탐지한다                     | shallow vs recursive decoder, nested batch/proxy fixture           | RQ3; pre-sign detection, coverage | unsupported protocol은 fail-closed 범위와 함께 보고           |
| C6  | semantic-only, symbolic-only와 hybrid stage의 기술 통계가 다르다       | 동일 frozen corpus의 non-causal stage comparison                   | RQ3; descriptive Pareto view      | component causal effect로 해석하지 않고 층화 결과를 함께 보고 |
| C7  | scripted adaptive signer-boundary 40건의 결과를 기술한다               | 사전 지정 deterministic episode·selection manifest·fake executor   | RQ4; outcome counts               | model-adaptive·unseen·fork-executed 일반화 주장을 하지 않음   |
| C8  | 조건부 prefix-safety를 제공한다                                        | 명세, monitor transition, invariant별 proof sketch, negative tests | Security analysis                 | contract·decoder·simulator soundness 조건을 문장마다 유지     |
| C9  | MetaMask 공개 문서 emulator와 누적 계약의 기술 결과가 다르다           | 공식 문서의 outflow/allowlist/Permit2 경계와 scoped emulator 결과  | RQ1/RQ2; Guard emulator           | production 동등성·gap·실제 bypass 주장은 하지 않음            |

## 공통 증거 규칙

- M2 fixed-fork 사실 판정은 receipt와 exact post-state oracle을 사용한다. M3 400-case 주 비교는
  `OFFLINE_COUNTERFACTUAL_REPLAY`와 authored oracle이며 실제 transaction UER로 부르지 않는다.
- 모든 표에 task 수, seed, model/version, chain block, contract code hash를 기록한다.
- effect size와 불확실성을 함께 보고하고 p-value만으로 결론내리지 않는다.
- failed run과 unsupported decode를 분모에서 임의로 제거하지 않고 별도 범주로 공개한다.
- 결과를 본 뒤 attack class, metric 또는 threshold를 바꾸면 exploratory analysis로 표시한다.

## 금지 주장 검사

- [ ] `first multi-step/trajectory guardrail`을 쓰지 않았다.
- [ ] `first runtime/formal policy`를 쓰지 않았다.
- [ ] 기존 benchmark를 `single-step only`로 일반화하지 않았다.
- [ ] `proves user intent` 대신 조건부 invariant guarantee를 썼다.
- [ ] `MetaMask production Guard Mode reproduction`이라고 쓰지 않았다.
- [ ] 평가하지 않은 chain·protocol·model로 결과를 확장하지 않았다.
