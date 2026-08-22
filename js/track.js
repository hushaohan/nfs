/* =====================================================================
 * track.js — Track generation: spline circuit, road mesh, barriers,
 * scenery (trees, buildings, streetlights), and spatial queries used
 * by the AI and the game logic.
 * ===================================================================== */
"use strict";

class Track {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.key = opts.key || "downtown";
    this.name = opts.name || "DOWNTOWN CIRCUIT";
    this.env = opts.env || {};
    this.width = opts.width || 14;          // road half-width * 2
    this.halfW = this.width / 2;
    this.barrierDist = this.halfW + 1.2;    // distance of barriers from center
    this.samples = [];                      // dense sampled points
    this.length = 0;                        // total track length (m)
    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildControlPoints(opts.points);
    this._sampleSpline();
    this._buildRoad();
    this._buildTerrain();
    this._buildBarriers();
    this._buildStartLine();
    this._buildScenery();
  }

  /* ---------- control points (x, z, elevation y) ---------- */
  _buildControlPoints(points) {
    // default: hand-tuned flat street circuit — long straights, hairpins,
    // sweepers, chicane
    const P = points || [
      [   0,    0, 0], [ 120,    0, 0], [ 220,   10, 0], [ 300,   60, 0],
      [ 330,  150, 0], [ 300,  230, 0], [ 210,  260, 0], [ 120,  240, 0],
      [  60,  290, 0], [  90,  370, 0], [ 180,  400, 0], [ 280,  380, 0],
      [ 360,  420, 0], [ 380,  510, 0], [ 320,  580, 0], [ 210,  600, 0],
      [ 100,  570, 0], [  20,  490, 0], [ -60,  430, 0], [-150,  420, 0],
      [-230,  360, 0], [-260,  260, 0], [-230,  160, 0], [-150,  100, 0],
      [ -80,   50, 0],
    ];
    this.controlPoints = P.map(p => new THREE.Vector3(p[0], p[2] || 0, p[1]));
    // lift the whole loop so the lowest point sits just above the flat
    // terrain plane — otherwise downhill sections get buried under it
    const minY = Math.min(...this.controlPoints.map(p => p.y));
    if (minY < 1) {
      const lift = 1 - minY;
      for (const p of this.controlPoints) p.y += lift;
    }
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints, true, "catmullrom", 0.5);
  }

  /* ---------- dense sampling with arc-length table ---------- */
  _sampleSpline() {
    const N = 1400;
    this.samples = [];
    let acc = 0;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      tan.y = 0; tan.normalize();
      if (prev) acc += p.distanceTo(prev);
      this.samples.push({
        pos: p, tan,
        // left normal (perpendicular)
        nx: -tan.z, nz: tan.x,
        dist: acc, t,
      });
      prev = p;
    }
    this.length = acc + this.samples[0].pos.distanceTo(prev);
  }

  /* nearest sample index to a world point (coarse→fine) */
  nearestIndex(x, z, hint = -1) {
    let best = 0, bestD = Infinity;
    if (hint >= 0) {
      // local search around hint
      const N = this.samples.length;
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + N) % N;
        const s = this.samples[i];
        const dx = s.pos.x - x, dz = s.pos.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    for (let i = 0; i < this.samples.length; i += 4) {
      const s = this.samples[i];
      const dx = s.pos.x - x, dz = s.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    // refine
    const N = this.samples.length;
    for (let k = -4; k <= 4; k++) {
      const i = (best + k + N) % N;
      const s = this.samples[i];
      const dx = s.pos.x - x, dz = s.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* signed lateral offset from centerline (+ = left of direction) */
  lateralOffset(x, z, idx) {
    const s = this.samples[idx];
    return (x - s.pos.x) * s.nx + (z - s.pos.z) * s.nz;
  }

  /* point at normalized distance t (0..1) with lateral offset */
  pointAt(t, lateral = 0) {
    const N = this.samples.length;
    const i = ((t % 1) + 1) % 1 * N | 0;
    const s = this.samples[i % N];
    return {
      x: s.pos.x + s.nx * lateral,
      y: s.pos.y,
      z: s.pos.z + s.nz * lateral,
      tan: s.tan, idx: i % N,
    };
  }

  /* road surface height at a world point (nearest sample) */
  heightAt(x, z, hint = -1) {
    return this.samples[this.nearestIndex(x, z, hint)].pos.y;
  }

  /* track gradient dh/dd at sample idx (positive = climbing) */
  slopeAt(idx) {
    const N = this.samples.length;
    const a = this.samples[((idx - 3) % N + N) % N].pos.y;
    const b = this.samples[(idx + 3) % N].pos.y;
    const d = (this.length / N) * 6;   // arc length between the two probes
    return (b - a) / d;
  }

  /* ---------- road ribbon mesh ---------- */
  _buildRoad() {
    const N = this.samples.length;
    const positions = [];
    const uvs = [];
    const indices = [];
    const hw = this.halfW;

    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      const l = i / N * this.length;
      // left & right edge
      positions.push(s.pos.x + s.nx * hw, s.pos.y + 0.02, s.pos.z + s.nz * hw);
      positions.push(s.pos.x - s.nx * hw, s.pos.y + 0.02, s.pos.z - s.nz * hw);
      uvs.push(0, l / 8); uvs.push(1, l / 8);
      if (i < N) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const tex = this._makeRoadTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.92, metalness: 0.05, color: 0x9a9a9a,
    });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.group.add(road);

    /* optional neon edge strips (night tracks): unlit glowing rails that
     * trace the road so it reads clearly against a dark world */
    const eg = this.env.roadEdgeGlow;
    if (eg) {
      const N3 = Math.ceil(N / 3);
      const mkSide = (colorHex, sideSign) => {
        const mesh = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: colorHex }),
          N3
        );
        const dummy = new THREE.Object3D();
        let k = 0;
        for (let i = 0; i < N; i += 3) {
          const s = this.samples[i];
          const next = this.samples[(i + 3) % N];
          const segLen = s.pos.distanceTo(next.pos) * 1.12;
          dummy.position.set(
            s.pos.x + s.nx * sideSign * (this.halfW + 0.85),
            s.pos.y + 0.10,
            s.pos.z + s.nz * sideSign * (this.halfW + 0.85)
          );
          dummy.rotation.set(0, Math.atan2(next.pos.x - s.pos.x, next.pos.z - s.pos.z), 0);
          dummy.scale.set(0.14, 0.05, segLen);
          dummy.updateMatrix();
          mesh.setMatrixAt(k++, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.group.add(mesh);
      };
      mkSide(eg[0], 1);    // left edge
      mkSide(eg[1], -1);   // right edge
    }
  }

  /* ---------- embankment skirts: drop the road edges to the ground so
   * hilly sections look like solid earthworks instead of floating ribbons */
  /* ---------- rolling terrain that hugs the road ----------
   * A heightfield over the track bounds. Near the road it matches the
   * road elevation exactly (the landscape rises into the roadbed); with
   * distance it falls off into procedural grass hills. This replaces
   * the old flat ground plane so hilly tracks look like real hills.   */
  _buildTerrain() {
    const N = this.samples.length;

    // bounds + margin
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of this.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    const M = 150;
    minX -= M; minZ -= M; maxX += M; maxZ += M;
    const sx = maxX - minX, sz = maxZ - minZ;

    // spatial hash of samples for fast nearest-road queries
    const CS = 30;
    const buckets = new Map();
    this.samples.forEach((s, i) => {
      const k = Math.floor(s.pos.x / CS) + "_" + Math.floor(s.pos.z / CS);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    });
    const nearest = (x, z) => {
      const bx = Math.floor(x / CS), bz = Math.floor(z / CS);
      let best = -1, bd = Infinity;
      for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
        const arr = buckets.get((bx + ox) + "_" + (bz + oz));
        if (!arr) continue;
        for (const i of arr) {
          const s = this.samples[i];
          const dx = s.pos.x - x, dz = s.pos.z - z;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best < 0) {  // far outside coverage: coarse scan
        for (let i = 0; i < N; i += 4) {
          const s = this.samples[i];
          const dx = s.pos.x - x, dz = s.pos.z - z;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      return { d: Math.sqrt(bd), y: this.samples[best].pos.y };
    };

    // blend: road height near the road → procedural hills far away
    const inner = this.barrierDist + 5;
    const outer = inner + 62;
    const height = (x, z) => {
      const { d, y } = nearest(x, z);
      const road = y - 0.06;                       // tuck under the ribbon
      if (d <= inner) return road;
      // fade procedural hills toward the field border so no cliff shows
      const ex = Math.min(x - minX, maxX - x) / 120;
      const ez = Math.min(z - minZ, maxZ - z) / 120;
      const ef = 0.06 + 0.94 * Math.min(1, Math.max(0, Math.min(ex, ez)) * Math.min(1, Math.min(ex, ez)) * (3 - 2 * Math.min(1, Math.min(ex, ez))));
      const hills = Math.max(0.35, this._hillNoise(x, z)) * ef;
      if (d >= outer) return hills;
      const t = (d - inner) / (outer - inner);
      const sBlend = t * t * (3 - 2 * t);          // smoothstep
      return road * (1 - sBlend) + hills * sBlend;
    };
    this._terrainHeight = height;

    // grid mesh
    const cell = 3.4;
    const nx = Math.max(8, Math.min(250, Math.round(sx / cell)));
    const nz = Math.max(8, Math.min(250, Math.round(sz / cell)));
    const positions = [];
    const indices = [];
    for (let r = 0; r <= nz; r++) {
      for (let c = 0; c <= nx; c++) {
        const x = minX + sx * c / nx;
        const z = minZ + sz * r / nz;
        positions.push(x, height(x, z), z);
      }
    }
    for (let r = 0; r < nz; r++) {
      for (let c = 0; c < nx; c++) {
        const a = r * (nx + 1) + c, b = a + 1, d = a + nx + 1, e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: this.env.terrainColor !== undefined ? this.env.terrainColor : 0x22381f,
      roughness: 1,
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    this.group.add(terrain);

    // distant backdrop floor beyond the heightfield (fog hides the seam)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x1c2a1e, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((minX + maxX) / 2, -0.4, (minZ + maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /* smooth procedural hills for the away-from-road terrain */
  _hillNoise(x, z) {
    const amp = this.env.hillAmp !== undefined ? this.env.hillAmp : 1;
    const fr = this.env.hillFreq !== undefined ? this.env.hillFreq : 1;
    return 2.8
      + amp * (1.5 * Math.sin(x * 0.012 * fr + 1.3) * Math.cos(z * 0.010 * fr + 0.7)
             + 1.1 * Math.sin(x * 0.021 * fr + z * 0.017 * fr + 2.1)
             + 0.8 * Math.cos(x * 0.007 * fr - z * 0.008 * fr + 0.4));
  }

  _makeRoadTexture() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const g = c.getContext("2d");
    // asphalt base
    g.fillStyle = "#2b2d31";
    g.fillRect(0, 0, 256, 256);
    // noise
    for (let i = 0; i < 2600; i++) {
      const v = 38 + Math.random() * 26 | 0;
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    // edge lines
    g.fillStyle = "#d8d8d0";
    g.fillRect(6, 0, 5, 256);
    g.fillRect(245, 0, 5, 256);
    // dashed center line
    g.fillStyle = "#e8c840";
    for (let y = 0; y < 256; y += 64) g.fillRect(125, y, 6, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  /* ---------- barriers (red/white curbs + walls) ---------- */
  _buildBarriers() {
    const N = this.samples.length;
    const step = 3; // every 3rd sample
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const matRed = new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.7 });
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7 });
    const matCurbR = new THREE.MeshStandardMaterial({ color: 0xd0342c, roughness: 0.8 });
    const matCurbW = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8 });

    const walls = [];
    const curbs = [];
    for (let i = 0; i < N; i += step) {
      const s = this.samples[i];
      const next = this.samples[(i + step) % N];
      const segLen = s.pos.distanceTo(next.pos) * 1.15;
      const mx = (s.pos.x + next.pos.x) / 2, mz = (s.pos.z + next.pos.z) / 2;
      const ang = Math.atan2(next.pos.x - s.pos.x, next.pos.z - s.pos.z);
      const alt = (i / step) % 2 === 0;

      for (const side of [1, -1]) {
        const bx = mx + s.nx * side * this.barrierDist;
        const bz = mz + s.nz * side * this.barrierDist;
        walls.push({ x: bx, y: s.pos.y + 0.55, z: bz, ang, len: segLen, mat: alt ? matRed : matWhite });
        // curbs just inside the barrier
        const cx = mx + s.nx * side * (this.halfW + 0.35);
        const cz = mz + s.nz * side * (this.halfW + 0.35);
        curbs.push({ x: cx, y: s.pos.y + 0.06, z: cz, ang, len: segLen, mat: alt ? matCurbR : matCurbW });
      }
    }

    // merge via InstancedMesh for performance
    const wallMesh = new THREE.InstancedMesh(wallGeo, matRed, walls.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    walls.forEach((w, i) => {
      dummy.position.set(w.x, w.y, w.z);
      dummy.rotation.set(0, w.ang, 0);
      dummy.scale.set(0.5, 1.1, w.len);
      dummy.updateMatrix();
      wallMesh.setMatrixAt(i, dummy.matrix);
      wallMesh.setColorAt(i, color.setHex(w.mat === matRed ? 0xd0342c : 0xe8e8e8));
    });
    wallMesh.instanceMatrix.needsUpdate = true;
    wallMesh.castShadow = true;
    this.group.add(wallMesh);

    const curbMesh = new THREE.InstancedMesh(wallGeo, matCurbR, curbs.length);
    curbs.forEach((w, i) => {
      dummy.position.set(w.x, w.y, w.z);
      dummy.rotation.set(0, w.ang, 0);
      dummy.scale.set(1.1, 0.12, w.len);
      dummy.updateMatrix();
      curbMesh.setMatrixAt(i, dummy.matrix);
      curbMesh.setColorAt(i, color.setHex(w.mat === matCurbR ? 0xd0342c : 0xf0f0f0));
    });
    curbMesh.instanceMatrix.needsUpdate = true;
    this.group.add(curbMesh);
  }

  /* ---------- start / finish line ---------- */
  _buildStartLine() {
    const s = this.samples[0];
    const c = document.createElement("canvas");
    c.width = 128; c.height = 32;
    const g = c.getContext("2d");
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#eee";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(this.width, 3);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    const line = new THREE.Mesh(geo, mat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(s.pos.x, s.pos.y + 0.035, s.pos.z);
    line.rotation.z = Math.atan2(s.tan.x, s.tan.z);
    this.group.add(line);

    // gantry
    const gMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.6 });
    const postGeo = new THREE.BoxGeometry(0.5, 7, 0.5);
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(postGeo, gMat);
      post.position.set(s.pos.x + s.nx * side * (this.halfW + 2), s.pos.y + 3.5, s.pos.z + s.nz * side * (this.halfW + 2));
      post.castShadow = true;
      this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.width + 4, 1.2, 0.6), gMat);
    beam.position.set(s.pos.x, s.pos.y + 6.6, s.pos.z);
    // span ACROSS the road: align the beam's long (local X) axis with the
    // track normal, i.e. orthogonal to the driving direction
    beam.rotation.y = Math.atan2(-s.nz, s.nx);
    beam.castShadow = true;
    this.group.add(beam);
  }

  /* ---------- scenery: flora / buildings / streetlights ----------
   * Everything is driven by this.env so each track gets its own world:
   *   env.flora = null | { type:"pine"|"snowpine"|"cactus"|"rock"|"desert",
   *                        density, color, trunk }
   *   env.city  = null | { glow }          (window-lit buildings)
   *   env.lamps = null | { every, color }  (streetlight spacing/color) */
  _buildScenery() {
    const N = this.samples.length;
    const env = this.env;

    /* ----- flora ----- */
    const flora = env.flora;
    if (flora && flora.type) {
      const stride = Math.max(8, Math.round(22 / (flora.density || 1)));
      const spots = [];
      for (let i = 0; i < N; i += stride) {
        const s = this.samples[i];
        for (const side of [1, -1]) {
          if (Math.random() < 0.55) {
            const d = this.barrierDist + 6 + Math.random() * 26;
            spots.push({
              x: s.pos.x + s.nx * side * d,
              z: s.pos.z + s.nz * side * d,
              s: 0.8 + Math.random() * 0.9,
              kind: flora.type === "desert" ? (Math.random() < 0.5 ? "rock" : "cactus") : flora.type,
            });
          }
        }
      }

      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      const gy = (p) => this._terrainHeight(p.x, p.z);

      if (flora.type === "pine" || flora.type === "snowpine") {
        const trunkMat = new THREE.MeshStandardMaterial({ color: flora.trunk || 0x5a4632, roughness: 1 });
        const canMat = new THREE.MeshStandardMaterial({ color: flora.color || 0x2e6b34, roughness: 1 });
        const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6);
        const canopyGeo = new THREE.ConeGeometry(1.9, 4.6, 7);
        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
        const canopies = new THREE.InstancedMesh(canopyGeo, canMat, spots.length);
        let caps = null, capGeo = null;
        if (flora.type === "snowpine") {
          capGeo = new THREE.ConeGeometry(0.95, 1.7, 7);
          caps = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xf2f7fb, roughness: 0.95 }), spots.length);
        }
        spots.forEach((p, i) => {
          const yBase = gy(p);
          dummy.position.set(p.x, yBase + 1.2 * p.s, p.z);
          dummy.scale.setScalar(p.s);
          dummy.rotation.set(0, Math.random() * 6.28, 0);
          dummy.updateMatrix();
          trunks.setMatrixAt(i, dummy.matrix);
          dummy.position.set(p.x, yBase + 4.4 * p.s, p.z);
          dummy.updateMatrix();
          canopies.setMatrixAt(i, dummy.matrix);
          if (caps) {
            dummy.position.set(p.x, yBase + 5.9 * p.s, p.z);
            dummy.updateMatrix();
            caps.setMatrixAt(i, dummy.matrix);
          }
        });
        trunks.castShadow = canopies.castShadow = true;
        this.group.add(trunks, canopies);
        if (caps) caps.castShadow = true;
        if (caps) this.group.add(caps);

      } else if (flora.type === "cactus") {
        this._scatterCacti(spots, dummy, col, flora);

      } else if (flora.type === "rock") {
        this._scatterRocks(spots, dummy, col, flora);

      } else if (flora.type === "desert") {
        const cacti = spots.filter(p => p.kind === "cactus");
        const rocks = spots.filter(p => p.kind === "rock");
        this._scatterCacti(cacti, dummy, col, flora);
        this._scatterRocks(rocks, dummy, col, flora);
      }
    }

    /* ----- city buildings with window glow ----- */
    const city = env.city;
    if (city) {
      const bGeo = new THREE.BoxGeometry(1, 1, 1);
      const winTex = this._makeWindowTexture();
      const bMat = new THREE.MeshStandardMaterial({
        color: 0x14181f, roughness: 0.85,
        emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: city.glow !== undefined ? city.glow : 0.35,
      });
      const buildings = [];
      for (let i = 0; i < N; i += 30) {
        const s = this.samples[i];
        if (Math.random() < 0.4) {
          const side = Math.random() < 0.5 ? 1 : -1;
          const d = this.barrierDist + 18 + Math.random() * 30;
          const w = 8 + Math.random() * 14;
          const h = 10 + Math.random() * 42;
          buildings.push({ x: s.pos.x + s.nx * side * d, z: s.pos.z + s.nz * side * d, w, h, d: w, hue: Math.random() });
        }
      }
      const bMesh = new THREE.InstancedMesh(bGeo, bMat, buildings.length);
      const dummy = new THREE.Object3D();
      buildings.forEach((b, i) => {
        const gy = this._terrainHeight(b.x, b.z);
        dummy.position.set(b.x, gy + b.h / 2, b.z);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.rotation.set(0, Math.random() * 0.4, 0);
        dummy.updateMatrix();
        bMesh.setMatrixAt(i, dummy.matrix);
      });
      bMesh.castShadow = true;
      this.group.add(bMesh);
    }

    /* ----- streetlights ----- */
    const lamps = env.lamps;
    if (lamps) {
      const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.7, roughness: 0.4 });
      const lampGeo = new THREE.SphereGeometry(0.28, 8, 8);
      const lampMat = new THREE.MeshBasicMaterial({ color: lamps.color || 0xffe9b0 });
      const every = lamps.every || 46;
      const poles = [];
      for (let i = 0; i < N; i += every) {
        const s = this.samples[i];
        const side = (i / every) % 2 === 0 ? 1 : -1;
        poles.push({
          x: s.pos.x + s.nx * side * (this.barrierDist + 2.2),
          z: s.pos.z + s.nz * side * (this.barrierDist + 2.2),
        });
      }
      const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);
      const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, poles.length);
      const dummy = new THREE.Object3D();
      poles.forEach((p, i) => {
        const gy = this._terrainHeight(p.x, p.z);
        dummy.scale.setScalar(1);
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(p.x, gy + 2.7, p.z);
        dummy.updateMatrix();
        poleMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(p.x, gy + 5.5, p.z);
        dummy.updateMatrix();
        lampMesh.setMatrixAt(i, dummy.matrix);
      });
      this.group.add(poleMesh, lampMesh);
    }
  }

  _scatterCacti(spots, dummy, col, flora) {
    if (!spots.length) return;
    const trunkMat = new THREE.MeshStandardMaterial({ color: flora.color || 0x5a7a3a, roughness: 0.85 });
    const bodyGeo = new THREE.CylinderGeometry(0.20, 0.26, 1, 7);   // unit height, scaled
    const armGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.9, 6);
    const bodies = new THREE.InstancedMesh(bodyGeo, trunkMat, spots.length);
    const armsL = new THREE.InstancedMesh(armGeo, trunkMat, spots.length);
    const armsR = new THREE.InstancedMesh(armGeo, trunkMat, spots.length);
    spots.forEach((p, i) => {
      const h = (1.9 + Math.random() * 1.3) * p.s;
      const yBase = this._terrainHeight(p.x, p.z);
      dummy.position.set(p.x, yBase + h / 2, p.z);
      dummy.scale.set(p.s, h, p.s);
      dummy.rotation.set(0, Math.random() * 6.28, 0);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      // two arms bending upward at mid height
      const ay = yBase + h * 0.45, ao = 0.42 * p.s;
      dummy.scale.set(p.s, 0.9 * p.s, p.s);
      dummy.position.set(p.x - ao, ay + 0.35 * p.s, p.z);
      dummy.rotation.set(0, 0, 0.5);
      dummy.updateMatrix(); armsL.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x + ao, ay + 0.15 * p.s, p.z);
      dummy.rotation.set(0, 0, -0.5);
      dummy.updateMatrix(); armsR.setMatrixAt(i, dummy.matrix);
    });
    bodies.castShadow = true;
    this.group.add(bodies, armsL, armsR);
  }

  _scatterRocks(spots, dummy, col, flora) {
    if (!spots.length) return;
    const mat = new THREE.MeshStandardMaterial({ color: flora.trunk || 0xa87d52, roughness: 1 });
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((p, i) => {
      const sc = (0.9 + Math.random() * 1.7) * p.s;
      const yBase = this._terrainHeight(p.x, p.z);
      dummy.position.set(p.x, yBase + sc * 0.35, p.z);
      dummy.scale.set(sc, sc * 0.55, sc * (0.75 + Math.random() * 0.5));
      dummy.rotation.set(Math.random() * 0.4, Math.random() * 6.28, Math.random() * 0.4);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    });
    rocks.castShadow = true;
    this.group.add(rocks);
  }

  /* window grid texture used as the emissive map on city buildings */
  _makeWindowTexture() {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#000000";
    g.fillRect(0, 0, 64, 128);
    const palette = ["#ffd9a0", "#fff3c8", "#9fd8ff", "#ff9fd0", "#b0ffd0"];
    for (let wy = 6; wy < 124; wy += 10) {
      for (let wx = 5; wx < 60; wx += 12) {
        if (Math.random() < 0.42) {
          g.fillStyle = palette[Math.random() * palette.length | 0];
          g.globalAlpha = 0.5 + Math.random() * 0.5;
          g.fillRect(wx, wy, 7, 5);
        }
      }
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  /* ---------- collision: keep a point inside the barriers ----------
   * Returns corrected {x, z, hitNormal:{x,z}, hit:boolean}            */
  collide(x, z, hintIdx) {
    const idx = this.nearestIndex(x, z, hintIdx);
    const s = this.samples[idx];
    const lat = this.lateralOffset(x, z, idx);
    const limit = this.barrierDist - 0.9;
    if (Math.abs(lat) > limit) {
      const over = Math.abs(lat) - limit;
      const side = tsign(lat);
      return {
        x: x - s.nx * side * over,
        z: z - s.nz * side * over,
        nx: -s.nx * side, nz: -s.nz * side,
        hit: true, idx,
      };
    }
    return { x, z, nx: 0, nz: 0, hit: false, idx };
  }
}

function tsign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

/* ---------- track library ----------
 * points are [x, z, elevation]; polar-style loops (radius per angle step)
 * are guaranteed non-self-intersecting. Heights are sums of sinusoids so
 * the loop closes smoothly with no cliff at the start/finish seam.      */
function _polarLoop(radii, heightFn, scale = 1) {
  const n = radii.length;
  const base = heightFn(0, n);   // normalize so the grid area is flat
  return radii.map((r, i) => {
    const a = (i / n) * Math.PI * 2;
    return [
      Math.cos(a) * r * scale,
      Math.sin(a) * r * scale,
      heightFn(i, n) - base,
    ];
  });
}

const TRACKS = {
  downtown: {
    key: "downtown",
    name: "DOWNTOWN CIRCUIT",
    desc: "City dusk · hairpins & chicanes",
    width: 14,
    meta: { length: "≈2.4 km", elev: "flat", style: "City" },
    env: {
      skyStops: [[0, "#0a1130"], [0.45, "#27407c"], [0.72, "#c85a3a"], [0.85, "#ff9d4d"], [1, "#ffc880"]],
      sunColors: ["rgba(255,230,180,1)", "rgba(255,170,90,0.55)", "rgba(255,150,60,0)"],
      sunDir: [900, 120, 700], sunScale: 700,
      sunColor: 0xffc07a, sunIntensity: 1.35, sunPos: [90, 130, 50],
      hemiSky: 0x8fa8d8, hemiGround: 0x1a2028, hemiInt: 0.75,
      fogColor: 0x2a3550, fogNear: 180, fogFar: 750, exposure: 1.15,
      terrainColor: 0x22381f,
      flora: { type: "pine", density: 0.9, color: 0x2e6b34, trunk: 0x5a4632 },
      city: { glow: 0.4 },
      lamps: { every: 46, color: 0xffe9b0 },
    },
  },
  ridgeline: {
    key: "ridgeline",
    name: "RIDGELINE RUN",
    desc: "Rolling hills · high-speed sweepers",
    width: 15,
    points: _polarLoop(
      [200, 175, 215, 165, 195, 170, 220, 180, 160, 200, 170, 210, 175, 185],
      (i, n) => 6 * Math.sin(4 * Math.PI * i / n) + 3 * Math.sin(2 * Math.PI * i / n),
      1.35
    ),
    meta: { length: "≈1.8 km", elev: "±9 m", style: "Hilly" },
    env: {
      skyStops: [[0, "#3f97e0"], [0.5, "#8fd0ff"], [0.78, "#d6efff"], [1, "#f2fbff"]],
      sunColors: ["rgba(255,255,245,1)", "rgba(255,240,190,0.5)", "rgba(255,220,150,0)"],
      sunDir: [-500, 650, 400], sunScale: 420,
      sunColor: 0xfff2d0, sunIntensity: 1.45, sunPos: [-250, 380, 200],
      hemiSky: 0xbfe0ff, hemiGround: 0x2e5230, hemiInt: 0.9,
      fogColor: 0xcfe6f5, fogNear: 240, fogFar: 880, exposure: 1.06,
      terrainColor: 0x2f6b30, hillAmp: 1.35,
      flora: { type: "pine", density: 2.4, color: 0x275e2d, trunk: 0x4a3826 },
      city: null,
      lamps: { every: 80, color: 0xe8f0ff },
    },
  },
  canyon: {
    key: "canyon",
    name: "CANYON SPRINT",
    desc: "Desert sunset · steep climbs · big drops",
    width: 13,
    points: _polarLoop(
      [150, 95, 140, 88, 155, 105, 85, 132, 95, 148, 110, 128],
      (i, n) => 6 * Math.sin(2 * Math.PI * i / n) + 2 * Math.sin(6 * Math.PI * i / n),
      1.15
    ),
    meta: { length: "≈1.0 km", elev: "±9 m", style: "Mountain" },
    env: {
      skyStops: [[0, "#3a1f52"], [0.45, "#7a3b63"], [0.7, "#d95f35"], [0.85, "#ff9a3d"], [1, "#ffc873"]],
      sunColors: ["rgba(255,240,200,1)", "rgba(255,150,60,0.6)", "rgba(255,120,40,0)"],
      sunDir: [-800, 150, 350], sunScale: 850,
      sunColor: 0xffa050, sunIntensity: 1.4, sunPos: [-350, 120, 180],
      hemiSky: 0xd88a5a, hemiGround: 0x5a3020, hemiInt: 0.75,
      fogColor: 0xd98e5f, fogNear: 150, fogFar: 640, exposure: 1.18,
      terrainColor: 0xc2894f, hillAmp: 1.5, hillFreq: 0.8,
      flora: { type: "desert", density: 1.2, color: 0x5a7a3a, trunk: 0xa87d52 },
      city: null,
      lamps: { every: 80, color: 0xffb46a },
    },
  },
  glacier: {
    key: "glacier",
    name: "GLACIER RUN",
    desc: "Frozen alpine pass · wide sweepers",
    width: 15.5,
    points: _polarLoop(
      [185, 155, 178, 148, 172, 158, 182, 162],
      (i, n) => 4 * Math.sin(4 * Math.PI * i / n) + 2 * Math.sin(2 * Math.PI * i / n),
      1.28
    ),
    meta: { length: "≈1.6 km", elev: "±6 m", style: "Snow" },
    env: {
      skyStops: [[0, "#8fc7ff"], [0.5, "#c8e4ff"], [0.75, "#eef7ff"], [1, "#ffffff"]],
      sunColors: ["rgba(255,255,255,1)", "rgba(220,240,255,0.5)", "rgba(200,230,255,0)"],
      sunDir: [-700, 500, 300], sunScale: 500,
      sunColor: 0xfff4e0, sunIntensity: 1.5, sunPos: [-300, 400, 150],
      hemiSky: 0xcfe4ff, hemiGround: 0x8a95a5, hemiInt: 0.95,
      fogColor: 0xdfeef8, fogNear: 220, fogFar: 820, exposure: 1.02,
      terrainColor: 0xe3ecf2, hillAmp: 1.1,
      flora: { type: "snowpine", density: 1.6, color: 0x2f4a3e, trunk: 0x4a3b2e },
      city: null,
      lamps: { every: 90, color: 0xd8e8ff },
    },
  },
  neon: {
    key: "neon",
    name: "NEON DISTRICT",
    desc: "Midnight sprint · tight city blocks",
    width: 12.5,
    points: _polarLoop(
      [135, 100, 130, 88, 125, 98, 132, 92, 120, 100, 128, 95],
      () => 0,
      1.05
    ),
    meta: { length: "≈1.2 km", elev: "flat", style: "Night" },
    env: {
      skyStops: [[0, "#020308"], [0.55, "#0a1226"], [0.8, "#16223f"], [1, "#232f52"]],
      stars: true,
      sunColors: ["rgba(220,230,255,1)", "rgba(150,170,230,0.4)", "rgba(120,150,220,0)"],
      sunDir: [600, 700, -200], sunScale: 260,
      sunColor: 0x93a9e8, sunIntensity: 1.05, sunPos: [250, 350, -80],
      hemiSky: 0x3d5290, hemiGround: 0x10141f, hemiInt: 0.85,
      fogColor: 0x101830, fogNear: 180, fogFar: 740, exposure: 1.42,
      terrainColor: 0x1b2332, hillAmp: 0.25,
      flora: null,
      city: { glow: 1.35 },
      lamps: { every: 22, color: 0xbfd8ff },
      roadEdgeGlow: [0x00e5ff, 0xff2fd6],
    },
  },
};
