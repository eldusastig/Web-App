import React, { useState } from 'react';

const About = () => {
  const [selectedImage, setSelectedImage] = useState(null);

  const developers = [
    { name: "Dhafny Buenafe", course: "BS Computer Engineering", desc: "Specializes in Intelligent Systems.", img: "Buenafe.png", email: "dhafny@example.com", role: "Team Lead" },
    { name: "Patrick Jordan Cabanatan", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Cabanatan.png", email: "patrick@example.com", role: "Backend" },
    { name: "Jethro Duque", course: "BS Computer Engineering", desc: "Specializes in Railway Engineering.", img: "Duque.jpg", email: "jethro@example.com", role: "Hardware" },
    { name: "Rens Españo", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Espano.png", email: "rens@example.com", role: "Frontend" },
    { name: "Justin Jello Repani", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Repani.png", email: "justin@example.com", role: "Tester" },
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
    <div style={styles.pageBackground}>
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
              <strong>Debris Removal:</strong> Detects and removes debris from drainage inlets, improving sewer maintenance and preventing urban flooding.
            </p>
          </div>
          <div style={styles.descCard}>
            <p>
              <strong>Monitoring & Alerts:</strong> Monitors grate-type drainage inlets, sends alerts when bins are full, detects flooding, and tracks system location.
            </p>
          </div>
          <div style={styles.descCard}>
            <p>
              <strong>Design Goals:</strong> Efficient, cost-effective solution adhering to engineering standards and considering safety, environment, and economics.
            </p>
          </div>
          <div style={styles.descCard}>
            <p>
              <strong>Testing & Reliability:</strong> Continuously evaluated for accuracy and performance in real-world conditions.
            </p>
          </div>
        </div>

        {/* Developers Section */}
        <div style={styles.sectionHeader}>Meet the Developers</div>
        <div style={styles.devGrid}>
          {developers.map((dev, index) => (
            <div key={index} style={styles.devCard} className="flip-card">
              <div style={styles.flipInner}>
                <div style={styles.flipFront}>
                  <img src={dev.img} alt={dev.name} style={styles.devImg} />
                  <h3 style={styles.devName}>{dev.name}</h3>
                  <p style={styles.devCourse}>{dev.course}</p>
                </div>
                <div style={styles.flipBack}>
                  <p style={styles.devDesc}>Role: {dev.role}</p>
                  <p style={styles.devDesc}>Email: {dev.email}</p>
                  <p style={styles.devDesc}>{dev.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Prototype Section */}
        <div style={styles.sectionHeader}>Prototype Gallery</div>
        <div style={styles.albumContainer}>
          {prototypeImages.map((item, index) => (
            <div key={index} style={styles.albumItem} onClick={() => setSelectedImage({ img: item.img, index })}>
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
              <p style={styles.lightboxCaption}>{prototypeImages[selectedImage.index].label}</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={styles.footer}>
          © 2026 EcoTrack Debris Detection System | BS Computer Engineering
        </div>

        {/* Hover & Flip Card Effects */}
        <style>{`
          .flip-card {
            background-color: transparent;
            width: 180px;
            perspective: 1000px;
          }
          .flipInner {
            position: relative;
            width: 100%;
            height: 250px;
            text-align: center;
            transition: transform 0.6s;
            transform-style: preserve-3d;
          }
          .flip-card:hover .flipInner {
            transform: rotateY(180deg);
          }
          .flipFront, .flipBack {
            position: absolute;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            border-radius: 12px;
            padding: 20px;
          }
          .flipFront {
            background-color: #f8fafc;
            color: #1e293b;
          }
          .flipBack {
            background-color: #22c55e;
            color: white;
            transform: rotateY(180deg);
          }
        `}</style>
      </div>
    </div>
  );
};

const styles = {
  pageBackground: {
    minHeight: '100vh',
    padding: '40px 0',
  },
  container: {
    backgroundColor: '#ffffff',
    width: '85%',
    maxWidth: '1100px',
    margin: '0 auto',
    padding: '40px',
    borderRadius: '15px',
    boxShadow: '0 8px 20px rgba(0,0,0,0.1)',
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
  },
  topImageContainer: { display: 'flex', justifyContent: 'center', marginBottom: '25px' },
  topImage: { width: '150px', height: 'auto' },
  header: { fontSize: '2.4rem', color: '#0f172a', fontWeight: '700', marginBottom: '30px' },
  descGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginBottom: '50px' },
  descCard: { backgroundColor: '#f1f5f9', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '1rem', lineHeight: '1.6', color: '#1e293b' },
  sectionHeader: { fontSize: '2rem', color: '#0f172a', marginBottom: '30px', fontWeight: '700' },
  devGrid: { display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '25px', marginBottom: '50px' },
  devCard: { width: '180px', height: '250px', cursor: 'pointer' },
  devImg: { width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover', marginBottom: '12px' },
  devName: { fontSize: '1rem', fontWeight: '600', marginBottom: '4px' },
  devCourse: { fontSize: '0.85rem', marginBottom: '6px', color: '#475569' },
  devDesc: { fontSize: '0.8rem', color: '#ffffff' },
  albumContainer: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', justifyItems: 'center', marginBottom: '50px' },
  albumItem: { backgroundColor: '#0f172a', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', cursor: 'pointer', transition: '0.3s' },
  albumImg: { width: '100%', height: '200px', objectFit: 'cover', borderRadius: '8px' },
  caption: { color: '#fff', marginTop: '8px', fontSize: '0.85rem', textAlign: 'center' },
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  lightbox: { position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '12px', maxWidth: '80%', maxHeight: '80%', textAlign: 'center' },
  lightboxImg: { width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '8px' },
  closeBtn: { position: 'absolute', top: '10px', right: '15px', background: 'transparent', border: 'none', fontSize: '2rem', cursor: 'pointer' },
  lightboxCaption: { marginTop: '10px', fontSize: '0.9rem', color: '#1e293b' },
  footer: { fontSize: '0.9rem', color: '#475569', borderTop: '1px solid #ddd', paddingTop: '20px', marginTop: '40px' }
};

export default About;
