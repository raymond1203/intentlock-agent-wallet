# Base Scenario Validation

## Forty-case checks

All forty base scenarios pass the strict schema, frozen ABI decoder, ActionIR construction, expected
post-state consistency, duplicate/near-duplicate detection, and deterministic IntentLock `ALLOW`
path. `pnpm benchmark:check` confirms the checked-in JSON is identical to generator output.

## Pinned-fork environment check

On 2026-08-30, `pnpm test:integration` passed 12/12 against the pinned Ethereum block using a public
archive endpoint already listed in decision 0005. This validates the block hash, contract codehashes,
state injection, snapshots, decoders, and one real Anvil signer → receipt → post-state transfer path.

This does not mean all forty scenario transactions were broadcast. Permit2 fixtures include synthetic
signatures and swap traces use deterministic quotes, so the forty-case evidence is schema/decoder/
monitor execution unless a scenario-specific fork receipt is added later. Reports must preserve this
distinction.

The first public endpoint attempted during validation returned a rate limit; the second recorded
endpoint completed the suite. A failed fork startup now cleans up without a secondary teardown error.
