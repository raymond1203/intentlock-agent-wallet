# IntentLock Agent Wallet

멀티 툴 LLM 에이전트의 **누적 경제 효과**를 확인된 작업 계약과 대조하는 연구 프로젝트입니다. 실행 전 한도 검사와 실행 후 완료 조건 확인을 구분합니다.

## 리서치 읽기

[안전한 호출은 안전한 실행을 보장하지 않는다: 인텐트록(IntentLock)](paper/submission-ko.md)

2026-09-14 노션 최종 편집본의 본문·표 9개·이미지 4장을 반영했습니다. 대회용 EVM 주소와 학회 코드는 공란이며, 노션 페이지 주소는 공개하지 않습니다. 편집본과 동결된 분석 자료의 구분은 [원고 안내](paper/README.md)를 참고하세요.

## Research thesis

각 도구 호출이 개별적으로 허용되더라도, 승인·스왑·브리지·재시도의 조합은 작업에 부여한 한도나 완료 조건을 어길 수 있습니다. IntentLock은 구조화된 계약을 전제로 이전에 허용한 효과와 남은 권한을 추적하고, 마지막 자산 상태를 대조합니다. 자연어 의도의 완전한 추출이나 실제 사용자 승인 과정을 검증했다는 주장은 하지 않습니다.

## Quick start

Prerequisites:

- Node.js 24.18.0
- pnpm 11.22.0
- Foundry/Anvil 1.7.1

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm run check
pnpm run contracts:build
```

Windows PowerShell에서는 `Copy-Item .env.example .env`를 사용하면 됩니다.

pnpm은 `packageManager` 필드와 `pnpm-lock.yaml`로 버전을 고정합니다. npm으로 lockfile을 만들지 마세요.

## Repository map

- `src/domain/`: Intent Contract와 Guard 결정 타입
- `src/evm/`: 명시적 chain을 사용하는 읽기·시뮬레이션 전용 Viem 계층
- `src/adapters/metamask/`: monitor와 MetaMask signer 사이의 fail-closed 경계
- `test/`: 단위 테스트와 golden scenario 테스트
- `benchmark/`: 시나리오, 스키마, fixture, 고정 평가 split
- `experiments/`: 실험 설정과 결과 생성 절차
- `docs/`: 위협 모델, 실험 계획, 연구 결정 기록
- `paper/`: 제출 원고와 참고 자료
- `contracts/`: Foundry 기반 온체인 fixture와 테스트 계약

## Working agreement

개발 작업의 기본 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다. 이번 연구의 실제 검수 방식은 담당자 1명과 AI 보조 검토이며, 두 사람의 독립 검수를 수행했다고 주장하지 않습니다.

## Status

연구용 구현, 고정 포크의 기본 작업 80개 실행 검증, 작성된 기록 400개의 정책 비교와 별도 재계획 평가를 포함합니다. 정책 비교는 실제 자금 손실률이나 운영 MetaMask의 보안 성능을 측정한 것이 아닙니다. 원고 갱신과 대회 제출 완료도 구분합니다.
