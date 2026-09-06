/** Presentation-only pass. Exact replacements fail closed when the reviewed source changes. */
import assert from 'node:assert/strict';

export function formatForFourPillars(source) {
  let text = source;
  const replaceOnce = (before, after) => {
    assert.equal(text.split(before).length, 2, `Expected one publication anchor: ${before}`);
    text = text.replace(before, after);
  };
  replaceOnce(
    '## 핵심 요약\n\n',
    '팀 EVM 주소:\n\n팀 인원수: 2명\n\n참가 트랙: MetaMask\n\n학회 코드 넘버:\n\n### Key Takeaways\n\n',
  );
  const summaryStart = text.indexOf('### Key Takeaways');
  const summaryEnd = text.indexOf('## 초록');
  assert(summaryEnd > summaryStart);
  const summary = text.slice(summaryStart, summaryEnd);
  assert.equal((summary.match(/^[123]\. /gm) ?? []).length, 3);
  text =
    text.slice(0, summaryStart) + summary.replace(/^[123]\. /gm, '- ') + text.slice(summaryEnd);
  replaceOnce('## 초록\n\n', '');
  text = text.replace(/^(### \d+\.\d+)\. /gm, '$1 ');
  for (const [heading, numbered] of [
    ['보안과 정상 완료', '6.1.1'],
    ['거부·판단 유보·확인 부담', '6.1.2'],
    ['탐지 위치와 평가 비용', '6.1.3'],
    ['단일 요인 제거 실험', '6.2.1'],
    ['인과 효과로 해석하지 않는 단계별 비교', '6.2.2'],
    ['전체 기능 기준군과 별도 확인 정책', '6.2.3'],
  ])
    replaceOnce(`#### ${heading}`, `**${numbered} ${heading}**`);
  replaceOnce(
    '| 시스템 | 잘못된 거부율 | 서명 전 판단 유보율 | 확인 요청 수(비율) |',
    '| 시스템 | 잘못된 거부율 (비적대적 160건) | 서명 전 판단 유보율 (전체 400건) | 확인 요청 수 (전체 400건 중 비율) |',
  );
  replaceOnce(
    '**6.1.1 보안과 정상 완료**',
    '**6.1.1 보안과 정상 완료**\n\n분모: 위반 허용률은 전체 사례 400건, 정상 완료율은 비적대적 사례 160건이다. 비적대적 집합은 정상 원본 80건과 비적대적 의도 이탈 80건으로 구성된다.',
  );
  replaceOnce(
    '**6.1.2 거부·판단 유보·확인 부담**',
    '**6.1.2 거부·판단 유보·확인 부담**\n\n잘못된 거부율의 분모인 비적대적 160건에는 정상 원본 80건과 의도 이탈 80건이 함께 들어 있다. 확인 요청 수는 실제 사용자가 응답한 횟수가 아니라 최종 판단 유보를 기준으로 집계한다.',
  );
  replaceOnce(
    '표의 pp는 퍼센트포인트(percentage points)로, 두 비율의 차이를 나타낸다.',
    '표의 pp는 퍼센트포인트(percentage points)로, 두 비율의 차이를 나타낸다. 아래 구성요소 표에서도 각 조건의 위반 허용률은 전체 400건, 정상 완료율은 비적대적 160건을 분모로 사용한다.',
  );
  const figureSources = new Map([
    [
      'architecture',
      '본 연구의 구현 경계와 설계. 선택적 의도 계약 생성, 주 오프라인 재생 평가와 별도 서명 경계 구현을 구분해 도식화.',
    ],
    [
      'security-utility',
      '본 연구의 주 평가 첫 시도 집계. 위반 허용률은 전체 400건, 정상 완료율은 비적대적 160건 기준이다. 점은 관측 비율이며, 구간은 작성된 기본 의도별 묶음 부트스트랩 결과.',
    ],
    [
      'error-taxonomy',
      '본 연구의 주 평가 첫 시도 오류 분류. 시스템별 전체 400건의 기술 통계이며 위반 허용 건수와는 다른 지표.',
    ],
    [
      'latency',
      '본 연구의 주 평가 첫 시도 평가 경로 시간 기록. 단위는 밀리초이며 거래 확정·사용자 확인까지의 전체 지연 시간이 아님.',
    ],
  ]);
  for (const [name, description] of figureSources) {
    const line = text.split('\n').find((value) => value.endsWith(`](../figures/ko/${name}.png)`));
    assert(line, `Missing figure: ${name}`);
    replaceOnce(line, `${line}\n\nSource: ${description}`);
  }
  let tableIndex = 0;
  text = text.replace(/^\|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/gm, (table) => {
    const group =
      tableIndex === 0
        ? '비교 시스템 정의와 실험 설정'
        : tableIndex < 4
          ? '주 평가 첫 시도 집계'
          : tableIndex < 8
            ? '구성요소 비교 집계'
            : '비대응·비인과 서명 경계 기술 비교';
    tableIndex++;
    return `${table.trimEnd()}\n\nSource: 본 연구의 ${group}. 실행 식별자와 증거 범위는 해당 절 및 재현성 절에 명시.\n`;
  });
  assert.equal(tableIndex, 9, 'Unexpected table count');
  assert.equal((text.match(/^Source: /gm) ?? []).length, 13);
  assert(!/^####/m.test(text), 'Notion third-level subheading must use bold text');
  const tableData = (value) =>
    [...value.matchAll(/^\|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/gm)].map((match) =>
      match[0].trim().split(/\r?\n/).slice(2),
    );
  assert.deepEqual(tableData(text), tableData(source), 'Presentation changed a table data row');
  return text.replace(/\n{3,}/g, '\n\n');
}
