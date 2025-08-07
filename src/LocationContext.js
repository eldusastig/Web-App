
import React, { createContext, useState, useEffect } from 'react';
import { realtimeDB } from './firebase';
import { ref, onValue } from 'firebase/database';

export const LocationContext = createContext({
  locations: [],
});

export const LocationProvider = ({ children }) => {
  const [locations, setLocations] = useState([]);

  // Subscribe to /devices to extract lat/lon for map pins
  useEffect(() => {
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubscribe = onValue(devicesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const locs = Object.entries(data)
        .filter(([, obj]) => typeof obj.lat === 'number' && typeof obj.lon === 'number')
        .map(([id, obj]) => ({ id, lat: obj.lat, lon: obj.lon }));
      setLocations(locs);
    });
    return () => unsubscribe();
  }, []);

  return (
    <LocationContext.Provider value={{ locations }}>
      {children}
    </LocationContext.Provider>
  );
};
  