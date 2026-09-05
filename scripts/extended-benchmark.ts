import { required } from '../src/domain/required.js';
import { readFileSync } from 'node:fs';
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import { z } from 'zod';
import {
  BenchmarkScenarioSchema,
  type BenchmarkScenario,
  type PinnedQuoteReference,
  type StateDeltaExpectation,
} from '../src/benchmark/scenario.js';
import { minimumPrefixFunding } from '../src/benchmark/execution-funding.js';
import type { EconomicEffect } from '../src/domain/action-ir.js';
import type { IntentContract } from '../src/domain/intent-contract.js';
import {
  decodeBatchCalldata,
  ERC7821_ABI,
  type BatchDecoderOptions,
  type DecoderContract,
} from '../src/effects/batch-decoder.js';
import { ERC20_ABI } from '../src/effects/erc20-decoder.js';
import { ACROSS_V3_ABI, AAVE_V3_ABI, CCTP_V1_ABI } from '../src/effects/protocol-decoders.js';
import { SWAP_ROUTER_02_ABI } from '../src/effects/swap-decoder.js';
import { pinnedQuote } from './benchmark-quotes.js';

const AddressSchema = z.custom<Address>(
  (value) => typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value),
);
const manifest = z
  .object({
    chains: z.array(
      z.object({
        chainId: z.number(),
        forkBlockNumber: z.number(),
        forkBlockHash: z.string(),
        forkBlockTimestamp: z.number(),
      }),
    ),
    contracts: z.record(
      z.string(),
      z.array(
        z.object({ key: z.string(), address: AddressSchema, codehash: z.string().optional() }),
      ),
    ),
    lendingReserves: z.object({
      '1': z.record(z.string(), z.object({ aToken: AddressSchema })),
      '8453': z.record(z.string(), z.object({ aToken: AddressSchema })),
    }),
  })
  .parse(JSON.parse(readFileSync('benchmark/fixtures/manifest.json', 'utf8')));
export const BENCHMARK_ACCOUNT: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PAYEE: Address = '0x2222222222222222222222222222222222222222';
const ZERO: Address = '0x0000000000000000000000000000000000000000';
const EXPIRY = '2026-09-05T00:00:00+09:00';
const CALLS = parseAbiParameters('(address to,uint256 value,bytes data)[]');
const MODE: Hex = `0x${'01000000000000000000'.padEnd(64, '0')}`;
const UINT256_MAX = (1n << 256n) - 1n;

/** A deterministic 1bp ceiling, with one atomic unit for every non-zero principal. */
export function variableDebtInterestBuffer(principal: bigint): bigint {
  if (principal <= 0n) return 0n;
  return (principal + 9_999n) / 10_000n;
}

