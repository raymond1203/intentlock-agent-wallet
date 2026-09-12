/**
 * Data-first publication figures. Pure SVG generation from the frozen results.
 * Long qualifications live in accessible descriptions and manuscript captions,
 * not in the visible plot. No experiment, network, or filesystem side effects.
 */
const ORDER = ['NONE', 'GUARD_MODE', 'LLM_VERIFIER', 'PER_CALL_POLICY', 'INTENTLOCK'];
const LABELS = {
  NONE: '보호 없음',
  GUARD_MODE: '가드 모형',
  LLM_VERIFIER: '언어모델',
  PER_CALL_POLICY: '호출별 정책',
  INTENTLOCK: 'IntentLock',
};
const CATEGORIES = [
  ['amount-inflation', '금액 부풀리기'],
  ['chain-substitution', '체인 바꾸기'],
  ['gas-inflation', '가스비 부풀리기'],
  ['hidden-batch', '숨긴 일괄 호출'],
  ['policy-laundering', '분할 한도 우회'],
  ['recipient-substitution', '수신자 바꾸기'],
  ['retry-double-spend', '재시도 중복 지출'],
  ['slippage-widening', '슬리피지 확대'],
  ['stale-quote', '오래된 견적'],
  ['unlimited-approval', '무제한 승인'],
  ['benign-hallucination', '비적대적 잘못된 호출'],
  ['BENIGN_ORIGINAL', '정상 원본 오류'],
  ['LLM_OUTPUT_UNAVAILABLE', '언어모델 출력 없음'],
  ['partial-completion', '부분 완료'],
];
const DARK = {
  bg: '#121516',
  ink: '#F0F2F2',
  muted: '#A5ACAF',
  rule: '#303638',
  control: '#B0B8C4',
  accent: '#43BDB1',
  empty: '#1D2325',
};
const LIGHT = {
  bg: '#F8F7F3',
  ink: '#20272A',
  muted: '#596269',
  rule: '#D8DDDF',
  control: '#747F8A',
  accent: '#0C8077',
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character],
  );
const attrs = (values) =>
  Object.entries(values)
    .map(([key, value]) => `data-${escape(key)}="${escape(value)}"`)
    .join(' ');
const text = (x, y, value, size, color, options = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${options}>${escape(value)}</text>`;
const line = (x1, y1, x2, y2, color, width = 1, options = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${options}/>`;
const rect = (x, y, width, height, fill, options = '') =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${options}/>`;

function frame(name, title, description, body, palette, height, footer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}" role="img" aria-labelledby="${name}-title ${name}-desc">
<title id="${name}-title">${escape(title)}</title>
<desc id="${name}-desc">${escape(description)}</desc>
<style>text{font-family:"Malgun Gothic","Noto Sans KR","Apple SD Gothic Neo",sans-serif;font-variant-numeric:tabular-nums}line,rect,circle{vector-effect:non-scaling-stroke}</style>
${rect(0, 0, 1440, height, palette.bg)}
${text(48, 61, title, 36, palette.ink, 'font-weight="700"')}
${body}
${text(48, height - 23, footer, 18, palette.muted)}
${text(1392, height - 23, 'INTENTLOCK', 17, palette.muted, 'text-anchor="end" letter-spacing="2"')}
</svg>`;
}

