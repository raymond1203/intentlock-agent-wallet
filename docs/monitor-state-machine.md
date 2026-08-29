# Deterministic monitor state machine

Monitor 입력은 immutable Intent Contract, accepted prefix effects, candidate effects, decoder 상태,
simulation 상태, 평가 시각, 선택적 final-goal checks다. 동일한 직렬화 입력은 동일한 decision과
intent hash를 만든다.

```text
CANDIDATE
  -> expired                         DENY
  -> simulation failed/unavailable  ESCALATE
  -> partial/unknown decode         ESCALATE
  -> permission/economic violation  DENY
  -> missing quote/post-state       ESCALATE
  -> all checks pass                ALLOW -> ledger reserve -> signer
```

`DENY`는 알려진 증거로 계약 위반이 확정된 경우다. `ESCALATE`는 필요한 증거가 없거나 해석이
불완전해 자동 판단할 수 없는 경우다. 두 상태 모두 signer 앞에서는 동일하게 차단된다.

검사 순서는 만료, simulation, decode completeness, unknown effect, chain/target/selector,
recipient·approval·slippage·deadline·debt 규칙, 누적 budget, final goal이다. 각 차단 결정에는
reason code, violated invariant, expected/actual/source evidence가 들어가며 intent hash와 연결된다.

## 보장 경계

Monitor의 보장은 Intent Contract가 사용자의 의도를 올바르게 포착하고, decoder와 simulator가 실제
효과를 빠짐없이 표현하며, ledger가 동일 계정의 경쟁 실행을 직렬화한다는 조건에 의존한다. Unknown
selector, codehash drift, trace omission, simulation failure는 이 조건이 깨졌다는 신호이므로 ALLOW로
대체하지 않는다.

전이 테스트는 `test/monitor.test.ts`에 있으며 정상·DENY·ESCALATE·결정성 포함 25개 이상을
고정 입력으로 검증한다.
