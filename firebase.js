// src/firebase.js
import { initializeApp } from 'firebase/app';   // ✅ import initializeApp
import { getDatabase } from 'firebase/database'; // ✅ import getDatabase

// Replace with your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDNRAlGi6IuUw2S9NL-0d7vmZbDfuGAeWI",
  authDomain: "mqtt-database-4c5ce.firebaseapp.com",
  databaseURL: "https://mqtt-database-4c5ce-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "mqtt-database-4c5ce",
  storageBucket: "mqtt-database-4c5ce.firebasestorage.app",
  messagingSenderId: "479417931412",
  appId: "1:479417931412:web:fca043ea719a506e834681",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export the Realtime Database instance
export const realtimeDB = getDatabase(app);
