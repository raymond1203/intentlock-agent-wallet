# ADR 0012: Pre-freeze arithmetic, exposure and payload corrections

Date: 2026-09-05. Status: accepted for the candidate, before any M3 run.

The source-visible AI review found three implementation defects before candidate A was selected:

1. Integer division rounded slippage down and could admit a fractional-basis-point excess.
   The monitor now uses exact cross multiplication; the separately implemented adaptive oracle
   uses a ceiling minimum. Boundary and large-integer regression controls are included.
2. Asset-only last-approval aggregation missed simultaneous exposure to distinct spenders and
   excessive intermediate approvals followed by revoke. Aggregate each spender's current approval
   and retain the asset's peak across observed prefixes. Same-spender replacement is not a sum.
   Transfer consumption is not inferred in this pre-sign bound, so this is conservative; terminal
   allowance still comes from the separately observed post-state oracle. Unobserved initial
   allowances and pending debt are outside this reservation model.
3. A caller-owned adapter action could change across the awaited reservation. Snapshot the checked
   request data before any await so later caller mutation cannot change the submitted payload.
   The same-contract second-request idempotency limitation is retained and disclosed, not redesigned.

No benchmark inputs, labels, M2 source binding or raw execution bytes are changed. This is a new
M3 implementation candidate, not a claim that old M2 runs executed the patched monitor. Machine
and AI reviews will be rebound through the clean candidate and freeze artifact checks.

The historical M1 G05 swap encodes a floor-rounded minimum, one unit below the exact bound.
Its immutable fixture and old ALLOW label are preserved. Current adapter tests explicitly expect
the corrected policy to reject that payload and separately test an in-memory rounded-up control.
This is not a rewritten M1 execution record or a new observed fork run.

Documentation corrections distinguish synthetic terminal fixtures from executed mutations,
public MetaMask text from emulator hypotheses, optional compiler checks from observed consent,
and single-process reservations from production distributed guarantees. AIS is included as close
prior work. These are claim corrections before results, not post-result dataset or metric tuning.

Final author approval remains pending; the selected review protocol is SOLO_AI_ASSISTED.

## Historical collector verification

Changing shared ActionIR runtime code changes the current M2 collector fingerprint, even though
the historical executed transactions are retained at their original commit. Validation therefore
reconstructs the collector fingerprint from each evidence-bound Git source commit, including its
emitted JavaScript using the exact installed/pinned TypeScript version. The collector algorithm
and path list must match the historical source byte-for-byte; unsupported compiler/configuration
or missing files fail closed. No historical source is executed and no recorded digest is used as
the trust root. Content-addressed raw bytes, original scenario hashes, ancestry, receipts and
oracle recomputation remain required. The current-only publishing gate is unchanged.

Reports retain `collectorMatchesCurrent` (false after this change) and separately expose
`collectorMatchesBoundSource`. Thus the old execution can support historical data validity, not a
claim that M2 ran the patched M3 implementation. A diagnostic reconstruction of source `a0cca37`
reproduced the recorded collector digest `d3ca47765b9de0aa86d88a55d0a048e6708692711f82a7778c14ba147fa50474`.
