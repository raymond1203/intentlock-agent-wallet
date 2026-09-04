# Human closeout playbook for Issues #20–#35

이 문서는 #20–#35의 사람 전용 acceptance gate를 가장 적은 중복 작업으로 닫기 위한 실행 순서다.
코드·테스트·패킷 생성은 자동화할 수 있지만, 사람의 판단·독립성·승인·Notion 확인은 자동화할 수
없다. 이 문서 작성 시점에는 어떤 승인도 수행되지 않았으며 모든 사람 판정은 `PENDING`이다.

현재 candidate는 v0.4.0이다. ADR 0010은 ordered approval 뒤 matching `transferFrom`이 소비한 양을
차감해 일곱 `SWAP_BATCH`의 terminal residual allowance를 0으로 고쳤다. Clean v0.3.0 실행은 80/80
normal PASS였지만 이 일곱 synthetic reference disagreement 때문에 폐기된 진단이다. v0.4.0 실행,
live LLM, 두 사람 review는 모두 새로 해야 하며 아직 완료되지 않았다.

## 1. 완료 판정의 경계

- AI와 스크립트는 패킷 생성, 해시 계산, 형식 검증, 표·그림 재생성까지만 수행한다.
- AI는 `reviewerType: "HUMAN"`, `SUBMITTED`, `APPROVED`, `independenceAttestation: true`, 사람의
  판정·메모·시각을 대신 채우지 않는다.
- 한 사람이 두 reviewer ID를 사용하면 안 된다. 두 submission을 복사하거나 공동 작성한 뒤 독립
  검수라고 기록해도 안 된다.
- 사람 검수 파일의 `PENDING`을 제거하는 행위 자체가 증거가 아니다. 입력 hash, case별 판단,
  rationale, 실제 검수 시각과 원본 submission이 함께 남아야 한다.
- 자동 checker가 `RECORDS_COMPLETE`를 반환해도 실제 사람과 독립성은 검증하지 못한다. 그것은 제출
  레코드의 형식·상호 일관성만 뜻한다.
- 사람이 필요한 gate가 남아 있으면 구현이 끝났더라도 해당 Issue는 닫지 않는다.

## 2. 익명 reviewer ID와 독립성 규칙

두 사람은 저장소 전체에서 각각 하나의 안정적인 가명만 사용한다.

| 역할       | 권장 가명    | 최소 작업                                                              |
| ---------- | ------------ | ---------------------------------------------------------------------- |
| Reviewer A | `reviewer-a` | #24 첫 번째 blind submission, #35 첫 번째 최종 체크리스트              |
| Reviewer B | `reviewer-b` | #20–#23의 독립 검수, #24 두 번째 blind submission, #25–#35의 독립 검수 |

가명과 실제 사람의 대응표는 저장소 밖의 비공개 팀 보관 위치에만 둔다. 실명, 이메일, GitHub ID,
학교·동아리 정보는 review 파일, 원고와 Notion 제출본에 적지 않는다. 같은 사람이 `reviewer-a`와
`reviewer-b`를 동시에 사용하면 #24와 #35를 닫을 수 없다.

독립 검수는 다음 조건을 모두 만족해야 한다.

1. 두 사람은 각자 깨끗한 checkout 또는 worktree에서 같은 candidate commit을 사용한다.
2. 각자 제출을 확정하기 전에는 상대방의 답, adjudication, author label과 결과 요약을 보지 않는다.
3. 생성된 packet은 수정하지 않고 답은 별도 파일에 쓴다.
4. submission을 제출한 뒤 원본은 덮어쓰지 않는다. 불일치는 별도 adjudication에서 해결한다.
5. 해당 sample의 author label이나 oracle 답을 이미 본 사람은 이를 blind review라고 주장하지 않는다.
   이 경우 보지 않은 제3의 사람을 `reviewer-c`로 추가하거나 gate를 `PENDING`으로 남긴다.
6. 저자의 self-review는 품질 점검으로는 남길 수 있지만 `independent` gate를 대신하지 않는다.

Reviewer B가 한 번의 집중 검수 창에서 M2 packet, freeze dry run, M3 재계산, M4 반대 관점 검토를
연속 수행하면 두 번째 사람의 시간을 가장 적게 쓸 수 있다. 단, 단계 사이의 공개 순서는 아래를
지켜야 한다.

## 3. 실제 template과 checker 현황

