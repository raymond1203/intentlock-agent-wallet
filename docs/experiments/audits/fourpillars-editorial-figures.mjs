/**
 * Original technical figures informed by the user's supplied publication
 * screenshots: dark cards, restrained pastel control marks, and a teal accent.
 * The precise palette is our choice, not an official Four Pillars specification.
 * This module is pure: callers own asset rendering, file writes, and provenance.
 */
const C = {
  ink: '#F2F3F5',
  paper: '#121212',
  accent: '#38ABA2',
  gray: '#ADB4D4',
  muted: '#B5B8C2',
  rule: '#3B3D43',
  white: '#1C1D22',
};
const ORDER = ['NONE', 'GUARD_MODE', 'LLM_VERIFIER', 'PER_CALL_POLICY', 'INTENTLOCK'];
const LABELS = {
  NONE: '보호 장치 없음',
  GUARD_MODE: '가드 모드 정책 모형',
  LLM_VERIFIER: '언어모델 검증기',
  PER_CALL_POLICY: '호출별 정책',
  INTENTLOCK: 'IntentLock',
};
const MUTATIONS = {
  'amount-inflation': '금액 부풀리기',
  'chain-substitution': '체인 바꾸기',
  'gas-inflation': '가스 비용 부풀리기',
  'hidden-batch': '숨긴 일괄 호출',
  'policy-laundering': '호출 분할로 한도 우회',
  'recipient-substitution': '수신자 바꾸기',
  'retry-double-spend': '재시도 중복 지출',
  'slippage-widening': '슬리피지 확대',
  'stale-quote': '오래된 견적',
  'unlimited-approval': '무제한 승인',
  'benign-hallucination': '비적대적 잘못된 호출',
  BENIGN_ORIGINAL: '정상 원본 처리 오류',
  LLM_OUTPUT_UNAVAILABLE: '언어모델 출력 없음',
  'partial-completion': '부분 완료',
};

function xml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char],
  );
}

function text(x, y, value, size = 24, fill = C.ink, weight = 400, extra = '') {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${xml(value)}</text>`;
}

function line(x1, y1, x2, y2, stroke = C.rule, width = 1, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
}

function rect(x, y, width, height, fill, extra = '') {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${extra}/>`;
}

function data(system, metric, value, extra = {}) {
  return Object.entries({ system, metric, value, ...extra })
    .map(([key, val]) => `data-${xml(key)}="${xml(val)}"`)
    .join(' ');
}

