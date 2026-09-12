# IntentLock Agent Wallet

멀티 툴 LLM 에이전트가 실행하는 트랜잭션의 **누적 경제 효과**를 사용자 의도 계약과 대조해, 실행 전후의 의도 이탈을 탐지하고 차단하는 연구 프로젝트입니다.

## Research thesis

각 도구 호출이 개별적으로 허용되더라도, 승인·스왑·브리지·재시도의 조합은 사용자가 허용하지 않은 누적 자산 이동이나 권한 노출을 만들 수 있습니다. IntentLock은 **이미 확인된 의도 계약**에 누적 경제 효과와 최종 상태를 대조합니다. 자연어에서 계약을 정확히 추출하는 능력이나 실제 사용자의 동의는 주 실험에서 검증하지 않았습니다.

MetaMask Agent Wallet의 공개 정책을 실무 사례로 사용합니다. Guard Mode 비교군은 공개 문서에 근거한 연구용 정책 모형이며 운영 MetaMask 서비스나 공식 SDK 통합의 성능 점수가 아닙니다.

## Quick start

Prerequisites:

- Node.js 24.18.0
- pnpm 11.22.0
- Foundry/Anvil 1.7.1

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm run check
pnpm run contracts:build
```

Windows PowerShell에서는 `Copy-Item .env.example .env.local`을 사용하면 됩니다. 기존 설정 파일이 있으면 덮어쓰지 마세요. 일반 단위 검사에는 키가 필요 없으며, 유료 모델 호출과 포크 실험은 별도 명령입니다.

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

작업은 Issue로 정의하고 PR로 검토합니다. 현재 검수 방식은 ADR 0011의 담당자 1명 + AI 보조 검토입니다. 이를 두 번째 독립 인간 검수나 최종 저자 승인으로 표시하지 않습니다. 자세한 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## Status

동결된 M2 실행 증거와 M3 비교 분석, M4 제출 준비본이 있습니다. 고정 포크 기본 사례 80개와 작성된 400개 기록의 오프라인 정책 비교는 별도 증거입니다. 연구용 프로토타입이며 프로덕션 지갑의 보안 보장을 주장하지 않습니다.

현재 제출 검토 대상과 과거 동결본의 구분, 안전한 그림 재생성은 [출판 안내](paper/editorial-README.md)를 참고하세요. 실제 제출·공란 입력·익명 공유·저자 승인은 #35에서 별도로 관리합니다.
