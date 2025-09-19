// src/components/Locations.jsx
import React, {
  useContext,
  useState,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { FiMapPin } from 'react-icons/fi';
import { DeviceContext } from '../DeviceContext';
import { LocationContext } from '../LocationContext'; // <-- use the LocationContext

// icons (same as your original)
const greenIcon = new L.Icon({
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41],
  className: 'leaflet-marker-green',
});
const orangeIcon = new L.Icon({
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41],
  className: 'leaflet-marker-orange',
});
const redIcon = new L.Icon({
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41],
  className: 'leaflet-marker-red',
});
const grayIcon = new L.Icon({
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41],
  className: 'leaflet-marker-gray',
});

function PanToDevice({ selectedDeviceId, devicesToShow, userMovedMap }) {
  const map = useMapEvents({
    dragstart: () => (userMovedMap.current = true),
    zoomstart: () => (userMovedMap.current = true),
  });

  useEffect(() => {
    if (!selectedDeviceId || userMovedMap.current || !map) return;
    const device = devicesToShow.find((d) => d.id === selectedDeviceId);
    if (device && typeof device.lat === 'number' && typeof device.lon === 'number') {
      // nice zoom level (15 is a street-level zoom). 80 in your previous code looked like a typo.
      map.setView([device.lat, device.lon], 15, { animate: true });
    }
  }, [selectedDeviceId, devicesToShow, map]);

  return null;
}

