# Stoplight v0.1.0-alpha.1 verification

Prepared on 2026-11-06. **Publication is pending final browser/native acceptance.** This record distinguishes the compiled source, the test harness and release documentation, and public delivery.

## Artifact identity

| Field | Value |
| --- | --- |
| Compiled source | `48c3d6f60e7b14d1e0b908decda2b67fda2a5cac` |
| Compiled source tree | `2678623ddc7e189b481c89e651464cb7500aed06` |
| Release tag/source | Pending final documentation commit; corrected harness `34b0e88fc5665fd54af0f9834b665c305a308d59`; build-input equivalence must be verified before tagging |
| ZIP | `stoplight-v0.1.0-alpha.1.zip` |
| ZIP SHA-256 | `0fdd1f12e99a0c6b62df3cf6481c7c25039c124f033dae4a9ce2e2d130f49405` |
| ZIP bytes | 253706 |
| Extension identity | Numeric version `0.1.0.1`, display version `0.1.0-alpha.1`, Manifest V3 |
| Contents | 10 build-output files, LICENSE, third-party notices and release-info.json; 13 entries total |

The ZIP was packaged from the independently built source export. All ten runtime files match the trusted build receipt, and the separately extracted ZIP matches every packaged hash. `release-info.json` identifies the actual compiled commit and file hashes; it is not silently rebound when only release tests/documentation change. Checksums establish consistency; this release does not claim a separate publisher signature.

## Gate record

| Gate | Current result | Evidence |
| --- | --- | --- |
| A1 Clean source/build | PASS for compiled source | Clean export verified against all 69 tracked blobs. Formatting, locked workspace tests (24), npm ci, typecheck, unit tests (37) and production build passed. [Hosted CI](https://github.com/givtaj/stoplight/actions/runs/42193482976) passed both Rust and extension jobs at the same SHA. |
| A2 Browser matrix/repeat | Automated and first native PASS; second native pending | All 36 browser cases passed in 52.8 seconds with zero failures, skips or retries on the exact ZIP. First native Chrome 156 acceptance passed. Independent B2–B4 repetition passed all 13 cases in 23.5 seconds, again without failures/skips/retries. The second native-profile check is required. |
| A3 Defects/dependencies | Source checks passed; acceptance pending | [Targeted source review](source-review-2026-11-06.md) closed R1–R4 and arm-identity concerns. Fresh npm audit reports zero findings. A Rust advisory scanner was unavailable; no Rust scanner pass is claimed. |
| A4 Package/install | PASS | Independent ZIP inspection checked safe paths, no symlinks/cache directories, loadable manifest root, referenced assets/WASM, source identity and all hashes. The exact ZIP loaded through native Load unpacked in a fresh profile. |
| A5 Public instructions/privacy | PASS | README covers ZIP install, five permissions, manual replacement/removal and feedback. Privacy copy states captured data and retention. Public repository is MIT licensed with Issues enabled. The documented disable/remove/separate-folder replacement procedure passed; preferences reset and no silent re-arm occurred. Permission and privacy wording passed independent review. |
| A6 Decision | NO-GO pending second native repeat | The maintainer authorized conditional publication after all thresholds pass. This is not a release approval yet. |
| A7 Public acquisition | Not run | No alpha tag or release asset has been published. |

## Environments and boundaries

- Clean build: macOS 26.0.1 ARM64; Node 22.20.0, npm 10.9.3, Rust/Cargo 1.99.1 and wasm-pack 0.15.0. Dependency/build caches started empty. wasm-pack compiled its wasm-bindgen CLI when no prebuilt tool was available; no source patch was needed.
- Build minimum check: Node 20.19.0/npm 10.8.2 passed fresh installation, typecheck, 18 then-current unit tests and production build on the earlier working snapshot with the final dependency set. This is a minimum-toolchain check, not the final browser acceptance result.
- Automated browser: Chrome for Testing 145.0.7632.6 on macOS. First native run: Google Chrome 156.0.8078.80 (arm64), macOS 26.0.1 (25A362), fresh signed-out `Stoplight Alpha1 QA / Profile 2`. Independent core repetition reused Chrome for Testing 145.0.7632.6 with fresh per-test profiles; second native run remains pending.
- Other operating systems and Chrome versions, including the API minimum Chrome 118, are unverified. No store approval, automatic updater, production-capacity or real-customer acceptance claim is made.

The independent verifier repeated all 13 B2–B4 cases from a separate verified export of harness `34b0e88` against its own extraction of the same ZIP. The scope included HTTP/HTTPS origin and tab boundaries, stale and same-tab target changes, unsupported targets, JSON/Unicode/form/XML/empty/bodyless requests over Fetch and XHR, unchanged draft discard and FIFO3 originals. [Independent case summary](alpha.1-core-repeat.json).

## Native first-profile acceptance

[Native receipt](alpha.1-native-first.json) and [selected screenshots](../screenshots/alpha.1/README.md) record the actual toolbar-opened side panel. Eleven ordered synthetic server receipts confirmed edited JSON/header, original Unicode after changing a draft, three original requests in FIFO order despite a draft, exact binary bytes, actual DevTools coexistence/continuation, detach releasing a held original, normal traffic while disabled, normal traffic before replacement arming, and re-arm recovery. The first request was held with zero server receipts; all three FIFO requests were absent before Play All.

Manual replacement followed the README: detach, disable, remove the old entry, separately extract the same verified ZIP and Load unpacked. The replacement started idle with an empty queue and no silent arm; saved two-origin preferences reset to the default current origin after explicit arm. This rehearses the first alpha’s clean-install replacement procedure, not a cross-version migration or a rollback to a nonexistent prior release.

Both extraction inventories and the ZIP hash remained unchanged. The Mac locked during optional final removal of the replacement; that outcome was not observed. The last observed state was detached with an empty queue, and the fixture server was stopped. The old-entry removal and replacement checks had already passed; the retained QA profile is not claimed removed.

## Evidence provenance

Raw local receipts and earlier failed harness runs are retained under `outputs/release-verification/2026-11-06-updated/final-candidate/`, `outputs/release-verification/alpha1-candidate-48c3d6f/`, and `outputs/v0.1-qa-2026-11-06/`. Those scratch directories are not published as source. The public summary records their exact identities and limits.

The original 35-case ZIP run had 33 passes and two harness failures: closing a tab did not emit the expected Playwright network callback, and uninstall was issued to the wrong CDP scope/install location. Corrected checks require actual target destruction, detached state, no late delivery and re-arm, and use a real unpacked installation for uninstall. Original failures remain preserved. The corrected unavailable-body case used a real HTTPS/HTTP2 ReadableStream with omitted inline postData, exactly one injected body-lookup failure, the actual persisted unavailable-capture state and disabled editing, then exact original bytes received once. The final consolidated 36-case run passed without skips or retries. [Machine-readable case summary](alpha.1-browser-results.json) records each result; independent review approved the test-only corrections, committed as `34b0e88`. [Hosted CI for that harness revision](https://github.com/givtaj/stoplight/actions/runs/42197109870) also passed.

The B9 observation recorded two synthetic loopback requests and the exact five installed permissions, with no host origins. Frozen source/bundle review found no application telemetry/backend calls; bundled fetch sites load local WASM/module assets. This combines bounded observation and source review, not an exhaustive browser/OS egress audit.
