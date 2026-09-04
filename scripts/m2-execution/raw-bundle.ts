import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { M2RawEvidencePathSchema, canonicalM2RawEvidencePath } from './evidence-validation.js';

/**
 * Writes immutable, content-addressed collector bytes beneath a repository-like root. Existing
 * identical blobs are reused; a hash-path collision or path escape is rejected.
 */
export async function persistM2RawEvidenceBundles(
  entries: ReadonlyMap<string, Uint8Array>,
  root = process.cwd(),
): Promise<void> {
  const absoluteRoot = resolve(root);
  for (const [path, bytes] of entries) {
    M2RawEvidencePathSchema.parse(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (path !== canonicalM2RawEvidencePath(digest)) {
      throw new Error(`raw evidence bytes do not match content-addressed path: ${path}`);
    }
    const target = resolve(absoluteRoot, path);
    const targetRelative = relative(absoluteRoot, target);
    if (
      targetRelative === '' ||
      targetRelative === '..' ||
      targetRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    ) {
      throw new Error(`raw evidence path escapes repository root: ${path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' }).catch(async (cause: unknown) => {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) throw cause;
      const existing = await readFile(target);
      if (!existing.equals(Buffer.from(bytes))) {
        throw new Error(`refusing to overwrite mismatched raw evidence bundle: ${path}`);
      }
    });
  }
}
