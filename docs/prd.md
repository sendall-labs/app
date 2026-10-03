# Sendall: Product Requirements (Phase 2)

Status: in progress on branch `feat/sow2`
Last updated: 2026-10-02

## 1. Product summary

Sendall is a non-custodial bulk distribution app on Stellar. A sender uploads a list of recipients, Sendall checks every account before anything is signed, splits the list into Stellar transactions of at most 100 operations, and sends the whole distribution behind a single wallet approval.

### What exists today (Phase 1)

- CSV upload and inline editing of recipients (`destination,amount,memo`), up to 5,000 rows.
- Address, amount and duplicate validation.
- Pre-flight account checks over Stellar RPC: account exists, trustline present, trustline limit OK. Native XLM to a missing account becomes `createAccount`.
- Chunking into 100-operation transactions. Above 100 recipients a "master" transaction installs one `preAuthTx` signer per chunk on the sender, so the wallet signs once and the chunks are submitted unsigned, one after another.
- Per-recipient status, retry of failed recipients, address lists, check balance, home dashboard, guided demo on Testnet.
- Wallet sign-in (SEP-53 style message signing), anonymous drafts claimed at send time.
- Testnet only in practice.

### What Phase 2 adds

| # | Capability | Why |
|---|---|---|
| 1 | Bulk claimable balances, a recipient claim page, sender reclaim, claim status | Recipients without a trustline cannot receive a non-XLM asset. A claimable balance sets their funds aside on-chain; they claim after adding a trustline. |
| 2 | Parallel submission through channel accounts, with a benchmark | Every chunk comes from the sender's account today, so chunks wait for each other, one ledger each. Separate source accounts let chunks land in the same ledger. |
| 3 | PDF receipt per distribution | Teams reconcile grant rounds and file expenses after the money moves. |
| 4 | Mainnet | Real distributions, verifiable on a public explorer. |
| 5 | Live send flow | After the wallet approves, the sender sees each stage of the distribution as it happens. |

## 2. Users

One or two people inside a Stellar project or program who pay a list of recipients. They use a wallet, not scripts. Lists arrive as spreadsheets, from about 50 recipients to a few thousand.

- Teams distributing a non-XLM asset (project token, USDC): need claimable balances.
- Teams running XLM programs (rewards, prizes, grants): need speed and receipts.

## 3. Functional requirements

### 3.1 Distribution types and navigation

- FR-1.1 The sidebar has two entries: **Bulk Payment** and **Bulk Claimable Balance**. Both open the same batch editor with the type preset.
- FR-1.2 A batch has a type: `PAYMENT` or `CLAIMABLE_BALANCE`. The sender can switch the type of a batch at any point before a send run starts. Switching re-runs the type-specific checks.
- FR-1.3 There is no automatic mixing inside one distribution. The sender chooses.
- FR-1.4 After a payment run, rows that failed because the recipient has no trustline (or no account, for non-native assets) can be sent as a new claimable balance batch in one click.
- FR-1.5 The batch list shows the type of each batch and, for claimable balance batches, "claimed x / y".

### 3.2 Channel engine (parallel submission, one signature)

Accounts:

- **U**: the sender. Owns the funds. Source of every payment / claimable balance operation. Signs exactly one transaction (the setup) in the normal flow.
- **M**: Sendall's sponsor and fee account. Sponsors the reserve of the temporary `preAuthTx` signers and pays all fees through fee-bump transactions.
- **C1..Cn**: Sendall's channel accounts. Used only as transaction sources, for independent sequence numbers. They never have any authority over U.

Flow:

1. **Prepare.** Load U from Horizon. Count free signer slots (20 minus existing additional signers) and read thresholds. Reject before any signing when:
   - there are not enough free slots for one signer per chunk (`INSUFFICIENT_SIGNER_SLOTS`);
   - the wallet key's weight cannot meet U's high threshold, which `SetOptions` requires (`UNSUPPORTED_MULTISIG`).
   The `preAuthTx` signer weight is `max(mediumThreshold, 1)` so it can authorize payments for U. Run pre-flight checks. Reserve one channel per chunk with a database lock. Read each channel's sequence number, build each chunk transaction (source = channel, every operation source = U, bounded time window) and persist the exact XDR and hash.
