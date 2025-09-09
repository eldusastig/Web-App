// src/App.js
import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { StyleSheet, css } from 'aphrodite';

import './index.css'; // ensure this is present in your project

import Sidebar   from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Locations from './components/Locations';
import Status    from './components/Status';
import About     from './components/About';
import Login     from './components/Login';

import { DeviceProvider } from './DeviceContext';
import { MetricsProvider } from './MetricsContext';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleLogin  = () => setIsLoggedIn(true);
  const handleLogout = () => setIsLoggedIn(false);

  return (
    <DeviceProvider>
      <MetricsProvider>
        <div className={css(styles.appContainer)}>
          <Router>
            {!isLoggedIn ? (
              <div className={css(styles.loginWrapper)}>
                <Login onLogin={handleLogin} />
              </div>
            ) : (
              <>
                <Sidebar onLogout={handleLogout} />
                <div className={css(styles.contentContainer)}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/locations" element={<Locations />} />
                    <Route path="/status" element={<Status />} />
                    <Route path="/about" element={<About />} />
                  </Routes>
                </div>
              </>
            )}
          </Router>
        </div>
      </MetricsProvider>
    </DeviceProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    display: 'block',
    minHeight: '100vh',
    backgroundColor: '#0F172A',
  },
  // main content is offset by the sidebar width (CSS var set by Sidebar)
  contentContainer: {
    boxSizing: 'border-box',
    paddingLeft: 'var(--sidebar-width, 250px)', // fallback to 250px if var not set
    transition: 'padding-left 0.28s ease',
    backgroundColor: '#0F1B34',
    color: 'white',
    paddingTop: '24px',
    paddingRight: '24px',
    paddingBottom: '24px',
    minHeight: '100vh',
    overflow: 'auto',
  },
  loginWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#0F172A',
  },
});
