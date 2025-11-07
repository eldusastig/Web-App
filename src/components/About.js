import React, { useState } from 'react';

const About = () => {
  const [selectedImage, setSelectedImage] = useState(null);

  const developers = [
    { name: "Dhafny Buenafe", course: "BS Computer Engineering", desc: "Specializes in Intelligent Systems.", img: "Buenafe.png" },
    { name: "Patrick Jordan Cabanatan", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Cabanatan.png" },
    { name: "Jethro Duque", course: "BS Computer Engineering", desc: "Specializes in Railway Engineering.", img: "Duque.jpg" },
    { name: "Rens Españo", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Espano.png" },
    { name: "Justin Jello Repani", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Repani.png" },
  ];

  const prototypeImages = [
    "Ecotrack1.jpg",
    "Ecotrack2.jpg",
    "Ecotrack3.jpg",
    "Ecotrack4.jpg",
    "Ecotrack5.jpg",
    "Ecotrack6.jpg",
  ];

  return (
    <div style={styles.container}>
      {/* Logo */}
      <div style={styles.topImageContainer}>
        <img src="EcotrackLogo.png" alt="Debris Detection System" style={styles.topImage} />
      </div>

      {/* About Section */}
      <div style={styles.header}>About the Debris Detection System</div>
      <p style={styles.description}>
        This system is designed to detect and remove debris from drainage inlets, aiming to improve sewer maintenance and prevent urban flooding.
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

      {/* Developers Section */}
      <div style={styles.sectionHeader}>Meet the Developers</div>
      <div style={styles.devGrid}>
        {developers.slice(0, 4).map((dev, index) => (
          <div key={index} style={styles.devCard} className="dev-card">
            <img src={dev.img} alt={dev.name} style={styles.devImg} className="dev-img" />
            <h3 style={styles.devName}>{dev.name}</h3>
            <p style={styles.devCourse}>{dev.course}</p>
            <p style={styles.devDesc}>{dev.desc}</p>
          </div>
        ))}
      </div>

      {/* Fifth Developer */}
      <div style={styles.devCenter}>
        <div style={styles.devCard} className="dev-card">
          <img src={developers[4].img} alt={developers[4].name} style={styles.devImg} className="dev-img" />
          <h3 style={styles.devName}>{developers[4].name}</h3>
          <p style={styles.devCourse}>{developers[4].course}</p>
          <p style={styles.devDesc}>{developers[4].desc}</p>
        </div>
      </div>

      {/* Prototype Album */}
      <div style={styles.sectionHeader}>Prototype</div>
      <div style={styles.albumContainer}>
        {prototypeImages.map((img, index) => (
          <div key={index} style={styles.albumItem} onClick={() => setSelectedImage(img)}>
            <img src={img} alt={`3D Prototype ${index + 1}`} style={styles.albumImg} />
          </div>
        ))}
      </div>

      {/* Popup Lightbox */}
      {selectedImage && (
        <div style={styles.overlay} onClick={() => setSelectedImage(null)}>
          <div style={styles.lightbox}>
            <img src={selectedImage} alt="Enlarged 3D" style={styles.lightboxImg} />
            <button style={styles.closeBtn} onClick={() => setSelectedImage(null)}>×</button>
          </div>
        </div>
      )}

      {/* Hover Effects */}
      <style>
        {`
          .dev-card {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          .dev-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.3);
          }
          .dev-img {
            transition: transform 0.3s ease;
          }
          .dev-card:hover .dev-img {
            transform: scale(1.05);
          }
        `}
      </style>
    </div>
  );
};

const styles = {
  container: {
    backgroundColor: '#ffffff',
    width: '85%',
    maxWidth: '1200px',
    margin: '20px auto',
    padding: '50px',
    borderRadius: '12px',
    boxShadow: '0 6px 15px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
  },
  topImageContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  topImage: {
    width: '100%',
    maxWidth: '300px',
    height: 'auto',
  },
  header: {
    fontSize: '2.4rem',
    color: '#2c3e50',
    marginBottom: '25px',
    fontWeight: '700',
  },
  description: {
    fontSize: '1.15rem',
    lineHeight: '1.9',
    color: '#555',
    marginBottom: '18px',
    textAlign: 'justify',
  },
  lastDescription: {
    marginBottom: '50px',
  },
  sectionHeader: {
    fontSize: '2rem',
    color: '#2c3e50',
    marginTop: '50px',
    marginBottom: '30px',
    fontWeight: '700',
    borderBottom: '2px solid #ddd',
    display: 'inline-block',
    paddingBottom: '5px',
  },
  devGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '30px',
    justifyItems: 'center',
    marginBottom: '30px',
  },
  devCenter: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '50px',
  },
  devCard: {
    backgroundColor: '#0F172A',
    color: '#ffffff',
    padding: '25px',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    textAlign: 'center',
    width: '100%',
    maxWidth: '280px',
  },
  devImg: {
    width: '100%',
    height: '220px',
    objectFit: 'cover',
    borderRadius: '10px',
    marginBottom: '15px',
  },
  devName: {
    fontSize: '1.3rem',
    fontWeight: '600',
    marginBottom: '6px',
  },
  devCourse: {
    fontSize: '1rem',
    fontWeight: '500',
    marginBottom: '10px',
  },
  devDesc: {
    fontSize: '0.95rem',
    lineHeight: '1.5',
  },
  albumContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
    justifyItems: 'center',
    marginTop: '20px',
  },
  albumItem: {
    backgroundColor: '#f9f9f9',
    padding: '10px',
    borderRadius: '10px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
    transition: 'transform 0.3s ease',
    cursor: 'pointer',
  },
  albumImg: {
    width: '100%',
    height: '200px',
    objectFit: 'cover',
    borderRadius: '8px',
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  lightbox: {
    position: 'relative',
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '12px',
    boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
    maxWidth: '80%',
    maxHeight: '80%',
  },
  lightboxImg: {
    width: '100%',
    height: 'auto',
    borderRadius: '8px',
  },
  closeBtn: {
    position: 'absolute',
    top: '10px',
    right: '15px',
    background: 'transparent',
    border: 'none',
    fontSize: '2rem',
    color: '#333',
    cursor: 'pointer',
  },
};

export default About;
