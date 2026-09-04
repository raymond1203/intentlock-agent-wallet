# Limitations and evidence-gate checklist

> 목적: M4 결과·한계 원고에서 누락되기 쉬운 위협, 분모, negative result와 사람 검수 의무를
> 최종 제출 전에 강제로 확인한다. 체크가 비어 있으면 해당 주장을 삭제하거나 더 좁게 써야 한다.
> 자동화 결과만으로 사람 검수 항목을 완료 처리하지 않는다.

## 상태 표기

- `[ ]` 미완료 또는 아직 증거가 연결되지 않음
- `[x]` 실제 증거의 run ID·hash·경로와 검수자가 기록된 경우에만 완료
- `N/A — 이유` 사전 등록 범위 밖인 경우만 사용

이 파일은 템플릿 상태로 배포한다. 현재 데이터 후보는 v0.4.0(80개 base intent, 400개 offline
case)이며 M3 수치는 없다. v0.4.0 M2 실행 evidence와 live LLM run은 수집됐지만 독립 인간 검수는
아직 `PENDING`이므로 모든 M3 결과 칸은 `RESULT_PLACEHOLDER`이고 사람 검수 완료를 주장하지 않는다.

## 1. 연구 동결과 provenance

- [ ] Dataset version, scenario manifest hash, case manifest hash와 생성 commit을 본문 또는 표 각주에
      연결했다.
- [ ] 평가 config hash, model snapshot, prompt version, random seed, timeout, retry budget을 run
      metadata에서 추적할 수 있다.
- [ ] Ethereum·Base block number/hash, contract address/codehash와 RPC evidence class를 기록했다.
- [ ] v0.2.0 diagnostic, 폐기된 local v0.3.0 clean replay와 v0.4.0 primary evidence를 별도
      version/run으로 유지하고, 이전 진단을 성능 수치에 섞지 않았다.
- [ ] 실험 대상 commit이 clean하고 결과 artifact가 같은 commit·dataset version을 가리킨다.
- [ ] `HIDDEN_TEST`가 author-exposed legacy split임을 본문에 밝히고 unseen/sealed 표현을 제거했다.
- [ ] pilot에서 변경한 threshold, mutation, metric 또는 workflow를 change log에 남기고 final 결과를 본
      뒤 바꾸지 않았다.
- [ ] 결과 이후 추가한 분석은 `exploratory`로 표시했다.

## 2. 벤치마크 구성 타당도

- [ ] 80개 base와 400개 offline case의 workflow·variant 분포가 생성 manifest와 정확히 일치한다.
- [ ] 같은 base의 정상·공격·drift case가 split과 bootstrap에서 같은 group으로 유지된다.
- [ ] mutation이 no-op이 아니며, 의도한 scope/budget/composition/drift class를 실제로 바꾼다.
- [ ] invalid calldata, unsupported decoder와 semantic-but-unsafe call을 같은 실패 범주로 합치지 않았다.
- [ ] PRE_SIGN에서 관찰 불가능한 stale-quote·partial-completion case를 모든 pre-sign 시스템에서 동일하게
      제외하거나 POST_STATE 전용으로 유지했다.
- [ ] authored fixture, expected fork effect, executed receipt/post-state와 human label을 서로 다른 evidence
      class로 유지했다.
- [ ] quote, slippage minimum, Permit2 spender, Aave rounding/interest buffer와 ordered-prefix funding이
      v0.4.0 data contract와 [`ADR 0010`](../docs/decisions/0010-m2-v0.4-data-contract.md)을 따른다.
- [ ] bridge destination fixture가 test relayer/attester라는 점과 production settlement·liveness를
      재현하지 않는다는 점을 본문에 적었다.
- [ ] 각 workflow의 supported ABI·function·codehash 범위를 appendix에 열거했다.
- [ ] synthetic-only 사례와 실제 fixed-fork 실행 사례를 표에서 구분했다.

## 3. Oracle과 outcome 타당도

- [ ] 400-case offline 지표를 실제 UER로 부르지 않고 counterfactual unsafe-authorization rate로
      표기한다. 분자는 guard가 승인한 authored trace의 exact-oracle violation만 포함한다.
- [ ] 실제 UER는 `EXECUTED_FORK` receipt/post-state evidence가 있는 episode에만 별도 계산한다.
- [ ] offline 지표와 실제 UER의 분모에는 각각 failure, timeout, unsupported와 missing evidence가 사전
      정의한 방식으로 남아 있다.
