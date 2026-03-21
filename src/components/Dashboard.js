// src/components/Dashboard.jsx
import React, { useContext, useMemo, useEffect, useRef } from 'react';
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
  const { fullBinAlerts, floodRisks, activeDevices } = useContext(MetricsContext);
  const { locations } = useContext(LocationContext) || { locations: [] };

  const displayValue = (val) => (val === null ? 'Loading…' : val);

  // Filter + normalize coords — stable shape for markers
  const devicesWithCoords = useMemo(() => {
    return (locations || []).filter((d) => {
      const lat = Number(d.lat);
      const lon = Number(d.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
      if (lat === 0 && lon === 0) return false;
      return true;
    }).map(d => ({ ...d, lat: Number(d.lat), lon: Number(d.lon) }));
  }, [locations]);

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
                  <b>{d.id}</b>
                  <br />
                  Last seen: {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—'}
                  <br />
                  Address: {d.address ?? '—'}
                  <br />
                  Fill: {d.fillPct != null ? `${d.fillPct}%` : '—'}
                  <br />
                  {d.flooded && <span style={{ color: '#3B82F6' }}>🌊 Flood Risk</span>}
                  {d.binFull && <span style={{ color: '#F59E0B' }}>⚠️ Bin Full</span>}
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
