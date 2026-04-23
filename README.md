# QA Trace

A browser extension that tracks user actions and runtime errors during exploratory testing, then generates structured prompts to produce bug reports, step-by-step documentation, and full session reports via an LLM or webhook.

Available for **Google Chrome** (Manifest V3), **Mozilla Firefox** (Manifest V2), and **Yandex Browser** (Chromium-based, uses the Chrome build).

## Features

### User Action Tracking

- Captures **click**, **double-click**, **input**, **change**, **tab open**, and **tab reload** events.
- Records element tag, CSS selector, entered value (passwords are masked), closest label text, timestamp, and tab context.
- Deduplicates repeated actions on the same element.
- Configurable storage limits for actions, errors, and text length.

### Error Detection

- **Console errors** — intercepts `window.onerror` and unhandled promise rejections.
- **Network errors** — patches `fetch` and `XMLHttpRequest` to capture failed HTTP requests with status, headers, and response body.
- **UI errors** — watches the DOM via `MutationObserver` for elements matching configurable CSS selectors (default: `div[id^="__error"]`).
- Error monitoring can be disabled per URL — useful when a site produces noise you don't need, while still tracking user actions.
- Displays in-page toast notifications when errors are detected.
- Automatically captures a screenshot for UI errors and can be copied from the popup.
- Console and network error data is stored and can be copied in **JSON format** from the popup.

### Privacy and Security

- Tracking runs **only** on origins explicitly added to **Allowed URLs**.
- URL query strings and hash fragments are stripped before storage by default (prevents storing session tokens).
- Sensitive HTTP headers (`Authorization`, `Cookie`, API keys, tokens) are automatically redacted from network error payloads.
- Sensitive fields in request/response bodies are redacted.
- API keys and webhook passwords are encrypted with a user-provided passphrase using **AES-256-GCM** with **PBKDF2** key derivation (600,000 iterations). The passphrase is never stored.
- All data is stored locally in extension storage. No remote transmission occurs unless the user explicitly enables and triggers an integration.
- Collected data auto-expires after 12 hours.
- [Privacy Policy](docs/privacy-policy.md)

### Prompt Generation Modes

| Mode | Purpose |
|---|---|
| **Steps to Reproduce** | Concise step-by-step instructions for reproducing issues — optimized for bug tickets |
| **Document Steps** | Neutral step documentation from actions only (no errors) — for process documentation |
| **Full Report** | Comprehensive timeline with all actions and errors — for exploratory testing session reports |

### Scope Controls

- Include data from **all tabs** or select specific tracked tabs.
- Limit by **action count** (Steps/Document modes) or **time window** (Full Report mode).
- Mark individual errors as **expected** to exclude them from generated prompts.
- Add a free-text **unexpected behavior** description, even when no technical errors were captured.

### Integrations (Optional)

All integrations are disabled by default.

- **LLM Integration** — Send generated prompts directly to OpenAI, DeepSeek, or a custom OpenAI-compatible endpoint. The response is parsed into a structured `{ summary, description }` format.
- **Webhook Integration** — Send the prompt payload (with raw actions/errors data) to any HTTP endpoint, with optional Basic Auth.
- **Copy to Clipboard** — Always available. Generate the prompt and copy it manually.

### Internationalization

- Supported languages: **English**, **Russian**.
- LLM prompt templates are generated in the configured output language.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22.12.0
- npm (included with Node.js)

### Install Dependencies

```bash
npm install
```

### Development

Start the Vite dev server with hot reload:

```bash
npm run dev
```

### Production Build

Build for both browsers:

```bash
npm run build
```

Or build for a specific browser:

```bash
npm run build:chromium   # outputs to dist/
npm run build:firefox    # outputs to dist-firefox/
```

### Load the Extension

#### Chrome / Chromium

1. Navigate to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` directory.

#### Firefox

1. Navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select any file inside the `dist-firefox/` directory (e.g., `manifest.json`).

Firefox removes temporary Add-ons once the browser is closed.

#### Yandex Browser

1. Navigate to `browser://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` directory.

## Tech Stack

- **TypeScript** — strict mode, ES2020 target
- **Vite** — build tooling with [vite-plugin-web-extension](https://github.com/nicolo-ribaudo/vite-plugin-web-extension) for cross-browser manifest handling
- **WebExtension Polyfill** — unified browser API across Chrome and Firefox

## Configuration

On first install, the extension opens the configuration page. You can reopen it at any time from the popup.

| Setting | Description |
|---|---|
| **Allowed URLs** | Origins where tracking is active (required). Error monitoring can be disabled per URL |
| **Error Monitoring** | Toggle network, console, and UI error detection |
| **Language** | Output language for LLM prompts (auto / English / Russian) |
| **Integrations** | LLM (OpenAI / DeepSeek / custom) or webhook, with encrypted credentials |
| **Ticket Example** | Example summary and description to guide LLM output format |
| **Documentation Example** | Example title and steps to guide documentation output |
| **Limits** | Max stored actions, errors, and text length per field |
| **URL Redaction** | Strip query strings and hash fragments from stored URLs |

## Documentation

- [QA Use Cases and Workflows](docs/qa-use-cases.md) — practical guide for QA engineers

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.

1. Fork the repository.
2. Create a feature branch from `main`.
3. Make your changes.
4. Run `npm run build` to verify the build succeeds for both browsers.
5. Submit a pull request.

## License

This project is licensed under the [AGPL-3.0 license](LICENSE).

Copyright Anastasia Nesterova
