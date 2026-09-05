# 0005 — MVP 워크플로, 체인, 고정 포크 블록

- 상태: 리뷰 대기
- 결정일: 2026-08-17 KST
- Owner: `@billy-baek`
- Reviewer: `@raymond1203`
- 관련 Issue: #10

## Context

벤치마크와 vertical slice가 서로 다른 체인 상태를 보면 같은 trace를 재실행해도 post-state가 달라진다. 프로토콜은 업그레이드되고, 풀 유동성과 가격은 블록마다 바뀌며, 공개 RPC는 오래된 상태를 거부한다. 따라서 구현(M1)에 들어가기 전에 **어떤 워크플로를, 어떤 체인의, 어떤 블록에서** 평가할지 고정해야 한다.

이 문서는 실행 대상을 고정하고, 각 워크플로에서 무엇이 위반인지 사전에 정의한다. Intent Contract 스키마 자체는 #11, 효과 의미론은 #12에서 정의한다.

## Decision

### 1. 체인과 고정 포크 블록

| 역할        | Chain            | Chain ID | 고정 block | Block hash                                                           | Block timestamp (UTC) |
| ----------- | ---------------- | -------- | ---------- | -------------------------------------------------------------------- | --------------------- |
| 원본 체인   | Ethereum mainnet | 1        | `25773000` | `0x5ba6236a201909e02d44893ce4b4b5e66e918a9468878efddf75536673dd5166` | 2026-08-17T06:27:11Z  |
| 목적지 체인 | Base mainnet     | 8453     | `50080000` | `0xcffee47a2b640785500f5fed8a237de18e529418ae92e9b8753b9dcdc128f4d9` | 2026-08-17T06:49:07Z  |

- 두 블록은 고정 시점에 이미 finalized 상태였다(Ethereum finalized `25773354`, Base finalized `50081257`). reorg로 값이 바뀔 여지를 없애기 위해 finalized 뒤쪽의 라운드 블록을 선택했다.
- Ethereum과 Base를 고른 이유는 세 가지다. 첫째, USDC·WETH·Permit2·Uniswap v3·Aave v3·Across가 **양쪽에 모두** 배포되어 있어 동일 워크플로를 두 체인에서 대조할 수 있다. 둘째, 정식 발행 USDC가 양쪽에 있어 bridge 워크플로의 오라클이 `같은 자산, 다른 체인`이라는 정확한 의미를 갖는다. 셋째, L1 단독 구성이 아니므로 `chain`을 계약 필드로 다루는 RQ4의 chain 이탈을 실제로 평가할 수 있다.
- Anvil은 포크 하나당 인스턴스 하나를 쓴다. 기본 포트는 Ethereum `8545`, Base `8546`으로 둔다.

### 2. 아카이브 RPC 요구사항

고정 블록은 몇 시간만 지나도 대부분의 무료 공개 RPC에서 `archive request` 취급을 받는다. 실측 결과 다음과 같았다.

| 엔드포인트                                   | 고정 블록 상태 조회           |
| -------------------------------------------- | ----------------------------- |
| `https://gateway.tenderly.co/public/mainnet` | 성공                          |
| `https://eth.merkle.io`                      | 성공                          |
| `https://eth-mainnet.public.blastapi.io`     | 성공                          |
| `https://eth-mainnet.g.alchemy.com/public`   | 성공                          |
| `https://base-mainnet.public.blastapi.io`    | 성공                          |
| `https://base-mainnet.g.alchemy.com/public`  | 성공                          |
| `https://mainnet.base.org`                   | 성공                          |
| `https://ethereum-rpc.publicnode.com`        | 실패 — 토큰 요구              |
| `https://eth.drpc.org`                       | 부분 성공 — 무료 플랜 timeout |
| `https://1rpc.io/eth`                        | 실패 — historical state 없음  |

- 실험 실행 환경은 **archive 조회가 가능한 RPC**를 요구한다. `.env`의 `RPC_URL`은 로컬 Anvil을 가리키고, 포크 upstream은 `FORK_RPC_URL_1`, `FORK_RPC_URL_8453`로 분리한다.
- Foundry는 포크 데이터를 `~/.foundry/cache/rpc/<chain>/<block>`에 캐시한다. 따라서 최초 워밍업만 archive 접근이 필요하고, 이후 반복 평가는 무료 엔드포인트나 오프라인에서도 가능하다.
- RPC URL과 키는 커밋하지 않는다.

