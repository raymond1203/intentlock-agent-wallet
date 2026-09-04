import type { EvaluationAnalysis, SystemAnalysis } from './analysis.js';

const COLORS: Record<SystemAnalysis['system'], string> = {
  NONE: '#7f8c8d',
  GUARD_MODE: '#8e44ad',
  LLM_VERIFIER: '#2980b9',
  PER_CALL_POLICY: '#d35400',
  INTENTLOCK: '#16856b',
};

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function svgDocument(runId: string, title: string, body: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560" role="img">',
    `<title>${xml(title)}</title>`,
    `<metadata>IntentLock run ${xml(runId)}</metadata>`,
    '<rect width="900" height="560" fill="#ffffff"/>',
    body,
    `<text x="450" y="545" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#5b6573">run ${xml(runId)}</text>`,
    '</svg>',
  ].join('\n');
}

export function securityUtilitySvg(analysis: EvaluationAnalysis): string {
  const x = (value: number) => 100 + value * 650;
  const y = (value: number) => 460 - value * 360;
  const grid = Array.from({ length: 6 }, (_, index) => {
    const value = index / 5;
    return [
      `<line x1="100" y1="${String(y(value))}" x2="750" y2="${String(y(value))}" stroke="#e8ecf0"/>`,
      `<text x="88" y="${String(y(value) + 4)}" text-anchor="end" font-family="sans-serif" font-size="12">${pct(value)}</text>`,
      `<line x1="${String(x(value))}" y1="100" x2="${String(x(value))}" y2="460" stroke="#f1f3f5"/>`,
      `<text x="${String(x(value))}" y="480" text-anchor="middle" font-family="sans-serif" font-size="12">${pct(value)}</text>`,
    ].join('\n');
  }).join('\n');
  const marks = analysis.systems
    .map((system, index) => {
      const completion = system.aggregate.benignCompletionRate ?? 0;
      const pointX = x(completion);
      const pointY = y(system.aggregate.unsafeExecutionRate);
      const lowerY = y(system.unsafeExecutionRate95.lower95);
      const upperY = y(system.unsafeExecutionRate95.upper95);
      const color = COLORS[system.system];
      return [
        `<line x1="${String(pointX)}" y1="${String(upperY)}" x2="${String(pointX)}" y2="${String(lowerY)}" stroke="${color}" stroke-width="2"/>`,
        `<circle cx="${String(pointX)}" cy="${String(pointY)}" r="7" fill="${color}"/>`,
        `<text x="775" y="${String(130 + index * 28)}" font-family="sans-serif" font-size="12" fill="${color}">${xml(system.system)}</text>`,
        `<circle cx="763" cy="${String(126 + index * 28)}" r="5" fill="${color}"/>`,
      ].join('\n');
    })
    .join('\n');
  return svgDocument(
    analysis.runId,
    'Offline counterfactual security–utility comparison',
    [
      '<text x="450" y="42" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700">Offline counterfactual security–utility comparison</text>',
      grid,
      '<line x1="100" y1="460" x2="750" y2="460" stroke="#1f2933" stroke-width="2"/>',
      '<line x1="100" y1="100" x2="100" y2="460" stroke="#1f2933" stroke-width="2"/>',
      '<text x="425" y="515" text-anchor="middle" font-family="sans-serif" font-size="14">Counterfactual benign completion →</text>',
      '<text transform="translate(28 280) rotate(-90)" text-anchor="middle" font-family="sans-serif" font-size="14">Offline unsafe-authorization estimate →</text>',
      marks,
    ].join('\n'),
  );
}

export function latencySvg(analysis: EvaluationAnalysis): string {
  const maximum = Math.max(...analysis.systems.map((system) => system.aggregate.meanLatencyMs), 1);
  const bars = analysis.systems
    .map((system, index) => {
      const y = 105 + index * 78;
      const width = (system.aggregate.meanLatencyMs / maximum) * 580;
      return [
        `<text x="72" y="${String(y + 24)}" text-anchor="end" font-family="sans-serif" font-size="12">${xml(system.system)}</text>`,
        `<rect x="90" y="${String(y)}" width="${String(width)}" height="32" rx="4" fill="${COLORS[system.system]}"/>`,
        `<text x="${String(100 + width)}" y="${String(y + 22)}" font-family="sans-serif" font-size="12">${system.aggregate.meanLatencyMs.toFixed(2)} ms</text>`,
      ].join('\n');
    })
    .join('\n');
  return svgDocument(
    analysis.runId,
    'Mean decision latency',
    [
      '<text x="450" y="42" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700">Mean decision latency</text>',
      '<text x="450" y="68" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#5b6573">Offline decision latency; failures and abstentions remain included</text>',
      bars,
    ].join('\n'),
  );
}

