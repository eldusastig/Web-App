import React, { createContext, useState, useEffect } from 'react';
import { realtimeDB } from './firebase2';
import { ref, onValue } from 'firebase/database';

export const LocationContext = createContext({
  locations: [],
});

function normalizeLatLon(latRaw, lonRaw) {
  // Try convert to numbers
  const a = Number(latRaw);
  const b = Number(lonRaw);
  if (!isFinite(a) || !isFinite(b)) return null;

  // Valid ranges
  const latValid = Math.abs(a) <= 90;
  const lonValid = Math.abs(b) <= 180;

  // If lat is invalid but lon looks like a valid latitude -> they were probably swapped
  const swappedLikely = (!latValid && Math.abs(b) <= 90);

  if (swappedLikely) {
    return { lat: b, lon: a };
  }

  // Otherwise assume as-is
  return { lat: a, lon: b };
}

export const LocationProvider = ({ children }) => {
  const [locations, setLocations] = useState([]);

  // Subscribe to /devices to extract lat/lon for map pins
  useEffect(() => {
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubscribe = onValue(devicesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const locs = Object.entries(data)
        .map(([id, obj]) => {
          // handle numbers or numeric strings safely and auto-correct swapped coordinates
          const normalized = normalizeLatLon(obj.lat, obj.lon);
          if (!normalized) return null;
          return { id, lat: normalized.lat, lon: normalized.lon };
        })
        .filter(Boolean);
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
