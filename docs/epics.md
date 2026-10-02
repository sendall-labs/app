# Phase 2: Epics and Tasks

Source of requirements: [prd.md](./prd.md). Branch: `feat/sow2`.
This file is the working tracker. Tick a task only when its acceptance criteria are met and it is committed.

## Working rules (for every task)

1. Take the first unchecked task, in order, whose dependencies are done. Skip tasks marked `BLOCKED`.
2. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (see AGENTS.md). Route handlers take `params: Promise<...>`, and `cookies()` is awaited.
3. Implement the task. Keep changes scoped to it and match the surrounding code style.
4. Verify:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
   - the task's integration test, if it has one (Testnet; needs `.env` service keys from T0.3).
5. Commit on `feat/sow2` only:
   - conventional prefix (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`);
   - lowercase imperative subject, the "why" in the body;
   - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6. Tick the task here, add a line to the Log, and commit that with the task.
7. If a task is still failing after two real attempts, mark it `BLOCKED: <reason>` and move on to the next task that does not depend on it.

Never:
- push, open PRs, or touch `main` or other branches;
- spend Mainnet funds;
- commit secrets, `.env*` or `docs/instawards-2ay-taslak.md`;
- delete the legacy engine;
- store, request or transmit a user secret key.

Environment:
- Postgres is the Docker container `multisend-dev-db` on port 5433. If it is down, run `open -a Docker`, then `docker start multisend-dev-db`.
- Apply migrations with `npx prisma migrate dev`.
- Run the dev server in the background for E2E work, and stop it afterwards.

## E0 Foundation

- [x] **T0.1** Branch `feat/sow2`, PRD, this tracker, exclude the draft notes from git.
- [x] **T0.2** Extract shared UI and helpers from `src/app/(app)/batches/[batchId]/page.tsx`. No behavior change.
  - Move `KNOWN_ASSETS`, `findKnownAsset`, `issuerForNetwork` to `src/lib/stellar/assets.ts`.
  - Move the explorer link helpers to `src/lib/stellar/explorer.ts`.
  - Move `formatAmount` and `sumAmounts` to `src/lib/format.ts`.
  - Move `AssetField`, `NetworkField` and `AssetIcon` to `src/components/batches/`.
  - Accept: the page imports them; lint, tsc and tests are green.
- [x] **T0.3** Service accounts.
  - `src/lib/crypto/serviceKeys.ts`: AES-256-GCM encrypt/decrypt keyed by `SERVICE_KEY_ENCRYPTION_KEY`, with unit tests.
  - `src/lib/stellar/serviceAccounts.ts`: per-network sponsor M loaded from `SPONSOR_SECRET_TESTNET` / `SPONSOR_SECRET_PUBLIC`.
  - `scripts/bootstrap-testnet.ts`: create and friendbot-fund M, write the keys to `.env` if missing, provision the channel pool (T1.2) once it exists.
  - Document every new env var in `.env.example` with placeholder values only.
- [x] **T0.4** Prisma migration (additive; legacy models unchanged).
  - `Batch`: add `kind BatchKind @default(PAYMENT)` and `claimExpiresAt`.
  - `Recipient`: add `deliveryMethod`, `claimableBalanceId`, `claimStatus`, `claimTxHash`, `claimedAt`.
  - New models `ChannelAccount`, `DistributionRun`, `ChannelTransaction`, `ChannelTransactionItem`, with the fields and state enums from PRD 3.2.
  - Accept: `npx prisma migrate dev` applies cleanly and the client regenerates.

## E1 Channel engine (parallel submission, one signature)

- [ ] **T1.1** `src/lib/distribution/authority.ts`.
  - Analyse U from Horizon: free signer slots and thresholds.
  - `preAuthWeight = max(med, 1)`.
  - Reject with `INSUFFICIENT_SIGNER_SLOTS` or `UNSUPPORTED_MULTISIG` (master weight below high threshold).
  - Unit tests: default account, custom thresholds, full signer list.
- [ ] **T1.2** `channelPool.ts`.
  - Provision channels from M (minimal balance; fees come from fee bumps).
  - Reserve N channels in one DB transaction with `FOR UPDATE SKIP LOCKED`, storing `expectedSequence`, runId, lockedAt and expiresAt.
  - Release; quarantine on sequence drift; sweep expired reservations; top up.
  - Integration test against Testnet and the local DB.
- [ ] **T1.3** `buildChunks.ts`.
  - Chunk 100 ops per tx. Tx source is the channel at `expectedSequence`; every op has source U.
  - Op kinds: payment, createAccount, createClaimableBalance, claimClaimableBalance.
  - Time bounds about 15 min. Return the exact XDR and hash.
  - Unit tests: hash stability, op sources, chunk boundaries (100, 101, 1000).
- [ ] **T1.4** `buildSetup.ts`.
  - Setup tx: source U, max time about 5 min.
  - Ops in order: Begin sponsoring (source M), SetOptions preAuthTx × n with the computed weight, End sponsoring (source U).
  - Signed by M. Persisted.
  - Unit tests.
- [ ] **T1.5** `verifySetup.ts`.
  - The signed XDR must equal the persisted tx except for signatures.
  - U's signature must be valid over the hash; network, seq and time bounds must match.
  - Unit tests for tampering: changed op, signer hash, weight, sponsor, seq, time bounds, network, missing U signature.
- [ ] **T1.6** `feeBump.ts` and submit.
  - Build the fee bump with M and fee from fee stats (capped).
  - Submit and poll, reusing `src/lib/stellar/submit.ts`.
  - Handle `TRY_AGAIN_LATER`, `DUPLICATE` and timeouts.
  - Hash-first lookup (`getTransaction`) before any resubmit.
- [ ] **T1.7** `engine.ts`.
  - Run state machine with an idempotent `advanceRun(runId)` that uses compare-and-set on status.
  - Execute after the setup is confirmed, with bounded concurrency through `p-limit`.
  - Check channel sequence drift before submit and fail safe (no rebuild).
  - Persist hashes before submit; resume on restart.
- [ ] **T1.8** `reconcile.ts`.
  - Map per-op results to recipients; the tx is atomic, so a failed tx fails every row in it.
  - Failed after apply: `REAUTHORIZATION_REQUIRED`. Not applied and expired: `EXPIRED`.
  - Verify on Horizon that the run's preAuth signers are gone from U and its sponsorship is released.
  - Release the channels.
- [ ] **T1.9** `cleanup.ts`.
  - Detect stale runs.
  - Build a signer-removal tx for the leftover hashes (U signs, M fee-bumps), verified the same way as T1.5.
- [ ] **T1.10** API routes (Zod validation, `resolveBatchAccess`, idempotency key):
  - `POST /api/batches/[batchId]/runs` (prepare; returns `setupXdr`, summary, runId)
  - `POST /api/runs/[runId]/authorize`
  - `GET /api/runs/[runId]` (status; also nudges `advanceRun`)
  - `POST /api/runs/[runId]/cleanup`
  - `POST /api/runs/[runId]/reauthorize`
- [ ] **T1.11** Extended preflight.
  - U's balance of the asset covers the total.
  - U's XLM covers `createAccount` starting balances and claimable balance reserves.
  - Trustlines are authorized.
  - M can cover signer reserves and fees.
  - Surface each of these clearly in the API.
- [ ] **T1.12** Testnet integration tests in `src/lib/distribution/engine.integration.test.ts` (`describe.skipIf(!!process.env.CI)`), one per test in the pasted spec:
  1. 100 recipients: 1 channel, 1 tx.
  2. 300 recipients: 3 txs on independent channels.
  3. 1,000 recipients: 10 txs, one setup signature, parallel submission.
  4. A missing trustline is caught before setup.
  5. A forced failure after authorization ends `REAUTHORIZATION_REQUIRED`, the signer is consumed, and no rebuild happens.
  6. A crash after setup resumes from the persisted XDRs.
  7. A channel sequence drift fails the batch safely.
  8. Insufficient signer slots are rejected.
  9. Custom thresholds: the weight is OK, and a single signature that cannot meet high is rejected.
- [ ] **T1.13** Wire the batch page Send to the new engine when `SEND_ENGINE=channels` (default). Legacy stays reachable with `SEND_ENGINE=legacy`.

## E2 Live send flow

- [ ] **T2.1** `src/components/distribution/DistributionProgress.tsx`.
  - Animated stages: Wallet approval, Authorization confirming, Transactions processing, then Completed / Partial / Failed.
  - One lane per tx: channel, op count, status, explorer link.
  - Elapsed timer; polls `GET /api/runs/[runId]` every second.
  - Respects `prefers-reduced-motion`. No new animation dependency unless clearly needed.
- [ ] **T2.2** Review card and error states.
  - Card: recipients, total, tx count, network, "fees and signer reserves covered by Sendall", claimable balance reserve.
  - States: wallet rejected, setup failed, reauthorization required (button), cleanup required (button).

## E3 Claimable balances

- [ ] **T3.1** Navigation and list.
  - Sidebar entries "Bulk Payment" and "Bulk Claimable Balance".
  - `/batches/new?kind=` presets the type.
  - The batch list shows a type badge and "claimed x / y".
- [ ] **T3.2** Type switch and conversion.
  - Payment / Claimable balance switch in the batch page; it is locked once a run exists.
  - Type-specific checks: claimable balances do not require a trustline or an existing account, and warn when the account is missing.
  - "Send failed rows as claimable balance" creates a new claimable balance batch from no-trustline failures.
- [ ] **T3.3** Claimable balance operations.
  - Predicates per PRD FR-3.1; expiry picker 7/30/90 (default 30) stored in `claimExpiresAt`.
  - Balance IDs parsed from the result XDR and saved per recipient.
- [ ] **T3.4** `reserve.ts`.
  - Live base reserve × claimants × recipients.
  - Shown in review; blocks the send when U cannot cover it.
  - Testnet spike: create one 2-claimant balance and record the reserve actually locked in PRD section 7.
- [ ] **T3.5** Claim status.
  - `POST /api/batches/[batchId]/claims/sync` reads Horizon: a balance that is gone was claimed by the recipient (`CLAIMED`) or by the sender (`RECLAIMED`).
  - The batch page shows per-row status, totals and time to expiry. Sync runs on load and has a button.
- [ ] **T3.6** Reclaim. After expiry, a "Reclaim unclaimed" action runs the engine with `claimClaimableBalance` ops (source U, one signature).
- [ ] **T3.7** Public `/claim` page (outside the app shell, no session needed).
  - Connect a wallet, list the balances waiting for it, and claim in one tx (`changeTrust` if missing, then `claimClaimableBalance`); the recipient signs and pays.
  - `?batch=` share link; guidance when the account does not exist.
  - The batch page has a "Copy claim link" action.
- [ ] **T3.8** Tests.
  - Unit tests for predicates and reserve.
  - Testnet integration: create to recipients without a trustline, claim, reclaim with a short expiry.
  - Save the hashes to `docs/evidence-testnet.md`.

## E4 Receipt

- [ ] **T4.1** `GET /api/batches/[batchId]/receipt` returns a PDF.
  - Try `@react-pdf/renderer` first; if it fails under Next 16, use `pdfkit` and record the choice in the commit body.
  - Layout per PRD 3.5, multipage.
- [ ] **T4.2** Download button on completed and partial batches. Test that rendering 1,000 rows produces a valid multipage PDF.

## E5 Mainnet

- [ ] **T5.1** Build and sign every tx with `batch.network`. Detect the wallet's network and block sending on a mismatch.
- [ ] **T5.2** Mainnet confirmation gate (summary plus type-to-confirm), a clear Mainnet badge, and demo and friendbot disabled on `PUBLIC`.
- [ ] **T5.3** Per-network service config and fee strategy (fee stats with a cap). Refuse a run when M cannot cover it. The Mainnet RPC comes from env.
- [ ] **T5.4** Mainnet runbook at `../developer-docs/mainnet-runbook.md`. It lives outside the repo and is not committed: funding M and the channels, env on the host, the first real distribution step by step.

## E6 Evidence and docs

- [ ] **T6.1** `scripts/benchmark.ts`.
  - Create or reuse funded Testnet recipient lists of 300, 500 and 1,000.
  - Run the legacy and channel engines on the same lists, measuring from signature to the last confirmation.
  - Write `docs/benchmark.md` with a table and explorer links.
- [ ] **T6.2** `docs/evidence-testnet.md`: setup, payment and claimable balance create/claim/reclaim hashes with explorer links.
- [ ] **T6.3** Playwright specs with screenshots saved to `docs/screenshots/sow2/`:
  - channel payment, one screenshot per live stage;
  - claimable balance send;
  - type switch;
  - claim page;
  - receipt download;
  - Mainnet gate (no submission).
- [ ] **T6.4** Public docs site (`../docs`, its own repo, branch `feat/sow2-docs`): pages for claimable balances, parallel submission, receipts and Mainnet. Product-level content only.
- [ ] **T6.5** Final verification and report.
  - Run lint, tsc, unit, integration and E2E.
  - Write `../developer-docs/sow2-morning-report.md`: what was done, test results, screenshots, blocked items, and what the owner must do (Mainnet funding and run, deploy, demo recording, push and PR).

## Log

- 2026-10-02 T0.1 done: branch, PRD, tracker.
- 2026-10-02 T0.2 done: assets, explorer links, amount formatting and the Asset/Network fields moved out of the batch page into `src/lib/stellar/{assets,explorer}.ts`, `src/lib/format.ts`, `src/components/batches/AssetFields.tsx`. lint, tsc clean; vitest 47/47 (incl. live Testnet integration).
- 2026-10-02 T0.3 done: AES-256-GCM `serviceKeys.ts` (v1 format, tamper and wrong-key tests), `serviceAccounts.ts` (sponsor M from `SPONSOR_SECRET_<NETWORK>`), `npm run bootstrap:testnet` (idempotent; generated the encryption key and Testnet M `GDJDV3NU…UNQT`, funded 10,000 XLM). Decision: sponsor secret lives in host env, channel secrets will be encrypted in DB. Channel provisioning gets added to the script in T1.2. Added `tsx` dev dependency for scripts. lint, tsc clean; vitest 54/54.
- 2026-10-03 T0.4 done: migration `20261002210258_sow2_channel_engine`, additive only (no drops or column changes). Adds Batch.kind and claimExpiresAt, recipient delivery and claim fields, and the ChannelAccount, DistributionRun, ChannelTransaction and ChannelTransactionItem models, with unique indexes on run idempotency key, setup hash, tx hash and (runId, chunkIndex) so duplicates fail at the DB. lint, tsc clean; vitest 54/54.
