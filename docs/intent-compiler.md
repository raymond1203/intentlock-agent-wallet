# Intent Compiler and confirmation boundary

Compiler는 추출 모델을 신뢰하지 않는다. `trustedUserText`에 실제로 존재하는 evidence만 critical
field의 권한 근거가 될 수 있고, tool output·웹 페이지·simulation·protocol metadata는
`UNTRUSTED_OBSERVATION`으로 분리한다.

## Critical fields

`account`, `nonce`, `chainScopes`, `targets`, `selectors`, `recipients`, `assetBudgets`, `gas`,
`slippage`, `deadline`, `finalStateGoals` 모두 다음 조건을 만족해야 한다.

1. evidence source가 `TRUSTED_USER`이다.
2. confidence가 기본 0.8 이상이다.
3. evidence가 비어 있지 않고 사용자 원문에 그대로 존재한다.
4. candidate가 strict Intent Contract schema를 통과한다.

하나라도 실패하면 누락 필드만 나열해 ESCALATE한다. Tool이 “일반적인 router 주소”나 “권장
slippage”를 반환해도 계약 권한을 자동 확대할 수 없다.

## Narrowing과 widening

수취인·target·selector 제거, 금액·allowance·gas·slippage 축소, deadline 단축은 자동 narrowing이다.
chain/target/selector/recipient 추가, budget·gas·slippage 증가, deadline 연장, final goal 제거는
widening이며 해당 필드의 명시적 확인 없이는 `WIDENING_REQUIRES_CONFIRMATION`이다.

확인 문구는 전체 요청을 다시 묻지 않고 변경된 경계만 보여준다. 예:

> 기존 한도보다 gas가 0.003 ETH 증가하고 새 수취인 0x…가 추가됩니다. 이 두 변경만 허용할까요?

## 평가 방법

`benchmark/scenarios/compiler-gold.json`의 30개 case에서 compiler decision과 critical-field
추출을 별도로 평가한다.

- decision accuracy = 올바른 `COMPILED`/`ESCALATE` 수 ÷ 전체 수
- critical-field recall = 정답상 확인이 필요한 field 중 compiler가 ESCALATE에 포함한 field 수 ÷
  정답 field 수
- false widening acceptance = 확인 없는 widening을 `COMPILED`한 수

독립 reviewer는 `benchmark/reviews/m1/compiler-labeling.packet.json`의 10개 blind case를 구현
결과를 보지 않고 먼저 라벨링한다. 실명이나 GitHub 계정 대신 연구용 가명을 사용하고, 완성 전에는
compiler·테스트·정답 파일을 열지 않는다. 불일치는 사용자 원문과 이 문서의 widening 규칙으로
합의한다. 패킷 검증, submission 작성과 사후 비교 절차는
[`m1-independent-validation.md`](./m1-independent-validation.md)에 고정한다. 기존 CSV는 초기 작업용
초안이며 M1 종료 증거로 사용하지 않는다.
