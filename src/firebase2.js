
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {

  apiKey: "AIzaSyDNRAlGi6IuUw2S9NL-0d7vmZbDfuGAeWI",

  authDomain: "mqtt-database-4c5ce.firebaseapp.com",

  databaseURL: "https://mqtt-database-4c5ce-default-rtdb.asia-southeast1.firebasedatabase.app",

  projectId: "mqtt-database-4c5ce",

  storageBucket: "mqtt-database-4c5ce.firebasestorage.app",

  messagingSenderId: "479417931412",

  appId: "1:479417931412:web:fca043ea719a506e834681",

  measurementId: "G-4BMG25HCRE"


};
const app = initializeApp(firebaseConfig);
// ✅ Initialize Auth and Database
const auth = getAuth(app);
const realtimeDB = getDatabase(app);
// ✅ Sign in anonymously
signInAnonymously(auth).catch((error) => {
  console.error('Firebase Auth Error:', error.message);
});
// ✅ Export for use in other files
export { auth, realtimeDB };


