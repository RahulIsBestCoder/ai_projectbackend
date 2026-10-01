# QA reporter classification

The QA / Testing department exposes a per-project Manager/QA selector on its card and in View department. The classification is analytical only; it does not change account roles or Taiga permissions. Existing reporters default to QA.

`PUT /v1/projects/:projectId/qa-reporters/:reporterId/role`

Body: `{ "reporting_role": "qa" }` or `{ "reporting_role": "manager" }`. URL-encode the reporter ID returned by the department API. The endpoint requires authentication and existing project access, validates that the reporter belongs to the project, and upserts `qa_reporter_roles` using a deterministic project/reporter primary key. Subsequent Taiga syncs do not overwrite this classification.

Both department reads return `tasks: { created, closed }`. These count Taiga tasks created by the listed reporters, with `closed` counting those currently closed; Taiga issues are excluded from these two counts. Managers remain included in these activity counts.

QA efficiency is explicitly labeled **QA closure rate**: currently closed reported tasks/issues divided by total reported tasks/issues. It is not individual productivity or hours-based efficiency. Managers contribute neither numerator nor denominator; their employee `efficiency` is null and `efficiency_eligible` is false. If everyone is excluded, the department percentage is null, not zero. Multi-project reads apply each project's saved role independently.

Validation: `node node_modules/ts-node/dist/bin.js --transpile-only src/scripts/verify_qa_reporting.ts`. Uses an in-memory database stub; it does not modify live records.