| Issue    | 사람 입력 또는 template                                                                     | 실제 제출 위치                                                    | 자동 검증                                          |
| -------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| #20      | `benchmark/reviews/schema-labeling-10.json`                                                 | `artifacts/human-reviews/m2-review-bundle.reviewer-b.md`          | 없음                                               |
| #21      | `benchmark/reviews/contract-alignment-10.json`                                              | 같은 M2 bundle                                                    | 없음                                               |
| #22      | `benchmark/reviews/double-review-20.json`의 D11–D20                                         | #24 submission 두 개와 adjudication                               | `pnpm m2:reviews --require-complete`               |
| #23      | `mutation-validity-20.json`, 이후 `terminal-observations-20.json`                           | 같은 M2 bundle                                                    | 없음                                               |
| #24      | `benchmark/reviews/submission.template.json`                                                | `benchmark/labels/submissions/reviewer-a.json`, `reviewer-b.json` | 있음                                               |
| #25      | `docs/baselines/guard-mode.md`의 source-to-rule 표                                          | M2 bundle                                                         | 없음                                               |
| #26      | live run이 만드는 `llm-verifier-20-review-v0.4.0.json`                                      | versioned rationale-review JSON과 M2 bundle                       | `pnpm m2:validate`가 run·packet·20개 판단을 결속   |
| #27      | `experiments/configs/freeze-review.template.json`                                           | `experiments/reviews/freeze-review.reviewer-b.json`               | `pnpm evaluation:freeze ...`                       |
| #28, #31 | primary raw/summary와 metric 정의                                                           | `artifacts/human-reviews/m3-review-bundle.reviewer-b.md`          | run/analysis만 자동, 사람 재계산 checker는 없음    |
| #29      | adaptive run이 만드는 `human-review-10.packet.json`                                         | 같은 M3 bundle                                                    | packet 생성만 자동, 사람 submission checker는 없음 |
| #30      | frozen ablation manifest와 구현 diff                                                        | 같은 M3 bundle                                                    | arm validation만 자동, 사람 diff checker는 없음    |
| #32–#34  | `claim-to-citation.md`, `limitations-checklist.md`, `metamask-recommendations.md`의 빈 양식 | `artifacts/human-reviews/m4-review-bundle.reviewer-b.md`          | 없음                                               |
| #35      | `artifacts/submission-checklist.md`                                                         | 저장소 밖의 private checklist 두 개                               | `pnpm submission:audit ...`는 자동 부분만 검사     |

`artifacts/human-reviews/`의 세 bundle은 현재 존재하는 machine schema가 아니라 사람이 제출한 판단을
보존하는 문서 증거다. 각 bundle에는 다음 공통 header를 넣고 실제 검수 전에는 값을 모두 `PENDING`으로
유지한다.

```text
status: PENDING
reviewerPseudonym: PENDING
reviewerType: HUMAN
reviewedCommit: PENDING
reviewedAt: PENDING
independenceAttestation: PENDING
inputsAndSha256: PENDING
```

Checker가 없는 gate는 Issue comment와 PR review에서 해당 bundle의 commit, 입력 hash와 case별 행을
사람이 다시 대조해야 한다. 자동 검증이 없는 사실을 `통과`로 바꾸어 쓰지 않는다.

## 4. 전체 순서와 commit 경계

```text
M2 clean execution + human review + adjudication
  -> candidate commit A
  -> #27 exact-20 human dry-run record
  -> evaluation + ablation manifests freeze
  -> direct child freeze commit B (review + dry-run 3개 + manifest 2개, 정확히 6개 파일만 변경)
  -> primary 2,000-row run, attempt-1 고정
  -> primary artifact commit C
  -> adaptive + ablation runs
  -> analysis, tables, figures
  -> M4 human review, final anonymous paper
  -> two private final checklists, Notion dry run, final hash/time
```

M2 submission과 adjudication은 A 전에 끝나야 한다. #27 review는 A를 정확히 가리켜야 한다. B는 A의
직접 자식이어야 하며 review JSON, 그 review가 결속한 dry-run 산출물 3개, evaluation manifest,
ablation manifest까지 정확히 6개 파일 외의 변경이 없어야 한다. Primary 결과는 B 이후의 clean
descendant에서 수집하고 원본을 덮어쓰지 않는다.

## 5. Phase M2 — #20–#26

### 5.1 자동 산출물을 먼저 고정한다

비밀 키와 RPC URL은 `.env.local` 또는 process environment에만 두고 terminal output, review 파일과
commit에 복사하지 않는다. clean commit에서 새 run directory를 사용한다.

