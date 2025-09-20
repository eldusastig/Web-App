// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
