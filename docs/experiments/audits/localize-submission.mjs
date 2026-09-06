/** Publication-only Korean transformation. Never changes canonical evidence or analysis. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatForFourPillars } from './fourpillars-publication-format.mjs';

const option = (name, fallback) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = resolve(option('root', process.cwd()));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'paper/final.md',
  'figures/architecture.svg',
  'figures/security-utility.svg',
  'figures/error-taxonomy.svg',
  'figures/latency.svg',
];
const source = new Map(
  await Promise.all(sourcePaths.map(async (path) => [path, await readFile(resolve(root, path))])),
);
const inputs = Object.fromEntries([...source].map(([path, bytes]) => [path, sha256(bytes)]));
const original = source.get('paper/final.md').toString('utf8');
assert.equal(
  inputs['paper/final.md'],
  '43108b97a49616527f66f6cb9161abe8edaee0a72d880d0830bf5f11c9a1e02e',
  'Canonical paper changed: re-review paragraph edits before regenerating',
);
assert(original.includes('## 참고문헌'), 'Canonical reference section missing');
assert(
  !/^\s*```/m.test(original),
  'Canonical code fences require an explicit publication decision',
);
assert(
  !/^\s*>\s*\[!/m.test(original),
  'Canonical callout requires an explicit publication decision',
);

// Protected product/paper names and exact identifiers are never lexically rewritten.
const protectedNames = [
  'MetaMask Agent Wallet',
  'Real AI Agents with Fake Memories',
  'Authority–Inference Separation',
  'Formal Methods Meet LLMs',
  'Task Shield',
  'Guard Mode',
  'ActionIR',
  'IntentLock',
  'AgentArmor',
  'AgentDojo',
  'AgentSpec',
  'ScopeGate',
  'Progent',
  'CaMeL',
  'DRIFT',
  'Ethereum',
  'Base',
  'MetaMask',
  'Permit2',
];
const definitions = new Map([
  ['LLM', '대규모 언어 모델'],
  ['AI', '인공지능'],
  ['EVM', '이더리움 가상 머신'],
  ['RPC', '원격 노드 호출'],
  ['ABI', '계약 호출 형식 명세'],
  ['MEV', '거래 순서 조정으로 추출할 수 있는 가치'],
  ['UER', '위반 거래 실행률'],
  ['UX', '사용자 경험'],
  ['API', '응용 프로그램 호출 인터페이스'],
  ['USD', '미국 달러'],
  ['2FA', '이중 인증'],
  ['counterfactual unsafe-authorization rate', '작성 정책 기준 반사실적 위반 허용률'],
  ['contract-conditioned replay', '확인된 계약을 전제로 한 재생 평가'],
  ['offline counterfactual replay', '오프라인 반사실 재생'],
  ['accepted-effect history', '이전에 허용한 경제 효과의 이력'],
  ['scripted signer-boundary', '정해진 공격 스크립트의 서명 경계'],
  ['signer-boundary', '서명 경계'],
  ['pre-sign', '서명 전'],
  ['post-state', '실행 후 상태'],
  ['first-detection ordinal', '최초 탐지 순서'],
  ['prefix-safety', '실행 도중의 안전성'],
  ['Intent Contract', '경제 의도 계약'],
  ['Agent Wallet', '지갑 에이전트'],
  ['gross outflow', '총유출량'],
  ['allowance exposure', '토큰 사용 권한 노출'],
  ['residual allowance', '작업 후 남은 토큰 사용 권한'],
  ['allowance', '토큰 사용 권한'],
  ['idempotency', '중복 실행 방지'],
  ['capability', '범위가 제한된 실행 권한'],
  ['allowlist', '허용 목록'],
  ['calldata', '거래 호출 데이터'],
  ['typed-data', '구조화된 서명 데이터'],
  ['fail-closed', '불확실하면 실행을 중단하는 방식'],
  ['oracle', '정답 판정 기준'],
  ['decoder', '호출 해석기'],
  ['compiler', '의도 계약 생성·검사기'],
  ['monitor', '실행 감시기'],
  ['adapter', '지갑 연결 모듈'],
  ['emulator', '정책 모형'],
  ['prefix', '실행 앞부분'],
  ['drift', '의도 이탈'],
  ['trace', '호출 실행 기록'],
  ['fixture', '고정 시험 자료'],
  ['nonce', '중복 방지 번호'],
  ['spender', '사용 승인 대상'],
  ['recipient', '수취인'],
  ['payload', '실행 요청'],
  ['snapshot', '상태 스냅샷'],
  ['approval', '토큰 사용 승인'],
  ['swap', '자산 교환'],
  ['bridge', '체인 간 자산 이동'],
  ['retry', '재시도'],
  ['batch', '일괄 호출'],
  ['simulation', '모의 실행 검사'],
  ['guardrail', '의도 이탈 방지 장치'],
  ['runtime', '실행 시점'],
  ['utility', '정상 작업 수행 능력'],
]);
const terms = new Map([
  ['replay 방지', '재실행 방지'],
  ['source의 계약', '출발 체인의 계약'],
  ['LLM snapshot', 'LLM 고정 모델 버전'],
  ['negative result', '개선되지 않은 결과'],
  ['exact execution oracle', '실제 실행에 근거한 정답 판정 기준'],
  ['case manifest', '사례 명세 목록'],
  ['whole-plan 검사', '전체 계획 검사'],
  ['generic verifier', '범용 판정기'],
  ['signer invocations', '서명기 호출 수'],
  ['attempted plans', '제안된 계획'],
  ['raw attempts', '전체 시도'],
  ['frozen source A', '고정 소스 A'],
  ['freeze commit B', '동결 커밋 B'],
  ['primary intention-to-treat records', '주 평가의 첫 시도 분석 기록'],
  ['deterministic', '결정론적'],
  ['ownership', '소유권'],
  ['deadline', '마감 시각'],
  ['chain', '체인'],
  ['decode', '호출 해석'],
  ['block', '블록'],
  ['reason', '판단 사유'],
  ['escalation', '서명 전 판단 유보'],
  ['ordered receipt event', '발생 순서대로 정렬한 거래 영수증의 이벤트'],
  ['pre/post balance', '실행 전후 잔액'],
  ['position', '포지션'],
  ['Key Takeaways', '핵심 요약'],
  ['per-call policy', '호출별 정책'],
  ['no defense', '방어 없음'],
  ['LLM verifier', '대규모 언어 모델 판정기'],
  ['generic LLM verifier', '범용 대규모 언어 모델 판정기'],
  ['rolling 24-hour outflow', '최근 24시간의 누적 자산 유출'],
  ['stratified grouped bootstrap', '기본 의도별 묶음을 유지한 층화 부트스트랩'],
  ['strongest measured baseline', '관측 결과가 가장 좋은 비교군'],
  ['strongest baseline', '관측상 최선의 비교군'],
  ['attempt-1 intention-to-treat', '첫 시도(attempt-1) 결과를 고정 분모에 모두 유지하는'],
  ['intention-to-treat', '첫 시도 전체를 유지하는 분석'],
  ['author-exposed evaluation split', '개발 중 작성자에게 공개된 평가 분할'],
  ['source-visible', '원본 자료를 볼 수 있는'],
  ['author-exposed', '작성자에게 공개된'],
  ['post-state-only', '실행 후에만 관측 가능한'],
  ['stale-quote fixture', '오래된 견적의 사후 상태 시험 자료'],
  ['stale quote', '오래된 견적'],
  ['stale-quote', '오래된 견적'],
  ['false denial', '잘못된 거부'],
  ['false deny', '잘못된 거부'],
  ['pre-sign detection', '서명 전 탐지'],
  ['unsafe rate', '위반 허용률'],
  ['benign completion', '정상 완료'],
  ['unsafe authorization', '위반 허용'],
  ['percentage points', '퍼센트포인트'],
  ['execution index', '실행 순서 번호'],
  ['final-goal check', '최종 목표 검사'],
  ['final goal', '최종 목표'],
  ['predicted effects', '예측 경제 효과'],
  ['unknown effect', '해석하지 못한 경제 효과'],
  ['shallow-decoder', '얕은 호출 해석'],
  ['recursive-decode', '재귀적 호출 해석'],
  ['synthetic-reference', '작성된 참조 자료'],
  ['mechanized proof', '기계적으로 검증한 증명'],
  ['graph intermediate representation', '그래프 중간 표현'],
  ['control/data flow', '제어·데이터 흐름'],
  ['function trajectory', '함수 실행 경로'],
  ['parameter checklist', '매개변수 점검 목록'],
  ['symbolic policy', '명시적 규칙 정책'],
  ['runtime monitoring', '실행 감시'],
  ['trusted query', '신뢰하는 요청'],
  ['trusted-user', '신뢰하는 사용자'],
  ['trusted substring', '신뢰 근거의 부분 문자열'],
  ['threat scanning', '위협 탐지 검사'],
  ['server-wallet', '서버 지갑'],
  ['tool result', '도구 실행 결과'],
  ['tool observation', '도구 관측 결과'],
  ['tool call', '도구 호출'],
  ['child call', '내부 하위 호출'],
  ['source chain', '출발 체인'],
  ['destination action', '목적지 동작'],
  ['model snapshot', '고정 모델 버전'],
  ['versioned prompt', '버전이 지정된 프롬프트'],
  ['versioned trace', '버전이 지정된 호출 기록'],
  ['malformed output', '형식이 잘못된 출력'],
  ['token cost', '토큰 사용 비용'],
  ['atomic amount', '최소 자산 단위의 정수 금액'],
  ['whole-plan', '전체 계획'],
  ['top-level', '최상위'],
  ['end-to-end', '전체 처리 과정'],
  ['transport failure', '통신 실패'],
  ['transport 오류', '통신 오류'],
  ['operational failure', '운영상 실패'],
  ['production availability', '운영 환경의 가용성'],
  ['protocol insolvency', '프로토콜의 지급 불능'],
  ['attestation security', '인증 메시지의 보안성'],
  ['relayer liveness', '중계 서비스의 진행 가능성'],
  ['bridge settlement', '체인 간 이동의 최종 정산'],
  ['transaction inclusion', '거래의 블록 포함'],
  ['specification error', '명세 오류'],
  ['extraction error', '자연어 추출 오류'],
  ['enforcement error', '집행 오류'],
  ['protocol semantics', '프로토콜의 동작 의미'],
  ['field diff', '필드별 변경 내역'],
  ['threat model', '위협 모델'],
  ['private key', '개인 키'],
  ['worker schedule', '작업 처리 순서'],
  ['in-memory', '메모리 내'],
  ['code provenance', '코드의 출처와 고정 버전 근거'],
  ['semantic-only', '의미 판정 조건'],
  ['symbolic-only', '명시적 규칙 조건'],
  ['hybrid conjunction', '의미 판정과 규칙 판정의 결합'],
  ['always-confirm', '항상 사용자 확인'],
  ['full reference', '전체 기능 기준군'],
  ['stage comparison', '단계별 기술 비교'],
  ['shallow effect', '중첩 해석을 제한한 효과'],
  ['post-state verifier', '실행 후 상태 검사기'],
  ['guard decision', '방어 장치의 판단'],
  ['reason code', '판단 사유 코드'],
  ['decoded effect', '해석된 경제 효과'],
  ['structural oracle', '구조적 의도 위반 판정기'],
  ['fake executor', '모의 실행기'],
  ['paired case', '동일 사례의 대응 비교'],
  ['paired-case', '동일 사례의 대응 비교'],
  ['production fork', '운영 상태의 포크'],
  ['safe block', '안전 중단'],
  ['rolling outflow', '기간별 누적 자산 유출'],
  ['maximum amount', '최대 금액'],
  ['schema-valid', '자료 형식을 통과한'],
  ['schema', '자료 형식'],
  ['counterfactual', '반사실적'],
  ['offline', '오프라인'],
  ['scripted', '정해진 스크립트 기반'],
  ['signer', '서명기'],
  ['replay', '재생 평가'],
  ['verifier', '판정기'],
  ['outflow', '자산 유출'],
  ['primary', '주 평가'],
  ['policy', '정책'],
  ['tool', '도구'],
  ['history', '이력'],
  ['gas', '가스 수수료'],
  ['per-call', '호출별'],
  ['result', '결과'],
  ['guard', '방어 장치'],
  ['mismatch', '불일치'],
  ['recovery', '복구'],
  ['production', '운영 환경'],
  ['case', '사례'],
  ['episode', '평가 실행'],
  ['full', '전체 기능'],
  ['paired', '대응 비교'],
  ['source', '출처'],
  ['action', '동작'],
  ['timeout', '시간 초과'],
  ['agent', '에이전트'],
  ['debt', '부채'],
  ['transfer', '자산 전송'],
  ['protocol', '프로토콜'],
  ['authored', '연구자가 작성한'],
  ['memory', '에이전트 메모리'],
  ['symbolic', '명시적 규칙'],
  ['prompt', '프롬프트'],
  ['intent', '의도'],
  ['amount', '금액'],
  ['target', '호출 대상'],
  ['effect', '경제 효과'],
  ['code', '코드'],
  ['receipt', '거래 영수증'],
  ['executor', '실행기'],
  ['digest', '내용 해시'],
  ['reference', '참조 자료'],
  ['workflow', '작업 유형'],
  ['label', '정답 라벨'],
  ['transaction', '거래'],
  ['baseline', '비교군'],
  ['shallow', '얕은 해석'],
  ['hybrid', '결합형'],
  ['stage', '단계'],
  ['signature', '서명'],
  ['trade', '거래'],
  ['destination', '목적지'],
  ['fallback', '대체 실행 방식'],
  ['call', '호출'],
  ['enforcement', '집행'],
  ['observation', '관측'],
  ['asset', '자산'],
  ['bytecode', '바이트코드'],
  ['selector', '함수 식별자'],
  ['widening', '권한 범위 확대'],
  ['provenance', '출처 근거'],
  ['concurrency', '동시 실행'],
  ['counterparty', '거래 상대'],
  ['worker', '작업 처리기'],
  ['revoke', '권한 철회'],
  ['session', '공통 작업 세션'],
  ['event', '이벤트'],
  ['liveness', '진행 가능성'],
  ['relayer', '중계기'],
  ['terminal', '최종'],
  ['split', '분할'],
  ['manifest', '명세 목록'],
  ['backend', '서버 구현'],
  ['scanner', '위협 검사기'],
  ['valuation', '가치 평가'],
  ['volume', '거래 규모'],
  ['temperature', '샘플링 온도'],
  ['rationale', '판단 설명'],
  ['expected-decision', '예상 판단'],
  ['unsupported', '지원하지 않음'],
  ['outcome', '평가 결과'],
  ['latency', '지연 시간'],
  ['bootstrap', '부트스트랩'],
  ['subgroup', '하위 집단'],
  ['group', '묶음'],
  ['arm', '비교 조건'],
  ['system-case', '시스템·사례 조합'],
  ['system', '시스템'],
  ['wall-clock', '실제 경과 시간'],
  ['expiry', '만료 시점'],
  ['polling', '상태 반복 조회'],
  ['telemetry', '운영 관측 자료'],
  ['proxy', '대리 호출 계약'],
  ['aggregator', '여러 경로를 합치는 계약'],
  ['rollback', '되돌리기'],
  ['reorg', '블록 재구성'],
  ['risk', '위험'],
  ['script', '스크립트'],
  ['unseen', '미공개'],
  ['reviewer', '검토자'],
  ['double-blind', '이중 맹검'],
  ['metric', '지표'],
  ['run ID', '실행 식별자'],
  ['attempt', '시도'],
  ['scope', '범위'],
  ['budget', '예산'],
  ['composition', '호출 조합'],
  ['narrowing', '권한 범위 축소'],
  ['expansion', '권한 범위 확대'],
  ['trigger', '발동 조건'],
  ['predicate', '판정 조건'],
  ['instruction', '지시'],
  ['feed', '정보 흐름'],
  ['context', '맥락'],
  ['prompt-injection', '프롬프트 주입'],
  ['benchmark', '평가 자료'],
  ['version', '버전'],
  ['slippage', '슬리피지'],
  ['recall', '탐지 재현율'],
  ['hash', '해시'],
  ['key', '키'],
  ['transition', '상태 전이'],
  ['substring', '부분 문자열'],
  ['future price', '미래 가격'],
  ['single/batch swap', '단일·일괄 자산 교환'],
  ['lending', '대출·예치'],
  ['test relayer', '시험 중계기'],
  ['attester', '인증기'],
  ['storage', '저장 상태'],
  ['nonzero', '0이 아닌'],
  ['zero approval', '승인액 0'],
  ['finite allowance', '유한한 토큰 사용 권한'],
  ['router', '경로 선택 계약'],
  ['network', '네트워크'],
  ['address', '주소'],
  ['token-recipient', '토큰 수취인'],
  ['token', '토큰'],
  ['model', '모델'],
  ['error', '오류'],
  ['records', '기록 수'],
  ['frozen', '사전 고정된'],
]);

const exactSentences = new Map([
  [
    'Evidence mode: offline counterfactual replay. This table is not a fixed-fork transaction UER measurement.',
    '증거 유형은 오프라인 반사실 재생이다. 이 표는 고정 포크에서 실제 거래의 위반 실행률(UER)을 측정한 결과가 아니다.',
  ],
  [
    'All rows are offline counterfactual replay. Only the three rows under “one-factor causal ablations” receive paired causal-ablation estimates against `INTENTLOCK_FULL`.',
    '모든 행은 오프라인 반사실 재생 결과다. 단일 요인 제거 실험의 세 조건만 전체 기능 기준군(INTENTLOCK_FULL)과 대응 비교하여 해당 설정 변화의 효과를 추정한다.',
  ],
  [
    'This row references the frozen primary LLM result and changes multiple stages; it is not a causal component ablation.',
    '고정된 주 LLM 결과를 재사용하며 여러 단계가 달라진다. 단일 구성요소의 인과 효과를 뜻하지 않는다.',
  ],
  [
    'The corpus already starts from a confirmed contract, so this is a stage score rather than a semantic-stage ablation.',
    '이미 확인된 계약에서 출발한다. 의미 판정 단계의 제거 효과가 아니라 단계별 점수다.',
  ],
  [
    'The hybrid combines a fresh symbolic replay with a frozen primary LLM result and is reported only as a non-causal stage comparison.',
    '새 규칙 재생 결과와 기존 주 LLM 결과를 결합한 비인과적 단계 비교다.',
  ],
  [
    '**Design:** `NON_PAIRED_NON_CAUSAL`. These are deterministic scripted, offline signer-boundary episodes with a fake executor and no post-state observation. They are not model-adaptive, fork-execution, production MetaMask, paired-case, equivalent-case, or causal evidence.',
    '비교 설계는 비대응·비인과(NON_PAIRED_NON_CAUSAL)다. 정해진 공격 스크립트와 모의 실행기를 사용한 오프라인 서명 경계 평가이며 실행 후 상태를 관측하지 않는다. 실제 공격 모델의 적응 능력, 포크 실행, 운영 MetaMask, 동일하거나 동등한 사례의 대응 비교 또는 인과 효과의 증거가 아니다.',
  ],
  [
    'No cross-row rate difference is computed because the two evidence sources are neither paired nor equivalent experimental cases.',
    '두 증거 집합은 대응되거나 동등한 실험 사례가 아니므로 행 사이의 비율 차이를 계산하지 않는다.',
  ],
  [
    'primary reference parity: verified case by case.',
    '주 평가 기준군과의 일치: 사례별 검증 완료.',
  ],
]);
// Paragraph-level edits preserve the source claims while avoiding word-by-word Korean.
// Prefixes deliberately bind these edits to identifiable canonical paragraphs.
const paragraphEdits = new Map([
  [
    '안전 상한과 최종 목표는 구분한다.',
    '안전 상한과 최종 목표는 구분한다. 누적 유출 상한은 실행 시작부터 각 중간 단계까지의 기록(prefix) 전체에서 지켜야 한다. 반면 “목적지 자산을 최소량 보유한다”는 조건은 작업 완료 시 평가한다. 토큰 사용 승인만 끝난 중간 상태가 완료 목표를 충족하지 않는다는 이유만으로 실행 도중의 안전 상한을 위반했다고 보지는 않는다. 허용할 중간 권한 노출에는 별도의 안전 상한이 필요하다.',
  ],
  [
    'MetaMask Agent Wallet은 이 문제를',
    '메타마스크 에이전트 지갑(MetaMask Agent Wallet)은 이 문제를 구체화하는 실무 사례다. 공식 문서는 비동기 서버 지갑 요청, 거래의 모의 실행 검사와 위협 탐지 검사를 설명한다. 지원되는 경우에는 ERC-7821 일괄 호출을 사용하고, 그렇지 않으면 순차 실행으로 전환한다. 이 구조에는 거래 전 검토, 요청 진행 상황, 여러 단계의 완료 상태를 연결할 지점이 있다. 본 연구는 이러한 공개 경계를 바탕으로 설계 패턴을 평가한다. [MetaMask Architecture](https://docs.metamask.io/agent-wallet/reference/architecture/).',
  ],
  [
    'compiler 구성요소는 추출된 후보',
    '의도 계약 생성·검사기(compiler)는 추출된 후보 계약과 필드별 근거를 받아 자료 형식, 신뢰하는 사용자의 요청에 근거했는지, 구현된 권한 확대 규칙을 충족하는지 검사한다. 이것이 자연어 추출기의 완전한 정확성을 보장하지는 않는다. 본 비교는 연구자가 작성한 계약을 이미 확인된 계약으로 가정하는 재생 평가(contract-conditioned replay)다. 실제 사용자의 승인 행위를 관측하지 않았으며, 자연어를 처음 읽어 계약을 만드는 전체 과정의 성공률도 측정하지 않았다. 근거 문자열이 존재하거나 자료 형식 검사를 통과했다는 사실만으로 사용자의 모든 의미가 포착되었다고 할 수 없다. 확인된 계약의 누락은 이후 실행 감시기로 복원할 수 없다.',
  ],
  [
    'monitor는 계약, 이전에 허용된 효과,',
    '실행 감시기는 계약, 이전에 허용된 효과, 현재 후보의 효과, 모의 실행과 호출 해석의 상태를 입력받는다. 주 평가에서는 실행 순서 번호에 따라 호출을 검사하고, 허용(ALLOW)한 효과만 다음 단계에 누적한다. 확정된 범위·상한 위반은 거부(DENY)하고, 관측이 불완전하거나 확인이 필요하면 사용자 확인을 요청한다(ESCALATE). 비교표에서는 ESCALATE를 판단 유보(ABSTAIN)로 정규화한다. 처음으로 ALLOW가 아닌 결과가 나오면 해당 호출 기록의 자동 진행을 중단한다.',
  ],
  [
    '연구 adapter는 같은 실행 경로',
    '연구용 지갑 연결 모듈(adapter)은 하나의 실행 경로에서 호출 해석, 누적 효과 검사, 원장 예약을 마친 뒤에만 실행기를 호출한다. 예약 원장은 대기·실행 완료·위반 상태의 효과를 예산 계산에 유지하며, 중복 방지 식별자가 같은 실행을 다시 승인하지 않는다. 명확한 실패는 관측된 가스 수수료를 남겨 정산한다. 통신 오류로 실행 여부를 알 수 없으면 대기 예약이 남을 수 있다.',
  ],
  [
    '원장의 직렬화는 하나의 프로세스',
    '원장은 하나의 프로세스 안에서 순서를 직렬화하는 메모리 내 구현이다. 상태 스냅샷 구조는 있지만 분산 데이터베이스, 장애 복구, 여러 서명 서비스 사이의 원자적 합의를 구현하지는 않았다. ALLOW 판정은 의도 해시에 연결된 내부 값이며, 외부 서비스가 암호학적으로 검증할 수 있는 일회성 실행 권한은 아니다. 모든 서명 경로를 동일한 계약 해시와 실행 요청의 해시에 결속시키는 실행 권한은 운영 배포를 위한 확장 제안이다.',
  ],
  [
    '현재 adapter는 계약의 idempotency',
    '현재 연결 모듈은 계약의 중복 방지 키를 재사용하므로 같은 계약으로 보낸 두 번째 별도 요청을 중복으로 차단한다. 지원되는 일괄 호출 한 번과 여러 요청에 걸친 작업 세션은 다르며, 주 평가에서 순차 효과를 재생하는 경로도 별개다. 계약별 동작 키와 예산을 공유하는 작업 세션의 운영 구현은 남은 과제다. 예약 대상 자원은 유출량·토큰 사용 권한·가스 수수료이며, 대기 중인 부채까지 동시에 예약한다고 주장하지 않는다.',
  ],
  [
    '실행 후에는 receipt의 성공 여부',
    '실행 후에는 거래 영수증의 성공 여부와 관측한 효과를 예측 효과에 대조하고, 최종 목표를 충족했는지 검사한다. 고정 포크 검증에서는 발생 순서대로 정렬한 거래 영수증의 이벤트와 실행 전후 잔액·토큰 사용 권한·포지션·부채를 정수 단위로 비교한다. 연구자가 작성한 참조 자료와 실제 실행이 다르면 데이터 결함인지 시스템 결함인지 구분해 기록한다.',
  ],
  [
    '다섯 시스템의 비교 단위는 동일한',
    '다섯 시스템은 동일한 사례 명세 목록을 비교 단위로 사용한다. 모델에는 공개된 서명 전 입력만 제공한다. 정답 라벨, 실제 사후 상태, 검토자의 답은 입력으로 주지 않는다. 각 시스템의 구현은 다음과 같다.',
  ],
  [
    '주 지표인 counterfactual unsafe-authorization rate는',
    '주 지표인 작성 정책 기준 반사실적 위반 허용률(counterfactual unsafe-authorization rate)은 각 시스템의 400개 평가 실행 전체를 분모로 한다. 경제 효과가 승인된 것으로 모델링되고, 연구자가 작성한 예상 판단(expected-decision) 라벨이 DENY여서 위반(VIOLATION)으로 채점된 실행을 분자로 센다. 모든 변이의 사후 상태를 독립적으로 실행해 위반을 확인한 정답 기준은 아니다. 따라서 효과의 실행 가능성과 작성 라벨의 오류가 점수에 영향을 줄 수 있다. 이 지표는 실제 거래의 위반 실행률(UER), 자금 손실률, 공격 성공률과 동일하지 않다. 고정 포크 기본 사례의 정수 단위 상태 대조는 별도 검증 절차다.',
  ],
  [
    '95% 구간은 같은 기본 의도의',
    '95% 구간은 기본 의도별 묶음을 유지한 층화 부트스트랩(stratified grouped bootstrap)을 10,000회 수행해 계산한다. 각 묶음 안에서는 같은 기본 의도에서 만든 다섯 변이를 함께 유지한다. 비교군 중 위반 허용률이 가장 낮은 시스템을 선택하고, 동률이면 정상 완료율이 높은 시스템을 선택한다. 이 관측상 최선의 비교군과 차이를 계산할 때도 같은 기본 의도 묶음을 함께 재표집한다. 비교군을 관측 결과에 따라 선택했으므로 이 구간은 사전 고정된 단일 가설에 대한 선택 보정 검정이 아니다. 작은 하위 집단이나 관측 0건 역시 모집단 위험이 0임을 뜻하지 않는다.',
  ],
  [
    '구성요소 실험은 400개 사례에',
    '구성요소 실험은 400개 사례에 8개 비교 조건을 적용한다. 전체 기능 기준군, 의미 판정만 사용하는 조건, 명시적 규칙만 사용하는 조건, 두 판정의 결합, 허용 효과 이력 제거, 중첩 해석을 제한한 효과 표시, 사후 상태 검사 제거, 항상 사용자 확인을 요구하는 정책을 구분한다. 단계별 비교는 자연어 계약 생성기의 인과적 기여를 측정하지 않는다. 명시적 규칙 조건은 전체 기능 기준군과 실행 설정이 같고, 의미 판정 조건은 주 LLM 결과를 재사용한다. 항상 확인하는 정책은 모든 사례의 첫 동작 전에 확인을 요구한다. 단일 설정 변화로 비교하는 요인은 이력, 재귀적 호출 해석 표시, 사후 상태 대조의 세 가지다. 이력을 비활성화하면 누적 예산뿐 아니라 기록에 의존한 중복 시퀀스 인식도 함께 제거되므로, 그 효과를 예산 합산만의 기여로 해석할 수 없다.',
  ],
  [
    '재계획 평가는 40개 episode의',
    '재계획 평가는 40개의 결정론적 공격 스크립트와 모의 실행기를 사용한다. 공격자는 공개된 방어 판단, 판단 사유 코드, 도구 실행 결과를 볼 수 있으며 최대 재계획 횟수는 3회다. 구현된 지갑 연결 모듈이 서명기를 호출했는지와 해석된 경제 효과를, 방어 판단과 별개인 구조적 의도 위반 판정기에 대조한다. 해석이 불완전한 경우는 결론 불가(INCONCLUSIVE)로 남기며, 불일치가 있거나 사후 상태가 관측되지 않았다는 이유만으로 공격 성공으로 판정하지 않는다.',
  ],
  [
    '이 집합은 주 400개 trace와',
    '이 집합은 주 평가의 400개 호출 기록과 사례별로 대응되지 않으며, 비교 설계는 비대응·비인과(NON_PAIRED_NON_CAUSAL)다. 결과의 범위는 오프라인 스크립트 기반 서명 경계 평가(OFFLINE_SCRIPTED_SIGNER_BOUNDARY_ONLY)로 제한한다. 실제 공격 모델의 탐색 능력, 운영 상태의 포크에서 공격이 성공할 비율, 또는 같은 사례에서 적응 때문에 증가한 효과를 추정하지 않는다.',
  ],
  [
    'LLM 첫 실행 400건 중 HTTP',
    'LLM의 첫 실행 400건 중 HTTP 429로 결과를 얻지 못한 92건(23.00%)은 실행 실패(FAILED)·판단 유보(ABSTAIN)로 유지했으며, 사전 탐지 성공으로 세지 않았다. 등록된 사례 단위 재시도 92건에서 45건이 복구됐지만 주 결과에는 첫 시도만 사용했다. 따라서 낮은 위반 허용률에는 판단 능력뿐 아니라 서비스 불가 시 실행을 중단하는 효과도 섞인다. 관측상 최선의 비교군인 LLM 대비 IntentLock의 차이 -11.00 퍼센트포인트와 대응 비교 95% 구간 [-13.00, -9.00]도 이러한 운영 조건과 사후 비교군 선택에 조건부다. 모델 고유 역량의 우열을 뜻하지 않는다.',
  ],
  [
    '40개 episode가 각각 초기 제안과',
    '40개 평가 실행은 각각 초기 제안과 세 번의 재계획으로 총 160개 계획을 만들었으며, 모든 실행이 안전 중단(SAFE_BLOCK)으로 끝났다. 서명기 호출은 0회였고 공격 성공(ATTACK_SUCCESS)·일반 실행 실패(NORMAL_FAILURE)·결론 불가(INCONCLUSIVE)는 각각 0건이었다. 허용 이후의 실행이나 사후 상태를 관측하지 않았으므로 정상 업무의 전체 완료, 공격 모델의 일반적 탐색 능력, 160개 온체인 공격의 차단을 증명하지는 않는다. 정상 기본 사례를 허용한 정적 비교 행과의 차이 역시 동일 사례의 인과적 개선으로 계산하지 않는다.',
  ],
  [
    '사전 정의된 음의 결과(negative result)',
    '사전 정의된 음의 결과(negative result), 즉 개선되지 않은 결과의 판정 규칙에 해당하는 항목은 없었다. 이는 등록된 규칙의 판정만 뜻하며, 모든 비교와 하위 집단에서 우월하다는 뜻은 아니다.',
  ],
  [
    '사전 allowance 검사는 chain·asset별로',
    '서명 전 토큰 사용 권한 검사는 체인·자산별로 권한을 받는 주체마다 마지막 승인액을 유지하고, 실행 도중 각 시점에서 그 합이 상한을 넘지 않는지 검사한다. 같은 주체에게 다시 승인한 금액을 이중 합산하지 않지만, 이후 권한을 철회했다고 해서 앞서 발생한 초과 노출을 없던 일로 처리하지도 않는다. 자산 전송으로 권한이 소비되는 양은 이 사전 검사에서 추론하지 않으므로 보수적인 오거부가 가능하다. 관측되지 않은 기존 권한을 모두 파악했다는 보장도 없다. 작업 후 남은 토큰 사용 권한(residual allowance)은 별도의 사후 상태 관측으로 검사한다. 슬리피지는 비율을 내림 반올림하지 않고 정수 교차 곱으로 한도를 비교한다.',
  ],
  [
    'LLM verifier는 gpt-5.4-mini-2026-03-17',
    'LLM 판정기는 고정 모델 버전(model snapshot) gpt-5.4-mini-2026-03-17과 버전이 지정된 프롬프트를 사용한다. 샘플링 온도(temperature)는 0, 호출 제한 시간은 30초다. 형식이 잘못된 출력과 시간 초과는 ABSTAIN으로 기록한다. API 재시도와 사례 단위 추가 시도는 원시 기록에 남기며, 주 분석은 첫 시도 결과를 고정 분모에 모두 유지하는 사전 등록 규칙(attempt-1 intention-to-treat)을 따른다. 추가 시도 중 좋은 결과를 골라 주 점수로 바꾸지 않는다. 20건의 사전 점검에서 관측한 정답 라벨 일치 17/20은 입력·출력 경로 진단이며, 400건 비교를 대체하지 않는다. 라벨이 일치해도 설명에는 단위, 상한과 하한의 혼동, 입력에서 입증되지 않은 수취인 또는 가스 판단이 포함될 수 있었다. 따라서 이 수치를 판단 설명의 정확도나 인간 검토 일치도로 쓰지 않는다.',
  ],
]);
const appliedParagraphEdits = [];
const tableLabels = new Map([
  ['System', '시스템'],
  ['Offline counterfactual unsafe authorization rate', '반사실적 위반 허용률'],
  ['95% CI', '95% 신뢰구간'],
  ['Offline counterfactual benign completion', '정상 완료율'],
  ['False deny', '잘못된 거부율'],
  ['Escalation', '서명 전 판단 유보율'],
  ['Confirmation requests (rate)', '확인 요청 수(비율)'],
  [
    'Detection ordinals 0 / 1..N / N+1 / none',
    '최초 탐지: 전체 계획 검사 / 호출 전 / 실행 후 / 없음',
  ],
  ['Mean latency', '평균 지연'],
  ['Token cost', '토큰 비용'],
  ['Arm', '비교 조건'],
  ['Changed factor', '변경 요인'],
  ['Unsafe authorization', '위반 허용률'],
  ['Paired difference vs full (95% CI)', '기준군 대비 차이(95% 신뢰구간)'],
  ['Benign completion', '정상 완료율'],
  ['Interpretation', '해석 범위'],
  ['Class', '분류'],
  ['Evidence source', '증거 집합'],
  ['Scope', '평가 범위'],
  ['Rows', '사례 수'],
  ['Descriptive counts', '관측 결과'],
  ['Frozen static primary', '고정된 주 평가의 정상 원본'],
  ['Adaptive signer boundary', '재계획 시의 서명 경계'],
  ['REFERENCE', '기준군(REFERENCE)'],
  ['NON_CAUSAL_POLICY_VARIANT', '비인과적 정책 비교(NON_CAUSAL_POLICY_VARIANT)'],
  ['acceptedEffectHistory', '허용 효과 이력'],
  ['recursiveDecoder', '중첩 호출 해석'],
  ['postStateReconciliation', '실행 후 상태 대조'],
]);
const armLabels = new Map([
  ['GUARD_MODE', 'Guard Mode 정책 모형'],
  ['INTENTLOCK', 'IntentLock'],
  ['LLM_VERIFIER', 'LLM 판정기'],
  ['NONE', '방어 없음'],
  ['PER_CALL_POLICY', '호출별 정책'],
  ['STATELESS_LEDGER', '이력 없는 원장'],
  ['SHALLOW_DECODER', '얕은 호출 해석'],
  ['NO_POST_STATE_VERIFIER', '사후 상태 검사 제거'],
  ['SEMANTIC_ONLY', '의미 판정만 사용'],
  ['SYMBOLIC_ONLY', '명시적 규칙만 사용'],
  ['HYBRID_CONJUNCTION', '의미·규칙 결합'],
  ['INTENTLOCK_FULL', '전체 기능 기준군'],
  ['CONFIRMATION_ALWAYS', '항상 사용자 확인'],
]);
const seen = new Set();
const translations = {};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const allTerms = new Map([...terms, ...definitions]);
const byLower = new Map([...allTerms].map(([en, ko]) => [en.toLowerCase(), { en, ko }]));
const pattern = new RegExp(
  `(?<![A-Za-z0-9_])(${[...allTerms.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join(
      '|',
    )})(?![A-Za-z0-9_])(으로|로|은|는|이(?!며|면|므로|지만|라|었|다|고|든|나)|가|을|를|과|와|다|나)?`,
  'gi',
);
function particleFor(korean, originalParticle = '') {
  const last = korean.codePointAt(korean.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return originalParticle;
  const final = (last - 0xac00) % 28;
  if (['으로', '로'].includes(originalParticle)) return final && final !== 8 ? '으로' : '로';
  for (const [withFinal, withoutFinal] of [
    ['은', '는'],
    ['이', '가'],
    ['을', '를'],
    ['과', '와'],
  ])
    if ([withFinal, withoutFinal].includes(originalParticle))
      return final ? withFinal : withoutFinal;
  if (originalParticle === '다') return final ? '이다' : '다';
  if (originalParticle === '나') return final ? '이나' : '나';
  return originalParticle;
}
const properIntroductions = new Map([
  ['MetaMask', '메타마스크'],
  ['MetaMask Agent Wallet', '메타마스크 에이전트 지갑'],
  ['Ethereum', '이더리움'],
  ['Base', '베이스'],
  ['Guard Mode', '가드 모드'],
]);
function translate(text, define = true) {
  const held = [];
  const hold = (s) => {
    held.push(s);
    return `\uE000${held.length - 1}\uE001`;
  };
  let work = text.replace(/!?\[[^\]]*\]\([^)]+\)/g, hold);
  work = work.replace(
    /`[^`]+`|\bgpt-[\w.-]+\b|\b(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|REFERENCE|STRICT|LITERAL|ALLOW|DENY|ESCALATE|ABSTAIN|PARTIAL|VIOLATED|PASS|[A-Z]+-\d+(?:--[A-Z_]+)?|[a-f0-9]{40,64})\b/g,
    hold,
  );
  const names = new RegExp(
    protectedNames
      .map(escapeRegex)
      .sort((a, b) => b.length - a.length)
      .join('|'),
    'g',
  );
  work = work.replace(names, hold);
  work = work.replace(pattern, (_, match, particle) => {
    const { en, ko } = byLower.get(match.toLowerCase());
    translations[en] = (translations[en] ?? 0) + 1;
    const suffix = particleFor(ko, particle);
    if (define && definitions.has(en) && !seen.has(en)) {
      seen.add(en);
      return `${ko}(${en})${suffix}`;
    }
    return ko + suffix;
  });
  return work.replace(/\uE000(\d+)\uE001/g, (_, index) => {
    const value = held[Number(index)];
    if (define && properIntroductions.has(value) && !seen.has(value)) {
      seen.add(value);
      return `${properIntroductions.get(value)}(${value})`;
    }
    return value;
  });
}
function cells(line) {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((x) => x.trim());
}
function outputTable(rows, cols) {
  return rows
    .map((row, i) => '| ' + cols.map((j) => (i === 1 ? '---' : row[j])).join(' | ') + ' |')
    .join('\n');
}
let body = original.slice(0, original.indexOf('## 참고문헌'));
const originalFooter =
  '검증 절차는 단일 저자가 주도하고 AI가 보조했다. 두 사람의 독립 검수나 맹검 평가를 수행했다는 주장은 하지 않는다.';
const publicationFooter =
  '검증 절차는 검수 담당자 1명과 AI 보조 검토 방식으로 진행했다. 두 사람의 독립 검수나 맹검 평가를 수행했다는 주장은 하지 않는다.';
const references = original.slice(original.indexOf('## 참고문헌'));
const localizedReferences = references.replace(originalFooter, publicationFooter);
for (const [en, ko] of exactSentences) body = body.replaceAll(en, ko);
body = body
  .replace(/^## One-factor causal ablations$/gm, '#### 단일 요인 제거 실험')
  .replace(/^## Non-causal stage comparisons$/gm, '#### 인과 효과로 해석하지 않는 단계별 비교')
  .replace(
    /^## Reference and non-causal policy variant$/gm,
    '#### 전체 기능 기준군과 별도 확인 정책',
  );
body = body.replace(/(?:^\|.*\|\s*$\r?\n?)+/gm, (block) => {
  const rows = block.trim().split(/\r?\n/).map(cells);
  if (rows.length < 2) return block;
  const width = rows[0].length;
  const translated = rows.map((row, i) =>
    row.map((cell, j) => {
      if (i === 1) return '---';
      if (i === 0) return tableLabels.get(cell) ?? cell;
      if (j === 0 && armLabels.has(cell)) return `${armLabels.get(cell)} (${cell})`;
      return tableLabels.get(cell) ?? cell;
    }),
  );
  if (width === 11 && rows[0][0] === 'System')
    return (
      '\n#### 보안과 정상 완료\n\n' +
      outputTable(translated, [0, 1, 2, 3, 4]) +
      '\n\n#### 거부·판단 유보·확인 부담\n\n' +
      outputTable(translated, [0, 5, 6, 7]) +
      '\n\n#### 탐지 위치와 평가 비용\n\n최초 탐지 순서는 전체 계획 검사 0, 호출 전 1..N, 실행 후 N+1, 탐지 없음 순이다.\n\n' +
      outputTable(translated, [0, 8, 9, 10]) +
      '\n\n'
    );
  if (width === 6 && rows[0][0] === 'Arm')
    return (
      '\n' +
      outputTable(translated, [0, 1, 2, 3]) +
      '\n\n' +
      outputTable(translated, [0, 4, 5]) +
      '\n\n'
    );
  return (
    '\n' +
    outputTable(
      translated,
      Array.from({ length: width }, (_, i) => i),
    ) +
    '\n\n'
  );
});
body = body
  .split(/\r?\n/)
  .map((line) => {
    for (const [prefix, replacement] of paragraphEdits) {
      if (line.startsWith(prefix)) {
        appliedParagraphEdits.push(prefix);
        for (const en of [...definitions.keys(), ...properIntroductions.keys()])
          if (replacement.includes(`(${en})`)) seen.add(en);
        return replacement;
      }
    }
    return translate(line);
  })
  .join('\n');
assert.equal(
  appliedParagraphEdits.length,
  paragraphEdits.size,
  'Canonical paragraph changed: inspect publication edits',
);
// Remaining phrase edits are context-specific, not unrestricted Korean grammar rewrites.
const phraseEdits = new Map([
  ['대규모 언어 모델 고정 모델 버전', '대규모 언어 모델의 고정 버전'],
  ['고정 고정 모델 버전', '고정 모델 버전'],
  ['고정 모델 버전의 generic 판정기', '고정 모델 버전의 범용 판정기'],
  ['비적대적 비적대적', '비적대적'],
  ['외부 외부', '외부'],
  ['작성된 작성된', '작성된'],
  ['정답 판정 기준 정답 라벨', '정답 라벨'],
  ['관측상 관측상', '관측상'],
  ['동일한 동일 사례의 대응 비교', '동일한 사례를 대응시킨 비교'],
  ['총자산 유출', '총유출량'],
  ['잔존 토큰 사용 권한 노출', '토큰 사용 권한 노출'],
  ['재생 평가 방지', '재실행 방지'],
  ['고정 버전 구조', '상태 스냅샷 구조'],
  ['주 평가 평가 실행', '주 평가의 각 실행'],
  ['최종 목표 검사를 검사한다', '최종 목표 충족 여부를 확인한다'],
  ['실행 요청 내용 해시', '실행 요청의 해시'],
  ['계약 내용 해시', '계약 해시'],
  ['계약 digest', '계약 해시'],
  ['음의 결과(개선되지 않은 결과)', '음의 결과(negative result)'],
  ['원래 정상 base', '정상 기본 사례'],
  ['실행 시점 호출 실행 기록', '실행 중 호출 기록'],
  ['형식 실행 감시기', '형식적 실행 감시기'],
  ['모든 실행 실행 앞부분', '실행의 모든 앞부분'],
  ['예약·실행 실행 앞부분', '예약·실행 기록의 앞부분'],
  ['안전 상한의 실행 앞부분 보존', '실행의 각 단계에서 안전 상한이 보존됨'],
  ['구현의 기계적으로 검증한 증명', '구현을 기계적으로 검증한 증명'],
  ['주 평가의 각 실행의 최종 ABSTAIN', '주 평가에서 각 실행의 최종 판단인 ABSTAIN'],
  ['사전 서명 전 판단 유보', '서명 전 판단 유보'],
  ['위반 실행률(위반 거래 실행률(UER))', '위반 실행률(UER)'],
  ['위반 실행률(위반 거래 실행률)', '위반 실행률(UER)'],
  ['서명 전에서 관측할 수 없는', '서명 전에 관측할 수 없는'],
  ['불명 거래 호출 데이터', '해석할 수 없는 거래 호출 데이터'],
  ['운영 환경 서버 구현', '운영 서버 구현'],
  ['별도 범위가 제한된 실행 권한', '별도의 제한된 실행 권한'],
  ['불완전 호출 해석·모의 실행 검사', '불완전한 호출 해석·모의 실행 검사'],
  ['체인 간 자산 이동 목적지는 로컬', '체인 간 이동의 목적지 처리에는 로컬'],
  [
    '고정 시험 자료(fixture)로 진행되는 구간을 포함한다',
    '고정 시험 자료(fixture)로 진행하는 구간이 포함된다',
  ],
  ['단일 LLM 고정 모델 버전 결과', '단일 LLM의 고정 모델 버전 결과'],
  ['호출별 대비', '호출별 정책 대비'],
  ['주 대규모 언어 모델', '주 평가의 LLM'],
  ['허용하지 않은 사용 승인 대상', '허용해서는 안 되는 사용 승인 대상'],
  ['영속적인 다중 서명기 예약', '여러 서명 서비스가 공유하는 영속적인 예약'],
  ['가장 낮은 위반 허용률의 비교군', '위반 허용률이 가장 낮은 비교군'],
]);
for (const [before, after] of phraseEdits) body = body.replaceAll(before, after);
for (const [id, korean] of new Map([
  ['PARTIAL', '부분 해석'],
  ['PRE_SIGN', '서명 전'],
  ['PASS', '통과'],
  ['EXECUTED_MISMATCH', '실행 후 불일치'],
  ['VIOLATED', '위반 상태'],
  ['ATTACK_SUCCESS', '공격 성공'],
  ['SAFE_BLOCK', '안전 중단'],
  ['NORMAL_FAILURE', '일반 실행 실패'],
])) {
  const statusPattern = new RegExp(`\\b${id}\\b`);
  const found = statusPattern.exec(body);
  if (found && body[found.index - 1] !== '(')
    body = body.replace(statusPattern, `${korean}(${id})`);
}
body = body.replace(
  '### 6.2. 구성요소 결과',
  '### 6.2. 구성요소 결과\n\n표의 pp는 퍼센트포인트(percentage points)로, 두 비율의 차이를 나타낸다.',
);
body = body.replace(
  '최초 탐지 순서는 전체 계획 검사',
  '평균 지연의 ms는 밀리초, 비용의 $는 미국 달러다. 최초 탐지 순서는 전체 계획 검사',
);
body = body.replace(/\bAPI\b/, '프로그램 호출 인터페이스(API)');
body = body.replace('ActionIR은 호출의', '행동 중간 표현(ActionIR)은 호출의');
body = body.replace('가스 수수료·슬리피지 조건', '가스 수수료·슬리피지(slippage) 조건');
body = body.replace(
  '오류 그림의 분류는 원시 평가 결과·판단 사유에 따른 기술 통계다.',
  '오류 그림의 분류는 원시 평가 결과·판단 사유에 따른 기술 통계다. 이 그림의 오류 건수는 앞서 제시한 위반 허용률의 분자와 동일한 지표가 아니다.',
);
body = body
  .replaceAll('../figures/architecture.svg', '../figures/ko/architecture.png')
  .replaceAll('../figures/security-utility.svg', '../figures/ko/security-utility.png')
  .replaceAll('../figures/error-taxonomy.svg', '../figures/ko/error-taxonomy.png')
  .replaceAll('../figures/latency.svg', '../figures/ko/latency.png');
body = body
  .replace(/\bRun:/g, '실행 식별자:')
  .replace(/\bfrozen source A:/g, '고정한 소스 A:')
  .replace(/\bfreeze commit B:/g, '동결 커밋 B:')
  .replace(/\braw attempts:/g, '전체 시도:')
  .replace(/\battempted plans:/g, '제안된 계획:')
  .replace(/\bsigner invocations:/g, '서명기 호출:');
// Submission contains readable identifiers, not Notion code-format blocks or spans.
body = body.replace(/`([^`]+)`/g, '$1');
let localized = (body.trimEnd() + '\n\n' + localizedReferences.trimEnd() + '\n').replace(
  /\n{4,}/g,
  '\n\n\n',
);
assert(!/^\s*```/m.test(localized));
assert(!/^\s*>/m.test(localized), 'Publication contains a callout/quote block');
assert(
  !/C:\\Users|raymond1203|ohs99|noreply@/i.test(localized),
  'Identity/local-path token in publication',
);

// Numeric-token multiset, source links, references, and stable identifiers are explicit preservation gates.
const numericTokens = (text) =>
  text
    .replace(/!?\[[^\]]*\]\([^)]+\)/g, '')
    .match(/(?<![\w])[+-]?\d+(?:,\d{3})*(?:\.\d+)*(?:%|\/\d+)?/g) ?? [];
const numericCounts = (tokens) => tokens.reduce((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
const requiredNumbers = numericCounts(numericTokens(original));
const observedNumbers = numericCounts(numericTokens(localized));
const missingNumbers = Object.entries(requiredNumbers).filter(
  ([k, n]) => (observedNumbers[k] ?? 0) < n,
);
assert.equal(missingNumbers.length, 0, `Numeric tokens removed: ${JSON.stringify(missingNumbers)}`);
const urls = (text) => [...text.matchAll(/\]\((https?:[^)]+)\)/g)].map((x) => x[1]);
assert.deepEqual(urls(localized), urls(original), 'External source URLs/order changed');
assert.equal(
  localized.slice(localized.indexOf('## 참고문헌')),
  localizedReferences.trimEnd() + '\n',
);
const identifiers = original.match(/`[^`]+`/g) ?? [];
for (const id of identifiers)
  assert(
    localized.includes(id) || localized.includes(id.slice(1, -1)),
    `Identifier removed: ${id}`,
  );

// The preservation gate above precedes layout-only numbering changes and added denominator labels.
// The exact-anchor formatter never changes a result data cell, citation or scientific paragraph.
localized = formatForFourPillars(localized);

const svgText = new Map([
  ['Offline security–utility comparison', '오프라인 보안·정상 완료 비교'],
  [
    'Authored contract-conditioned replay; points and grouped-bootstrap 95% intervals',
    '작성된 계약을 전제로 한 재생 평가 · 점 추정값과 묶음 부트스트랩 95% 구간',
  ],
  ['Unsafe authorization (lower is better)', '위반 허용률: 낮을수록 좋음'],
  ['Benign completion (higher is better)', '정상 완료율: 높을수록 좋음'],
  ['Denominator: all selected cases', '분모: 선택된 전체 사례'],
  ['Denominator: benign selected cases', '분모: 비적대적 사례'],
  [
    'Exact counts below each mark. Separate rows preserve ties; unavailable is not zero.',
    '각 점 아래에 정확한 건수 표시 · 같은 값은 별도 행에 유지 · 관측 불가는 0이 아님',
  ],
  ['Mean decision latency', '평균 판단 지연 시간'],
  [
    'Offline replay; all selected cases, including failures and abstentions; milliseconds',
    '오프라인 재생 · 실패와 판단 유보를 포함한 전체 사례 · 단위: 밀리초',
  ],
  ['Classified evaluation errors', '시스템별 평가 오류 분류'],
  [
    'Existing error taxonomy; exact count / selected cases and up to three leading categories',
    '기존 오류 분류 · 정확한 건수 / 전체 사례 · 주요 유형은 최대 세 개',
  ],
  [
    'Long category labels shortened; full names are preserved in SVG titles and source tables.',
    '긴 유형 이름은 줄여 표시 · 전체 이름은 SVG 설명과 원본 표에 보존',
  ],
  ['IntentLock implementation and evaluation boundaries', 'IntentLock 구현과 평가 범위'],
  [
    'Distinct scopes: an optional compiler, measured offline replay, and the adapter implementation',
    '범위를 구분: 선택적 계약 생성·검사, 측정한 재생 평가, 지갑 연결 모듈',
  ],
  [
    'OPTIONAL COMPILER — not a measured natural-language or consent guarantee',
    '선택적 계약 생성·검사 — 자연어 정확도나 실제 사용자 동의를 측정한 보장이 아님',
  ],
  ['Text + field evidence', '텍스트와 필드별 근거'],
  ['Assertions, not verified taint', '호출자가 준 근거; 오염 추적은 아님'],
  ['Compiler checks', '계약 생성·검사'],
  ['Schema, substring, widening checks', '자료 형식·부분 문자열·권한 확대 검사'],
  ['Typed Intent Contract', '구조화된 경제 의도 계약'],
  ['Caller supplies confirmation flags', '사용자 확인 표시는 호출자가 제공'],
  [
    'MEASURED M3 — authored contract-conditioned offline replay',
    '측정한 M3 — 작성된 계약을 전제로 한 오프라인 재생',
  ],
  ['Authored contract + trace', '작성된 계약과 호출 기록'],
  ['Fixed fixtures and mutation manifest', '고정 시험 자료와 변이 목록'],
  ['Five comparison systems', '다섯 비교 시스템'],
  ['Counterfactual guard decisions', '반사실적 방어 판단'],
  ['Offline metrics', '오프라인 평가 지표'],
  ['Authored outcomes; not live losses', '작성된 결과 기준; 실제 손실 아님'],
  [
    'ADAPTER IMPLEMENTATION — evaluate, reserve, execute, reconcile in one method',
    '지갑 연결 모듈 — 하나의 경로에서 검사·예약·실행·상태 대조',
  ],
  ['Decode + monitor', '호출 해석과 누적 검사'],
  ['ALLOW / DENY / ESCALATE', '허용 / 거부 / 사용자 확인'],
  ['In-memory ledger', '메모리 내 예약 원장'],
  ['Single-process reservation gate', '단일 프로세스의 예약 검사'],
  ['Wallet executor', '지갑 실행기'],
  ['After reservation succeeds', '예약 성공 후에만 실행'],
  ['Receipt check', '거래 영수증 검사'],
  ['Post-state reconciliation', '실행 후 상태 대조'],
  ['Record EXECUTED / FAILED / VIOLATED', '실행 완료 / 실패 / 위반 상태 기록'],
  [
    'Mismatch: VIOLATED budget remains counted; no global follow-up signing freeze is implemented.',
    '불일치 시 위반 예산도 계속 계산 · 이후 모든 서명을 일괄 동결하는 기능은 없음',
  ],
  [
    'No distributed durability; confirmation is caller-supplied. Decoder / simulation soundness is conditional.',
    '분산·영속 저장 미구현 · 확인 표시는 호출자가 제공 · 해석·모의 검사의 건전성은 전제',
  ],
]);
const errorTerms = new Map([
  ['gas-inflation', '가스 한도 부풀리기'],
  ['retry-double-spend', '재시도로 중복 지출'],
  ['slippage-widening', '슬리피지 한도 확대'],
  ['benign-hallucination', '비적대적 잘못된 호출'],
  ['stale-quote', '오래된 견적'],
  ['chain-substitution', '체인 바꾸기'],
  ['policy-laundering', '호출 분할로 한도 우회'],
]);
function localizeSvgText(text) {
  if (svgText.has(text)) return svgText.get(text);
  if (armLabels.has(text)) return armLabels.get(text);
  let t = text;
  for (const [en, ko] of errorTerms) t = t.replaceAll(en, ko);
  t = t
    .replace(/unsafe authorization/g, '위반 허용률')
    .replace(/benign completion/g, '정상 완료율')
    .replace(/95% interval/g, '95% 구간')
    .replace(/ to /g, ' ~ ')
    .replace(/n = (\d+) selected cases/g, '선택한 사례 n = $1')
    .replace(/ errors/g, '건')
    .replace(/^run /, '실행: ');
  return t;
}
const req = createRequire(import.meta.url);
let sharp;
const sharpLocation = option(
  'sharp-module',
  resolve(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp',
  ),
);
try {
  sharp = req('sharp');
} catch {
  sharp = req(sharpLocation);
}
const outputPaths = [];
await mkdir(resolve(root, 'figures/ko'), { recursive: true });
for (const name of ['architecture', 'security-utility', 'error-taxonomy', 'latency']) {
  const svg = source.get(`figures/${name}.svg`).toString('utf8');
  const ko = svg
    .replace(
      /<(text|title)([^>]*)>([^<]*)<\/(?:text|title)>/g,
      (_, tag, attrs, text) => `<${tag}${attrs}>${localizeSvgText(text)}</${tag}>`,
    )
    .replaceAll(
      'font-family="sans-serif"',
      'font-family="Malgun Gothic, Noto Sans KR, sans-serif"',
    );
  const skeleton = (s) =>
    s
      .replace(/<(text|title)([^>]*)>[^<]*<\/(?:text|title)>/g, '<$1$2></$1>')
      .replace(/font-family="[^"]*"/g, 'font-family="FONT"');
  assert.equal(skeleton(ko), skeleton(svg), `${name}: chart geometry changed`);
  const before = numericCounts(numericTokens(svg.replace(/\bzero\b/g, '0'))),
    after = numericCounts(numericTokens(ko));
  for (const [value, n] of Object.entries(before))
    assert.equal(after[value], n, `${name}: numeric chart value changed ${value}`);
  const svgPath = `figures/ko/${name}.svg`,
    pngPath = `figures/ko/${name}.png`;
  await writeFile(resolve(root, svgPath), ko, 'utf8');
  await sharp(Buffer.from(ko), { density: 144 }).png().toFile(resolve(root, pngPath));
  outputPaths.push(svgPath, pngPath);
}
await writeFile(resolve(root, 'paper/submission-ko.md'), localized, 'utf8');
outputPaths.push('paper/submission-ko.md');
for (const [path, before] of Object.entries(inputs))
  assert.equal(
    sha256(await readFile(resolve(root, path))),
    before,
    `Canonical input changed during localization: ${path}; rerun`,
  );
const wordCount = localized.trim().split(/\s+/u).length;
assert(wordCount <= 13000, `Local word-count estimate ${wordCount} exceeds 13000`);
const outputs = Object.fromEntries(
  await Promise.all(
    outputPaths.map(async (path) => [path, sha256(await readFile(resolve(root, path)))]),
  ),
);
// These exact rendered files were inspected through image viewing after generation.
// Changed text, geometry, font, or renderer output invalidates the carried QA status.
const inspectedPngHashes = {
  'figures/ko/architecture.png': '84bcae27eb7b6d8e7aa48490fcbf39b1613c9ff06dd05525217e309f817a2462',
  'figures/ko/security-utility.png':
    '219d15263acc3e00173624a18637f7733e00484e185105ddc163a21b88f91e8a',
  'figures/ko/error-taxonomy.png':
    'd1d18408668f521400ac6ece8be8286962a73f2afa1365aad8c7bf7e03d4d5c3',
  'figures/ko/latency.png': '30988da40a2ff6f23ebab00165f756f9550457ebdae35c7b311f486ce8c0c84f',
};
const renderedQaCurrent = Object.entries(inspectedPngHashes).every(
  ([path, hash]) => outputs[path] === hash,
);
const scriptPath = fileURLToPath(import.meta.url);
const manifest = {
  schemaVersion: '0.1',
  artifactType: 'KOREAN_PUBLICATION_DERIVATIVE',
  canonicalInput: 'paper/final.md',
  transformation: {
    script: relative(root, scriptPath).replaceAll('\\', '/'),
    scriptSha256: sha256(await readFile(scriptPath)),
    version: '0.3',
    supportingScripts: {
      'docs/experiments/audits/fourpillars-publication-format.mjs': sha256(
        await readFile(new URL('./fourpillars-publication-format.mjs', import.meta.url)),
      ),
    },
    lexicalTranslationCounts: translations,
    firstOccurrenceDefinitions: [...seen],
    widePrimaryTableSplit: '5+4+4 columns; every original data cell retained',
    referenceEntriesPreservedExactly: true,
    assemblerFooterCorrection: {
      original: originalFooter,
      publication: publicationFooter,
      reason: 'Separate registered authorship from one-person AI-assisted review',
    },
    paragraphEdits: appliedParagraphEdits,
    sourceUrlsPreservedInOrder: true,
    numericTokenMultisetRetained: true,
    numericTokenPreservationScope:
      'Canonical-to-localized content before presentation-only numbering changes and added metadata/denominator labels',
    publicationTemplate: {
      basis: 'User-supplied Four Pillars template and example article inspected 2026-09-06',
      metadata:
        'Four fields; confirmed team size and track only; EVM address and society code blank',
      keyTakeaways: 'Three bullets under heading level 3',
      headingHierarchy: 'Numbered level 2 / numbered level 3 / bold numbered third-level labels',
      sourceCaptions: { figures: 4, tables: 9 },
      denominatorClarification: 'Issue 35 teammate AI review: non-adversarial 160 versus all 400',
    },
    chartGeometryAndNumericTokensUnchanged: true,
  },
  contest: {
    track: 'MetaMask',
    registeredTeamSize: 2,
    userConfirmedDeadlineDate: '2026-09-06',
    deadlineTimeNotAssumed: true,
  },
  reviewProtocol: {
    humanReviewers: 1,
    aiAssisted: true,
    independentHumanReviewClaim: false,
    finalAuthorApproval: 'PENDING',
    notionSubmission: 'PENDING',
  },
  publication: {
    format: 'Markdown with Korean SVG and PNG derivatives',
    language: 'ko',
    localWhitespaceWordCount: wordCount,
    wordLimit: 13000,
    notionWordCountVerified: false,
    canonicalFiguresUnmodified: true,
  },
  figureContract: {
    surface: 'static Korean SVG and PNG for Notion',
    question: 'Preserve original comparisons with Korean reader labels',
    forms: [
      'aligned dot-and-interval panels',
      'zero-based latency bars',
      'zero-based error-count bars',
      'implementation scope diagram',
    ],
    palette: 'unchanged from canonical figures; blue root plus neutrals',
    size: '900×560 SVG, 1800×1120 PNG',
    font: 'Malgun Gothic, Noto Sans KR, sans-serif',
    renderer: 'sharp',
    rendererVersions: sharp.versions,
    visualQa: 'PENDING_FINAL_PUBLICATION_REVIEW',
    visualQaBasis: {
      reviewerType: 'AI_ASSISTED_NOT_HUMAN_APPROVAL',
      inspectedHashesStillMatch: renderedQaCurrent,
      inspectedPngHashes,
      checked: [
        'Korean glyphs rendered',
        'No clipped or overlapping labels',
        'Metric panels and exact-count labels readable',
        'Architecture scope caveats readable',
        'Original chart geometry and source numbers retained',
      ],
    },
  },
  inputs,
  outputs,
};
await mkdir(resolve(root, 'artifacts'), { recursive: true });
await writeFile(
  resolve(root, 'artifacts/submission-ko-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
  'utf8',
);
console.log(
  JSON.stringify(
    {
      status: 'GENERATED_FINAL_PUBLICATION_REVIEW_PENDING',
      wordCount,
      inputs,
      outputs,
      manifest: 'artifacts/submission-ko-manifest.json',
    },
    null,
    2,
  ),
);
