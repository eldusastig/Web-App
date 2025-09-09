import React, { useState } from "react";
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

const Sidebar = ({ onLogout }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div
      style={{
        ...styles.sidebar,
        width: isCollapsed ? "70px" : "250px",
      }}
    >
      {/* Header */}
      <div style={styles.header}>
        {!isCollapsed && "EcoTrack Dashboard"}
        <button
          style={styles.toggleBtn}
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
        >
          {isCollapsed ? <FiMenu /> : <FiChevronLeft />}
        </button>
      </div>

      {/* Navigation */}
      <nav>
        <MenuItem icon={<FiHome />} label="Home" to="/" isCollapsed={isCollapsed} />
        <MenuItem
          icon={<FiMapPin />}
          label="Locations"
          to="/locations"
          isCollapsed={isCollapsed}
        />
        <MenuItem
          icon={<FiActivity />}
          label="Status"
          to="/status"
          isCollapsed={isCollapsed}
        />
        <MenuItem
          icon={<FiInfo />}
          label="About"
          to="/about"
          isCollapsed={isCollapsed}
        />
        <MenuItem
          icon={<FiLogOut />}
          label="Logout"
          onClick={onLogout}
          isCollapsed={isCollapsed}
        />
      </nav>
    </div>
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
  sidebar: {
    height: "100vh",
    backgroundColor: "#1F2937",
    color: "white",
    padding: "20px 10px",
    transition: "width 0.3s ease",
    overflow: "hidden",
  },
  header: {
    fontSize: "20px",
    fontWeight: "bold",
    marginBottom: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleBtn: {
    background: "none",
    border: "none",
    color: "white",
    fontSize: "1.2rem",
    cursor: "pointer",
    marginLeft: "10px",
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    padding: "12px",
    cursor: "pointer",
    borderRadius: "6px",
    marginBottom: "10px",
    transition: "background-color 0.2s ease",
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
  },
};

export default Sidebar;
