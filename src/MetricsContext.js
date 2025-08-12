// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { realtimeDB } from './firebase'; // ✅ shared DB instance
import { ref, onValue, update } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

export const MetricsContext = createContext({
  fullBinAlerts: null,
  floodRisks: null,
  activeDevices: null,
  devices: [],
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts]   = useState(0);
  const [floodRisks, setFloodRisks]         = useState(0);
  const [activeDevices, setActiveDevices]   = useState(0);
  const [devices, setDevices]               = useState([]);
  const [authReady, setAuthReady]           = useState(false);

  const debounceTimerRef  = useRef(null);
  const activeDeviceIdRef = useRef(null);
  const clientRef         = useRef(null);

  // ✅ Firebase anonymous auth
  useEffect(() => {
    const auth = getAuth();
    signInAnonymously(auth)
      .catch(err => console.error('Auth error:', err));

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) {
        console.log('✅ Authenticated as', user.uid);
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  // ✅ Listen to devices data
  useEffect(() => {
    if (!authReady) return;

    const devicesRef = ref(realtimeDB, 'devices');
    const unsubscribe = onValue(devicesRef, snap => {
      const data = snap.val() || {};
      const deviceList = Object.entries(data).map(([id, vals]) => ({
        id,
        ...vals,
      }));

      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setDevices(deviceList);
        setActiveDevices(deviceList.filter(d => d.status === 1 || d.status === true).length);
        setFullBinAlerts(deviceList.filter(d => d.fullBinAlert === true).length);
        setFloodRisks(deviceList.filter(d => d.floodRisk === true).length);
      }, 500); // debounce delay
    });

    return () => {
      unsubscribe();
      clearTimeout(debounceTimerRef.current);
    };
  }, [authReady]);

  // ✅ MQTT connect (placeholder if needed later)
  const connectMqtt = (deviceId) => {
    if (clientRef.current) {
      clientRef.current.end(true);
    }
    // same MQTT logic as in your second snippet...
  };

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
