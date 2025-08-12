// src/MetricsContext.js
import React, { createContext, useState, useEffect, useRef } from "react";
import mqtt from "mqtt";
import { getDatabase, ref, onValue } from "firebase/database";
import { firebaseApp } from "./firebase"; // make sure firebase.js exports firebaseApp

export const MetricsContext = createContext({
  fullBinAlerts: 0,
  floodRisks: 0,
  activeDevices: 0,
  devices: [],
});

export const MetricsProvider = ({ children }) => {
  const [fullBinAlerts, setFullBinAlerts] = useState(0);
  const [floodRisks, setFloodRisks] = useState(0);
  const [activeDevices, setActiveDevices] = useState(0);
  const [devices, setDevices] = useState([]);

  const db = getDatabase(firebaseApp);
  const debounceTimer = useRef(null);

  // Listen to Firebase DB for device updates
  useEffect(() => {
    const devicesRef = ref(db, "devices");

    const unsubscribe = onValue(devicesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const deviceList = Object.keys(data).map((id) => ({
        id,
        ...data[id],
      }));

      // Apply debouncing to avoid flickering
      clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        const activeCount = deviceList.filter(
          (d) => d.status === 1 || d.status === true
        ).length;

        const binAlerts = deviceList.filter((d) => d.fullBinAlert === true).length;
        const floods = deviceList.filter((d) => d.floodRisk === true).length;

        setDevices(deviceList);
        setActiveDevices(activeCount);
        setFullBinAlerts(binAlerts);
        setFloodRisks(floods);
      }, 500); // wait 0.5s before applying changes
    });

    return () => {
      unsubscribe();
      clearTimeout(debounceTimer.current);
    };
  }, [db]);

  return (
    <MetricsContext.Provider
      value={{
        fullBinAlerts,
        floodRisks,
        activeDevices,
        devices,
      }}
    >
      {children}
    </MetricsContext.Provider>
  );
};
