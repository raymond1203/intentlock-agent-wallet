# Intent Contract v0

Intent Contract `0.1`은 자연어 요청을 서명 전에 검사할 수 있는 최소 권한 상한으로 고정한다.
런타임 기준은 `src/domain/intent-contract.ts`, 배포 가능한 표현은
`benchmark/schemas/intent-contract.schema.json`이다. 두 표현의 불일치는 `pnpm run schema:check`가
실패시킨다.

## 필드와 단위

| 필드                      | 의미                       | 단위/규칙                         | 대표 위반                     |
| ------------------------- | -------------------------- | --------------------------------- | ----------------------------- |
| `account`                 | 보호할 지갑                | 20-byte EVM 주소                  | 다른 owner의 계약으로 치환    |
| `nonce`                   | 의도 세대                  | canonical unsigned integer string | 다른 의도와 동일 nonce 충돌   |
| `idempotencyKey`          | 재시도 식별자              | 1~128자                           | 같은 키로 다른 의도 실행      |
| `chainScopes[].chainId`   | 허용 체인                  | 양의 정수                         | `CHAIN_OUT_OF_SCOPE`          |
| `allowedTargets[].target` | 호출 가능 계약             | EVM 주소                          | `TARGET_NOT_ALLOWED`          |
| `selectors[]`             | 계약별 허용 함수           | 4-byte selector                   | `SELECTOR_NOT_ALLOWED`        |
| `allowedRecipients[]`     | 최종 수취 가능 주소        | EVM 주소                          | `RECIPIENT_NOT_ALLOWED`       |
| `maxGrossOutflow`         | 누적 총유출 상한           | 자산 최소 단위의 정수 문자열      | `GROSS_OUTFLOW_EXCEEDED`      |
| `maxAllowanceExposure`    | 승인 위험 상한             | 자산 최소 단위의 정수 문자열      | `ALLOWANCE_EXPOSURE_EXCEEDED` |
| `maxGasWei`               | 누적 gas 상한              | wei 정수 문자열                   | `GAS_BUDGET_EXCEEDED`         |
| `maxSlippageBps`          | 최대 slippage              | 0~10,000 bps                      | `SLIPPAGE_EXCEEDED`           |
| `expiresAt`               | 의도 만료                  | timezone 포함 ISO-8601            | `INTENT_EXPIRED`              |
| `finalStateGoals`         | 실행 후 반드시 성립할 상태 | goal별 정수 문자열                | `FINAL_GOAL_UNSATISFIED`      |

모든 금액은 JSON에서 부동소수점을 사용하지 않는다. `"0"` 또는 0이 아닌 숫자로 시작하는 정수
문자열만 허용하며 `01`, 음수, 지수 표기, 소수는 거부한다. 모든 object schema는 strict이므로 알 수
없는 필드도 거부한다.

## Safety invariant와 final-state goal

Safety invariant는 각 candidate를 서명 전에 검사하는 상한이다. 예를 들어 1 USDC씩 두 번 보내는
경우 각 호출이 아니라 accepted prefix와 pending reservation을 합친 2 USDC를 검사한다.

Final-state goal은 receipt 이후 확인할 결과다. v0는 최소 잔액, 최대 부채, NFT owner, 잔여 allowance
0을 표현한다. post-state 증거가 없으면 성공으로 추정하지 않고 `FINAL_STATE_UNAVAILABLE`로
ESCALATE한다.

## 예시

사용자가 “Ethereum에서 이 수취인에게 USDC 2개까지만 전송”이라고 지정했다면 USDC budget의
`maxGrossOutflow`는 `"2000000"`, 수취인은 `allowedRecipients`, USDC `transfer` selector는 해당
target permission에 들어간다. 2.1 USDC, 다른 수취인, 다른 chain, `transferFrom`으로의 변경은 서로
다른 불변식 위반으로 기록된다.

재생성:

```bash
pnpm run schema:generate
pnpm run schema:check
pnpm exec vitest run test/intent-contract.test.ts
```
