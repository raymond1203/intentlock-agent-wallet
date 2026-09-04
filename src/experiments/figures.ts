import type { EvaluationAnalysis } from './analysis.js';

const BLUE = '#2878b5';
const DARK_BLUE = '#174f78';
const INK = '#243240';
const MUTED = '#596674';

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

function text(x: number, y: number, value: string, attributes = ''): string {
  return `<text x="${String(x)}" y="${String(y)}" ${attributes}>${xml(value)}</text>`;
}

function svgDocument(runId: string, title: string, body: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560" role="img">',
    `<title>${xml(title)}</title>`,
    `<metadata>IntentLock run ${xml(runId)}</metadata>`,
    '<rect width="900" height="560" fill="#ffffff"/>',
    `<g font-family="sans-serif" font-size="12" fill="${INK}">`,
    body,
    text(450, 545, `run ${runId}`, `text-anchor="middle" font-size="11" fill="${MUTED}"`),
    '</g>',
    '</svg>',
  ].join('\n');
}

function heading(title: string, subtitle: string): string {
  return [
    text(28, 38, title, 'font-size="22" font-weight="700"'),
    text(28, 64, subtitle, `font-size="12" fill="${MUTED}"`),
  ].join('\n');
}

/** Fixed aggregate systems occupy separate rows; neither coincident points nor jitter hide ties. */
export function securityUtilitySvg(analysis: EvaluationAnalysis): string {
  const panelWidth = 250;
  const starts = [210, 600];
  const axes = starts
    .flatMap((start) => [
      ...Array.from({ length: 5 }, (_, index) => {
        const value = index / 4;
        const x = start + value * panelWidth;
        return `<line x1="${String(x)}" y1="136" x2="${String(x)}" y2="466" stroke="#e5e9ee"/>\n${text(x, 487, pct(value), 'text-anchor="middle" font-size="11"')}`;
      }),
      `<line x1="${String(start)}" y1="466" x2="${String(start + panelWidth)}" y2="466" stroke="${INK}"/>`,
    ])
    .join('\n');
  const marks = analysis.systems
    .map((system, index) => {
      const y = 163 + index * 65;
      const rateMark = (
        name: string,
        start: number,
        value: number | null,
        numerator: number,
        denominator: number,
        lower: number,
        upper: number,
        open: boolean,
      ): string => {
        if (value === null || denominator === 0) {
          const unavailable =
            denominator === 0 ? 'N/A (denominator = 0)' : 'N/A (rate unavailable)';
          return `<g data-system="${system.system}" data-metric="${name}" data-available="false">${text(start + panelWidth / 2, y + 4, unavailable, 'text-anchor="middle"')}</g>`;
        }
        const pointX = start + value * panelWidth;
        const lowerX = start + lower * panelWidth;
        const upperX = start + upper * panelWidth;
        return [
          `<g data-system="${system.system}" data-metric="${name}" data-value="${String(value)}">`,
          `<title>${xml(`${system.system}: ${name} ${pct(value)} (${String(numerator)}/${String(denominator)}), 95% interval ${pct(lower)} to ${pct(upper)}`)}</title>`,
          `<line x1="${String(lowerX)}" y1="${String(y)}" x2="${String(upperX)}" y2="${String(y)}" stroke="${DARK_BLUE}" stroke-width="2"/>`,
          ...[lowerX, upperX].map(
            (x) =>
              `<line x1="${String(x)}" y1="${String(y - 5)}" x2="${String(x)}" y2="${String(y + 5)}" stroke="${DARK_BLUE}" stroke-width="2"/>`,
          ),
          `<circle cx="${String(pointX)}" cy="${String(y)}" r="5" fill="${open ? '#ffffff' : BLUE}" stroke="${DARK_BLUE}" stroke-width="2"/>`,
          text(
            start + panelWidth / 2,
            y + 24,
            `${pct(value)} (${String(numerator)}/${String(denominator)})`,
            'text-anchor="middle" font-family="monospace"',
          ),
          '</g>',
        ].join('\n');
      };
      return [
        text(28, y + 4, system.system, 'font-size="13" font-weight="700"'),
        rateMark(
          'unsafe authorization',
          210,
          system.aggregate.unsafeExecutionRate,
          system.aggregate.unsafeExecutions,
          system.aggregate.total,
          system.unsafeExecutionRate95.lower95,
          system.unsafeExecutionRate95.upper95,
          false,
        ),
        rateMark(
          'benign completion',
          600,
          system.aggregate.benignCompletionRate,
          system.aggregate.benignCompleted,
          system.aggregate.benignTotal,
          system.benignCompletionRate95.lower95,
          system.benignCompletionRate95.upper95,
          true,
        ),
      ].join('\n');
    })
    .join('\n');
  return svgDocument(
    analysis.runId,
    'Offline security–utility comparison',
    [
      heading(
        'Offline security–utility comparison',
        'Authored contract-conditioned replay; points and grouped-bootstrap 95% intervals',
      ),
      text(
        335,
        106,
        'Unsafe authorization (lower is better)',
        'text-anchor="middle" font-weight="700"',
      ),
      text(
        725,
        106,
        'Benign completion (higher is better)',
        'text-anchor="middle" font-weight="700"',
      ),
      text(
        335,
        125,
        'Denominator: all selected cases',
        `text-anchor="middle" font-size="11" fill="${MUTED}"`,
      ),
      text(
        725,
        125,
        'Denominator: benign selected cases',
        `text-anchor="middle" font-size="11" fill="${MUTED}"`,
      ),
      axes,
      marks,
      text(
        28,
        517,
        'Exact counts below each mark. Separate rows preserve ties; unavailable is not zero.',
        `font-size="12" fill="${MUTED}"`,
      ),
    ].join('\n'),
  );
}

