import React from 'react'; 

const About = () => {
  const developers = [
    { name: "Dhafny Buenafe", course: "BS Computer Engineering", desc: "Specializes in Intelligent Systems.", img: "Buenafe.png" },
    { name: "Patrick Jordan Cabanatan", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Cabanatan.png" },
    { name: "Jethro Duque", course: "BS Computer Engineering", desc: "Specializes in Railway Engineering.", img: "Duque.jpg" },
    { name: "Rens Españo", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Espano.png" },
    { name: "Justin Jello Repani", course: "BS Computer Engineering", desc: "Specializes in Systems Administration.", img: "Repani.png" },
  ];

  return (
    <div style={styles.container}>
      {/* Centered logo before the About header */}
      <div style={styles.topImageContainer}>
        <img src="EcotrackLogo.png" alt="Debris Detection System" style={styles.topImage} />
      </div>

      {/* About Section */}
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

      {/* Fifth developer centered below */}
      <div style={styles.devCenter}>
        <div style={styles.devCard} className="dev-card">
          <img src={developers[4].img} alt={developers[4].name} style={styles.devImg} className="dev-img" />
          <h3 style={styles.devName}>{developers[4].name}</h3>
          <p style={styles.devCourse}>{developers[4].course}</p>
          <p style={styles.devDesc}>{developers[4].desc}</p>
        </div>
      </div>

      {/* Prototype Section */}
      <div style={styles.sectionHeader}>Prototype</div>
      <div style={styles.prototypeContainer}>
        <img src="Ecotrack2.jpg" alt="Prototype" style={styles.prototypeImg} />
      </div>

      {/* Extra CSS for hover effects */}
      <style>
        {`
          .dev-card {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          .dev-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.15);
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
    maxWidth: '1100px',
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
    backgroundColor: '#fdfdfd',
    padding: '25px',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
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
    color: '#2c3e50',
  },
  devCourse: {
    fontSize: '1rem',
    fontWeight: '500',
    color: '#444',
    marginBottom: '10px',
  },
  devDesc: {
    fontSize: '0.95rem',
    color: '#666',
    lineHeight: '1.5',
  },
  prototypeContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: '20px',
  },
  prototypeImg: {
    width: '100%',
    maxWidth: '650px',
    height: 'auto',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
};

export default About;
