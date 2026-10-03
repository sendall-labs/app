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
- commit secrets, `.env*` or local draft notes;
- delete the legacy engine;
- store, request or transmit a user secret key.

Environment:
- Postgres is the Docker container `multisend-dev-db` on port 5433. If it is down, run `open -a Docker`, then `docker start multisend-dev-db`.
- Apply migrations with `npx prisma migrate dev`.
- Run the dev server in the background for E2E work, and stop it afterwards. Restart it after any Prisma migration (it keeps the old generated client).

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

- [x] **T1.1** `src/lib/distribution/authority.ts`.
  - Analyse U from Horizon: free signer slots and thresholds.
  - `preAuthWeight = max(med, 1)`.
  - Reject with `INSUFFICIENT_SIGNER_SLOTS` or `UNSUPPORTED_MULTISIG` (master weight below high threshold).
  - Unit tests: default account, custom thresholds, full signer list.
- [x] **T1.2** `channelPool.ts`.
  - Provision channels from M (minimal balance; fees come from fee bumps).
  - Reserve N channels in one DB transaction with `FOR UPDATE SKIP LOCKED`, storing `expectedSequence`, runId, lockedAt and expiresAt.
  - Release; quarantine on sequence drift; sweep expired reservations; top up.
  - Integration test against Testnet and the local DB.
- [x] **T1.3** `buildChunks.ts`.
  - Chunk 100 ops per tx. Tx source is the channel at `expectedSequence`; every op has source U.
  - Op kinds: payment, createAccount, createClaimableBalance, claimClaimableBalance.
  - Time bounds about 15 min. Return the exact XDR and hash.
  - Unit tests: hash stability, op sources, chunk boundaries (100, 101, 1000).
- [x] **T1.4** `buildSetup.ts`.
  - Setup tx: source U, max time about 5 min.
  - Ops in order: Begin sponsoring (source M), SetOptions preAuthTx × n with the computed weight, End sponsoring (source U).
  - Signed by M. Persisted.
  - Unit tests.
- [x] **T1.5** `verifySetup.ts`.
  - The signed XDR must equal the persisted tx except for signatures.
  - U's signature must be valid over the hash; network, seq and time bounds must match.
  - Unit tests for tampering: changed op, signer hash, weight, sponsor, seq, time bounds, network, missing U signature.
- [x] **T1.6** `feeBump.ts` and submit.
  - Build the fee bump with M and fee from fee stats (capped).
  - Submit and poll, reusing `src/lib/stellar/submit.ts`.
  - Handle `TRY_AGAIN_LATER`, `DUPLICATE` and timeouts.
  - Hash-first lookup (`getTransaction`) before any resubmit.
- [x] **T1.7** `engine.ts`.
  - Run state machine with an idempotent `advanceRun(runId)` that uses compare-and-set on status.
  - Execute after the setup is confirmed, with bounded concurrency through `p-limit`.
  - Check channel sequence drift before submit and fail safe (no rebuild).
  - Persist hashes before submit; resume on restart.
- [x] **T1.8** `reconcile.ts`.
  - Map per-op results to recipients; the tx is atomic, so a failed tx fails every row in it.
  - Failed after apply: `REAUTHORIZATION_REQUIRED`. Not applied and expired: `EXPIRED`.
  - Verify on Horizon that the run's preAuth signers are gone from U and its sponsorship is released.
  - Release the channels.
- [x] **T1.9** `cleanup.ts`.
  - Detect stale runs.
  - Build a signer-removal tx for the leftover hashes (U signs, M fee-bumps), verified the same way as T1.5.
- [x] **T1.10** API routes (Zod validation, `resolveBatchAccess`, idempotency key):
  - `POST /api/batches/[batchId]/runs` (prepare; returns `setupXdr`, summary, runId)
  - `POST /api/runs/[runId]/authorize`
  - `GET /api/runs/[runId]` (status; also nudges `advanceRun`)
  - `POST /api/runs/[runId]/cleanup`
  - `POST /api/runs/[runId]/reauthorize`
- [x] **T1.11** Extended preflight.
  - U's balance of the asset covers the total.
  - U's XLM covers `createAccount` starting balances and claimable balance reserves.
  - Trustlines are authorized.
  - Rows with a memo are refused: one transaction carries one memo, so per-recipient memos (e.g. exchange deposits) cannot be honored inside a 100-op chunk.
  - M can cover signer reserves and fees.
  - Surface each of these clearly in the API.
- [x] **T1.12** Testnet integration tests in `src/lib/distribution/engine.integration.test.ts` (`describe.skipIf(!!process.env.CI)`), one per test in the pasted spec:
  1. 100 recipients: 1 channel, 1 tx.
  2. 300 recipients: 3 txs on independent channels.
  3. 1,000 recipients: 10 txs, one setup signature, parallel submission.
  4. A missing trustline is caught before setup.
  5. A forced failure after authorization ends `REAUTHORIZATION_REQUIRED`, the signer is consumed, and no rebuild happens.
  6. A crash after setup resumes from the persisted XDRs.
  7. A channel sequence drift fails the batch safely.
  8. Insufficient signer slots are rejected.
  9. Custom thresholds: the weight is OK, and a single signature that cannot meet high is rejected.
