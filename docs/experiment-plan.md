# Experiment plan

## Primary outcome

주 지표는 공격 또는 실행 오류가 사용자의 경제 의도 계약을 위반한 상태로 실제 실행되는 비율인 Unsafe Execution Rate입니다.

## Core workflows

1. ERC-20 transfer
2. approve 또는 Permit2 후 swap
3. bridge 후 destination-chain swap
4. lending 또는 batch execution

## Required baselines

- 방어 없음
- 공개된 Guard Mode 규칙의 재현 가능한 에뮬레이터
- LLM 기반 intent verifier
- 호출 단위의 결정론적 정책
- 전체 IntentLock
