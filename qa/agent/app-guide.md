# EIM 360 application guide (context for the AI test agent)

This is the product knowledge a new manual tester is given on day one. It describes how the application is
meant to work (the requirements), not how the current build behaves. Use it to plan the test and to judge
whether what you see is correct.

## Purpose
EIM 360 tracks failed batch-interface jobs (incidents imported from ServiceNow). A SWAT engineer reviews each
incident, approves or corrects the AI predictions, records the resolution steps and closes the incident.
Approved resolution steps can be saved to the Knowledge Base (SWAT KB) so they are recommended next time.

## Roles
SWAT (engineer, can edit incidents), SME (subject-matter expert, can approve), Manager (view only), Admin.
The current role is shown in the top bar. Tests run as SWAT unless the test case says otherwise.

## Screens and routes (hash routes; you may navigate to them directly)
- `#/incidents` Incident Management list. Tabs by status; each row has View and Edit actions.
- `#/incidents/edit/<INCIDENT NUMBER>` Incident Edit page (most test cases happen here).
- `#/incidents/view/<INCIDENT NUMBER>` read-only view of the same incident.
- `#/kb` Interface Knowledge Base (KB recipes per interface + issue category, version, usage count).
- `#/data` Data Explorer (read-only view of the backend tables).

## Incident Edit page
Sections, top to bottom:
1. Incident Basic Information and Interface & IWS Information (including the job log of the failed run).
2. Incident Editable Details:
   - **Worked By** (required to approve): the SWAT engineer working the incident.
   - **AI Review**, three parts:
     1. *Failure Details*: the AI-predicted failure summary. Approve it, or Reject it and type corrected
        failure details (10-500 characters). Incidents without an AI prediction show "No prediction" and need
        the failure details typed in.
     2. *Issue Category*: the AI-predicted category with a confidence. Approve it, or Reject and select the
        corrected category. Choosing a category loads the matching KB recommendation, if one exists.
     3. *Resolution Steps*: if the Knowledge Base has a recipe for this interface + category, its steps are shown
        ("Knowledge Base vN · used N times") with Approve / Reject. Rejecting lets you edit the steps. If there is
        no recipe the page says "No KB match" and you add the steps manually (Add step, one text box per step,
        each at most 300 characters, at most 15 steps; the x button deletes a step).
   - **Resolution Details**: optional free-text comment.
3. Action buttons:
   - *Save Work In Progress*: saves the draft without approving.
     The incident moves to In Progress; nothing is written to the resolution tables.
   - *Approve One Time*: approves the review and stores the resolution for this incident only.
     Incident goes to "Can be Closed".
   - *Approve & Add to KB*: approves and saves the steps as a new KB version for this interface + category
     (or reuses the KB entry if the steps are identical). Incident goes to "Can be Closed".
   - *Approve and Resolve*: approves and closes the incident in one go (status "Closed").
   - Approving requires Worked By, a decision on every AI prediction, valid failure details, a category and at
     least one resolution step; otherwise the page shows "Please correct the highlighted fields." with a message
     under each missing field and nothing is saved.
   - After approval the AI Review is completed and becomes read-only ("Review completed · read-only").
4. Activity: history of actions on the incident.

A short message (toast) appears at the bottom right after each save, for example "Work in progress saved",
"Approved one time", "Incident approved and resolved", "Approved and added to the Knowledge Base".

## Backend tables (SQLite; you have read-only SQL access)
- `incidents`: one row per incident: status, worked_by, ai_predicted_category, failure_details,
  issue_category, review_status, resolution_source, kb_used.
- `swat_kb`: Knowledge Base recipes. kb_key = interface_code|issue_category. Versioned (SCD type 2):
  **only one row per kb_key may have active_flag = 1**; when a new version is added the previous version gets
  active_flag = 0 and an eff_end date. usage_count must increase by 1 each time an incident is approved with
  that KB recipe's steps unchanged. `steps` is a JSON array of step texts.
- `resolution_execution`: the resolution steps actually applied to an incident, written when the review is
  approved (not on Save Work In Progress). One active row per step; re-saving identical steps must not create
  duplicates; changed steps make the old rows inactive (active = 0, eff_end set). step_text must equal
  exactly what the engineer typed, including special characters (' " & \ < > [ ] etc.).
- `incident_task_event`: one row per approval with the final failure details, issue category, number of
  resolution steps, source and approval type (the values synced back to the incident records).
- `interfaces`: interface master data (SME, IWS stream, SLA).

## Test data
Data is reset to the same seed before every test case. Open incidents differ in whether they have an AI
prediction and whether a KB recipe exists for their interface + predicted category; the test data list you are
given says which is which. Pick the incident that fits the test case.
