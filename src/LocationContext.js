// src/LocationContext.js

import React, { createContext, useState } from 'react';

// Each entry in `locations` is { id: string, lat: number, lon: number }
export const LocationContext = createContext({
  locations: [],         // array of device locations
  setLocations: () => {}, // setter to replace the entire array
  addOrUpdateDevice: () => {}, // helper to add/update a single device
});

export const LocationProvider = ({ children }) => {
  const [locations, setLocations] = useState([]);

  // Call this whenever a new { id, lat, lon } arrives from MQTT
  const addOrUpdateDevice = (newDevice) => {
    setLocations((prev) => {
      const idx = prev.findIndex((d) => d.id === newDevice.id);
      if (idx >= 0) {
        // update existing
        const updated = [...prev];
        updated[idx] = newDevice;
        return updated;
      } else {
        // add new
        return [...prev, newDevice];
      }
    });
  };

  return (
    <LocationContext.Provider value={{ locations, setLocations, addOrUpdateDevice }}>
      {children}
    </LocationContext.Provider>
  );
};
