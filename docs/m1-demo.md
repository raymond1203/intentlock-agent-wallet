# M1 MetaMask guardrail demo

M1 경로는 calldata decode → deterministic monitor → atomic reservation → MetaMask signing boundary →
receipt effect/final-state comparison 순서다. `DENY`와 unresolved `ESCALATE`는 `mm wallet` 호출 전에
반환된다. Simulator가 산출한 GAS·internal trace effect는 calldata effect와 합쳐져 같은 누적 예산과
receipt 대조를 통과해야 한다.

## 재현

```bash
pnpm install --frozen-lockfile
pnpm run schema:check
pnpm exec vitest run test/e2e/golden-scenarios.e2e.test.ts
pnpm run check
```

고정 포크까지 확인하려면 archive-capable endpoint를 로컬 환경변수에만 넣는다.

```bash
FORK_RPC_URL_1=<private RPC URL> pnpm run test:integration
```

PowerShell에서는 `$env:FORK_RPC_URL_1 = '<private RPC URL>'`을 사용한다. URL, key, mnemonic,
private key는 저장소나 로그에 기록하지 않는다. 테스트 signer는 Anvil 기본 계정뿐이다.

`MetaMaskCliExecutor`는 공식 `mm wallet send-transaction --chain-id ... --payload ... --wait`
경계에 arguments array로 연결된다. Shell interpolation을 사용하지 않는다. Receipt parser는 신뢰할
수 있는 RPC/receipt source에서 observed effects와 final-goal checks를 구성해야 하며, stdout을
무조건 성공으로 간주해서는 안 된다.

## 독립 검증

두 팀원은 같은 commit SHA에서 위 명령을 각각 실행하고 PR에 다음만 남긴다.

- commit SHA와 Node/pnpm/Foundry 버전
- Golden 10개 decision 요약(ALLOW 5, 차단 5)
- 고정 fork fingerprint digest
- 실패 여부와 재현 명령

개인 이름, 팀 등록 정보, RPC URL은 기록하지 않는다. 두 실행의 decision이 다르면 merge하지 않고
fixture·toolchain·fork fingerprint 차이부터 확인한다.
