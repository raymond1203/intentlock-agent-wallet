# Claim-to-citation register

> 상태: M4 원고용 근거 등록부. 2026-09-04에 아래 외부 1차 출처를 다시 열어 확인했다.
> 이 문서는 논문 원문·공식 문서가 직접 지지하는 범위와 프로젝트 실험으로 입증해야 할 범위를
> 분리한다. 현재 데이터 후보는 v0.4.0(80개 base intent, 400개 offline case)이며, v0.4.0 실행
> evidence와 독립 인간 검수는 아직 `PENDING`이다. 아직 생성되지 않은 M3 결과는 모두
> `RESULT_PLACEHOLDER`로 남기고 사람 검수 완료를 주장하지 않는다.

## 사용 규칙

주장 강도는 다음 네 단계로만 기록한다.

- **직접 사실:** 인용한 1차 출처가 해당 기능, 방법 또는 수치를 명시한다.
- **제한된 비교:** 출처가 각 시스템의 단위를 설명하지만, 차이는 본 연구가 정의한 비교 관점이다.
- **조건부 설계 주장:** 저장소 명세와 구현·테스트가 근거이며 전제 밖으로 확장할 수 없다.
- **실험 주장 대기:** 동결된 run ID, 원시 결과, 분석 산출물과 사람 검수가 모두 있어야 쓸 수 있다.

`최초`, `완전한 사용자 의도 증명`, `MetaMask production과 동등`, `production bypass`, `모든 EVM에
일반화`는 이 등록부에서 허용하지 않는다. 선행연구 부재는 유한한 검색으로 증명할 수 없으므로,
신규성은 “조사한 시스템과 비교할 때 남는 명세·평가 단위”로만 표현한다.

## 제출 원고용 Key Takeaways

1. 개별 호출·인자·계획을 검사하는 선행 방어가 이미 존재하므로, IntentLock의 연구 질문은
   `multi-step` 자체가 아니라 허용된 호출이 합쳐 만든 누적 EVM 경제 효과를 계약으로 제한하는 데
   있다.
2. 시스템의 보장 단위는 자연어 의도 전체가 아니라 사용자가 확인한 버전 고정 계약과 지원된
   decoder·simulator가 관찰한 효과다. 따라서 보장은 명시된 전제 아래의 조건부 prefix-safety다.
3. MetaMask Agent Wallet은 공개된 signer·simulation·policy·batch 경계를 가진 practical case다.
   Guard Mode emulator 결과를 MetaMask 서비스 성능이나 취약점으로 해석하지 않는다.
4. 보안·효용·비용 결론은 `RESULT_PLACEHOLDER:PRIMARY_RESULTS`이며, 동결된 평가 전에는 방향이나
   수치를 예고하지 않는다.

## A. MetaMask·Ethereum 공개 사실

