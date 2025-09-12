// src/LocationContext.js  (REPLACE your current LocationProvider with this)
import React, { createContext, useState, useEffect } from 'react';
import { realtimeDB } from './firebase2';
import { ref, onValue } from 'firebase/database';

export const LocationContext = createContext({
  locations: [],
});

function safeNum(v) {
  if (v === null || v === undefined) return null;
  // if it's already a number and finite, return it
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // try to coerce strings like "14.1234"
  const n = Number(String(v).trim());
  if (Number.isFinite(n)) return n;
  return null;
}

function looksSwapped(lat, lon) {
  // lat must be in [-90, 90]. lon in [-180, 180] normally.
  // if lat is outside plausible lat range but lon looks like a lat, assume swapped.
  if (lat === null || lon === null) return false;
  if (Math.abs(lat) > 90) {
    // definitely wrong: lat out of range => likely swapped
    return true;
  }
  // If lon is small absolute (like 14) while lat is large (like 121) that's likely swapped
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) return true;
  // otherwise not obvious
  return false;
}

export const LocationProvider = ({ children }) => {
  const [locations, setLocations] = useState([]);

  useEffect(() => {
    const devicesRef = ref(realtimeDB, 'devices');
    const unsubscribe = onValue(devicesRef, (snapshot) => {
      const data = snapshot.val() || {};

      const locs = Object.entries(data).map(([id, obj]) => {
        // extract raw values
        const rawLat = obj && Object.prototype.hasOwnProperty.call(obj, 'lat') ? obj.lat : undefined;
        const rawLon = obj && Object.prototype.hasOwnProperty.call(obj, 'lon') ? obj.lon : undefined;

        const latNum = safeNum(rawLat);
        const lonNum = safeNum(rawLon);

        let lat = latNum;
        let lon = lonNum;
        let swapped = false;
        // if both present but lat looks out of range (or other heuristic), swap them
        if (latNum === null && lonNum === null) {
          // no usable coords
        } else if (looksSwapped(latNum, lonNum)) {
          // swap and log
          lat = lonNum;
          lon = latNum;
          swapped = true;
          console.warn(`LocationProvider: detected swapped coords for device=${id}. Swapping lat/lon. rawLat=${rawLat} rawLon=${rawLon} -> lat=${lat} lon=${lon}`);
        }

        // final plausibility check: if lat or lon still invalid, mark them null
        if (lat !== null && (Math.abs(lat) > 90)) {
          console.warn(`LocationProvider: lat out-of-range for device=${id}: ${lat}. Nulling out.`);
          lat = null;
        }
        if (lon !== null && (Math.abs(lon) > 180)) {
          console.warn(`LocationProvider: lon out-of-range for device=${id}: ${lon}. Nulling out.`);
          lon = null;
        }

        // Provide both orders for convenience:
        // - for Leaflet: use markerLatLng = [lat, lon]
        // - for Mapbox/GeoJSON: use markerLngLat = [lon, lat]
        const markerLatLng = (lat !== null && lon !== null) ? [lat, lon] : null;
        const markerLngLat = (lat !== null && lon !== null) ? [lon, lat] : null;

        return {
          id,
          lat,
          lon,
          markerLatLng,
          markerLngLat,
          _raw: { rawLat, rawLon, swapped },
        };
      })
      // Filter out entries without valid coords
      .filter((entry) => entry.lat !== null && entry.lon !== null);

      console.debug("LocationProvider: loaded", locs.length, "locations", locs.slice(0,5));
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