export default function Locations() {
  const { devices: metaDevices } = useContext(DeviceContext); // metadata (may come from firebase or mqtt)
  const { locations } = useContext(LocationContext); // authoritative lat/lon from LocationContext
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [deviceAddresses, setDeviceAddresses] = useState({});
  const [showFlooded, setShowFlooded] = useState(false);
  const [showBinFull, setShowBinFull] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const userMovedMap = useRef(false);

  // build a quick lookup for metadata by id
  const metaById = useMemo(() => {
    const m = new Map();
    (metaDevices || []).forEach((d) => {
      if (d && d.id) m.set(String(d.id), d);
    });
    return m;
  }, [metaDevices]);

  // Merge locations (positions) with metadata
  // locations: [{id, lat, lon, lastSeen}, ...]
  const mergedDevices = useMemo(() => {
    const out = (locations || []).map((loc) => {
      const id = String(loc.id);
      const meta = metaById.get(id) || {};
      return {
        id,
        lat: Number(loc.lat),
        lon: Number(loc.lon),
        lastSeen: loc.lastSeen || null,
        // metadata fallbacks
        flooded: meta.flooded ?? meta.flood ?? false,
        binFull: meta.binFull ?? meta.bin_full ?? meta.fillPct ? (Number(meta.fillPct) >= 90) : (meta.binFull ?? false),
        active: meta.active ?? meta.online ?? true, // assume active if no metadata yet
        name: meta.name ?? meta.label ?? id,
        rawMeta: meta,
      };
    });

    if (process.env.NODE_ENV !== 'production') {
      console.debug('Locations: mergedDevices', out);
      // Also show devices that have meta but no GPS (helpful for debugging)
      const metaWithoutLoc = (metaDevices || []).filter(md => md && md.id && !locations.find(l => String(l.id) === String(md.id)));
      if (metaWithoutLoc.length) console.debug('Locations: meta devices without GPS', metaWithoutLoc);
    }
    return out;
  }, [locations, metaById, metaDevices]);

  // Apply filters (showFlooded / showBinFull / showInactive)
  const devicesToShow = useMemo(() => {
    return mergedDevices.filter((d) => {
      // If ONLY “Inactive” is checked, show devices that are inactive
      if (showInactive && !showFlooded && !showBinFull) {
        return !d.active;
      }
      // If inactive not checked, drop inactive
      if (!showInactive && !d.active) {
        return false;
      }
      // If no flood/bin filters selected, include
      if (!showFlooded && !showBinFull) return true;
      if (showFlooded && d.flooded) return true;
      if (showBinFull && d.binFull) return true;
      return false;
    });
  }, [mergedDevices, showFlooded, showBinFull, showInactive]);

  // reverse‐geocode newly visible devices (cache results)
  useEffect(() => {
    devicesToShow.forEach((device) => {
      const { id, lat, lon } = device;
      if (!lat || !lon) return;
      if (deviceAddresses[id]) return; // already fetched
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
      // throttle / polite usage: don't hammer OSM - you might want to add rate-limiting
      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          const address = data.display_name || 'Unknown location';
          setDeviceAddresses((prev) => ({ ...prev, [id]: address }));
        })
        .catch((err) => {
          console.warn('Reverse geocode failed for', id, err);
          setDeviceAddresses((prev) => ({ ...prev, [id]: 'No address found' }));
        });
    });
  }, [devicesToShow, deviceAddresses]);

  // initial map center (use first visible device)
  const initialCenter = useMemo(() => {
    if (devicesToShow.length > 0) {
      return [devicesToShow[0].lat, devicesToShow[0].lon];
    }
    // fallback to a reasonable center if you prefer your city
    return [0, 0];
  }, [devicesToShow]);

  const initialZoom = useMemo(() => (devicesToShow.length > 0 ? 15 : 2), [devicesToShow]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <FiMapPin /> Device Locations
      </div>

      <div style={styles.filterContainer}>
        <label style={styles.filterLabel}>
          <input
            type="checkbox"
            checked={showFlooded}
            onChange={(e) => setShowFlooded(e.target.checked)}
          />{' '}
          Flooded
        </label>

        <label style={styles.filterLabel}>
          <input
            type="checkbox"
            checked={showBinFull}
            onChange={(e) => setShowBinFull(e.target.checked)}
          />{' '}
          Bin Full
        </label>

        <label style={styles.filterLabel}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />{' '}
          Inactive
        </label>
      </div>

      <div style={styles.mapWrapper}>
        <MapContainer
          center={initialCenter}
          zoom={initialZoom}
          scrollWheelZoom={true}
          style={{ height: '400px', width: '100%' }}
          whenCreated={() => {
            userMovedMap.current = false;
          }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {devicesToShow.map((device) => {
            const address = deviceAddresses[device.id];
            let iconToUse = greenIcon;
            if (device.flooded) iconToUse = redIcon;
            else if (device.binFull) iconToUse = orangeIcon;
            else if (!device.active) iconToUse = grayIcon;

            return (
              <Marker
                key={device.id}
                position={[device.lat, device.lon]}
                icon={iconToUse}
                eventHandlers={{
                  click: () => setSelectedDeviceId(device.id),
                }}
              >
                <Popup>
                  <b>{device.name || device.id}</b>
                  <br />
                  {address
                    ? address
                    : `${device.lat.toFixed(6)}, ${device.lon.toFixed(6)}`}
                  <br />
                  Flooded: {device.flooded ? 'Yes' : 'No'}
                  <br />
                  Bin Full: {device.binFull ? 'Yes' : 'No'}
                  <br />
                  Active: {device.active ? 'Yes' : 'No'}
                </Popup>
              </Marker>
            );
          })}

          <PanToDevice
            selectedDeviceId={selectedDeviceId}
            devicesToShow={devicesToShow}
            userMovedMap={userMovedMap}
          />
        </MapContainer>
      </div>

      <div style={styles.listWrapper}>
        <h3 style={styles.listHeader}>Connected Devices</h3>
        {devicesToShow.length === 0 ? (
          <p style={styles.emptyText}>No devices to show.</p>
        ) : (
          <ul style={styles.deviceList}>
            {devicesToShow.map((device) => (
              <li
                key={device.id}
                style={{
                  ...styles.listItem,
                  backgroundColor:
                    device.id === selectedDeviceId ? '#EEF2F7' : 'white',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={styles.deviceName}>{device.name || device.id}</span>
                <button
                  style={styles.viewButton}
                  onClick={() => {
                    userMovedMap.current = false;
                    setSelectedDeviceId(device.id);
                  }}
                >
                  📍 View
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// styles are same as your original file
const styles = {
  container: {
    padding: '20px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    marginLeft: '30px',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
  },
  header: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  filterContainer: {
    marginBottom: '12px',
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
  },
  filterLabel: {
    fontSize: '14px',
    color: '#333',
  },
  mapWrapper: {
    marginBottom: '16px',
  },
  listWrapper: {
    maxHeight: '200px',
    overflowY: 'auto',
    borderTop: '1px solid #e2e8f0',
    paddingTop: '12px',
  },
  listHeader: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    borderBottom: '1px solid #ccc',
    paddingBottom: '4px',
  },
  deviceList: {
    listStyleType: 'none',
    padding: 0,
    margin: 0,
  },
  listItem: {
    padding: '8px 12px',
    borderBottom: '1px solid #e2e8f0',
    cursor: 'pointer',
    color: 'black',
  },
  deviceName: {
    fontWeight: '600',
    color: 'black',
  },
  viewButton: {
    backgroundColor: '#3182ce',
    color: 'white',
    border: 'none',
    padding: '4px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  emptyText: {
    color: '#777',
    fontStyle: 'italic',
  },
};
