// src/components/Sidebar.js
import React, { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  FiHome,
  FiMapPin,
  FiActivity,
  FiInfo,
  FiLogOut,
  FiMenu,
  FiChevronLeft,
} from "react-icons/fi";

const COLLAPSED_WIDTH = 70;
const EXPANDED_WIDTH = 250;

const Sidebar = ({ onLogout }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // keep CSS var in sync so other components can use it for layout
  useEffect(() => {
    const widthPx = isCollapsed ? `${COLLAPSED_WIDTH}px` : `${EXPANDED_WIDTH}px`;
    // set a CSS custom property on the root element
    document.documentElement.style.setProperty('--sidebar-width', widthPx);

    // also set a fallback for older code that might read --sidebar-left (optional)
    document.documentElement.style.setProperty('--sidebar-left', '0px');

    return () => {
      // optional: on unmount revert to default (250px) — adjust as needed
      document.documentElement.style.removeProperty('--sidebar-width');
      document.documentElement.style.removeProperty('--sidebar-left');
    };
  }, [isCollapsed]);

  const toggleSidebar = () => setIsCollapsed((s) => !s);

  return (
    <aside
      aria-label="Main sidebar"
      style={{
        ...styles.sidebar,
        width: isCollapsed ? `${COLLAPSED_WIDTH}px` : `${EXPANDED_WIDTH}px`,
      }}
    >
      {/* Header */}
      <div style={styles.header}>
        {!isCollapsed && <span style={styles.brand}>EcoTrack Dashboard</span>}
        <button
          style={styles.toggleBtn}
          onClick={toggleSidebar}
          aria-label={isCollapsed ? 'Open sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Open' : 'Collapse'}
        >
          {isCollapsed ? <FiMenu /> : <FiChevronLeft />}
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation">
        <MenuItem icon={<FiHome />} label="Home" to="/" isCollapsed={isCollapsed} />
        <MenuItem icon={<FiMapPin />} label="Locations" to="/locations" isCollapsed={isCollapsed} />
        <MenuItem icon={<FiActivity />} label="Status" to="/status" isCollapsed={isCollapsed} />
        <MenuItem icon={<FiInfo />} label="About" to="/about" isCollapsed={isCollapsed} />
        <MenuItem icon={<FiLogOut />} label="Logout" onClick={onLogout} isCollapsed={isCollapsed} />
      </nav>
    </aside>
  );
};

const MenuItem = ({ icon, label, to, onClick, isCollapsed }) => {
  return (
    <div style={styles.menuItem} onClick={onClick}>
      {to ? (
        <NavLink
          to={to}
          style={({ isActive }) => ({
            ...styles.navLink,
            color: isActive ? "#61dafb" : "white",
          })}
        >
          <span style={styles.icon}>{icon}</span>
          {!isCollapsed && <span>{label}</span>}
        </NavLink>
      ) : (
        <div style={styles.navLink}>
          <span style={styles.icon}>{icon}</span>
          {!isCollapsed && <span>{label}</span>}
        </div>
      )}
    </div>
  );
};

const styles = {
  // Fixed, full-height sidebar that includes padding in height to avoid overflow.
  sidebar: {
    position: 'fixed',        // remove from page flow so it won't change page height
    top: 0,
    left: 0,
    height: "100vh",
    boxSizing: "border-box",  // INCLUDE padding inside the 100vh — prevents overflow
    backgroundColor: "#1F2937",
    color: "white",
    padding: "20px 10px",
    transition: "width 0.3s ease",
    overflowY: "auto",        // allow vertical scroll inside sidebar if needed
    zIndex: 1000,
  },
  header: {
    fontSize: "20px",
    fontWeight: "bold",
    marginBottom: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: '8px',
  },
  brand: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  toggleBtn: {
    background: "none",
    border: "none",
    color: "white",
    fontSize: "1.2rem",
    cursor: "pointer",
    marginLeft: "10px",
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    padding: "10px 8px",
    cursor: "pointer",
    borderRadius: "6px",
    marginBottom: "8px",
    transition: "background-color 0.15s ease",
  },
  navLink: {
    textDecoration: "none",
    color: "white",
    display: "flex",
    alignItems: "center",
    width: "100%",
  },
  icon: {
    marginRight: "10px",
    fontSize: "1.2rem",
    display: 'inline-flex',
  },
};

export default Sidebar;
