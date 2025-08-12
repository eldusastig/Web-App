// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { getDatabase, ref, onValue, update } from 'firebase/database';
import { firebaseApp } from './firebase'; // ✅ Import your existing Firebase config

export const MetricsContext = createContext({
  fullBinAlerts: null,
  floodRisks: null,
  activeDevices: null,
  devices: [],
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices] = useState([]);
  const mqttClient = useRef(null);

  const db = getDatabase(firebaseApp);

  useEffect(() => {
    // Listen to devices in Firebase
    const devicesRef = ref(db, 'devices');
    onValue(devicesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const deviceList = Object.entries(data).map(([id, details]) => ({
        id,
        ...details,
      }));
      setDevices(deviceList);

      // Count active devices
      const activeCount = deviceList.filter((d) => d.connected).length;
      setActiveDevices(activeCount);
    });

    // ✅ MQTT connection
    mqttClient.current = mqtt.connect('ws://broker.hivemq.com:8000/mqtt');

    mqttClient.current.on('connect', () => {
      console.log('MQTT connected');
      mqttClient.current.subscribe('esp32/+/status'); // Listen for device status updates
    });

    mqttClient.current.on('message', (topic, message) => {
      const payload = message.toString();
      const [, deviceId, ] = topic.split('/');

      if (topic.endsWith('/status')) {
        if (payload === 'offline') {
          // ✅ Update device as disconnected in Firebase
          update(ref(db, `devices/${deviceId}`), { connected: false, lastSeen: Date.now() });
        } else if (payload === 'online') {
          update(ref(db, `devices/${deviceId}`), { connected: true, lastSeen: Date.now() });
        }
      }
    });

    return () => {
      if (mqttClient.current) {
        mqttClient.current.end();
      }
    };
  }, [db]);

  return (
    <MetricsContext.Provider value={{ fullBinAlerts, floodRisks, activeDevices, devices }}>
      {children}
    </MetricsContext.Provider>
  );
};
