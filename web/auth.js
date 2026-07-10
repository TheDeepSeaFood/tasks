let _idToken = null;

function initAuth(onSignIn) {
  google.accounts.id.initialize({
    client_id: window.APP_CONFIG.CLIENT_ID,
    callback: function (resp) { _idToken = resp.credential; onSignIn(); }
  });
  google.accounts.id.renderButton(
    document.getElementById('signin'),
    { theme: 'filled_blue', size: 'large', shape: 'pill' }
  );
}

function getIdToken() { return _idToken; }

function signOut() {
  _idToken = null;
  google.accounts.id.disableAutoSelect();
  location.reload();
}
