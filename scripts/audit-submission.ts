import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { auditSubmission } from '../src/submission/audit.js';

const file = process.argv.find((argument) => argument.startsWith('--file='))?.slice(7);
if (!file) throw new Error('--file=path is required');

const termsFile = process.argv
  .find((argument) => argument.startsWith('--forbidden-terms-file='))
  ?.slice('--forbidden-terms-file='.length);
const configuredTerms = termsFile
  ? await readFile(termsFile, 'utf8')
  : process.env.SUBMISSION_FORBIDDEN_TERMS;
if (!configuredTerms?.trim()) {
  throw new Error(
    'identity audit requires SUBMISSION_FORBIDDEN_TERMS or --forbidden-terms-file=local-private-path',
  );
}
const forbiddenTerms = configuredTerms
  .split(/[\r\n,]+/u)
  .map((term) => term.trim())
  .filter(Boolean);
const allowedEvmAddressFile = process.argv
  .find((argument) => argument.startsWith('--allowed-evm-address-file='))
  ?.slice('--allowed-evm-address-file='.length);
const configuredAllowedEvmAddresses = allowedEvmAddressFile
  ? await readFile(allowedEvmAddressFile, 'utf8')
  : process.env.SUBMISSION_ALLOWED_EVM_ADDRESSES;
const allowedEvmAddresses = (configuredAllowedEvmAddresses ?? '')
  .split(/[\r\n,]+/u)
  .map((address) => address.trim())
  .filter(Boolean);
const result = auditSubmission(await readFile(file, 'utf8'), {
  forbiddenTerms,
  allowedEvmAddresses,
});

console.log(
  JSON.stringify(
    {
      file: basename(file),
      wordCount: result.wordCount,
      maxWords: result.maxWords,
      wordCountMethod: result.wordCountMethod,
      notionWordCountConfirmationRequired: result.notionWordCountConfirmationRequired,
      findingCount: result.findings.length,
      findings: result.findings,
    },
    null,
    2,
  ),
);

if (result.findings.length > 0) process.exitCode = 1;
