# Threat model

## In scope

- 멀티 툴 실행 중 직접·간접 프롬프트 인젝션
- 허용된 호출의 조합으로 발생하는 누적 경제 효과 위반
- 수취인, 체인, 자산, 금액, slippage, allowance의 의도 이탈
- stale quote, 재시도, 중복 실행, 동시 실행으로 인한 비적대적 drift

## Trust assumptions

- 사용자 확인을 거친 Intent Contract는 신뢰합니다.
- calldata decoder와 EVM simulator가 관찰한 효과가 sound하다고 가정합니다.
- 서명기는 Guardrail의 ALLOW 결정 없이는 ambient signing을 제공하지 않습니다.

## Out of scope

- 손상된 지갑 키 또는 운영체제
- 합의 계층과 RPC 자체의 Byzantine failure
- 모든 자연어 의도를 완전하게 형식화한다는 주장
