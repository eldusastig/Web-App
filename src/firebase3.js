// firebase3.js (v9 modular)
// Initializes Firebase app, Database and Auth. Signs in anonymously (dev/test) and logs status.
// Safe to import from multiple modules — it will reuse existing app if already initialized.

import { initializeApp, getApps } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// Your web app's Firebase configuration (you provided this earlier)
const firebaseConfig = {
  apiKey: "AIzaSyCPC5X4d4_gVvxa1805HypyiCBhZTvS6Lk",
  authDomain: "mqtt-firebase-46be7.firebaseapp.com",
  databaseURL: "https://mqtt-firebase-46be7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mqtt-firebase-46be7",
  storageBucket: "mqtt-firebase-46be7.firebasestorage.app",
  messagingSenderId: "307123873990",
  appId: "1:307123873990:web:8a38e3634ddbb8aa658fc7",
  measurementId: "G-P1267TGVCX"
};

// initialize or reuse existing app
let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  console.debug('[firebase3] initializeApp: new app created');
} else {
  app = getApps()[0];
  console.debug('[firebase3] initializeApp: using existing app');
}

// exports
export const database = getDatabase(app);
export const auth = getAuth(app);

// sign in anonymously for dev/test (ignore if already signed in)
signInAnonymously(auth)
  .then(() => {
    console.debug('[firebase3] signInAnonymously: request succeeded (check onAuthStateChanged for final user)');
  })
  .catch(err => {
    // Common reasons: anonymous auth disabled in console, network issue
    console.error('[firebase3] signInAnonymously failed', err && err.message ? err.message : err);
  });

// log auth state changes
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.debug('[firebase3] onAuthStateChanged -> signed in anonymously as uid=', user.uid);
  } else {
    console.debug('[firebase3] onAuthStateChanged -> signed out');
  }
});

// Final sanity log so you can confirm file executed and exports are present
console.debug('[firebase3] module loaded — exports:', {
  databasePresent: !!database,
  authPresent: !!auth,
  appName: app?.name ?? '(unknown)'
});

// Optionally export app if other modules want it
export default app;