function assertInput(results) {
  if (!results || !Array.isArray(results.systems) || results.systems.length !== ORDER.length) {
    throw new Error('Expected the five-system frozen research aggregate.');
  }
  const systems = new Map(results.systems.map((row) => [row.system, row]));
  if (systems.size !== ORDER.length || ORDER.some((system) => !systems.has(system))) {
    throw new Error('Missing, repeated, or unsupported research systems.');
  }
  const categories = new Set(CATEGORIES.map(([category]) => category));
  for (const system of ORDER) {
    const row = systems.get(system);
    const a = row.aggregate;
    if (!a || a.system !== system || a.total !== 400 || a.benignTotal !== 160) {
      throw new Error(`Expected frozen denominators 400 and 160 for ${system}.`);
    }
    for (const [count, denominator, rate, ciKey] of [
      ['unsafeExecutions', 'total', 'unsafeExecutionRate', 'unsafeExecutionRate95'],
      ['benignCompleted', 'benignTotal', 'benignCompletionRate', 'benignCompletionRate95'],
    ]) {
      const ci = row[ciKey];
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
        Math.abs(ci.point - a[rate]) > 1e-12 ||
        ci.replicates !== 10000 ||
        ci.groupCount !== 80
      ) {
        throw new Error(`Invalid ${rate} or grouped confidence interval for ${system}.`);
      }
    }
    if (
      !Number.isFinite(a.meanLatencyMs) ||
      a.meanLatencyMs <= 0 ||
      a.meanLatencyMs > 1500 ||
      (system !== 'LLM_VERIFIER' && a.meanLatencyMs > 0.5)
    ) {
      throw new Error(`Latency is outside the declared axis for ${system}.`);
    }
    if (
      !row.errorsByMutation ||
      Array.isArray(row.errorsByMutation) ||
      Object.entries(row.errorsByMutation).some(
        ([category, count]) =>
          !categories.has(category) || !Number.isInteger(count) || count < 0 || count > 70,
      ) ||
      Object.values(row.errorsByMutation).reduce((sum, count) => sum + count, 0) > a.total
    ) {
      throw new Error(`Invalid error taxonomy or heatmap color domain for ${system}.`);
    }
  }
  return ORDER.map((system) => systems.get(system));
}

function rateAxis(x, width, top, bottom) {
  return [0, 25, 50, 75, 100]
    .map((tick) => {
      const px = x + (width * tick) / 100;
      return (
        line(px, top, px, bottom, LIGHT.rule) +
        text(px, bottom + 34, `${tick}%`, 20, LIGHT.muted, 'text-anchor="middle"')
      );
    })
    .join('');
}

function securityUtility(rows) {
  const panels = [
    {
      x: 246,
      title: '위반 허용률 ↓',
      count: 'unsafeExecutions',
      denominator: 'total',
      rate: 'unsafeExecutionRate',
      ci: 'unsafeExecutionRate95',
    },
    {
      x: 860,
      title: '정상 완료율 ↑',
      count: 'benignCompleted',
      denominator: 'benignTotal',
      rate: 'benignCompletionRate',
      ci: 'benignCompletionRate95',
    },
  ];
  const width = 514;
  let body = '';
  for (const p of panels) {
    body += text(p.x, 132, p.title, 28, LIGHT.ink, 'font-weight="600"');
    body += rateAxis(p.x, width, 166, 742);
  }
  rows.forEach((row, index) => {
    const y = 219 + index * 117;
    const color = row.system === 'INTENTLOCK' ? LIGHT.accent : LIGHT.control;
    body += text(48, y + 8, LABELS[row.system], 24, color, 'font-weight="600"');
    for (const p of panels) {
      const a = row.aggregate;
      const ci = row[p.ci];
      const low = p.x + width * ci.lower95;
      const high = p.x + width * ci.upper95;
      const point = p.x + width * a[p.rate];
      const data = {
        system: row.system,
        metric: p.rate,
        value: a[p.rate],
        count: a[p.count],
        denominator: a[p.denominator],
        low: ci.lower95,
        high: ci.upper95,
        'axis-min': 0,
        'axis-max': 1,
        'axis-x': p.x,
        'axis-width': width,
        'plot-x': point,
        'plot-y': y,
        'low-x': low,
        'high-x': high,
      };
      body += `<g ${attrs({ ...data, kind: 'interval' })}>${line(low, y, high, y, color, 3)}${line(low, y - 8, low, y + 8, color, 2)}${line(high, y - 8, high, y + 8, color, 2)}</g>`;
      body += `<circle cx="${point}" cy="${y}" r="7" fill="${color}" ${attrs({ ...data, kind: 'point' })}/>`;
      body += text(point + 13, y - 17, `${a[p.count]}/${a[p.denominator]}`, 22, color);
    }
  });
  return frame(
    'security-utility',
    '보호 체계 비교',
    '같은 0–100% 축의 비율과 95% 구간. 위반 허용률의 분모는 전체 400건이며 정상 완료율의 분모는 비적대적 160건(원본 80건과 이탈 80건)이다. 선은 기본 의도 80개 묶음을 유지한 10,000회 부트스트랩 구간이다. 폭이 0인 구간은 점과 겹친다. 작성된 계약과 호출 기록의 첫 시도 오프라인 재생이며 실지갑 공격 성공률이나 새로운 사용자에 대한 일반화 보장이 아니다. 가드 모형은 공개 정책을 재현한 비교 모형이다. 언어모델 최초 요청 실패 92건을 제외하지 않는다.',
    body,
    LIGHT,
    827,
    'Source: 본 연구 · 첫 시도 · 점: 비율 / 선: 95% 구간',
  );
}

