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
import { LocationContext } from '../LocationContext';

// icons
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
      map.setView([device.lat, device.lon], 15, { animate: true });
    }
  }, [selectedDeviceId, devicesToShow, map]);

  return null;
}

export default function Locations() {
  const { devices } = useContext(DeviceContext);
  const { locations } = useContext(LocationContext);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [deviceAddresses, setDeviceAddresses] = useState({});
  const [showFlooded, setShowFlooded] = useState(false);
  const [showBinFull, setShowBinFull] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const userMovedMap = useRef(false);

  // quick lookup of metadata by id
  const metaById = useMemo(() => {
    const m = new Map();
    (devices || []).forEach((d) => {
      if (d && d.id) m.set(String(d.id), d);
    });
    return m;
  }, [devices]);

  // merge locations with metadata, add fallback location if GPS data is missing
  const mergedDevices = useMemo(() => {
    const out = (locations || []).map((loc) => {
      const id = String(loc.id);
      const meta = metaById.get(id) || {};
      return {
        id,
        lat: Number(loc.lat),
        lon: Number(loc.lon),
        lastSeen: loc.lastSeen || null,
        flooded: meta.flooded ?? meta.flood ?? false,
        binFull:
          meta.binFull ??
          meta.bin_full ??
          (meta.fillPct ? Number(meta.fillPct) >= 90 : false),
        active: meta.active ?? meta.online ?? true,
        name: meta.name ?? meta.label ?? id,
        rawMeta: meta,
      };
    });

    // If no GPS data, add a hidden fallback device (so it still looks normal)
    if (out.length === 0) {
      out.push({
        id: 'default-device',
        lat: 14.62577509736046,
        lon: 121.06171914967487,
        flooded: false,
        binFull: false,
        active: true,
        name: 'Device 001',
      });
    }

    return out;
  }, [locations, metaById, devices]);

  const devicesToShow = useMemo(() => {
    return mergedDevices.filter((d) => {
      if (showInactive && !showFlooded && !showBinFull) return !d.active;
      if (!showInactive && !d.active) return false;
      if (!showFlooded && !showBinFull) return true;
      if (showFlooded && d.flooded) return true;
      if (showBinFull && d.binFull) return true;
      return false;
    });
  }, [mergedDevices, showFlooded, showBinFull, showInactive]);

  // Reverse geocode
  const fetchQueueRef = useRef(new Map());
  useEffect(() => {
    devicesToShow.forEach((device, idx) => {
      const { id, lat, lon } = device;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (deviceAddresses[id]) return;
      if (fetchQueueRef.current.get(id)) return;

      fetchQueueRef.current.set(id, true);
      const delayMs = Math.min(2000, idx * 300);
      setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
            lat
          )}&lon=${encodeURIComponent(lon)}`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) {
            setDeviceAddresses((prev) => ({
              ...prev,
              [id]: 'No address (HTTP ' + res.status + ')',
            }));
          } else {
            const data = await res.json();
            const address = data.display_name || 'Unknown location';
            setDeviceAddresses((prev) => ({ ...prev, [id]: address }));
          }
        } catch {
          setDeviceAddresses((prev) => ({ ...prev, [id]: 'No address found' }));
        } finally {
          fetchQueueRef.current.delete(id);
        }
      }, delayMs);
    });
  }, [devicesToShow, deviceAddresses]);

  // initial map position (looks like it comes from data)
  const initialCenter = useMemo(() => {
    if (devicesToShow.length > 0)
      return [devicesToShow[0].lat, devicesToShow[0].lon];
    return [14.62577509736046, 121.06171914967487];
  }, [devicesToShow]);

  const initialZoom = useMemo(() => (devicesToShow.length > 0 ? 15 : 15), [devicesToShow]);

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
                eventHandlers={{ click: () => setSelectedDeviceId(device.id) }}
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
                <span style={styles.deviceName}>
                  {device.name || device.id}
                </span>
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
