/**
 * Compact, original research diagrams. This module has no I/O or dependencies.
 * The visible content is deliberately limited to labels, numbers, and keys;
 * publication captions own the qualifications and implementation boundaries.
 */
const C = {
  background: '#121212',
  panel: '#1C1D22',
  ink: '#F2F3F5',
  muted: '#B5B8C2',
  rule: '#3B3D43',
  teal: '#38ABA2',
  blue: '#93ACD1',
  lavender: '#B19BC4',
  red: '#DD8E91',
};

const escape = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character];
  });

function text(x, y, value, size = 25, fill = C.ink, options = '') {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${options}>${escape(value)}</text>`;
}

function line(x1, y1, x2, y2, color = C.rule, options = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" ${options}/>`;
}

function rect(x, y, width, height, color = C.panel, options = '') {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" ${options}/>`;
}

function path(d, color = C.teal, options = '') {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" ${options}/>`;
}

function frame(title, label, description, body, height = 860) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}" viewBox="0 0 1440 ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escape(title)}</title>
<desc id="desc">${escape(description)}</desc>
<defs>
  <marker id="arrow-teal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${C.teal}"/></marker>
  <marker id="arrow-gray" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${C.muted}"/></marker>
  <marker id="arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${C.red}"/></marker>
  <pattern id="rejected" width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="13" stroke="${C.red}" stroke-opacity="0.3" stroke-width="3"/></pattern>
