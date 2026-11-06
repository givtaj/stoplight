# Native Chrome Release Screenshots

Captured on 2026-11-06 in Google Chrome 156.0.8078.80 on macOS 26.0.1 ARM64, using a fresh signed-out **Stoplight QA 2026-11-06** profile and synthetic loopback traffic. These are unedited native Chrome window captures (3840 × 1968), including the real side-panel shelf; the extension page was not opened as a standalone tab. The panel is scrolled where needed to expose request controls.

| Capture | State |
| --- | --- |
| [Idle](v0.1-2026-11-06/01-native-idle.png) | Toolbar-opened native panel, explicit website target, no paused request. |
| [Paused editor](v0.1-2026-11-06/02-native-paused-editor.png) | JSON request held, server receipts still zero, header/body editor visible. |
| [Binary inspect-only](v0.1-2026-11-06/03-native-binary-inspect-only.png) | Binary upload held, editors/Continue Edited disabled; static image loaded without adding queue traffic. |
| [Detached](v0.1-2026-11-06/04-native-detached.png) | Chrome debugger cancellation yields detached state, zero queued requests and a re-arm instruction. |

The local receipt `outputs/v0.1-qa-2026-11-06/native-acceptance.json` records screenshot SHA-256 values and the exact intermediate candidate. See the [QA package](../release/v0.1-qa-package.md#working-candidate-qa--2026-11-06) for source/build identity and scope limits. These screenshots predate the final alpha fixes and do not establish final-artifact acceptance or Chrome Web Store approval.