export function errorTaxonomySvg(analysis: EvaluationAnalysis): string {
  const totals = analysis.systems.map((system) =>
    Object.values(system.errorsByMutation).reduce((sum, count) => sum + count, 0),
  );
  const maximum = Math.max(...totals, 1);
  const bars = analysis.systems
    .map((system, index) => {
      const count = totals[index] ?? 0;
      const y = 105 + index * 78;
      const width = (count / maximum) * 580;
      const top = Object.entries(system.errorsByMutation)
        .sort(([, left], [, right]) => right - left)
        .slice(0, 3)
        .map(([label, value]) => `${label}:${String(value)}`)
        .join(', ');
      return [
        `<text x="72" y="${String(y + 24)}" text-anchor="end" font-family="sans-serif" font-size="12">${xml(system.system)}</text>`,
        `<rect x="90" y="${String(y)}" width="${String(width)}" height="32" rx="4" fill="${COLORS[system.system]}"/>`,
        `<text x="${String(100 + width)}" y="${String(y + 22)}" font-family="sans-serif" font-size="12">${String(count)}</text>`,
        `<text x="90" y="${String(y + 50)}" font-family="sans-serif" font-size="10" fill="#5b6573">${xml(top || 'no classified errors')}</text>`,
      ].join('\n');
    })
    .join('\n');
  return svgDocument(
    analysis.runId,
    'Classified evaluation errors',
    [
      '<text x="450" y="42" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700">Classified evaluation errors</text>',
      '<text x="450" y="68" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#5b6573">Unsafe authorizations, benign blocks, and explicit evaluation failures</text>',
      bars,
    ].join('\n'),
  );
}

export function architectureSvg(runId: string): string {
  const box = (
    x: number,
    y: number,
    width: number,
    title: string,
    subtitle: string,
    color: string,
  ) =>
    [
      `<rect x="${String(x)}" y="${String(y)}" width="${String(width)}" height="82" rx="10" fill="${color}" stroke="#28323c" stroke-width="1.5"/>`,
      `<text x="${String(x + width / 2)}" y="${String(y + 31)}" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700">${xml(title)}</text>`,
      `<text x="${String(x + width / 2)}" y="${String(y + 55)}" text-anchor="middle" font-family="sans-serif" font-size="11">${xml(subtitle)}</text>`,
    ].join('\n');
  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${String(x1)}" y1="${String(y1)}" x2="${String(x2)}" y2="${String(y2)}" stroke="#34495e" stroke-width="2" marker-end="url(#arrow)"/>`;
  return svgDocument(
    runId,
    'IntentLock enforcement boundary',
    [
      '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#34495e"/></marker></defs>',
      '<text x="450" y="38" text-anchor="middle" font-family="sans-serif" font-size="21" font-weight="700">IntentLock enforcement boundary</text>',
      '<rect x="28" y="66" width="844" height="402" rx="18" fill="none" stroke="#16856b" stroke-width="2" stroke-dasharray="8 6"/>',
      '<text x="48" y="91" font-family="sans-serif" font-size="11" fill="#16856b">Conditional boundary: trusted confirmation + sound decoding/simulation + signer gate + linearizable ledger</text>',
      box(55, 126, 150, 'Trusted user input', 'goal + critical fields', '#e8f5f0'),
      box(255, 126, 150, 'Intent compiler', 'taint-aware extraction', '#eef4fb'),
      box(455, 126, 150, 'Intent Contract', 'typed bounds + hash', '#fff3d9'),
      box(655, 126, 150, 'ActionIR decoder', 'recursive effects', '#f5ecfb'),
      arrow(205, 167, 252, 167),
      arrow(405, 167, 452, 167),
      arrow(605, 167, 652, 167),
      box(155, 286, 170, 'Cumulative monitor', 'ALLOW / DENY / ESCALATE', '#e8f5f0'),
      box(365, 286, 170, 'Atomic ledger', 'reserve + idempotency', '#eef4fb'),
      box(575, 286, 120, 'Signer gate', 'only ALLOW', '#fff3d9'),
      box(735, 286, 110, 'Wallet tool', 'economic effect', '#fbeceb'),
      arrow(730, 208, 282, 283),
      arrow(325, 327, 362, 327),
      arrow(535, 327, 572, 327),
      arrow(695, 327, 732, 327),
      '<path d="M790 368 C790 430 460 443 282 370" fill="none" stroke="#34495e" stroke-width="2" marker-end="url(#arrow)"/>',
      '<text x="535" y="438" text-anchor="middle" font-family="sans-serif" font-size="12">receipt + post-state reconciliation; mismatch freezes follow-up signing</text>',
      '<path d="M330 118 C395 82 655 82 720 118" fill="none" stroke="#c0392b" stroke-width="1.5" stroke-dasharray="5 4"/>',
      '<text x="525" y="108" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#c0392b">Untrusted observations cannot widen authority without confirmation</text>',
    ].join('\n'),
  );
}