- [ ] DENY, ABSTAIN/ESCALATE, execution failure와 safe completion을 별도 outcome으로 유지한다.
- [ ] pre-sign detection과 post-state violation을 같은 숫자로 합치지 않는다.
- [ ] reference disagreement를 system error, benchmark-reference error, protocol semantics uncertainty로
      분류하고 임의로 정답을 선택하지 않는다.
- [ ] signed integer delta와 absolute balance를 혼동하지 않고, third-party public balance를 synthetic
      truth로 쓰지 않는다.
- [ ] allowance exposure, asset outflow, debt, recipient, ownership와 final asset을 서로 다른 invariant로
      추적한다.
- [ ] partial completion에서 이미 발생한 irreversible effect와 후속 동결을 recovery success로 부르지
      않는다.
- [ ] oracle implementation과 scenario reference를 독립 경로로 비교하거나, 독립성이 없는 부분을
      limitation으로 적었다.
- [ ] raw result 10건 이상을 수작업으로 receipt/post-state까지 역추적했다.

## 4. Baseline 공정성

- [ ] No defense, Guard Mode emulator, LLM verifier, per-call policy, IntentLock이 동일 case와 실행
      budget을 받는다.
- [ ] Guard Mode의 STRICT 해석을 primary, LITERAL 해석을 sensitivity로 분리했다.
- [ ] Guard Mode emulator에 없는 threat scanner, authentication, 2FA UX와 production valuation을
      구현했다고 쓰지 않는다.
- [ ] emulator의 per-asset integer limit이 공식 USD outflow의 approximation임을 적었다.
- [ ] LLM verifier의 model snapshot, prompt, temperature, timeout, retry와 malformed-output 처리를
      고정했다.
- [ ] generic LLM verifier를 Task Shield, DRIFT 또는 다른 paper-faithful implementation이라고 부르지
      않는다.
- [ ] per-call policy가 유지하지 않는 state를 명시하고, full IntentLock만 더 많은 oracle 정보를
      선행 입력받지 않는다.
- [ ] unsupported 기능은 자동 loss로 처리하지 않고 `unsupported`, `unsafe allow`, `abstain`을 구분한다.
- [ ] baseline별 입력 stage가 같고 POST_STATE 정보를 pre-sign baseline에 유출하지 않는다.
- [ ] baseline adapter의 약화·추가 기능과 원 논문의 보장 차이를 표에서 표시했다.

## 5. 통계와 결과 보고

- [ ] Primary metric과 utility metric을 사전 등록 문서와 같은 정의로 계산했다.
- [ ] 95% interval은 base-intent group 단위 stratified bootstrap 10,000회로 계산했다.
- [ ] 각 표에 numerator, denominator, point estimate, interval과 run ID가 있다.
- [ ] 소수점 반올림 전 원시 값과 표 값이 분석 스크립트에서 재생성된다.
- [ ] strongest baseline 선택 규칙이 결과를 본 뒤 바뀌지 않았다.
- [ ] 다중 비교 또는 attack-class 탐색 결과를 confirmatory primary result처럼 쓰지 않았다.
- [ ] effect size와 uncertainty를 함께 보고하고 p-value만으로 결론을 내리지 않았다.
- [ ] zero cell·small subgroup의 넓은 interval을 숨기지 않았다.
- [ ] timeout·retry·RPC failure의 시스템별 비율을 별도 표에 공개했다.
- [ ] latency, token, RPC call과 hardware/runtime 조건을 함께 기록했다.

### Result slots

- `RESULT_PLACEHOLDER:RQ1_COMPOSITION`
- `RESULT_PLACEHOLDER:RQ2_OFFLINE_UAR`
- `RESULT_PLACEHOLDER:RQ2_UTILITY`
- `RESULT_PLACEHOLDER:RQ3_ABLATION`
- `RESULT_PLACEHOLDER:RQ4_SCRIPTED`
- `RESULT_PLACEHOLDER:COST`
- `RESULT_PLACEHOLDER:GUARD_EMULATOR`

각 placeholder는 생성된 표·그림과 함께 교체하거나, 결과가 없으면 문단 전체를 삭제한다. 추정값,
예상 방향 또는 테스트 fixture 통과율로 대체하지 않는다.

## 6. Negative result와 오류 분석

- [ ] IntentLock이 strongest baseline보다 개선되지 않은 metric을 그대로 제시한다.
- [ ] false denial, escalation/confirmation burden과 benign completion 저하를 security gain과 같은 위치에
      둔다.
- [ ] 가장 불리한 workflow·attack class·chain·protocol 결과를 appendix로 숨기지 않는다.
- [ ] specification, extraction, enforcement, simulation/execution drift, protocol semantics, model output,
      operational failure를 별도 root cause로 분류한다.