2. **Setup transaction.** Source U. Operations: `BeginSponsoringFutureReserves` (source M, sponsored U), one `SetOptions` adding `preAuthTx` per chunk hash, `EndSponsoringFutureReserves` (source U). M signs its part. The wallet sees one approval.
3. **Authorize.** The signed setup XDR returned by the browser must be identical to the persisted one except for signatures. The checks are: hash, network, sequence, time bounds, operations, sponsor, signer hashes and weights, and a valid U signature. M wraps it in a fee bump, submits, and waits for confirmation.
4. **Execute.** Only after the setup is confirmed. For each chunk:
   - confirm the channel's sequence has not moved;
   - sign with the channel key, wrap in an M fee bump, and submit;
   - submit all chunks concurrently, with bounded concurrency.
   Hashes are persisted before submission. On restart, the engine looks up persisted hashes before doing anything else.
5. **Reconcile.** A Stellar transaction is atomic: a failed chunk fails every row in it. A chunk that reached the ledger and failed has consumed its `preAuthTx` signer, so it is marked `REAUTHORIZATION_REQUIRED` and is never rebuilt silently. The sender can start a new authorization for the failed rows. After the run, Sendall verifies on Horizon that none of the run's signers remain on U and that the sponsorship was released.
6. **Stale runs.** A chunk whose time window has passed without being applied is `EXPIRED`. Its signer may still sit on U. Sendall detects this and offers a cleanup transaction that removes the leftover signers (one extra user signature, only in this exceptional case).

Run states: `CREATED`, `PAYMENTS_PREPARED`, `AWAITING_USER_SIGNATURE`, `SETUP_SUBMITTED`, `SETUP_CONFIRMED`, `PAYMENTS_SUBMITTING`, `COMPLETED`, `PARTIALLY_FAILED`, `FAILED`, `EXPIRED`.

Every stage is idempotent. Each run has an idempotency key. Nothing may create a second setup transaction, add duplicate signers, submit a different XDR for an existing authorization, consume a channel sequence twice, or pay a recipient twice.

The Phase 1 sequential engine stays available behind `SEND_ENGINE=legacy` and is the baseline for the benchmark.

### 3.3 Claimable balances

- FR-3.1 Each recipient gets one `CreateClaimableBalance` operation (source U) with two claimants:
  - the recipient, with predicate `beforeAbsoluteTime(expiry)`;
  - the sender, with predicate `not(beforeAbsoluteTime(expiry))`, so the sender can reclaim after expiry.
- FR-3.2 Expiry is chosen by the sender: 7, 30 (default) or 90 days.
- FR-3.3 Claimable balances go through the same channel engine and single signature as payments.
- FR-3.4 Reserve guard. Each claimable balance locks one base reserve per claimant on the sender, so about 1 XLM per recipient with two claimants at the current 0.5 XLM base reserve. The figure is computed from the live network base reserve and shown before signing. A distribution the sender cannot cover is blocked.
- FR-3.5 Recipients do not need a trustline or, for checks, an existing account. Sendall warns when a recipient account does not exist, because they will need XLM to claim.
- FR-3.6 Balance IDs are read from the transaction result and stored per recipient.
- FR-3.7 Claim status per recipient: `UNCLAIMED`, `CLAIMED`, `RECLAIMED`, synced from Horizon. The batch page shows the totals, the per-row status and the time left until expiry.
- FR-3.8 After expiry the sender can reclaim every unclaimed balance with one signature (through the engine).
- FR-3.9 Public claim page `/claim`. The recipient connects a wallet and sees the balances waiting for them. They claim in one transaction, which adds the trustline first when it is missing. The recipient pays their own fee.

### 3.4 Live send flow

- FR-4.1 Before approval, a review card shows:
  - recipients, total amount, number of Stellar transactions and network;
  - that fees and signer reserves are covered by Sendall;
  - for claimable balances, the reserve that will be locked.