export function fixtureAddress(chainId: number, key: string): Address {
  const entry = manifest.contracts[String(chainId)]?.find((entry) => entry.key === key);
  if (!entry) throw new Error(`missing pinned ${String(chainId)}:${key}`);
  return entry.address;
}
export function fixtureReference(
  chainIds: readonly number[],
): NonNullable<BenchmarkScenario['fixture']> {
  return {
    manifest: 'benchmark/fixtures/manifest.json',
    chains: chainIds.map((chainId) => {
      const pin = manifest.chains.find((chain) => chain.chainId === chainId);
      if (!pin) throw new Error(`missing chain pin ${String(chainId)}`);
      return {
        chainId,
        blockNumber: pin.forkBlockNumber,
        blockHash: pin.forkBlockHash,
        contracts: (manifest.contracts[String(chainId)] ?? [])
          .filter((c) => c.codehash !== undefined)
          .map((c) => ({ address: c.address, codehash: required(c.codehash) })),
      };
    }),
  };
}
type DraftAction = {
  chainId: number;
  target: Address;
  data: Hex;
  quoteReferences?: PinnedQuoteReference[];
  fullDebtRepay?: { asset: Address; interestBuffer: bigint };
};
const approve = (
  chainId: number,
  spender: Address,
  amount: bigint,
  asset = 'usdc',
): DraftAction => ({
  chainId,
  target: fixtureAddress(chainId, asset),
  data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] }),
});
const transfer = (chainId: number, amount: bigint, to = PAYEE, asset = 'usdc'): DraftAction => ({
  chainId,
  target: fixtureAddress(chainId, asset),
  data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to, amount] }),
});
function batch(chainId: number, calls: DraftAction[]): DraftAction {
  const quoteReferences = calls.flatMap((call) => call.quoteReferences ?? []);
  return {
    chainId,
    target: BENCHMARK_ACCOUNT,
    data: encodeFunctionData({
      abi: ERC7821_ABI,
      functionName: 'execute',
      args: [
        MODE,
        encodeAbiParameters(CALLS, [
          calls.map((call) => ({ to: call.target, value: 0n, data: call.data })),
        ]),
      ],
    }),
    ...(quoteReferences.length ? { quoteReferences } : {}),
  };
}
function swap(chainId: number, amount: bigint, recipient = BENCHMARK_ACCOUNT): DraftAction {
  const path = `0x${fixtureAddress(chainId, 'usdc').slice(2)}0001f4${fixtureAddress(chainId, 'weth').slice(2)}`;
  const quote = pinnedQuote(chainId, path, amount);
  return {
    chainId,
    target: fixtureAddress(chainId, 'swapRouter02'),
    data: encodeFunctionData({
      abi: SWAP_ROUTER_02_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: fixtureAddress(chainId, 'usdc'),
          tokenOut: fixtureAddress(chainId, 'weth'),
          fee: 500,
          recipient,
          amountIn: amount,
          amountOutMinimum: BigInt(quote.minAmountOut),
          sqrtPriceLimitX96: 0n,
        },
      ],
    }),
    quoteReferences: [quote],
  };
}
function bridge(kind: 'ACROSS_V3' | 'CCTP_V1', amount: bigint): DraftAction {
  const chainId = 1;
  const token = fixtureAddress(1, 'usdc');
  return kind === 'ACROSS_V3'
    ? {
        chainId,
        target: fixtureAddress(1, 'acrossSpokePool'),
        data: encodeFunctionData({
          abi: ACROSS_V3_ABI,
          functionName: 'depositV3',
          args: [
            BENCHMARK_ACCOUNT,
            BENCHMARK_ACCOUNT,
            token,
            fixtureAddress(8453, 'usdc'),
            amount,
            amount - 1000n,
            8453n,
            ZERO,
            1786948031,
            1786955000,
            0,
            '0x',
          ],
        }),
      }
    : {
        chainId,
        target: fixtureAddress(1, 'cctpTokenMessenger'),
        data: encodeFunctionData({
          abi: CCTP_V1_ABI,
          functionName: 'depositForBurn',
          args: [amount, 6, `0x${BENCHMARK_ACCOUNT.slice(2).padStart(64, '0')}`, token],
        }),
      };
}
type LendingOp = 'supply' | 'borrow' | 'repay' | 'withdraw';
function lending(
  chainId: number,
  name: LendingOp,
  asset: string,
  amount: bigint,
  fullDebtInterestBuffer?: bigint,
): DraftAction {
  const token = fixtureAddress(chainId, asset);
  const fullDebtRepay = fullDebtInterestBuffer !== undefined;
  const requested = fullDebtRepay ? UINT256_MAX : amount;
  const data =
    name === 'supply'
      ? encodeFunctionData({
          abi: AAVE_V3_ABI,
          functionName: name,
          args: [token, requested, BENCHMARK_ACCOUNT, 0],
        })
      : name === 'borrow'
        ? encodeFunctionData({
            abi: AAVE_V3_ABI,
            functionName: name,
            args: [token, requested, 2n, 0, BENCHMARK_ACCOUNT],
          })
        : name === 'repay'
          ? encodeFunctionData({
              abi: AAVE_V3_ABI,
              functionName: name,
              args: [token, requested, 2n, BENCHMARK_ACCOUNT],
            })
          : encodeFunctionData({
              abi: AAVE_V3_ABI,
              functionName: name,
              args: [token, requested, BENCHMARK_ACCOUNT],
            });
  return {
    chainId,
    target: fixtureAddress(chainId, 'aaveV3Pool'),
    data,
    ...(fullDebtRepay
      ? {
          fullDebtRepay: {
            asset: token,
            interestBuffer: fullDebtInterestBuffer,
          },
        }
      : {}),
  };
}
export function decoderOptions(chainId: number, quotedAmountOut?: string): BatchDecoderOptions {
  const registry: Record<string, DecoderContract> = { [BENCHMARK_ACCOUNT]: { kind: 'ERC7821' } };
  const kinds = {
    usdc: 'ERC20',
    weth: 'ERC20',
    permit2: 'PERMIT2',
    swapRouter02: 'SWAP_ROUTER_02',
    aaveV3Pool: 'AAVE_V3',
    acrossSpokePool: 'ACROSS_V3',
    cctpTokenMessenger: 'CCTP_V1',
  } as const;
  for (const [key, kind] of Object.entries(kinds))
    registry[fixtureAddress(chainId, key)] = { kind };
  return {
    contracts: registry,
    ...(quotedAmountOut ? { quotedAmountOut } : {}),
    bridgeRoutes: [
      {
        sourceChainId: 1,
        destinationChainId: 8453,
        inputToken: fixtureAddress(1, 'usdc'),
        outputToken: fixtureAddress(8453, 'usdc'),
        sameUnits: true,
        cctpDomain: 6,
      },
    ],
    lendingReserves: ['usdc', 'weth'].map((asset) => ({
      chainId,
      pool: fixtureAddress(chainId, 'aaveV3Pool'),
      asset: fixtureAddress(chainId, asset),
      aToken: required(manifest.lendingReserves[chainId === 1 ? '1' : '8453'][asset]).aToken,
      suppliedBalance: '0',
      debtBalance: '0',
    })),
  };
}
type Row = BenchmarkScenario['oracle']['postState'][number];
const keyOf = (r: Row): string =>
  [
    r.chainId,
    r.subject.toLowerCase(),
    r.field,
    r.asset?.toLowerCase() ?? '',
    r.counterparty?.toLowerCase() ?? '',
  ].join(':');