```powershell
pnpm check
pnpm contracts:format:check
pnpm contracts:test
pnpm schema:check
pnpm benchmark:check
pnpm m2:validate --check
pnpm m2:execute --out=experiments/results/m2-v0.4.0-attempt-01
pnpm m2:evidence --runs=experiments/results/m2-v0.4.0-attempt-01 --out=benchmark/evidence/m2-execution-v0.4.0.json --require-all-executed
pnpm m2:validate
pnpm m2:validate --check
```

실패한 실행을 재시도할 때는 `attempt-02`처럼 새 directory를 쓰고 `--runs=`에 실제 시간 순서대로
모두 적는다. Publisher는 case별 첫 complete attempt를 선택하고 모든 시도를 보존한다. 최종
`experiments/configs/m2-validation.json`은 v0.4.0 80건의 complete clean evidence와
`syntheticReferenceDisagreementCount: 0`을 가리켜야 한다. 80건 모두 normal PASS여도 synthetic
reference disagreement가 하나라도 있으면 diagnostic으로만 보존하고 candidate A로 사용하지 않는다.
Raw bundle은 `benchmark/evidence/raw/v0.4.0/sha256/` 아래의 exact bytes여야 한다.

### 5.2 #20, #21, #23 blind packet을 먼저 끝낸다

Reviewer B는 다음 순서를 바꾸지 않는다.

1. `benchmark/reviews/schema-labeling-10.json`만 보고 S01–S10의 expected decision, 모든 label,
   validity를 기록한다.
2. `benchmark/reviews/contract-alignment-10.json`만 보고 C01–C10의 aligned 여부, missing field,
   widened field와 notes를 기록한다.
3. `benchmark/reviews/mutation-validity-20.json`만 보고 M01–M20의 operator category, semantic
   validity, pre-sign decision과 notes를 기록하고 그 section을 확정한다.
4. 3번을 확정한 뒤에만 `benchmark/reviews/terminal-observations-20.json`을 열어 같은 M01–M20의
   terminal judgment를 별도 열에 기록한다. Expected fixture를 executed evidence로 부르지 않는다.
5. 각 packet의 raw SHA-256, reviewed commit과 시간을 M2 bundle에 기록한다.

```powershell
Get-FileHash -Algorithm SHA256 benchmark/reviews/schema-labeling-10.json
Get-FileHash -Algorithm SHA256 benchmark/reviews/contract-alignment-10.json
Get-FileHash -Algorithm SHA256 benchmark/reviews/mutation-validity-20.json
Get-FileHash -Algorithm SHA256 benchmark/reviews/terminal-observations-20.json
```

M2 bundle의 #20/#21/#23 section은 packet의 모든 review ID를 정확히 한 번씩 포함해야 하며 빈 notes가
없어야 한다. Author는 그 후에만 oracle을 공개하고 각 불일치의 원판정, 최종 resolution, 근거와 변경
diff를 같은 bundle에 추가한다. 이 세 packet에는 전용 submission schema/checker가 없으므로 GitHub
Issue를 닫기 전에 Reviewer B가 최종 bundle을 수동 확인해야 한다.

### 5.3 #24와 #22의 25% 이중 검수

Reviewer A와 B가 template을 각각 복사한다. 두 사람 모두 상대 파일을 열지 않은 상태에서 D01–D20을
모두 작성한다. D11–D20은 bridge/lending/batch sample이므로 #22의 최소 10건 교차 검수도 함께
충족한다.

```powershell
New-Item -ItemType Directory -Force benchmark/labels/submissions
Copy-Item benchmark/reviews/submission.template.json benchmark/labels/submissions/reviewer-a.json
Copy-Item benchmark/reviews/submission.template.json benchmark/labels/submissions/reviewer-b.json
```

각 submission은 template의 `packetSha256`과 case set을 그대로 유지하고 다음을 실제 사람이 채운다.

- `reviewer`: 안정적인 가명
- `reviewerType`: `HUMAN`
- `status`: 모든 판단이 끝난 뒤에만 `SUBMITTED`
- `submittedAt`: 실제 ISO UTC 시각
- 각 case: `alignment`, `intermediateDecision`, `finalStateDecision`, `evidenceAdequate`, 비어 있지 않은
  `notes`

두 원본을 확정한 뒤 처음으로 checker를 실행한다.

```powershell
pnpm m2:reviews
```

출력의 두 `submissionSha256s`와 `packetSha256`을 사용해 차이가 있는 case만
`benchmark/labels/adjudications.json`에 기록한다. 각 resolution에는 두 가명 모두를 `agreedBy`에
넣고 rationale을 적는다. 원 submission은 수정하지 않는다.

```powershell
pnpm m2:reviews --require-complete
pnpm m2:validate
pnpm m2:validate --check
```