function barMark(system: string, y: number, value: number, maximum: number): string {
  const width = (value / maximum) * 550;
  return [
    `<g data-system="${xml(system)}" data-value="${String(value)}">`,
    text(28, y + 20, system, 'font-size="13" font-weight="700"'),
    `<rect x="190" y="${String(y)}" width="${String(width)}" height="28" fill="${BLUE}"/>`,
    value === 0
      ? `<circle data-zero="true" cx="190" cy="${String(y + 14)}" r="4" fill="#ffffff" stroke="${DARK_BLUE}" stroke-width="2"/>`
      : '',
    '</g>',
  ].join('\n');
}

function barAxis(maximum: number, units: string): string {
  return [
    `<line x1="190" y1="101" x2="190" y2="479" stroke="${INK}"/>`,
    `<line x1="190" y1="494" x2="740" y2="494" stroke="${INK}"/>`,
    ...[0, 0.5, 1].map((fraction) =>
      text(
        190 + fraction * 550,
        516,
        `${(fraction * maximum).toFixed(1)} ${units}`,
        'text-anchor="middle" font-size="11"',
      ),
    ),
  ].join('\n');
}

export function latencySvg(analysis: EvaluationAnalysis): string {
  const maximum = Math.max(...analysis.systems.map((system) => system.aggregate.meanLatencyMs), 1);
  const bars = analysis.systems
    .map((system, index) => {
      const y = 110 + index * 75;
      return [
        barMark(system.system, y, system.aggregate.meanLatencyMs, maximum),
        text(
          760,
          y + 20,
          `${system.aggregate.meanLatencyMs.toFixed(2)} ms`,
          'font-family="monospace"',
        ),
        text(
          190,
          y + 47,
          `n = ${String(system.aggregate.total)} selected cases`,
          `font-size="11" fill="${MUTED}"`,
        ),
      ].join('\n');
    })
    .join('\n');
  return svgDocument(
    analysis.runId,
    'Mean decision latency',
    [
      heading(
        'Mean decision latency',
        'Offline replay; all selected cases, including failures and abstentions; milliseconds',
      ),
      barAxis(maximum, 'ms'),
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
      const y = 110 + index * 75;
      const top = Object.entries(system.errorsByMutation)
        .sort(([, left], [, right]) => right - left)
        .slice(0, 3)
        .map(([label, value]) => ({
          full: `${label}:${String(value)}`,
          visible: `${label.length > 43 ? `${label.slice(0, 42)}…` : label}:${String(value)}`,
        }));
      return [
        barMark(system.system, y, count, maximum),
        `<g><title>${xml(top.map((entry) => entry.full).join(', '))}</title>`,
        text(
          760,
          y + 20,
          `${String(count)} / ${String(system.aggregate.total)}`,
          'font-family="monospace"',
        ),
        text(
          190,
          y + 45,
          top
            .slice(0, 2)
            .map((entry) => entry.visible)
            .join(', ') || 'no classified errors',
          `font-size="10" fill="${MUTED}"`,
        ),
        top.length > 2
          ? text(190, y + 59, top[2]?.visible ?? '', `font-size="10" fill="${MUTED}"`)
          : '',
        '</g>',
      ].join('\n');
    })
    .join('\n');
  return svgDocument(
    analysis.runId,
    'Classified evaluation errors',
    [
      heading(
        'Classified evaluation errors',
        'Existing error taxonomy; exact count / selected cases and up to three leading categories',
      ),
      barAxis(maximum, 'errors'),
      bars,
      text(
        28,
        532,
        'Long category labels shortened; full names are preserved in SVG titles and source tables.',
        `font-size="9" fill="${MUTED}"`,
      ),
    ].join('\n'),
  );
}

