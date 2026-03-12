import React, { useState } from "react";
import "./About.css";

const About = () => {
  const [selectedImage, setSelectedImage] = useState(null);

  const developers = [
    { name: "Dhafny Buenafe", course: "BS Computer Engineering", desc: "Specializes in Intelligent Systems.", img: "Buenafe.png", role: "Team Lead", email: "dhafnybuenafe01@email.com" },
    { name: "Patrick Jordan Cabanatan", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Cabanatan.png", role: "Backend Dev", email: "patrick@email.com" },
    { name: "Jethro Duque", course: "BS Computer Engineering", desc: "Specializes in Railway Engineering.", img: "Duque.jpg", role: "Frontend Dev", email: "jethro@email.com" },
    { name: "Rens Españo", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Espano.png", role: "QA Tester", email: "rens@email.com" },
    { name: "Justin Jello Repani", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Repani.png", role: "UI Designer", email: "justin@email.com" }
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
          <p><strong>Debris Removal:</strong> Detects and removes debris from drainage inlets, improving sewer maintenance and preventing urban flooding.</p>
        </div>
        <div style={styles.descCard}>
          <p><strong>Monitoring & Alerts:</strong> Monitors grate-type drainage inlets, sends alerts when bins are full, detects flooding, and tracks system location.</p>
        </div>
        <div style={styles.descCard}>
          <p><strong>Design Goals:</strong> Efficient, cost-effective solution adhering to engineering standards.</p>
        </div>
        <div style={styles.descCard}>
          <p><strong>Testing & Reliability:</strong> Continuously evaluated for accuracy and performance.</p>
        </div>
      </div>

      {/* Developers */}
      <div style={styles.sectionHeader}>Meet the Developers</div>
      <div style={styles.devGrid}>
        {developers.map((dev, index) => (
          <div key={index} className="flip-card">
            <div className="flipInner">
              <div className="flipFront">
                <img src={dev.img} alt={dev.name} style={styles.devImg}/>
                <h3 style={styles.devName}>{dev.name}</h3>
                <p style={styles.devCourse}>{dev.course}</p>
              </div>
              <div className="flipBack">
                <h3>{dev.name}</h3>
                <p>Role: {dev.role}</p>
                <p>Email: {dev.email}</p>
                <p>{dev.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Prototype Gallery */}
      <div style={styles.sectionHeader}>Prototype Gallery</div>
      <div style={styles.albumContainer}>
        {prototypeImages.map((item, index) => (
          <div
            key={index}
            style={styles.albumItem}
            onClick={() => setSelectedImage({ img: item.img, index })}
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

      {/* Lightbox */}
      {selectedImage && (
        <div style={styles.overlay} onClick={() => setSelectedImage(null)}>
          <div style={styles.lightbox} onClick={(e) => e.stopPropagation()}>
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

    </div>
  );
};

const styles = {
  container: {
    width: '90%',
    maxWidth: '1200px',
    backgroundColor: '#fff',
    padding: '40px',
    borderRadius: '15px',
    boxShadow: '0 8px 20px rgba(0,0,0,0.1)',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    margin: '20px auto' // center the container
  },
  topImageContainer: { display: 'flex', justifyContent: 'center', marginBottom: '25px' },
  topImage: { width: '150px' },
  header: { fontSize: '2.4rem', fontWeight: '700', marginBottom: '30px', color:'#0F1B34' },
  descGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '20px', marginBottom: '50px' },
  descCard: { backgroundColor: '#0F1B34', padding: '20px', borderRadius: '12px' },
  sectionHeader: { fontSize: '2rem', marginBottom: '30px', fontWeight: '700' },
  devGrid: { display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '25px', marginBottom: '50px' },
  devImg: { width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover', marginBottom: '12px' },
  devName: { fontSize: '1rem', fontWeight: '600', color: '#fff' },
  devCourse: { fontSize: '0.85rem', color: '#fff' },
  albumContainer: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '20px' },
  albumItem: { cursor: 'pointer' },
  albumImg: { width: '100%', height: '200px', objectFit: 'cover', borderRadius: '8px' },
  caption: { marginTop: '8px', fontSize: '0.85rem', color: '#1E293B' },
  overlay: { position: 'fixed', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center' },
  lightbox: { background:'#fff', padding:'20px', borderRadius:'12px', maxWidth:'700px', width:'90%', position:'relative' },
  lightboxImg: { width:'100%', maxHeight:'70vh', objectFit:'contain' },
  closeBtn: { position:'absolute', top:'10px', right:'15px', fontSize:'2rem', border:'none', background:'transparent', cursor:'pointer' },
  lightboxCaption: { marginTop:'10px',  color: '#1E293B' },
  footer: { marginTop:'40px', borderTop:'1px solid #ddd', paddingTop:'20px' }
};

export default About;
