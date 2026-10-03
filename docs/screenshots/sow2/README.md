# Phase 2 screenshots

Captured by the Playwright suite (`npm run test:e2e`, Freighter on Testnet) unless noted. Each file is overwritten when its spec runs.

| File | What it shows | Spec |
|---|---|---|
| `review-before-signing.png` | Review card before the single wallet signature | live-send-panel |
| `live-panel-start.png` | Live send panel: final checks | live-send-panel |
| `live-panel-processing.png` | Live send panel: authorization landing, two transaction lanes | live-send-panel |
| `live-panel-complete.png` | Live send panel: 150 of 150 delivered | live-send-panel |
| `batch-page-after-send.png` | Batch page after a 150-recipient send | live-send-panel |
| `preflight-problems.png` | "Nothing was sent": preflight problems with row numbers | send-error-states |
| `sidebar-claimable-new.png` | Sidebar: Bulk Payment / Bulk Claimable Balance, new claimable batch | distribution-types |
| `batches-list-types.png` | Batches list with type badges | distribution-types |
| `convert-failed-rows.png` | Payment batch: rows without trustline, "Send 2 as claimable balance" | type-switch |
| `converted-claimable-batch.png` | The resulting claimable balance batch with notes | type-switch |
| `type-switch.png` | Payment / Claimable balance switch | type-switch |
| `claimable-confirm.png` | Claimable batch on Confirm, 7-day window | claimable-send |
| `claimable-review.png` | Review: claim-until date and 3 XLM reserve | claimable-send |
| `claimable-sent.png` | Claimable distribution complete | claimable-send |
| `claim-status.png` | Claim status card: claimed 0 of 3 | claimable-send |
| `receipt-claimable-sample.pdf`, `receipt-claimable-page1.png` | Receipt downloaded from the UI | claimable-send |
| `receipt-page1.png` | Receipt of a 150-recipient run (4 pages) | receipt.integration.test |
| `reclaim-available.png` | Window closed: "Reclaim 3 unclaimed" | reclaim |
| `reclaim-review.png` | Review for the reclaim signature | reclaim |
| `reclaim-done.png` | Reclaimed 3 | reclaim |
| `claim-page-connect.png` | Public claim page before connecting | claim-page |
| `claim-page-list.png` | Balances waiting for the recipient | claim-page |
| `claim-page-done.png` | Claimed, with the transaction link | claim-page |
| `mainnet-not-available.png` | Mainnet batch while Mainnet sending is not set up | mainnet-guard |
| `mainnet-gate-locked.png` | Mainnet confirmation: approve locked | mainnet-gate (sample data) |
| `mainnet-gate-confirmed.png` | Mainnet confirmation: MAINNET typed | mainnet-gate (sample data) |