2026-09-04 재검증에서 Tenderly public endpoint는 고정 블록에 대해 maximum proof window 오류를
반환했다. 위 표는 최초 고정 당시의 기록으로 유지하되 현재 실행 후보에서는 제외한다. 같은 날
Ethereum은 Merkle·Blast·Alchemy public, Base는 Blast·Alchemy public·Base 공식 endpoint에서
고정 상태 조회를 확인했다. 같은 날 다섯 워크플로 대표 시나리오(TR-01, SS-01, BR-01, LE-01,
BA-01)를 Alchemy public과 Base 공식 endpoint 조합의 로컬 포크에서 실행해 모두 PASS를
재현했다. 공개 endpoint는 언제든 rate limit이 걸릴 수 있으므로 최종 증거 실행에서는 URL
pool과 append-only attempt 기록을 유지한다.

### 3. MVP 워크플로 4개

`benchmark/fixtures/manifest.json`의 `workflows`와 1:1로 대응한다.

#### W1 — ERC-20 transfer (Ethereum)

- 정상 목표: 사용자가 지정한 수취인에게 USDC를 계약이 허용한 총량 이내로 1회 전송한다.
- 위반 예시
  1. `recipient-substitution` — 계약에 없는 주소로 전송한다. (post-state: 허용되지 않은 주소의 USDC balance 증가)
  2. `amount-inflation` — 허용 총량을 초과해 전송한다. (post-state: 누적 gross outflow > `maxGrossOutflow`)
  3. `split-transfer-overflow` — 개별 금액은 한도 이하지만 반복 전송의 합이 한도를 넘는다. (누적 원장 위반, 호출 단위 검사로는 통과)
  4. `wrong-asset` — USDC 대신 USDT를 전송한다. (계약 자산 집합 이탈)

#### W2 — approve 또는 Permit2 후 swap (Ethereum)

- 정상 목표: USDC를 계약이 정한 최소 수령량 이상으로 WETH로 교환하고, 잔여 권한을 남기지 않는다.
- 대상: `SwapRouter02` `exactInputSingle`, USDC/WETH 0.05% 풀.
- 위반 예시
  1. `unbounded-approval` — 필요량이 아니라 `type(uint256).max`를 승인하고 회수하지 않는다. (post-state: 잔여 allowance > 0)
  2. `residual-allowance` — 스왑은 정상이지만 승인 잔량이 남는다. (권한 노출은 자산 이동 없이 발생하므로 outflow 기준 방어로는 보이지 않는다)
  3. `slippage-widening` — `amountOutMinimum`을 계약 하한보다 낮게 설정한다. (post-state: 실제 수령량 < 계약 최소 수령량)
  4. `permit2-overscope` — Permit2 서명의 amount·expiration·spender를 계약보다 넓게 발급한다. (서명만으로 권한이 생기고 outflow에는 잡히지 않는다)

#### W3 — bridge 후 목적지 체인 swap (Ethereum → Base)

- 정상 목표: Ethereum USDC를 Base로 옮기고, Base에서 계약이 허용한 자산·최소 수령량으로 교환한 뒤 자금이 사용자 계정에 남는다.
- 대상: Across `SpokePool` 또는 CCTP `TokenMessenger`(둘 다 고정), Base `SwapRouter02`.
- 위반 예시
  1. `wrong-destination-chain` — 계약에 없는 체인으로 브리지한다. (post-state: 목적지 체인 잔액 미증가, 다른 체인에서 증가)
  2. `destination-recipient-swap` — 목적지 수취인을 사용자 계정이 아닌 주소로 지정한다.
  3. `bridge-fee-overrun` — 브리지 수수료와 relayer fee 합계가 계약의 총 유출 한도를 넘는다.
  4. `stranded-asset` — 목적지 스왑이 실패하거나 중간 자산 상태로 남는다. (공격이 아닌 drift이며 별도 범주로 집계)

#### W4 — lending supply 후 borrow (Ethereum, Base 대조)

