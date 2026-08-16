# Claim-to-evidence 초안

이 표는 논문의 주장과 이를 허용하는 증거를 연결한다. `Required evidence`가 채워지지 않은 주장은 결과 원고에 넣지 않는다.

| ID  | 허용할 주장                                                       | Required evidence                                                     | RQ/지표                           | 실패·완화 기준                                                |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| C1  | 개별 허용 호출의 조합이 누적 경제 의도를 위반하는 사례가 존재한다 | 최소 3개 workflow에서 deterministic replay와 exact post-state diff    | RQ1; 조합 위반 발생률             | 사례가 synthetic fixture에만 있으면 범위를 synthetic으로 제한 |
| C2  | IntentLock이 unsafe execution을 줄인다                            | 동일 task/attack/model split에서 baseline 대비 UER와 신뢰구간         | RQ2; UER                          | 유의하거나 실질적인 개선이 없으면 우월성 주장 삭제            |
| C3  | 보안 개선이 정상 과업을 과도하게 훼손하지 않는다                  | benign completion, false deny, escalation, confirmation burden        | RQ2; security–utility Pareto      | 허용 범위는 pilot 후 사전 등록하고 결과 뒤 변경 금지          |
| C4  | 누적 statefulness가 호출 단위 검사보다 추가 효과가 있다           | stateless vs stateful matched ablation                                | RQ3; ΔUER, Δcompletion            | 차이가 없으면 특정 attack class에서만 효과로 축소             |
| C5  | recursive decoding이 hidden composition을 탐지한다                | shallow vs recursive decoder, nested batch/proxy fixture              | RQ3; pre-sign detection, coverage | unsupported protocol은 fail-closed 범위와 함께 보고           |
| C6  | hybrid monitor가 LLM-only 또는 symbolic-only보다 균형이 좋다      | semantic-only, symbolic-only, hybrid의 동일 조건 비교                 | RQ3; Pareto frontier              | 모델별 결과가 다르면 평균만 쓰지 않고 층화 보고               |
| C7  | 일부 unseen 모델·protocol·chain에도 일반화한다                    | 사전 지정 unseen split과 adaptive attack                              | RQ4; UER, completion              | 평가하지 않은 생태계 전체로 일반화하지 않음                   |
| C8  | 조건부 prefix-safety를 제공한다                                   | 명세, monitor transition, invariant별 proof sketch, negative tests    | Security analysis                 | contract·decoder·simulator soundness 조건을 문장마다 유지     |
| C9  | MetaMask 공개 Guard Mode와 상보적인 gap이 있다                    | 공식 문서의 outflow/allowlist/Permit2·backend limitation과 case study | RQ1/RQ2; Guard emulator           | production 동등성·실제 bypass 주장은 하지 않음                |

## 공통 증거 규칙

- 주 지표 판정은 LLM judge가 아니라 forked EVM의 exact state oracle을 사용한다.
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