- [x] **T1.13** Wire the batch page Send to the new engine when `SEND_ENGINE=channels` (default). Legacy stays reachable with `SEND_ENGINE=legacy`.

## E2 Live send flow

- [x] **T2.1** `src/components/distribution/DistributionProgress.tsx`.
  - Animated stages: Wallet approval, Authorization confirming, Transactions processing, then Completed / Partial / Failed.
  - One lane per tx: channel, op count, status, explorer link.
  - Elapsed timer; polls `GET /api/runs/[runId]` every second.
  - Respects `prefers-reduced-motion`. No new animation dependency unless clearly needed.
- [x] **T2.2** Review card and error states.
  - Card: recipients, total, tx count, network, "fees and signer reserves covered by Sendall", claimable balance reserve.
  - States: wallet rejected, setup failed, reauthorization required (button), cleanup required (button).

## E3 Claimable balances

- [x] **T3.1** Navigation and list.
  - Sidebar entries "Bulk Payment" and "Bulk Claimable Balance".
  - `/batches/new?kind=` presets the type.
  - The batch list shows a type badge and "claimed x / y".
- [x] **T3.2** Type switch and conversion.
  - Payment / Claimable balance switch in the batch page; it is locked once a run exists.
  - Type-specific checks: claimable balances do not require a trustline or an existing account, and warn when the account is missing.
  - "Send failed rows as claimable balance" creates a new claimable balance batch from no-trustline failures.
- [x] **T3.3** Claimable balance operations.
  - Predicates per PRD FR-3.1; expiry picker 7/30/90 (default 30) stored in `claimExpiresAt`.
  - Balance IDs parsed from the result XDR and saved per recipient.
- [x] **T3.4** `reserve.ts`.
  - Live base reserve × claimants × recipients.
  - Shown in review; blocks the send when U cannot cover it.
  - Testnet spike: create one 2-claimant balance and record the reserve actually locked in PRD section 7.
- [x] **T3.5** Claim status.
  - `POST /api/batches/[batchId]/claims/sync` reads Horizon: a balance that is gone was claimed by the recipient (`CLAIMED`) or by the sender (`RECLAIMED`).
  - The batch page shows per-row status, totals and time to expiry. Sync runs on load and has a button.
- [x] **T3.6** Reclaim. After expiry, a "Reclaim unclaimed" action runs the engine with `claimClaimableBalance` ops (source U, one signature).
- [x] **T3.7** Public `/claim` page (outside the app shell, no session needed).
  - Connect a wallet, list the balances waiting for it, and claim in one tx (`changeTrust` if missing, then `claimClaimableBalance`); the recipient signs and pays.
  - `?batch=` share link; guidance when the account does not exist.
  - The batch page has a "Copy claim link" action.
- [x] **T3.8** Tests.
  - Unit tests for predicates and reserve.
  - Testnet integration: create to recipients without a trustline, claim, reclaim with a short expiry.
  - Save the hashes to `docs/evidence-testnet.md`.

## E4 Receipt

- [x] **T4.1** `GET /api/batches/[batchId]/receipt` returns a PDF.
  - Try `@react-pdf/renderer` first; if it fails under Next 16, use `pdfkit` and record the choice in the commit body.
  - Layout per PRD 3.5, multipage.
- [x] **T4.2** Download button on completed and partial batches. Test that rendering 1,000 rows produces a valid multipage PDF.

## E5 Mainnet

- [x] **T5.1** Build and sign every tx with `batch.network`. Detect the wallet's network and block sending on a mismatch.
- [x] **T5.2** Mainnet confirmation gate (summary plus type-to-confirm), a clear Mainnet badge, and demo and friendbot disabled on `PUBLIC`.
- [x] **T5.3** Per-network service config and fee strategy (fee stats with a cap). Refuse a run when M cannot cover it. The Mainnet RPC comes from env.
- [x] **T5.4** Mainnet runbook at `../developer-docs/mainnet-runbook.md`. It lives outside the repo and is not committed: funding M and the channels, env on the host, the first real distribution step by step.

## E6 Evidence and docs

- [x] **T6.1** `scripts/benchmark.ts`.
  - Create or reuse funded Testnet recipient lists of 300, 500 and 1,000.
  - Run the legacy and channel engines on the same lists, measuring from signature to the last confirmation.
  - Write `docs/benchmark.md` with a table and explorer links.
- [x] **T6.2** `docs/evidence-testnet.md`: setup, payment and claimable balance create/claim/reclaim hashes with explorer links.
- [x] **T6.3** Playwright specs with screenshots saved to `docs/screenshots/sow2/`:
  - channel payment, one screenshot per live stage;
  - claimable balance send;
  - type switch;
  - claim page;
  - receipt download;
  - Mainnet gate (no submission).
- [x] **T6.4** Public docs site (`../docs`, its own repo, branch `feat/sow2-docs`): pages for claimable balances, parallel submission, receipts and Mainnet. Product-level content only.
- [x] **T6.5** Final verification and report.
  - Run lint, tsc, unit, integration and E2E.
  - Write `../developer-docs/sow2-morning-report.md`: what was done, test results, screenshots, blocked items, and what the owner must do (Mainnet funding and run, deploy, demo recording, push and PR).

## Log

