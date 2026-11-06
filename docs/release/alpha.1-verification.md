# Stoplight v0.1.0-alpha.1 verification

Updated on 2026-11-06. **A1–A7: PASS. [v0.1.0-alpha.1 is published](https://github.com/givtaj/stoplight/releases/tag/v0.1.0-alpha.1) and its anonymous public download/fresh installation are verified.** This record distinguishes the compiled source, the test harness and release documentation, and public delivery.

## Artifact identity

| Field | Value |
| --- | --- |
| Compiled source | `48c3d6f60e7b14d1e0b908decda2b67fda2a5cac` |
| Compiled source tree | `2678623ddc7e189b481c89e651464cb7500aed06` |
| Release tag/source | `v0.1.0-alpha.1` → `0f18890ef68d1863cc08c6fa7010d674ff3925d8`. Corrected harness: `34b0e88fc5665fd54af0f9834b665c305a308d59` |
| ZIP | `stoplight-v0.1.0-alpha.1.zip` |
| ZIP SHA-256 | `0fdd1f12e99a0c6b62df3cf6481c7c25039c124f033dae4a9ce2e2d130f49405` |
| ZIP bytes | 253706 |
| Extension identity | Numeric version `0.1.0.1`, display version `0.1.0-alpha.1`, Manifest V3 |
| Contents | 10 build-output files, LICENSE, third-party notices and release-info.json; 13 entries total |

The ZIP was packaged from the independently built source export. All ten runtime files match the trusted build receipt, and the separately extracted ZIP matches every packaged hash. `release-info.json` identifies the actual compiled commit and file hashes; it is not silently rebound when only release tests/documentation change. Checksums establish consistency; this release does not claim a separate publisher signature.

## Gate record

| Gate | Current result | Evidence |
| --- | --- | --- |
| A1 Clean source/build | PASS for compiled source | Clean export verified against all 69 tracked blobs. Formatting, locked workspace tests (24), npm ci, typecheck, unit tests (37) and production build passed. [Compiled-source CI](https://github.com/givtaj/stoplight/actions/runs/42193482976) passed both Rust and extension jobs. [Final tag-source CI](https://github.com/givtaj/stoplight/actions/runs/42290577523) also passed; all 32 build/package inputs are identical. |
| A2 Browser matrix/repeat | PASS | All 36 browser cases passed in 52.8 seconds with zero failures, skips or retries on the exact ZIP. First native Chrome 156 acceptance passed. Independent B2–B4 repetition passed all 13 cases in 23.5 seconds, again without failures/skips/retries. Independent native Chrome for Testing 145 acceptance also passed, including fresh Load unpacked, real toolbar-opened panel, edited/original requests, FIFO3, detach and removal. |
| A3 Defects/dependencies | PASS within documented scope | [Targeted source review](source-review-2026-11-06.md) closed R1–R4 and arm-identity concerns. The completed exact-artifact acceptance has no unresolved blocking defect. Fresh npm audit reports zero findings. A Rust advisory scanner was unavailable; no Rust scanner pass is claimed. |
| A4 Package/install | PASS | Independent ZIP inspection checked safe paths, no symlinks/cache directories, loadable manifest root, referenced assets/WASM, source identity and all hashes. The exact ZIP loaded through native Load unpacked in a fresh profile. |
| A5 Public instructions/privacy | PASS | README covers ZIP install, five permissions, manual replacement/removal and feedback. Privacy copy states captured data and retention. Public repository is MIT licensed with Issues enabled. The documented disable/remove/separate-folder replacement procedure passed; preferences reset and no silent re-arm occurred. Permission and privacy wording passed independent review. |
| A6 Decision | GO | On 2026-11-06, the coordinator records GO under the maintainer’s explicit authorization: A1–A5 passed for compiled source `48c3d6f` and ZIP `0fdd1f12…49405`. Before publication, the final tag revision passed hosted CI and two independent comparisons confirmed all 32 build/package inputs matched the compiled source. [Source-equivalence asset](https://github.com/givtaj/stoplight/releases/download/v0.1.0-alpha.1/source-equivalence.json). |
| A7 Public acquisition | PASS | Anonymous release/ZIP/checksum/tag-source acquisition matched the approved identities. All 13 core cases passed again against the downloaded ZIP, followed by fresh native Load unpacked, panel/core flows, detach and uninstall. [Public-delivery receipt](alpha.1-public-delivery.json). |

## Environments and boundaries

- Clean build: macOS 26.0.1 ARM64; Node 22.20.0, npm 10.9.3, Rust/Cargo 1.99.1 and wasm-pack 0.15.0. Dependency/build caches started empty. wasm-pack compiled its wasm-bindgen CLI when no prebuilt tool was available; no source patch was needed.
- Build minimum check: Node 20.19.0/npm 10.8.2 passed fresh installation, typecheck, 18 then-current unit tests and production build on the earlier working snapshot with the final dependency set. This is a minimum-toolchain check, not the final browser acceptance result.
- Automated browser: Chrome for Testing 145.0.7632.6 on macOS. First native run: Google Chrome 156.0.8078.80 (arm64), macOS 26.0.1 (25A362), fresh signed-out `Stoplight Alpha1 QA / Profile 2`. Independent core repetition reused Chrome for Testing 145.0.7632.6 with fresh per-test profiles; second native run passed in fresh profile `stoplight-native-second-1f6dt60u / Default` with manual Load unpacked and the actual native panel.
- Other operating systems and Chrome versions, including the API minimum Chrome 118, are unverified. No store approval, automatic updater, production-capacity or real-customer acceptance claim is made.

The independent verifier repeated all 13 B2–B4 cases from a separate verified export of harness `34b0e88` against its own extraction of the same ZIP. The scope included HTTP/HTTPS origin and tab boundaries, stale and same-tab target changes, unsupported targets, JSON/Unicode/form/XML/empty/bodyless requests over Fetch and XHR, unchanged draft discard and FIFO3 originals. [Independent case summary](alpha.1-core-repeat.json).

## Native first-profile acceptance

[Native receipt](alpha.1-native-first.json) and [selected screenshots](../screenshots/alpha.1/README.md) record the actual toolbar-opened side panel. Eleven ordered synthetic server receipts confirmed edited JSON/header, original Unicode after changing a draft, three original requests in FIFO order despite a draft, exact binary bytes, actual DevTools coexistence/continuation, detach releasing a held original, normal traffic while disabled, normal traffic before replacement arming, and re-arm recovery. The first request was held with zero server receipts; all three FIFO requests were absent before Play All.

Manual replacement followed the README: detach, disable, remove the old entry, separately extract the same verified ZIP and Load unpacked. The replacement started idle with an empty queue and no silent arm; saved two-origin preferences reset to the default current origin after explicit arm. This rehearses the first alpha’s clean-install replacement procedure, not a cross-version migration or a rollback to a nonexistent prior release.

Both extraction inventories and the ZIP hash remained unchanged. The Mac locked during optional final removal of the replacement; that outcome was not observed. The last observed state was detached with an empty queue, and the fixture server was stopped. The old-entry removal and replacement checks had already passed; the retained QA profile is not claimed removed.

## Independent second native profile

[Second native receipt](alpha.1-native-second.json) records PASS on Chrome for Testing 145.0.7632.6 ARM64, macOS 26.0.1. A new profile manually loaded a fresh extraction of the exact approved ZIP. Seven synthetic server receipts confirmed edited JSON/header, original Unicode XHR after changing a draft, FIFO3 originals despite a draft, detach releasing an original and ordinary traffic afterward. Held requests had zero early deliveries. Native removal, browser shutdown and fixture shutdown passed. The ZIP and all 13 extracted files remained unchanged. No source build or installation patch was required.

This native repeat complements the independent 13-case B2–B4 automated repeat; their scopes remain separately recorded. The source/ZIP identity is unchanged from the full 36-case matrix and first native profile.

## Public delivery — 2026-11-06

The release was published at 20:43:51 UTC. [Public-delivery verification](alpha.1-public-delivery.json) completed at 20:50:52 UTC using anonymous direct HTTPS downloads, without local credentials, cookies or curl configuration. The named ZIP, published checksum and all 13 packaged files matched the approved artifact. The public annotated tag resolved to `0f18890ef68d1863cc08c6fa7010d674ff3925d8`; all 78 downloaded source files matched that exact commit, and all 32 build/package inputs matched compiled source `48c3d6f`.

The downloaded tag’s harness ran all 13 B2–B4 cases against the downloaded ZIP in fresh profiles: 13 passed, zero failures/skips/retries, 19.4 seconds. A separate new Chrome for Testing 145 native profile manually installed that extraction, opened the actual toolbar panel and produced seven expected server deliveries across edited JSON, unchanged Unicode after draft edits, FIFO3 originals, detach recovery and normal traffic. Native uninstall, browser shutdown and fixture shutdown passed. Package and source hashes remained unchanged after execution.

This checkpoint tests the public artifact without rebuilding it. The release tag and four assets stay fixed; this later documentation records delivery evidence. HTTPS and adjacent checksums establish consistency with the official repository; the annotated tag is unsigned, and no independent publisher-signature verification is claimed.

## Evidence provenance

Raw local receipts and earlier failed harness runs are retained under `outputs/release-verification/2026-11-06-updated/final-candidate/`, `outputs/release-verification/alpha1-candidate-48c3d6f/`, and `outputs/v0.1-qa-2026-11-06/`. Those scratch directories are not published as source. The public summary records their exact identities and limits.

The original 35-case ZIP run had 33 passes and two harness failures: closing a tab did not emit the expected Playwright network callback, and uninstall was issued to the wrong CDP scope/install location. Corrected checks require actual target destruction, detached state, no late delivery and re-arm, and use a real unpacked installation for uninstall. Original failures remain preserved. The corrected unavailable-body case used a real HTTPS/HTTP2 ReadableStream with omitted inline postData, exactly one injected body-lookup failure, the actual persisted unavailable-capture state and disabled editing, then exact original bytes received once. The final consolidated 36-case run passed without skips or retries. [Machine-readable case summary](alpha.1-browser-results.json) records each result; independent review approved the test-only corrections, committed as `34b0e88`. [Hosted CI for that harness revision](https://github.com/givtaj/stoplight/actions/runs/42197109870) also passed.

The B9 observation recorded two synthetic loopback requests and the exact five installed permissions, with no host origins. Frozen source/bundle review found no application telemetry/backend calls; bundled fetch sites load local WASM/module assets. This combines bounded observation and source review, not an exhaustive browser/OS egress audit.
