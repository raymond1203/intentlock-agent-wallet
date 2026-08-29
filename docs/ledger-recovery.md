# Ledger reservation and recovery

원장은 `(account, nonce)`, `idempotencyKey`, `intentHash`, `decisionLogId`와 누적 gross outflow,
allowance exposure, gas를 원자적으로 예약한다. 같은 잔여 예산을 보는 두 요청은 하나의 gate에서
직렬화되므로 둘 다 같은 금액을 소비할 수 없다.

## 상태

| 상태       | 경제 효과 반영 | 복구 규칙                         |
| ---------- | -------------- | --------------------------------- |
| `PENDING`  | 예약량 전체    | receipt 확인 전 재서명 금지       |
| `EXECUTED` | 관찰된 실제량  | immutable 완료                    |
| `VIOLATED` | 관찰된 실제량  | 예측 불일치 경보와 함께 보존      |
| `FAILED`   | 실제 gas만     | revert된 자산·allowance 예약 해제 |
| `CANCELED` | 0              | signer 전에만 취소                |

동일 idempotency key의 재호출은 기존 reservation을 반환하며 MetaMask adapter는 두 번째 signer
호출을 차단한다. 같은 account nonce가 다른 intent hash에 쓰이면 `NONCE_CONFLICT`다.

`snapshot()`은 version, revision, 모든 reservation을 반환한다. 프로세스 재시작 시 이 JSON을
내구 저장소에서 읽어 constructor에 전달한다. v0는 단일 프로세스 연구 harness이므로 snapshot
쓰기 자체의 트랜잭션성과 다중 기기 합의는 보장하지 않는다. 실제 지갑 통합에서는 reservation과
audit log를 같은 durable transaction에 기록해야 한다.

Receipt effect가 예약보다 커지면 정상 정산은 실패한다. Adapter는 이를 성공처럼 지우지 않고
`VIOLATED`로 기록하여 이후 누적 계산에도 포함한다. 경쟁·재시도·실패·snapshot 복구는
`test/monitor/concurrency.test.ts`에서 재현한다.