- 2026-10-02 T0.1 done: branch, PRD, tracker.
- 2026-10-02 T0.2 done: assets, explorer links, amount formatting and the Asset/Network fields moved out of the batch page into `src/lib/stellar/{assets,explorer}.ts`, `src/lib/format.ts`, `src/components/batches/AssetFields.tsx`. lint, tsc clean; vitest 47/47 (incl. live Testnet integration).
- 2026-10-02 T0.3 done: AES-256-GCM `serviceKeys.ts` (v1 format, tamper and wrong-key tests), `serviceAccounts.ts` (sponsor M from `SPONSOR_SECRET_<NETWORK>`), `npm run bootstrap:testnet` (idempotent; generated the encryption key and Testnet M `GDJDV3NU…UNQT`, funded 10,000 XLM). Decision: sponsor secret lives in host env, channel secrets will be encrypted in DB. Channel provisioning gets added to the script in T1.2. Added `tsx` dev dependency for scripts. lint, tsc clean; vitest 54/54.
- 2026-10-03 T0.4 done: migration `20261002210258_sow2_channel_engine`, additive only (no drops or column changes). Adds Batch.kind and claimExpiresAt, recipient delivery and claim fields, and the ChannelAccount, DistributionRun, ChannelTransaction and ChannelTransactionItem models, with unique indexes on run idempotency key, setup hash, tx hash and (runId, chunkIndex) so duplicates fail at the DB. lint, tsc clean; vitest 54/54.
- 2026-10-03 T1.1 done: `authority.ts` + `errors.ts`. Free slots = 20 minus non-master signers. The wallet key's weight must reach max(low, medium, high) because the setup is sourced from U and changes signers, otherwise `UNSUPPORTED_MULTISIG`. preAuth weight = max(medium, 1). 8 unit tests + 2 Testnet tests (real thresholds, multisig rejected, missing account). vitest 64/64, lint, tsc clean.
- 2026-10-03 T1.2 done: `channelPool.ts` covers provision (rows written as quarantined before the on-chain create, removed if the tx fails), ensurePool, reserve (`FOR UPDATE SKIP LOCKED` in one DB tx, current sequence read after locking), assign, quarantine, release, and a sweep of reservations past their tx time bounds. Starting balance is 2 XLM because channels never pay fees. `vitest.setup.ts` loads `.env` for integration tests. The bootstrap now tops the Testnet pool up to 20 (pool has 20 AVAILABLE). 4 Testnet+DB tests: concurrent reserve disjoint, refusal locks nothing, sweep. vitest 68/68, lint, tsc clean.
- 2026-10-03 T1.3 done: `buildChunks.ts` builds one tx per 100 ops. Tx source is the channel at current+1, every op source is U, explicit maxTime, no memo. Op kinds: payment, createAccount, createClaimableBalance (recipient `beforeAbsoluteTime(expiry)`, sender `not(...)`, muxed addresses reduced to the G account) and claimClaimableBalance. Returns final XDR + hash. Inner fee is BASE_FEE per op because the sponsor fee bump pays. Decision: the legacy engine silently dropped the CSV memo, which loses funds on exchange deposits, so memo rows will be refused in T1.11 preflight (criterion added). 11 unit tests; vitest 79/79, lint, tsc clean.
- 2026-10-03 T1.4 done: `buildSetup.ts` (source U, seq+1, maxTime, Begin sponsoring by M, SetOptions preAuthTx x n with the computed weight, End sponsoring, M-signed). It is a pure builder; persisting the XDR and hash is done by the engine in T1.7. Testnet proof (`buildSetup.integration.test.ts`): the sponsored signer was installed (U num_sponsored=1), a channel-signed chunk with no U signature moved U's funds, and the signer and sponsorship were gone afterwards (num_sponsored=0). 3 unit + 1 Testnet test; vitest 83/83, lint, tsc clean.
- 2026-10-03 T1.5 done: `verifySetup.ts`. The signed hash must equal the persisted hash, which covers network, source, seq, fee, time bounds, memo and ops. The persisted setup's shape is also re-checked (sponsor sandwich, signer hashes and weight, setOptions that only add a signer). The U signature is verified over the hash; window expiry gives `SETUP_EXPIRED`. Decision: the submitted envelope is rebuilt from the persisted XDR with only the verified sponsor and U signatures, so nothing else from the browser passes through. 13 tamper tests; vitest 96/96, lint, tsc clean.
- 2026-10-03 T1.6 done: `feeBump.ts` has feeRatePerOp (RPC fee stats p90 clamped to [BASE_FEE, `FEE_CAP_STROOPS_PER_OP`=10,000]), buildFeeBump (sponsor fee source and signer), lookupTransaction and submitPersisted. submitPersisted looks the hash up first, retries TRY_AGAIN_LATER with backoff, treats DUPLICATE as in flight and polls. Decision: outcomes separate FAILED (on-ledger, signer consumed) from REJECTED (never applied, nothing consumed) and TIMEOUT (unknown, look up again), which is what the reauthorization rule depends on. Fee bump results are unwrapped to the inner tx and op codes. Testnet: sponsor paid the fee (user charged 0), resubmit found the landed tx, applied failure decoded as paymentNoDestination, bad seq gave REJECTED txBadSeq. vitest 103/103, lint, tsc clean.
- 2026-10-03 T1.7 done: `engine.ts` provides prepareRun (idempotent per key: authority, reserve, build and persist chunks and setup, shape check; channels released on failure), authorizeRun (verify, then fee bump, then persist the envelope, compare-and-set to SETUP_SUBMITTED) and advanceRun. advanceRun takes a DB lease (new migration `run_lease`) and steps setup, confirm, then parallel chunks via p-limit(10). Before signing it checks channel sequence drift (no rebuild; EXPIRED + quarantine) and persists the envelope before submit. Chunk outcomes: SUCCESS; on-ledger fail gives REAUTHORIZATION_REQUIRED; rejected gives EXPIRED, or PREPARED again for txInsufficientFee/TRY_AGAIN_LATER (same inner, fresh bump); TIMEOUT stays SUBMITTING. The run finalizes as COMPLETED / PARTIALLY_FAILED / FAILED, and unsigned setups expire. Testnet: 150 createAccount recipients in 2 parallel chunks on distinct channels behind one signature, run COMPLETED, sender paid exactly 150 XLM (zero fees), no leftover signers or sponsorship, re-prepare/re-authorize/re-advance idempotent, channels back to AVAILABLE. vitest 104/104, lint, tsc clean.
- 2026-10-03 T1.8 done. `reconcile.ts` copies terminal chunk outcomes onto items and recipients. Tx atomicity is respected: in a failed chunk the failing row gets its own error and the rest get "another row in the same transaction failed". Claimable balance ids are read from op results (Horizon hex form, `UNCLAIMED`). Reclaim runs mark `RECLAIMED`. The batch status is rolled up. `checkRunSigners` confirms on Horizon that the run's preAuth signers are gone; the engine flags `CLEANUP_REQUIRED` if any remain. The engine reconciles each chunk as it finishes so the UI sees live progress. Helpers are in `testSupport.ts`. Testnet: 102-row run gave PARTIALLY_FAILED with chunk 1 REAUTHORIZATION_REQUIRED (paymentNoDestination) and the right messages per row and no leftover signers; a claimable balance run recorded 3 balance ids that exist on Horizon with recipient and sender as claimants. vitest 106/106, lint, tsc clean.
- 2026-10-03 T1.9 done: `cleanup.ts` adds sweepStaleRuns (advances runs with no live worker; unsigned setups expire and free channels), prepareCleanup (Horizon leftovers become a sender-sourced SetOptions weight-0 removal, idempotent per leftover set, null when clean) and buildRemoval. The verifier gained `kind: "remove"`: removal-only shape, sender signature only. The engine authorizes cleanup runs (each hash must belong to the parent run), completes them after confirmation and clears the parent's CLEANUP_REQUIRED. SUBMITTING chunks past maxTime+30s with no landed hash become EXPIRED. Testnet: channel sequence bumped behind the engine, then chunk EXPIRED CHANNEL_SEQUENCE_CHANGED, inner XDR unchanged, channel quarantined, run FAILED + CLEANUP_REQUIRED, 1 sponsored signer left. One cleanup signature (fee-bumped by M) removed it, num_sponsored back to 0, flag cleared. Abandoned unsigned run swept to EXPIRED with channel freed. 3 new unit + 2 Testnet tests; vitest 111/111, lint, tsc clean.
- 2026-10-03 T1.10 done: added routes `POST /api/batches/[batchId]/runs`, `POST /api/runs/[runId]/authorize`, `GET /api/runs/[runId]`, `POST /api/runs/[runId]/cleanup`, `POST /api/runs/[runId]/reauthorize`. Library: `batchRuns.ts` (batch to ops; prepare marks rows IN_TRANSACTION; no second unfinished run per batch; run view serializer) and `http.ts` (DistributionError to HTTP status; run access via batch access). Decisions: only the wallet that owns the batch and is its source can prepare or reauthorize; idempotency keys are namespaced per batch; the engine advances via `after()` on authorize and on every status poll (lease keeps one worker; maxDuration 120). Reauthorize sends only that run's failed rows, as fresh transactions. Route-level Testnet test with mocked session and `after`: prepare, idempotent re-prepare, 409 while busy, tampered signature 400 SETUP_MISMATCH, authorize, status polling to FAILED/REAUTHORIZATION_REQUIRED, cleanup `{clean:true}`, reauthorize then COMPLETED; non-owner 404, no session 401. vitest 113/113, lint, tsc clean.
- 2026-10-03 T1.11 done: `preflight.ts` runs right before prepare and blocks memo rows, sender XLM short (native amounts + createAccount balances + claimable balance reserve, against spendable = balance minus (2 + subentries + sponsoring - sponsored) x base reserve minus liabilities), sender asset missing / unauthorized / short (the issuer is exempt), and destinations re-checked live for payment and createAccount. It then checks that sponsor M covers signer reserves plus 2x the fees. Problems come back together in `details.problems` (422), and row problems mark those rows CHECK_FAILED with the message. `reserve.ts` adds exact stroop math, the live base reserve, and claimable reserve = 2 claimants x base reserve; Testnet confirms base reserve 0.5, so 5 balances lock 5 XLM. `checkRecipients` now also requires the trustline AUTHORIZED flag. Bug fix found by the tests: the same destination twice made RPC getLedgerEntries fail (duplicate key, "could not query captive core"); keys are now deduplicated and fanned out, which also covers muxed ids on one account. The route test now fails a chunk realistically (account created by someone else after preflight). vitest 123/123, lint, tsc clean.
- 2026-10-03 T1.12 done: `engine.integration.test.ts` runs the 9 required scenarios through `prepareBatchRun`, plus 6b (crash after send: hash found on-chain, not resent). All 10 pass on Testnet. Findings fixed in the engine: (a) flooding Testnet with 10 chunks made stellar-core drop and ban queued txs (135 s), so submission is now windowed to the latest ledger's capacity (`submitWindow`: max(2, max_tx_set_size/100); Testnet 2, Mainnet 10; `SUBMIT_CONCURRENCY` overrides); (b) fee bids are 2 x p99 (floor 10 x base), doubling per fee rejection up to the cap; (c) each chunk retries on its own schedule inside its time bounds; (d) the lease gets a heartbeat during long passes; (e) `submittedAt` keeps the first submission. 1,000 recipients: 56 s on Testnet, one chunk per ledger, which is a network limit (PRD section 7). The 2x speedup needs Mainnet capacity. Testnet pool raised to 40 channels via `CHANNEL_POOL_SIZE`. vitest 132/132, lint, tsc clean.
- 2026-10-03 T1.13 done: the batch page's "Sign & send" and "Send failed rows again" use the channel engine through the new `useDistributionRun` hook (prepare, one wallet signature, authorize, then 1 s polling that also drives the engine; resumes a run already waiting for a signature or in flight after a reload). `NEXT_PUBLIC_SEND_ENGINE=legacy` restores the Phase 1 path. Batch GET returns runs and per-row channel tx hashes; recipient and network edits are locked once a run is signed (unsigned runs do not lock). The run view returns `setupXdr` only while it awaits the sender's signature. Verified in the real UI: Playwright + Freighter `anon-batch-flow.spec.ts` passed on the new engine (run COMPLETED, 9.1 s from signature to confirmation, no server errors). vitest 132/132, lint, tsc clean.
- 2026-10-03 T2.1 done: `DistributionProgress.tsx` is mounted on the batch page during and after a run. It shows four animated stages (Final checks, Wallet approval, Authorization confirming, Transactions processing) with check/fail/pulse dots, an overall recipients bar, one lane per transaction (Queued / Sending shimmer / Confirmed + explorer link / Failed), an elapsed timer from signature to last confirmation, the setup tx link and Dismiss. CSS keyframes (`send-*`) are off under `prefers-reduced-motion`; no new dependency. Fix found while verifying: the counts lagged behind the lanes for a moment ("50 of 150" with both lanes confirmed), so they are now derived from transaction outcomes (a tx is atomic). Tests: 3 jsdom component tests, plus a Playwright + Freighter E2E `live-send-panel.spec.ts` that sends 150 recipients (2 lanes, about 9 s), captures mid-flight frames alongside the wallet flow and passed 3 of 3 runs. Screenshots in `docs/screenshots/sow2/live-panel-{start,processing,complete}.png` and `batch-page-after-send.png`. vitest 135/135, lint, tsc clean.
- 2026-10-03 T2.2 done: two-step send. "Sign & send" now runs checks and stops at `SendReviewCard` (recipients, total, tx count, network with Mainnet marked as real funds, delivery type, claimable reserve with per-claimant explanation, "fees and temporary signer reserve covered by Sendall", approval-window countdown) before "Approve in wallet". Error states: wallet rejected returns to review with a banner (approve again or cancel); preflight problems show a "Nothing was sent" card with table row numbers; panel footer offers "Send failed rows again" (reauthorize) and "Remove leftover signers" (cleanup); a page banner covers any run still flagged CLEANUP_REQUIRED; setup failure shows the run's message. New `cancelRun` + `POST /api/runs/[id]/cancel`: an unsigned run ends EXPIRED/CANCELLED, channels free immediately, rows back to READY, and the setup can no longer be authorized. Fixes found by E2E: problem rows were numbered by CSV line (off by one), now by table position; memo copy no longer suggests sending the row alone in Sendall. Tests: 6 jsdom (review card, problems), 1 Testnet+DB (cancel), E2E updated for the review step plus `send-error-states.spec.ts` (preflight problems, cancel), 5 E2E specs passing. Screenshots `review-before-signing.png`, `preflight-problems.png`. vitest 142/142, lint, tsc clean.
- 2026-10-03 T3.1 done: the sidebar has "Bulk Payment" (`/batches/new`) and "Bulk Claimable Balance" (`/batches/new/claimable`), both through the shared `CreateBatch` component. Decision: a path instead of `?kind=`, so the shell highlights the item without reading search params during render. `POST /api/batches` takes `kind`; claimable batches default to a 30-day `claimExpiresAt`. `GET /api/batches` adds `claims {created, claimed, reclaimed}` for claimable batches. The Batches list shows a Payment/Claimable badge and "claimed x / y". The batch page heading shows the type. Copy fix: the editor example and help no longer advertise a memo column (memo rows are refused). Tests: 2 API tests (kind, default window, bad kind 400, claim counts); E2E `distribution-types.spec.ts` (sidebar to claimable batch, payment batch, list badges) plus address-lists spec updated for the new heading. Screenshots `sidebar-claimable-new.png`, `batches-list-types.png`. vitest 144/144, lint, tsc clean.
- 2026-10-03 T3.2 done: `KindSwitch` on the batch page (Payment / Claimable balance), locked once a run is signed. `PATCH /api/batches/[id]` takes `kind`, resets rows to PENDING (auto re-check), sets or clears `claimExpiresAt` (30-day default), and cancels any unsigned run so a setup built for the old type can never be approved. Checks route uses `checkOutcome`: payments are unchanged; claimable balances pass with notes (no account yet / no trustline yet / trustline not authorized yet; any XLM amount). New `POST /api/batches/[id]/convert-failed` and a "Send N as claimable balance" button on Confirm and Send. It takes rows failed or check-failed for no account or no trustline (including paymentNoTrust / paymentNoDestination results; never unauthorized trustlines, never XLM) into a new claimable batch with the same owner, source, asset and network, and marks the originals "Moved to a claimable balance batch." so they can't be sent twice or moved twice. Shared rules in client-safe `convertRules.ts`. Tests: 4 unit, 2 route-level Testnet+DB (re-check per type, conversion, unsigned-run cancel, 409 once signed), E2E `type-switch.spec.ts`. Screenshots `convert-failed-rows.png`, `converted-claimable-batch.png`, `type-switch.png`. vitest 150/150, lint, tsc clean.
- 2026-10-03 T3.3 done. Claimable operations, predicates and balance-id capture already came from T1.3/T1.8. This task adds the claim window: new column `Batch.claimWindowDays` (migration `claim_window_days`) and `ClaimWindowPicker` (7/30/90, default 30) on claimable batches. `PATCH {claimWindowDays}` changes only the window, without resetting checks, and gives 400 on payment batches. Decision: the window counts from sending, so `prepareBatchRun` fixes `claimExpiresAt = now + window` at prepare time, writes it into every predicate and onto the batch, and returns it to the review card ("Claim until"). Tests: claimWindow unit; Testnet: window 7 days, all predicates equal the deadline, run COMPLETED, Horizon `abs_before` on every recipient claimant matches; payment batch refused. E2E `claimable-send.spec.ts` (pick 7 days, notes on Confirm, review shows claimable delivery, claim-until and 3 XLM reserve, approve, 3 of 3 delivered). Screenshots `claimable-confirm.png`, `claimable-review.png`, `claimable-sent.png`. vitest 153/153, lint, tsc clean.
- 2026-10-03 T3.4 done. The calculator (`reserve.ts`: live base reserve x 2 claimants x balances), the review row and the pre-sign block already existed from T1.11 and T2.2. This task adds the Testnet spike and an end-to-end block test (`reserve.integration.test.ts`). Measured: base reserve 0.5 XLM; one 2-claimant balance raised `num_sponsoring` by 2 and cut spendable XLM by amount + 1 XLM, so 1 XLM per balance (recorded in PRD section 7). A sender with 20 XLM is blocked from 30 balances of 0.1 XLM ("needs 33 XLM free, including 30 XLM locked by claimable balances") and allowed 10 (11 XLM needed). vitest 155/155, lint, tsc clean.
- 2026-10-03 T3.5 done. `claims.ts` adds `balanceOutcome`: a balance still on Horizon is UNCLAIMED; once gone, its `claim_claimable_balance` operation shows who took it (sender means RECLAIMED, otherwise CLAIMED). With it come `syncClaimStatuses` (only rows still UNCLAIMED, 5 at a time, records claim tx hash and time) and `claimSummary`. Route `POST /api/batches/[id]/claims/sync` (400 for payment batches). UI: `ClaimStatusCard` on the Send stage ("Claimed x of y", progress, waiting / claimed / reclaimed, time left or "window closed", Refresh). The page syncs once per visit when the batch has balances. Each row's Note shows an Unclaimed/Claimed/Reclaimed pill, linked to the claim tx. Tests: Testnet with a real recipient claim, then a 45 s window closing and the sender reclaiming (CLAIMED, UNCLAIMED, RECLAIMED all recorded with tx hashes); E2E claim card after a UI claimable send. Screenshot `claim-status.png` (toasts hidden for evidence shots). vitest 157/157, lint, tsc clean.
- 2026-10-03 T3.6 done: `reclaim.ts` `prepareReclaim` syncs claims first, then keeps only balances whose on-ledger sender predicate (`not abs_before`) has opened. It requires the sender to still hold a non-native asset and builds a RECLAIM run of `claimClaimableBalance` ops (source U) through the channel engine, so one signature, sponsor fees, reconcile marks RECLAIMED. Route `POST /api/batches/[id]/reclaim`; hook `reclaim()`; review card "Reclaim unclaimed balances" variant; claim card shows "Reclaim N unclaimed" once the window has closed. Fix: `cancelRun` no longer resets rows for non-send runs (a cancelled reclaim left rows READY). Tests: Testnet with a 50 s window (too early refused, cancel leaves rows untouched, then 3 reclaimed in one signature, Horizon 404 for each balance, sender spendable +15 XLM exactly = 12 amount + 3 reserve with no fee, second reclaim says nothing left). E2E `reclaim.spec.ts` using new `e2e/scripts/seed-expiring-claimables.ts` (40 s window from the E2E wallet; key derived in a child process from `wallet-secret.mjs`, never stored) with connect, reclaim, review, Freighter approve, "Reclaimed 3". Screenshots `reclaim-available.png`, `reclaim-review.png`, `reclaim-done.png`. vitest 158/158, lint, tsc clean.
- 2026-10-03 T3.7 done. Public `/claim` (outside the app shell; server page resolves `?batch=` to its network, else `?network=`) with `ClaimClient`: connect wallet (no session), list what this address can claim now, select, one transaction (`changeTrust` for missing assets + `claimClaimableBalance`, max 100 ops), recipient signs and pays the fee. Guidance for an inactive account (needs 1 XLM + 0.5 per new asset; friendbot link on Testnet). `claimPage.ts`: `predicateOpen` evaluator (unconditional/abs/rel/not/and/or), `listClaimable` (Horizon by claimant, open predicates only, needsTrustline, this batch's balances first), `buildClaimTx`, `submitClaimTx`. Decision: submit relays only `changeTrust`/`claimClaimableBalance` ops from the signer's own account, so the public endpoint cannot be used as a generic relay; a successful claim marks the matching rows CLAIMED. API `GET /api/claim`, `POST /api/claim/build`, `POST /api/claim/submit`. The batch page claim card has "Copy claim link" (`/claim?batch=`). Tests: predicate unit; Testnet (issuer-sent custom asset, trustline added and claimed in one tx, row CLAIMED, balance 25 held; payment tx refused; inactive account handled); E2E `claim-page.spec.ts` with Freighter as recipient via new `e2e/scripts/seed-claim-for-wallet.ts`. Screenshots `claim-page-connect.png`, `claim-page-list.png`, `claim-page-done.png`. vitest 162/162, lint, tsc clean.
- 2026-10-03 T3.8 done. Unit coverage for predicates (`buildChunks.test`, `claimPage.test`) and reserve (`reserve.test`) was already in place. New `scenarios/claimableLifecycle.ts`: issuer, sender holding the asset, 3 recipients without the trustline (A claims via the public flow with trustline in the same tx, B never claims, C has no account), then a short window and the sender reclaims B and C with one signature. Its integration test checks CLAIMED/RECLAIMED/RECLAIMED, A holds 50, sender 950, sender `num_sponsoring` 0. `scripts/evidence-claimable.ts` runs it and writes `docs/evidence-testnet.md` (setup, create, claim, reclaim-setup, reclaim hashes, per-recipient balance ids and outcomes). Hashes checked on Horizon: setup fee paid by sponsor `GDJDV3…`, claim from recipient A, reclaim chunk fee-bumped by the sponsor from a channel. vitest 163/163, lint, tsc clean.
- 2026-10-03 T4.1 done: `@react-pdf/renderer` 4.9 (already in Next's serverExternalPackages, no config needed). `receiptData.ts` covers channel and legacy rows: method, status (claim status for claimable balances), tx hash, totals and authorization txs. `ReceiptDocument.tsx` is an invoice layout with a repeated table header, page numbers and explorer links. Route `GET /api/batches/[id]/receipt` returns 409 before the batch is sent, 404 without access, and a PDF attachment otherwise; checked on the live Next 16 dev server. Fix: react-pdf hyphenated Stellar addresses ("…WKM-") and printed wrong values, so hyphenation is disabled and the columns resized; all 150 addresses now extract intact. Testnet test: 150-row run gives a 4-page PDF. Preview `docs/screenshots/sow2/receipt-page1.png`. vitest 164/164, lint, tsc clean.
- 2026-10-03 T4.2 done: "Download receipt (PDF)" link on the Send stage for COMPLETED and PARTIAL_FAILURE batches. Tests: 1,000-row render gives a valid PDF (`%PDF-` / `%%EOF`, more than 20 pages) and 5 rows fit on one page; the E2E claimable send downloads the receipt from the UI (`sendall-receipt-SND-XXXXXXXX.pdf`), saved as `docs/screenshots/sow2/receipt-claimable-sample.pdf` with page preview `receipt-claimable-page1.png` (claim deadline, "Set aside, unclaimed", tx links). vitest 166/166, lint, tsc clean.
- 2026-10-03 T5.1 done: `signTransaction(xdr, network)` signs for the batch's network: the channel-engine hook, the legacy path and the claim page all pass it. New `walletNetworkPassphrase()` from the kit's `getNetwork`. `networkGuard.ts`: `networkMismatch(expected, walletPassphrase)` blocks signing when the wallet is on another network, with a clear message (review step stays open; claim page shows the error). Decision: a wallet that cannot report its network is not blocked client-side, because the server already rejects a signature for the wrong network (the network is part of the hash, so it fails as SETUP_MISMATCH). Tests: 3 unit; E2E regression `anon-batch-flow` and `claim-page` pass with Freighter on Testnet. vitest 169/169, lint, tsc clean.
- 2026-10-03 T5.2 done. Mainnet gate: on PUBLIC the review card shows a red "real funds, cannot be undone" box and "Approve in wallet" stays disabled until MAINNET is typed. Decision: the server enforces it too, so `POST /api/runs/[id]/authorize` returns 428 MAINNET_CONFIRMATION_REQUIRED for a PUBLIC run without `confirmMainnet: true`, and a client bug cannot skip the gate. Badges: the batch heading shows "Mainnet · real funds" and the sidebar network label turns red "Mainnet". Demo and friendbot: the demo page always creates Testnet batches, and friendbot only appears on the claim page when the network is Testnet (no other UI uses it). Tests: review card (Mainnet needs MAINNET, Testnet does not) and route gate (428 without confirmation, run untouched). A Mainnet gate screenshot needs a funded Mainnet sponsor, so it is left for T6.3/owner. vitest 171/171, lint, tsc clean.
- 2026-10-03 T5.3 done. The sponsor was already per network (`SPONSOR_SECRET_<NETWORK>`), Mainnet RPC came from env, and fees were bid from fee stats. New: `feeCapPerOp(network)`, where `FEE_CAP_STROOPS_PER_OP_<NETWORK>` beats the shared cap, which beats the 10,000 default. Fix found by the test: a blank env value (as copied from .env.example) parsed as a 0 cap; blanks now count as unset. New `serviceStatus(network)` checks RPC, sponsor configured / active / spendable / low, channels total and available, and gives reasons. Public read-only `GET /api/service/status` returns readiness facts only, no keys. The batch page shows "Sending on Mainnet is not available yet" and disables Sign & send while not ready. The per-run M guard was already in preflight (SPONSOR_UNDERFUNDED). Operator script `scripts/provision-channels.ts <network> <size>` needs `--yes` for Mainnet (dry run verified, nothing spent). Tests: fee cap unit, Testnet ready / Mainnet not ready with reasons, E2E `mainnet-guard.spec.ts` (screenshot `mainnet-not-available.png`). vitest 174/174, lint, tsc clean.
- 2026-10-03 T5.4 done: Mainnet runbook written to `../developer-docs/mainnet-runbook.md` (outside the repo, not committed). It covers prerequisites (merge, migrations, DB backup, Mainnet RPC choice), the Vercel env table, creating and funding a dedicated sponsor (about 100 XLM: 40 for 20 channels, signer reserves returned per run, fees), `provision-channels.ts PUBLIC 20 --yes`, the first real distribution step by step (Freighter on Mainnet, MAINNET confirmation, receipt, evidence to keep), the Mainnet benchmark plan, rollback switches (`NEXT_PUBLIC_SEND_ENGINE=legacy`, removing the sponsor secret) and secret handling.
- 2026-10-03 T6.1 done: `scripts/benchmark.ts` creates or reuses 1,000 existing Testnet recipients (cached in gitignored test-results/). It runs the Phase 1 sequential sender exactly as the old page did (master preAuth tx, then each chunk submitted and polled in turn) and the channel engine on the same lists, timing from signature to last confirmation, and writes `docs/benchmark.md` with explorer links for every tx. Results: 300: 30.3 s vs 19.3 s (1.57x); 500: 46.6 s vs 27.9 s (1.67x); 1,000: 90.5 s vs 88.6 s (1.02x). Testnet ledger capacity (one 100-op chunk per ledger) and a slow Testnet at run time (~8 s ledgers) capped the 1,000 case. The report says so plainly and points to the Mainnet measurement in the runbook. No Mainnet funds used.
- 2026-10-03 T6.2 done: `docs/evidence-testnet.md` now has two sections. Payments: new `scripts/evidence-payment.ts` runs 150 new-account payments through the channel engine and records the setup hash, both chunk hashes, the timing (9.0 s), the sender spending exactly 300 XLM and zero leftover signers or sponsored entries. Claimable balances: create, claim and reclaim from T3.8. A link to benchmark.md is included. Hashes checked on Horizon: successful, fee account = sponsor. Both scripts rewrite their own section, so the evidence can be refreshed after a Testnet reset.
- 2026-10-03 T6.3 done: the full Playwright suite (11 specs, 12 tests, Freighter on Testnet) passed in one run in 6.8 min with no retries. It covers: anon batch, address lists, live panel (150 recipients), error states, distribution types, type switch and conversion, claimable send with receipt download, reclaim, public claim page, Mainnet not-available notice and Mainnet gate. The Mainnet gate is captured on a new development-only `/preview/mainnet-gate` page with sample data (404 in production) because a real Mainnet run needs a funded sponsor. `docs/screenshots/sow2/README.md` indexes all 27 files with what each shows and which spec produces it. vitest 174/174, lint, tsc clean.
- 2026-10-03 T6.4 done: in the `docs` repo on branch `feat/sow2-docs` (local commit, not pushed) there are new public pages `features/claimable-balances`, `features/one-signature-sending`, `features/receipts` and `features/mainnet`, with 11 screenshots and sidebar entries. Updated the stale `features/batches` (memo rows refused, review step, "Send failed rows again", receipt link, freeze on signed runs) and `architecture/transaction-building` (channel engine as default, sequential as fallback). Product-level content only, no internal setup or env names. `npm run build` succeeds with no warnings and no em dashes in the new copy.
- 2026-10-03 T6.5 done: final verification. lint and tsc clean; vitest 174/174 (unit plus live Testnet and DB integration); `next build` succeeds and in a production start `/preview/mainnet-gate` returns 404; the full Playwright suite passes 12/12 with Freighter on Testnet (7.0 min, no retries), and the screenshots were refreshed by that run. Morning report written to `../developer-docs/sow2-morning-report.md` (outside the repo). All 42 tasks done, none BLOCKED. Left for the owner: review, merge and push; production deploy and migrations; Mainnet sponsor funding, real distribution and benchmark; demo recording.
