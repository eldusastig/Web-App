// src/components/Dashboard.jsx
import React, { useContext, useMemo } from 'react';
import { FiTrash2, FiPlusCircle, FiWifi } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';
// Use LocationContext (clean coords) instead of raw DeviceContext
import { LocationContext } from '../LocationContext';
import { MetricsContext } from '../MetricsContext';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

// --- Leaflet CSS + default icon fix (important for markers to display) ---
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

// ensure default icon images are set for common bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
});
// --- end leaflet fixes ---

const Dashboard = () => {
  const { fullBinAlerts, floodRisks, activeDevices } = useContext(MetricsContext);
  // locations are guaranteed to have valid lat/lon by LocationContext
  const { locations } = useContext(LocationContext) || { locations: [] };

  const displayValue = (val) => (val === null ? 'Loading…' : val);

  // Defensive: ensure we only use finite numeric coords and reject 0,0 placeholders
  const devicesWithCoords = useMemo(() => {
    return (locations || []).filter((d) => {
      const lat = Number(d.lat);
      const lon = Number(d.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
      // treat exact (0,0) as invalid placeholder
      if (lat === 0 && lon === 0) return false;
      return true;
    }).map(d => ({ ...d, lat: Number(d.lat), lon: Number(d.lon) }));
  }, [locations]);

  // compute initial center; prefer most recently seen device with coords
  const { initialCenter, initialZoom } = useMemo(() => {
    if (devicesWithCoords.length > 0) {
      // devices are already sorted by lastSeen in LocationContext.flushLocations,
      // but just pick the first valid one here.
      const first = devicesWithCoords[0];
      return {
        initialCenter: [first.lat, first.lon],
        initialZoom: 13,
      };
    }
    // global fallback
    return { initialCenter: [0, 0], initialZoom: 2 };
  }, [devicesWithCoords]);

  return (
    <div className={css(styles.dashboardContainer)}>
      {/* ─── Top‐row Widgets ────────────────────────────────────────────────────── */}
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
        {/* ─── Pannable Map with Device Pins ──────────────────────────────────── */}
        <div className={css(styles.mapOverview)}>
          <h2 style={{ color: 'white', marginBottom: '16px' }}>Device Map</h2>

          <MapContainer
            // key forces re-init when center changes (helps when locations arrive after mount)
            key={initialCenter.join(',')}
            center={initialCenter}
            zoom={initialZoom}
            scrollWheelZoom={true}
            style={{ height: '70vh', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

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
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* ─── Side Panel: Real‐Time Alerts ────────────────────────────────────── */}
        <div className={css(styles.sidePanel)}>
          <div className={css(styles.realTimeAlerts)}>
            <h2>Real‐Time Alerts</h2>
            {(() => {
              const realTimeAlerts = [];
              // use the cleaned locations/metadata if available, otherwise show nothing
              (locations || []).forEach((d) => {
                if (d.binFull) {
                  realTimeAlerts.push(`⚠️ Bin Full at Device ${d.id}`);
                }
                if (d.flooded) {
                  realTimeAlerts.push(`🌊 Flood Risk Detected at Device ${d.id}`);
                }
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

const Widget = ({ icon, title, value }) => (
  <div className={css(styles.widget)}>
    <div className={css(styles.widgetIcon)}>{icon}</div>
    <div className={css(styles.widgetText)}>
      <p className={css(styles.widgetTitle)}>{title}</p>
      <p className={css(styles.widgetValue)}>{value}</p>
    </div>
  </div>
);

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
