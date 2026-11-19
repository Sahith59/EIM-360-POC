# EIM 360 · AI Test Agent POC (Playwright)

A working mock of the **EIM 360 Incident Management module**, plus an AI-assisted test suite for it. Claude (an AI agent) wrote one Playwright test for each of the 127 test cases (102 from the client's TS_REGRESSION.xlsx); the tests were reviewed once and are stored in `tests/specs`. The suite runs in Chrome and captures a screenshot after every UI step. Each failure is then triaged: it gets a classification, evidence, next steps, a suggested fix where one can be derived, and a draft defect report.

> The mock is modelled on the EIM 360 walkthrough and screenshots, but it is **not** the client application. All names, interface codes and data are fictional.

## Run it

Requires Node 20+ and Google Chrome (or set `PW_CHANNEL=chromium` and run `npx playwright install chromium`).

```bash
npm install
npm start                 # app on http://localhost:4360
npm test                  # runs the 127-case suite (starts its own isolated app instances)
```

Then open **http://localhost:4360/#/qa/runs** to see the run.

| Command | What it does |
|---|---|
| `npm start` | Starts the release-candidate build `2.4.1-rc1` |
| `npm run start:fixed` | Starts the corrected build `2.4.1` (the seeded issues removed) |
| `npm test` | Runs the suite against `2.4.1-rc1`. It finishes with 13 failures from 4 root causes and a non-zero exit code, which is expected: those are the seeded issues |
| `npm run test:fixed` | Runs the suite against `2.4.1`, where all four seeded issues are removed |
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
- **Failure triage** for each failure: a classification (product defect, test-script problem or environment), root cause, affected code, evidence, next steps, a suggested fix and a draft defect report you can copy or download. For a renamed control it also gives a *locator repair suggestion*: it finds the matching control on the live page and proposes the corrected test line, which a person then applies. Each field shows its source (Rules, Analyst note or LLM)
- **Test Case Catalog**: all 127 test cases with their client references, each mapped to its automated test
- **Manual Timing**: a stopwatch a tester uses to time manual execution
- **Manual vs AI**: the measured AI run time against manual time, plus weekly and nightly projections to the ~300-case inventory. Manual time is a 5-minute-per-case planning estimate until testers record real timings

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

`qa/triage.js` runs in three layers:
1. **Rules** (always on, deterministic, no AI model). Classifies the failure from the error type, collects expected vs. actual, the failing step and its screenshot, searches the source for the strings the test relies on, and scores the controls on the live page by word overlap to suggest a locator repair.
2. **Analyst notes** (`qa/known-issues.json`). The detailed root causes and product fixes for the four seeded issues were written by Claude after investigating the first run. They are reused only when a later failure matches the same check and values. Say this when you demo: the issues were seeded, their write-ups were prepared once, and on a live run the engine matches them and adds fresh evidence.
3. **Optional LLM pass**. Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) and Claude writes the root cause, next steps and a summary from each failure's evidence. It is off by default, and the page states which sources were used. Test it before a live demo, or leave the key unset.

## Numbers you can quote

- The AI side is **measured**: run duration, per-test time, steps and screenshots come from `qa/runs/<id>/run.json`. The headline time is wall-clock on 4 parallel workers; the page also shows the back-to-back total. The mock answers faster than the real application will.
- The manual side is **measured only after testers record timings** on the Manual Timing page. Until then, the comparison uses a clearly labelled 5-minute planning estimate per case.

## Layout

```
server/        Node HTTP server (no dependencies) + seeded data
public/        Front end (plain ES modules, Lucide icons under the ISC licence)
tests/         catalog.json (manual test cases), Playwright config, fixtures, specs
qa/            reporter.js, triage.js, known-issues.json, runs/<id>/ (results, screenshots, traces, HTML report)
data/          manual timings and test approvals saved from the app (delete the files to reset after rehearsals)
```
