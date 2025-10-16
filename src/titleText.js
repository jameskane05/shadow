import * as THREE from "three";

/**
 * Creates text as particles using canvas-based texture
 * @param {THREE.Scene} scene - The scene to add the particles to
 * @param {Object} options - Configuration options
 * @returns {Object} Object with mesh (Points), particles array, and update function
 */
export function createParticleText(scene, options = {}) {
  const {
    text = "HELLO WORLD",
    font = "Arial",
    fontSize = 60,
    color = new THREE.Color(0xff00ff),
    position = { x: 0, y: 5, z: -2.5 },
    scale = 0.6 / 80,
    animate = true,
    particleDensity = 0.3, // Particles per pixel (lower = fewer particles)
  } = options;

  // Create canvas to render text
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // Set canvas size (larger for better quality)
  const canvasWidth = 2048;
  const canvasHeight = 1024;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  // Draw text on canvas
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.font = `${fontSize}px ${font}`;
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Handle multi-line text
  const lines = text.split("\n");
  const lineHeight = fontSize * 1.2;
  const startY = canvasHeight / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, canvasWidth / 2, startY + i * lineHeight);
  });

  // Sample pixels to create particles
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const particles = [];

  // Sample pixels at intervals based on density
  const step = Math.max(1, Math.floor(1 / particleDensity));

  for (let y = 0; y < canvasHeight; y += step) {
    for (let x = 0; x < canvasWidth; x += step) {
      const i = (y * canvasWidth + x) * 4;
      const brightness = imageData.data[i]; // Red channel (grayscale)

      // Only create particles for bright pixels (text)
      if (brightness > 128) {
        // Convert canvas coordinates to 3D space
        const px = ((x / canvasWidth - 0.5) * 10 * scale * canvasWidth) / 100;
        const py =
          (-(y / canvasHeight - 0.5) * 10 * scale * canvasHeight) / 100;
        const pz = 0;

        particles.push({
          position: new THREE.Vector3(px, py, pz),
          originalPosition: new THREE.Vector3(px, py, pz),
          velocity: new THREE.Vector3(0, 0, 0),
          scale: 1.0,
          opacity: 1.0,
          id: particles.length,
          normalizedX: x / canvasWidth, // 0 to 1, left to right
        });
      }
    }
  }

  // Create geometry and material for particles
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particles.length * 3);
  const colors = new Float32Array(particles.length * 3);
  const sizes = new Float32Array(particles.length);
  const opacities = new Float32Array(particles.length);

  particles.forEach((particle, i) => {
    positions[i * 3] = particle.position.x;
    positions[i * 3 + 1] = particle.position.y;
    positions[i * 3 + 2] = particle.position.z;

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = 0.15; // Increased from 0.05 for larger, more visible particles
    opacities[i] = 1.0;
  });

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("opacity", new THREE.BufferAttribute(opacities, 1));

  // Create custom shader material for particles with opacity control
  const material = new THREE.ShaderMaterial({
    uniforms: {
      pointTexture: { value: createCircleTexture() },
    },
    vertexShader: `
      attribute float size;
      attribute float opacity;
      varying float vOpacity;
      varying vec3 vColor;
      
      void main() {
        vOpacity = opacity;
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * 100.0 * (1.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D pointTexture;
      varying float vOpacity;
      varying vec3 vColor;
      
      void main() {
        vec4 texColor = texture2D(pointTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, texColor.a * vOpacity);
      }
    `,
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.position.set(position.x, position.y, position.z);
  scene.add(points);

  // Store particle data on the mesh for animation
  points.userData.particles = particles;
  points.userData.baseScale = scale;

  return {
    mesh: points,
    particles: particles,
    update: (time) => {
      if (!animate) return;

      // Gentle floating animation
      points.position.y = position.y + 0.1 * Math.sin(time / 500);

      // Gentle rotation
      points.rotation.y = 0.2 * Math.sin(time / 1000);
    },
  };
}

/**
 * Create a circular texture for particles
 */
function createCircleTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.5)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
