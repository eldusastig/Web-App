// src/DeviceContext.js
import React, { createContext, useState, useEffect } from 'react';
import { realtimeDB } from './firebase';
import { ref, onValue } from 'firebase/database';

export const DeviceContext = createContext({ devices: [] });

export const DeviceProvider = ({ children }) => {
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    const devicesRef = ref(realtimeDB, 'devices');
    console.log("VERSION 3.2.1 - new deploy");
    console.log('🔌 DeviceContext: subscribing to /devices');
    const unsubscribe = onValue(devicesRef, (snapshot) => {
      const data = snapshot.val();
      console.log('🔌 [DeviceContext] snapshot.val():', data);
      const list = data
        ? Object.entries(data).map(([id, vals]) => ({ id, ...vals }))
        : [];
      console.log('🔌 [DeviceContext] parsed list:', list);
      setDevices(list);
    }, (error) => {
      console.error('❌ [DeviceContext] onValue error:', error);
    });

    return () => {
      console.log('🔌 DeviceContext: unsubscribing from /devices');
      unsubscribe();
    };
  }, []);

  return (
    <DeviceContext.Provider value={{ devices }}>
      {children}
    </DeviceContext.Provider>
  );
};

