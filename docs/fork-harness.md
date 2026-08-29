# 고정 포크 하네스 실행 문서

- 관련 Issue: #15
- 고정 대상: [`docs/decisions/0005-mvp-workflows-and-forks.md`](decisions/0005-mvp-workflows-and-forks.md)
- 코드: [`scripts/anvil-harness.ts`](../scripts/anvil-harness.ts), [`scripts/fork-verify.ts`](../scripts/fork-verify.ts)

## 무엇을 보장하는가

하네스는 Anvil을 고정 블록에서 띄운 뒤, 포크가 동결한 상태와 정확히 같은지 확인한 뒤에만 핸들을 돌려준다. 네 가지 중 하나라도 어긋나면 **즉시 실패한다**.

1. chain id가 설정과 다르다
2. 시작 블록 번호가 다르다
3. 그 블록의 block hash가 다르다
4. `benchmark/fixtures/manifest.json`에 기록된 컨트랙트 codehash 중 하나라도 다르다

4번이 있어서 upstream RPC가 조용히 다른 체인이나 다른 상태를 주는 경우도 잡힌다. 실험이 시작되기 전에 죽는 것이 목표다.

## 준비물

- Node 24.18.0, pnpm 11.22.0, Foundry 1.7.1 (`anvil`이 `PATH`에 있어야 한다)
- **archive 조회가 가능한** upstream RPC. 무료 엔드포인트 상당수는 고정 블록을 거부한다. 검증된 목록은 manifest의 `rpc.verifiedArchiveEndpoints`에 있다.

```bash
cp .env.example .env
# .env 에 채운다 (커밋 금지)
# FORK_RPC_URL_1=https://...
# FORK_RPC_URL_8453=https://...
```

RPC URL은 설정 파일이나 Git에 넣지 않고 환경 변수로만 읽는다. Anvil CLI 제약상 child process의 `--fork-url` 인자로 전달되므로 같은 OS 권한의 process listing에서는 보일 수 있다. 하네스가 반환하는 stderr와 예외에서는 정확한 URL 값을 `[REDACTED_RPC_URL]`로 치환한다.

## 재현 확인

같은 포크가 몇 번을 띄워도 같은 상태인지 확인한다. 관찰값을 하나의 digest로 접어서 출력하므로, 팀원끼리 RPC URL이 들어간 로그를 주고받지 않고 digest만 비교하면 된다.

```bash
FORK_RPC_URL_1=... pnpm run fork:verify experiments/configs/forks/ethereum-25773000.json 10
FORK_RPC_URL_8453=... pnpm run fork:verify experiments/configs/forks/base-50080000.json 10
```

2026-08-17 기준 기대 digest는 다음과 같다. 값이 다르면 upstream RPC나 manifest 중 하나가 어긋난 것이다.

| 포크                | 컨트랙트 수 | digest                                                               |
| ------------------- | ----------- | -------------------------------------------------------------------- |
| `ethereum-25773000` | 12          | `0xabb5f554d99fe0b049794bb0155cb3dc2ff4f0207e8a6949a4653000eee3181c` |
| `base-50080000`     | 10          | `0x7b530f20e0ea6377e497d2329c2429eb61c75dfad485c9ee56f4b3090920109d` |

## 통합 테스트

```bash
FORK_RPC_URL_1=... pnpm run test:integration
```

`FORK_RPC_URL_1`이 비어 있으면 포크가 필요한 테스트는 **skip된다**. CI는 upstream RPC가 없으므로 단위 테스트만 돌고, 이 스위트는 Reviewer가 로컬에서 재현한다.

## 코드에서 쓰는 법

```ts
import { AnvilFork, loadForkConfig } from '../scripts/anvil-harness.ts';

const fork = await AnvilFork.start(
  loadForkConfig('experiments/configs/forks/ethereum-25773000.json'),
);
const snapshot = await fork.snapshot();

await fork.dealErc20(USDC, account, 1_000_000_000n); // whale 없이 결정론적 자금 주입
await fork.increaseTime(3600);

await fork.revert(snapshot); // 테스트마다 초기 상태로 되돌린다
await fork.stop(); // 프로세스 종료 + 포트 반환까지 기다린다
```

### 자금 주입이 whale을 쓰지 않는 이유

whale 주소의 잔액은 블록마다 바뀌므로 포크 블록을 옮기면 fixture가 조용히 깨진다. `dealErc20`은 현재 잔액과 다른 sentinel을 먼저 써서 실제 balance mapping 슬롯인지 확인한 뒤 목표 값을 기록한다. 실패·예외가 난 후보 슬롯은 `finally`에서 원래 값으로 복구하고, 슬롯을 못 찾으면 fail-closed로 던진다. 요청한 금액이 현재 잔액과 같아도 sentinel 검증을 거치므로 다른 mapping을 balance 슬롯으로 오인하지 않는다. USDC처럼 proxy 뒤에 있는 토큰도 저장소는 proxy에 있으므로 그대로 동작한다.

## 정리

`stop()`은 SIGTERM 후 5초까지 기다리고, 그래도 살아 있으면 SIGKILL한다. 그다음 포트가 실제로 반환될 때까지 확인하고, 반환되지 않으면 예외를 던진다. 프로세스가 비정상 종료해도 `process.on('exit')`에서 한 번 더 정리한다.

```bash
# 남은 것이 있는지 직접 확인
lsof -nP -iTCP:8545 -iTCP:8546 -sTCP:LISTEN
pgrep -fl anvil
```

## 한계

- 하네스는 체인당 Anvil 인스턴스 하나를 쓴다. bridge 워크플로는 두 인스턴스를 동시에 띄운다(포트 8545, 8546).
- `evm_snapshot`/`evm_revert`는 인스턴스 안의 상태만 되돌린다. 두 체인에 걸친 롤백은 각 인스턴스에서 따로 해야 한다.
- 최초 실행은 upstream archive 조회가 필요하다. 이후에는 Foundry가 `~/.foundry/cache/rpc/<chain>/<block>`에 캐시하므로 훨씬 빠르다.
