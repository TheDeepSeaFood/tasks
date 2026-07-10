/** Editor-run tests for the pure permission logic. Run and check the log. */

function test_verify_rejects_garbage() {
  try {
    verifyIdToken('not-a-real-token');
    throw new Error('FAIL: expected rejection');
  } catch (e) {
    if (e.message.indexOf('FAIL') === 0) throw e;
    Logger.log('PASS: garbage token rejected (%s)', e.message);
  }
}

function test_visibleEmails_subtree() {
  const edges = [
    { parentEmail: 'boss@x', childEmail: 'coord@x' },
    { parentEmail: 'coord@x', childEmail: 'amal@x' },
    { parentEmail: 'boss@x', childEmail: 'it@x' }
  ];
  const usersById = {
    'boss@x':  { email: 'boss@x' }, 'coord@x': { email: 'coord@x' },
    'amal@x':  { email: 'amal@x' }, 'it@x':    { email: 'it@x' }
  };
  const seen = visibleEmails('coord@x', edges, usersById).sort();
  const expect = ['amal@x', 'coord@x'].sort();
  if (JSON.stringify(seen) !== JSON.stringify(expect)) throw new Error('FAIL got ' + JSON.stringify(seen));

  const all = visibleEmails('boss@x', edges, usersById);
  if (all.indexOf('it@x') < 0 || all.indexOf('amal@x') < 0) throw new Error('FAIL boss missing reports');
  Logger.log('PASS: visibleEmails subtree');
}

function test_visibleEmails_admin_sees_all() {
  const edges = [{ parentEmail: 'boss@x', childEmail: 'coord@x' }];
  const usersById = {
    'boss@x':  { email: 'boss@x' }, 'coord@x': { email: 'coord@x' },
    'root@x':  { email: 'root@x', itManagerGroup: true }
  };
  const all = visibleEmails('root@x', edges, usersById).sort();
  if (all.length !== 3) throw new Error('FAIL admin should see all 3, got ' + all.length);
  Logger.log('PASS: admin sees all');
}

function test_all() {
  test_visibleEmails_subtree();
  test_visibleEmails_admin_sees_all();
  Logger.log('ALL PURE TESTS PASSED');
}