| ID         | 원고에 허용되는 주장                                                                                                                          | Source title · URL                                                                                                                                                                                                                  | 원문이 직접 지지하는 내용                                                                                                                                                            | 강도와 제한                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| MM-ARCH-1  | Agent Wallet은 CLI/SDK를 통해 지갑 작업을 제공하며 server-wallet 경로는 비동기 signing 모델을 사용한다.                                       | [Architecture — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/architecture/)                                                                                                                    | `CLI and session`, `Wallet modes`, `Server-wallet async model` 절이 CLI/SDK 표면, server-wallet, polling ID와 승인 대기 상태를 설명한다.                                             | **직접 사실.** 공개 문서의 외부 구조만 말한다. TEE·backend 내부 구현을 검증했다는 뜻이 아니다.                             |
| MM-ARCH-2  | 공개 구조는 거래 전 simulation과 threat scanning을 설명한다.                                                                                  | [Architecture — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/architecture/)                                                                                                                    | `Transaction simulation`은 실행 전 revert·예상 밖 상태 변화를 노출한다고 하고, `Threat scanning`은 별도 검사·승인 흐름을 설명한다.                                                   | **직접 사실.** 스캐너의 탐지율, 내부 규칙, 모든 failure mode는 공개 문서만으로 알 수 없다.                                 |
| MM-ARCH-3  | eligible 경로에서 ERC-20 approval과 trade를 ERC-7821 `execute()`로 묶고, 불가능하면 sequential 제출로 되돌아간다고 문서화돼 있다.             | [Architecture — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/architecture/)                                                                                                                    | `ERC-7821 batch execution` 절이 atomic batch와 sequential fallback을 함께 명시한다.                                                                                                  | **직접 사실.** 어떤 계정·체인·거래가 eligible한지와 실제 backend 분기 로직은 추정하지 않는다.                              |
| MM-MODE-1  | Guard Mode 공개 정책에는 network, address, token-recipient allowlist와 rolling 24-hour outflow가 포함되고, 정책 밖 거래는 승인 흐름으로 간다. | [Trading modes — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/trading-modes/)                                                                                                                  | `Comparison` 표와 `How 2FA approval works` 절이 guardrail 네 종류와 정책 밖 거래의 승인 정지를 설명한다.                                                                             | **직접 사실.** 논문의 emulator는 문서 규칙 해석이며 서비스 재현물이 아니다.                                                |
| MM-OUT-1   | outflow는 서명 전 simulation되고, 확인된 거래가 rolling 24-hour 총액에 반영된다고 문서화돼 있다.                                              | [Outflow policy — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/outflow-policy/)                                                                                                                | `How outflow is calculated` 절이 signing 전 simulation과 confirmation 뒤 accounting을 설명한다.                                                                                      | **직접 사실.** 논문은 가격 산정·confirmation의 비공개 세부를 가정하지 않는다.                                              |
| MM-OUT-2   | 공식 문서는 backend 밖 제출, simulation 불가, Permit2 같은 signature를 outflow 추적의 알려진 한계로 적는다.                                   | [Outflow policy — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/outflow-policy/)                                                                                                                | `Limitations` 절이 backend 밖 거래의 부정확성, simulation 불가 시 allowlist 의존, 현재 signature 미포함을 각각 명시한다.                                                             | **직접 사실.** 이것을 production exploit 또는 fail-open 증거로 표현하면 안 된다.                                           |
| MM-CMD-1   | Agent Wallet 공개 CLI에는 raw transaction, EIP-712 typed-data signing, calldata decode와 pending request 조회 경계가 있다.                    | [Commands reference — MetaMask developer documentation](https://docs.metamask.io/agent-wallet/reference/commands/) · [Sign messages and transactions](https://docs.metamask.io/agent-wallet/guides/sign-messages-and-transactions/) | 명령 참조는 `sign-typed-data`, `send-transaction`, `decode`, `requests watch`를 제공하고, guide는 모르는 calldata를 decode·확인하라고 안내한다.                                      | **직접 사실.** IntentLock을 삽입할 비공개 hook이 존재한다는 뜻은 아니다. 공개 command 앞 adapter라는 연구 설계만 허용된다. |
| EIP-7821-1 | ERC-7821은 delegation을 위한 최소 batch executor interface로 atomic batch 준비를 표준화한다.                                                  | [ERC-7821: Minimal Batch Executor Interface](https://eips.ethereum.org/EIPS/eip-7821)                                                                                                                                               | Abstract와 Motivation은 표준화된 atomic batch interface와 EIP-7702 EOA batch 사용 동기를 설명한다.                                                                                   | **직접 사실.** 2026-09-04 현재 EIP 페이지 상태가 **Draft**이므로 완결된 표준이라고 쓰지 않는다.                            |
| PERMIT2-1  | Permit2 SignatureTransfer는 token·maximum amount·nonce·deadline을 서명하고, 실행 spender는 caller와 결합된다.                                 | [ISignatureTransfer.sol — Uniswap Permit2](https://github.com/Uniswap/permit2/blob/main/src/interfaces/ISignatureTransfer.sol)                                                                                                      | interface의 `TokenPermissions`, `PermitTransferFrom`과 주석은 amount, nonce, deadline을 정의하고, batch 구조 주석은 spender가 `msg.sender`임과 사용자가 spender를 서명함을 설명한다. | **직접 사실.** MetaMask가 이를 내부적으로 어떻게 검사하는지는 이 interface로 알 수 없다.                                   |

## B. 선행연구와 제한된 gap

| ID           | 원고에 허용되는 주장                                                                                                                                                                                                             | Source title · URL                                                                              | 원문이 직접 지지하는 내용                                                                                                      | 강도와 제한                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RW-TS        | Task Shield는 각 instruction과 tool call이 사용자 목표에 기여하는지 test-time에 검사한다.                                                                                                                                        | [The Task Shield, arXiv:2412.16682v1](https://arxiv.org/abs/2412.16682v1)                       | 초록은 모든 agent action의 목표 기여를 검증하는 task-alignment 방어와 AgentDojo 평가를 설명한다.                               | **직접 사실.** 이 방법이 EVM 누적 상태를 못 다룬다는 문장은 논문의 보편적 결함이 아니라 본 연구의 wallet-specific 비교 축이다.                                 |
| RW-DRIFT     | DRIFT는 최소 function trajectory, node별 parameter checklist, deviation validator와 memory injection isolation을 결합한다.                                                                                                       | [DRIFT, arXiv:2506.12104v3](https://arxiv.org/abs/2506.12104v3)                                 | 초록은 Secure Planner, JSON-schema-style checklist, Dynamic Validator, Injection Isolator를 명시한다.                          | **직접 사실.** 따라서 `기존 방어는 single-step뿐`이라는 문장은 금지한다.                                                                                       |
| RW-PROGENT   | Progent는 tool name과 arguments의 symbolic policy를 결정론적으로 검사하고 SMT로 narrowing과 expansion을 구분한다.                                                                                                                | [Progent, arXiv:2504.11703v3](https://arxiv.org/abs/2504.11703v3)                               | 초록은 per-tool symbolic rules, deterministic check, least privilege와 approval 없는 monotonic confinement을 설명한다.         | **직접 사실.** generic per-call policy와 wallet cumulative state를 서로 대체 관계로 과장하지 않는다.                                                           |
| RW-AGENTSPEC | AgentSpec은 trigger, predicate와 enforcement를 구조화하는 runtime DSL이다.                                                                                                                                                       | [AgentSpec, arXiv:2503.18666v3](https://arxiv.org/abs/2503.18666v3)                             | 초록은 lightweight DSL과 structured runtime constraints를 여러 domain에 적용했다고 설명한다.                                   | **직접 사실.** IntentLock이 최초 runtime rule system이라는 주장은 금지한다.                                                                                    |
| RW-CAMEL     | CaMeL은 trusted query에서 control/data flow를 추출하고 capability policy로 unauthorized data flow를 제한한다.                                                                                                                    | [Defeating Prompt Injections by Design, arXiv:2503.18813v2](https://arxiv.org/abs/2503.18813v2) | 초록은 untrusted data가 program flow에 영향을 주지 못하게 하고 tool-call capability로 data exfiltration을 제한한다고 설명한다. | **직접 사실.** `provable security`는 CaMeL이 명시한 모델과 AgentDojo 조건에 한정해 인용한다.                                                                   |
| RW-ARMOR     | AgentArmor는 runtime trace를 CFG/DFG/PDG 계열 graph IR로 바꾸고 type system으로 검사한다.                                                                                                                                        | [AgentArmor, arXiv:2508.01249v3](https://arxiv.org/abs/2508.01249v3)                            | 초록은 trace-as-program, graph constructor, property registry와 type system을 설명한다.                                        | **직접 사실.** trace·program analysis 자체를 IntentLock의 신규성으로 주장하지 않는다.                                                                          |
| RW-FORMAL    | temporally extended constraint를 LTL로 monitor하고 intervention하는 선행이 존재한다.                                                                                                                                             | [Formal Methods Meet LLMs, arXiv:2605.16198v1](https://arxiv.org/abs/2605.16198v1)              | 초록은 offline auditing, online monitoring, predictive/intervening monitor와 LTL 기반 temporal constraint 평가를 설명한다.     | **직접 사실.** IntentLock의 차이는 formal monitoring 일반이 아니라 wallet effect label과 contract 범위다.                                                      |
| RW-DOJO      | AgentDojo는 97개 realistic task와 629개 security test case를 가진 extensible tool environment다.                                                                                                                                 | [AgentDojo, arXiv:2406.13352v3](https://arxiv.org/abs/2406.13352v3)                             | 초록이 task·case 수와 email, e-banking, travel 예시를 직접 제시한다.                                                           | **직접 사실.** 모든 기존 benchmark를 static 또는 single-step으로 부르지 않는다.                                                                                |
| RW-ASB       | ASB는 여러 agent stage, 10 scenarios, 400개 초과 tools, 27 attack/defense types와 7 metrics를 포괄한다.                                                                                                                          | [Agent Security Bench, arXiv:2410.02644v4](https://arxiv.org/abs/2410.02644v4)                  | 초록이 범위와 개수를 명시하고 security–utility를 함께 평가하는 metric을 설명한다.                                              | **직접 사실.** finance scenario가 EVM post-state oracle과 동일하다고 보지 않는다.                                                                              |
| RW-AGENTDYN  | AgentDyn은 60개 open-ended task와 560개 injection case로 dynamic planning과 helpful third-party instruction을 평가한다.                                                                                                          | [AgentDyn, arXiv:2602.03117v3](https://arxiv.org/abs/2602.03117v3)                              | 초록이 Shopping/GitHub/Daily Life의 동적 benchmark와 over-defense 문제를 설명한다.                                             | **직접 사실.** IntentLock의 author-exposed split을 truly unseen dynamic benchmark처럼 표현하지 않는다.                                                         |
| RW-WEB3      | Web3 agent에서 prompt·memory·external context 조작이 unauthorized transfer와 protocol violation으로 이어질 수 있다는 직접 선행이 있다.                                                                                           | [Real AI Agents with Fake Memories, arXiv:2503.16248v3](https://arxiv.org/abs/2503.16248v3)     | 초록은 ElizaOS 사례, 150개 초과 blockchain task, 500개 초과 context-manipulation case와 해당 실패를 설명한다.                  | **직접 사실.** 동일 저자진의 밀접한 ePrint를 독립 증거 두 건으로 중복 집계하지 않는다.                                                                         |
| GAP-1        | 조사한 선행은 goal contribution, plan/checklist, tool-argument policy, control/data flow, runtime rule 또는 trace analysis를 중심 단위로 삼는다. IntentLock은 지원된 EVM 효과의 누적 contract/post-state를 중심 단위로 비교한다. | RW-TS~RW-WEB3와 [`docs/related-work-matrix.md`](../docs/related-work-matrix.md)                 | 각 원문의 명시적 enforcement unit과 저장소의 bounded survey를 대조한다.                                                        | **제한된 비교.** “관련 연구 전체에 없는 최초 개념”이 아니라, 여기에 열거한 시스템과 구체적 단위의 차이라고만 쓴다. 독립 novelty review 전에는 확정하지 않는다. |

## C. IntentLock 설계·보장 주장

| ID          | 원고에 허용되는 주장                                                                                                                                                    | 프로젝트 근거                                                                                                                                                                                            | 필요한 검증                                                                                                         | 강도와 제한                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| IL-DESIGN-1 | IntentLock은 사용자가 확인한 versioned Intent Contract, ActionIR, cumulative ledger, signer capability와 post-state verification으로 구성된다.                          | [`docs/threat-model.md`](../docs/threat-model.md), [`paper/draft-method.md`](draft-method.md), 구현 모듈                                                                                                 | schema·transition·signer-boundary test가 최종 commit에서 통과하고 구조도와 코드 경계가 일치해야 한다.               | **조건부 설계 주장.** 실제 MetaMask backend 통합 또는 production deployment 주장이 아니다.                            |
| IL-DESIGN-2 | Unsupported effect, ambiguity와 contract widening은 자동 ALLOW가 아니라 DENY 또는 ESCALATE로 간다.                                                                      | [`docs/decisions/0004-security-guarantee-boundary.md`](../docs/decisions/0004-security-guarantee-boundary.md), negative tests                                                                            | 모든 advertised decoder·unknown selector·typed-data·depth limit test와 outcome audit가 필요하다.                    | **조건부 설계 주장.** liveness나 낮은 false denial을 보장하지 않는다.                                                 |
| IL-SAFE-1   | 명세 충분성, decoder/simulator soundness, linearizable ledger와 우회 불가능 signer gate 아래 authorized prefix가 계약 invariant 안에 남는다는 귀납 argument를 제시한다. | [`docs/decisions/0004-security-guarantee-boundary.md`](../docs/decisions/0004-security-guarantee-boundary.md), [`paper/draft-method.md`](draft-method.md)                                                | invariant별 negative/property test, concurrency counterexample test, 독립 인간의 proof-sketch 반례 검토가 필요하다. | **조건부 설계 주장.** mechanized proof, natural-language intent proof 또는 end-to-end safety proof라고 부르지 않는다. |
| IL-CASE-1   | MetaMask Agent Wallet은 금전 상태 전이와 signer/policy 경계가 공개된 practical case study다.                                                                            | MM-ARCH-1~MM-CMD-1, [`docs/decisions/0002-competition-rules-and-deadline.md`](../docs/decisions/0002-competition-rules-and-deadline.md)                                                                  | 원고 전체에서 `case study`, `public-docs emulator` 표기를 확인한다.                                                 | **제한된 비교.** MetaMask 제품 보안 평가나 취약점 보고가 아니다.                                                      |
| IL-DATA-1   | v0.4.0 벤치마크는 두 fixed fork와 제한된 workflow·protocol 범위의 authored case다.                                                                                      | [`docs/decisions/0005-mvp-workflows-and-forks.md`](../docs/decisions/0005-mvp-workflows-and-forks.md), [`docs/decisions/0010-m2-v0.4-data-contract.md`](../docs/decisions/0010-m2-v0.4-data-contract.md) | version-matched clean execution evidence, manifest hashes와 review gate가 필요하다.                                 | **조건부 설계 주장.** `HIDDEN_TEST`는 author-exposed legacy name이며 unseen generalization evidence가 아니다.         |
| IL-ORACLE-1 | 주 평가는 LLM judge 대신 supported case의 exact integer post-state oracle을 사용한다.                                                                                   | [`docs/claim-to-evidence.md`](../docs/claim-to-evidence.md), oracle 구현·test                                                                                                                            | reference disagreement, insufficient evidence와 unsupported를 분모에서 제거하지 않는 audit가 필요하다.              | **조건부 설계 주장.** oracle 입력과 decoder가 sound하다는 전제가 남는다.                                              |

v0.2.0 진단 기록과 v0.3.0 데이터 계약은 역사적 provenance로 보존한다. 특히 폐기된 local v0.3.0 clean
replay는 swap batch 7건의 terminal finite allowance reference가 실제 소비 뒤에도 승인량을 남기는 결함을
진단했다. [`ADR 0010`](../docs/decisions/0010-m2-v0.4-data-contract.md)에 따라 이 replay와 파생 artifact는
시스템 성능 또는 M2 완료 evidence가 아니며, 현재 claim은 전량 재생성한 v0.4.0 evidence에만 연결한다.
80/400은 corpus 구성 수이지 완료된 실험 결과나 사람 검수 수가 아니다.

## D. 실험 결과 claim slots

아래 행은 최종 분석 산출물이 생기기 전에는 문장으로 바꾸지 않는다. 각 placeholder는 run ID,
dataset/config hash, 분자·분모, confidence interval과 원시 결과 경로를 함께 채워야 한다.

| ID              | 현재 허용 문구                       | 교체 조건                                                                                                                           | 실패 시 서술 축소                                                                                              |
| --------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| RES-RQ1         | `RESULT_PLACEHOLDER:RQ1_COMPOSITION` | 최소 3 workflow의 version-matched deterministic replay와 exact post-state evidence                                                  | synthetic-only면 “authored fixtures에서 관찰”로 제한한다.                                                      |
| RES-RQ2-OFFLINE | `RESULT_PLACEHOLDER:RQ2_OFFLINE_UAR` | 동일 case manifest의 5개 시스템 offline counterfactual unsafe-authorization rate, grouped-stratified 95% CI, 실패·timeout 포함 분모 | 실제 UER로 부르지 않으며 strongest baseline 대비 개선이 없으면 우월성 문구를 삭제하고 class별 차이만 보고한다. |
| RES-RQ2-UTILITY | `RESULT_PLACEHOLDER:RQ2_UTILITY`     | benign completion, false denial, ABSTAIN/escalation, confirmation burden                                                            | 보안과 utility를 분리하지 않고 함께 제시한다.                                                                  |
| RES-RQ3         | `RESULT_PLACEHOLDER:RQ3_ABLATION`    | matched-case ablation, arm config hash, 동일 oracle와 denominator                                                                   | 차이가 없거나 반대면 negative result로 그대로 보고한다.                                                        |
| RES-RQ4         | `RESULT_PLACEHOLDER:RQ4_SCRIPTED`    | deterministic attacker visibility·최대 3회 replan·selection manifest와 40개 offline signer-boundary 결과                            | model-adaptive, fork post-state 또는 unseen generalization으로 주장하지 않는다.                                |
| RES-COST        | `RESULT_PLACEHOLDER:COST`            | latency·token·RPC/call count 측정의 hardware/runtime 조건                                                                           | production overhead나 사용자 체감으로 외삽하지 않는다.                                                         |
| RES-MM          | `RESULT_PLACEHOLDER:GUARD_EMULATOR`  | STRICT primary와 LITERAL sensitivity, emulator version·assumption 공개                                                              | 결과는 emulator에만 귀속하고 MetaMask 서비스 점수로 쓰지 않는다.                                               |

## E. 독립 novelty adversarial review packet

이 절은 review를 수행했다고 표시하는 곳이 아니라, 저자가 아닌 사람이 제출할 반례 검토 양식이다.
완료 전 상태는 **PENDING HUMAN REVIEW**다.

### Reviewer에게 제공할 최소 자료

- 익명화된 Key Takeaways, 기여 3개와 GAP-1 문장
- 이 문서의 RW-TS~RW-WEB3 표와 고정된 원문 URL/version
- [`docs/related-work-matrix.md`](../docs/related-work-matrix.md)
- 금지 주장 목록과 IntentLock의 조건부 guarantee 문장
- 구현 baseline이 paper-faithful인지 adapted/generic인지 표시한 표

### 반대 관점 질문

1. IntentLock의 어떤 문장이 Task Shield, DRIFT, Progent, AgentSpec, CaMeL, AgentArmor 또는 formal
   monitor의 기여를 다시 포장한 것처럼 보이는가?
2. `누적 경제 효과`가 domain instantiation 이상의 연구 기여가 되려면 어떤 추가 명세·실험 증거가
   필요한가?
3. related-work 표에서 직접 비교하지 않은 가장 가까운 연구는 무엇인가? 발견한 후보의 1차 출처와
   겹치는 claim을 적어 달라.
4. 조건부 prefix-safety 문장이 decoder·simulator·contract·signer 전제를 충분히 가까운 위치에
   반복하는가? 반례 trace를 하나 제시해 달라.
5. MetaMask 공개 문서의 limitation을 production 약점으로 오해하게 만드는 문장이 있는가?
6. Guard Mode, LLM verifier와 per-call baseline을 원 시스템보다 약하게 만들어 이득을 얻는 설계가
   있는가?

### Human submission template

- Reviewer role: `PENDING`
- Review date: `PENDING`
- Sources independently opened: `PENDING`
- Strongest novelty objection: `PENDING`
- Counterexample or missing nearest work: `PENDING`
- Claim wording that must be narrowed: `PENDING`
- Accept / revise / reject the current gap statement: `PENDING`
- Author adjudication and resulting diff: `PENDING`

저자 본인의 재검토는 유용하지만 `independent review`로 세지 않는다. 이 양식의 빈칸을 자동 생성된
답으로 채우거나 review 완료로 표시하지 않는다.

## F. 최종 citation gate

- [ ] 모든 논문 URL의 arXiv version과 원고의 수치가 일치한다.
- [ ] accepted venue와 preprint를 구분했다.
- [ ] MetaMask 문서를 final freeze 날짜에 다시 열고 변경된 기능·문구를 반영했다.
- [ ] 공식 문서의 제품 claim과 우리의 emulator 가정을 같은 문장에 섞지 않았다.
- [ ] 각 `RESULT_PLACEHOLDER`가 생성된 evidence로 교체됐거나 결과 문장 전체가 삭제됐다.
- [ ] 독립 reviewer가 novelty objection을 제출했고, 저자 adjudication diff가 남아 있다.
- [ ] `first`, `production-equivalent`, `proves user intent`, `all protocols/models/chains` 표현이 없다.
