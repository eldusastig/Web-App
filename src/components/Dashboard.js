// src/components/Dashboard.jsx
import React, { useContext, useMemo, useEffect, useRef, useState } from 'react';
import { FiTrash2, FiPlusCircle, FiWifi } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';
import { LocationContext } from '../LocationContext';
import { MetricsContext } from '../MetricsContext';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';

// --- Leaflet CSS + default icon fix ---
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
});
// --- end leaflet fixes ---

// ✅ Fix: ensure Leaflet popups always render above everything else
// Aphrodite can sometimes stomp Leaflet's z-index — this guarantees popup visibility
const leafletPopupFix = document.createElement('style');
leafletPopupFix.textContent = `
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
if (!document.getElementById('leaflet-popup-fix')) {
  leafletPopupFix.id = 'leaflet-popup-fix';
  document.head.appendChild(leafletPopupFix);
}

// ─── Inner component: pans map when first device coords arrive ───────────────
// This lives INSIDE MapContainer so it has access to the map instance.
// It only flies to the first valid location once — never again after that.
const MapAutoCenter = ({ devicesWithCoords }) => {
  const map = useMap();
  const hasCenteredRef = useRef(false);

  useEffect(() => {
    if (hasCenteredRef.current) return;
    if (devicesWithCoords.length === 0) return;

    const first = devicesWithCoords[0];
    map.flyTo([first.lat, first.lon], 13, { animate: true, duration: 1 });
    hasCenteredRef.current = true;
  }, [devicesWithCoords, map]);

  return null;
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
const Dashboard = () => {
  const { fullBinAlerts, floodRisks, activeDevices, devices } = useContext(MetricsContext);
  const { locations } = useContext(LocationContext) || { locations: [] };

  // address cache: id -> address string
  const [deviceAddresses, setDeviceAddresses] = useState({});
  const fetchQueueRef = useRef(new Map());

  const displayValue = (val) => (val === null ? 'Loading…' : val);

  // quick lookup of live device metadata (online, name, etc.) by id
  const metaById = useMemo(() => {
    const m = new Map();
    (devices || []).forEach((d) => { if (d && d.id) m.set(String(d.id), d); });
    return m;
  }, [devices]);

  // Filter + normalize coords and merge with MetricsContext metadata
  const devicesWithCoords = useMemo(() => {
    return (locations || []).filter((d) => {
      const lat = Number(d.lat);
      const lon = Number(d.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
      if (lat === 0 && lon === 0) return false;
      return true;
    }).map(d => {
      const meta = metaById.get(String(d.id)) || {};
      return {
        ...d,
        lat: Number(d.lat),
        lon: Number(d.lon),
        name: meta.name ?? meta.label ?? d.id,
        flooded: meta.flooded ?? d.flooded ?? false,
        binFull: meta.binFull ?? d.binFull ?? false,
        active: meta.online ?? meta.active ?? true,
      };
    });
  }, [locations, metaById]);

  // Reverse geocode each visible device — same pattern as Locations.jsx
  useEffect(() => {
    devicesWithCoords.forEach((device, idx) => {
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
  }, [devicesWithCoords, deviceAddresses]);

  return (
    <div className={css(styles.dashboardContainer)}>
      {/* ─── Top‐row Widgets ──────────────────────────────────────────────────── */}
      <div className={css(styles.widgetGrid)}>
        <Widget
          icon={<FiTrash2 />}
          title="Full Bin Alerts"
          value={`${displayValue(fullBinAlerts)} Alert${fullBinAlerts === 1 ? '' : 's'}`}
        />
        <Widget
          icon={<FiPlusCircle />}
          title="Flood Risk"
          value={`${displayValue(floodRisks)} Alert${floodRisks === 1 ? '' : 's'}`}
        />
        <Widget
          icon={<FiWifi />}
          title="Active Devices"
          value={`${displayValue(activeDevices)} Device${activeDevices === 1 ? '' : 's'}`}
        />
      </div>

      {/* ─── Main Content Grid ────────────────────────────────────────────────── */}
      <div className={css(styles.mainGrid)}>

        {/* ─── Stable Map — NO key prop, mounts once, never remounts ───────────── */}
        <div className={css(styles.mapOverview)}>
          <h2 style={{ color: 'white', marginBottom: '16px' }}>Device Map</h2>

          <MapContainer
            // ✅ No key prop — map instance is stable and never remounted
            center={[0, 0]}
            zoom={2}
            scrollWheelZoom={true}
            style={{ height: '70vh', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {/* Smoothly pans to first device once coords arrive */}
            <MapAutoCenter devicesWithCoords={devicesWithCoords} />

            {devicesWithCoords.map((d) => (
              <Marker key={d.id} position={[d.lat, d.lon]}>
                <Popup>
                  <div style={{ minWidth: '180px', fontSize: '0.875rem', lineHeight: '1.7' }}>
                    <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '1rem' }}>
                      {d.name || d.id}
                    </div>
                    <div style={{ marginBottom: '6px', color: '#94A3B8', fontSize: '0.78rem' }}>
                      {deviceAddresses[d.id]
                        ? deviceAddresses[d.id]
                        : `${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}`}
                    </div>
                    <div>🌊 Flooded: <strong>{d.flooded ? 'Yes' : 'No'}</strong></div>
                    <div>⚠️ Bin Full: <strong>{d.binFull ? 'Yes' : 'No'}</strong></div>
                    <div>📶 Active: <strong>{d.active ? 'Yes' : 'No'}</strong></div>
                    <div style={{ marginTop: '6px', color: '#64748B', fontSize: '0.75rem' }}>
                      Last seen: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—'}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* ─── Side Panel: Real‐Time Alerts ─────────────────────────────────────── */}
        <div className={css(styles.sidePanel)}>
          <div className={css(styles.realTimeAlerts)}>
            <h2>Real‐Time Alerts</h2>
            {(() => {
              const realTimeAlerts = [];
              (locations || []).forEach((d) => {
                if (d.binFull) realTimeAlerts.push(`⚠️ Bin Full at Device ${d.id}`);
                if (d.flooded) realTimeAlerts.push(`🌊 Flood Risk Detected at Device ${d.id}`);
              });
              return realTimeAlerts.length > 0 ? (
                <ul className={css(styles.alertsList)}>
                  {realTimeAlerts.map((msg, idx) => (
                    <li key={idx}>{msg}</li>
                  ))}
                </ul>
              ) : (
                <p>No current alerts</p>
              );
            })()}
          </div>
        </div>

      </div>
    </div>
  );
};

// ─── Widget ───────────────────────────────────────────────────────────────────
const Widget = ({ icon, title, value }) => (
  <div className={css(styles.widget)}>
    <div className={css(styles.widgetIcon)}>{icon}</div>
    <div className={css(styles.widgetText)}>
      <p className={css(styles.widgetTitle)}>{title}</p>
      <p className={css(styles.widgetValue)}>{value}</p>
    </div>
  </div>
);

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  dashboardContainer: {
    flex: 1,
    padding: '24px',
    overflow: 'auto',
    backgroundColor: '#0F1B34',
  },
  widgetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '24px',
  },
  widget: {
    backgroundColor: '#1E293B',
    padding: '24px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    cursor: 'pointer',
  },
  widgetIcon: {
    fontSize: '36px',
    color: '#3B82F6',
  },
  widgetText: {
    color: 'white',
  },
  widgetTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    margin: 0,
  },
  widgetValue: {
    fontSize: '0.875rem',
    margin: 0,
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: '32px',
    marginTop: '32px',
  },
  mapOverview: {
    backgroundColor: '#1E293B',
    padding: '24px',
    borderRadius: '12px',
    color: 'white',
    // ✅ allow Leaflet popups to render outside the card boundary
    overflow: 'visible',
  },
  sidePanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  realTimeAlerts: {
    backgroundColor: '#1E293B',
    padding: '24px',
    borderRadius: '12px',
    color: 'white',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
  },
  alertsList: {
    listStyleType: 'none',
    paddingLeft: '0',
    marginTop: '12px',
    fontSize: '0.95rem',
    lineHeight: '1.6',
    color: '#E2E8F0',
  },
});

export default Dashboard;
