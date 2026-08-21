# E2E tests (Playwright + real Freighter extension)

Sendall's payment flow only completes with a real wallet signature, so these
tests drive an actual Freighter extension in a real (headed) Chromium
instance via Playwright — not a mock. Extension popups (grant-access,
sign-message, sign-transaction) are real browser windows Playwright can see
and click, unlike a plain page-automation tool scoped to one tab/page.

## One-time setup

1. Generate and fund a testnet test wallet:

   ```
   node e2e/scripts/generate-wallet.mjs
   ```

   Copy the printed block into `.env.test` (gitignored — see
   `.env.test.example`).

2. Download the Freighter extension build (not vendored in the repo):

   ```
   ./e2e/scripts/download-freighter.sh
   ```

## Running

```
npm run test:e2e
```

This downloads Freighter if missing, then runs Playwright. The first run's
`globalSetup` (`e2e/setup/global-setup.ts`) imports the `.env.test` mnemonic
into a real Freighter profile at `e2e/.wallet-profile` (gitignored) and
switches it to Testnet; later runs reuse that profile.

The dev server must already be running (`npm run dev`) — `E2E_BASE_URL` in
`.env.test` controls which URL the tests hit (defaults to
`http://localhost:3000`).

## How wallet approval works

`e2e/fixtures/wallet.ts` exports `approveWalletFlow(context, appPage,
triggerClick)`: call it with the click that starts a wallet action (e.g.
"Sign & send"). It picks Freighter in the in-page Stellar Wallets Kit picker
if one appears, then approves whatever sequence of Freighter popups follows
(grant-access / sign-message / sign-transaction — the exact set depends on
whether this profile already trusts the app's origin).

**Gotcha that cost real time getting this right:** `Locator.isVisible()` and
`.isHidden()` check the DOM at that exact instant — they do **not** poll,
even when passed a `timeout`. The picker modal can take a moment to render,
so checking with `isVisible({ timeout })` right after the triggering click
unreliably reports "not there" before it's rendered. Use `locator.waitFor({
state: "visible", timeout })` (or `expect(locator).toBeVisible()`) instead,
which do poll. If you're extending `approveWalletFlow`, keep using
`waitFor`/`expect` for anything that might not be there yet.

## Troubleshooting

- **"Too many draft batches"**: the wallet profile's cookies persist across
  runs, and repeated runs against the same anon session eventually trip
  `MAX_UNCLAIMED_ANON_BATCHES` in `src/app/api/batches/route.ts`. Tests
  should call `context.clearCookies()` before creating a batch to start a
  fresh anon session each run.
- **Re-onboard the wallet** (e.g. after changing the test mnemonic): delete
  `e2e/.wallet-profile` and rerun.