`RECORDS_COMPLETE`, `m2Complete: true`가 모두 확인되어야 #24 gate가 닫힌다. 두 파일이 같은 사람의
복사본이면 형식 검사가 통과해도 사람 gate는 닫히지 않는다.

### 5.4 #25 Guard Mode source-to-rule 검수

Reviewer B는 아래 입력을 같은 reviewed commit에서 대조한다.

- `docs/baselines/guard-mode.md`
- `src/baselines/guard-mode-emulator.ts`
- `test/baselines/guard-mode-emulator.test.ts`
- `test/baselines/guard-mode-integration.test.ts`
- `https://docs.metamask.io/agent-wallet/reference/trading-modes/`
- `https://docs.metamask.io/agent-wallet/reference/outflow-policy/`

```powershell
pnpm vitest run test/baselines/guard-mode-emulator.test.ts test/baselines/guard-mode-integration.test.ts
```

M2 bundle에 공식 문서의 각 rule, 구현 위치, 일치 여부, 공개 문서로 확인할 수 없는 추정, STRICT/LITERAL
민감도, production-equivalence 문구 유무를 행별로 기록한다. 가장 중요한 판정은 emulator가 private
MetaMask backend와 같다는 주장을 하지 않는지다. 이 gate에는 machine checker가 없으므로 상태는
Reviewer B의 실제 서명 전까지 `PENDING`이다.

### 5.5 #26 live LLM 20건과 rationale 검수

고정 model 설정과 local key가 준비된 clean commit에서 실행한다.

```powershell
pnpm baseline:llm:run
```

이 packaged live 명령은 API 요청 전에 dirty source를 거부하고, 실행 중 commit 또는 worktree가
바뀌어도 결과 생성을 거부한다. 따라서 tracked evidence 또는 review packet을 생성하기 전에 실행한다.

실행은 다음 세 파일을 만든다.

- `benchmark/evidence/llm-verifier-20-v0.4.0.json`
- `experiments/configs/baselines/llm-verifier-20-review-v0.4.0.json`
- `experiments/configs/baselines/llm-verifier-20-rationale-review-v0.4.0.template.json` (`PENDING`)

Reviewer B는 live packet의 R01–R20마다 `modelDecision`을 그대로 옮기고, rationale supported 여부,
oracle leakage 여부, 독립적으로 판단한 필수 `correctedDecision`과 notes를
`experiments/configs/baselines/llm-verifier-20-rationale-review-v0.4.0.json`과 M2 bundle에 기록한다.
제출 JSON에는 stable pseudonym, `HUMAN`, independence attestation, reviewed commit, input/config/result/
packet hash와 R01–R20의 판단을 모두 넣는다. Historical v0.2.0 packet이나 rejected v0.3.0 packet을 대신
사용하지 않는다. Timeout, malformed output과 ABSTAIN을 삭제하거나 성공으로 바꾸지 않는다.
`pnpm m2:validate`는 Git `HEAD`에 추적된 제출·live result·public packet을 현재 redacted input,
input hash, 순서가 고정된 20개 ID, 그리고 선택된 M2 실행 증거의 단일 source commit과 대조한다.
다만 자동 검사는 사람이 실제로 독립 검수했다는 사실 자체를 만들어 내거나 대신 증명하지 않는다.

## 6. Phase freeze — #27, candidate A에서 freeze B까지

### 6.1 Candidate A

A에는 v0.4.0 execution evidence, synthetic reference disagreement 0, 두 #24 submission,
adjudication, 완료된 M2 bundle, live baseline과 모든 동결 대상 구현이 들어 있어야 한다. 다음 명령이
clean A에서 통과해야 한다.

```powershell
pnpm check
pnpm contracts:format:check
pnpm contracts:test
pnpm schema:check
pnpm benchmark:check
pnpm evaluation:cases:check
pnpm m2:reviews --require-complete
pnpm m2:validate --check
pnpm evaluation:validate-inputs
```

### 6.2 사람의 exact-20 dry run

먼저 clean candidate A에서 새 append-only output 이름으로 secret/network-free machine dry run을 실행한다.
이 명령은 template에 선등록된 정확한 20개를 재생하며 `NONE`, `GUARD_MODE`, `PER_CALL_POLICY`,
`INTENTLOCK`의 실제 offline deterministic evaluation 경로를 사용한다. API key와 RPC를 읽지 않으며
`LLM_VERIFIER`는 이 deterministic dry run의 대상이 아니다.

```powershell
pnpm evaluation:freeze:dry-run --run-id=freeze-a-reviewer-b-01 --out=experiments/results/freeze-dry-runs/freeze-a-reviewer-b-01
```

