# Contributing

## Workflow

1. Issue에 Outcome, Scope, Deliverables, Acceptance criteria를 먼저 작성합니다.
2. 한 사람은 구현 또는 조사 Owner, 다른 사람은 Reviewer가 됩니다.
3. `main`에 직접 작업하지 않고 Issue 번호를 포함한 브랜치를 만듭니다.
4. 작은 PR로 제출하고 상대 팀원의 검토를 받습니다.
5. 결과를 재현할 명령, 설정, 고정 버전을 PR에 기록합니다.

권장 브랜치 이름:

- `research/12-threat-model`
- `feat/18-effect-decoder`
- `experiment/25-offline-eval`
- `docs/31-paper-outline`

## Issue sizing

- S: 반나절 이내
- M: 약 1일
- L: 최대 2일

2일을 넘는 작업은 독립적으로 검토 가능한 결과물로 나눕니다. 동시에 진행하는 Issue는 한 사람당 하나를 권장합니다.

## Definition of done

- 요구된 파일 또는 결과물이 저장소에 존재합니다.
- 관련 테스트와 `npm run check`가 통과합니다.
- 실험은 입력, 버전, seed, 출력 경로가 기록됩니다.
- 새로운 연구 판단은 `docs/decisions/`에 기록됩니다.
- Reviewer가 코드와 연구 주장을 모두 확인합니다.

## Reproducibility

- RPC URL, API key, 지갑 키를 커밋하지 않습니다.
- 포크 실험은 chain ID와 block number를 고정합니다.
- 생성된 원시 결과는 덮어쓰지 않고 실행 ID별로 분리합니다.
- 논문 표와 그림은 가능한 한 저장된 결과에서 다시 생성할 수 있어야 합니다.

## Anonymity

심사 종료 전에는 저장소를 비공개로 유지합니다. 제출 산출물에는 개인 이름, 이메일, GitHub 프로필, 로컬 절대 경로를 포함하지 않습니다.
