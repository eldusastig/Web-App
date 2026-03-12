import React, { useState } from "react";
import "./About.css";

const About = () => {

  const [selectedImage, setSelectedImage] = useState(null);

  const developers = [
    { name: "Dhafny Buenafe", course: "BS Computer Engineering", desc: "Specializes in Intelligent Systems.", img: "Buenafe.png", role: "Team Lead", email: "dhafnybuenafe01@email.com" },
    { name: "Patrick Jordan Cabanatan", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Cabanatan.png", role: "Backend Dev", email: "patrick@email.com" },
    { name: "Jethro Duque", course: "BS Computer Engineering", desc: "Specializes in Railway Engineering.", img: "Duque.jpg", role: "Frontend Dev", email: "jethro@email.com" },
    { name: "Rens Españo", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Espano.png", role: "QA Tester", email: "rens@email.com" },
    { name: "Justin Jello Repani", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Repani.png", role: "UI Designer", email: "justin@email.com" },
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
        <img src="EcotrackLogo.png" alt="EcoTrack" style={styles.topImage} />
      </div>

      {/* Header */}
      <div style={styles.header}>
        About the Debris Detection System
      </div>

      {/* Description */}
      <div style={styles.descGrid}>

        <div style={styles.descCard}>
          <p><strong>Debris Removal:</strong> Detects and removes debris from drainage inlets.</p>
        </div>

        <div style={styles.descCard}>
          <p><strong>Monitoring:</strong> Sends alerts when bins are full and detects flooding.</p>
        </div>

        <div style={styles.descCard}>
          <p><strong>Design Goals:</strong> Efficient and cost-effective engineering solution.</p>
        </div>

        <div style={styles.descCard}>
          <p><strong>Testing:</strong> Evaluated for accuracy in real-world conditions.</p>
        </div>

      </div>

      {/* Developers */}
      <div style={styles.sectionHeader}>Meet the Developers</div>

      <div style={styles.devGrid}>
        {developers.map((dev, index) => (

          <div key={index} className="flip-card">

            <div className="flipInner">

              {/* FRONT */}
              <div className="flipFront">
                <img src={dev.img} alt={dev.name} style={{width:"80px",borderRadius:"50%"}} />
                <h3 style={styles.devName}>{dev.name}</h3>
                <p style={styles.devCourse}>{dev.course}</p>
              </div>

              {/* BACK */}
              <div className="flipBack">
                <h3>{dev.name}</h3>
                <p><strong>Role:</strong> {dev.role}</p>
                <p>{dev.email}</p>
                <p>{dev.desc}</p>
              </div>

            </div>

          </div>

        ))}
      </div>

      {/* Prototype Section */}
      <div style={styles.sectionHeader}>Prototype 3D</div>

      <div style={styles.albumContainer}>

        {prototypeImages.map((item, index) => (

          <div
            key={index}
            style={styles.albumItem}
            onClick={() => setSelectedImage(item.img)}
          >

            <img
              src={item.img}
              alt="prototype"
              style={styles.albumImg}
            />

            <p style={styles.caption}>{item.label}</p>

          </div>

        ))}

      </div>

      {/* Lightbox */}
      {selectedImage && (

        <div
          style={styles.overlay}
          onClick={() => setSelectedImage(null)}
        >

          <div
            style={styles.lightbox}
            onClick={(e)=>e.stopPropagation()}
          >

            <img
              src={selectedImage}
              alt="prototype"
              style={styles.lightboxImg}
            />

            <button
              style={styles.closeBtn}
              onClick={() => setSelectedImage(null)}
            >
              ×
            </button>

          </div>

        </div>

      )}

      {/* Footer */}
      <div style={styles.footer}>
        © 2026 EcoTrack Debris Detection System
      </div>

    </div>

  );
};

const styles = {

  container:{
    width:"90%",
    maxWidth:"1200px",
    margin:"0 auto",
    padding:"40px",
    textAlign:"center",
    fontFamily:"Arial"
  },

  topImageContainer:{
    marginBottom:"20px"
  },

  topImage:{
    width:"140px"
  },

  header:{
    fontSize:"2.2rem",
    fontWeight:"bold",
    marginBottom:"30px"
  },

  descGrid:{
    display:"grid",
    gridTemplateColumns:"repeat(2,1fr)",
    gap:"20px",
    marginBottom:"50px"
  },

  descCard:{
    background:"#1E293B",
    color:"#fff",
    padding:"20px",
    borderRadius:"10px"
  },

  sectionHeader:{
    fontSize:"1.8rem",
    marginBottom:"30px"
  },

  devGrid:{
    display:"flex",
    flexWrap:"wrap",
    justifyContent:"center",
    gap:"25px",
    marginBottom:"50px"
  },

  devName:{
    fontSize:"1rem"
  },

  devCourse:{
    fontSize:"0.85rem"
  },

  albumContainer:{
    display:"grid",
    gridTemplateColumns:"repeat(3,1fr)",
    gap:"20px"
  },

  albumItem:{
    cursor:"pointer"
  },

  albumImg:{
    width:"100%",
    height:"200px",
    objectFit:"cover",
    borderRadius:"8px"
  },

  caption:{
    marginTop:"5px",
    fontSize:"0.85rem"
  },

  overlay:{
    position:"fixed",
    top:0,
    left:0,
    right:0,
    bottom:0,
    background:"rgba(0,0,0,0.7)",
    display:"flex",
    justifyContent:"center",
    alignItems:"center"
  },

  lightbox:{
    position:"relative",
    background:"#fff",
    padding:"20px",
    borderRadius:"10px"
  },

  lightboxImg:{
    maxWidth:"600px",
    maxHeight:"70vh"
  },

  closeBtn:{
    position:"absolute",
    top:"10px",
    right:"15px",
    fontSize:"2rem",
    background:"none",
    border:"none",
    cursor:"pointer"
  },

  footer:{
    marginTop:"40px",
    fontSize:"0.9rem"
  }

};

export default About;
