/** Ekta Transport: session verification (no fake localStorage tokens). */
(function () {
  async function requireOwnerSession() {
    const client = window.supabaseClient;
    if (!client?.auth) {
      console.error('Supabase client unavailable.');
      location.replace('index.html');
      return false;
    }
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user || user.user_metadata?.ekta_role !== 'owner') {
      location.replace('index.html');
      return false;
    }
    return true;
  }
  async function handleLogout() {
    try { await window.supabaseClient?.auth.signOut(); }
    finally {
      localStorage.removeItem('ekta_auth_token');
      localStorage.removeItem('ekta_user_role');
      localStorage.removeItem('ekta_user_id');
      location.replace('index.html');
    }
  }
  window.EktaAuth = { requireOwnerSession, handleLogout };
  window.handleLogout = handleLogout;
})();