</defs>
<style>text{font-family:"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;font-variant-numeric:tabular-nums}line,rect,path{vector-effect:non-scaling-stroke}</style>
${rect(0, 0, 1440, height, C.background)}
${text(72, 98, title, 44, C.ink, 'font-weight="700"')}
${text(1368, 96, label, 21, C.muted, 'text-anchor="end"')}
${line(72, 133, 1368, 133)}
${body}
${text(72, height - 35, 'Source: 본 연구', 18, C.muted)}
</svg>`;
}

function cumulativeBudget() {
  const scale = 3.55;
  let body = '';
  const panels = [
    { x: 72, chartX: 190, label: '호출별 검사', cumulative: false },
    { x: 792, chartX: 910, label: '누적 검사', cumulative: true },
  ];
  for (const p of panels) {
    const color = p.cumulative ? C.teal : C.ink;
    body += text(p.x, 209, p.label, 30, color, 'font-weight="700"');
    body += line(p.chartX, 275, p.chartX, 687);
    body += line(
      p.chartX + 100 * scale,
      275,
      p.chartX + 100 * scale,
      687,
      C.muted,
      'stroke-dasharray="5 7"',
    );
    body += text(p.chartX + 100 * scale, 260, '한도 100', 22, C.muted, 'text-anchor="middle"');
    for (const [index, y] of [300, 450, 610].entries()) {
      body += text(p.x, y + 37, ['1차', '2차', '합계'][index], 24, C.muted);
      if (index !== 2) body += line(p.chartX, y + 73, p.chartX + 120 * scale, y + 73);
    }
    body += rect(
      p.chartX,
      300,
      60 * scale,
      55,
      C.blue,
      'data-scope="illustrative" data-stage="first" data-value="60" data-status="accepted"',
    );
    body += text(
      p.chartX + 30 * scale,
      337,
      '60',
      30,
      C.background,
      'text-anchor="middle" font-weight="700"',
    );
    body += path(`M ${p.chartX + 60 * scale + 17} 327 l 7 7 l 15 -17`, C.teal);
    if (p.cumulative) {
      body += rect(
        p.chartX,
        450,
        60 * scale,
        55,
        C.blue,
        'data-scope="illustrative" data-stage="second" data-value="60" data-status="previously-accepted"',
      );
      body += text(
        p.chartX + 30 * scale,
        487,
        '60',
        30,
        C.background,
        'text-anchor="middle" font-weight="700"',
      );
      body += rect(
        p.chartX + 60 * scale,
        450,
        60 * scale,
        55,
        'url(#rejected)',
        `stroke="${C.red}" stroke-width="2" stroke-dasharray="6 5" data-scope="illustrative" data-stage="second" data-value="60" data-status="rejected-proposal"`,
      );
      body += text(
        p.chartX + 90 * scale,
        487,
        '+60',
        30,
        C.red,
        'text-anchor="middle" font-weight="700"',
      );
      body += line(p.chartX + 60 * scale, 565, p.chartX + 120 * scale, 565, C.red);
      body += text(p.chartX + 120 * scale, 552, '120', 22, C.red, 'text-anchor="end"');
      body += rect(
        p.chartX,
        610,
        60 * scale,
        55,
        C.blue,
        'data-scope="illustrative" data-stage="total" data-value="60" data-status="executed"',
      );
      body += text(p.chartX + 60 * scale + 15, 649, '60', 33, C.teal, 'font-weight="700"');
    } else {
      body += rect(
        p.chartX,
        450,
        60 * scale,
        55,
        C.lavender,
        'data-scope="illustrative" data-stage="second" data-value="60" data-status="accepted"',
      );
      body += text(
        p.chartX + 30 * scale,
        487,
        '60',
        30,
        C.background,
        'text-anchor="middle" font-weight="700"',
      );
      body += path(`M ${p.chartX + 60 * scale + 17} 477 l 7 7 l 15 -17`, C.teal);
      body += rect(
        p.chartX,
        610,
        60 * scale,
        55,
        C.blue,
        'data-scope="illustrative" data-stage="total-first" data-value="60" data-status="executed"',
      );
      body += rect(
        p.chartX + 60 * scale,
        610,
        60 * scale,
        55,
        C.lavender,
        'data-scope="illustrative" data-stage="total-second" data-value="60" data-status="executed"',
      );
      body += line(p.chartX + 60 * scale, 610, p.chartX + 60 * scale, 665, C.background);
      body += text(p.chartX + 120 * scale + 13, 649, '120', 33, C.red, 'font-weight="700"');
    }
  }
  body += line(720, 182, 720, 715);
  body += rect(792, 760, 28, 22, 'url(#rejected)', `stroke="${C.red}" stroke-dasharray="4 3"`);
  body += text(834, 779, '거절·미실행', 21, C.muted);
  return frame(
    '누적 예산',
    '설명용 예시 · 동일 자산',
    '같은 자산의 총지출 한도를 100으로 설정한 설명용 예시다. 수치는 실험 측정값이 아니다. 왼쪽 호출별 검사는 각각 60인 두 호출을 따로 허용해 총 120이 실행된다. 오른쪽 누적 검사는 첫 호출의 60을 포함해 다음 제안 60을 더하면 120임을 계산한다. 두 번째 60은 붉은 사선과 점선으로 표시한 거절된 제안이며 실행되지 않는다. 오른쪽 실행 합계는 60이다. 가스와 승인 노출 등 다른 조건은 생략했다.',
    body,
    870,
  );
}

function stage(x, label, method) {
  return (
    rect(x, 350, 220, 120, C.panel, `rx="8" stroke="${C.teal}" stroke-opacity="0.65"`) +
    text(x + 110, 402, label, 30, C.ink, 'text-anchor="middle" font-weight="700"') +
    text(x + 110, 439, method, 21, C.muted, 'text-anchor="middle"')
  );
}

function architecture() {
  let body = rect(190, 185, 1110, 70, C.panel, `rx="8" stroke="${C.rule}"`);
  body += text(745, 230, '설정된 계약', 26, C.ink, 'text-anchor="middle"');
  for (const x of [300, 590, 1170]) {
    body += path(
      `M ${x} 255 V 344`,
      C.muted,
      'stroke-dasharray="5 5" marker-end="url(#arrow-gray)"',
    );
  }
  body += text(78, 391, '호출', 23, C.muted);
  body += path('M 72 411 H 180', C.teal, 'marker-end="url(#arrow-teal)"');
  const stages = [
    [190, '평가', 'evaluate'],
    [480, '예약', 'reserve'],
    [770, '실행', 'execute'],
    [1060, '대조·정산', 'reconcile'],
  ];
  for (const [index, [x, label, method]] of stages.entries()) {
    body += stage(x, label, method);
    if (index < stages.length - 1) {
      body += path(`M ${x + 227} 410 H ${x + 280}`, C.teal, 'marker-end="url(#arrow-teal)"');
    }
  }
  body += path('M 300 470 V 525 H 445 V 557', C.red, 'marker-end="url(#arrow-red)"');
  body += path('M 540 470 V 525 H 445', C.red);
  body += rect(397, 565, 96, 48, C.background, `rx="24" stroke="${C.red}"`);
  body += text(445, 597, '차단', 23, C.red, 'text-anchor="middle"');

  body += rect(92, 662, 270, 72, C.panel, `rx="8" stroke="${C.rule}"`);
  body += text(227, 708, '허용 효과 이력', 24, C.muted, 'text-anchor="middle"');
  body += path('M 227 662 V 476', C.muted, 'stroke-dasharray="5 5" marker-end="url(#arrow-gray)"');

  body += rect(565, 662, 715, 72, C.panel, `rx="8" stroke="${C.rule}"`);
  body += text(922, 708, '원장 · 예약 / 사용량', 25, C.ink, 'text-anchor="middle"');
  body += path('M 609 656 V 476', C.muted, 'marker-end="url(#arrow-gray)"');
  body += path('M 670 476 V 656', C.teal, 'marker-end="url(#arrow-teal)"');
  body += text(584, 581, '조회', 20, C.muted, 'text-anchor="end"');
  body += text(691, 581, '예약', 20, C.teal);
  body += path('M 1170 476 V 656', C.teal, 'marker-end="url(#arrow-teal)"');
  body += text(1191, 581, '실측 반영', 20, C.teal);
  return frame(
    '실행 경로',
    '설계도',
    'IntentLockMetaMaskAdapter.execute의 개략적 성공 경로다. 호출을 해석한 예측 효과와 설정된 계약, 호출자가 제공한 허용 효과 이력으로 evaluateIntent를 수행한다. 허용 판정 뒤 reserve가 메모리 원장의 예약·사용량과 중복 실행을 검사하고, 성공한 경우에만 executor.sendTransaction을 호출한다. 실행 영수증의 관측 효과와 예측 효과를 비교하고 최종 목표를 검사한 뒤 실제 결과를 정산한다. 평가의 비허용 판정이나 예약 거절은 실행 전에 차단된다. 원장은 evaluateIntent의 직접 입력이 아니라 reserve에서 조회된다. 실행 실패 시 가스만 정산하는 분기는 생략했다. 사후 불일치를 기록하는 것은 이미 실행된 거래의 취소나 지갑 전체의 후속 서명 동결을 뜻하지 않는다. 이 그림은 단일 프로세스 어댑터 구조를 설명하며, 실제 사용자 동의 또는 400건 오프라인 재생의 실지갑 종단 간 검증을 주장하지 않는다.',
    body,
  );
}

export function renderFlowFigures() {
  return {
    'cumulative-budget': cumulativeBudget(),
    architecture: architecture(),
  };
}
