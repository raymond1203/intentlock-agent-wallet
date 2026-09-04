# 서론·선행연구 초안

> 상태: 결과 삽입 전 초안. 대괄호로 표시한 수치와 결론은 M3 동결 결과가 생성되기 전에는
> 채우지 않는다.

## Key Takeaways

1. 멀티 툴 에이전트의 각 호출이 개별 정책을 통과하더라도 approve, swap, bridge, retry가
   조합되면 사용자가 허용한 누적 금액·수취인·권한·최종 자산을 벗어날 수 있다.
2. IntentLock은 LLM의 판단을 자금 집행 근거로 직접 사용하지 않는다. 사용자가 확인한 경제
   의도 계약과 재귀적으로 해석한 온체인 효과, 누적 원장, 실제 receipt 이후 상태를 결정론적으로
   대조한다.
3. 고정된 400개 offline counterfactual replay와 40개 scripted signer-boundary 사례의
   보안·정상 완료·비용 결과는 `[M3 결과 삽입]`이며, 실제 fork 실행률이나 model-adaptive 공격률로
   해석하지 않는다. 개선되지 않은 항목과 false denial도 같은 분모로 공개한다.

## 1. 서론

대규모언어모델(LLM) 에이전트는 사용자의 자연어 목표를 여러 도구 호출로 나눠 실행한다. 일반적인
정보 검색이나 문서 편집에서는 잘못된 호출을 되돌릴 수 있지만, 지갑 서명 뒤의 상태 전이는 곧바로
자산 이동, 권한 생성, 부채 변화로 이어진다. 특히 한 번의 거래 설명만 확인하는 방식은 여러 호출이
합쳐 만든 경제적 결과를 놓칠 수 있다. 사용자가 “정해진 금액 안에서 교환하고 남은 권한을
제거하라”고 요청했더라도 에이전트는 합법적인 approve, swap, retry를 각각 선택하면서 과도한
allowance, 중복 지출, 잘못된 수취 자산을 남길 수 있다.

이 문제는 악성 프롬프트 인젝션에만 한정되지 않는다. 오래된 quote, 성공을 timeout으로 오인한 재시도,
모호한 자연어의 자의적 수치화, 도구 오류 뒤의 잘못된 재계획도 같은 최종 손실을 만들 수 있다. 본
연구는 이들을 공격과 비적대적 drift로 나누어 분석하되, 두 경우 모두 “사용자가 확인한 계약에 비해
어떤 경제 상태가 실제로 변했는가”라는 공통 검증 문제로 다룬다.

기존 연구는 이미 호출과 목표의 정렬, 도구 인자의 권한 정책, 계획 궤적, 정보 흐름, 런타임 규칙,
시간적 제약을 폭넓게 다룬다. 따라서 본 연구는 최초의 멀티스텝 guardrail이나 최초의 형식 monitor를
주장하지 않는다. 남는 질문은 허용된 호출과 계획 내부에서도 발생하는 wallet-specific 경제 효과를
어떻게 누적하고, 서명 전 예상과 실행 후 실제 상태를 같은 계약으로 연결할 것인가이다.

IntentLock은 사용자의 확인을 거친 버전 고정 경제 의도 계약(Intent Contract)을 중심에 둔다. 계약은
chain, target, selector, recipient뿐 아니라 자산별 누적 총유출, allowance 노출, slippage, gas, debt,
ownership, 최종 상태 목표를 정수 단위로 표현한다. calldata, typed signature, batch와 protocol call을
ActionIR의 경제 효과로 정규화하고, 이미 실행된 효과와 동시 예약을 누적 원장에서 합산한다. 불변식을
충족하는 경우에만 signer 앞에서 일회성 허용 capability를 발급하며, 불확실하거나 계약 범위를 넓히는
경우에는 거부(DENY) 또는 사용자 확인 요청(ESCALATE)으로 처리한다. 실행 뒤에는 receipt와 실제
post-state를 예상 효과와 대조하고, 불일치가 있으면 후속 서명을 동결한다.

MetaMask Agent Wallet은 이 연구의 제품 평가 대상이 아니라 실무 사례다. 공개 구조에는 서버 지갑,
거래 simulation, 위협 검사, ERC-7821 batch와 순차 실행 fallback, allowlist와 rolling outflow 정책이
있어 signer 경계와 누적 상태 문제를 구체화하기 적합하다. 본 연구의 Guard Mode 비교군은 공개 문서로
확인되는 규칙의 emulator이며 비공개 production backend와 동등하다고 주장하지 않는다.

### 연구 질문

- RQ1. 개별적으로 허용된 호출의 조합은 어떤 누적 경제 의도 위반을 만드는가?
- RQ2. IntentLock은 공개 제품 정책, LLM verifier, 호출 단위 정책과 비교해 어떤
  security–utility trade-off를 보이는가?
- RQ3. semantic compiler와 runtime monitor의 단계별 성능은 어떻게 다르며, stateful ledger,
  recursive decoder와 post-state verifier의 한 요소 ablation은 어떤 security–utility 변화를 만드는가?
- RQ4. author-exposed evaluation split과 사전 정의된 deterministic 재계획에서 signer-boundary
  결과와 명세 품질이 어떻게 변하는가?

기존 `HIDDEN_TEST` 파일은 개발 과정에서 노출됐으므로 unseen 결과라고 부르지 않는다. 별도 sealed
split이 실제 인간 custodian에 의해 동결 전까지 숨겨지지 않는 한 RQ4의 일반화 주장은
author-exposed split과 adaptive cases로 제한한다.

### 기여