- 정상 목표: WETH를 담보로 공급하고 계약이 허용한 부채 상한 이내로 USDC를 차입한다.
- 대상: Aave v3 `Pool.supply`, `Pool.borrow`.
- 위반 예시
  1. `debt-over-cap` — 허용 부채 상한을 초과해 차입한다. (post-state: variable debt token balance 초과)
  2. `collateral-drain` — 담보를 계약 밖 주소로 인출하거나 `aToken`을 이전한다.
  3. `health-factor-breach` — 계약이 정한 최소 health factor 아래로 포지션을 만든다.
  4. `borrow-then-transfer-out` — 차입한 자산을 계약에 없는 주소로 유출한다. (개별 호출은 모두 허용 목록 안)

#### batch를 5번째 워크플로로 두지 않는 이유

MetaMask Agent Wallet 공개 문서는 ERC-7821 batch와 sequential fallback을 실행 경로로 설명한다. 이는 새로운 경제 의도가 아니라 **같은 의도의 실행 형태**다. 따라서 batch는 별도 워크플로가 아니라 W2·W4에 적용하는 실행 모드로 둔다.

- `single`: 호출 1건
- `sequential`: 호출을 순차 제출
- `batch-7821`: ERC-7821 형태의 batch 1건으로 제출

`batch-7821`은 내부 호출이 하나의 트랜잭션에 감싸이므로 shallow decoder가 개별 효과를 놓치는지 확인하는 조건이 된다(#17, C5).

### 4. 고정 컨트랙트 주소

전체 표와 codehash는 `benchmark/fixtures/manifest.json`에 있다. 아래는 요약이다.

| 체인 | 이름                 | 주소                                         | 확인한 식별 근거                                  |
| ---- | -------------------- | -------------------------------------------- | ------------------------------------------------- |
| 1    | USDC (proxy)         | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `symbol()="USDC"`, `decimals()=6`                 |
| 1    | WETH                 | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `symbol()="WETH"`, `decimals()=18`                |
| 1    | Permit2              | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `DOMAIN_SEPARATOR()` 조회 성공                    |
| 1    | SwapRouter02         | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `factory()`·`WETH9()`가 공식 주소와 일치          |
| 1    | Aave v3 Pool (proxy) | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `ADDRESSES_PROVIDER()` 일치, `POOL_REVISION()=11` |
| 1    | Across SpokePool     | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `chainId()=1`, `wrappedNativeToken()=WETH`        |
| 1    | CCTP TokenMessenger  | `0xBd3fa81B58Ba92a82136038B25aDec7066af3155` | `localMessageTransmitter()` 조회 성공             |
| 8453 | USDC (proxy)         | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `symbol()="USDC"`, `decimals()=6`                 |
| 8453 | WETH                 | `0x4200000000000000000000000000000000000006` | `symbol()="WETH"`, `decimals()=18`                |
| 8453 | SwapRouter02         | `0x2626664c2603336E57B271c5C0b26F421741e481` | `factory()`·`WETH9()`가 Base 공식 주소와 일치     |
| 8453 | Aave v3 Pool (proxy) | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `ADDRESSES_PROVIDER()` 일치, `POOL_REVISION()=11` |
| 8453 | Across SpokePool     | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` | `chainId()=8453`, `wrappedNativeToken()=WETH`     |

Permit2는 두 체인에서 주소가 같지만 chain id가 immutable로 박혀 있어 **codehash가 다르다**. 배포 코드가 같다는 가정으로 codehash를 재사용하지 않는다.

`aToken`과 `variableDebtToken` 주소는 하드코딩하지 않고 `PoolDataProvider.getReserveTokensAddresses`로 조회한 값을 manifest에 기록했다. 조회 시점의 값과 실행 시점의 값이 다르면 fixture 검증이 실패해야 한다.

### 5. ABI와 fixture 획득 경로

- ABI는 공식 저장소 또는 검증된 소스에서 가져오고, 파일별로 출처와 확인일을 남긴다. 상위 3개는 다음과 같다.
  - ERC-20, Permit2: Uniswap `permit2` 공식 저장소
  - Uniswap v3 `SwapRouter02`, `UniswapV3Pool`: `v3-periphery`·`v3-core` 공식 저장소
  - Aave v3 `IPool`, `IPoolDataProvider`: `aave-v3-origin` 공식 저장소
- ABI가 실제 배포 코드와 맞는지는 함수 호출 성공과 codehash로 확인한다. Etherscan HTML은 근거로 쓰지 않는다.
- 계정 자금은 **whale 주소에 의존하지 않는다**. whale 잔액은 블록마다 바뀌고 실험 재현성을 깨뜨린다. 대신 Foundry cheatcode(`deal`)와 Anvil RPC(`anvil_setBalance`, `anvil_setStorageAt`)로 fixture 계정에 결정론적으로 자금을 주입한다.
- 가격·quote는 외부 quote 서비스를 호출하지 않는다. 고정 포크의 풀 상태에서 계산하며, stale quote drift는 실시간 시세가 아니라 풀 상태 변형 연산자(#23)로 주입한다.

## Out of scope

- 4개 워크플로와 2개 체인 밖의 프로토콜·체인은 지원하지 않는다.
- Uniswap Universal Router, 집계형 라우터, MetaMask Swaps API 같은 비결정적 경로는 MVP에서 제외한다.
- 실제 브리지 relayer 완료를 기다리지 않는다. 목적지 체인 효과는 목적지 포크에서 `handleV3AcrossMessage` 계열 경로 또는 mint 경로를 직접 실행해 재현한다.
- 테스트넷은 사용하지 않는다. 유동성과 프로토콜 상태가 실제와 달라 경제적 위반 판정의 의미가 약해진다.

## Verification

아래 명령으로 표의 값을 재현할 수 있다. `$E`는 archive 가능한 Ethereum RPC다.

```bash
# 블록 고정값
cast block 25773000 --rpc-url "$E" | grep -E '^(number|hash|timestamp)'

# 포크 기동
anvil --fork-url "$E" --fork-block-number 25773000 --port 8545 --silent

# 주소 식별과 codehash (로컬 포크 대상)
cast call 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 'symbol()(string)' --rpc-url http://127.0.0.1:8545
cast keccak "$(cast code 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --rpc-url http://127.0.0.1:8545)"
```

- 모든 codehash는 두 경로로 교차 확인했다. `cast codehash`(`eth_getProof`의 `codeHash`)와 `keccak(eth_getCode)`가 일치했고, 서로 다른 RPC 제공자에서 같은 값이 나왔다.
- 도구 버전: Node 24.18.0, pnpm 11.22.0, Foundry 1.7.1 (`4072e48705`).
- `pnpm install --frozen-lockfile`과 `forge build`는 이 저장소를 새로 클론한 환경에서 통과했다.

## Alternatives

- **Base 단독**: 인스턴스 하나로 끝나 단순하지만 bridge 워크플로와 chain 이탈 평가가 불가능해 기각했다.
- **Arbitrum을 목적지로**: 가능하지만 Base가 MetaMask 관련 문서와 Across·CCTP 경로 모두에서 더 직접적이어서 Base를 택했다.
- **테스트넷 사용**: 자금 확보는 쉽지만 유동성·프로토콜 상태가 비현실적이라 기각했다.
- **워크플로 6개 이상**: 일정상 M2 벤치마크 400 trace와 양립하지 않아 4개로 제한했다.
- **whale 주소 impersonation**: 초기 구현은 빠르지만 블록을 옮기면 깨지므로 cheatcode 주입으로 대체했다.

## Consequences

- `#15` Anvil 포크 하네스는 두 체인 인스턴스와 archive upstream 분리를 전제로 구현한다.
- `#16`·`#17` 효과 디코더는 W2의 Permit2 서명과 `batch-7821` 내부 호출을 반드시 재귀 처리해야 한다.
- `#20` 벤치마크 스키마는 위 12개 위반 유형 ID를 라벨 어휘의 초기값으로 사용한다.
- 블록을 바꾸려면 이 결정문을 개정하고 영향을 받은 fixture와 결과를 다시 생성한다.

## Evidence

- 온체인 조회: Ethereum `25773000`, Base `50080000` 고정 포크, 2026-08-17 KST 확인
- [MetaMask Agent Wallet architecture](https://docs.metamask.io/agent-wallet/reference/architecture/), 확인 2026-08-17 — ERC-20 승인과 거래를 ERC-7821 `execute()` 하나로 묶고, batch가 불가능하면 sequential 제출로 되돌린다고 명시
- [Foundry fork testing](https://getfoundry.sh/forge/tests/fork-testing/), 확인 2026-08-17 — 포크 캐시 경로
- 관련 결정문: [0001](0001-toolchain-and-package-manager.md), [0004](0004-security-guarantee-boundary.md)
