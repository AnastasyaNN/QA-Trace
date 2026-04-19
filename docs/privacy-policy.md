# QA Trace — Privacy Policy

**Last updated:** April 19, 2026

QA Trace is a browser extension that helps QA engineers capture user actions and runtime errors during exploratory testing sessions and convert them into structured reports. This policy explains what data the extension collects, how it is stored, and under what circumstances it may be transmitted externally.

> **Key principle:** QA Trace stores all collected data locally on your device. No data is transmitted externally unless you explicitly configure and trigger an integration.

## 1. Data collected

When tracking is active on an allowed origin, QA Trace collects:

- **User actions** — event type (click, input, select, change, tab open/reload), element selector, optional input value, timestamp, tab URL, and tab title.
- **Console errors** — error message, stack trace, and timestamp.
- **Network errors** — HTTP method, URL, status code, request/response headers and body, and timestamp.
- **UI error screenshots** — a base64-encoded PNG image of the visible tab area captured when a UI error is detected.

QA Trace does **not** collect data on pages outside your configured Allowed URLs list. Password input values are never captured.

## 2. Sensitive data redaction

QA Trace applies automatic redaction before storing data:

- **URL query strings and hash fragments** are stripped by default to prevent accidental storage of tokens or session identifiers.
- **Sensitive HTTP headers** (Authorization, Cookie, X-API-Key, and other token-bearing headers) are removed from stored network error data.
- **Sensitive body fields** (password, token, api_key, session, and similar) are replaced with `[REDACTED]`.

## 3. Data storage

- All collected data is stored in `browser.storage.local` on your device.
- Stored data **automatically expires after 12 hours**.
- Storage is subject to configurable limits (actions, errors, screenshots, network payloads).
- You can clear all stored data at any time from the extension popup.

## 4. External data transmission

QA Trace does **not** transmit any data externally by default. External transmission occurs **only** when all of the following conditions are met:

1. You have explicitly enabled the LLM or webhook integration in Configuration.
2. You have configured the target endpoint URL and credentials.
3. You have unlocked the credentials with your passphrase.
4. You have explicitly clicked the button to send data.

**LLM integration** (OpenAI, DeepSeek, or a custom OpenAI-compatible endpoint): sends the generated prompt and system instructions to the configured API endpoint. The response is used to generate a structured report.

**Webhook integration:** sends the generated prompt, collected actions and errors, language setting, and timestamp to your configured webhook URL.

QA Trace does not transmit data to any third-party analytics service. The extension contains no telemetry, tracking pixels, or advertising SDKs.

## 5. Credential security

API keys and webhook passwords are encrypted with AES-256-GCM using a key derived via PBKDF2 (SHA-256, 600,000 iterations) from a passphrase you provide. The passphrase itself is never stored. Credentials are decrypted temporarily only when an API request is made.

## 6. Extension permissions

QA Trace requests the following browser permissions:

- **Host permissions** (`https://*/*`, `http://*/*`) — required to inject the content script on web pages. The content script only activates tracking on origins listed in your Allowed URLs configuration in Configuration.
- **storage** — to store collected data and configuration locally.
- **activeTab / tabs** — to read tab URL, title, and ID for session context.
- **webNavigation** — to detect page navigation events.
- **alarms** — to schedule automatic data cleanup.
- **clipboardWrite** — to copy prompts and screenshots to your clipboard.

## 7. Children's privacy

QA Trace is a professional tool intended for QA engineers and software testers. It is not directed at children under 13, and we do not knowingly collect personal information from children.

## 8. Changes to this policy

If this policy is updated, the "Last updated" date at the top will be revised. Continued use of the extension after a policy update constitutes acceptance of the revised policy.

## 9. Contact

If you have questions about this privacy policy or QA Trace's data practices, please open an issue in the project's repository or contact the developer at the email address listed on the extension store listing page.
