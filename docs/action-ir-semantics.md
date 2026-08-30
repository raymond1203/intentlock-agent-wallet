# ActionIR v0 semantics

ActionIR은 도구 이름이나 calldata 형태가 아니라 경제 효과를 기준으로 호출을 정규화한다. 각 effect는
`PREDICTED` 또는 `OBSERVED` phase와 call path, target, selector, codehash, 관찰 출처를 가진다.

## Effect 의미

| Effect      | 누적 계산                                                                    | 주 관찰 근거                                           |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `TRANSFER`  | 보호 계정에서 나가면 gross outflow와 음의 net delta, 들어오면 양의 net delta | calldata, ERC-20 `Transfer` log                        |
| `APPROVAL`  | outflow와 별개로 allowance exposure를 기록                                   | approve/Permit2 typed data, `Approval` log, post-state |
| `SWAP`      | asset in/out, amount in, quote, min-out, recipient, deadline                 | router calldata와 simulation quote                     |
| `BRIDGE`    | source chain gross outflow와 destination recipient                           | bridge calldata와 양쪽 chain post-state                |
| `DEBT`      | signed debt delta                                                            | lending calldata와 debt-token post-state               |
| `OWNERSHIP` | token owner 이동                                                             | calldata와 receipt/post-state                          |
| `GAS`       | 보호 계정이 부담할 최대 wei                                                  | simulation 또는 receipt                                |
| `UNKNOWN`   | 자동 허용하지 않음                                                           | ABI·selector·trace가 불완전한 모든 경우                |

Gross outflow는 중간에 자산이 되돌아와도 줄지 않는 손실 상한이고, net delta는 결과 잔액 변화다.
따라서 transfer-out 후 refund는 net 0일 수 있지만 gross는 양수다. Approval도 실제 transfer와 합치지
않고 별도 위험 상한으로 유지한다.

## MVP workflow 표현

| Workflow                      | ActionIR 조합                                                   |
| ----------------------------- | --------------------------------------------------------------- |
| W1 ERC-20 transfer            | `TRANSFER` (+ `GAS`)                                            |
| W2 approve/Permit2 후 swap    | `APPROVAL` + input `TRANSFER` + `SWAP` (+ revoke `APPROVAL(0)`) |
| W3 bridge 후 destination swap | `BRIDGE` + destination `TRANSFER` + `SWAP`                      |
| W4 supply 후 borrow           | collateral `TRANSFER` + `DEBT` + 결과 잔액 goal                 |

`CallFrame`은 재귀 호출의 부모/자식 관계를 보존한다. decode depth·call 수·calldata 크기 제한을
넘거나 pinned codehash가 다르면 해당 frame은 `UNKNOWN`, 상위 frame은 `PARTIAL`이 된다.

## 예측과 관찰 대조

서명 전 effect와 receipt effect는 ID, phase, provenance를 제외한 경제 필드의 multiset으로 비교한다.
차이는 audit log의 `RECEIPT_EFFECT_MISMATCH`와 ledger의 `VIOLATED` 상태로 남는다. 이 비교는
decoder와 simulator 정확성에 조건부이며, 임의 bytecode의 완전한 의미 분석을 주장하지 않는다.
