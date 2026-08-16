# 0001 — Toolchain and package manager

## Context

IntentLock은 TypeScript 기반 정책·효과 모델과 Foundry 기반 EVM 포크 실험을 함께 사용합니다. 두 명이 짧은 기간에 같은 결과를 재현하려면 로컬과 CI의 패키지 매니저, Node, Foundry와 lockfile을 고정해야 합니다.

2026-08-17에 Context7 MCP로 pnpm, Viem, Foundry의 최신 공식 문서를 점검했습니다.

## Decision

- JavaScript 패키지 매니저는 pnpm 11.22.0을 사용합니다.
- Node는 24.18.0, Foundry는 1.7.1로 고정합니다.
- `pnpm-lock.yaml`만 버전 관리하고 CI에서는 `pnpm install --frozen-lockfile`을 사용합니다.
- CI의 외부 GitHub Actions는 변경되지 않는 commit SHA로 고정합니다.
- TypeScript 6.0.3을 유지합니다. 현재 `typescript-eslint` 8.67.0의 peer 범위가 TypeScript 7을 허용하지 않으므로 메이저 자동 업데이트를 차단합니다.
- Viem Public Client는 chain을 명시하고 읽기·시뮬레이션에만 사용합니다. 개인 키와 Wallet Client를 사용하는 signer adapter는 별도 모듈로 둡니다.
- Zod는 외부 입력과 Intent Contract의 runtime validation, Vitest는 순수 TypeScript 단위 테스트, Foundry는 Solidity와 fork integration test에 사용합니다.
- 현재 JavaScript package가 하나이므로 pnpm workspace는 도입하지 않습니다. 독립 배포·의존성 경계가 필요한 두 번째 package가 생길 때 별도 결정합니다.
- Agent framework는 현재 도입하지 않습니다. Guardrail core가 특정 planner나 모델 SDK에 종속되지 않게 하고, adapter 단계에서 필요한 SDK만 추가합니다.

## Consequences

- npm보다 엄격한 dependency resolution과 재현 가능한 lockfile을 얻습니다.
- Node와 Foundry 업그레이드는 의도적인 PR과 전체 실험 재검증이 필요합니다.
- 시뮬레이터가 signing capability를 갖지 않아 권한 경계가 명확해집니다.
- 단일 package 단계에서 불필요한 monorepo 운영 비용을 피합니다.

## Evidence

- pnpm CI: https://pnpm.io/continuous-integration
- pnpm clean/frozen install: https://pnpm.io/cli/ci
- Viem Public Client: https://github.com/wevm/viem/blob/main/site/pages/docs/clients/public.md
- Viem contract simulation: https://github.com/wevm/viem/blob/main/site/pages/docs/actions/public/simulateCalls.md
- Foundry CI: https://github.com/foundry-rs/book/blob/master/src/pages/config/ci.mdx
- Foundry fork testing: https://github.com/foundry-rs/book/blob/master/src/pages/guides/fork-testing.mdx