- [ ] benchmark defect로 드러난 결과를 system performance로 재분류하지 않는다.
- [ ] 폐기된 local v0.3.0 clean replay가 진단한 swap batch 7건의 residual-allowance reference 결함과
      해당 run의 M2 evidence 부적격 판정을 공개했다.
- [ ] 결과에서 제외한 run/case의 개수, ID와 제외 이유를 공개한다.
- [ ] post-hoc fix 전후 결과를 덮어쓰지 않고 별도 version/run으로 보존한다.
- [ ] adaptive 결과를 `OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY`로 한정하고 model-adaptive/fork-post-state
      증거로 부르지 않는다.
- [ ] scripted attack 실패가 replan budget 부족인지 defense 효과인지 구분하며, mismatch와 post-state
      미관찰을 공격 성공으로 세지 않는다.

## 7. 조건부 보장과 형식 주장

- [ ] theorem 직전 또는 직후에 contract sufficiency, supported decoder/simulator soundness, linearizable
      ledger와 signer-gate non-bypass 전제를 적었다.
- [ ] `ActionIR`, `S_k`, `e_(k+1)`, `Inv(C)`, reservation, confirmed effect와 capability를 처음 사용할 때
      정의했다.
- [ ] induction step이 concurrent reservation과 rollback/commit을 실제 구현 transition과 연결한다.
- [ ] source/destination chain의 두 번째 signing gate가 같은 intent ledger를 조회한다는 의무를
      테스트했다.
- [ ] unknown effect, depth overflow, codehash mismatch와 simulator failure가 ALLOW로 가지 않는지
      negative test가 있다.
- [ ] receipt mismatch 뒤의 동결이 이미 확정된 상태를 되돌리지 못한다는 점을 명시했다.
- [ ] liveness, compiler correctness, unknown bytecode semantics, future price, MEV, protocol solvency와
      automatic recovery를 보장 밖에 뒀다.
- [ ] mechanized proof가 없다면 `formal proof` 대신 `conditional theorem` 또는 `proof sketch`라고 쓴다.
- [ ] `proves user intent`, `end-to-end safe`, `complete protection` 표현을 쓰지 않는다.
- [ ] 저자가 아닌 reviewer가 반례 trace를 제출하고 adjudication diff를 남겼다.

## 8. 외적 타당도

- [ ] 결론을 Ethereum·Base, 고정 block, 선택 protocol·function과 평가 model snapshot으로 제한했다.
- [ ] local fork가 production latency, reorg, availability, mempool, relayer, attestation, MEV와 counterparty
      risk를 재현하지 않는다고 적었다.
- [ ] injected balance/storage fixture와 실제 사용자 계정 history의 차이를 적었다.
- [ ] fixed quote와 authored stale-state mutation이 live market performance가 아님을 적었다.
- [ ] 두 chain 결과를 모든 EVM chain으로 일반화하지 않는다.
- [ ] selected ABI decoder 결과를 unknown proxy·Universal Router·aggregator로 일반화하지 않는다.
- [ ] author-exposed split과 adaptive evaluation을 unseen model/protocol generalization이라고 부르지 않는다.
- [ ] 한 model snapshot의 LLM verifier 결과를 LLM 전체의 능력으로 일반화하지 않는다.
- [ ] 실제 자금, mainnet signer와 MetaMask production backend를 실험하지 않았음을 명시한다.

## 9. MetaMask case-study 경계

- [ ] Agent Wallet을 연구의 primary product target가 아닌 practical case로 소개한다.
- [ ] architecture, trading modes, outflow policy, commands를 final freeze 날짜에 공식 문서에서 다시
      확인했다.
- [ ] public-docs emulator와 production service를 이름·표·그림에서 명확히 구분했다.
- [ ] outflow limitation을 공개 문서상의 추적 범위로만 설명하고 exploit·bypass·vulnerability라고 쓰지
      않는다.
- [ ] threat scanning 또는 2FA가 연구 emulator에 없다는 점을 명시한다.
- [ ] address/spender allowlist의 STRICT/LITERAL 해석이 실제 backend behavior라는 주장을 하지 않는다.
- [ ] Permit2, cumulative allowance, post-state freeze 권고를 **design proposal**로만 표기한다.
- [ ] 권고마다 공개 사실, 연구 inference, validation requirement를 분리했다.
- [ ] production rollout 전에 MetaMask 내부 threat model·telemetry·UX 검증이 필요하다고 적었다.

