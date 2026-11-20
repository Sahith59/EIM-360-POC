# EIM 360 · AI Test Agent POC (Playwright)

A working mock of the **EIM 360 Incident Management module**, plus an **AI + Playwright** test agent for it:

1. **AI writes the tests.** An LLM turned each of the 127 manual test cases (102 from the client's TS_REGRESSION.xlsx) into a Playwright test; an engineer reviewed them, and they live in `tests/specs`. New cases can be drafted with `npm run ai:draft`.
2. **Playwright runs them** in Chrome, in parallel, with a screenshot after every UI step.
3. **AI triages every failure.** Rules collect the evidence; the LLM you configure (Gemini, Claude, OpenAI, Azure OpenAI or a local model) reads it together with the failure screenshot and drafts the root cause, next steps and defect report.
4. **A person stays in control.** A QA lead approves, edits or rejects each AI root cause before a defect is raised, and approves each AI-written test before it counts.

> The mock is modelled on the EIM 360 walkthrough and screenshots, but it is **not** the client application. All names, interface codes and data are fictional.

## Run it

Requires Node 20+ and Google Chrome (or set `PW_CHANNEL=chromium` and run `npx playwright install chromium`).

```bash
npm install
npm start                 # app on http://localhost:4360
npm test                  # runs the 127-case suite (starts its own isolated app instances)
```

Then open **http://localhost:4360/#/qa/runs** to see the run.

## Connect an LLM (Gemini or any other provider)

Without a key everything still runs; triage then uses rules and analyst notes only, and the run page says so.

1. Copy the template: `cp .env.example .env` (Windows: `copy .env.example .env`). The `.env` file sits next to `package.json` and is git-ignored.
2. Open `.env` and set the provider and key, for Gemini:
   ```
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=your-key-here
   ```
   Other providers: `anthropic` (`ANTHROPIC_API_KEY`), `openai` (`OPENAI_API_KEY`), `azure` (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`), `local` for Ollama, LM Studio, vLLM or any OpenAI-compatible server (`LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`). `LLM_MODEL` overrides the default model (Gemini: `gemini-3.5-flash`).
3. Check it answers: `npm run llm:check`
4. Run the suite: `npm test`. After the tests finish, the reporter sends each failure's evidence and screenshot to the LLM (3 at a time) and prints how many were analysed, the tokens and the cost.
5. Review the AI root causes in the app (each failure page: **Approve**, **Edit** or **Reject**; tick *Apply to all cases with this cause* to review a group at once). Managers have view-only access, so switch role in Site Management if needed.
6. Summarise the run: `npm run metrics` writes `qa/runs/<id>/metrics.md` and `metrics.json`. Share that file for the business case.

Never paste the key into chat, code or a commit.

| Command | What it does |
|---|---|
| `npm start` | Starts the release-candidate build `2.4.1-rc1` |
| `npm run start:fixed` | Starts the corrected build `2.4.1` (the seeded issues removed) |
| `npm test` | Runs the suite against `2.4.1-rc1`. It finishes with 13 failures from 4 root causes and a non-zero exit code, which is expected: those are the seeded issues |
| `npm run test:fixed` | Runs the suite against `2.4.1`, where all four seeded issues are removed |
| `npm run llm:check` | Checks the LLM configured in `.env` answers |
| `npm run metrics` | Writes a summary of the latest run (tests, time, screenshots, LLM tokens and cost, human review) |
| `npm run ai:draft -- REG-012` | The LLM drafts a Playwright test for a catalog case into `tests/drafts/` for an engineer to review |
| `npm run ai:draft:test` | Runs the drafts in `tests/drafts/` (they are not part of the suite until moved to `tests/specs`) |
| `node scripts/with-env.js WORKERS=1 npm test` | Runs one test at a time (useful for timing comparisons) |
| `node scripts/with-env.js PW_CHANNEL=chromium npm test` | Uses Playwright's bundled Chromium instead of Chrome (`npx playwright install chromium` first) |

## What's in the app

**Incident Management**, following the walkthrough:
- Home summary, JobHub (IWS job streams), Incident Dashboard (30-day trend, manager and category breakdown)
- **Incident List**: status tabs, Update from ServiceNow, search, sort, paging, column chooser, Excel/CSV/PDF/Copy export, resolution-progress tracker, P1–P3 flags, SME (Onshore)
- **Edit / View Incident** with the **AI Review** workflow: approve or reject (with correction) the predicted Failure Details, Issue Category and Resolution Steps; add, edit and delete steps; Save Work In Progress, Approve One Time, Approve & Add to KB (SCD2 versioning, usage counter), Approve and Resolve; read-only once the review is complete
- **Incident Resolution Hub** (SME review queue), Reporting, Interfaces List, Interface Knowledge Base, IFG Reports
- **Site Management**: a non-production *View as role* switch (SWAT, SME, Manager, Admin)
- **Interface Edit**: assign onshore and offshore SMEs; shown on every SWAT KB entry
- **Data Explorer**: read-only view of the SWAT_KB (with version history), resolution execution and incident task event tables

**Quality Engineering** (the POC):
- **AI Test Runs**: every run with Passed, Failed and In Review results, step screenshots, the Playwright trace for each failure, and triage. In Review means an AI-written test no one has approved yet. Once an engineer approves it in the app, it counts as Passed
- **AI triage summary** on each run: which LLM analysed the failures, tokens, cost, time, agreement with the rules, and how many AI root causes a person has approved, edited or rejected
- **Human review of AI root causes**: Approve, Edit or Reject on each failure page (optionally for the whole group). The defect report can only be copied or downloaded after the root cause is approved or edited, and uses the reviewer's text
- **Failure triage** for each failure: a classification (product defect, test-script problem or environment), root cause, affected code, evidence, next steps, a suggested fix and a draft defect report you can copy or download. For a renamed control it also gives a *locator repair suggestion*: it finds the matching control on the live page and proposes the corrected test line, which a person then applies. Each field shows its source (Rules, Analyst note or LLM)
- **Test Case Catalog**: all 127 test cases with their client references, each mapped to its automated test
- **Manual Timing**: a stopwatch a tester uses to time manual execution
- **Manual vs AI**: the measured AI run time against manual time, plus weekly and nightly projections to the ~300-case inventory. Manual time is a 10-minute-per-case planning estimate (as in the business case) until testers record real timings

## Test suites

`tests/catalog.json` holds 127 test cases:
- **102 client cases** from `TS_REGRESSION.xlsx`: Smoke (15), Regression (30), Must Do (30) and Combinations (27). Each keeps its client reference (TC_xx), and has one Playwright test in `tests/specs/client-*.spec.js`. Shared page objects and flows are in `tests/lib/`.
- **25 POC cases** covering the incident list, ServiceNow sync, roles, the Resolution Hub, dashboard, reports and the knowledge base.

## Seeded issues (be transparent when you demo)

To show detection and triage, build `2.4.1-rc1` contains four **deliberately seeded** issues:

| ID | Issue | Caught by |
|---|---|---|
| N1 | Backslashes are stripped from saved resolution steps | MST-24, MST-25 |
| N2 | Editing a KB step with Approve & Add to KB leaves the previous version active (SCD2) | SMK-15, REG-019, REG-028, MST-20, CMB-25, CMB-26 |
| N3 | KB usage counter not incremented with Approve One Time | REG-018, MST-18 |
| UI2 | "Save Work In Progress" renamed to "Save Draft" (test-script maintenance, not a defect) | SMK-10, REG-010, MST-10 |

The run page groups the 13 failures into these 4 root causes. `npm run test:fixed` runs the corrected build.

While the suite was being written, it also caught bugs in this mock (not in the client application), which were then fixed.

## How the triage works

`qa/triage.js` runs in three layers; `qa/llm.js` is the provider-neutral LLM client:
1. **Rules** (always on, deterministic, no AI model). Classifies the failure from the error type, collects expected vs. actual, the failing step and its screenshot, searches the source for the strings the test relies on, and scores the controls on the live page by word overlap to suggest a locator repair.
2. **Analyst notes** (`qa/known-issues.json`). The detailed root causes and product fixes for the four seeded issues were written by Claude after investigating the first run. They are reused only when a later failure matches the same check and values. Say this when you demo: the issues were seeded, their write-ups were prepared once, and on a live run the engine matches them and adds fresh evidence.
3. **LLM pass** (when `.env` configures a provider). The model gets the manual test case, the Playwright step log, the error, expected vs. actual, the code references, the controls on the page and the **screenshot taken when the step failed**, and returns its own classification, root cause, affected component, confidence, next steps and defect title. It does **not** see the analyst notes; the rules/analyst-note view is shown next to it for comparison, with an Agrees/Differs flag. Every field shows its source (Rules, Analyst note or LLM), and the AI root cause stays a draft until a person reviews it.

`LLM_PROVIDER=mock` is an offline stand-in used to test the pipeline without a key; its answers are canned and must never be quoted.

## Numbers you can quote

- The LLM side is **measured** too once a provider is configured: `npm run metrics` reports failures analysed, tokens, cost, time per failure and the human review outcome.
- The AI side is **measured**: run duration, per-test time, steps and screenshots come from `qa/runs/<id>/run.json`. The headline time is wall-clock on 4 parallel workers; the page also shows the back-to-back total. The mock answers faster than the real application will.
- The manual side is **measured only after testers record timings** on the Manual Timing page. Until then, the comparison uses a clearly labelled 10-minute planning estimate per case.

## Layout

```
server/        Node HTTP server (no dependencies) + seeded data
public/        Front end (plain ES modules, Lucide icons under the ISC licence)
tests/         catalog.json (manual test cases), Playwright config, fixtures, specs
qa/            reporter.js, triage.js, llm.js (providers), ai-draft-test.js, metrics.js, known-issues.json, runs/<id>/
tests/drafts/  AI-drafted tests awaiting engineer review
data/          manual timings, test approvals and root-cause reviews saved from the app (git-ignored; delete to reset)
.env           your LLM provider and key (git-ignored; template in .env.example)
```
