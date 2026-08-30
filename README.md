# IntentLock Agent Wallet

멀티 툴 LLM 에이전트가 실행하는 트랜잭션의 **누적 경제 효과**를 사용자 의도 계약과 대조해, 실행 전후의 의도 이탈을 탐지하고 차단하는 연구 프로젝트입니다.

## Research thesis

각 도구 호출이 개별적으로 허용되더라도, 승인·스왑·브리지·재시도의 조합은 사용자가 허용하지 않은 누적 자산 이동이나 권한 노출을 만들 수 있습니다. IntentLock은 자연어 의도를 타입이 있는 계약으로 고정하고, 시뮬레이션된 EVM 상태 변화와 누적 예산을 상태 기반 모니터로 검증합니다.

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

작업은 Issue로 정의하고 PR로 검토합니다. 고정 담당자 표시는 두지 않되, 연구 주장과 재현 근거는 병합 전에 다른 팀원이 독립 검토합니다. 자세한 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## Status

현재 단계는 연구용 초기 골격입니다. 보안 보장을 주장하는 프로덕션 지갑 구현이 아닙니다.