출력은 기존 directory를 덮어쓰지 않는다.

- `manifest.json`: candidate commit/tree, clean-state 확인, config/case-manifest/template hash, exact 20 IDs
- `cases.jsonl`: 20개 case별 네 deterministic system의 raw replay와 IntentLock-oracle machine match
- `summary.json`: machine match/mismatch/failure 집계와 `humanReviewStatus: NOT_PERFORMED`
- console의 `reviewBindingToCopyWithoutChangingHumanFields`: 위 세 파일의 SHA-256, direct-child
  output path/run ID, candidate commit/tree

Machine `MATCH`는 사람의 `MATCHED_EXPECTATION`, 재현, 독립성 또는 승인으로 변환되지 않는다. Mismatch나
failure가 하나라도 있으면 먼저 candidate 구현/expectation을 조사하고 새 A에서 새 output으로 다시
실행한다. 이 경우 command는 진단 evidence를 보존한 뒤 nonzero로 종료하며, 해당 output이나 candidate를
승인해서는 안 된다. 모두 match여도 Reviewer B가 case 입력, 결과와 scope를 직접 확인하기 전에는 #27이
`PENDING`이다.

그 뒤 Reviewer B만 다음 template을 별도 human record로 복사한다. Freeze command를 실행할 때 이 JSON과
결속된 `manifest.json`, `cases.jsonl`, `summary.json`만 untracked여야 한다. 이 세 machine output은
human record를 대신하지 않지만 freeze에서 다시 검증되고 B에 함께 track된다. 해당 output directory를
삭제·이동·수정하지 않는다. `--out`의 마지막 directory 이름은 `--run-id`와 같아야 한다.

```powershell
Copy-Item experiments/configs/freeze-review.template.json experiments/reviews/freeze-review.reviewer-b.json
(Get-Content experiments/configs/freeze-review.template.json -Raw | ConvertFrom-Json).reviewedCaseIds
```

입력은 다음과 같다.

- `experiments/configs/freeze-review.template.json`에 선등록된 정확한 20 case ID
- `experiments/configs/case-manifest.json`
- 각 ID가 가리키는 `benchmark/scenarios/base/**`와 generated mutation
- `experiments/configs/frozen-eval.yaml`
- `experiments/configs/ablations/manifest.json`
- `experiments/configs/m2-validation.json`
- 해당 A의 평가·metric·retry 구현과 테스트

각 case는 `reproduced: true`, `MATCHED_EXPECTATION`, case별 실제 notes가 있어야 하며 하나라도 불일치나
불충분이면 freeze하지 않는다. `reviewedCommit`은 A, `dryRunCases`는 20, 모든 `checks`는 실제 확인 후에만
true로 바꾼다. `dryRunEvidence`에는 dry-run 명령이 출력한
`reviewBindingToCopyWithoutChangingHumanFields` 객체를 그대로 복사한다. 이 객체는 machine provenance일
뿐이며 reviewer pseudonym, attestation, case 판단, notes, checks 또는 `APPROVED`를 채워 주지 않는다.

전용 CLI, `evaluation:cases:check`, unit test 또는 template 숫자만으로 `reproduced: true`, case notes,
checks나 `APPROVED`를 자동 생성해서는 안 된다. Machine output의 commit과 세 source hash를 대조하고
`cases.jsonl`의 해당 행을 case별로 검토한 뒤, Reviewer B가 자기 판단과 실제 notes를 human JSON에
직접 기록한다. Freeze 명령은 review에 적힌 path의 `manifest.json`, `cases.jsonl`, `summary.json`을
재해시·strict parse하고, candidate commit/tree와 source hashes, ordered exact-20, blocker 없는 machine
결과와 human rows의 1:1 일치를 모두 확인한다. 이 SHA-256/Git provenance를 외부 서명으로 표현하지 않는다.

### 6.3 Freeze와 B 검증

실제 review가 끝난 경우에만 실행한다.

```powershell
pnpm evaluation:freeze --review-record=experiments/reviews/freeze-review.reviewer-b.json
```

그 뒤 A의 직접 자식 commit B에는 다음 6개 경로만 있어야 한다.

1. `experiments/reviews/freeze-review.reviewer-b.json`
2. `experiments/results/freeze-dry-runs/<run-id>/manifest.json`
3. `experiments/results/freeze-dry-runs/<run-id>/cases.jsonl`
4. `experiments/results/freeze-dry-runs/<run-id>/summary.json`
5. `experiments/configs/frozen-eval.yaml`
6. `experiments/configs/ablations/manifest.json`