1. 잔액, 권한, 부채, 소유권, gas, chain과 counterparty의 누적 변화를 표현하는 typed economic
   intent contract와 signer 앞 상태 monitor를 제시한다.
2. calldata·batch·typed signature·지원 protocol을 경제 효과로 정규화하고, 예측 효과와 실제
   receipt/post-state를 연결하는 조건부 검증 파이프라인을 구현한다.
3. 공격과 비적대적 drift를 함께 포함하는 고정 EVM 사례 벤치마크, authored exact-state oracle,
   제품 공개 정책과 LLM·결정론 baseline의 재현 가능한 offline 평가 프로토콜을 제공한다. 실제
   `EXECUTED_FORK` evidence는 별도 진단으로 분리한다.

## 2. 선행연구와 정확한 gap

### 호출·목표와 계획 정렬

[Task Shield](https://arxiv.org/abs/2412.16682)는 instruction과 tool call이 사용자 목표에
기여하는지를 test-time에 검사한다. [DRIFT](https://arxiv.org/abs/2506.12104)는 최소 function
trajectory, parameter checklist와 injection isolation을 결합한다. 두 연구는 단일 호출만 보는
방식보다 넓은 실행 맥락을 다루므로, “기존 방어는 모두 single-step”이라는 설명은 정확하지 않다.
IntentLock의 차이는 sequence를 보는 것 자체가 아니라 각 단계가 만든 EVM effect와 누적
post-state를 정수 계약으로 제한하는 데 있다.

### 권한·정보 흐름·runtime policy

[Progent](https://arxiv.org/abs/2504.11703)는 tool과 typed argument의 권한 범위를 결정론적으로
검사하고, [AgentSpec](https://arxiv.org/abs/2503.18666)은 구조화된 규칙을 runtime checkpoint에
적용한다. [CaMeL](https://arxiv.org/abs/2503.18813)은 trusted query에서 control/data flow를
분리해 untrusted data의 영향을 제한하며, [AgentArmor](https://arxiv.org/abs/2508.01249)는 runtime
trace를 프로그램 분석 IR로 검사한다. 이들은 generic policy와 enforcement의 강한 선행이다.
그러나 허용 범위 안에서 선택된 route, spender, final asset과 여러 호출의 합산 allowance·debt를
wallet post-state로 검증하는 일은 별도의 domain specification을 요구한다.

[Formal Methods Meet LLMs](https://arxiv.org/abs/2605.16198)는 LLM labeler와 LTL monitor를
결합하고 temporal constraint가 복잡해질 때 형식 monitor의 역할을 분석한다. IntentLock의 조건부
보장도 같은 specification boundary를 인정한다. 사용자의 실제 의도를 contract가 누락했거나 decoder가
경제 효과를 잘못 해석하면 monitor의 내부 정확성만으로 end-to-end correctness를 보장할 수 없다.
그래서 compiler의 critical-field recall과 사용자 확인 부담을 monitor 성능과 분리해 측정한다.

### 에이전트 보안 benchmark

[AgentDojo](https://arxiv.org/abs/2406.13352)는 stateful tool 환경과 다단계 보안 사례를 제공하고,
[Agent Security Bench](https://arxiv.org/abs/2410.02644)는 agent lifecycle 전반의 공격·방어와
security–utility 지표를 체계화한다. [AgentDyn](https://arxiv.org/abs/2602.03117)은 동적이고
open-ended한 작업에서 과도한 방어가 정상 utility를 낮추는 문제를 평가한다. 이들 benchmark는 본
연구의 평가 설계에 중요한 근거지만, calldata, Permit2 allowance, bridge settlement, lending debt,
fixed-fork post-state를 직접적인 oracle로 삼지 않는다.

Web3 직접 선행인 [Real AI Agents with Fake Memories](https://arxiv.org/abs/2503.16248)는
blockchain agent의 memory와 context 조작이 unauthorized transfer와 protocol 위반으로 이어질 수
있음을 보인다. 본 연구는 이 문제의식을 signer 앞 누적 계약과 exact execution evidence로 좁혀,
공격뿐 아니라 hallucination·retry·stale quote가 만든 동일한 경제 효과까지 비교한다.

### MetaMask Agent Wallet 사례 경계

MetaMask 공개 문서는 Agent Wallet의
[architecture](https://docs.metamask.io/agent-wallet/reference/architecture/),
[trading modes](https://docs.metamask.io/agent-wallet/reference/trading-modes/),
[outflow policy](https://docs.metamask.io/agent-wallet/reference/outflow-policy/)를 설명한다. 공개 정책은
현실적인 allowlist와 rolling monetary budget baseline을 제공한다. 반면 본 연구는 자연어 compiler가
확정한 final asset, slippage, allowance, debt, partial completion까지 contract field로 연결한다. 이
차이는 production 취약점 주장이 아니라, 공개 정책 emulator와 추가적인 누적 의도 계약의 상보성을
평가하기 위한 연구 질문이다.

## 3. 주장 경계

결과 원고에는 실제 동결된 증거가 있는 주장만 포함한다. offline counterfactual unsafe-authorization
rate를 실제 Unsafe Execution Rate로 부르지 않는다. IntentLock이 baseline보다 낮은 offline rate를
보이지 않으면 우월성 문구를 삭제하고 공격 유형별 차이만 보고한다. 정상 completion,
false denial 또는 확인 부담이 악화되면 이를 보안 개선과 함께 제시한다. 지원하지 않는 protocol,
simulation·RPC soundness, 자연어 계약 누락, private MetaMask backend와 실제 자금 환경은 명시적인
한계로 유지한다.
