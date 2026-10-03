# Testnet evidence

Transaction hashes from runs on Stellar Testnet. Testnet is reset from time to time, so the screenshots in `docs/screenshots/sow2/` are kept as well.

<!-- PAYMENT:START -->
## Payments through the channel engine

Run 2026-10-03 02:33 UTC. [`GDHYAW…EWEK`](https://stellar.expert/explorer/testnet/account/GDHYAWQMNA4ZGN6W6S3T75M27KQFGEVGNLZN5H5BODF66FY6RGCAEWEK) sends 2 XLM to each of 150 new accounts (account creation) with one wallet signature. Signature to last confirmation: 9.0 s.

| Step | Transaction |
|---|---|
| Authorization: sponsored setup installing 2 one-time preAuthTx signers, fee paid by Sendall | [`85421ad19c79…`](https://stellar.expert/explorer/testnet/tx/85421ad19c79827c9e227ebd811b5fe84c415ab36c1187e7e7e95798db927e2c) (ledger 4994245) |
| Chunk 1: 100 accounts created from a channel account, fee-bumped by Sendall | [`d92e1ec19725…`](https://stellar.expert/explorer/testnet/tx/d92e1ec19725d59ce4b9e162b4ac588e1cd92f191361444f92f869cf26ccd28b) |
| Chunk 2: 50 accounts created from a second channel account, fee-bumped by Sendall | [`6d54207fb5f6…`](https://stellar.expert/explorer/testnet/tx/6d54207fb5f6ad1275b9df184754712297977fddb0d53c4d7ba38c06716f3d55) |

Checks after the run:
- The sender spent exactly 300 XLM for 150 x 2 XLM: no fees, no reserve.
- PreAuthTx signers left on the sender: 0. Sponsored entries left: 0.
Timings at 300 / 500 / 1,000 recipients, sequential vs channels: [benchmark.md](./benchmark.md).
<!-- PAYMENT:END -->

<!-- CLAIMABLE:START -->
## Claimable balances: create, claim, reclaim

Run 2026-10-03 00:26 UTC. Asset `SNDL` issued by [`GDCO6D…NHBO`](https://stellar.expert/explorer/testnet/account/GDCO6DZFND6QQGUDPTEOHYFYD5O5ZJWQZ4F3EE5RRQGUYU4RZJPQNHBO), sent by [`GAL6HS…AOG5`](https://stellar.expert/explorer/testnet/account/GAL6HS7JXQ6RGG3HDCAAE55TADZN2XI4UT4AXFEK3LV5RPSXD3RCAOG5) to three recipients who did not hold it, with a 60-second claim window (the app offers 7/30/90 days; the window is shortened here only to show the reclaim).

| Step | Transaction |
|---|---|
| Authorization (the sender's single signature, fee-bumped by Sendall) | [`5057e9771a57…`](https://stellar.expert/explorer/testnet/tx/5057e9771a572821a20c2c93ba4808c3ee2a33c88a5387be04039eada359002d) |
| Claimable balances created (channel transaction) | [`e2126d8ee7f0…`](https://stellar.expert/explorer/testnet/tx/e2126d8ee7f0294513153e30609f2418bd5a3074bbf5d301309e63b955a98455) |
| Recipient A claims, trustline added in the same transaction | [`b3fce435d407…`](https://stellar.expert/explorer/testnet/tx/b3fce435d407bc6c7dc28f0504db0df4ae1d4a0935288bb666a1e35d39c959d8) |
| Reclaim authorization (one signature) | [`cfea904f5575…`](https://stellar.expert/explorer/testnet/tx/cfea904f5575bd00c27705777cf0e9ac744ad055d027858d7ce130a227f7ef99) |
| B and C reclaimed after the window closed | [`e0a1053262ae…`](https://stellar.expert/explorer/testnet/tx/e0a1053262ae7e987b29cb979d892b38a3cda0bba8b833169f2cfbd4828f4d3d) |

| Recipient | Account | Balance id | Outcome |
|---|---|---|---|
| A: no trustline, claims | [`GCCK6L…X2A3`](https://stellar.expert/explorer/testnet/account/GCCK6LPNDBEDF2UPAEUMUROZPTLAEWLVLH55QP4UM7O5GJ52A7BAX2A3) | `000000000a7d65…` | CLAIMED ([`b3fce435d407…`](https://stellar.expert/explorer/testnet/tx/b3fce435d407bc6c7dc28f0504db0df4ae1d4a0935288bb666a1e35d39c959d8)) |
| B: no trustline, never claims | [`GDF6KI…AFUV`](https://stellar.expert/explorer/testnet/account/GDF6KIIK46CWNR54XAEIGBKXUVBB6DRBGWJMEVNZFUN2ENYXQI5UAFUV) | `00000000c47eaa…` | RECLAIMED ([`e0a1053262ae…`](https://stellar.expert/explorer/testnet/tx/e0a1053262ae7e987b29cb979d892b38a3cda0bba8b833169f2cfbd4828f4d3d)) |
| C: no account | [`GCS3JF…Y2SE`](https://stellar.expert/explorer/testnet/account/GCS3JFCLYF64PEJB7IRO24JNEJMRG6GGSFQS77GKF72RYJUYXBS4Y2SE) | `0000000036d109…` | RECLAIMED ([`e0a1053262ae…`](https://stellar.expert/explorer/testnet/tx/e0a1053262ae7e987b29cb979d892b38a3cda0bba8b833169f2cfbd4828f4d3d)) |

Reserve locked while the balances were open: 3 XLM (3 balances x 2 claimants x 0.5 XLM), all released after the claim and the reclaim.
<!-- CLAIMABLE:END -->
