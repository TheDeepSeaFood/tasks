/**
 * Pure permission logic. No spreadsheet access here so it stays unit-testable
 * (see Tests.gs). Visibility is driven entirely by the org hierarchy.
 */

/** Emails a viewer may see: self + all descendants, or everyone if admin. */
function visibleEmails(viewerEmail, edges, usersById) {
  const viewer = usersById[viewerEmail] || {};
  if (viewer.itManagerGroup || viewer.superDev) return Object.keys(usersById);

  const childrenOf = {};
  edges.forEach(function (e) {
    (childrenOf[e.parentEmail] = childrenOf[e.parentEmail] || []).push(e.childEmail);
  });

  const seen = {};
  const stack = [viewerEmail];
  while (stack.length) {
    const cur = stack.pop();
    if (seen[cur]) continue;
    seen[cur] = true;
    (childrenOf[cur] || []).forEach(function (c) { stack.push(c); });
  }
  return Object.keys(seen);
}

/** A task is visible if its assigner or assignee is in the viewer's visible set. */
function canSeeTask(task, visibleSet) {
  return !!(visibleSet[task.AssignerEmail] || visibleSet[task.AssigneeEmail]);
}
