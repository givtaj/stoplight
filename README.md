# Stoplight

Stoplight is a Chrome MV3 extension for manually pausing, inspecting, editing, and continuing API requests from one active tab at a time.

It uses a thin TypeScript extension shell for Chrome APIs and UI, with a Rust/WASM core for request normalization, body handling, diffing, and session-state reduction.

## Install the Developer Alpha

The first release target is [`v0.1.0-alpha.1`](https://github.com/givtaj/stoplight/releases/tag/v0.1.0-alpha.1). Check the [release status](docs/release/release-status.md) for the current acceptance decision. This is an unpacked developer extension, with manual updates and no Chrome Web Store installation.

1. Download `stoplight-v0.1.0-alpha.1.zip` and `SHA256SUMS` from the release's **Assets**. The GitHub source archives are for building, not installing.
2. On macOS, run `shasum -a 256 -c SHA256SUMS` in the download directory and require an `OK` result before loading the extension.
3. Extract the ZIP into a permanent folder. No Rust, Node.js or npm is needed for this installation.
4. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
5. Select the extracted folder containing `manifest.json`. Keep that folder in place while the extension is installed.
6. Confirm Stoplight displays `0.1.0-alpha.1` (numeric manifest version `0.1.0.1`). Pin Stoplight in Chrome's Extensions menu for easy access.

The release receipt records the tested Chrome version and operating system. Chrome 118 is the API minimum; other versions and operating systems are unverified unless listed in that receipt.

Chrome shows a debugger warning because Stoplight uses the Debugger API to pause and continue requests in the tab you arm. Review the [five permission explanations](docs/store/chrome-web-store-copy.md#permission-explanation) and [data handling](docs/privacy/data-handling.md) before arming a session.

## Build Prerequisites

- Chrome 118 or newer.
- Rust stable with the `wasm32-unknown-unknown` target available.
- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` with npm. Node 21 and 23 are outside the supported build range; the release receipt records the versions actually tested.
- `wasm-pack` available on `PATH`.

## Build

From the repository root:

```bash
rustup target add wasm32-unknown-unknown
cargo test --workspace --locked
cd extension
npm ci
npm run build
```

`npm run build` regenerates the Rust/WASM package into `extension/src/generated/stoplight_wasm/` and then bundles the extension into `extension/dist/`.

The release workflow treats both `extension/src/generated/stoplight_wasm/` and `extension/dist/` as build artifacts.

## Install a Local Build

1. Build the extension with `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select `extension/dist/`.

## Usage

1. Open the page whose API traffic you want to inspect.
2. Open Stoplight from the toolbar action.
3. Review the arm target shown in the side panel.
4. Click Arm Current Tab.
5. Wait for matching API requests to appear in the paused queue.
6. Select a request to inspect headers and body.
7. Edit the request if needed.
8. Use Continue Unchanged, Continue Edited, or Play All.
9. Detach when you are done.

Continue Unchanged and Play All send the original requests; Play All does not apply unsent editor drafts. Continue Edited applies the selected request's draft. Detach ends interception and may let held original requests proceed; it is not a cancel operation.

## Update, Recovery and Removal

Unpacked installations do not update automatically. Detach first, disable Stoplight at `chrome://extensions`, verify and extract the new ZIP into a separate folder, remove the old unpacked entry, then Load unpacked from the new folder. This clean-install update resets stored preferences; review the tab and origin allowlist before arming again. Never replace files underneath an armed session.

If a session or update fails, detach or disable/remove Stoplight, then reload the test page. Reinstall a verified release when ready. The first alpha has no earlier published version to roll back to. Removing the extension clears its browser-local stored data; disabling clears session data but retains origin preferences. See [privacy and retention](docs/privacy/data-handling.md).

## Feedback

Report reproducible problems in [GitHub Issues](https://github.com/givtaj/stoplight/issues). Include the alpha version, Chrome/OS versions, expected and actual results, and a small synthetic example. Remove authorization headers, cookies, tokens, personal data and real request bodies from reports and screenshots.

## v0.1 Limits

- Chrome-only, MV3-only.
- Single active tab only.
- Review the website target shown by the panel before arming. Known unsupported URLs are rejected before attachment. If Chrome initially hides the URL, Stoplight validates it after the requested attachment and before enabling interception.
- Manual interception only, with no presets or automation.
- Request editing is outgoing-only.
- Responses are not editable.
- Multipart and bodies declared with nontext content types are inspect-only; their headers and bodies can only continue unchanged. Chrome may omit captured binary/file body text. Without a content type, body classification uses text heuristics.
- Static assets are auto-continued and are not part of the paused queue in v0.1.
- A debugger detach ends the session and requires re-arming. Detach can release held requests unchanged; it is not a request-cancel action.
- DevTools behavior depends on Chrome: in the tested Chrome 156 session it coexisted with Stoplight and continuation still worked. If Chrome detaches the debugger, Stoplight displays the detached state.

## Release Workflow

Release acceptance is tracked in the [release status](docs/release/release-status.md) and [alpha pass/fail thresholds](docs/release/v0.1-qa-package.md#public-alpha-contract--2026-11-06).

The release build is source-driven:

- `extension/src/generated/stoplight_wasm/` is generated by `wasm-pack build` and is not committed.
- `extension/dist/` is generated by Vite and is not committed.
- A release candidate should be produced from a clean checkout by running `cd extension && npm run build`.
- The unpacked extension to load in Chrome is the generated `extension/dist/` directory.
- The [alpha verification receipt](docs/release/alpha.1-verification.md) identifies the selected source, ZIP, browser results, native-profile checks and public-delivery decision. Historical candidates are recorded separately in the QA package.

For local verification, use:

```bash
cargo fmt --all --check
cargo test --workspace --locked
cd extension
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

After the source is committed and the clean candidate is built, package that candidate with `python3 scripts/package-release.py --dist /absolute/path/to/candidate/extension/dist --build-receipt /absolute/path/to/build-receipt.json --output /absolute/path/to/release-output`. The trusted build receipt must record `source_commit`, `source_tree` and `dist_files` (relative paths mapped to SHA-256) from the clean build. Packaging checks that identity/inventory before recording the ZIP checksum. A local build is not public-download verification.