export function architectureSvg(runId: string): string {
  const box = (x: number, y: number, width: number, title: string, subtitle: string) =>
    [
      `<rect x="${String(x)}" y="${String(y)}" width="${String(width)}" height="64" fill="#edf4fa" stroke="${DARK_BLUE}"/>`,
      text(x + width / 2, y + 25, title, 'text-anchor="middle" font-size="13" font-weight="700"'),
      text(x + width / 2, y + 46, subtitle, 'text-anchor="middle" font-size="10"'),
    ].join('\n');
  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${String(x1)}" y1="${String(y1)}" x2="${String(x2)}" y2="${String(y2)}" stroke="${INK}" stroke-width="2" marker-end="url(#arrow)"/>`;
  return svgDocument(
    runId,
    'IntentLock implementation and evaluation boundaries',
    [
      `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${INK}"/></marker></defs>`,
      heading(
        'IntentLock implementation and evaluation boundaries',
        'Distinct scopes: an optional compiler, measured offline replay, and the adapter implementation',
      ),
      text(
        28,
        99,
        'OPTIONAL COMPILER — not a measured natural-language or consent guarantee',
        'font-weight="700"',
      ),
      box(40, 114, 220, 'Text + field evidence', 'Assertions, not verified taint'),
      box(320, 114, 250, 'Compiler checks', 'Schema, substring, widening checks'),
      box(630, 114, 230, 'Typed Intent Contract', 'Caller supplies confirmation flags'),
      arrow(260, 146, 316, 146),
      arrow(570, 146, 626, 146),
      text(
        28,
        213,
        'MEASURED M3 — authored contract-conditioned offline replay',
        'font-weight="700"',
      ),
      box(40, 228, 240, 'Authored contract + trace', 'Fixed fixtures and mutation manifest'),
      box(330, 228, 240, 'Five comparison systems', 'Counterfactual guard decisions'),
      box(620, 228, 240, 'Offline metrics', 'Authored outcomes; not live losses'),
      arrow(280, 260, 326, 260),
      arrow(570, 260, 616, 260),
      text(
        28,
        329,
        'ADAPTER IMPLEMENTATION — evaluate, reserve, execute, reconcile in one method',
        'font-weight="700"',
      ),
      box(40, 348, 180, 'Decode + monitor', 'ALLOW / DENY / ESCALATE'),
      box(253, 348, 190, 'In-memory ledger', 'Single-process reservation gate'),
      box(476, 348, 180, 'Wallet executor', 'After reservation succeeds'),
      box(689, 348, 171, 'Receipt check', 'Post-state reconciliation'),
      arrow(220, 380, 249, 380),
      arrow(443, 380, 472, 380),
      arrow(656, 380, 685, 380),
      '<path d="M774 412 L774 446 L348 446 L348 415" fill="none" stroke="#243240" stroke-width="2" marker-end="url(#arrow)"/>',
      text(570, 438, 'Record EXECUTED / FAILED / VIOLATED', 'text-anchor="middle" font-size="11"'),
      text(
        28,
        480,
        'Mismatch: VIOLATED budget remains counted; no global follow-up signing freeze is implemented.',
        'font-size="12"',
      ),
      text(
        28,
        503,
        'No distributed durability; confirmation is caller-supplied. Decoder / simulation soundness is conditional.',
        'font-size="12"',
      ),
    ].join('\n'),
  );
}
