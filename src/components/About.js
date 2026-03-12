.flip-card {
  background-color: transparent;
  width: 200px;
  height: 300px;
  perspective: 1000px;
}

.flipInner {
  position: relative;
  width: 100%;
  height: 100%;
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
  border-radius: 12px;
  backface-visibility: hidden;
  padding: 15px;
  box-sizing: border-box;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.flipFront {
  background: #f8fafc;
}

.flipBack {
  background: #52baff;
  color: black;
  transform: rotateY(180deg);
  font-size: 0.85rem;
  text-align: center;
}

.flipBack p {
  word-break: break-word;
  overflow-wrap: anywhere;
  margin: 4px 0;
}

.flipFront img {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  object-fit: cover;
}