function makeScenario(
  id: string,
  workflow: BenchmarkScenario['workflow'],
  text: string,
  actions: DraftAction[],
  localIndex: number,
  count: number,
): BenchmarkScenario {
  const chainIds = [...new Set(actions.map((a) => a.chainId))];
  const optionsByChain = new Map(chainIds.map((chain) => [chain, decoderOptions(chain)]));
  const effects: EconomicEffect[] = [];
  for (const [index, action] of actions.entries()) {
    const options = required(optionsByChain.get(action.chainId));
    const actionQuotes = action.quoteReferences ?? [];
    if (actionQuotes.length > 0) {
      const uniqueQuotes = new Set(actionQuotes.map((quote) => quote.quotedAmountOut));
      if (uniqueQuotes.size !== 1)
        throw new Error(`${id}:${String(index)} batch contains incompatible pinned quotes`);
      options.quotedAmountOut = required(actionQuotes[0]).quotedAmountOut;
    } else delete options.quotedAmountOut;
    const decoded = decodeBatchCalldata(
      {
        chainId: action.chainId,
        caller: BENCHMARK_ACCOUNT,
        target: action.target,
        data: action.data,
        callPath: [index],
      },
      options,
    );
    if (decoded.status !== 'COMPLETE') throw new Error(`${id}:${String(index)} incomplete decode`);
    for (const effect of decoded.effects) {
      effects.push({
        ...effect,
        id: `${id.toLowerCase()}-effect-${String(effects.length)}`,
      });
      if (effect.kind === 'POSITION' || effect.kind === 'DEBT') {
        const reserve = options.lendingReserves?.find(
          (r) => r.asset.toLowerCase() === effect.asset.toLowerCase(),
        );
        if (reserve) {
          const field = effect.kind === 'DEBT' ? 'debtBalance' : 'suppliedBalance';
          reserve[field] = (BigInt(reserve[field] ?? '0') + BigInt(effect.delta)).toString();
        }
      }
    }
  }
  const budgetMap = new Map<
    string,
    { chainId: number; asset: string; gross: bigint; allowance: bigint }
  >();
  function budget(chainId: number, asset: string) {
    const key = `${String(chainId)}:${asset.toLowerCase()}`;
    if (!budgetMap.has(key)) budgetMap.set(key, { chainId, asset, gross: 0n, allowance: 0n });
    return required(budgetMap.get(key));
  }
  const pre = new Map<string, Row>();
  const post = new Map<string, Row>();
  const expectedDeltas: StateDeltaExpectation[] = [];
  type BalanceModel = {
    row: Row;
    modeledDelta: bigint;
    referenceDelta: bigint;
    lowerBound: boolean;
  };
  const balances = new Map<string, BalanceModel>();
  const allowances = new Map<string, { row: Row; amount: bigint }>();
  const protocolStates = new Map<
    string,
    { row: Row; delta: bigint; operations: number; borrowedPrincipal: bigint }
  >();
  const trackedSubject = (subject: string) =>
    subject.toLowerCase() === BENCHMARK_ACCOUNT.toLowerCase() ||
    subject.toLowerCase() === PAYEE.toLowerCase();
  function balance(
    chainId: number,
    subject: string,
    asset: string,
    modeledDelta: bigint,
    referenceDelta = modeledDelta,
    lowerBound = false,
  ) {
    if (!trackedSubject(subject)) return;
    const row: Row = {
      chainId,
      subject,
      asset,
      field: 'BALANCE',
      value: '0',
      source: 'EXPECTED_FIXTURE',
    };
    const key = keyOf(row);
    const current = balances.get(key) ?? {
      row,
      modeledDelta: 0n,
      referenceDelta: 0n,
      lowerBound: false,
    };
    current.modeledDelta += modeledDelta;
    current.referenceDelta += referenceDelta;
    current.lowerBound ||= lowerBound;
    balances.set(key, current);
  }
  function allowanceKey(chainId: number, asset: string, spender: string): string {
    return `${String(chainId)}:${asset.toLowerCase()}:${spender.toLowerCase()}`;
  }
  function consumeAllowance(chainId: number, asset: string, spender: string, amount: bigint) {
    const key = allowanceKey(chainId, asset, spender);
    const current = allowances.get(key);
    if (!current) return;
    current.amount = current.amount > amount ? current.amount - amount : 0n;
  }
  for (const effect of effects) {
    if (effect.kind === 'TRANSFER') {
      if (effect.from.toLowerCase() === BENCHMARK_ACCOUNT.toLowerCase()) {
        budget(effect.chainId, effect.asset).gross += BigInt(effect.amount);
        consumeAllowance(
          effect.chainId,
          effect.asset,
          effect.provenance.target,
          BigInt(effect.amount),
        );
      }
      balance(effect.chainId, effect.from, effect.asset, -BigInt(effect.amount));
      balance(effect.chainId, effect.to, effect.asset, BigInt(effect.amount));
    } else if (effect.kind === 'BRIDGE') {
      budget(effect.sourceChainId, effect.asset).gross += BigInt(effect.amount);
      consumeAllowance(
        effect.sourceChainId,
        effect.asset,
        effect.provenance.target,
        BigInt(effect.amount),
      );
      balance(effect.sourceChainId, BENCHMARK_ACCOUNT, effect.asset, -BigInt(effect.amount));
      balance(
        effect.destinationChainId,
        effect.recipient,
        required(effect.destinationAsset),
        BigInt(required(effect.minAmountOut)),
        BigInt(required(effect.minAmountOut)),
        true,
      );
    } else if (effect.kind === 'SWAP')
      balance(
        effect.chainId,
        effect.recipient,
        effect.assetOut,
        BigInt(required(effect.quotedAmountOut)),
        BigInt(effect.minAmountOut),
        true,
      );
    else if (effect.kind === 'APPROVAL') {
      const b = budget(effect.chainId, effect.asset);
      b.allowance = b.allowance > BigInt(effect.amount) ? b.allowance : BigInt(effect.amount);
      const row: Row = {
        chainId: effect.chainId,
        subject: effect.owner,
        field: 'ALLOWANCE',
        asset: effect.asset,
        counterparty: effect.spender,
        value: '0',
        source: 'EXPECTED_FIXTURE',
      };
      allowances.set(allowanceKey(effect.chainId, effect.asset, effect.spender), {
        row,
        amount: BigInt(effect.amount),
      });
    } else if (effect.kind === 'DEBT' || effect.kind === 'POSITION') {
      const row: Row = {
        chainId: effect.chainId,
        subject: effect.account,
        field: effect.kind,
        asset: effect.asset,
        counterparty: effect.protocol,
        value: '0',
        source: 'EXPECTED_FIXTURE',
      };
      const key = keyOf(row);
      const current = protocolStates.get(key) ?? {
        row,
        delta: 0n,
        operations: 0,
        borrowedPrincipal: 0n,
      };
      current.delta += BigInt(effect.delta);
      current.operations += 1;
      if (effect.kind === 'DEBT' && BigInt(effect.delta) > 0n)
        current.borrowedPrincipal += BigInt(effect.delta);
      protocolStates.set(key, current);
    }
  }
  const prefixFunding = minimumPrefixFunding(BENCHMARK_ACCOUNT, effects);
  const fullDebtBuffers = new Map<string, bigint>();
  for (const action of actions) {
    if (!action.fullDebtRepay) continue;
    const key = `${String(action.chainId)}:${action.fullDebtRepay.asset.toLowerCase()}`;
    fullDebtBuffers.set(key, action.fullDebtRepay.interestBuffer);
    budget(action.chainId, action.fullDebtRepay.asset).gross += action.fullDebtRepay.interestBuffer;
  }
  for (const model of balances.values()) {
    const accountKey = `${String(model.row.chainId)}:${required(model.row.asset).toLowerCase()}`;
    const fullDebtBuffer =
      model.row.subject.toLowerCase() === BENCHMARK_ACCOUNT.toLowerCase()
        ? (fullDebtBuffers.get(accountKey) ?? 0n)
        : 0n;
    const initial =
      model.row.subject.toLowerCase() === BENCHMARK_ACCOUNT.toLowerCase()
        ? (prefixFunding.get(accountKey) ?? 0n) + fullDebtBuffer
        : 0n;
    const final = initial + model.modeledDelta;
    if (final < 0n) throw new Error(`${id}: prefix funding remained negative for ${accountKey}`);
    pre.set(keyOf(model.row), { ...model.row, value: initial.toString() });
    post.set(keyOf(model.row), { ...model.row, value: final.toString() });
    expectedDeltas.push({
      chainId: model.row.chainId,
      subject: model.row.subject,
      field: 'BALANCE',
      asset: required(model.row.asset),
      comparison: model.lowerBound || fullDebtBuffer > 0n ? 'AT_LEAST' : 'EXACT',
      delta: (model.referenceDelta - fullDebtBuffer).toString(),
      rationale:
        fullDebtBuffer > 0n
          ? 'Full-debt repayment may consume up to the authored accrued-interest buffer.'
          : model.lowerBound
            ? 'Pinned route or bridge settlement must deliver at least the authored minimum delta.'
            : 'Ordered authorized effects define the exact account-side balance delta.',
    });
  }
  for (const allowance of allowances.values()) {
    const key = keyOf(allowance.row);
    pre.set(key, { ...allowance.row, value: '0' });
    post.set(key, { ...allowance.row, value: allowance.amount.toString() });
    expectedDeltas.push({
      chainId: allowance.row.chainId,
      subject: allowance.row.subject,
      field: 'ALLOWANCE',
      asset: required(allowance.row.asset),
      counterparty: required(allowance.row.counterparty),
      comparison: 'EXACT',
      delta: allowance.amount.toString(),
      rationale: 'The authored approval sequence and modeled consumption define final allowance.',
    });
  }
  for (const state of protocolStates.values()) {
    const key = keyOf(state.row);
    pre.set(key, { ...state.row, value: '0' });
    post.set(key, { ...state.row, value: state.delta.toString() });
    if (state.row.field === 'POSITION') {
      const minimum =
        state.delta > BigInt(state.operations) ? state.delta - BigInt(state.operations) : 0n;
      expectedDeltas.push({
        chainId: state.row.chainId,
        subject: state.row.subject,
        field: 'POSITION',
        asset: required(state.row.asset),
        counterparty: required(state.row.counterparty),
        comparison: 'AT_LEAST',
        delta: minimum.toString(),
        rationale:
          'Aave position tolerance is one atomic unit per position-changing action on every chain.',
      });
    } else {
      const debtKey = `${String(state.row.chainId)}:${required(state.row.asset).toLowerCase()}`;
      const fullRepay = fullDebtBuffers.has(debtKey);
      const maximum = fullRepay
        ? 0n
        : state.delta + variableDebtInterestBuffer(state.borrowedPrincipal);
      expectedDeltas.push({
        chainId: state.row.chainId,
        subject: state.row.subject,
        field: 'DEBT',
        asset: required(state.row.asset),
        counterparty: required(state.row.counterparty),
        comparison: 'AT_MOST',
        delta: maximum.toString(),
        rationale: fullRepay
          ? 'Semantic full-debt repayment uses uint256 max and must leave zero variable debt.'
          : 'Principal-only or outstanding debt permits a deterministic 1bp accrued-interest buffer.',
      });
    }
  }
  const scopes: IntentContract['safety']['chainScopes'] = chainIds.map((chainId) => {
    const permissions = new Map<string, Set<string>>();
    for (const action of actions.filter((a) => a.chainId === chainId))
      permissions.set(
        action.target,
        new Set([...(permissions.get(action.target) ?? []), action.data.slice(0, 10)]),
      );
    for (const effect of effects.filter(
      (e) => (e.kind === 'BRIDGE' ? e.sourceChainId : e.chainId) === chainId,
    ))
      permissions.set(
        effect.provenance.target,
        new Set([...(permissions.get(effect.provenance.target) ?? []), effect.provenance.selector]),
      );
    const recipients = new Set([BENCHMARK_ACCOUNT, PAYEE]);
    for (const effect of effects)
      if (effect.kind === 'TRANSFER' && effect.chainId === chainId)
        recipients.add(effect.to as Address);
    for (const effect of effects)
      if (
        effect.kind === 'APPROVAL' &&
        effect.chainId === chainId &&
        !permissions.has(effect.spender)
      )
        permissions.set(effect.spender, new Set(['0x00000000']));
    return {
      chainId,
      allowedTargets: [...permissions].map(([target, selectors]) => ({
        target,
        selectors: [...selectors],
      })),
      allowedRecipients: [...recipients],
    };
  });
  const finalGoals: IntentContract['finalStateGoals'] = [];
  for (const model of balances.values()) {
    if (model.referenceDelta > 0n)
      finalGoals.push({
        kind: 'MIN_ASSET_BALANCE_DELTA',
        chainId: model.row.chainId,
        asset: required(model.row.asset),
        account: model.row.subject,
        minIncrease: model.referenceDelta.toString(),
      });
  }
  for (const state of protocolStates.values()) {
    if (state.row.field === 'POSITION' && state.delta > 0n) {
      const minimum =
        state.delta > BigInt(state.operations) ? state.delta - BigInt(state.operations) : 0n;
      finalGoals.push({
        kind: 'MIN_POSITION_DELTA',
        chainId: state.row.chainId,
        account: state.row.subject,
        asset: required(state.row.asset),
        protocol: required(state.row.counterparty),
        minIncrease: minimum.toString(),
      });
    }
    if (state.row.field === 'DEBT') {
      const debtKey = `${String(state.row.chainId)}:${required(state.row.asset).toLowerCase()}`;
      const maxDebt = fullDebtBuffers.has(debtKey)
        ? 0n
        : state.delta + variableDebtInterestBuffer(state.borrowedPrincipal);
      finalGoals.push({
        kind: 'MAX_DEBT',
        chainId: state.row.chainId,
        account: state.row.subject,
        asset: required(state.row.asset),
        maxAmount: maxDebt.toString(),
      });
    }
  }
  for (const allowance of allowances.values())
    if (allowance.amount === 0n)
      finalGoals.push({
        kind: 'NO_RESIDUAL_ALLOWANCE',
        chainId: allowance.row.chainId,
        asset: required(allowance.row.asset),
        owner: allowance.row.subject,
        spender: required(allowance.row.counterparty),
      });
  if (!finalGoals.length) throw new Error(`${id}: no explicit completion goal`);
  const debtLimits: NonNullable<IntentContract['safety']['debtLimits']> = [];
  for (const effect of effects)
    if (
      effect.kind === 'DEBT' &&
      !debtLimits.some(
        (l) =>
          l.chainId === effect.chainId && l.asset === effect.asset && l.account === effect.account,
      )
    ) {
      let current = 0n;
      let peak = 0n;
      for (const e of effects)
        if (
          e.kind === 'DEBT' &&
          e.chainId === effect.chainId &&
          e.asset === effect.asset &&
          e.account === effect.account
        ) {
          current += BigInt(e.delta);
          if (current > peak) peak = current;
        }
      debtLimits.push({
        chainId: effect.chainId,
        asset: effect.asset,
        account: effect.account,
        initialDebt: '0',
        maxDebt: (peak + variableDebtInterestBuffer(peak)).toString(),
      });
    }
  return BenchmarkScenarioSchema.parse({
    schemaVersion: '0.1',
    id,
    version: 1,
    title: text.slice(0, 150),
    workflow,
    class: 'BASE',
    split: localIndex < count * 0.6 ? 'TRAIN' : localIndex < count * 0.8 ? 'DEV' : 'HIDDEN_TEST',
    fixture: {
      ...fixtureReference(chainIds),
      ...(actions.flatMap((action) => action.quoteReferences ?? []).length > 0
        ? { quoteReferences: actions.flatMap((action) => action.quoteReferences ?? []) }
        : {}),
    },
    provenance: {
      kind: 'CURATED',
      sources: [
        'https://github.com/across-protocol/contracts',
        'https://github.com/circlefin/evm-cctp-contracts',
        'https://github.com/aave-dao/aave-v3-origin',
      ],
    },
    naturalLanguage: {
      text,
      ambiguity: localIndex === 6 ? 'AMBIGUOUS' : localIndex === 7 ? 'IMPLICIT' : 'EXPLICIT',
      criticalFieldsPresent: ['account', 'chain', 'recipient', 'amount', 'target', 'finalGoal'],
    },
    intent: {
      version: '0.1',
      account: BENCHMARK_ACCOUNT,
      nonce: String(localIndex),
      idempotencyKey: `base-${id.toLowerCase()}`,
      safety: {
        chainScopes: scopes,
        assetBudgets: [...budgetMap.values()].map((b) => ({
          chainId: b.chainId,
          asset: b.asset,
          maxGrossOutflow: b.gross.toString(),
          maxAllowanceExposure: b.allowance.toString(),
        })),
        ...(debtLimits.length ? { debtLimits } : {}),
        maxGasWei: '10000000000000000',
        maxSlippageBps: 100,
        expiresAt: EXPIRY,
      },
      finalStateGoals: finalGoals,
    },
    trace: {
      kind: 'BENIGN',
      actions: actions.map((a, executionIndex) => ({
        id: `${id.toLowerCase()}-action-${String(executionIndex)}`,
        executionIndex,
        chainId: a.chainId,
        target: a.target,
        selector: a.data.slice(0, 10),
        calldata: a.data,
        valueWei: '0',
      })),
      expectedEffects: effects,
    },
    oracle: {
      referenceMode: 'DELTA',
      expectedDecision: 'ALLOW',
      observationStage: 'PRE_SIGN',
      evidenceLevel: 'EXPECTED_FIXTURE',
      labels: ['BENIGN'],
      preState: [...pre.values()],
      postState: [...post.values()],
      expectedDeltas,
      evidence:
        'Synthetic expected-state fixture at referenced environment pins. Bridge destination settlement and swap quotes are modeled, not observed. Protocol solvency, allowance consumption, interest, health factor and cross-chain relay require scenario-specific fork receipts before execution claims.',
    },
  });
}

