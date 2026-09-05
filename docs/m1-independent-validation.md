# M1 independent-validation closeout

이 문서는 M1의 두 미완료 acceptance gate를 닫는 절차다.

- #13: 구현 결과를 보지 않은 사람이 자연어 입력과 candidate contract를 독립 라벨링한다.
- #19: 고정 포크에서 ALLOW 5건은 실제 transaction receipt/post-state로, 나머지 5건은 signer
  미도달로 검증한다.

실명, 팀 등록 정보, RPC URL과 API key는 패킷·submission·evidence에 기록하지 않는다.

## #13 compiler blind review

Reviewer가 받는 파일은 다음 두 개다.

- `benchmark/reviews/m1/compiler-labeling.packet.json`
- `benchmark/reviews/m1/compiler-labeling.submission.template.json`

패킷에는 10개의 한국어 사용자 입력, untrusted observation, baseline candidate, case별 candidate
변경, field evidence, 이전 계약 사용 여부와 명시적 확인 필드가 있다. 다음 정보는 포함하지 않는다.

- author label 또는 expected decision/code
- mutation 이름
- compiler 실행 결과
- 기존 `compiler-gold.json` case ID

Reviewer는 먼저 `docs/intent-compiler.md`만 읽고 template의 복사본을 저장소 밖에서 작성한다. 이때
compiler, 테스트와 review checker를 실행하지 않고 다음을 전부 기록한다.

- `reviewerPseudonym`: 논문 익명성을 해치지 않는 가명
- `submittedAt`: timezone offset이 있는 ISO 8601 시각
- `independenceAttestation: true`
- 각 case의 `decision`, `escalationCode`, 정확한 unresolved `fields`, 짧은 `rationale`

빈 packet 자체의 무결성은 답을 공개하지 않고 확인할 수 있다.

```bash
pnpm m1:compiler:review
```

Reviewer가 10개를 모두 확정한 뒤에만 구현과 비교한다.

```bash
pnpm m1:compiler:review -- --submission <reviewer-submission.json> --require-agreement
```

불일치는 오류가 아니라 합의가 필요한 연구 기록이다. 사용자 원문과 `docs/intent-compiler.md`를 근거로
각 불일치를 adjudicate하고, 원래 독립 판단과 최종 합의를 모두 PR에 남긴다. 가짜 human submission을
만들거나 AI 판단을 human 판단으로 기록하지 않는다.

## #19 fixed-fork Golden 10

### 동결된 환경

- Ethereum chain ID `1`
- block `25773000`
- block hash `0x5ba6236a201909e02d44893ce4b4b5e66e918a9468878efddf75536673dd5166`
- 시나리오: `benchmark/scenarios/golden/scenarios.json`

G05는 고정 블록 QuoterV2 결과 `526301279457898`과 정확한 100bps 하한
`521038266663319`을 calldata에 동결한다. Runner는 transaction을 보내기 전에 QuoterV2 결과, route
pool과 pool codehash가 fixture와 같은지 재확인한다. runtime quote를 근거로 authored minimum을
자동 변경하지 않는다.

### 실행

각 팀원은 동일한 clean commit을 별도 환경에서 checkout하고 자기 archive-capable RPC를
`FORK_RPC_URL_1` 또는 로컬 `.env.local`에만 넣는다. `.env.local`은 Git에서 제외된다.

```bash
pnpm m1:golden:run -- --output experiments/results/m1-golden-reviewer-a.json
```

The packaged command fails before opening the fork when the source tree is dirty and also rejects a
commit or worktree change during the run. A dirty diagnostic can only be collected by invoking the
compiled runner directly without `--require-clean-source`; it cannot pass closeout validation.

Runner는 case마다 snapshot/revert하고 다음을 강제한다.

- G01~G05: 실제 local-Anvil user transaction 1건, 성공 receipt, case별 post-state assertion
- G05: raw USDC owner→pinned pool 및 WETH pinned pool→recipient flow, actual output와 min-out 비교,
  예상 밖 account token flow 부재
- G06~G10: trap signer call count `0`, transaction hash 없음, account nonce 불변
- G10: `anvil_setCode`로 실제 로컬 bytecode drift를 만든 뒤 observed codehash로 차단하고 revert 후
  원래 fingerprint 복구
- setup transaction과 guard를 통과한 user transaction 분리

Runner가 쓰는 `experiments/results/`는 Git에서 제외된다. evidence에는 RPC URL이 들어가지 않으며 source
commit, dirty flag, toolchain, runner/fixture SHA-256, fork fingerprint, receipt, raw token flow,
post-state assertion과 stable decision digest만 남는다.

동일 commit에서 evidence를 검증한다. 마감 증거는 dirty run을 거부한다.

```bash
pnpm m1:golden:validate -- --evidence experiments/results/m1-golden-reviewer-a.json
```

두 번째 팀원의 독립 실행까지 끝나면 provenance와 stable digest를 함께 비교한다.

```bash
pnpm m1:golden:validate -- \
  --evidence experiments/results/m1-golden-reviewer-a.json \
  --compare experiments/results/m1-golden-reviewer-b.json
```

두 파일은 같은 clean commit, runner SHA, fixture SHA, fork fingerprint와 stable decision digest를 가져야
한다. timestamp, RPC, reviewer 이름과 transaction hash는 stable digest 입력이 아니다.

## M1 종료 조건

다음이 모두 충족될 때만 #13, #19와 M1 milestone을 완료로 취급한다.

1. 실제 사람이 compiler packet 10개를 독립 라벨링하고 모든 불일치를 합의한다.
2. 두 팀원이 같은 clean commit에서 fixed-fork Golden 10을 각각 실행한다.
3. 각 실행이 real ALLOW receipt 5개와 signer 앞 차단 5개를 갖는다.
4. 두 evidence의 stable digest와 provenance가 일치한다.
5. PR에서 M1 schema, ActionIR, monitor, decoder, ledger의 남은 교차검토를 승인한다.