## 10. 재현성·윤리·제출 안전

- [ ] 실제 자금·실제 사용자 wallet·mainnet transaction을 사용하지 않았다.
- [ ] RPC URL, API key, mnemonic, session token과 개인 식별 정보가 원시 결과·log·그림에 없다.
- [ ] 제출본에서 실명, email, GitHub 계정, 로컬 경로, 학교·동아리 식별자를 제거했다.
- [ ] 저장소 링크·계정명을 익명 심사 원고에 넣지 않았다.
- [ ] 악성 calldata/fixture 공개가 실제 피해를 쉽게 만들지 않는지 검토하고 필요한 경우 공개 시점을
      늦췄다.
- [ ] MetaMask에 대한 production finding을 발견한 경우 논문 제안과 분리해 responsible disclosure
      절차를 사용했다.
- [ ] Notion 제출본에 code block과 callout이 없고, 필요한 코드는 이미지로 변환했다.
- [ ] 한국어 원고 단어 수 제한과 citation·그림 caption을 최종 audit했다.
- [ ] AI가 작성한 모든 외부 사실·수치·인용을 사람이 1차 출처와 대조했다.

## 11. 유지해야 할 최소 limitation 문장

최종 원고에는 최소한 다음 의미가 모두 남아 있어야 한다. 표현은 다듬어도 범위를 넓히면 안 된다.

1. **Specification gap:** IntentLock은 사용자가 확인한 contract에 없는 의도를 보호하지 못한다.
2. **Observation gap:** 보장은 지원된 decoder, simulation과 event/post-state labeling의 soundness에
   조건부다.
3. **Enforcement gap:** 모든 signing path가 capability gate를 통과하고 reservation이 linearizable해야
   한다.
4. **Irreversibility:** post-state mismatch는 후속 실행을 동결할 수 있지만 이미 확정된 효과를 자동
   복구하지 않는다.
5. **Coverage:** 평가는 두 fixed fork와 제한된 protocol/function/model 범위이며, author-exposed split은
   unseen evidence가 아니다.
6. **Product boundary:** Guard Mode 비교는 공개 문서 emulator이며 MetaMask production 보안 평가가
   아니다.
7. **Operational realism:** local fork와 test relayer는 production availability, latency, reorg, MEV와
   counterparty risk를 재현하지 않는다.
8. **Human evidence:** label·novelty·proof wording의 독립 검수는 자동화할 수 없고 실제 제출이 있어야
   완료된다.

## 12. Human gates — 완료 조작 금지

### H1. Novelty adversarial review

- Reviewer: `PENDING HUMAN`
- 제공 자료: [`claim-to-citation.md`](claim-to-citation.md)의 RW/GAP 표
- 요구 산출물: strongest objection, missing nearest work, 좁혀야 할 문장, accept/revise/reject
- 상태: `PENDING`

### H2. Conditional guarantee counterexample review

- Reviewer: `PENDING HUMAN`
- 제공 자료: [`draft-method.md`](draft-method.md)의 정리·proof sketch와 실제 transition/test map
- 요구 산출물: 최소 1개 concurrency/retry/unsupported-effect 반례 시도와 판정
- 상태: `PENDING`

### H3. Five-number raw-result trace

- Reviewer: `PENDING HUMAN`
- 제공 자료: final table, raw records, analysis output과 metric definition
- 요구 산출물: 핵심 수치 5개의 numerator/denominator/run ID 재계산
- 상태: `PENDING — RESULT_PLACEHOLDER`

### H4. MetaMask wording review

- Reviewer: `PENDING HUMAN`
- 제공 자료: [`metamask-recommendations.md`](metamask-recommendations.md), 공식 문서 4개
- 요구 산출물: production-equivalence·vulnerability inference가 없는지 문장별 판정
- 상태: `PENDING`

주저자가 H1~H4를 직접 수행한 기록은 internal self-review로 남길 수 있지만 `independent`로 세지 않는다.
Billy 또는 제3자가 실제로 검수한 원문과 저자 adjudication이 있어야 human gate가 닫힌다.

## 13. 최종 release decision

- [ ] H1~H4 중 원고 주장에 필요한 gate가 모두 실제 제출로 닫혔다.
- [ ] 모든 `RESULT_PLACEHOLDER`가 evidence로 교체되거나 해당 결과 문장이 삭제됐다.
- [ ] 자동 submission audit와 수동 Notion preview가 모두 통과했다.
- [ ] 남은 미완료 항목은 원고의 명시적 limitation 또는 삭제된 claim으로 해소됐다.

최종 판정: `PENDING`
