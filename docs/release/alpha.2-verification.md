# Stoplight v0.1.0-alpha.2 verification

Published and independently downloaded on 25 November 2026. The public artifact passed a fresh installation, a real cross-origin request edit through Chrome’s native side panel, detach and removal. Browser testing covered Chrome for Testing 145.0.7632.6 on macOS 26.0.1 ARM64. Other browser and OS combinations remain unverified for this release. [Release assets](https://github.com/givtaj/stoplight/releases/tag/v0.1.0-alpha.2)

## Artifact identity

| Item | Verified value |
| --- | --- |
| Annotated tag | `v0.1.0-alpha.2` |
| Compiled and tagged source | `aad11a99fb017d5f9bfb3147564567f52ab98f9b` |
| Source tree | `ca9a8ed1e3b8e9dbe1e1cc8ecd38bcea3f449d8f` |
| ZIP | `stoplight-v0.1.0-alpha.2.zip`, 254,264 bytes, 13 files |
| ZIP SHA-256 | `0f93fffe8b7fb866afca46a7e170d9c5ec2091a6f77026812966cab662b8eacc` |
| Chrome manifest | `0.1.0.2`, display version `0.1.0-alpha.2` |

The ZIP embeds its source identity and hashes in `release-info.json`. The public release includes both the clean build inventory and the final package inventory. The checksum verifies consistency with those public assets. Publisher authentication relies on GitHub HTTPS. [Build receipt](https://github.com/givtaj/stoplight/releases/download/v0.1.0-alpha.2/build-receipt.json) · [Package receipt](https://github.com/givtaj/stoplight/releases/download/v0.1.0-alpha.2/package-receipt.json)

## Candidate checks

- A clean checkout of the tagged source passed formatting, 24 Rust tests, TypeScript typechecking, 37 extension unit tests and the production WASM/Vite build. The verified build used Node 22.20.0, npm 10.9.3, Rust 1.99.1 and wasm-pack 0.15.0. Rust source paths were remapped before packaging. Both hosted CI jobs passed on the compiled commit. [GitHub Actions run](https://github.com/givtaj/stoplight/actions/runs/45595752133)
- All 37 browser cases passed against the extracted candidate ZIP. A separate 17-case core repeat covered target and origin boundaries, request edits, original delivery and queue behavior. Both runs had zero failures, skips or retries. The new regression distinguished a browser-generated preflight from an ordinary OPTIONS request and confirmed the edited POST body at the receiving server. [Regression test](../../extension/tests/e2e/stoplight.spec.ts)
- Two fresh signed-out profiles installed the exact ZIP extraction through **Load unpacked**. Each opened the actual toolbar panel, armed the selected tab, edited a synthetic request, and detached with an empty queue. The server received each expected edited body once.
- npm audit reported zero findings. An OSV lookup for all 50 Cargo registry package versions matched `url 2.5.8` to RUSTSEC-2026-0592. Stoplight’s sole Rust consumer parses URLs and reads their scheme, host and port. Neither affected Rust origin function is called on this path. The check covered the release lockfiles. [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2026-0592.html) · [Rust URL handling](../../crates/core/src/request.rs)
- The maintainer authorized publication. The candidate passed its release checks with the manual replacement guidance below before the exact archive was uploaded as a prerelease.

## Manual replacement

The upgrade from alpha.1 to alpha.2 and rollback to alpha.1 both passed in the same disposable profile. For each transition the tester detached, disabled and removed the old version, restarted Chrome, then loaded the next version from a separate folder. Every installation started idle with an empty queue and reset origin preferences. The receiving server confirmed an edited POST after every installation.

**Known issue in Chrome for Testing 145.** Immediate replacement in a running browser could produce “Debugger is not attached” on the first arm. Reloading the page or opening another tab alone reproduced the error. Fully quitting and reopening Chrome between versions worked in both directions. In a separate run, waiting ten seconds after the error, choosing **Detach**, and then **Arm Current Tab** also recovered both versions. These timing checks used actual unpacked installations through Chrome's DevTools Protocol.

## Public download and installation

Unauthenticated HTTPS downloads of all four release assets matched the approved local digests. All 80 files and executable modes in the public source archive matched the tagged Git tree. All ten compiled outputs and all 13 extracted ZIP files matched their recorded hashes.

The public ZIP passed 18 browser checks on their first attempt, including the core suite and the new preflight regression. A fresh installed-package check verified one edited server delivery, detach, removal, normal traffic after uninstall and browser shutdown.

A separate signed-out profile loaded the public extraction through Chrome’s **Load unpacked** UI. The native toolbar panel forwarded a server-verified edit on the loopback fixture. On PlayLab’s **Submit POST** exercise, the queue labeled the empty OPTIONS request **CORS preflight** and the hint named POST. **Continue Unchanged** exposed the editable POST. After **Continue Edited**, PlayLab displayed **201 Created** with the exact edited title returned by its mock API. The tester detached with an empty queue, disabled the extension and confirmed its removal. [PlayLab exercise](https://playwrightlab.github.io/index.html#network)

These were agent-run checks. First-time human usability feedback remains open.
