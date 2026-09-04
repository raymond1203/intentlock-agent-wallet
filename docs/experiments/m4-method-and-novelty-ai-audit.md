# M4 method and novelty — AI-assisted adversarial audit

- Related issues: #32 (intro/related work), #33 (method/conditional guarantee).
- Reviewed on: 2026-09-05 KST; initial source commit `299b9f010cd4d0241cf4c7e7d9d4442365f9f708`.
- Reviewer: Codex AI method reviewer; role `AI`, mode `SOLO_AI_ASSISTED`.
- Source labels, implementation and author-written references were visible. This is not blinded
  or independent human review. Final author adjudication: **PENDING**.
- Scope: manuscript claims, selected implementation paths, counterexamples and primary-source
  comparison. This is not an exhaustive security audit or a new experiment result.
- Current result status: no frozen M3 performance results were available during this review.
  All nine assembly slots in `paper/final-source.md` remain result placeholders.

## 1. Decision and strongest objection

The narrow research question is defensible; a claim to invent financial-intent authorization,
stateful agent policies, runtime monitoring or capability enforcement is not. The current
manuscript's domain-instantiation framing is substantially safer than the original broad gap.
Accept the question for experimentation, with the revisions and implementation checks below;
do not treat this decision as acceptance of unmeasured effectiveness or final paper approval.

