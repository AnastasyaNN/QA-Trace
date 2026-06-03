# QA Trace: Use Cases for QA Engineers

## What This Extension Does

QA Trace captures real user interactions and runtime failures during exploratory testing, then turns that data into:
- reproducible ticket-ready steps,
- structured exploratory testing reports,
- and clean documentation flows.

It tracks actions and errors in chronological context and lets QA choose the scope before generating prompts.

## How It Helps During Testing

- **Cuts bug-reporting time:** Action timeline + captured errors are pre-assembled into ticket structure.
- **Improves reproducibility:** Steps are derived from tracked interactions, not memory.
- **Preserves real context:** Data includes tab/page context, timestamps, selectors, and related failures.
- **Handles noisy sessions:** QA can mark expected errors and exclude them from generated prompts.
- **Supports multiple reporting outputs:** One captured session can produce ticket steps, full report, and documentation.
- **Works in real exploratory flow:** No need to switch tools while testing; tracking runs in-page and popup summarizes instantly.

## Core Capabilities

### 1) User Action Tracking
- Captures `click`, `dblclick`, `input`, `change`, plus `open_tab` and `reload_tab`.
- Tracks element type, selector, entered value (passwords masked), label text, timestamp, and tab info.
- Stores recent actions with configurable limits.

### 2) Error Monitoring
- **Console errors**
- **Network errors**
- **UI errors** by configurable CSS selectors (default includes `div[id^="__error"]`)
- Shows in-page toast when issues appear, and stores them for later report generation.
- For UI errors, attempts to capture a screenshot and attach it to the error record.

### 3) Network Request Tracking (Optional, Per URL)
- Enable **Track all network requests** for a specific allowed origin to record every `fetch`/`XHR` call, not just failures.
- Captures method, URL, status, request/response headers, and bodies — with the same sensitive-data redaction used for network errors.
- Stored separately from errors, with a configurable limit (default 150 most recent requests).
- The popup shows the most recent requests below Recent Errors; copy any single request as JSON, or **Download all** stored requests as a `.txt` file for attaching to tickets.

### 4) Smart Scope Controls Before Generation
- Choose mode:
  - **Steps to Reproduce for Ticket**
  - **Document Steps**
  - **Full Report of Actions**
- Select all tabs or only selected tracked tabs.
- Limit by actions count (steps/document modes) or time window (full mode).
- Mark expected errors to exclude from ticket prompts.
- Add custom "unexpected behavior" even when technical errors were not captured.

### 5) Integration Outputs
- Generate prompt and copy manually.
- Send prompt directly to configured LLM (if LLM integration is enabled).
- Trigger external webhook pipeline (if webhook integration is enabled).
- Response is normalized into JSON shape with `summary` and `description` (for LLM and webhook integrations).

## Practical QA Use Cases

### 1. Fast Bug Ticket Creation During Exploratory Testing
**Scenario:** Tester finds a defect and needs a clear Jira ticket quickly.

**How to use:**
1. Reproduce issue in allowed URL scope.
2. Open extension popup -> **Get Prompt**.
3. Select **Steps to Reproduce for Ticket**.
4. Keep relevant tab scope, actions count, and uncheck expected errors.
5. Generate and send to LLM (or copy prompt manually).

**Value:** Reduces manual rewrite; produces concise summary + structured reproduction steps.

### 2. Documenting a Happy Path Without Errors
**Scenario:** QA needs reusable documentation for a stable user flow.

**How to use:**
1. Execute target flow.
2. Open **Get Prompt** -> choose **Document Steps**.
3. Select actions scope and generate.

**Value:** Creates neutral process documentation from actual interaction history.

### 3. End-of-Session Exploratory Report
**Scenario:** After a charter session, QA must provide a high-level report.

**How to use:**
1. Open **Get Prompt** -> choose **Full Report of Actions**.
2. Set time window (for example last 90 minutes).
3. Generate prompt and send/copy.

**Value:** Produces broad session narrative with tested areas and detected issues. The output follows the style of [Xray](https://www.getxray.app/) exploratory testing session reports.

### 4. Filtering Known/Expected Errors
**Scenario:** Console noise exists and should not pollute ticket output.

**How to use:**
1. In **Steps** mode, open **Expected Errors**.
2. Mark known errors or select **All errors are expected**.
3. Generate prompt.

**Value:** Keeps bug tickets focused on real regressions.

### 5. Capturing "No Stack Trace" UX Defects
**Scenario:** UI behavior is wrong but no console/network error is available.

**How to use:**
1. Fill **Unexpected Behavior (Optional)** in Steps mode.
2. Generate prompt.

**Value:** QA can still create structured defect report from observed behavior.

### 6. Multi-Tab Business Flows
**Scenario:** Defect appears only when moving between tabs/screens.

**How to use:**
1. Reproduce flow across tabs.
2. In prompt config, include all tabs or pick specific tab IDs.
3. Generate ticket/full report.

**Value:** Maintains tab-by-tab context that is often lost in manual notes.

### 7. Team Automation via Webhook
**Scenario:** Team has custom backend to enrich/store generated reports.

**How to use:**
1. Configure webhook URL (+ optional basic auth).
2. Generate prompt and click **Trigger Webhook**.

**Value:** Fits existing QA/dev workflows and external pipelines without changing test habits.

### 8. Inspecting API Traffic Behind a Defect
**Scenario:** A UI bug looks like it stems from bad/missing API data, and you need the actual requests to share with developers.

**How to use:**
1. Enable **Track all network requests** for the origin under test in Configuration.
2. Reproduce the flow.
3. Open the popup, review the recent requests below Recent Errors, and copy a specific one as JSON — or **Download all** to attach the full traffic log to the ticket.

**Value:** Gives developers the real request/response context (with sensitive data redacted) instead of a vague "the data looked wrong."

## Recommended QA Workflow

1. Configure allowed test origins, monitoring types, optional full network tracking, and URL redaction settings.
2. Run exploratory session normally.
3. Open popup to quickly verify action/error counts.
4. Choose output mode based on target artifact (ticket/document/full report).
5. Review generated prompt, then copy or send to LLM or webhook.
6. Copy output into Jira/Xray/Confluence as needed.

## Key Benefits

- Less manual note-taking overhead during testing.
- Better defect quality with higher reproduction reliability.
- Faster handoff to developers (clear summary + sequence).
- Reusable evidence for audits, retesting, and regression packs.
- Flexible output path: manual copy, direct LLM, or webhook automation.

