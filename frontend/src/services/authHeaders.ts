import { auth } from '../config/firebase';

/**
 * Resolve the current Firebase user, waiting for the initial auth state to be
 * restored from the browser session. `auth.currentUser` is null in the window
 * right after page load before onAuthStateChanged fires, so any request fired
 * then would drop the auth header and get a 401 from the backend. authStateReady
 * resolves once the auth state has settled, so this helper returns a real user
 * (or throws) instead of a transient null.
 */
async function resolveCurrentUser() {
  const stateReady = (auth as { authStateReady?: () => Promise<void> }).authStateReady;
  if (typeof stateReady === 'function') {
    try {
      await stateReady.call(auth);
    } catch {
      /* readiness is best-effort -- fall through to a direct read */
    }
  }
  return auth.currentUser;
}

export const getFirebaseAuthHeader = async (): Promise<Record<string, string>> => {
  const user = await resolveCurrentUser();
  if (!user) {
    throw new Error('Not authenticated');
  }

  const token = await user.getIdToken();
  return { 'X-Firebase-Token': token };
};

/**
 * Resolve the raw Firebase ID token.
 *
 * Used as a bearer-token *placeholder* for organization-owned channel reads.
 * The backend authenticates via `X-Firebase-Token`, and `resolveOrgToken`
 * overrides the `Authorization` header with the org channel's YouTube token
 * whenever `X-Org-Id` is present. That means a member without their own
 * personal YouTube token (e.g. a `reader`) still gets correct org-channel data,
 * because the placeholder is replaced server-side before hitting the API.
 */
export const getFirebaseIdToken = async (): Promise<string> => {
  const headers = await getFirebaseAuthHeader();
  return headers['X-Firebase-Token'];
};