```powershell
git diff-tree --no-commit-id --name-only --no-renames -r HEAD
git rev-list --parents -n 1 HEAD
pnpm evaluation:validate-inputs
```

6개 경로 외 변경, A가 아닌 `reviewedCommit`, review와 다른 dry-run directory, self-review를
independent review로 기록한 경우에는 B를 유효한 freeze commit으로 사용하지 않는다. Downstream
runner는 B에 tracked된 세 machine artifact를 다시 읽어 SHA-256, strict schema, regenerated candidate-A
scenario와 exact-20 결과를 검증한다.

## 7. Phase M3 — #28–#31

### 7.1 #28 primary 400 × 5 run

Clean B에서 all-five primary run을 시작한다. `attempt 1`이 intention-to-treat 결과이며 성공한 retry가
이를 대체하지 않는다.

```powershell
pnpm evaluation:run --run-id=primary-v0.4.0-01 --concurrency=4 --retry-failures
```

필수 출력은 다음 네 파일이다.

- `experiments/results/primary-v0.4.0-01/manifest.json`
- `experiments/results/primary-v0.4.0-01/raw.jsonl`
- `experiments/results/primary-v0.4.0-01/summary.json`
- `experiments/results/primary-v0.4.0-01/summary.csv`

2,000개의 attempt-1 조합이 모두 존재하고 실패·timeout도 분모에 남아 있어야 한다. 네 파일을
force-add해 primary artifact commit C로 보존한 뒤에 adaptive와 ablation을 실행한다.

Reviewer B는 400 case ID를 정렬한 뒤 0-based index가 10의 배수인 40개를 사전 sample로 선택하고,
그 40개에 대한 다섯 시스템의 attempt-1 총 200개 record를 raw에서 재계산한다. M3 bundle에는 sample
규칙, 40 ID, 각 시스템의 numerator/denominator, failure/timeout, 확인 요청과 first-detection ordinal,
summary와의 차이를 적는다. 결과를 본 뒤 유리한 sample로 바꾸지 않는다.

### 7.2 #30 ablation config diff를 실행 전에 검수한다

Reviewer B는 아래 입력을 full arm과 각 arm 사이에서 대조한다.

- `experiments/configs/ablations/manifest.json`
- `src/experiments/ablations.ts`
- `src/experiments/sequential-symbolic.ts`
- `test/experiments/ablations.test.ts`
- primary manifest와 case manifest

```powershell
pnpm vitest run test/experiments/ablations.test.ts test/experiments/case-matrix.test.ts
```

M3 bundle에 arm 이름, 변경된 factor, 의도하지 않은 차이, seed/case/oracle 동일성, causal
one-factor인지 descriptive stage comparison인지 기록한다. `semantic-only`, `symbolic-only`, `hybrid`는
인과 ablation으로 승인하지 않는다. 이 review가 `PENDING`이면 ablation 결과를 component causal
claim에 쓰지 않는다.

### 7.3 #29 adaptive 40과 사람 재현 10

Primary artifact가 commit C에 tracked된 clean descendant에서 실행한다.

```powershell
pnpm evaluation:adaptive --primary-run-id=primary-v0.4.0-01 --run-id=adaptive-v0.4.0-01
```

필수 출력은 `manifest.json`, `episodes.jsonl`, `comparison.json`, `summary.json`,
`human-review-10.packet.json`이다. Reviewer B는 packet의 정확한 10개 entry를 committed input과 기록된
seed로 다시 실행·검사하고 다음을 M3 bundle에 기록한다.

- public transcript와 signer invocation 일치 여부
- 독립 structural original-intent verdict 일치 여부
- `ATTACK_SUCCESS`, `SAFE_BLOCK`, `NORMAL_FAILURE`, `INCONCLUSIVE` 구분
- 비밀·실주소·reviewer answer 누출 여부
- model-adaptive, fork execution, post-state 또는 production MetaMask 증거로 잘못 표현한 문구 유무

현재 runner는 PENDING packet만 만들고 human submission schema/checker는 제공하지 않는다. 10건의 실제
사람 기록이 없으면 #29는 닫지 않는다.

### 7.4 #30 ablation 실행과 #31 분석

```powershell
pnpm evaluation:ablations --primary-run-id=primary-v0.4.0-01 --run-id=primary-v0.4.0-01-ablations
pnpm evaluation:adaptive --primary-run-id=primary-v0.4.0-01 --run-id=adaptive-v0.4.0-01

# 두 secondary run의 manifest/raw/summary/comparison/review packet을 force-add해 먼저 commit한다.
pnpm evaluation:analyze --run-id=primary-v0.4.0-01 --ablation-run-id=primary-v0.4.0-01-ablations --adaptive-run-id=adaptive-v0.4.0-01
```