The strongest contrary evidence is **Authority–Inference Separation (AIS)**, published shortly
before this audit. Its control object is a typed financial action intent, bound to deterministic
authorization and execution evidence. It also separates execution from economic completion.
Its signed-token and adapter-binding design overlaps some of IntentLock's proposed deployment
extensions. Consequently, “financial semantic intent rather than tool permission” is not by
itself a unique gap. AIS must be included in the final related-work discussion, not hidden in a
future-work footnote. [Gong, Samawi and Medda, AIS v1, 2026-08-31](https://arxiv.org/abs/2608.30519v1).

The defensible contribution is the particular EVM multi-call effect model and explicit
allowance/outflow/completion distinctions, their implemented bounded monitor, and the separation
of authored counterfactual replay from pinned-fork base-path evidence. Whether the components
produce a useful security–utility difference remains an empirical question. More cases than
another paper, integer arithmetic alone, or renaming a reference monitor is not sufficient
novelty.

## 2. Primary-source claim mapping and contrary readings

All sources below were opened directly on 2026-09-05 KST. The full-text sections specified were
inspected selectively; this does not claim an exhaustive reading of every paper or its code.
No cross-paper performance ranking is inferred from their reported benchmark scores.

| Primary source and inspected scope                                                                                                                                             | Supported claim / strongest contrary interpretation                                                                                                                                                                                                                  | Manuscript consequence                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Task Shield v1](https://arxiv.org/abs/2412.16682v1), authors' abstract, 2024-12-21                                                                                            | Goal contribution checks operate at instructions and tool calls. Goal alignment is prior art.                                                                                                                                                                        | Describe a complementary economic-state specification; do not label the generic LLM verifier as Task Shield reproduction.                                          |
| [DRIFT v3](https://arxiv.org/abs/2506.12104v3), authors' abstract, revised 2026-03-26                                                                                          | Minimal function trajectory, parameter checklist, dynamic validation and injection isolation already address multi-step context.                                                                                                                                     | Reject “existing defenses are single-step” and “sequence awareness is new.”                                                                                        |
| [Progent v3](https://arxiv.org/html/2504.11703v3), §§4–6, revised 2026-05-14                                                                                                   | Deterministic symbolic policy and SMT-based narrowing/expansion already provide monotonic confinement subject to approvals.                                                                                                                                          | Compiler field checks are not a stronger general policy-comparison theorem. Per-call policy is our generic implementation, not measured Progent.                   |
| [AgentSpec v3](https://arxiv.org/html/2503.18666v3), §§2–3, revised 2025-07-31                                                                                                 | Predicate semantics can use a trajectory; triggers include state changes and agent finish, not just a stateless pre-call checkpoint.                                                                                                                                 | Remove any unqualified “AgentSpec is stateless” characterization. Wallet predicates could be hosted in a generic rule engine; the domain model is the distinction. |
| [CaMeL v2](https://arxiv.org/html/2503.18813v2), §§5.2, 9–10, revised 2025-06-24                                                                                               | Capability policies can be as expressive as Python. The discussion already considers composition of allowed control-flow gadgets and specification/context limitations.                                                                                              | Do not claim that capability policy inherently cannot represent economic constraints, or that allowed-gadget composition was first discovered here.                |
| [AgentArmor v3](https://arxiv.org/abs/2508.01249v3), authors' abstract, revised 2025-11-18                                                                                     | Structured runtime traces and program analysis are prior art.                                                                                                                                                                                                        | ActionIR's wallet-specific effects are a domain representation, not the first agent trace IR.                                                                      |
| [Formal Methods Meet LLMs v1](https://arxiv.org/html/2605.16198v1), §§3–4, 2026-05-15                                                                                          | LTL monitoring separates event labeling from temporal reasoning and uses a three-valued finite-trace interpretation.                                                                                                                                                 | Retain specification/labeling assumptions and distinguish safety prefixes from unfinished completion goals. Runtime monitoring itself is not novel.                |
| [ScopeGate v1](https://arxiv.org/html/2606.28679v1), §§II-C, V–VI, 2026                                                                                                        | A deterministic side-effect gate checks scope, concrete values, money ceilings and trusted idempotency context. It explicitly bounds its static/adaptive results.                                                                                                    | Add this close value-authorization work. The current paper cannot claim the first financial value gate or signer-side replay control.                              |
| [AIS v1](https://arxiv.org/html/2608.30519v1), §§3.4, 4.1–4.3, 7, 8.5, 2026-08-31                                                                                              | Typed financial intent, canonical-intent token binding, one-use authorization, execution evidence and withheld completion after delivery failure overlap directly. Its author-implemented deterministic fixture test excludes live-model and concurrency evaluation. | Cite as nearest conceptual work. Compare the bounded EVM effect/replay artifact, not superiority to AIS or institutional governance coverage.                      |
| [AgentDojo v3](https://arxiv.org/abs/2406.13352v3), authors' abstract, revised 2024-11-24                                                                                      | The environment supports tool-using tasks and adaptive attacks; it is not merely a static single-step test set.                                                                                                                                                      | Our authored trace experiment does not replace an end-to-end agent benchmark or establish unseen-agent generalization.                                             |
| [Real AI Agents with Fake Memories v3](https://arxiv.org/abs/2503.16248v3), authors' abstract, revised 2025-07-09                                                              | Web3 context/memory manipulation and unauthorized transfers are direct domain prior work.                                                                                                                                                                            | Do not claim to discover Web3 prompt-injection risk. Our script-generated traces do not measure an attacker's ability to induce a live model.                      |
| [MetaMask architecture](https://docs.metamask.io/agent-wallet/reference/architecture/), transaction and async sections                                                         | Public docs describe simulation/scanning, ERC-7821 batching with sequential fallback, and asynchronous signing jobs.                                                                                                                                                 | Use the product as a practical boundary example, not a deployment-equivalence claim.                                                                               |
| [MetaMask outflow policy](https://docs.metamask.io/agent-wallet/reference/outflow-policy/) and [trading modes](https://docs.metamask.io/agent-wallet/reference/trading-modes/) | Rolling outflow and approval are already stateful monetary controls. The documented signature exclusion concerns outflow accounting, not all security checks.                                                                                                        | Do not equate Permit2 exclusion with an exploitable production bypass. Emulator assumptions and STRICT/LITERAL sensitivity remain essential.                       |

Suggested citation-ready addition to §2:

> ScopeGate는 구체적인 인자·금액 한도·idempotency를 실행 전 결정론적으로 검사한다. AIS는
> 금융 의도를 독립 제어 계층의 대상으로 삼고, 정규화한 의도에 실행 권한을 결합하며 실행과
> 경제적 완료를 구분한다. 따라서 금융 의도의 구조화와 실행 경계 자체는 본 연구의 신규성이
> 아니다. 본 연구는 제한된 EVM 멀티 호출의 allowance·누적 유출·완료 상태를 표현하고,
> authored replay와 고정 포크의 기본 실행 증거를 분리하는 구체적 구현과 평가에 집중한다.

This is an AI proposed revision, not a claim that the author already adopted it. The comparisons
above describe the observed paper scopes, not impossibility results about what those frameworks
could be extended to support. No original implementations of these defenses were executed here.

## 3. Architecture-to-code correspondence

| Manuscript component                       | Inspected implementation                                                     | Implemented boundary and qualification                                                                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract and hash, §4.1                    | `src/domain/intent-contract.ts`, `intent-hash.ts`                            | Typed integer amounts, chain-specific bounds and final goals. The hash identifies the represented contract, not the truth of user consent.                                                                                           |
| Compiler, §4.1                             | `src/intent/compiler.ts`                                                     | Receives an extractor-produced candidate; checks schema, trusted-text substring evidence and selected widening fields. No general taint tracking, semantic entailment or complete widening proof.                                    |
| Effect representation, §4.2                | `src/domain/action-ir.ts`, `src/effects/batch-decoder.ts`, protocol decoders | Recursive supported calldata decoding with depth/call/size guards. Codehash requirements depend on supplied decoder configuration. Unknown semantics can produce incomplete results; arbitrary bytecode is not analyzed.             |
| Offline sequence monitor, §4.3             | `src/experiments/sequential-symbolic.ts`, `src/monitor/monitor.ts`           | Ordered authored effects and an ALLOWed-prefix array. Repeated-sequence detection is trace-structural; it does not execute or explore distributed schedules.                                                                         |
| Adapter pre-sign boundary, §4.4            | `src/adapters/metamask/adapter.ts`                                           | Decode and monitor precede reservation and executor invocation. A caller-input snapshot is required to make the checked payload stable across the awaited reservation; see C3. There is no externally verifiable one-use capability. |
| Reservation, §4.4                          | `src/monitor/ledger.ts`, `reservation.ts`                                    | A shared in-memory promise gate serializes reservation operations. Stored resource dimensions are gross outflow, allowance exposure and gas, not every possible invariant. Restart/distributed atomicity is not supplied.            |
| Actual wallet integration, §4.4            | `src/adapters/metamask/cli.ts`                                               | Argument-array CLI wrapper; host-supplied receipt parser remains trusted. This is not a full deployed MetaMask backend, independent receipt attestation or observed user consent.                                                    |
| Receipt and completion, §4.5               | `src/effects/types.ts`, adapter, `src/oracle/post-state-oracle.ts`           | Adapter compares an economic multiset and caller-provided goal checks. Fork oracle uses explicit state/ordered event evidence. Multiset equality alone does not prove intermediate ordering or prevent an irreversible mismatch.     |
| Main measurement, §5                       | `src/experiments/evaluate-case.ts`, `sequential-symbolic.ts`                 | Five local systems evaluate the same authored effects; no actual 400-case on-chain attack execution. Post-state input is labeled `EXPECTED_FIXTURE`.                                                                                 |
| Scripted signer-boundary measurement, §5.4 | `src/experiments/adaptive.ts`, adapter                                       | Different corpus, deterministic scripts, fake executor and structural oracle. A separately implemented oracle can still share arithmetic/representation errors; see C1/C2.                                                           |

The architecture figure initially contained three misleading labels: “taint-aware extraction,”
“Atomic ledger,” and “mismatch freezes follow-up signing.” The revised source separates the optional
compiler, authored offline replay and adapter implementation. It now explicitly describes supplied
evidence rather than verified taint, a single-process in-memory reservation gate, and no global
follow-up freeze. This audit checked the source labels, not the rendered SVG geometry.

## 4. Conditional argument: what can actually be claimed

Let `C` be the confirmed represented contract, `S` the accumulated resource state including valid
pending reservations, `e` a conservative candidate-effect abstraction, `Inv(C)` the safety region,
and `Goal(C,S)` the separate terminal predicate. A sound reference transition is:

1. The safety predicate is correctly implemented and checks `S ⊕ e ∈ Inv(C)`.
2. Checking and reserving use one shared serialized state; the reserved effect bounds the actual
   effect in each relevant safety dimension.
3. Only the checked immutable payload reaches the signer; every relevant signing path is mediated.
4. Settlement does not prematurely free uncertain effects or replay an already-used execution.

If the initial state satisfies `Inv(C)`, these premises imply prefix preservation by induction:
the next admitted reservation fits the region; actual execution stays within that reservation;
the induction hypothesis then applies to the next request. Scope predicates, exposure peaks and
debt cannot be silently reduced to net token balance. Completion is checked separately and is not
implied by preserved safety bounds.

This is a conditional argument for an abstract transition, not a mechanized proof or proof that
all implementation premises hold. In particular, the correctness of the predicate implementation
must be explicit: sound decoding alone cannot save incorrect rounding or aggregation. The
adapter's current reservation schema does not establish a concurrent debt ledger or a durable
cross-service linearization point. The manuscript must not upgrade its serial replay evidence
into that stronger theorem.

## 5. Concrete counterexamples and disposition

These examples are deliberately small proof challenges. Unless a linked regression execution is
recorded in §7, they are source/arithmetic analyses, not new live-chain experiments or measured
attack rates. They must not be appended to the frozen dataset to improve an observed score.

### C1 — Fractional-basis-point rounding

For quote `10001`, minimum output `9900`, and cap `100` basis points, flooring
`(10001 - 9900) * 10000 / 10001` returns `100`; the exact loss exceeds one percent. The required
minimum is `9901`. The initial monitor and scripted structural oracle used the floor test.
Resolution required: exact integer cross multiplication and tests just below, at and above the
boundary in both implementations. This challenges predicate correctness, not the induction rule.

### C2 — Approval overwrite is not total or peak exposure

Two allowed spenders with `60` units each leave `120` aggregate exposure, even though an asset-key
last-write map returns `60`. Conversely, repeated approval to the same spender replaces that
spender's amount and must not be blindly summed. A candidate containing approval `101` followed by
revoke `0` also shows why terminal exposure and the maximum exposure of relevant prefixes differ.
The initial ActionIR aggregate used an asset-key last write; the scripted oracle used a maximum
per asset, while terminal post-state observations sum counterparties. Resolution required:
spender-aware state and an explicit prefix-peak policy, with legitimate replacement/revoke
controls. Existing allowance not represented in the input still requires trustworthy state
evidence; fixing aggregation is not arbitrary on-chain allowance discovery.

### C3 — Mutable request between check and use

The initial adapter read `request.action` for decode, awaited `ledger.reserve`, then read the same
caller-owned object for executor submission. A caller can change recipient calldata or chain
during the await. Equal method scope does not by itself imply equal payload. Resolution required:
snapshot caller-owned action, accepted effects, simulation effects and time before the first
await, with a controlled mutation regression and a normal execution control. This is an
in-process API boundary defect, not evidence of a MetaMask production vulnerability.

### C4 — One adapter call per contract; batch is not a multi-request session

The adapter passes `contract.idempotencyKey` unchanged into every reservation. A second separate
transaction with the same contract receives `DUPLICATE`, even if it is the intended next step.
The lower-level ledger accepts caller-provided execution keys, but the adapter does not expose an
action-key/session protocol. Changing the contract to obtain another key changes the intent hash
and is not proof of a shared budget session. Keep this as an explicit prototype limitation:
multi-call work can be one supported batch, and the primary sequential replay is a different
evaluation path. No redesign is required to report that limited experiment honestly.

### C5 — Trusted substring and incomplete widening checks

An extractor can cite a genuine substring without proving that the candidate value follows from
it. Replacing a final goal with a weaker same-length goal list is not detected by a check that
only detects fewer goals. The inspected compiler does not claim an SMT inclusion proof, and the
main experiment starts after contract authoring. Keep contract fidelity and complete semantic
widening outside the established guarantee; do not claim that an evidence tag itself prevents
all authority expansion. The correct deployment response is a separately verified confirmation
and policy-change procedure, not retroactive fabricated approval.

### C6 — Post-state detection does not undo a transfer

If the simulation predicts a permitted transfer of `10` but execution sends `11`, a later mismatch
can be recorded as `VIOLATED`; it cannot restore the prior prefix's safety. Current code retains
observed resource amounts, but does not globally freeze every subsequent account request. Scope
is also important: a multiset comparison cannot distinguish every harmful reordering with the
same terminal multiset. Preserve these as observation/enforcement assumptions and recovery work.

### C7 — Process-local serialization does not survive missing shared state

Two independently constructed ledgers can each reserve `60` against a `100` limit. A restart with
an empty ledger likewise loses prior budget. This does not contradict the single-instance test;
it demonstrates why durable shared state and complete signer mediation are premises, not inferred
deployment properties. Pending debt is not stored in `ReservationAmounts`; do not broaden the
resource-reservation argument to concurrent debt without another implementation and test.

## 6. Freeze and manuscript acceptance checks

- C1–C3 affect implemented pre-sign boundaries and should be resolved and regression-tested before
  candidate A is selected. Their changes require a fresh implementation digest, not modifying
  previously collected M2 raw bytes or declaring a new fork result.
- Include AIS and ScopeGate in final related work; retain AgentSpec's trajectory/finish semantics
  and CaMeL's expressive-policy scope. Generic measured baselines remain generic.
- Correct the generated architecture labels and disclose C4–C7 alongside the conditional proof.
- Treat ADR 0004 and the original related-work matrix's broader capability, six-baseline and
  actual-post-state-primary language as historical design intent. Current manuscript/evaluation
  scope takes precedence; add an explicit supersession notice where readers might be misled.
- M3 must still produce and audit real primary/secondary records before the result slots become
  performance claims. An AI review of method does not satisfy those evidence dependencies.
- Final author review and submission remain pending. The reviewer acceptance clauses in #32/#33
  should identify this actual AI review under ADR 0011, not invent another human sign-off.

## 7. Verification record and remaining gates

Read-back at 2026-09-05 08:26 KST confirmed the following candidate changes:

- C1: monitor and scripted structural oracle use exact integer comparisons. Boundary tests include
  fractional-bps overflow and the rounded-up minimum.
- C2: ActionIR and scripted structural oracle track amounts per spender, sum concurrent spender
  exposures and preserve the maximum across represented prefixes. Tests cover distinct spenders,
  replacement and revoke. Missing starting-state observations remain outside this correction.
- C3: adapter snapshots action fields and primitive request metadata, parses a detached contract,
  and deep-clones accepted/simulation effects before the first await. Decoder options are consumed
  synchronously and not reread later. Public request shape and one-call idempotency remain unchanged.
- Figure: source labels now match the three separate implementation/evaluation scopes above.

Source bytes reviewed in that read-back (SHA-256; subsequent edits require another check):

| File                                     | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `src/monitor/monitor.ts`                 | `bae6a82c926e1be1dddee09fac772995694f8fcc7a08931035f8c29c3b14415c` |
| `src/domain/action-ir.ts`                | `3e0390f5e0f42bb1e5f7923482996dc7d9c3530dbadfa3d5f24b63220f37e069` |
| `src/experiments/adaptive.ts`            | `5a54deb08ac69ce5fedf44aaddddd500a9675f5e8e0d5ad4deefb2b840ee8e27` |
| `src/adapters/metamask/adapter.ts`       | `56453b090bb7f5706097432f6f3005cf2b60938c08e0555969689d3de7d87d14` |
| `test/adapters/metamask-adapter.test.ts` | `962d9157c49d5919abd7be2aa4350c5e5658f2b202afe3f61f3bae1cf7e7ddc1` |
| `src/experiments/figures.ts`             | `09e071a30fd83a5bdf4a6e2cddd0482bc4b4b7698ddd7a3a9186ebabf9089655` |

Focused validation actually performed by this reviewer:

1. Added the adapter regression before changing its implementation. Running
   `pnpm exec vitest run test/adapters/metamask-adapter.test.ts` produced **6 failures and 1 pass**:
   five action-mutation cases reached the executor with changed payload fields, nested effect/time
   mutation changed reconciliation, and the normal/idempotency control passed.
2. After the snapshot patch, scoped ESLint and formatting passed. The original six mutation
   failures no longer reproduced; normal execution and duplicate blocking remained intact.
3. Ran `pnpm exec vitest run test/monitor.test.ts test/action-ir.test.ts
test/experiments/adaptive.test.ts test/adapters/metamask-adapter.test.ts
test/monitor/concurrency.test.ts --maxWorkers=1`: **5 files, 90 tests passed**.
4. A separate fresh AI reviewer inspected the snapshot patch and direct boundary without receiving
   the patch rationale or passed-test claims; it found no concrete surviving caller-mutation path
   or regression. This remains AI review, not independent human approval.
5. The broader nearest adapter check initially had **52 passes and 1 failure** across four files:
   historical `G05-bounded-swap` expected ALLOW but the corrected policy returned DENY. This was
   reported for coordinating-task triage. Historical fixture/evidence bytes must not be silently
   changed to hide a stricter policy outcome. Full project checking is a separate remaining gate.

Thus the new local C1–C3 regressions are addressed, but complete freeze readiness still requires
the historical-test disposition, full project checks, final citation/scope edits and a reviewed
dry run. C4–C7 are disclosed limitations, not claimed fixes. No claim is made that M3, M4 or
submission is complete, and author adjudication remains pending.

Discovery stopped after the eleven relevant primary papers and three MetaMask pages above covered
the claim families and exposed concrete nearest-work overlap. Three bounded searches targeted
agent-wallet cumulative authorization, wallet-intent guardrails and economic authorization
budgets; the materially new finding was AIS. Blogs, forum posts and search snippets were not used
as support. This is a targeted contrary-evidence review, not a claim of exhaustive novelty search.
