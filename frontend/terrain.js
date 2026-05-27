// terrain.js — PAL-AI 3D Terrain Analysis Module
// Uses Three.js for 3D rendering + OpenTopoData API for elevation

const Terrain = (() => {
  let scene, camera, renderer, controls, mesh, wireframeMesh;
  let resizeHandler = null;
  let animationId = null;
  let isWireframe = true;
  let isExaggerated = false;
  let isAnimating = true;
  let terrainData = null;
  let profileChart = null;
  let currentMode = 'suitability';
  let isRendererPaused = false;

  const GRID_RESOLUTION = 60;
  const TERRAIN_SIZE = 18;

  // Realistic vertical scaling.
  // Lower values = flatter and more realistic.
  const EXAGGERATION = 2.2;
  const BASE_EXAGGERATION = 0.7;

  let currentExaggeration = BASE_EXAGGERATION;

  // Color palettes per mode
  const COLOR_MAPS = {
    elevation: [
      { t: 0.0, r: 0.05, g: 0.18, b: 0.42 }, // deep water
      { t: 0.08, r: 0.13, g: 0.44, b: 0.71 }, // water
      { t: 0.15, r: 0.42, g: 0.68, b: 0.42 }, // lowland green
      { t: 0.30, r: 0.19, g: 0.64, b: 0.33 }, // mid green
      { t: 0.50, r: 0.50, g: 0.75, b: 0.31 }, // light green
      { t: 0.65, r: 0.62, g: 0.52, b: 0.30 }, // brown
      { t: 0.80, r: 0.55, g: 0.42, b: 0.25 }, // dark brown
      { t: 0.90, r: 0.72, g: 0.72, b: 0.72 }, // gray rock
      { t: 1.0, r: 1.00, g: 1.00, b: 1.00 }, // snow white
    ],
    slope: [
      { t: 0.0, r: 0.20, g: 0.80, b: 0.20 }, // flat = green
      { t: 0.25, r: 0.85, g: 0.85, b: 0.10 }, // gentle = yellow
      { t: 0.55, r: 1.00, g: 0.55, b: 0.00 }, // moderate = orange
      { t: 0.80, r: 0.90, g: 0.15, b: 0.10 }, // steep = red
      { t: 1.0, r: 0.60, g: 0.05, b: 0.05 }, // extreme = dark red
    ],
    aspect: [
      { t: 0.0, r: 1.0, g: 0.3, b: 0.3 }, // N
      { t: 0.25, r: 1.0, g: 0.9, b: 0.2 }, // E
      { t: 0.5, r: 0.3, g: 0.8, b: 1.0 }, // S
      { t: 0.75, r: 0.5, g: 0.3, b: 1.0 }, // W
      { t: 1.0, r: 1.0, g: 0.3, b: 0.3 }, // back to N
    ],
    suitability: [
      { t: 0.0, r: 0.78, g: 0.28, b: 0.24 }, // lighter red
      { t: 0.35, r: 0.82, g: 0.54, b: 0.24 }, // lighter orange
      { t: 0.60, r: 0.80, g: 0.74, b: 0.30 }, // lighter mustard
      { t: 0.80, r: 0.56, g: 0.74, b: 0.32 }, // lighter olive-green
      { t: 1.0, r: 0.24, g: 0.62, b: 0.34 }, // lighter green
    ],
  };

  function lerpColor(map, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < map.length - 1; i++) {
      if (t <= map[i + 1].t) {
        const s = (t - map[i].t) / (map[i + 1].t - map[i].t);
        return {
          r: map[i].r + s * (map[i + 1].r - map[i].r),
          g: map[i].g + s * (map[i + 1].g - map[i].g),
          b: map[i].b + s * (map[i + 1].b - map[i].b),
        };
      }
    }
    return map[map.length - 1];
  }

  // ── Generate synthetic DEM using Perlin-like noise ──
  // Falls back to this if API unavailable
  function syntheticElevation(lat, lng, gridX, gridY, gridSize) {
    // Use lat/lng as seed for "realistic" variation
    const seed = (lat * 73856093) ^ (lng * 19349663);
    const rng = (n) => Math.abs(Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453) % 1;

    const nx = gridX / GRID_RESOLUTION;
    const ny = gridY / GRID_RESOLUTION;

    // Multi-octave noise simulation
    let elev = 0;
    let amp = 1; let freq = 1; let maxAmp = 0;
    for (let o = 0; o < 5; o++) {
      const ix = Math.floor(nx * freq * 8);
      const iy = Math.floor(ny * freq * 8);
      const fx = nx * freq * 8 - ix;
      const fy = ny * freq * 8 - iy;
      const n00 = rng(ix + iy * 137 + o * 1000);
      const n10 = rng(ix + 1 + iy * 137 + o * 1000);
      const n01 = rng(ix + (iy + 1) * 137 + o * 1000);
      const n11 = rng(ix + 1 + (iy + 1) * 137 + o * 1000);
      const bx = fx * fx * (3 - 2 * fx);
      const by = fy * fy * (3 - 2 * fy);
      const n = n00 + (n10 - n00) * bx + (n01 - n00) * by + (n00 - n10 - n01 + n11) * bx * by;
      elev += n * amp;
      maxAmp += amp; amp *= 0.5; freq *= 2.2;
    }
    elev = elev / maxAmp;

    // Scale based on typical Philippine elevation patterns
    const isCoastal = (lat < 8.5 && lat > 7.5) || (gridX < 3 || gridX > GRID_RESOLUTION - 3);
    // Much flatter fallback terrain.
    // This should only be used when real DEM data is unavailable.
    const baseMult = isCoastal ? 18 : 55;
    return Math.max(0, elev * baseMult + (rng(lat * 100) * 5));
  }

  // ── Fetch DEM from OpenTopoData (or fall back to synthetic) ──
  async function fetchElevations(lat, lng, gridKm) {
    const degPerKm = 0.009; // ~1km in degrees
    const half = (gridKm / 2) * degPerKm;
    const step = (gridKm * degPerKm) / GRID_RESOLUTION;

    const points = [];
    for (let gy = 0; gy <= GRID_RESOLUTION; gy++) {
      for (let gx = 0; gx <= GRID_RESOLUTION; gx++) {
        const pLat = lat - half + gy * step;
        const pLng = lng - half + gx * step;
        points.push({ lat: pLat, lng: pLng, gx, gy });
      }
    }

    // Try fetching real DEM in batches of 100
    const elevGrid = new Array((GRID_RESOLUTION + 1) * (GRID_RESOLUTION + 1));
    let usedAPI = false;

    try {
      const BATCH_SIZE = 100;

      for (let start = 0; start < points.length; start += BATCH_SIZE) {
        const batchPoints = points.slice(start, start + BATCH_SIZE);

        const batch = batchPoints
          .map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
          .join('|');

        const url = `https://api.opentopodata.org/v1/srtm30m?locations=${batch}`;

        const resp = await Promise.race([
          fetch(url),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
        ]);

        if (resp.ok) {
          const json = await resp.json();

          if (json.results && json.results.length > 0) {
            json.results.forEach((r, i) => {
              const p = batchPoints[i];

              if (p && r.elevation !== null && r.elevation !== undefined) {
                elevGrid[p.gy * (GRID_RESOLUTION + 1) + p.gx] = r.elevation;
                usedAPI = true;
              }
            });
          }
        }

        // Avoid hammering the free elevation API.
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    } catch (e) {
      console.warn("OpenTopoData failed or timed out. Filling missing points with synthetic fallback.", e);
    }

    // Fill remaining with synthetic
    points.forEach(p => {
      const idx = p.gy * (GRID_RESOLUTION + 1) + p.gx;
      if (elevGrid[idx] === undefined || elevGrid[idx] === null) {
        elevGrid[idx] = syntheticElevation(lat, lng, p.gx, p.gy, gridKm);
      }
    });

    return { elevGrid, usedAPI, step, half, lat, lng };
  }

  // ── Compute slope + aspect ──
  function computeSlopeAspect(elevGrid, step) {
    const N = GRID_RESOLUTION + 1;
    const degPerM = 1 / 111000; // ~1m in degrees
    const slopeGrid = [];
    const aspectGrid = [];

    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const e = (r, c) => {
          const ri = Math.min(Math.max(r, 0), N - 1);
          const ci = Math.min(Math.max(c, 0), N - 1);
          return elevGrid[ri * N + ci];
        };
        const stepM = step / degPerM;
        const dzdx = (e(gy, gx + 1) - e(gy, gx - 1)) / (2 * stepM);
        const dzdy = (e(gy + 1, gx) - e(gy - 1, gx)) / (2 * stepM);
        const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;
        const aspect = (Math.atan2(-dzdy, dzdx) * 180 / Math.PI + 360) % 360;
        slopeGrid.push(slopeDeg);
        aspectGrid.push(aspect);
      }
    }
    return { slopeGrid, aspectGrid };
  }

  function applyDefaultTerrainCamera() {
    if (!camera) return;

    // Default cinematic planning view:
    // x = left/right, y = height, z = zoom distance
    camera.position.set(0, 2.5, 7);
    camera.lookAt(0, 1.2, 0);

    if (controls) {
      controls.target.set(0, 1.2, 0);
      controls.autoRotate = false;
      controls.update();
    }
  }

  function disposeWebGLScene() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }

    if (controls) {
      controls.dispose();
      controls = null;
    }

    if (scene) {
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();

        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => mat.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }

    if (renderer) {
      renderer.dispose();
      renderer = null;
    }

    scene = null;
    camera = null;
    mesh = null;
    wireframeMesh = null;
  }

  function getFreshTerrainCanvas() {
    const oldCanvas = document.getElementById('terrain-canvas');
    if (!oldCanvas) return null;

    // If a WebGL context failed/lost before, the safest recovery is a fresh canvas.
    const freshCanvas = oldCanvas.cloneNode(false);
    freshCanvas.id = 'terrain-canvas';
    freshCanvas.className = oldCanvas.className;
    oldCanvas.parentNode.replaceChild(freshCanvas, oldCanvas);

    return freshCanvas;
  }

  // ── Build Three.js scene ──
  function buildScene(canvas) {
    if (!window.WebGLRenderingContext) {
      throw new Error('WebGL is not supported or is disabled in this browser.');
    }

    // Always use a fresh canvas when creating a new renderer.
    // This avoids reusing a canvas whose WebGL context was lost during previous attempts.
    canvas = getFreshTerrainCanvas() || canvas;

    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 460;

    let newRenderer = null;

    try {
      newRenderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: false,
        preserveDrawingBuffer: false,
        precision: 'mediump'
      });
    } catch (err) {
      // Do not leave half-created scene state behind.
      renderer = null;
      scene = null;
      camera = null;
      controls = null;

      throw new Error(
        'Error creating WebGL context. Close other heavy tabs, open PAL-AI in a fresh browser tab, then try again. Original error: ' +
        (err && err.message ? err.message : err)
      );
    }

    renderer = newRenderer;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    // Transparent renderer background so CSS gradient shows through.
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = false;

    scene = new THREE.Scene();

    // Keep scene transparent so the CSS space background behind the canvas remains visible.
    scene.background = null;

    // Dark blue atmospheric fog, but not fully opaque.
    scene.fog = new THREE.FogExp2(0x07111f, 0.012);

    camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 2000);
    camera.position.set(0, 9.5, 28);
    camera.lookAt(0, 1.2, 0);

    canvas.addEventListener('webglcontextlost', function (event) {
      event.preventDefault();
      console.warn('PAL-AI WebGL context lost.');

      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      renderer = null;
    }, false);

    canvas.addEventListener('webglcontextrestored', function () {
      console.warn('PAL-AI WebGL context restored. Re-rendering terrain.');

      renderer = null;
      animationId = null;

      // The main app recovery guard will redraw charts/maps.
      // User can click Generate 3D Terrain again if the actual WebGL mesh needs full rebuilding.
      if (window.schedulePALAIVisualRecovery) {
        window.schedulePALAIVisualRecovery('webgl-restored');
      }
    }, false);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xb8c4d6, 0.5);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1f2a1f, 0.4);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 0.5);
    sunLight.position.set(8, 14, 10);
    sunLight.castShadow = false;
    scene.add(sunLight);

    // Star field background
    const starGeo = new THREE.BufferGeometry();
    const starVerts = [];
    for (let i = 0; i < 350; i++) {
      starVerts.push((Math.random() - 0.5) * 400, (Math.random() * 100), (Math.random() - 0.5) * 400);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.45 });
    scene.add(new THREE.Points(starGeo, starMat));

    // OrbitControls
    if (!THREE.OrbitControls) {
      console.error("OrbitControls failed to load. Check the Three.js CDN script in index.html.");
    } else {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0);
      controls.update();

      controls.enabled = true;
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;

      controls.enableRotate = true;
      controls.enablePan = true;
      controls.enableZoom = true;

      controls.screenSpacePanning = true;

      controls.minDistance = 2;
      controls.maxDistance = 120;
      controls.maxPolarAngle = Math.PI / 2.05;

      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };

      controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
      };

      renderer.domElement.style.pointerEvents = "auto";

      renderer.domElement.addEventListener("wheel", function (e) {
        e.preventDefault();
      }, { passive: false });
    }

    resizeHandler = () => {
      if (!renderer || !camera) return;

      const canvasNow = document.getElementById('terrain-canvas');
      if (!canvasNow) return;

      const w2 = canvasNow.clientWidth || 800;
      const h2 = canvasNow.clientHeight || 460;

      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2, false);
    };

    window.addEventListener('resize', resizeHandler);
  }


  // ── Build terrain geometry ──
  function buildTerrainMesh(elevGrid, slopeGrid, mode) {
    const N = GRID_RESOLUTION + 1;
    const SIZE = TERRAIN_SIZE;

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const indices = [];

    // Clamp extreme elevation outliers so one bad DEM point does not create huge fake mountains.
    const sortedElev = [...elevGrid].sort((a, b) => a - b);
    const p02 = sortedElev[Math.floor(sortedElev.length * 0.02)];
    const p98 = sortedElev[Math.floor(sortedElev.length * 0.98)];

    const safeElevGrid = elevGrid.map(e => Math.min(Math.max(e, p02), p98));

    const minE = Math.min(...safeElevGrid);
    const maxE = Math.max(...safeElevGrid);
    const rangeE = maxE - minE || 1;
    const avgE = safeElevGrid.reduce((a, b) => a + b, 0) / safeElevGrid.length;

    // Realistic vertical scale.
    // Example: 120 meters of elevation difference = 1 Three.js vertical unit.
    const METERS_PER_VERTICAL_UNIT = 120;

    const maxSlope = Math.max(...slopeGrid) || 1;

    // Vertices
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        const idx = gy * N + gx;
        const e = safeElevGrid ? safeElevGrid[idx] : elevGrid[idx];
        const tNorm = (e - minE) / rangeE;

        // Balanced terrain height.
        // Smaller METERS_PER_VERTICAL_UNIT = more visible hills.
        // Larger METERS_PER_VERTICAL_UNIT = flatter terrain.
        const METERS_PER_VERTICAL_UNIT = 45;

        let y = ((e - avgE) / METERS_PER_VERTICAL_UNIT) * currentExaggeration;

        // Prevent extreme spikes but still allow visible relief.
        y = Math.max(-2.5, Math.min(4.0, y));

        const x = (gx / GRID_RESOLUTION - 0.5) * SIZE;
        const z = (gy / GRID_RESOLUTION - 0.5) * SIZE;

        positions.push(x, y, z);

        // Color based on mode
        let t;
        if (mode === 'elevation') {
          t = tNorm;
        } else if (mode === 'slope') {
          t = Math.min(slopeGrid[idx] / 45, 1);
        } else if (mode === 'aspect') {
          t = 0.5;
        } else if (mode === 'yield' || mode === 'suitability') {
          const slope = slopeGrid[idx];

          let slopeScore;
          if (slope < 3) slopeScore = 1.0;
          else if (slope < 8) slopeScore = 0.72;
          else if (slope < 15) slopeScore = 0.42;
          else slopeScore = 0.12;

          const elevationScore = 1 - Math.min(tNorm * 1.25, 1);

          t = Math.max(0, Math.min(1, slopeScore * 0.72 + elevationScore * 0.28));
        } else {
          t = tNorm;
        }

        const c = lerpColor(COLOR_MAPS[mode] || COLOR_MAPS.elevation, t);
        colors.push(c.r, c.g, c.b);
      }
    }

    // Faces
    for (let gy = 0; gy < GRID_RESOLUTION; gy++) {
      for (let gx = 0; gx < GRID_RESOLUTION; gx++) {
        const a = gy * N + gx;
        const b = gy * N + gx + 1;
        const c = (gy + 1) * N + gx;
        const d = (gy + 1) * N + gx + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide
    });
    return new THREE.Mesh(geometry, material);
  }

  // ── Public API ──
  async function init(lat, lng, gridKm, mode) {
    currentMode = mode;
    const canvas = document.getElementById('terrain-canvas');
    const placeholder = document.getElementById('terrain-placeholder');
    if (!canvas) return;

    placeholder.style.display = 'none';

    if (!scene || !renderer || !camera) {
      buildScene(canvas);
    }

    // Clear old terrain
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
    if (wireframeMesh) { scene.remove(wireframeMesh); wireframeMesh.geometry.dispose(); wireframeMesh.material.dispose(); }


    // Fetch elevation data
    const result = await fetchElevations(lat, lng, gridKm);
    const { elevGrid, slopeGrid, aspectGrid } = { ...result, ...computeSlopeAspect(result.elevGrid, result.step) };

    terrainData = {
      elevGrid,
      slopeGrid,
      aspectGrid,
      lat,
      lng,
      gridKm,
      gridResolution: GRID_RESOLUTION,
      minE: Math.min(...elevGrid),
      maxE: Math.max(...elevGrid),
      avgE: elevGrid.reduce((a, b) => a + b, 0) / elevGrid.length,
      usedAPI: result.usedAPI
    };

    // Update legend
    updateLegend(mode);

    mesh = buildTerrainMesh(elevGrid, slopeGrid, mode);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    scene.add(mesh);

    applyDefaultTerrainCamera();

    console.log("Terrain mesh added:", {
      vertices: mesh.geometry.attributes.position.count,
      sceneChildren: scene.children.length,
      meshVisible: mesh.visible
    });

    // Force camera to frame the terrain after mesh creation.
    camera.position.set(0, 13, 24);
    camera.lookAt(0, 0, 0);

    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }


    // Wireframe overlay
    const wfMat = new THREE.MeshBasicMaterial({
      color: 0xd9f99d,
      wireframe: true,
      transparent: true,
      opacity: isWireframe ? 0.55 : 0.0,
      depthTest: false
    });
    wireframeMesh = new THREE.Mesh(mesh.geometry.clone(), wfMat);
    scene.add(wireframeMesh);

    // Update overlay info
    document.getElementById('toi-elev').textContent = `Elevation: ${Math.round(terrainData.avgE)}m avg`;
    const avgSlope = slopeGrid.reduce((a, b) => a + b, 0) / slopeGrid.length;
    document.getElementById('toi-slope').textContent = `Slope: ${avgSlope.toFixed(1)}° avg`;
    const aspectNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const avgAspect = aspectGrid.reduce((a, b) => a + b, 0) / aspectGrid.length;
    document.getElementById('toi-aspect').textContent = `Aspect: ${aspectNames[Math.round(avgAspect / 45) % 8]}`;


    // Start animation
    if (!animationId) animate();

    return terrainData;
  }

  function animate() {
    if (isRendererPaused || document.hidden) {
      animationId = null;
      return;
    }

    // Stop safely if WebGL objects were reset or failed.
    if (!renderer || !scene || !camera) {
      animationId = null;
      return;
    }

    animationId = requestAnimationFrame(animate);

    try {
      if (controls) controls.update();

      if (controls) {
        controls.autoRotate = !!isAnimating;
        controls.autoRotateSpeed = 0.5;
      }

      // Update compass
      if (camera && controls) {
        const dx = camera.position.x - controls.target.x;
        const dz = camera.position.z - controls.target.z;
        const angle = Math.atan2(dx, dz) * 180 / Math.PI;
        const compass = document.getElementById('terrain-compass');
        if (compass) compass.style.transform = `rotate(${-angle}deg)`;
      }

      renderer.render(scene, camera);
    } catch (err) {
      console.warn('Terrain render paused after renderer error:', err);
      animationId = null;
    }
  }

  function renderOnce() {
    if (!renderer || !scene || !camera) return;

    try {
      if (controls) controls.update();
      renderer.render(scene, camera);
    } catch (err) {
      console.warn('Terrain renderOnce failed:', err);
    }
  }

  function pauseRenderer() {
    isRendererPaused = true;

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function resumeRenderer() {
    if (!renderer || !scene || !camera) return;

    isRendererPaused = false;
    renderOnce();

    if (!animationId) {
      animate();
    }
  }

  function resetCamera() {
    applyDefaultTerrainCamera();
  }

  function toggleWireframe() {
    if (!wireframeMesh) return;
    isWireframe = !isWireframe;
    wireframeMesh.material.opacity = isWireframe ? 0.55 : 0.0;
  }

  function toggleExaggeration() {
    if (!mesh || !terrainData) return;
    isExaggerated = !isExaggerated;
    currentExaggeration = isExaggerated ? EXAGGERATION : BASE_EXAGGERATION;
    // Rebuild with new exaggeration
    const { elevGrid, slopeGrid } = terrainData;
    scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
    scene.remove(wireframeMesh); wireframeMesh.geometry.dispose(); wireframeMesh.material.dispose();
    mesh = buildTerrainMesh(elevGrid, slopeGrid, currentMode);
    mesh.receiveShadow = false; mesh.castShadow = false;
    scene.add(mesh);
    const wfMat = new THREE.MeshBasicMaterial({
      color: 0xd9f99d,
      wireframe: true,
      transparent: true,
      opacity: isWireframe ? 0.55 : 0.0,
      depthTest: false
    });
    wireframeMesh = new THREE.Mesh(mesh.geometry.clone(), wfMat);
    scene.add(wireframeMesh);
  }

  function toggleAnimation() {
    isAnimating = !isAnimating;
  }

  function updateMode(mode) {
    if (!terrainData) return;
    currentMode = mode;
    const { elevGrid, slopeGrid } = terrainData;
    scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
    scene.remove(wireframeMesh); wireframeMesh.geometry.dispose(); wireframeMesh.material.dispose();
    mesh = buildTerrainMesh(elevGrid, slopeGrid, mode);
    mesh.receiveShadow = false; mesh.castShadow = false;
    scene.add(mesh);
    const wfMat = new THREE.MeshBasicMaterial({
      color: 0xd9f99d,
      wireframe: true,
      transparent: true,
      opacity: isWireframe ? 0.55 : 0.0,
      depthTest: false
    });
    wireframeMesh = new THREE.Mesh(mesh.geometry.clone(), wfMat);
    scene.add(wireframeMesh);
    updateLegend(mode);
  }

  function updateLegend(mode) {
    const legends = {
      suitability: 'Planting Suitability',
      yield: 'Planting Suitability',
      elevation: 'Elevation (m)',
      slope: 'Slope (0° – 45°+)',
      aspect: 'Aspect (N/E/S/W)'
    };

    const title = document.querySelector('.tl-title');
    const bar = document.querySelector('.tl-bar');
    const min = document.getElementById('tl-min');
    const max = document.getElementById('tl-max');

    if (title) title.textContent = legends[mode] || 'Planting Suitability';

    if (!bar) return;

    if (mode === 'suitability' || mode === 'yield') {
      bar.style.background = 'linear-gradient(to right, #c84a3f, #d08a3d, #c8b54a, #8fba52, #3b9957)';
      if (min) min.textContent = 'Poor';
      if (max) max.textContent = 'Best';
    } else if (mode === 'slope') {
      bar.style.background = 'linear-gradient(to right, #466b4b, #77743a, #7a5630, #5b2525)';
      if (min) min.textContent = 'Flat';
      if (max) max.textContent = 'Steep';
    } else if (mode === 'aspect') {
      bar.style.background = 'linear-gradient(to right, #744040, #80773a, #35636f, #4a3b72, #744040)';
      if (min) min.textContent = 'N';
      if (max) max.textContent = 'N';
    } else {
      bar.style.background = 'linear-gradient(to right,#1e3a5f,#2f6f8f,#466b4b,#77743a,#7a5630,#d1d5db)';
      if (terrainData) {
        if (min) min.textContent = Math.round(terrainData.minE) + 'm';
        if (max) max.textContent = Math.round(terrainData.maxE) + 'm';
      }
    }
  }


  // ── Scoring Mathematics ──
  function computeScores(data) {
    const { elevGrid, slopeGrid, aspectGrid, minE, maxE, avgE } = data;
    const N = elevGrid.length;

    // --- Slope scoring ---
    const avgSlope = slopeGrid.reduce((a, b) => a + b, 0) / N;
    const flatFraction = slopeGrid.filter(s => s < 3).length / N;  // < 3° is ideal
    const mildFraction = slopeGrid.filter(s => s >= 3 && s < 8).length / N;
    const steepFraction = slopeGrid.filter(s => s >= 15).length / N;

    // Slope score: flat is best for paddy rice, max penalty at >15°
    let slopeScore = 100;
    if (avgSlope > 2) slopeScore -= Math.min(50, (avgSlope - 2) * 4);
    slopeScore -= steepFraction * 30;
    slopeScore = Math.max(0, Math.min(100, slopeScore));

    // --- Elevation scoring ---
    // Rice optimal: 0–600m, degrades above 1000m
    let elevScore = 100;
    if (avgE > 600) elevScore -= Math.min(50, (avgE - 600) / 20);
    if (avgE > 1000) elevScore -= Math.min(30, (avgE - 1000) / 25);
    elevScore = Math.max(0, Math.min(100, elevScore));

    // --- Aspect scoring ---
    // SE/S facing is best for sun exposure in PH
    const idealAspects = aspectGrid.filter(a => a >= 100 && a <= 220).length / N;
    const aspectScore = 50 + idealAspects * 50;

    // --- Drainage (from elevation range + slope) ---
    const elevRange = maxE - minE;
    let drainageScore = 100;
    if (flatFraction > 0.7) drainageScore -= 20; // too flat = waterlogging risk
    if (avgSlope > 10) drainageScore -= 15; // too steep = erosion risk
    drainageScore = Math.max(30, Math.min(100, drainageScore));

    // --- Topography composite score ---
    const topoScore = Math.round(
      slopeScore * 0.40 +
      elevScore * 0.30 +
      aspectScore * 0.15 +
      drainageScore * 0.15
    );

    // --- Soil inference from elevation + slope ──
    // Philippine soil classes inferred from terrain
    let soilType, soilFertility, soilpH, soilTexture;
    if (avgE < 50 && avgSlope < 3) {
      soilType = "Hydric Paddy Soil (Aquic)";
      soilFertility = "High"; soilpH = "5.5 – 6.5"; soilTexture = "Clay / Clay Loam";
    } else if (avgE < 200 && avgSlope < 5) {
      soilType = "Alluvial / Fluvisol";
      soilFertility = "High"; soilpH = "5.8 – 7.0"; soilTexture = "Sandy Loam to Clay";
    } else if (avgE < 500 && avgSlope < 10) {
      soilType = "Cambisol / Inceptisol";
      soilFertility = "Moderate"; soilpH = "5.0 – 6.5"; soilTexture = "Loam to Clay Loam";
    } else if (avgE < 1000) {
      soilType = "Oxisol / Ultisol (Upland)";
      soilFertility = "Low"; soilpH = "4.5 – 5.5"; soilTexture = "Clay (Weathered)";
    } else {
      soilType = "Entisol / Lithosol (Highland)";
      soilFertility = "Very Low"; soilpH = "4.2 – 5.0"; soilTexture = "Rocky / Sandy";
    }

    // --- Irrigation potential ---
    const elevVariance = elevGrid.reduce((sum, e) => sum + Math.pow(e - avgE, 2), 0) / N;
    const elevStdDev = Math.sqrt(elevVariance);
    let irrigationScore = 100;
    if (avgSlope > 5) irrigationScore -= Math.min(40, avgSlope * 3);
    if (avgE > 800) irrigationScore -= 30;
    if (flatFraction < 0.3) irrigationScore -= 20;
    irrigationScore = Math.max(10, Math.min(100, irrigationScore));

    const irrigationType = irrigationScore > 75 ? "Gravity-fed ideal" :
      irrigationScore > 50 ? "Pump irrigation viable" :
        irrigationScore > 30 ? "Difficult — rainfed only" : "Not recommended";

    // --- Yield impact calculation ---
    // Mathematical modifier: how much terrain affects yield vs ideal flat paddy
    // Based on slope penalty function from IRRI slope-yield research
    const slopeModifier = Math.exp(-0.035 * avgSlope);
    const elevationModifier = avgE < 600 ? 1.0 : Math.exp(-0.001 * (avgE - 600));
    const aspectModifier = 0.88 + (idealAspects * 0.12);
    const drainageModifier = drainageScore / 100 * 0.2 + 0.8;

    const overallModifier = slopeModifier * elevationModifier * aspectModifier * drainageModifier;
    const yieldImpactScore = Math.round(overallModifier * 100);

    return {
      topoScore,
      yieldImpactScore,
      overallModifier: overallModifier.toFixed(3),
      details: {
        elevation: { avgE, minE: data.minE, maxE: data.maxE, elevRange, elevScore },
        slope: { avgSlope, flatFraction, steepFraction, mildFraction, slopeScore },
        soil: { soilType, soilFertility, soilpH, soilTexture, drainageScore },
        irrigation: { irrigationScore, irrigationType, elevVariance: elevStdDev.toFixed(1) }
      }
    };
  }

  // ── Profile chart data ──
  function getCrossSection() {
    if (!terrainData) return [];
    const { elevGrid } = terrainData;
    const N = GRID_RESOLUTION + 1;
    const midRow = Math.floor(N / 2);
    return Array.from({ length: N }, (_, gx) => elevGrid[midRow * N + gx]);
  }

  return {
    init,
    resetCamera,
    toggleWireframe,
    toggleExaggeration,
    toggleAnimation,
    updateMode,
    computeScores,
    getCrossSection,
    disposeWebGLScene,
    pauseRenderer,
    resumeRenderer,
    renderOnce,
    getData: () => terrainData
  };
})();
