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
    { img: "Ecotrack1.jpg", label: "3D Prototype Front View" },
    { img: "Ecotrack2.jpg", label: "3D Prototype Side View" },
    { img: "Ecotrack3.jpg", label: "Internal Mechanism" },
    { img: "Ecotrack4.jpg", label: "Debris Collection System" },
    { img: "Ecotrack5.jpg", label: "Drainage Integration" },
    { img: "Ecotrack6.jpg", label: "Final Assembly" }
  ];

  return (
    <div style={styles.container}>

      {/* Logo */}
      <div style={styles.topImageContainer}>
        <img src="EcotrackLogo.png" alt="Debris Detection System" style={styles.topImage}/>
      </div>

      {/* About Section */}
      <div style={styles.header}>About the Debris Detection System</div>

      <p style={styles.description}>
        This system is designed to detect and remove <b>debris from drainage inlets</b>, aiming to improve sewer maintenance and prevent <b>urban flooding</b>.
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

      {/* Developers */}
      <div style={styles.sectionHeader}>Meet the Developers</div>

      <div style={styles.devGrid}>
        {developers.map((dev, index) => (
          <div key={index} style={styles.devCard} className="dev-card">

            <img
              src={dev.img}
              alt={dev.name}
              style={styles.devImg}
              className="dev-img"
            />

            <h3 style={styles.devName}>{dev.name}</h3>
            <p style={styles.devCourse}>{dev.course}</p>
            <p style={styles.devDesc}>{dev.desc}</p>

          </div>
        ))}
      </div>

      {/* Prototype Section */}
      <div style={styles.sectionHeader}>Prototype</div>

      <div style={styles.albumContainer}>
        {prototypeImages.map((item, index) => (
          <div
            key={index}
            style={styles.albumItem}
            onClick={() => setSelectedImage(item.img)}
          >
            <img
              src={item.img}
              alt={`Prototype ${index + 1}`}
              style={styles.albumImg}
            />
            <p style={styles.caption}>{item.label}</p>
          </div>
        ))}
      </div>

      {/* Image Lightbox */}
      {selectedImage && (
        <div style={styles.overlay} onClick={() => setSelectedImage(null)}>
          <div style={styles.lightbox}>
            <img src={selectedImage} alt="Prototype" style={styles.lightboxImg}/>
            <button style={styles.closeBtn} onClick={() => setSelectedImage(null)}>×</button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={styles.footer}>
        © 2026 EcoTrack Debris Detection System | BS Computer Engineering
      </div>

      {/* Hover Effects */}
      <style>
        {`
          .dev-card {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }

          .dev-card:hover {
            transform: translateY(-6px);
            box-shadow: 0 12px 25px rgba(34,197,94,0.25);
          }

          .dev-img {
            transition: transform 0.3s ease;
          }

          .dev-card:hover .dev-img {
            transform: scale(1.05);
          }

          .albumItem {
            position: relative;
            overflow: hidden;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            cursor: pointer;
          }

          .albumItem:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
          }

          .albumImg {
            transition: transform 0.3s ease;
          }

          .albumItem:hover .albumImg {
            transform: scale(1.1);
          }

          .sectionHeader::after {
            content: "";
            display: block;
            width: 60%;
            height: 3px;
            background: #22c55e;
            margin: 8px auto 0;
            border-radius: 2px;
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
    boxShadow: '0 6px 15px rgba(0,0,0,0.1)',
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
    maxWidth: '280px',
    height: 'auto',
    filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.2))'
  },

  header: {
    fontSize: '2.4rem',
    color: '#2c3e50',
    marginBottom: '25px',
    fontWeight: '700',
  },

  description: {
    fontSize: '1.1rem',
    lineHeight: '1.8',
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
    position: 'relative',
    display: 'inline-block',
  },

  devGrid: {
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
    flexWrap: 'wrap',
    marginBottom: '40px',
  },

  devCard: {
    backgroundColor: '#f8fafc',
    color: '#1e293b',
    padding: '18px',
    borderRadius: '12px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
    textAlign: 'center',
    width: '170px',
    borderTop: '4px solid #22c55e',
  },

  devImg: {
    width: '120px',
    height: '120px',
    objectFit: 'cover',
    borderRadius: '50%',
    marginBottom: '12px',
  },

  devName: {
    fontSize: '1rem',
    fontWeight: '600',
    marginBottom: '4px',
  },

  devCourse: {
    fontSize: '0.85rem',
    marginBottom: '6px',
    color: '#475569',
  },

  devDesc: {
    fontSize: '0.8rem',
    lineHeight: '1.4',
    color: '#64748b',
  },

  albumContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '20px',
    justifyItems: 'center',
    marginTop: '20px',
  },

  albumItem: {
    backgroundColor: '#0F172A',
    padding: '10px',
    borderRadius: '10px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
  },

  albumImg: {
    width: '100%',
    height: '200px',
    objectFit: 'cover',
    borderRadius: '5px',
  },

  caption: {
    color: '#fff',
    marginTop: '8px',
    fontSize: '0.85rem',
    textAlign: 'center',
  },

  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
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
    maxHeight: '70vh',
    objectFit: 'contain',
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

  footer: {
    marginTop: '60px',
    paddingTop: '20px',
    borderTop: '1px solid #ddd',
    fontSize: '0.9rem',
    color: '#64748b'
  },
};

export default About;
