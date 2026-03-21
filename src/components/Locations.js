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

// ─── Inject dark popup styles to match Dashboard ──────────────────────────────
const locationPopupFix = document.createElement('style');
locationPopupFix.textContent = `
  .leaflet-popup { z-index: 1000 !important; }
  .leaflet-popup-content-wrapper {
    background: #1E293B !important;
    color: #E2E8F0 !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
  }
  .leaflet-popup-tip {
    background: #1E293B !important;
  }
  .leaflet-popup-content {
    margin: 12px 16px !important;
    font-size: 0.875rem !important;
    line-height: 1.6 !important;
  }
  .leaflet-container a.leaflet-popup-close-button {
    color: #94A3B8 !important;
  }
`;
if (!document.getElementById('location-popup-fix')) {
  locationPopupFix.id = 'location-popup-fix';
  document.head.appendChild(locationPopupFix);
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const greenIcon = new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41], className: 'leaflet-marker-green',
});
const orangeIcon = new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41], className: 'leaflet-marker-orange',
});
const redIcon = new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41], className: 'leaflet-marker-red',
});
const grayIcon = new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  shadowSize: [41, 41], className: 'leaflet-marker-gray',
});

// ─── PanToDevice ──────────────────────────────────────────────────────────────
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

// ─── Locations ────────────────────────────────────────────────────────────────
export default function Locations() {
  const { devices } = useContext(DeviceContext);
  const { locations } = useContext(LocationContext);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [deviceAddresses, setDeviceAddresses] = useState({});
  const [showFlooded, setShowFlooded] = useState(false);
  const [showBinFull, setShowBinFull] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const userMovedMap = useRef(false);
  const fetchQueueRef = useRef(new Map());

  // quick lookup of metadata by id
  const metaById = useMemo(() => {
    const m = new Map();
    (devices || []).forEach((d) => { if (d && d.id) m.set(String(d.id), d); });
    return m;
  }, [devices]);

  // merge authoritative locations with device metadata
  const mergedDevices = useMemo(() => {
    return (locations || []).map((loc) => {
      const id = String(loc.id);
      const meta = metaById.get(id) || {};
      return {
        id,
        lat: Number(loc.lat),
        lon: Number(loc.lon),
        lastSeen: loc.lastSeen || null,
        flooded: meta.flooded ?? meta.flood ?? false,
        binFull: meta.binFull ?? meta.bin_full ?? (meta.fillPct ? (Number(meta.fillPct) >= 90) : false),
        active: meta.active ?? meta.online ?? true,
        name: meta.name ?? meta.label ?? id,
        rawMeta: meta,
      };
    });
  }, [locations, metaById, devices]);

  // apply filters
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

  // Reverse geocode — same staggered pattern as Dashboard
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
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) {
            setDeviceAddresses(prev => ({ ...prev, [id]: 'No address (HTTP ' + res.status + ')' }));
          } else {
            const data = await res.json();
            setDeviceAddresses(prev => ({ ...prev, [id]: data.display_name || 'Unknown location' }));
          }
        } catch (err) {
          setDeviceAddresses(prev => ({ ...prev, [id]: 'No address found' }));
        } finally {
          fetchQueueRef.current.delete(id);
        }
      }, delayMs);
    });
  }, [devicesToShow, deviceAddresses]);

  const initialCenter = useMemo(() => {
    if (devicesToShow.length > 0) return [devicesToShow[0].lat, devicesToShow[0].lon];
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
          <input type="checkbox" checked={showFlooded} onChange={(e) => setShowFlooded(e.target.checked)} />{' '}
          Flooded
        </label>
        <label style={styles.filterLabel}>
          <input type="checkbox" checked={showBinFull} onChange={(e) => setShowBinFull(e.target.checked)} />{' '}
          Bin Full
        </label>
        <label style={styles.filterLabel}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />{' '}
          Inactive
        </label>
      </div>

      <div style={styles.mapWrapper}>
        <MapContainer
          center={initialCenter}
          zoom={initialZoom}
          scrollWheelZoom={true}
          style={{ height: '400px', width: '100%' }}
          whenCreated={() => { userMovedMap.current = false; }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {devicesToShow.map((device) => {
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
                  {/* ─── Popup styled to match Dashboard ─── */}
                  <div style={{ minWidth: '180px', fontSize: '0.875rem', lineHeight: '1.7' }}>
                    <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '1rem' }}>
                      {device.name || device.id}
                    </div>
                    <div style={{ marginBottom: '6px', color: '#94A3B8', fontSize: '0.78rem' }}>
                      {deviceAddresses[device.id]
                        ? deviceAddresses[device.id]
                        : `${device.lat.toFixed(6)}, ${device.lon.toFixed(6)}`}
                    </div>
                    <div>🌊 Flooded: <strong>{device.flooded ? 'Yes' : 'No'}</strong></div>
                    <div>⚠️ Bin Full: <strong>{device.binFull ? 'Yes' : 'No'}</strong></div>
                    <div>📶 Active: <strong>{device.active ? 'Yes' : 'No'}</strong></div>
                    <div style={{ marginTop: '6px', color: '#64748B', fontSize: '0.75rem' }}>
                      Last seen: {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '—'}
                    </div>
                  </div>
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
                  backgroundColor: device.id === selectedDeviceId ? '#EEF2F7' : 'white',
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

// ─── Styles ───────────────────────────────────────────────────────────────────
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
