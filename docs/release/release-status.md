# Stoplight releases

## First Chrome Web Store release

**v0.1.0-alpha.4 · 28 November 2026.** Stoplight is now available from the Chrome Web Store. Choose **Add to Chrome**, open the side panel on a website, and arm the tab to pause its outgoing Fetch and XHR requests. [Install Stoplight](https://chromewebstore.google.com/detail/stoplight/hmiegichaapkmpplleopipdbpdfafhpk)

We tested the published extension in a fresh Chrome for Testing 158 profile on macOS. In TestYard Notes, the form still read **🔴 Red light — original** while Stoplight held the save request. We changed only the JSON title in the side panel, chose **Continue Edited**, and released the list refresh. The site displayed **🟢 Green light — edited in Stoplight** even after we detached Stoplight and reloaded the page. [Paused request](../screenshots/alpha.4/01-held-edit.jpg) · [Saved note after reload](../screenshots/alpha.4/02-after-reload.jpg)

## v0.1.0-alpha.2

The queue labels a browser’s CORS preflight and the detail panel names the HTTP method it wants to send. Choose **Continue Unchanged** to send the permission check. If the server allows the request, select it in the queue to inspect or edit its payload.

The distribution is an unpacked Chrome extension. Use the versioned ZIP and its checksum for a fresh installation or a manual update from alpha.1. [Release assets](https://github.com/givtaj/stoplight/releases/tag/v0.1.0-alpha.2) · [Install and update instructions](../../README.md#install-the-developer-alpha)

Published and publicly verified on 25 November 2026. The downloaded ZIP passed 18 browser checks and a fresh native installation on Chrome for Testing 145, macOS ARM64. PlayLab returned HTTP 201 with the edited title. [Alpha.2 verification](alpha.2-verification.md)

## v0.1.0-alpha.1

The first public alpha passed gates A1–A7 on November 6, 2026. Its ZIP, checksum, tagged source, browser checks and native-profile results are recorded in its release receipt. [Alpha.1 verification](alpha.1-verification.md) · [Public download and install results](alpha.1-public-delivery.json) · [Alpha acceptance criteria](v0.1-qa-package.md#public-alpha-contract--2026-11-06)
