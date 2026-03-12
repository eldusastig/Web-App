import React, { useState } from 'react';
import './About.css'; // Flip card CSS

const About = () => {
  const [selectedImage, setSelectedImage] = useState(null);

  const developers = [
    { name: "Dhafny Buenafe", course: "BS Computer Engineering", desc: "Specializes in Intelligent Systems.", email: "dhafny@example.com", role: "Team Lead", img: "Buenafe.png" },
    { name: "Patrick Jordan Cabanatan", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", email: "patrick@example.com", role: "Backend", img: "Cabanatan.png" },
    { name: "Jethro Duque", course: "BS Computer Engineering", desc: "Specializes in Railway Engineering.", email: "jethro@example.com", role: "Hardware", img: "Duque.jpg" },
    { name: "Rens Españo", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", email: "rens@example.com", role: "Software", img: "Espano.png" },
    { name: "Justin Jello Repani", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", email: "justin@example.com", role: "UI/UX", img: "Repani.png" },
  ];

  const prototypeImages = [
    { img: "Ecotrack3.jpg", label: "3D Prototype Front View" },
    { img: "Ecotrack4.jpg", label: "3D Prototype Side View" },
    { img: "Ecotrack6.jpg", label: "3D Prototype Top View" },
    { img: "Ecotrack5.jpg", label: "3D Prototype Back View" },
    { img: "Ecotrack2.jpg", label: "Overall 3D Prototype" },
    { img: "Ecotrack1.jpg", label: "Final Assembly" }
  ];

  const handleNext = () => {
    setSelectedImage(prev => ({
      img: prototypeImages[(prev.index + 1) % prototypeImages.length].img,
      index: (prev.index + 1) % prototypeImages.length
    }));
  };

  const handlePrev = () => {
    setSelectedImage(prev => ({
      img: prototypeImages[(prev.index - 1 + prototypeImages.length) % prototypeImages.length].img,
      index: (prev.index - 1 + prototypeImages.length) % prototypeImages.length
    }));
  };

  return (
    <div style={styles.pageBackground}>
      <div style={styles.container}>

        {/* Logo */}
        <div style={styles.topImageContainer}>
          <img src="EcotrackLogo.png" alt="Debris Detection System" style={styles.topImage}/>
        </div>

        {/* About Section */}
        <div style={styles.header}>About the Debris Detection System</div>
        <div style={styles.descGrid}>
          <div style={styles.descCard}><strong>Debris Removal:</strong> Detects and removes debris from drainage inlets, improving sewer maintenance and preventing urban flooding.</div>
          <div style={styles.descCard}><strong>Monitoring & Alerts:</strong> Monitors grate-type drainage inlets, sends alerts when bins are full, detects flooding, and tracks system location.</div>
          <div style={styles.descCard}><strong>Design Goals:</strong> Efficient, cost-effective solution adhering to engineering standards and considering safety, environment, and economics.</div>
          <div style={styles.descCard}><strong>Testing & Reliability:</strong> Continuously evaluated for accuracy and performance in real-world conditions.</div>
        </div>

        {/* Developers Section */}
        <div style={styles.sectionHeader}>Meet the Developers</div>
        <div style={styles.devGrid}>
          {developers.map((dev, index) => (
            <div key={index} className="flip-card">
              <div className="flip-card-inner">
                <div className="flip-card-front" style={styles.devCard}>
                  <img src={dev.img} alt={dev.name} style={styles.devImg} />
                  <h3 style={styles.devName}>{dev.name}</h3>
                  <p style={styles.devCourse}>{dev.course}</p>
                  <p style={styles.devDesc}>{dev.desc}</p>
                </div>
                <div className="flip-card-back" style={styles.flipBack}>
                  <h3>{dev.name}</h3>
                  <p>{dev.role}</p>
                  <p>{dev.email}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Prototype Section */}
        <div style={styles.sectionHeader}>Prototype Gallery</div>
        <div style={styles.albumContainer}>
          {prototypeImages.map((item, index) => (
            <div key={index} style={styles.albumItem}>
              <img
                src={item.img}
                alt={`Prototype ${index + 1}`}
                style={styles.albumImg}
                onClick={() => setSelectedImage({ img: item.img, index })}
              />
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
              <p style={styles.lightboxCaption}>{prototypeImages[selectedImage.index].label}</p>
              <div style={styles.lightboxButtons}>
                <button style={styles.navBtn} onClick={handlePrev}>← Previous</button>
                <button style={styles.navBtn} onClick={handleNext}>Next →</button>
              </div>
            </div>
          </div>
        )}

        <div style={styles.footer}>
          © 2026 EcoTrack Debris Detection System | BS Computer Engineering
        </div>

      </div>
    </div>
  );
};

const styles = {
  pageBackground: { background: 'linear-gradient(to right, #e0f2fe, #f0f9ff)', minHeight: '100vh', padding: '40px 0' },
  container: { backgroundColor: '#fff', width: '90%', maxWidth: '1200px', margin: '0 auto', padding: '40px', borderRadius: '15px', boxShadow: '0 8px 20px rgba(0,0,0,0.1)', textAlign: 'center', fontFamily: 'Arial, sans-serif' },
  topImageContainer: { display: 'flex', justifyContent: 'center', marginBottom: '25px' },
  topImage: { width: '150px', height: 'auto' },
  header: { fontSize: '2.4rem', color: '#0f172a', fontWeight: '700', marginBottom: '30px' },
  descGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '20px', marginBottom: '50px' },
  descCard: { backgroundColor: '#f1f5f9', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '1rem', lineHeight: '1.6', color: '#1e293b' },
  sectionHeader: { fontSize: '2rem', color: '#0f172a', marginBottom: '30px', fontWeight: '700' },

  devGrid: { display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '25px', marginBottom: '50px' },
  devCard: { backgroundColor: '#f8fafc', borderRadius: '12px', padding: '20px', width: '180px', boxShadow: '0 4px 10px rgba(0,0,0,0.08)', cursor: 'pointer' },
  devImg: { width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover', marginBottom: '12px' },
  devName: { fontSize: '1rem', fontWeight: '600', marginBottom: '4px' },
  devCourse: { fontSize: '0.85rem', marginBottom: '6px', color: '#475569' },
  devDesc: { fontSize: '0.8rem', color: '#64748b' },
  flipBack: { backgroundColor: '#0f172a', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '20px', borderRadius: '12px' },

  albumContainer: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 200px)', gap: '20px', justifyItems: 'center', marginBottom: '50px' },
  albumItem: { backgroundColor: '#0f172a', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', cursor: 'pointer', transition: '0.3s' },
  albumImg: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' },
  caption: { color: '#fff', marginTop: '8px', fontSize: '0.85rem', textAlign: 'center' },

  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  lightbox: { position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '12px', maxWidth: '80%', maxHeight: '80%', textAlign: 'center' },
  lightboxImg: { width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '8px' },
  closeBtn: { position: 'absolute', top: '10px', right: '15px', background: 'transparent', border: 'none', fontSize: '2rem', cursor: 'pointer' },
  lightboxCaption: { marginTop: '10px', fontSize: '0.9rem', color: '#1e293b' },
  lightboxButtons: { display: 'flex', justifyContent: 'space-between', marginTop: '10px' },
  navBtn: { padding: '8px 16px', fontSize: '0.9rem', cursor: 'pointer', borderRadius: '8px', border: 'none', backgroundColor: '#0f172a', color: '#fff', transition: '0.3s' },
  footer: { fontSize: '0.9rem', color: '#475569', borderTop: '1px solid #ddd', paddingTop: '20px', marginTop: '40px' }
};

export default About;
