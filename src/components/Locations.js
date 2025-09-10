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

// ───────────────
// 1) Define four custom Leaflet icons (using CSS classes to recolor the default marker).
//    You can tweak these CSS filters or adjust iconUrl if you have custom PNGs.
// ───────────────
const greenIcon = new L.Icon({
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41],
  className: 'leaflet-marker-green', // apply a green filter via CSS
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

// ───────────────
// 2) PanToDevice helper: inside MapContainer, it listens for drag/zoom events
//    and automatically pans/zooms to the selected device only if the user hasn’t moved the map.
// ───────────────
function PanToDevice({ selectedDeviceId, devicesToShow, userMovedMap }) {
  const map = useMapEvents({
    dragstart: () => (userMovedMap.current = true),
    zoomstart: () => (userMovedMap.current = true),
  });

  useEffect(() => {
    if (!selectedDeviceId || userMovedMap.current || !map) return;
    const device = devicesToShow.find((d) => d.id === selectedDeviceId);
    if (
      device &&
      typeof device.lat === 'number' &&
      typeof device.lon === 'number'
    ) {
      map.setView([device.lat, device.lon], 80);
    }
  }, [selectedDeviceId, devicesToShow, map]);

  return null;
}

// ───────────────
// 3) Main Locations component
// ───────────────
export default function Locations() {
  const { devices } = useContext(DeviceContext);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [deviceAddresses, setDeviceAddresses] = useState({});
  const [showFlooded, setShowFlooded] = useState(false);
  const [showBinFull, setShowBinFull] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const userMovedMap = useRef(false);

  // 3a) Filter out anything without valid lat/lon
  const gpsDevices = useMemo(
    () =>
      devices.filter(
        (d) =>
          typeof d.lat === 'number' &&
          typeof d.lon === 'number'
      ),
    [devices]
  );

  // 3b) Build final list based on checkboxes:
  const devicesToShow = useMemo(() => {
    return gpsDevices.filter((d) => {
      // (A) If ONLY “Inactive” is checked:
      if (showInactive && !showFlooded && !showBinFull) {
        return !d.active;
      }
      // (B) If “Inactive” not checked, drop inactive immediately:
      if (!showInactive && !d.active) {
        return false;
      }
      // (C) Now if no Flooded/BinFull selected, accept (we passed A and B):
      if (!showFlooded && !showBinFull) {
        return true;
      }
      // (D) If Flooded is checked and this device is flooded:
      if (showFlooded && d.flooded) {
        return true;
      }
      // (E) If BinFull is checked and this device’s bin is full:
      if (showBinFull && d.binFull) {
        return true;
      }
      // Otherwise, exclude:
      return false;
    });
  }, [gpsDevices, showFlooded, showBinFull, showInactive]);

  // 3c) Reverse‐geocode any newly visible device
  useEffect(() => {
    devicesToShow.forEach((device) => {
      const { id, lat, lon } = device;
      if (deviceAddresses[id]) return; // already fetched
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          const address = data.display_name || 'Unknown location';
          setDeviceAddresses((prev) => ({
            ...prev,
            [id]: address,
          }));
        })
        .catch(() => {
          setDeviceAddresses((prev) => ({
            ...prev,
            [id]: 'No address found',
          }));
        });
    });
  }, [devicesToShow, deviceAddresses]);

  // 3d) Compute initial center/zoom
  const initialCenter = useMemo(() => {
    if (devicesToShow.length > 0) {
      return [devicesToShow[0].lat, devicesToShow[0].lon];
    }
    return [0, 0];
  }, [devicesToShow]);

  const initialZoom = useMemo(() => {
    return devicesToShow.length > 0 ? 15 : 2;
  }, [devicesToShow]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <FiMapPin /> Device Locations
      </div>

      {/* ─── Filters ──────────────────────────────────────────────────── */}
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

      {/* ─── Map ──────────────────────────────────────────────────────── */}
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
            if (device.flooded) {
              iconToUse = redIcon;
            } else if (device.binFull) {
              iconToUse = orangeIcon;
            } else if (!device.active) {
              iconToUse = grayIcon;
            }

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
                  <b>{device.id}</b>
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

      {/* ─── Device List ───────────────────────────────────────────────────────── */}
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
                <span style={styles.deviceName}>{device.id}</span>
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

// ────────────────────────────────────────────────────────────────────────────────
// 4) Styles Object
// ────────────────────────────────────────────────────────────────────────────────
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
