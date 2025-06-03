import React from 'react';

const About = () => {
  return (
    <div style={styles.container}>
      <div style={styles.header}>About the Debris Detection System</div>
      <p style={styles.description}>
        This system is designed to detect and remove debris from sewer drainage inlets, aiming to improve sewer maintenance and prevent urban flooding.
      </p>
      <p style={styles.description}>
        The prototype monitors grate-type drainage inlets, sends alerts when the collecting bin is full, detects signs of flooding, and identifies the system’s location for easy tracking.
      </p>
      <p style={styles.description}>
        Our goal is to create a functional, efficient, and cost-effective solution that adheres to engineering standards and considers economic, environmental, safety, and cultural factors in all design decisions.
      </p>
      <p style={styles.lastDescription}>
        We are testing and evaluating the system’s accuracy to ensure reliability and performance in real-world conditions.
      </p>
    </div>
  );
};

const styles = {
  container: {
    backgroundColor: '#ffffff',
    width: '80%',
    maxWidth: '900px',
    margin: '50px auto',
    padding: '40px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
  },
  header: {
    fontSize: '2.2rem',
    color: '#2c3e50',
    marginBottom: '20px',
    fontWeight: '600',
  },
  description: {
    fontSize: '1.1rem',
    lineHeight: '1.8',
    color: '#7f8c8d',
    marginBottom: '20px',
    textAlign: 'justify',
  },
  lastDescription: {
    marginBottom: '0',
  },
  '@media (max-width: 768px)': {
    container: {
      width: '90%',
      padding: '30px',
    },
    header: {
      fontSize: '1.8rem',
    },
    description: {
      fontSize: '1rem',
    },
  },
};

export default About;
