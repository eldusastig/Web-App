// src/components/Status.jsx

import React, { useContext, useState, useEffect } from 'react';
import { MetricsContext } from '../MetricsContext';
import { DeviceContext } from '../DeviceContext';
import { FiTrash2, FiPlusCircle, FiWifi } from 'react-icons/fi';
import { StyleSheet, css } from 'aphrodite';

export default function Status() {
  const { fullBinAlerts, floodRisks, activeDevices } = useContext(MetricsContext);
  const { devices } = useContext(DeviceContext);
  const [deviceAddresses, setDeviceAddresses] = useState({});

  const displayValue = (val) =>
    val === null || val === undefined ? 'Loading…' : val;

  useEffect(() => {
    devices.forEach((d) => {
      if (
        d.lat != null &&
        d.lon != null &&
        deviceAddresses[d.id] === undefined
      ) {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${d.lat}&lon=${d.lon}`;
        fetch(url)
          .then((res) => res.json())
          .then((data) => {
            const street =
              data.address?.road || data.display_name || 'Unknown address';
            setDeviceAddresses((prev) => ({
              ...prev,
              [d.id]: street,
            }));
          })
          .catch(() => {
            setDeviceAddresses((prev) => ({
              ...prev,
              [d.id]: 'Address unavailable',
            }));
          });
      }
    });
  }, [devices, deviceAddresses]);

  const realTimeAlerts = [];
  devices.forEach((d) => {
    if (d.binFull) {
      realTimeAlerts.push(`⚠️ Bin Full at Device ${d.id}`);
    }
    if (d.flooded) {
      realTimeAlerts.push(`🌊 Flood Risk Detected at Device ${d.id}`);
    }
  });

  return (
    <div className={css(styles.statusContainer)}>
      {/* ─ Top Widgets ─ */}
      <div className={css(styles.widgetGrid)}>
        <Widget
          icon={<FiTrash2 />}
          title="Full Bin Alerts"
          value={`${displayValue(fullBinAlerts)} Alert${
            fullBinAlerts === 1 ? '' : 's'
          }`}
        />
        <Widget
          icon={<FiPlusCircle />}
          title="Flood Risk"
          value={`${displayValue(floodRisks)} Alert${
            floodRisks === 1 ? '' : 's'
          }`}
        />
        <Widget
          icon={<FiWifi />}
          title="Active Devices"
          value={`${displayValue(activeDevices)} Device${
            activeDevices === 1 ? '' : 's'
          }`}
        />
      </div>

      {/* ─ Device Table ─ */}
      <div className={css(styles.deviceHealth)}>
        <h2>Device Health</h2>
        <table className={css(styles.deviceTable)}>
          <thead>
            <tr className={css(styles.tableHeader)}>
              <th>Device ID</th>
              <th>Street Address</th>
              <th>Flooded</th>
              <th>Bin Full</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td>
                  {d.lat != null && d.lon != null
                    ? deviceAddresses[d.id] || 'Loading address…'
                    : '—'}
                </td>
                <td className={css(d.flooded ? styles.alert : styles.ok)}>
                  {d.flooded ? 'Yes' : 'No'}
                </td>
                <td className={css(d.binFull ? styles.alert : styles.ok)}>
                  {d.binFull ? 'Yes' : 'No'}
                </td>
                <td className={css(d.active ? styles.ok : styles.alert)}>
                  {d.active ? 'Yes' : 'No'}
                </td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr>
                <td colSpan="5" className={css(styles.noData)}>
                  No devices connected yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ─ Real-Time Alerts ─ */}
      <div className={css(styles.realTimeAlerts)}>
        <h2>Real-Time Alerts</h2>
        {realTimeAlerts.length > 0 ? (
          <ul className={css(styles.alertsList)}>
            {realTimeAlerts.map((msg, idx) => (
              <li key={idx}>{msg}</li>
            ))}
          </ul>
        ) : (
          <p>No current alerts</p>
        )}
      </div>
    </div>
  );
}

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
  statusContainer: {
    flex: 1,
    padding: '24px',
    overflow: 'auto',
    backgroundColor: '#0F172A',
  },
  widgetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '24px',
    marginBottom: '32px',
  },
  widget: {
    backgroundColor: '#1E293B',
    padding: '20px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)',
    cursor: 'pointer',
  },
  widgetIcon: {
    fontSize: '36px',
    color: '#3B82F6',
  },
  widgetText: { color: '#F8FAFC' },
  widgetTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    marginBottom: '4px',
  },
  widgetValue: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
  },
  deviceHealth: {
    backgroundColor: '#1E293B',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
    marginBottom: '32px',
  },
  deviceTable: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '12px',
    marginBottom: '12px',
    color: '#F8FAFC',
    fontSize: '0.9rem',
    tableLayout: 'fixed',
  },
  tableHeader: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: '1rem',
    textTransform: 'uppercase',
    padding: '12px',
    textAlign: 'left',
  },
  alert: {
    color: '#EF4444',
    fontWeight: 'bold',
  },
  ok: {
    color: '#10B981',
    fontWeight: 'bold',
  },
  noData: {
    color: '#94A3B8',
    textAlign: 'center',
    padding: '16px',
  },
  realTimeAlerts: {
    backgroundColor: '#1E293B',
    padding: '24px',
    borderRadius: '12px',
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