function blendHex(from, to, weight) {
  const channels = [1, 3, 5].map((offset) => {
    const a = Number.parseInt(from.slice(offset, offset + 2), 16);
    const b = Number.parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * weight)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function errorTaxonomy(rows) {
  const x = 348;
  const y = 173;
  const columnWidth = 205;
  const rowHeight = 53;
  const cellWidth = 195;
  const cellHeight = 46;
  let body = text(1392, 60, '건 / 400 · 빈칸 0', 21, DARK.muted, 'text-anchor="end"');
  rows.forEach((row, column) => {
    const px = x + column * columnWidth;
    const color = row.system === 'INTENTLOCK' ? DARK.accent : DARK.control;
    body += text(
      px + cellWidth / 2,
      138,
      LABELS[row.system],
      23,
      color,
      'text-anchor="middle" font-weight="600"',
    );
    CATEGORIES.forEach(([category], index) => {
      const py = y + index * rowHeight;
      const count = row.errorsByMutation[category] ?? 0;
      const fill = blendHex(DARK.empty, DARK.control, count / 70);
      body += rect(
        px,
        py,
        cellWidth,
        cellHeight,
        fill,
        attrs({
          system: row.system,
          metric: `errorsByMutation.${category}`,
          category,
          value: count,
          count,
          denominator: row.aggregate.total,
          'color-min': 0,
          'color-max': 70,
          'color-weight': count / 70,
          'plot-x': px,
          'plot-y': py,
          'plot-width': cellWidth,
          'plot-height': cellHeight,
          column,
          row: index,
        }),
      );
      if (count > 0) {
        body += text(
          px + cellWidth / 2,
          py + 31,
          count,
          24,
          count >= 40 ? DARK.bg : DARK.ink,
          'text-anchor="middle" font-weight="600"',
        );
      }
    });
    const total = Object.values(row.errorsByMutation).reduce((sum, count) => sum + count, 0);
    body += text(
      px + cellWidth / 2,
      966,
      total,
      26,
      color,
      `text-anchor="middle" font-weight="700" ${attrs({ system: row.system, metric: 'errorsByMutationTotal', value: total, count: total, denominator: row.aggregate.total })}`,
    );
  });
  CATEGORIES.forEach(([, label], index) => {
    body += text(317, y + index * rowHeight + 31, label, 22, DARK.muted, 'text-anchor="end"');
  });
  body += line(48, 932, 1392, 932, DARK.rule);
  body += text(317, 966, '합계', 22, DARK.muted, 'text-anchor="end"');
  const legendX = 935;
  for (let step = 0; step < 70; step += 1) {
    body += rect(legendX + step * 4, 1013, 4, 12, blendHex(DARK.empty, DARK.control, step / 69));
  }
  body += text(legendX - 12, 1028, '0', 18, DARK.muted, 'text-anchor="end"');
  body += text(legendX + 292, 1028, '70건', 18, DARK.muted);
  return frame(
    'error-taxonomy',
    '오류 분류',
    '14개 오류 유형과 5개 보호 체계의 히트맵. 빈 셀은 집계 0건이고 모든 셀은 0–70건의 같은 선형 색 강도를 사용한다. 열별 분모는 400건이다. 오류 분류는 위반 허용과 다른 지표이며 IntentLock 합계 75건은 비적대적 잘못된 호출 65건과 오래된 견적 10건이다. 75건을 손실, 위반 허용, 오거부로 해석하지 않는다. 언어모델 출력 없음 16건은 이 오류 분류의 부분집합이며 최초 요청 실패 92건 전체가 아니다. 가드 모형은 공개 정책을 재현한 비교 모형이다.',
    body,
    DARK,
    1100,
    'Source: 본 연구 · 첫 시도',
  );
}

function latencyPanel(rows, max, firstY, step, bottom, panel) {
  const x = 284;
  const width = 942;
  const ticks = max === 1500 ? [0, 500, 1000, 1500] : [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  let body = '';
  for (const tick of ticks) {
    const px = x + (width * tick) / max;
    body += line(px, firstY - 35, px, bottom, DARK.rule);
    body += text(px, bottom + 32, String(tick), 20, DARK.muted, 'text-anchor="middle"');
  }
  rows.forEach((row, index) => {
    const y = firstY + index * step;
    const value = row.aggregate.meanLatencyMs;
    const color = row.system === 'INTENTLOCK' ? DARK.accent : DARK.control;
    const barWidth = (width * value) / max;
    body += text(48, y + 8, LABELS[row.system], 24, color, 'font-weight="600"');
    body += rect(
      x,
      y - 13,
      barWidth,
      26,
      color,
      attrs({
        system: row.system,
        metric: 'meanLatencyMs',
        value,
        panel,
        'axis-min': 0,
        'axis-max': max,
        'axis-x': x,
        'axis-width': width,
        'plot-x': x,
        'plot-y': y - 13,
        'plot-width': barWidth,
        'plot-height': 26,
      }),
    );
    body += text(1392, y + 8, value.toFixed(3), 23, color, 'text-anchor="end"');
  });
  return body;
}

function latency(rows) {
  let body = text(1392, 60, '밀리초 (ms)', 21, DARK.muted, 'text-anchor="end"');
  body += text(48, 118, '전체 · 0–1,500', 23, DARK.muted);
  body += latencyPanel(rows, 1500, 173, 70, 495, 'full');
  body += line(48, 561, 1392, 561, DARK.rule);
  body += text(48, 604, '별도 확대 · 0–0.5', 23, DARK.ink, 'font-weight="600"');
  body += text(1392, 604, '축 범위 다름 · 언어모델 제외', 21, DARK.muted, 'text-anchor="end"');
  body += latencyPanel(
    rows.filter((row) => row.system !== 'LLM_VERIFIER'),
    0.5,
    669,
    70,
    921,
    'zoom',
  );
  return frame(
    'latency',
    '평가 경로의 평균 지연',
    '첫 시도 400건씩의 meanLatencyMs. 위 패널은 모든 체계를 0–1,500밀리초 축에 표시하며, 아래 패널은 언어모델 검증기를 제외한 네 체계를 0–0.5밀리초 축에 따로 확대했다. 막대 너비는 실제 값에 선형 비례하며 작은 막대에 최소 너비를 부여하지 않는다. 수치는 소수 셋째 자리까지 표시한다. 원격 언어모델 요청과 로컬 규칙 평가의 측정 경로가 다르므로 지갑 종단 간 속도나 추론만의 속도, 인과적인 속도 배수로 읽지 않는다. RPC·서명·사용자 확인·블록 확정 시간을 대표하지 않는다.',
    body,
    DARK,
    1012,
    'Source: 본 연구 · 첫 시도',
  );
}

export function renderDataFigures(results) {
  const rows = assertInput(results);
  return {
    'security-utility': securityUtility(rows),
    'error-taxonomy': errorTaxonomy(rows),
    latency: latency(rows),
  };
}