분석 명령은 clean HEAD에 primary·ablation·adaptive 입력이 모두 tracked되어 있지 않으면 거부한다.
`--validate-inputs`는 candidate/missing 상태를 결과 생성 없이 점검하는 유일한 예외다. 한 번의 분석
명령은 최소 다음을 함께 다시 만든다.

- `paper/tables/results.md`
- `paper/tables/results.csv`
- `paper/tables/ablations.{md,csv,json}`
- `paper/tables/adaptive.{md,csv,json}`
- `paper/tables/results.metadata.json`
- `figures/security-utility.svg`
- `figures/error-taxonomy.svg`
- `figures/latency.svg`
- `figures/architecture.svg`

`results.metadata.json`에는 세 run의 raw/manifest/summary hash와 A(검토 source)·B(freeze)·각
execution commit 계보가 기록된다. Stage comparison에는 paired causal estimate를 만들지 않고,
one-factor runtime ablation 세 개에만 full arm 대비 paired interval을 기록한다. Always-confirm은 별도
policy variant이며, adaptive 표는 `NON_PAIRED_NON_CAUSAL`·
`OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY` 범위만 허용한다.

Reviewer B는 #28의 40-case 재계산에서 핵심 수치 다섯 개를 골라 raw attempt에서 분자·분모·run ID를
끝까지 추적한다. 최소 다섯 수치는 offline counterfactual unsafe authorization, benign completion,
false deny, escalation/confirmation burden, detection ordinal 또는 latency 중 결과 표에 실제 사용한
값이어야 한다. 서로 다른 chain/asset atomic amount를 합산하지 않았는지와 bootstrap group이
base-intent인지도 확인한다. 이 한 기록은 #28 10% 재계산, #31 sample metric, #34 five-number trace를
중복 없이 함께 증명할 수 있다.

검토가 끝난 최종 서술에는 `paper/README.md`의 9개 assembly slot을 각각 한 번 두고 다음 명령으로
표·그림을 연결한다. 이 단계는 9개 표 파일·4개 SVG·metadata를 모두 hash하고, primary 2,000건,
ablation 3,200건, adaptive 40건과 제한된 claim scope가 일치하지 않으면 거부한다.

```powershell
pnpm paper:assemble --source=paper/final-source.md
```

생성되는 `artifacts/submission-manifest.json`의 `humanGates`는 자동으로 완료되지 않는다.

## 8. Phase M4 — #32–#35

### 8.1 결과 삽입 후 Reviewer B의 단일 M4 bundle

Raw run과 생성 표·그림을 commit한 뒤에만 결과 placeholder를 교체한다. Reviewer B는 하나의 M4 bundle에
다음 네 section을 독립적으로 작성한다.

| Section             | Issue    | 입력                                                                                                  | 사람 산출물                                                                         |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| H1 novelty          | #32      | `paper/claim-to-citation.md`, `docs/related-work-matrix.md`, `paper/draft-intro-related.md`, 1차 출처 | strongest objection, missing nearest work, 좁힐 claim, accept/revise/reject         |
| H2 guarantee        | #33      | `paper/draft-method.md`, transition/ledger/signer 코드와 test                                         | concurrency·retry·unsupported-effect 반례 최소 1개, 보장 문구 판정                  |
| H3 five-number      | #31, #34 | final table, primary raw, analysis output, metric definition                                          | 다섯 수치의 numerator, denominator, run ID, 독립 재계산과 차이                      |
| H4 MetaMask wording | #34      | `paper/metamask-recommendations.md`, 공식 문서, Guard emulator review                                 | public fact/inference/proposal 구분, production-equivalence·vulnerability 문구 판정 |

각 section은 `status`, reviewer, reviewed commit, input hashes, review time, 판정, 가장 강한 반대 이유,
author adjudication과 resulting diff를 갖는다. 작성자가 결과를 고친 뒤 Reviewer B가 diff를 다시 보고
accept하기 전까지 상태는 `PENDING`이다.

최종 원고에는 결과 artifact가 없는 수치와 다음 placeholder가 없어야 한다.

```powershell
rg -n "RESULT_PLACEHOLDER|\[결과 삽입\]|TODO|TBD|PENDING" paper/final.md
```

검색 결과가 있으면 삭제하는 대신 evidence로 교체하거나 그 claim 전체를 제거한다.

### 8.2 #35 자동 감사와 두 사람의 private 최종 검수

