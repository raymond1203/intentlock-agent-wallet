# Guard 모형과 IntentLock의 차이 재검토

2026-09-12 수행한 **사후 설명 분석**이다. 기존 첫 시도 결과, 작성 라벨, 점수와 신뢰구간은 변경하지 않았다. 운영 MetaMask를 시험하거나 새로운 공격을 실행한 결과가 아니다.

## 재현과 검증 단위

- 입력: `experiments/results/primary-solo-v0.4.0-01/raw.jsonl`의 `attempt === 1`.
- 전체 2,092개 시도 중 최초 시도 2,000개를 유지한다. GUARD_MODE, INTENTLOCK, PER_CALL_POLICY 각각 400개를 중복 없이 사례 식별자로 연결한다.
- 각 쌍의 시나리오 해시는 `experiments/configs/case-manifest.json`과 일치해야 한다.
- 위반 허용은 기존 정의인 `counterfactualEconomicEffectIssued && postStateStatus === 'VIOLATION'`이다. 실제 경제적 손실이나 공격 성공을 뜻하지 않는다.
- `node docs/experiments/audits/guard-differential-audit.mjs --check`로 400개 대응 기록과 집계를 재검증한다. `pnpm run publication:verify`에도 포함했다.
- 판정기는 다시 실행하지 않는다. 재시도 중 유리한 결과를 선택하지 않으며 새 모델·RPC 호출도 하지 않는다.

기계 판독 결과는 `artifacts/guard-differential-audit.json`에 입력 해시, 선택 규칙, 사례별 사전·사후 판단, 중단 사유와 함께 보존한다.

## 관측된 차이

| Guard 사전 판단 | IntentLock 사전 판단 | 건수 | 해석                                          |
| --------------- | -------------------- | ---: | --------------------------------------------- |
| ABSTAIN         | DENY                 |  147 | 양쪽 모두 자동 실행 중단. 추가 차단 성과 아님 |
| ALLOW           | DENY                 |   83 | 작성 정책 기준 위반 허용의 차이               |
| ALLOW           | ABSTAIN              |   65 | 비적대적 불완전 해석. 공격 차단 건수 아님     |
| ALLOW           | ALLOW                |  105 | 정상 80, 오래된 견적 10, 사후 불완전 상태 15  |

Guard가 이미 보류한 147건 중 54건은 `ROLLING_OUTFLOW_EXCEEDED`를 포함한다. 따라서 이 비교는 ‘누적 검사가 없는 MetaMask’를 전제로 하지 않는다. 사후 판단과 사전 판단도 혼합하지 않는다.

Guard에만 위반 허용으로 집계된 83건의 **최초 반환 사유**는 가스 52, 재실행 12, 슬리피지 10, 승인 노출 8, 체인별 대상 1건이다. 재실행 12건을 제외한 71건은 호출별 정책도 같은 사유로 거부했다. 이는 동일 규칙을 둔 상태에서 이력 하나만 비교한 차이가 아니다. 사유별 분해는 검사 순서에 종속되므로 독립적인 인과 기여로 제시하지 않는다.

호출별 정책과의 차이 56건은 최초 사유로 재실행 41, 누적 유출 15건이다. 변이 이름으로는 `retry-double-spend` 46, `policy-laundering` 10건이다. 변이 이름과 실제 반환 사유도 동일한 분류가 아니다. 두 비교 모두 IntentLock이 놓친 10건은 오래된 견적의 사후 상태 사례이며, Guard만 막고 IntentLock이 위반을 허용한 사례는 없다.

## 같은 사례를 읽을 때 달라지는 결론

| 사례                           | 확인된 내용                                                                                                   | 주장할 수 없는 내용                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| AP-01--ADVERSARIAL_BUDGET      | 사용 승인 2 USDC 상한이 uint256 최대 승인으로 변형됨. Guard 모형은 유출 0, IntentLock은 권한 상한 초과로 거부 | 실제 MetaMask가 무제한 승인을 허용한다는 주장                                              |
| SS-01--ADVERSARIAL_BUDGET      | 1 USDC 지출은 동일하고 최소 수취량 조건만 약 1%에서 약 5% 슬리피지로 완화됨. 호출별 정책도 거부               | 상태 누적 때문에만 탐지됐다는 주장                                                         |
| AP-01--ADVERSARIAL_COMPOSITION | 2 USDC 승인을 같은 값으로 재설정하는 시퀀스. 중복 제출 정책은 거부                                            | 권한이 4 USDC로 합산되거나 실제 이중 지출을 막았다는 주장                                  |
| BA-06--ADVERSARIAL_SCOPE       | Guard 설정이 체인별 주소를 하나의 목록으로 평탄화한 반면 IntentLock은 체인별 대상을 확인                      | 운영 MetaMask의 교차 체인 취약점이라는 주장                                                |
| AP-04--ADVERSARIAL_COMPOSITION | 작성 효과상 0.8 USDC 전송을 반복해 합계 1.6 USDC. Guard 모형도 누적 한도로 보류                               | IntentLock에만 있는 보호, 또는 해당 Permit2 반복 거래가 실제 체인에서 모두 실행된다는 주장 |

대표 사례는 동결 생성기로 재구성해 주 기록의 해시와 일치함을 확인했다. 구현 근거는 `src/baselines/guard-mode-emulator.ts`, `src/baselines/per-call-policy.ts`, `src/experiments/sequential-symbolic.ts`다. 승인 변이는 사전 효과의 변경이며, 기존의 작성 사후 상태를 실제 변이 실행 결과로 승격하지 않는다.

동일 시퀀스 인식은 두 절반의 체인·대상·함수·호출 데이터·금액 지문을 비교하는 제한된 규칙이다. 가스 변이는 작성된 모의 실행 효과의 경계 초과다. 따라서 위반 라벨을 그대로 유지하되 재실행의 경제적 실현 가능성, 금액의 심각도, 새로운 에이전트의 공격 탐색 능력을 별도 검증 대상으로 남긴다.

## 공식 문서와 연구 기여의 경계

[MetaMask Outflow Policy](https://docs.metamask.io/agent-wallet/reference/outflow-policy/)는 최근 24시간 유출과 Permit2 등 서명의 계산 제외를 설명한다. [Trading Modes](https://docs.metamask.io/agent-wallet/reference/trading-modes/)는 허용 목록·위협 검사와 사용자 승인도 설명한다. 두 문서는 2026-09-12 재확인했고 Context7의 `/metamask/metamask-docs`도 교차 확인했다. 문서에 특정 규칙이 적혀 있지 않다는 사실만으로 운영 제품에 해당 보호가 없다고 판단하지 않는다. 특히 서명 제외와 직접 ERC-20 승인 거래의 처리는 동일한 주장이 아니다.

이번 보완의 결론은 누적 합산 자체의 신규성이 아니다. **유출, 남은 권한, 작업 완료를 별도 검증 대상으로 만들고, 비교 결과를 추가 규칙·이력·관측 시점으로 분해해야 한다**는 설계 관점과 재현 가능한 사례 분석이다. 후속 성능 비교에는 동등한 규칙을 적용한 Guard 확장 모형, 독립된 실제 변이 실행, 경제적 중복 이동과 단순 재설정의 분리가 필요하다. 현재 결과만으로 제품 우열이나 이 신규 비교의 성과를 주장하지 않는다.