- FR-4.2 After approval, an animated panel shows the stages: Wallet approval, Authorization confirming, Transactions processing, then Completed, Partial or Failed.
- FR-4.3 While transactions are processing, the panel has one lane per transaction with its status, operation count and explorer link. An elapsed timer runs until completion.
- FR-4.4 Errors are shown in place:
  - wallet rejected;
  - setup failed;
  - reauthorization required, with an action;
  - cleanup required, with an action.

### 3.5 Receipt

- FR-5.1 Completed and partially completed batches can download a PDF receipt laid out like an invoice.
- FR-5.2 The header carries sender, date, network, asset, total, recipient count and transaction count.
- FR-5.3 Each recipient gets one line: address, amount, delivery method (payment, account creation, claimable balance), status and transaction hash. Claimable balances also show their claim status.
- FR-5.4 1,000 recipients render across multiple pages.

### 3.6 Mainnet

- FR-6.1 Every transaction is built and signed for the batch's network. A mismatch between the wallet's network and the batch's network blocks sending.
- FR-6.2 Mainnet sends require an explicit confirmation step showing the real amounts. The sender types to confirm.
- FR-6.3 Mainnet is clearly marked in the UI. Demo and friendbot features are off on Mainnet.
- FR-6.4 Sponsor and channel accounts are configured per network. Fees on Mainnet follow network fee stats with a cap. Sending is refused when the sponsor account cannot cover the run.

## 4. Non-functional requirements

- NFR-1 Non-custodial. The user's secret key is never requested, stored or transmitted. No permanent signer is ever added to U. The only authority Sendall's keys gain is to submit the exact transactions the user approved, through one-time `preAuthTx` signers.
- NFR-2 The sponsor and channel secrets are stored encrypted (AES-256-GCM) with a key from the environment, and are only used server-side.
- NFR-3 Payment hashes are never taken from the browser. The server builds and persists them.
- NFR-4 Crash safety. After a restart, the engine resumes from persisted XDRs and hashes.
- NFR-5 No user-facing copy uses em dashes.

## 5. Out of scope

- Automatic switching between payment and claimable balance inside one distribution.
- Soroban contract tokens and C-address recipients.
- Confidential transfers, recurring or scheduled payments, public API or SDK, multisig approval flows.
- Creating trustlines on behalf of recipients.

## 6. Success measures

- A claimable balance distribution on Testnet to recipients without a trustline, with create, claim and reclaim transaction hashes.
- Benchmark: Phase 1 sequential engine compared with the channel engine at 300, 500 and 1,000 recipients on the same lists, measured from signature to final confirmation. The 1,000-recipient sequential run takes roughly 50 seconds; the target is at least 2x faster.
- A PDF receipt from a real distribution.
- A real distribution on Mainnet with explorer links.

## 7. Open technical notes

- Claimable balance reserve, confirmed on Testnet on 2026-10-03 (`reserve.integration.test.ts`). The base reserve is 0.5 XLM. One balance with two claimants (recipient + sender for reclaim) raised the sender's `num_sponsoring` by 2 and its spendable XLM fell by the amount plus 2 base reserves. So each claimable balance locks 1 XLM until claimed or reclaimed: 300 recipients lock 300 XLM, not the 150 XLM a one-claimant estimate gives. The review screen and preflight use the live figure.
- Ledger capacity limits parallelism. Testnet ledgers take at most 200 operations (Mainnet 1,000). On Testnet only one 100-operation chunk lands per ledger in practice, because background traffic fills the rest. Measured 2026-10-03: 1,000 recipients took 56 s from signature to the last confirmation, which is about the same as one chunk per ledger. Sending every chunk at once is worse: stellar-core drops transactions that wait in its queue for a few ledgers and bans them briefly, and an unthrottled run took 135 s. The engine therefore keeps in flight only as many chunks as the network's latest ledger can hold (`submitWindow`). Fee bids escalate after a fee rejection, around the same authorized inner transaction. The 2x target can only show where ledgers have room for several chunks, i.e. Mainnet. A Testnet benchmark shows the mechanism, not the speedup.
