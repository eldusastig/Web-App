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
    { img: "Ecotrack3.jpg", label: "3D Prototype Front View" },
    { img: "Ecotrack4.jpg", label: "3D Prototype Side View" },
    { img: "Ecotrack6.jpg", label: "3D Prototype Top View" },
    { img: "Ecotrack5.jpg", label: "3D Prototype Back View" },
    { img: "Ecotrack2.jpg", label: "Overall 3D Prototype" },
    { img: "Ecotrack1.jpg", label: "Final Assembly" }
  ];

  return (
    <div style={styles.container}>

      {/* Logo */}
      <div style={styles.topImageContainer}>
        <img src="EcotrackLogo.png" alt="Debris Detection System" style={styles.topImage}/>
      </div>

      {/* About Section */}
      <div style={styles.header}>About the Debris Detection System</div>

      <div style={styles.descGrid}>
        <div style={styles.descCard}>
          <p>
            <strong>Debris Removal:</strong> This system detects and removes debris from drainage inlets, improving sewer maintenance and preventing urban flooding.
          </p>
        </div>

        <div style={styles.descCard}>
          <p>
            <strong>Monitoring & Alerts:</strong> It monitors grate-type drainage inlets, sends alerts when the collecting bin is full, detects signs of flooding, and tracks the system’s location for easy management.
          </p>
        </div>

        <div style={styles.descCard}>
          <p>
            <strong>Design Goals:</strong> Our goal is to create a functional, efficient, and cost-effective solution that follows engineering standards and considers economic, environmental, safety, and cultural factors.
          </p>
        </div>

        <div style={styles.descCard}>
          <p>
            <strong>Testing & Reliability:</strong> We are continuously testing and evaluating the system’s accuracy to ensure performance in real-world conditions.
          </p>
        </div>
      </div>

      {/* Developers Section */}
      <div style={styles.sectionHeader}>Meet the Developers</div>

      <div style={styles.devGrid}>
        {developers.map((dev, index) => (
          <div key={index} style={styles.devCard} className="dev-card">
            <img src={dev.img} alt={dev.name} style={styles.devImg} className="dev-img" />
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
            onClick={() => setSelectedImage({ img: item.img, index })}
          >
            <img src={item.img} alt={`Prototype ${index + 1}`} style={styles.albumImg}/>
            <p style={styles.caption}>{item.label}</p>
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {selectedImage && (
        <div style={styles.overlay} onClick={() => setSelectedImage(null)}>
          <div style={styles.lightbox} onClick={e => e.stopPropagation()}>
            <img src={selectedImage.img} alt="Prototype" style={styles.lightboxImg}/>
            <button style={styles.closeBtn} onClick={() => setSelectedImage(null)}>×</button>

            {/* Navigation */}
            <button
              style={{...styles.navBtn, left: '10px'}}
              onClick={() => {
                const prev = (selectedImage.index - 1 + prototypeImages.length) % prototypeImages.length;
                setSelectedImage({ img: prototypeImages[prev].img, index: prev });
              }}
            >‹</button>

            <button
              style={{...styles.navBtn, right: '10px'}}
              onClick={() => {
                const next = (selectedImage.index + 1) % prototypeImages.length;
                setSelectedImage({ img: prototypeImages[next].img, index: next });
              }}
            >›</button>

            <p style={styles.lightboxCaption}>{prototypeImages[selectedImage.index].label}</p>
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

  descGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '40px',
  },

  descCard: {
    backgroundColor: '#f1f5f9',
    padding: '20px',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    textAlign: 'left',
    fontSize: '1rem',
    lineHeight: '1.8',
    color: '#1e293b',
    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
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
    cursor: 'pointer',
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

  navBtn: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(0,0,0,0.4)',
    color: '#fff',
    border: 'none',
    fontSize: '2rem',
    padding: '10px 15px',
    cursor: 'pointer',
    borderRadius: '5px',
    zIndex: 1010,
  },

  lightboxCaption: {
    color: '#333',
    marginTop: '10px',
    fontSize: '0.9rem',
    textAlign: 'center',
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
