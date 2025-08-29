// src/components/Status.jsx
import React, { useContext, useState, useEffect, useRef } from "react";
import { MetricsContext } from "../MetricsContext";
import { realtimeDB } from "../firebase";
import { ref as dbRef, remove, update, onValue } from "firebase/database";
import { FiTrash2, FiPlusCircle, FiWifi } from "react-icons/fi";
import { StyleSheet, css } from "aphrodite";

// ✅ Inline Widget component with Aphrodite styles
const Widget = ({ icon, title, value }) => (
  <div className={css(styles.widget)}>
    <div className={css(styles.widgetIcon)}>{icon}</div>
    <div className={css(styles.widgetBody)}>
      <div className={css(styles.widgetTitle)}>{title}</div>
      <div className={css(styles.widgetValue)}>{value}</div>
    </div>
  </div>
);

export default function Status() {
  const { activeDevices, floodRisks, fullBinAlerts } =
    useContext(MetricsContext);
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Load devices from Firebase
  useEffect(() => {
    const devicesRef = dbRef(realtimeDB, "devices");
    const unsubscribe = onValue(devicesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const deviceList = Object.entries(data).map(([id, value]) => ({
        id,
        ...value,
      }));
      setDevices(deviceList);
    });

    return () => unsubscribe();
  }, []);

  // Device deletion
  const deleteDevice = (deviceId) => {
    console.log("[Status] deleteDevice called for", deviceId);
    const confirmDelete = window.confirm(
      `Are you sure you want to delete device ${deviceId}?`
    );
    if (!confirmDelete) {
      console.log(`[Status] user cancelled delete for ${deviceId}`);
      return;
    }
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    remove(dbRef(realtimeDB, `devices/${deviceId}`));
    setLogs((prev) => [...prev, `Device ${deviceId} deleted.`]);
  };

  // Update device status (e.g. refresh last seen)
  const handleRefresh = (deviceId) => {
    const now = new Date().toISOString();
    update(dbRef(realtimeDB, `devices/${deviceId}`), { lastSeen: now });
    setLogs((prev) => [...prev, `Device ${deviceId} refreshed.`]);
  };

  return (
    <div className={css(styles.container)}>
      {/* Top row widgets */}
      <div className={css(styles.widgetRow)}>
        <Widget icon={<FiWifi />} title="Active Devices" value={activeDevices} />
        <Widget
          icon={<FiPlusCircle />}
          title="Flood Risks"
          value={floodRisks}
        />
        <Widget
          icon={<FiTrash2 />}
          title="Full Bin Alerts"
          value={fullBinAlerts}
        />
      </div>

      {/* Device health table */}
      <table className={css(styles.table)}>
        <thead>
          <tr>
            <th>Device ID</th>
            <th>Name</th>
            <th>Status</th>
            <th>Bin Level</th>
            <th>Flood Risk</th>
            <th>Last Seen</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id}>
              <td>{device.id}</td>
              <td>{device.name || "Unnamed"}</td>
              <td>{device.status || "Unknown"}</td>
              <td>{device.binLevel ?? "N/A"}</td>
              <td>{device.floodRisk ?? "N/A"}</td>
              <td>{device.lastSeen ?? "Never"}</td>
              <td>
                <button
                  className={css(styles.actionBtn)}
                  onClick={() => handleRefresh(device.id)}
                >
                  Refresh
                </button>
                <button
                  className={css(styles.deleteBtn)}
                  onClick={() => deleteDevice(device.id)}
                >
                  <FiTrash2 />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Log panel */}
      <div className={css(styles.logPanel)}>
        <h3>Activity Logs</h3>
        <div className={css(styles.logContent)}>
          {logs.map((log, i) => (
            <div key={i} className={css(styles.logItem)}>
              {log}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  widgetRow: {
    display: "flex",
    gap: 16,
    marginBottom: 20,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginBottom: 20,
    background: "#fff",
  },
  logPanel: {
    marginTop: 20,
    padding: 12,
    background: "#f4f4f4",
    borderRadius: 8,
  },
  logContent: {
    maxHeight: 200,
    overflowY: "auto",
    fontSize: 14,
    padding: 8,
    background: "#fff",
    borderRadius: 4,
  },
  logItem: {
    marginBottom: 6,
    borderBottom: "1px solid #eee",
    paddingBottom: 4,
  },
  actionBtn: {
    marginRight: 8,
    background: "#007bff",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: 4,
    cursor: "pointer",
  },
  deleteBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 18,
    color: "#d33",
  },

  // ✅ Widget styles
  widget: {
    display: "flex",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    background: "#fff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    minWidth: 180,
  },
  widgetIcon: {
    marginRight: 10,
    fontSize: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  widgetBody: {
    display: "flex",
    flexDirection: "column",
  },
  widgetTitle: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  widgetValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "#111",
  },
});
