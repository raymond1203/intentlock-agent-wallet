/** Rebuild into a new temporary directory; never overwrite frozen publications. */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const req = createRequire(import.meta.url);
// Resolves only the declared, lockfile-pinned dependency, not a personal runtime cache.
const sharpPath = req.resolve('sharp');
const sharp = req('sharp');
assert.equal(sharp.versions.sharp, '0.35.4');
const output = mkdtempSync(join(tmpdir(), 'intentlock-publication-'));
for (const folder of ['paper', 'figures', 'artifacts', 'docs/experiments/audits']) {
  cpSync(resolve(root, folder), resolve(output, folder), { recursive: true });
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const protectedPaths = [
  'paper/final.md',
  'paper/submission-ko.md',
  'paper/editorial-ko.md',
  'paper/visual-v2-ko.md',
  'artifacts/submission-ko-manifest.json',
];
const before = Object.fromEntries(
  protectedPaths.map((p) => [p, sha(readFileSync(resolve(root, p)))]),
);
const cacheLoader =
  /const req = createRequire\(import\.meta\.url\);\r?\nconst sharp = req\([\s\S]*?\r?\n\);/;
for (const name of ['localize-submission', 'build-editorial-edition', 'build-visual-v2']) {
  const script = resolve(output, `docs/experiments/audits/${name}.mjs`);
  if (name !== 'localize-submission') {
    const source = readFileSync(script, 'utf8');
    assert(cacheLoader.test(source), `Historical loader changed: ${name}`);
    // Adapt only the temporary copy; historical source hashes stay valid in the repository.
    writeFileSync(
      script,
      source.replace(
        cacheLoader,
        `const req = createRequire(import.meta.url);\nconst sharp = req(${JSON.stringify(sharpPath)});`,
      ),
    );
  }
  execFileSync(process.execPath, [script, `--sharp-module=${sharpPath}`], {
    cwd: output,
    windowsHide: true,
    timeout: 120000,
    stdio: 'pipe',
  });
}
const manifests = ['submission-ko', 'editorial-ko', 'visual-v2'];
let semanticFiles = 0,
  pngFiles = 0,
  matchingPngFiles = 0;
for (const name of manifests) {
  const manifest = JSON.parse(
    readFileSync(resolve(output, `artifacts/${name}-manifest.json`), 'utf8'),
  );
  for (const file of Object.keys(manifest.outputs)) {
    const actual = readFileSync(resolve(output, file));
    const expected = readFileSync(resolve(root, file));
    if (/\.(md|svg)$/.test(file)) {
      assert.equal(sha(actual), sha(expected), `Semantic output differs: ${file}`);
      semanticFiles++;
    }
    if (file.endsWith('.png')) {
      assert.equal(actual.subarray(1, 4).toString(), 'PNG');
      pngFiles++;
      matchingPngFiles += Number(sha(actual) === sha(expected));
    }
  }
}
for (const [file, hash] of Object.entries(before))
  assert.equal(sha(readFileSync(resolve(root, file))), hash);
const report = {
  status: 'PASS',
  semanticFiles,
  pngFiles,
  matchingPngFiles,
  originalFilesUnchanged: true,
  renderer: sharp.versions,
  note: 'PNG bytes depend on platform and installed fonts. Changed PNGs require visual review; no Notion update or experiment execution.',
};
writeFileSync(resolve(output, 'rebuild-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, outputDirectory: output }, null, 2));
