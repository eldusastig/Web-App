
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {

  apiKey: "AIzaSyAdne2cQVkg1qANSfbFVQbYgw_gkbk_r-w",

  authDomain: "mqtt-database-239f3.firebaseapp.com",

  databaseURL: "https://mqtt-database-239f3-default-rtdb.asia-southeast1.firebasedatabase.app",

  projectId: "mqtt-database-239f3",

  storageBucket: "mqtt-database-239f3.firebasestorage.app",

  messagingSenderId: "381498661089",

  appId: "1:381498661089:web:f7f52b70ef29ed24b73fa0",

  measurementId: "G-58T66X8VP3"

};x
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