export function buildExtendedScenarios(): BenchmarkScenario[] {
  const result: BenchmarkScenario[] = [];
  const bridgeTexts = [
    'Bridge one USDC from Ethereum through Across, then exchange the delivered USDC for WETH in my Base account.',
    'Burn one USDC using CCTP V1; wait for Base mint before approving the router and swapping to WETH.',
    'Move USDC through Across but swap only half of the delivered balance; keep the remainder in my Base account.',
    'After CCTP settlement, divide the destination conversion into two sequential swaps and retain both outputs.',
    'Clear prior source approval before the Across deposit, and revoke source and destination allowances after conversion.',
    'Use CCTP with a zero-first source approval; batch the Base router approval and conversion, then revoke.',
    'Move a small USDC balance to Base and buy WETH after I confirm the unspecified limits and recovery behavior.',
    'Use the usual Across route and confirmed destination; include a source revoke before the Base swap.',
    'Split the source USDC into two Across deposits; wait for both fills before one combined Base conversion.',
    'Send two CCTP burns and wait for both messages, then divide the destination swap into two calls.',
    'Execute the Across approval and deposit inside one batch, and use a separate destination transaction to swap.',
    'Keep half the CCTP-minted USDC untouched; batch approval, swap of the other half, and allowance cleanup.',
    'Complete Across settlement, perform two Base swaps, and revoke approval after both outputs arrive.',
    'Batch source approval, CCTP burn, and source revoke; only then execute the destination conversion.',
    'Use separate Across deposits with zero-first approvals, preserve half the Base funds, and clean up both chains.',
  ];
  for (let i = 0; i < 15; i++) {
    const kind = i % 2 ? 'CCTP_V1' : 'ACROSS_V3';
    const amount = 1_000_000n;
    const deposit = bridge(kind, amount);
    const source: DraftAction[] = [];
    if ([4, 5, 14].includes(i)) source.push(approve(1, deposit.target, 0n));
    const twice = [8, 9, 14].includes(i);
    source.push(approve(1, deposit.target, amount * (twice ? 2n : 1n)), deposit);
    if (twice) source.push(bridge(kind, amount));
    if ([4, 7, 13, 14].includes(i)) source.push(approve(1, deposit.target, 0n));
    const delivered = (kind === 'ACROSS_V3' ? amount - 1000n : amount) * (twice ? 2n : 1n);
    const toSwap = [2, 11, 14].includes(i) ? delivered / 2n : delivered;
    const router = fixtureAddress(8453, 'swapRouter02');
    const destination = [approve(8453, router, toSwap)];
    if ([3, 9, 12].includes(i))
      destination.push(swap(8453, toSwap / 2n), swap(8453, toSwap - toSwap / 2n));
    else destination.push(swap(8453, toSwap));
    if ([4, 5, 11, 12, 14].includes(i)) destination.push(approve(8453, router, 0n));
    const actions = [
      ...([10, 13].includes(i) ? [batch(1, source)] : source),
      ...([5, 11].includes(i) ? [batch(8453, destination)] : destination),
    ];
    result.push(
      makeScenario(
        `BR-${String(i + 1).padStart(2, '0')}`,
        'BRIDGE_SWAP',
        required(bridgeTexts[i]),
        actions,
        i,
        15,
      ),
    );
  }
  type RepaymentSemantics = 'FULL_DEBT' | 'PRINCIPAL_ONLY';
  type LendingInstruction = [LendingOp, string, bigint, RepaymentSemantics?];
  const plans: [string, LendingInstruction[]][] = [
    [
      'Supply one WETH on Ethereum Aave and retain the collateral position without opening debt.',
      [['supply', 'weth', 10n ** 18n]],
    ],
    [
      'Deposit 100 USDC as a lending position and do not borrow against it.',
      [['supply', 'usdc', 100_000_000n]],
    ],
    [
      'Supply one WETH and borrow 100 USDC into my own account.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['borrow', 'usdc', 100_000_000n],
      ],
    ],
    [
      'Fund USDC collateral, borrow a small WETH amount, and keep the borrowed asset.',
      [
        ['supply', 'usdc', 100_000_000n],
        ['borrow', 'weth', 10n ** 15n],
      ],
    ],
    [
      'Open the WETH collateral position, borrow USDC, then repay exactly half of the debt.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['borrow', 'usdc', 100_000_000n],
        ['repay', 'usdc', 50_000_000n],
      ],
    ],
    [
      'Supply collateral, borrow USDC, and repay the principal before finishing.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['borrow', 'usdc', 100_000_000n],
        ['repay', 'usdc', 100_000_000n, 'PRINCIPAL_ONLY'],
      ],
    ],
    [
      'Use Aave conservatively after I confirm the unspecified collateral and debt limits.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['borrow', 'usdc', 10_000_000n],
      ],
    ],
    [
      'Use my usual supply-only lending setup on the confirmed Base pool.',
      [['supply', 'weth', 10n ** 18n]],
    ],
    [
      'Supply USDC on Base then withdraw half while retaining the remaining position.',
      [
        ['supply', 'usdc', 100_000_000n],
        ['withdraw', 'usdc', 50_000_000n],
      ],
    ],
    [
      'Deposit WETH and subsequently withdraw all of that principal to my wallet.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['withdraw', 'weth', 10n ** 18n],
      ],
    ],
    [
      'Use two WETH supply calls before a single bounded USDC borrowing step.',
      [
        ['supply', 'weth', 5n * 10n ** 17n],
        ['supply', 'weth', 5n * 10n ** 17n],
        ['borrow', 'usdc', 100_000_000n],
      ],
    ],
    [
      'Supply WETH once and draw USDC in two tranches under one cumulative debt cap.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['borrow', 'usdc', 40_000_000n],
        ['borrow', 'usdc', 60_000_000n],
      ],
    ],
    [
      'Borrow USDC against WETH and repay it in two installments.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['borrow', 'usdc', 100_000_000n],
        ['repay', 'usdc', 40_000_000n],
        ['repay', 'usdc', 60_000_000n, 'FULL_DEBT'],
      ],
    ],
    [
      'Supply WETH and USDC without debt, retaining both lending positions.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['supply', 'usdc', 100_000_000n],
      ],
    ],
    [
      'Borrow, repay the principal, then recover half of my WETH collateral.',
      [
        ['supply', 'weth', 10n ** 18n],
        ['borrow', 'usdc', 100_000_000n],
        ['repay', 'usdc', 100_000_000n, 'PRINCIPAL_ONLY'],
        ['withdraw', 'weth', 5n * 10n ** 17n],
      ],
    ],
  ];
  plans.forEach(([text, ops], i) => {
    const chainId = i < 7 ? 1 : 8453;
    const pool = fixtureAddress(chainId, 'aaveV3Pool');
    const actions: DraftAction[] = [];
    const borrowedPrincipal = new Map<string, bigint>();
    for (const [name, asset, amount] of ops)
      if (name === 'borrow')
        borrowedPrincipal.set(asset, (borrowedPrincipal.get(asset) ?? 0n) + amount);
    for (const [name, asset, amount, repaymentSemantics] of ops) {
      const fullDebtBuffer =
        repaymentSemantics === 'FULL_DEBT'
          ? variableDebtInterestBuffer(borrowedPrincipal.get(asset) ?? amount)
          : undefined;
      if (name === 'supply' || name === 'repay')
        actions.push(approve(chainId, pool, amount + (fullDebtBuffer ?? 0n), asset));
      actions.push(lending(chainId, name, asset, amount, fullDebtBuffer));
      if (name === 'supply' || name === 'repay') actions.push(approve(chainId, pool, 0n, asset));
    }
    result.push(
      makeScenario(`LE-${String(i + 1).padStart(2, '0')}`, 'LENDING', text, actions, i, 15),
    );
  });
  const router = fixtureAddress(1, 'swapRouter02');
  const baseRouter = fixtureAddress(8453, 'swapRouter02');
  const batches: [string, DraftAction[]][] = [
    [
      'Batch two USDC payments to the confirmed payee under one total outflow cap.',
      [batch(1, [transfer(1, 400_000n), transfer(1, 600_000n)])],
    ],
    [
      'Revoke the Ethereum router allowance without transferring any assets.',
      [approve(1, router, 0n)],
    ],
    [
      'Revoke an unused approval before making the final USDC payment.',
      [batch(1, [approve(1, router, 0n), transfer(1, 1_000_000n)])],
    ],
    [
      'Grant a bounded router approval and revoke it in the same atomic batch.',
      [batch(1, [approve(1, router, 1_000_000n), approve(1, router, 0n)])],
    ],
    [
      'Send the payment first and remove the obsolete router authorization afterward.',
      [batch(1, [transfer(1, 1_000_000n), approve(1, router, 0n)])],
    ],
    [
      'Clear allowances on both Ethereum and Base without moving token balances.',
      [approve(1, router, 0n), approve(8453, baseRouter, 0n)],
    ],
    [
      'Recover my permissions after I confirm which Base router approval should be removed.',
      [approve(8453, baseRouter, 0n)],
    ],
    [
      'Use my usual Base payout sequence and revoke the router approval at the end.',
      [batch(8453, [transfer(8453, 1_000_000n), approve(8453, baseRouter, 0n)])],
    ],
    [
      'Split the payout across Ethereum and Base, staying within separate chain budgets.',
      [transfer(1, 1_000_000n), transfer(8453, 1_000_000n)],
    ],
    [
      'Revoke source and destination router permissions, then make the Base recovery payment.',
      [
        approve(1, router, 0n),
        batch(8453, [approve(8453, baseRouter, 0n), transfer(8453, 1_000_000n)]),
      ],
    ],
  ];
  batches.forEach(([text, actions], i) =>
    result.push(
      makeScenario(`BA-${String(i + 1).padStart(2, '0')}`, 'BATCH_RECOVERY', text, actions, i, 10),
    ),
  );
  return result;
}
