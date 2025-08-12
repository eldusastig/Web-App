// src/MetricsContext.js
import React, { createContext, useState, useEffect } from 'react';
import mqtt from 'mqtt';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, update, serverTimestamp } from 'firebase/database';

// Create context
export const MetricsContext = createContext({
  fullBinAlerts: null,
  floodRisks: null,
  activeDevices: null,
  devices: [],
});

// Firebase config (replace with env vars if using Vercel)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    // MQTT connection
    const mqttClient = mqtt.connect(process.env.NEXT_PUBLIC_MQTT_BROKER_URL, {
      username: process.env.NEXT_PUBLIC_MQTT_USERNAME,
      password: process.env.NEXT_PUBLIC_MQTT_PASSWORD,
    });

    mqttClient.on('connect', () => {
      console.log('Connected to MQTT broker');
      mqttClient.subscribe('esp32/+/status'); // Listen for device status
    });

    mqttClient.on('message', (topic, message) => {
      const msg = message.toString();
      console.log(`MQTT message: ${topic} => ${msg}`);

      // Extract device ID from topic: esp32/{deviceId}/status
      const parts = topic.split('/');
      if (parts.length >= 3) {
        const deviceId = parts[1];

        if (msg.toLowerCase() === 'offline') {
          console.log(`Device ${deviceId} is offline`);
          update(ref(db, `devices/${deviceId}`), {
            connected: false,
            lastSeen: serverTimestamp(),
          });
        }

        if (msg.toLowerCase() === 'online') {
          console.log(`Device ${deviceId} is online`);
          update(ref(db, `devices/${deviceId}`), {
            connected: true,
            lastSeen: serverTimestamp(),
          });
        }
      }
    });

    return () => {
      mqttClient.end();
    };
  }, []);

  // Listen to devices in Firebase
  useEffect(() => {
    const devicesRef = ref(db, 'devices');
    onValue(devicesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const deviceArray = Object.keys(data).map((key) => ({
        id: key,
        ...data[key],
      }));
      setDevices(deviceArray);
      setActiveDevices(deviceArray.filter((d) => d.connected).length);
    });
  }, []);

  return (
    <MetricsContext.Provider
      value={{ fullBinAlerts, floodRisks, activeDevices, devices }}
    >
      {children}
    </MetricsContext.Provider>
  );
};