function frame(number, title, subtitle, body, footer, height = 1080) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}" role="img" aria-labelledby="title desc">
<title id="title">${xml(title)}</title>
<desc id="desc">${xml(`${subtitle} ${footer.join(' ')}`)}</desc>
<style>text{font-family:"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-variant-numeric:tabular-nums}line,rect,circle,path{vector-effect:non-scaling-stroke}</style>
${rect(0, 0, 1440, height, C.paper)}
${text(64, 53, 'INTENTLOCK / RESEARCH', 20, C.ink, 600, 'letter-spacing="2"')}
${text(1376, 53, `FIGURE ${String(number).padStart(2, '0')}`, 20, C.muted, 500, 'text-anchor="end"')}
${line(64, 76, 1376, 76, C.ink)}
${text(720, 143, title, 38, C.ink, 700, 'text-anchor="middle"')}
${text(720, 187, subtitle, 23, C.muted, 400, 'text-anchor="middle"')}
${body}
${line(64, height - 101, 1376, height - 101)}
${footer.map((value, index) => text(64, height - 65 + index * 29, value, 18, C.muted)).join('')}
</svg>`;
}

function assertInput(results) {
  if (!results || !Array.isArray(results.systems) || results.systems.length !== ORDER.length) {
    throw new Error('Expected exactly five supported research systems.');
  }
  const systems = new Map(results.systems.map((entry) => [entry.system, entry]));
  if (systems.size !== ORDER.length || ORDER.some((name) => !systems.has(name))) {
    throw new Error('Research system names are missing, duplicated, or unsupported.');
  }
  for (const name of ORDER) {
    const row = systems.get(name);
    const a = row.aggregate;
    if (
      !a ||
      a.system !== name ||
      !Number.isInteger(a.total) ||
      a.total <= 0 ||
      !Number.isInteger(a.benignTotal) ||
      a.benignTotal <= 0 ||
      a.benignTotal > a.total
    ) {
      throw new Error(`Invalid denominators for ${name}.`);
    }
    // Figure annotations explicitly describe the frozen 400/160-case design.
    if (a.total !== 400 || a.benignTotal !== 160) {
      throw new Error(`Unsupported study size for ${name}; revise annotations before reuse.`);
    }
    for (const [count, denominator, rate, interval] of [
      ['unsafeExecutions', 'total', 'unsafeExecutionRate', 'unsafeExecutionRate95'],
      ['benignCompleted', 'benignTotal', 'benignCompletionRate', 'benignCompletionRate95'],
    ]) {
      const ci = row[interval];
      if (
        !Number.isInteger(a[count]) ||
        a[count] < 0 ||
        a[count] > a[denominator] ||
        !Number.isFinite(a[rate]) ||
        Math.abs(a[rate] - a[count] / a[denominator]) > 1e-12 ||
        !ci ||
        ![ci.point, ci.lower95, ci.upper95].every(Number.isFinite) ||
        ci.lower95 < 0 ||
        ci.upper95 > 1 ||
        ci.lower95 > ci.point ||
        ci.upper95 < ci.point ||
        Math.abs(ci.point - a[rate]) > 1e-12
      ) {
        throw new Error(`Inconsistent ${rate} or interval for ${name}.`);
      }
    }
    if (
      !Number.isFinite(a.meanLatencyMs) ||
      a.meanLatencyMs < 0 ||
      a.meanLatencyMs > 1500 ||
      (name !== 'LLM_VERIFIER' && a.meanLatencyMs > 0.5)
    ) {
      throw new Error(`Latency exceeds the declared figure scale for ${name}.`);
    }
    if (
      !row.errorsByMutation ||
      Object.entries(row.errorsByMutation).some(
        ([key, value]) => !Object.hasOwn(MUTATIONS, key) || !Number.isInteger(value) || value < 0,
      )
    ) {
      throw new Error(`Invalid or untranslated error taxonomy for ${name}.`);
    }
    if (Object.values(row.errorsByMutation).reduce((sum, value) => sum + value, 0) > a.total) {
      throw new Error(`Error counts exceed the case denominator for ${name}.`);
    }
  }
  return ORDER.map((name) => systems.get(name));
}

function cumulativeBudget() {
  let body = text(64, 244, '설명용 예시 · 실험 결과 아님', 22, C.accent, 700);
  body += rect(64, 272, 1312, 83, C.white);
  body += text(92, 323, '사용자 의도: 두 번의 호출을 포함한 총지출은 100 이하', 28, C.ink, 600);
  const panels = [
    {
      x: 64,
      system: 'PER_CALL_POLICY',
      label: '호출만 따로 검사',
      note: '각 호출 60 ≤ 100 → 둘 다 허용',
      cumulative: false,
    },
    {
      x: 762,
      system: 'INTENTLOCK',
      label: '이미 쓴 금액까지 검사',
      note: '60 + 60 = 120 > 100 → 두 번째 거절',
      cumulative: true,
    },
  ];
  for (const p of panels) {
    body += text(p.x, 421, p.label, 30, p.cumulative ? C.accent : C.ink, 700);
    body += text(p.x, 461, p.note, 23, C.muted);
    const chartX = p.x + 106;
    const scale = 3.25;
    body += line(chartX, 501, chartX, 719, C.rule);
    body += line(
      chartX + 100 * scale,
      501,
      chartX + 100 * scale,
      719,
      C.ink,
      1,
      'stroke-dasharray="5 5"',
    );
    body += text(chartX + 100 * scale, 489, '한도 100', 20, C.muted, 500, 'text-anchor="middle"');
    body += text(p.x, 547, '1차 호출', 22);
    body += text(p.x, 652, '2차 호출', 22);
    body += rect(
      chartX,
      517,
      60 * scale,
      42,
      C.gray,
      data(p.system, 'illustrativeSpend', 60, { scope: 'illustrative', ordinal: 1 }),
    );
    body += text(chartX + 60 * scale + 12, 547, '60 허용', 22);
    if (!p.cumulative) {
      body += rect(
        chartX,
        622,
        60 * scale,
        42,
        C.gray,
        data(p.system, 'illustrativeSpend', 60, { scope: 'illustrative', ordinal: 2 }),
      );
      body += text(chartX + 60 * scale + 12, 652, '60 허용', 22);
      body += text(p.x, 767, '실행 합계 120', 32, C.ink, 700);
      body += text(p.x, 809, '각 호출의 조건은 맞지만, 총액은 의도를 벗어난다.', 22, C.muted);
    } else {
      body += rect(
        chartX,
        622,
        60 * scale,
        42,
        C.gray,
        data(p.system, 'illustrativePreviouslySpent', 60, { scope: 'illustrative' }),
      );
      body += rect(
        chartX + 60 * scale,
        622,
        60 * scale,
        42,
        'none',
        `stroke="${C.accent}" stroke-width="2" stroke-dasharray="5 4" ${data(p.system, 'illustrativeRejectedSpend', 60, { scope: 'illustrative' })}`,
      );
      body += text(chartX + 90 * scale, 695, '+60 거절', 22, C.accent, 600, 'text-anchor="middle"');
      body += text(p.x, 767, '실행 합계 60', 32, C.accent, 700);
      body += text(p.x, 809, '예약·사용량을 이어서 보면 다음 호출을 막을 수 있다.', 22, C.muted);
    }
  }
  body += line(710, 402, 710, 847);
  return frame(
    1,
    '한 번씩은 허용해도, 합치면 의도를 벗어날 수 있다',
    '검사의 단위를 호출에서 실행 과정으로 넓혀야 하는 이유',
    body,
    [
      'Source: 본 연구의 누적 예산 규칙을 설명하기 위한 자체 도식.',
      '숫자 100·60·120은 이해를 돕기 위한 예시이며, 측정값이나 실제 지출 내역이 아니다.',
    ],
    980,
  );
}

function card(x, y, width, title, subtitle, accent = false) {
  return (
    rect(x, y, width, 94, C.white, `stroke="${accent ? C.accent : C.rule}"`) +
    text(x + 22, y + 36, title, 25, accent ? C.accent : C.ink, 600) +
    text(x + 22, y + 70, subtitle, 20, C.muted)
  );
}

function arrow(x1, y, x2, color = C.gray) {
  return (
    line(x1, y, x2 - 8, y, color, 1.5) +
    `<path d="M ${x2 - 14} ${y - 6} L ${x2 - 6} ${y} L ${x2 - 14} ${y + 6}" fill="none" stroke="${color}" stroke-width="1.5"/>`
  );
}

function architecture() {
  let body = text(64, 258, '01 / 선택 기능: 추출된 계약 후보와 필드별 근거 검사', 26, C.muted, 600);
  body += card(64, 282, 376, '텍스트·계약 후보', '필드별 근거를 함께 제공');
  body += arrow(448, 328, 512);
  body += card(520, 282, 376, '계약 생성·검사', '형식·근거·권한 확대 검사');
  body += arrow(904, 328, 968);
  body += card(976, 282, 400, '구조화된 경제 의도 계약', '확인 표시는 호출자가 제공');
  body += text(
    64,
    414,
    '컴파일러의 출력만으로 실제 동의나 외부 입력의 오염 여부가 증명되지는 않는다.',
    22,
    C.muted,
  );
  body += line(64, 448, 1376, 448);
  body += text(
    64,
    489,
    '02 / 본문에서 측정한 범위: 동결된 400개 사례의 오프라인 재생',
    26,
    C.ink,
    600,
  );
  body += card(64, 516, 376, '작성된 계약·호출 기록', '정상·의도 이탈·공격 변형');
  body += arrow(448, 562, 512);
  body += card(520, 516, 376, '5개 보호 체계 비교', '같은 사례와 판정 기준');
  body += arrow(904, 562, 968);
  body += card(976, 516, 400, '안전성·완료율·오류', '400개 × 5개 체계 = 2,000건');
  body += text(
    64,
    648,
    '실제 지갑을 대상으로 한 400회 공격 실험이나 자연어 동의 실험으로 읽어서는 안 된다.',
    22,
    C.muted,
  );
  body += line(64, 682, 1376, 682);
  body += text(64, 723, '03 / 별도 어댑터 경로: 실행 전후에 상태를 잇는 구조', 26, C.accent, 600);
  const stages = [
    ['평가', 'evaluate · 규칙 검사'],
    ['예약', 'reserve · 사용량 확보'],
    ['실행', 'execute · 허용 작업'],
    ['대조·정산', 'reconcile · 결과 확인'],
  ];
  stages.forEach(([title, subtitle], index) => {
    const x = 64 + index * 344;
    body += card(x, 750, 280, title, subtitle, true);
    if (index < stages.length - 1) body += arrow(x + 290, 796, x + 334, C.accent);
  });
  body += text(64, 891, '구현 경계', 23, C.ink, 700);
  body += text(
    64,
    928,
    '단일 프로세스의 메모리 상태 · 지갑 전체의 서명 중단을 보장하지 않음',
    23,
    C.muted,
  );
  body += text(
    64,
    965,
    '사용자의 실제 동의 보장은 별도 과제 · 세 경로의 증거를 하나의 실험으로 합치지 않음',
    23,
    C.muted,
  );
  return frame(
    2,
    '정책 생성, 결과 측정, 지갑 연결은 서로 다른 증거다',
    '어디를 구현했고 어디를 측정했는지 분리해서 읽기',
    body,
    [
      'Source: 본 연구의 구현 구조와 오프라인 재생 실험 설계.',
      '화살표는 각 경로 내부의 처리 순서다. 선택 컴파일러 → 실지갑 보호의 종단 간 검증을 뜻하지 않는다.',
    ],
    1110,
  );
}

function rateAxis(x, width, yTop, yBottom) {
  return [0, 25, 50, 75, 100]
    .map((tick) => {
      const at = x + (width * tick) / 100;
      return (
        line(at, yTop, at, yBottom) +
        text(at, yBottom + 31, `${tick}`, 19, C.muted, 400, 'text-anchor="middle"')
      );
    })
    .join('');
}

function securityUtility(rows) {
  const panels = [
    {
      x: 366,
      width: 430,
      title: '위반 허용률 ↓',
      rate: 'unsafeExecutionRate',
      ci: 'unsafeExecutionRate95',
      count: 'unsafeExecutions',
      denominator: 'total',
    },
    {
      x: 938,
      width: 430,
      title: '정상 작업 완료율 ↑',
      rate: 'benignCompletionRate',
      ci: 'benignCompletionRate95',
      count: 'benignCompleted',
      denominator: 'benignTotal',
    },
  ];
  let body = text(64, 260, '비교 체계', 24, C.muted, 600);
  panels.forEach((p) => {
    body += text(p.x, 260, p.title, 27, C.ink, 700);
    body += text(
      p.x,
      296,
      p.denominator === 'total'
        ? '작성 정책 기준 · 전체 400건'
        : '비적대적 160건: 원본 80 + 이탈 80',
      20,
      C.muted,
    );
    body += rateAxis(p.x, p.width, 330, 802);
  });
  rows.forEach((row, index) => {
    const y = 373 + index * 96;
    const fill = row.system === 'INTENTLOCK' ? C.accent : C.gray;
    body += text(64, y - 11, LABELS[row.system], 25, fill, 600);
    body += text(64, y + 20, row.system, 18, C.muted);
    for (const p of panels) {
      const a = row.aggregate;
      const ci = row[p.ci];
      const low = p.x + ci.lower95 * p.width;
      const high = p.x + ci.upper95 * p.width;
      const point = p.x + a[p.rate] * p.width;
      const attrs = data(row.system, p.rate, a[p.rate], {
        low: ci.lower95,
        high: ci.upper95,
        count: a[p.count],
        denominator: a[p.denominator],
      });
      body += `<g ${attrs}>${line(low, y, high, y, fill, 3)}${line(low, y - 7, low, y + 7, fill, 2)}${line(high, y - 7, high, y + 7, fill, 2)}</g>`;
      body += `<circle cx="${point}" cy="${y}" r="6" fill="${fill}" ${attrs}/>`;
      body += text(
        p.x + p.width,
        y - 25,
        `${a[p.count]}/${a[p.denominator]} · ${(a[p.rate] * 100).toFixed(2)}%`,
        22,
        fill,
        600,
        'text-anchor="end"',
      );
    }
  });
  body += text(796, 850, '% · 동일한 0–100 축', 19, C.muted, 400, 'text-anchor="end"');
  body += text(1368, 850, '% · 동일한 0–100 축', 19, C.muted, 400, 'text-anchor="end"');
  const intentLock = rows.find((row) => row.system === 'INTENTLOCK').aggregate;
  body += text(
    64,
    901,
    `IntentLock도 사후 발견된 위반 허용 ${intentLock.unsafeExecutions}건은 남는다. 정상 완료율은 ${(intentLock.benignCompletionRate * 100).toFixed(2)}%다.`,
    24,
    C.ink,
    600,
  );
  body += text(
    64,
    940,
    '점은 비율, 선은 원본 사례 단위 군집 부트스트랩 95% 구간. 겹친 끝점은 구간 폭이 0인 경우다.',
    21,
    C.muted,
  );
  const svg = frame(
    3,
    '호출별 정책 대비: 위반 허용은 감소, 완료율은 동일',
    '동일한 사례를 재생해 비교한 결과이며, 실지갑 공격 성공률은 아니다',
    body,
    [
      'Source: 본 연구의 주 실험 집계 · 최초 시도 400건/체계 · 원본 사례 80개, 10,000회 재표집.',
      '95% 구간은 이 고정 벤치마크 내부의 변동성이다. 새 공격·새 사용자에 대한 일반화 보장을 뜻하지 않는다.',
    ],
    1080,
  );
  // The paired scientific chart is intentionally light, matching the reference
  // distinction between precise interval comparisons and dark publication cards.
  const light = {
    [C.ink]: '#171A1D',
    [C.paper]: '#F7F6F2',
    [C.accent]: '#157A74',
    [C.gray]: '#727987',
    [C.muted]: '#555D59',
    [C.rule]: '#CFD2D6',
    [C.white]: '#FFFFFF',
  };
  return svg.replace(/#[0-9A-F]{6}/g, (color) => light[color] ?? color);
}

function errorTaxonomy(rows) {
  let body = text(64, 252, '비교 체계', 24, C.muted, 600);
  body += text(360, 252, '오류 분류 합계 / 400', 24, C.muted, 600);
  body += text(856, 252, '각 체계의 주요 오류 유형', 24, C.muted, 600);
  const x = 360;
  const width = 360;
  [0, 100, 200, 300, 400].forEach((tick) => {
    body += line(x + (width * tick) / 400, 292, x + (width * tick) / 400, 847);
    body += text(x + (width * tick) / 400, 879, tick, 19, C.muted, 400, 'text-anchor="middle"');
  });
  rows.forEach((row, index) => {
    const y = 320 + index * 106;
    const fill = row.system === 'INTENTLOCK' ? C.accent : C.gray;
    const categories = Object.entries(row.errorsByMutation).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const count = categories.reduce((sum, item) => sum + item[1], 0);
    body += text(64, y + 23, LABELS[row.system], 25, fill, 600);
    body += text(64, y + 54, row.system, 18, C.muted);
    body += rect(
      x,
      y + 3,
      (count / 400) * width,
      30,
      fill,
      data(row.system, 'errorsByMutationTotal', count, { count, denominator: row.aggregate.total }),
    );
    body += text(809, y + 27, `${count}/400`, 23, fill, 600, 'text-anchor="end"');
    categories.slice(0, 3).forEach(([category, categoryCount], itemIndex) => {
      body += text(
        856,
        y + 15 + itemIndex * 29,
        `${MUTATIONS[category]} ${categoryCount}`,
        21,
        C.muted,
        400,
        data(row.system, `errorsByMutation.${category}`, categoryCount, {
          count: categoryCount,
          denominator: row.aggregate.total,
        }),
      );
    });
  });
  const intentLock = rows.find((row) => row.system === 'INTENTLOCK');
  const totalErrors = Object.values(intentLock.errorsByMutation).reduce(
    (sum, count) => sum + count,
    0,
  );
  body += text(
    64,
    935,
    `IntentLock: 오류 분류 ${totalErrors}건 ≠ 위반 허용 ${intentLock.aggregate.unsafeExecutions}건`,
    29,
    C.accent,
    700,
  );
  body += text(
    64,
    978,
    `비적대적 잘못된 호출 ${intentLock.errorsByMutation['benign-hallucination'] ?? 0}건과 오래된 견적 ${intentLock.errorsByMutation['stale-quote'] ?? 0}건이 합산된다. 이를 손실이나 오거부 건수로 읽어서는 안 된다.`,
    23,
    C.muted,
  );
  return frame(
    4,
    '오류 분류와 위반 허용은 서로 다른 지표다',
    '비적대적 의도 이탈의 중단도 포함된 기존 오류 분류',
    body,
    [
      'Source: 본 연구 주 실험 errorsByMutation 집계. 막대는 유형별 오류 건수 합계이며, 오른쪽은 상위 3개 유형.',
      '언어모델 출력 없음 16건은 이 오류 분류의 부분집합 표기다. 최초 요청 실패 92건 전체와 혼동하지 않는다.',
    ],
    1120,
  );
}

function latency(rows) {
  let body = text(64, 251, '전체 비교 / 0–1,500 ms', 26, C.ink, 700);
  body += text(1376, 251, '호출 경로의 평균 지연', 22, C.muted, 400, 'text-anchor="end"');
  const x = 360;
  const width = 848;
  const renderPanel = (selected, max, firstY, step, bottomY) => {
    let fragment = '';
    const ticks = max === 1500 ? [0, 500, 1000, 1500] : [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    ticks.forEach((tick) => {
      const at = x + (width * tick) / max;
      fragment += line(at, firstY - 23, at, bottomY);
      fragment += text(
        at,
        bottomY + 28,
        max === 1500 ? tick.toLocaleString('en-US') : tick.toFixed(1),
        19,
        C.muted,
        400,
        'text-anchor="middle"',
      );
    });
    selected.forEach((row, index) => {
      const y = firstY + index * step;
      const fill = row.system === 'INTENTLOCK' ? C.accent : C.gray;
      const value = row.aggregate.meanLatencyMs;
      fragment += text(64, y + 9, LABELS[row.system], 23, fill, 600);
      fragment += rect(
        x,
        y - 12,
        (width * value) / max,
        24,
        fill,
        data(row.system, 'meanLatencyMs', value, {
          panel: max === 1500 ? 'full' : 'zoom',
          'axis-max': max,
        }),
      );
      fragment += text(1376, y + 8, `${value.toFixed(3)} ms`, 22, fill, 600, 'text-anchor="end"');
    });
    return fragment;
  };
  body += renderPanel(rows, 1500, 304, 54, 565);
  body += line(64, 625, 1376, 625, C.ink);
  body += text(64, 672, '별도 확대 / 0–0.5 ms', 26, C.ink, 700);
  body += text(64, 710, '언어모델 검증기를 제외한 네 체계 · 위 패널과 축 범위가 다름', 22, C.muted);
  body += renderPanel(
    rows.filter((row) => row.system !== 'LLM_VERIFIER'),
    0.5,
    760,
    53,
    965,
  );
  body += text(
    64,
    1030,
    '언어모델 요청 경로와 로컬 규칙 경로는 포함하는 작업이 다르다. 속도 배수로 단순 비교하지 않는다.',
    23,
    C.ink,
    600,
  );
  return frame(
    5,
    '지연 시간은 무엇을 잰 값인지부터 구분해야 한다',
    '원본 수치를 유지한 전체 축과, 로컬 규칙 경로만 따로 확대한 축',
    body,
    [
      'Source: 본 연구 주 실험 meanLatencyMs · 최초 시도 400건/체계 · 각 값은 소수 셋째 자리까지 표시.',
      '지갑 종단 간 처리 시간이나 모델 추론만의 속도가 아니다. RPC·서명·블록 확정 시간을 대표하지 않는다.',
    ],
    1180,
  );
}

export function renderEditorialFigures(results) {
  const rows = assertInput(results);
  return {
    'cumulative-budget': cumulativeBudget(),
    architecture: architecture(),
    'security-utility': securityUtility(rows),
    'error-taxonomy': errorTaxonomy(rows),
    latency: latency(rows),
  };
}
