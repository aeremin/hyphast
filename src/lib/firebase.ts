import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyC6N6M6FOh8obJo11YBGdoXceWaXMXhh-s',
  authDomain: 'hyphast-946ea.firebaseapp.com',
  projectId: 'hyphast-946ea',
  storageBucket: 'hyphast-946ea.firebasestorage.app',
  messagingSenderId: '874773237429',
  appId: '1:874773237429:web:c47f068abc23e1ee53b8fc',
});

// `npm run dev:emulators` talks to the local Firebase emulators instead of production.
const useEmulators = import.meta.env.VITE_EMULATORS === 'true';

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Offline cache: edits show up instantly and sync when back online.
export const db = initializeFirestore(app, {
  localCache: useEmulators
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  // For automated UI tests: the auth emulator accepts unsigned Google ID tokens.
  Object.assign(window, {
    emulatorSignIn: (email: string, name = email) =>
      signInWithCredential(
        auth,
        GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name })),
      ),
  });
}