실명·이메일·GitHub ID·학교·동아리·주소 등 private forbidden terms는 저장소 밖
`<PRIVATE_REVIEW_DIR>/forbidden-terms.txt`에 한 줄씩 둔다. 파일 내용과 실제 위치를 commit하지 않는다.

```powershell
pnpm submission:audit --file=paper/final.md --forbidden-terms-file=<PRIVATE_REVIEW_DIR>/forbidden-terms.txt
Get-FileHash -Algorithm SHA256 paper/final.md
```

공식 안내의 분량은 `13,000단어`이며 로컬 Unicode token count는 Notion 단어 수의 근사 경고다. 두
Reviewer 모두 Notion 우측 상단의 실제 단어 수를 별도로 확인한다. 실제 Notion export에 필수 신규
대회용 EVM 주소가 포함된 상태로 감사를 실행한다면 그 주소만 저장소 밖 파일로 전달한다.

```powershell
pnpm submission:audit --file=<PRIVATE_NOTION_EXPORT> --forbidden-terms-file=<PRIVATE_REVIEW_DIR>/forbidden-terms.txt --allowed-evm-address-file=<PRIVATE_REVIEW_DIR>/contest-address.txt
```

allowlist에 없는 전체 EVM 주소는 계속 review failure다. 주소 값이나 match 내용은 감사 출력에 나타나지
않는다.

Reviewer A와 B는 `artifacts/submission-checklist.md`를 각각 저장소 밖으로 복사해 서로의 체크를 보지
않고 작성한다.

- `<PRIVATE_REVIEW_DIR>/submission-checklist.reviewer-a.md`
- `<PRIVATE_REVIEW_DIR>/submission-checklist.reviewer-b.md`

두 사람 모두 실제 Notion preview, 로그아웃 링크 열기, 댓글 권한, 금지 형식, 수치·인용 대조를 한다.
Notion URL, 팀 정보, 운영진 메시지, 화면 캡처와 실제 제출 시각은 private checklist에만 둔다. 두
checklist가 끝난 뒤 서로 비교하고 불일치를 해결한다. 최종 hash와 제출 시각도 private 기록에 남긴다.
자동 audit 통과만으로 Notion 확인이나 두 사람의 독립 검수를 대체할 수 없다.

## 9. Issue close 순서

| 닫는 시점            | Issue | 닫기 전에 가리킬 증거                                                   |
| -------------------- | ----- | ----------------------------------------------------------------------- |
| M2 gate 완료 후      | #20   | S01–S10 사람 판단, packet hash, adjudication                            |
| M2 gate 완료 후      | #21   | C01–C10 contract alignment, clean 40-path evidence                      |
| M2 gate 완료 후      | #22   | D11–D20 두 submission/adjudication, clean 40-path evidence              |
| M2 gate 완료 후      | #23   | M01–M20 staged pre-sign/terminal review와 adjudication                  |
| M2 gate 완료 후      | #24   | v0.4.0 80-path, synthetic disagreement 0, 두 사람 review, `m2Complete`  |
| M2 gate 완료 후      | #25   | source-to-rule 사람 review, emulator test, scope 문구                   |
| M2 gate 완료 후      | #26   | v0.4.0 live 20 raw/config, R01–R20 사람 rationale review                |
| Freeze B 후          | #27   | A를 가리키는 exact-20 human record와 정확한 세-file B                   |
| Primary + review 후  | #28   | 2,000 attempt-1 records와 40-case/200-record 재계산                     |
| Adaptive + review 후 | #29   | immutable 40 episodes와 사람 재현 10                                    |
| Ablation + review 후 | #30   | frozen arms, config diff review, complete raw results                   |
| Analysis + review 후 | #31   | 재생성 표·그림, uncertainty, five-number trace                          |
| M4 review 후         | #32   | H1 novelty objection과 author adjudication                              |
| M4 review 후         | #33   | H2 counterexample와 보장 문구 diff                                      |
| M4 review 후         | #34   | H3/H4, 결과·한계·권고의 raw/source 추적                                 |
| 실제 제출 감사 후    | #35   | audit 0 findings, 두 private checklist, Notion dry run, final hash/time |

Issue comment에는 실제 commit, run ID, input/output 경로, checker 결과와 남은 limitation만 적는다. 사람
gate가 없거나 미완료인데 `완료`, `approved`, `independent`라고 쓰지 않는다. 위 순서를 끝까지 지키면
자동화가 사람을 사칭하지 않으면서도 Reviewer B의 검수를 세 번의 bundle과 한 번의 private final
checklist로 모아 중복 작업을 최소화할 수 있다.
