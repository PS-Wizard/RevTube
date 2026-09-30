import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Firestore WebChannel streaming often breaks on Firefox (NS_BINDING_* on Listen/channel).
// Auto-detect does not always switch before the first failing request -- force long polling
// for Firefox by default. Other browsers use auto-detect unless FORCE is set.
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isFirefox = /firefox/i.test(ua) && !/seamonkey|iceweasel/i.test(ua);
const preferWebChannel =
  import.meta.env.VITE_FIRESTORE_PREFER_WEB_CHANNEL === '1' ||
  import.meta.env.VITE_FIRESTORE_PREFER_WEB_CHANNEL === 'true';
const forceLongPollEnv =
  import.meta.env.VITE_FIRESTORE_FORCE_LONG_POLLING === '1' ||
  import.meta.env.VITE_FIRESTORE_FORCE_LONG_POLLING === 'true';

const useForceLongPolling =
  !preferWebChannel && (forceLongPollEnv || isFirefox);

// Initialize Cloud Firestore and get a reference to the service
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  ...(useForceLongPolling
    ? { experimentalForceLongPolling: true }
    : { experimentalAutoDetectLongPolling: true }),
});

// Configure Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});
