# Effect decoder support and provenance

M1 decoder는 ERC-20 `transfer`, `transferFrom`, `approve`, Permit2 allowance/signature transfer,
Uniswap SwapRouter02 `exactInputSingle`/`exactInput`/`multicall`, ERC-7821 basic batch mode를 지원한다.

지원 여부는 주소만으로 판단하지 않는다. `benchmark/fixtures/manifest.json`에 고정된 chain,
block, ABI source, runtime codehash와 실행 시 관찰 codehash가 일치해야 한다. mismatch, 알 수 없는
selector, 잘못된 v3 path, 지원하지 않는 ERC-7821 mode, 재귀 한도 초과는 UNKNOWN/PARTIAL이다.

기본 한도는 depth 4, call 32, calldata 131,072 bytes다. 각 effect에는 call path, target, selector,
codehash와 calldata/simulation/receipt 출처가 붙는다. SwapRouter02 입력 transfer와 swap outcome을
둘 다 생성하여 router가 받는 gross outflow와 최종 recipient/min-out을 독립 검사한다.

단위 fixture는 `test/effects/`, 고정 Ethereum 포크 code identity 대조는
`test/integration/effect-decoders.integration.test.ts`에 있다. 포크 테스트는 archive RPC가 있을 때만
실행된다.
