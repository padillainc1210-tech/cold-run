/* ============================================================
   COLD RUN 3D — Ice Delivery, REAL MANHATTAN EDITION (main_new.js)
   First-person windshield view. Same shift, same rules — but the city
   is the real Manhattan road network from OpenStreetMap (map.json),
   not a procedural grid. See REALMAP_NOTES.md for how it works.
   Controls: ▲ gas · ▼ brake · ◀ ▶ steer · Space = honk
   Touch: on-screen pedals + steering.
   NOTE: this file is NOT live yet. index.html still loads main.js.
   The deploy wiring is described in REALMAP_NOTES.md.
   ============================================================ */
import * as THREE from "three";

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const sceneCanvas = $("scene"), mmCanvas = $("minimap"), mmCtx = mmCanvas.getContext("2d");
const hudTime = $("hudTime"), hudScore = $("hudScore"), hudCounts = $("hudCounts");
const deliveriesEl = $("deliveries"), compassArrow = $("compassArrow"), compassDist = $("compassDist");
const locEl = $("loc");
const cargoBar = $("cargoBar");
const speedo = $("speedo"), honkBtn = $("honkBtn"), flashEl = $("flash"), hintEl = $("hint");
const menuEl = $("menu"), overEl = $("over"), overStats = $("overStats");
const lunchOverlay = $("lunchOverlay"), lunchCount = $("lunchCount");
if ("ontouchstart" in window) document.body.classList.add("touch");

/* ---------------- audio ---------------- */
let AC = null;
function beep(freq, dur, type = "sine", vol = 0.12) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch (e) { /* no audio — game still works */ }
}

/* ---------------- real Manhattan data (x east, z south) ---------------- */
// The city comes from map.json (OpenStreetMap, via the BBBike New York
// extract — see osm/): real roads with names, classes and one-way tags,
// plus water, coastline and park polygons. Game +x = east, +z = south,
// 1 game unit = 2 meters (unitsPerMeter 0.5 in the data).
// Bounds are filled in at load; the island is ~4,750 x 11,300 units.
const SHIFT_LEN = 180;
let M = null;   // processed map (processMapData)
let RAW = null; // parsed map.json — released after startup processing

/* __PURE_MAP_START__ */
// Pure map processing: no DOM, no THREE, no game state — unit-testable in node.
// NYC DOT-style signal timing: 9s green, 3s amber, 2s all-red per phase,
// then the cross street gets its own 9s green + 3s amber + all-red.
const LIGHT_PERIOD = 28, GREEN_T = 9, YELLOW_T = 3, ALLRED_T = 2;
// Drivable classes only — footways, steps, cycleways, paths and the like
// are drawn nowhere and driven nowhere (they would swamp the graph).
const DRIVABLE = new Set(["motorway", "motorway_link", "trunk", "trunk_link",
  "primary", "primary_link", "secondary", "secondary_link", "tertiary",
  "tertiary_link", "unclassified", "residential", "living_street", "service"]);
// Street-like classes: where deliveries and pedestrians belong
// (no motorways, trunks or ramps — you can't drop ice on the FDR).
const STREETLIKE = new Set(["primary", "primary_link", "secondary",
  "secondary_link", "tertiary", "tertiary_link", "unclassified",
  "residential", "living_street", "service"]);
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary"]);
const HASH_CELL = 128;

// Build the driving graph from map.json, once at startup.
// Nodes are snapped road points (coords already rounded to 0.1 units, so
// ways that share an OSM node get the same node here — exact topology
// without needing node ids in the data). Edges are point-to-point
// segments; adjacency is a flat offset array for cache-friendly lookup.
// A spatial hash over edges answers "what road is near here?" queries.
function processMapData(m) {
  const b = m.bounds;
  const minX = b.minX, minZ = b.minZ;
  const W = b.maxX - b.minX, H = b.maxZ - b.minZ;
  const nodeIdx = new Map();
  const nodeX = [], nodeZ = [];
  const nid = (x, z) => {
    const k = Math.round(x * 10) + "," + Math.round(z * 10);
    let i = nodeIdx.get(k);
    if (i === undefined) { i = nodeX.length; nodeIdx.set(k, i); nodeX.push(x); nodeZ.push(z); }
    return i;
  };
  const roadName = [], roadCls = [], roadOne = [], roadStreet = [], roadCross = [];
  const edgeA = [], edgeB = [], edgeRoad = [], edgeLen = [], edgeUX = [], edgeUZ = [];
  const hash = new Map();
  const hashAdd = (e, x0, z0, x1, z1) => {
    const cx0 = Math.floor(Math.min(x0, x1) / HASH_CELL), cx1 = Math.floor(Math.max(x0, x1) / HASH_CELL);
    const cz0 = Math.floor(Math.min(z0, z1) / HASH_CELL), cz1 = Math.floor(Math.max(z0, z1) / HASH_CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k = cx + "," + cz;
      let arr = hash.get(k);
      if (!arr) { arr = []; hash.set(k, arr); }
      arr.push(e);
    }
  };
  for (const r of m.roads) {
    if (!DRIVABLE.has(r.c)) continue;
    const ri = roadName.length;
    roadName.push(r.n || "");
    roadCls.push(r.c);
    roadOne.push(r.o || 0);
    roadCross.push(r.x ? 1 : 0);
    roadStreet.push(STREETLIKE.has(r.c));
    const pts = r.p;
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = pts[i][0], z0 = pts[i][1], x1 = pts[i + 1][0], z1 = pts[i + 1][1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const e = edgeA.length;
      edgeA.push(nid(x0, z0)); edgeB.push(nid(x1, z1)); edgeRoad.push(ri);
      edgeLen.push(len); edgeUX.push(dx / len); edgeUZ.push(dz / len);
      hashAdd(e, x0, z0, x1, z1);
    }
  }
  const nNodes = nodeX.length, nEdges = edgeA.length;
  const deg = new Int32Array(nNodes);
  for (let e = 0; e < nEdges; e++) { deg[edgeA[e]]++; deg[edgeB[e]]++; }
  const adjOff = new Int32Array(nNodes + 1);
  for (let i = 0; i < nNodes; i++) adjOff[i + 1] = adjOff[i] + deg[i];
  const adjList = new Int32Array(adjOff[nNodes]);
  const fill = new Int32Array(nNodes);
  for (let e = 0; e < nEdges; e++) {
    const a = edgeA[e], bb = edgeB[e];
    adjList[adjOff[a] + fill[a]++] = e;
    adjList[adjOff[bb] + fill[bb]++] = e;
  }
  // Signals: nodes where major roads meet (degree >= 3, at least two
  // incident major-class edges). axisA is the direction of the first
  // major road through the node; the crossing road gets the V phase.
  // (Averaging the crossing directions would give a diagonal axis and
  // break the 45-degree axis test, so the first major road wins.)
  const nodeSignal = new Int32Array(nNodes).fill(-1);
  const signals = [];
  for (let n = 0; n < nNodes; n++) {
    const s = adjOff[n], t = adjOff[n + 1];
    if (t - s < 3) continue;
    let major = 0, ax = 0, az = 0;
    for (let k = s; k < t; k++) {
      const e = adjList[k];
      if (!MAJOR.has(roadCls[edgeRoad[e]])) continue;
      if (major === 0) {
        ax = edgeUX[e]; az = edgeUZ[e];
        if (edgeB[e] === n) { ax = -ax; az = -az; }
      }
      major++;
    }
    if (major < 2) continue;
    nodeSignal[n] = signals.length;
    signals.push({ node: n, x: nodeX[n], z: nodeZ[n], offset: (n * 7 + 13) % LIGHT_PERIOD, ax, az });
  }
  // Land components: union-find over nodes, IGNORING bridge/tunnel
  // edges. A bridge deck must not stitch two landmasses together,
  // and neither must a tunnel under a river. The Manhattan
  // component is the one containing Times Square; every delivery
  // and spawn point must sit on one of its edges. (The northern
  // land neck to the Bronx stays in — it is real contiguous land,
  // a small edge area, and still New York.)
  const parent = new Int32Array(nNodes);
  for (let i = 0; i < nNodes; i++) parent[i] = i;
  const find = (a) => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) { const nxt = parent[a]; parent[a] = r; a = nxt; }
    return r;
  };
  for (let e = 0; e < nEdges; e++) {
    if (roadCross[edgeRoad[e]]) continue;
    const ra = find(edgeA[e]), rb = find(edgeB[e]);
    if (ra !== rb) parent[ra] = rb;
  }
  let tsNode = 0, tsBest = Infinity;
  for (let n = 0; n < nNodes; n++) {
    const dx = nodeX[n] + 650, dz = nodeZ[n] - 1200;
    const d2 = dx * dx + dz * dz;
    if (d2 < tsBest) { tsBest = d2; tsNode = n; }
  }
  const manhattanRoot = find(tsNode);
  const nodeLand = new Uint8Array(nNodes);
  for (let n = 0; n < nNodes; n++) nodeLand[n] = find(n) === manhattanRoot ? 1 : 0;
  // LES buildings: oriented bounding boxes from real footprints
  // (map.json "buildings" layer, Lower East Side only). Footprints stay
  // at true map scale; heights use the game's stylized vertical (old
  // grid buildings ran 40–135 units, lamp poles are 46) so a tenement
  // reads next to cars and poles instead of vanishing under them.
  const buildings = [];
  for (const b of (m.buildings || [])) {
    const pts = b.p;
    if (!pts || pts.length < 4) continue;
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < pts.length; i++) {
      // skip a duplicated closing point
      if (i === pts.length - 1 && pts[i][0] === pts[0][0] && pts[i][1] === pts[0][1]) continue;
      sx += pts[i][0]; sz += pts[i][1]; n++;
    }
    if (n < 3) continue;
    const ccx = sx / n, ccz = sz / n;
    // longest edge sets the box orientation
    let bestLen = -1, bx = 1, bz = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
      const l2 = dx * dx + dz * dz;
      if (l2 > bestLen) { bestLen = l2; bx = dx; bz = dz; }
    }
    const bl = Math.sqrt(bestLen) || 1;
    const ux = bx / bl, uz = bz / bl;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = pts[i][0] - ccx, dz = pts[i][1] - ccz;
      const u = dx * ux + dz * uz, v = -dx * uz + dz * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const w = Math.max(4, maxU - minU), d = Math.max(4, maxV - minV);
    const mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
    buildings.push({
      cx: ccx + mu * ux - mv * uz, cz: ccz + mu * uz + mv * ux,
      w, d, rot: Math.atan2(uz, ux), h: b.h || 55,
    });
  }
  return {
    minX, minZ, W, H, cx: minX + W / 2, cz: minZ + H / 2,
    nodeX, nodeZ, edgeA, edgeB, edgeRoad, edgeLen, edgeUX, edgeUZ,
    adjOff, adjList, nodeSignal, signals,
    roadName, roadCls, roadOne, roadStreet, roadCross, nodeLand, manhattanRoot,
    hash, buildings,
  };
}

// Which way can edge e be traversed starting from node? 0 = not allowed.
// oneway 1: only a->b; oneway -1: only b->a; otherwise both ways.
function edgeDirFrom(M, e, node) {
  const one = M.roadOne[M.edgeRoad[e]];
  if (M.edgeA[e] === node && one !== -1) return 1;
  if (M.edgeB[e] === node && one !== 1) return -1;
  return 0;
}

// Pick a random road onward from a node (reservoir sampling, no array).
// Excludes the edge we arrived on unless it is a dead end (then null,
// and the caller U-turns). wantStreet restricts to delivery/ped classes.
function chooseNextEdge(M, node, fromEdge, wantStreet) {
  const s = M.adjOff[node], t = M.adjOff[node + 1];
  let pool = null, count = 0;
  for (let k = s; k < t; k++) {
    const e = M.adjList[k];
    if (e === fromEdge) continue;
    if (wantStreet && !M.roadStreet[M.edgeRoad[e]]) continue;
    const d = edgeDirFrom(M, e, node);
    if (d === 0) continue;
    count++;
    if (Math.random() < 1 / count) pool = { edge: e, dir: d };
  }
  return pool;
}

// Random road point in a distance band around (x, z), via the hash.
// wantIsland restricts to Manhattan land: the edge must not be a bridge
// or tunnel span, and its component must be the Manhattan one.
// Returns {edge, dist, x, z} or null. Reservoir sampling, no big arrays.
function pickEdgeNear(M, x, z, minR, maxR, wantStreet, wantIsland) {
  const cx0 = Math.floor((x - maxR) / HASH_CELL), cx1 = Math.floor((x + maxR) / HASH_CELL);
  const cz0 = Math.floor((z - maxR) / HASH_CELL), cz1 = Math.floor((z + maxR) / HASH_CELL);
  const seen = new Set();
  const minR2 = minR * minR, maxR2 = maxR * maxR;
  let count = 0, pick = null;
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const arr = M.hash.get(cx + "," + cz);
    if (!arr) continue;
    for (const e of arr) {
      if (seen.has(e)) continue;
      seen.add(e);
      if (wantStreet && !M.roadStreet[M.edgeRoad[e]]) continue;
      if (wantIsland && (M.roadCross[M.edgeRoad[e]] || !M.nodeLand[M.edgeA[e]])) continue;
      const a = M.edgeA[e];
      const ax = M.nodeX[a], az = M.nodeZ[a];
      const ux = M.edgeUX[e], uz = M.edgeUZ[e];
      let t = (x - ax) * ux + (z - az) * uz;
      t = Math.max(0, Math.min(M.edgeLen[e], t));
      const px = ax + ux * t, pz = az + uz * t;
      const dx = px - x, dz = pz - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minR2 || d2 > maxR2) continue;
      count++;
      if (Math.random() < 1 / count) pick = { edge: e, dist: t, x: px, z: pz };
    }
  }
  return pick;
}

function onStreetAt(M, x, z, thresh) {
  const cx0 = Math.floor((x - thresh) / HASH_CELL), cx1 = Math.floor((x + thresh) / HASH_CELL);
  const cz0 = Math.floor((z - thresh) / HASH_CELL), cz1 = Math.floor((z + thresh) / HASH_CELL);
  const t2 = thresh * thresh;
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const arr = M.hash.get(cx + "," + cz);
    if (!arr) continue;
    for (const e of arr) {
      const a = M.edgeA[e];
      const ax = M.nodeX[a], az = M.nodeZ[a];
      const ux = M.edgeUX[e], uz = M.edgeUZ[e];
      let t = (x - ax) * ux + (z - az) * uz;
      t = Math.max(0, Math.min(M.edgeLen[e], t));
      const dx = ax + ux * t - x, dz = az + uz * t - z;
      if (dx * dx + dz * dz < t2) return true;
    }
  }
  return false;
}

// Nearest named road, expanding search radii. "" when nothing is named.
function nearestNamedRoad(M, x, z, maxR) {
  const seen = new Set();
  let best = null, bestD2 = Infinity;
  for (const r of [40, 90, maxR]) {
    const cx0 = Math.floor((x - r) / HASH_CELL), cx1 = Math.floor((x + r) / HASH_CELL);
    const cz0 = Math.floor((z - r) / HASH_CELL), cz1 = Math.floor((z + r) / HASH_CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const arr = M.hash.get(cx + "," + cz);
      if (!arr) continue;
      for (const e of arr) {
        if (seen.has(e)) continue;
        seen.add(e);
        const name = M.roadName[M.edgeRoad[e]];
        if (!name) continue;
        const a = M.edgeA[e];
        const ax = M.nodeX[a], az = M.nodeZ[a];
        const ux = M.edgeUX[e], uz = M.edgeUZ[e];
        let t = (x - ax) * ux + (z - az) * uz;
        t = Math.max(0, Math.min(M.edgeLen[e], t));
        const dx = ax + ux * t - x, dz = az + uz * t - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = name; }
      }
    }
    if (best) return best;
  }
  return "";
}

/* __PURE_MAP_END__ */

function lightPhase(light, t) {
  // NYC phasing: green -> amber -> all-red clearance -> cross street green
  const l = (t + light.offset) % LIGHT_PERIOD;
  if (l < GREEN_T) return "H";
  if (l < GREEN_T + YELLOW_T) return "HY";
  if (l < GREEN_T + YELLOW_T + ALLRED_T) return "AR";
  if (l < GREEN_T + YELLOW_T + ALLRED_T + GREEN_T) return "V";
  if (l < GREEN_T + YELLOW_T + ALLRED_T + GREEN_T + YELLOW_T) return "VY";
  return "AR";
}

/* ---------------- three.js setup ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas: sceneCanvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1224);
scene.fog = new THREE.Fog(0x0c1224, 400, 2600);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 1, 6000);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0x5a6f9e, 0x141a28, 1.0));
const moon = new THREE.DirectionalLight(0x8fb4ff, 0.75);
moon.position.set(300, 600, 200);
scene.add(moon);
// headlights: spotlight + visible beam cone
const headlight = new THREE.SpotLight(0xffeecf, 120, 700, 0.48, 0.55, 1.4);
scene.add(headlight);
scene.add(headlight.target);
const coneGeo = new THREE.ConeGeometry(70, 260, 20, 1, true);
coneGeo.rotateX(-Math.PI / 2); // apex toward -Z (the truck)
const headCone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
  color: 0xffedb8, transparent: true, opacity: 0.07,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
}));
scene.add(headCone);
// moon disc
const moonMesh = new THREE.Mesh(
  new THREE.SphereGeometry(40, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xdce8ff, fog: false })
);
moonMesh.position.set(-500, 700, -1400);
scene.add(moonMesh);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- textures ---------------- */
// (No procedural textures: the ground is the real-map canvas texture
// built from map.json in buildStatic below.)

/* ---------------- static geometry ---------------- */
const MAT = {
  ground: new THREE.MeshLambertMaterial({ color: 0x0b0e14 }),
  road: new THREE.MeshLambertMaterial({ color: 0x232a38 }),
  roof: new THREE.MeshLambertMaterial({ color: 0x11141c }),
  pole: new THREE.MeshLambertMaterial({ color: 0x3a3f47 }),
  signRed: new THREE.MeshLambertMaterial({ color: 0xc0392b }),
  dark: new THREE.MeshLambertMaterial({ color: 0x14161c }),
};
// --- scene builders from the processed map (DOM/THREE live here) ---
let groundCanvas = null;

// Ground: one big canvas texture drawn from map.json, same palette as
// osm/preview.svg — dark ground, water, parks, roads colored/weighted by
// class, minor roads first so major roads draw on top. One draw call for
// the whole island; no 3D ribbon meshes (77k roads would never run).
function buildGroundTexture() {
  const scale = 1024 / M.W;
  const cw = 1024, ch = Math.round(1024 * M.H / M.W);
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const g = c.getContext("2d");
  const sx = (x) => (x - M.minX) * scale;
  const sz = (z) => (z - M.minZ) * scale;
  g.fillStyle = "#0b0e14";
  g.fillRect(0, 0, cw, ch);
  g.lineJoin = "round"; g.lineCap = "round";
  for (const w of RAW.waters) {
    // Closed rings (lakes, ponds, bays) fill as water. Open chains
    // trace a single riverbank — filling one would paint a triangle
    // across land with its closing chord, so banks are stroked instead
    // and the river reads as a dark channel between its bank lines.
    const pts = w.p;
    const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sz(z)) : g.moveTo(sx(x), sz(z))));
    if (closed) { g.fillStyle = "#16324f"; g.closePath(); g.fill(); }
    else { g.strokeStyle = "#16324f"; g.lineWidth = 2; g.stroke(); }
  }
  for (const p of RAW.parks) {
    g.fillStyle = "#1d4a2a";
    g.beginPath();
    p.p.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sz(z)) : g.moveTo(sx(x), sz(z))));
    g.closePath(); g.fill();
  }
  g.strokeStyle = "#3d6a8f"; g.lineWidth = 1.5;
  for (const co of RAW.coasts) {
    g.beginPath();
    co.p.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sz(z)) : g.moveTo(sx(x), sz(z))));
    g.stroke();
  }
  const rank = (cls) => (cls === "motorway" || cls === "trunk") ? 4 :
    cls === "primary" ? 3 : cls === "secondary" ? 2 : 1;
  const color = (cls) => (cls === "motorway" || cls === "trunk") ? "#e8c547" :
    cls === "primary" ? "#f2f2f2" : cls === "secondary" ? "#c9d4e0" : "#7d8ca3";
  const width = (cls) => (cls === "motorway" || cls === "trunk") ? 6.5 :
    cls === "primary" ? 4.7 : cls === "secondary" ? 3.9 : cls === "tertiary" ? 3.2 : 2.6;
  const roads = RAW.roads.filter((r) => DRIVABLE.has(r.c)).sort((a, b) => rank(a.c) - rank(b.c));
  // Asphalt bed under every drivable road: a dark ribbon wider than the
  // colored centerline, so streets read as surfaces (with a curb edge)
  // instead of bare lines when viewed from the driver's seat.
  for (const r of roads) {
    g.strokeStyle = "#232a38"; g.lineWidth = width(r.c) + 2.5;
    g.beginPath();
    r.p.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sz(z)) : g.moveTo(sx(x), sz(z))));
    g.stroke();
  }
  for (const r of roads) {
    g.strokeStyle = color(r.c); g.lineWidth = width(r.c);
    g.beginPath();
    r.p.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sz(z)) : g.moveTo(sx(x), sz(z))));
    g.stroke();
  }
  groundCanvas = c;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function buildLampSpots() {
  // Walk whole major roads, not individual segments: most Manhattan
  // segments are a single short block, so the old per-segment filter
  // (length >= 60, first lamp at 85) yielded only ~55 lamps for the
  // whole island. One lamp every 170 units along each
  // primary/secondary/tertiary road, sides alternating per lamp.
  // Pole at the CURB, 15 units off the centerline; the arm reaches
  // only 8 units back toward the road, so the head and glow pool hang
  // ~7 units off the centerline, over the roadway edge — NOT on the
  // centerline (the old 15-unit arm put head and glow dead center in
  // the street, which is what the player reported).
  const MAJOR_ROAD = new Set(["primary", "secondary", "tertiary"]);
  const STEP = 170;
  const spots = [];
  let i = 0;
  while (i < M.edgeA.length) {
    const road = M.edgeRoad[i];
    // this road's edges are contiguous and in polyline order
    // (processMapData pushes them road by road)
    let j = i;
    while (j < M.edgeA.length && M.edgeRoad[j] === road) j++;
    if (MAJOR_ROAD.has(M.roadCls[road])) {
      let acc = 0; // distance along the road at the start of edge e
      let nextAt = STEP / 2;
      let side = 1;
      for (let e = i; e < j; e++) {
        const len = M.edgeLen[e];
        const a = M.edgeA[e];
        const ux = M.edgeUX[e], uz = M.edgeUZ[e];
        while (nextAt < acc + len) {
          const adv = nextAt - acc;
          const bx = M.nodeX[a] + ux * adv, bz = M.nodeZ[a] + uz * adv;
          spots.push({ x: bx - uz * side * 15, z: bz + ux * side * 15, ax: uz * side, az: -ux * side });
          side = -side;
          nextAt += STEP;
        }
        acc += len;
      }
    }
    i = j;
  }
  return spots;
}

const LAMP_POOL = 36, SIG_POOL = 20;
const lampPool = [], sigPool = [];
let lampSpots = [];
let lampTimer = 0, sigTimer = 0;

function buildStatic() {
  const tex = buildGroundTexture();
  // dark underlay so the margins past the map edge still read as ground
  const under = new THREE.Mesh(new THREE.PlaneGeometry(M.W + 2400, M.H + 2400), MAT.ground);
  under.rotation.x = -Math.PI / 2;
  under.position.set(M.cx, -0.5, M.cz);
  scene.add(under);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(M.W, M.H),
    new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(M.cx, 0, M.cz);
  scene.add(ground);

  // cobra-head streetlight pool, recycled to the spots nearest the player
  // (full 3D lamps for the whole island would be ~10k meshes).
  const poleGeo = new THREE.CylinderGeometry(1.1, 1.5, 46, 6);
  const armGeo = new THREE.BoxGeometry(8, 1.6, 1.6);
  const headGeo = new THREE.BoxGeometry(7, 2.2, 3.2);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffa64d });
  const poolGeo = new THREE.CircleGeometry(46, 18);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xff9a3c, transparent: true, opacity: 0.15,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  lampSpots = buildLampSpots();
  for (let i = 0; i < LAMP_POOL; i++) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, MAT.pole);
    pole.position.set(0, 23, 0); grp.add(pole);
    const arm = new THREE.Mesh(armGeo, MAT.pole);
    arm.position.set(0, 45, 0); grp.add(arm);
    const head = new THREE.Mesh(headGeo, lampMat);
    head.position.set(0, 44, 0); grp.add(head);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.4, 0); grp.add(pool);
    grp.visible = false;
    scene.add(grp);
    lampPool.push({ grp, arm, head, pool });
  }
  buildBuildings();
}

// LES buildings: real footprints as instanced boxes (2 draw calls for
// the whole neighborhood). Walls get varied brick facade colors; a thin
// dark slab on top reads as the roof. Visual only — no collision; the
// off-street slowdown already keeps you on the roads.
const FACADE = [0x7a4a3a, 0x8a5a44, 0x6e4a3f, 0x7d6a55, 0x5d5a55,
  0x8c7a5e, 0x74463c, 0x635049, 0x6b5a48, 0x59524a];
function buildBuildings() {
  const list = M.buildings || [];
  if (!list.length) return;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0); // scale y=h => base sits on the ground
  const walls = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
  const roofs = new THREE.InstancedMesh(boxGeo,
    new THREE.MeshLambertMaterial({ color: 0x14161c }), list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    q.setFromAxisAngle(up, -b.rot); // three.js -y rotation maps local +x to (cos, sin) in (x, z)
    pos.set(b.cx, 0, b.cz); scl.set(b.w, b.h, b.d);
    m4.compose(pos, q, scl); walls.setMatrixAt(i, m4);
    col.setHex(FACADE[Math.abs(Math.round(b.cx * 7 + b.cz * 13)) % FACADE.length]);
    walls.setColorAt(i, col);
    pos.set(b.cx, b.h, b.cz); scl.set(b.w, 1.2, b.d);
    m4.compose(pos, q, scl); roofs.setMatrixAt(i, m4);
  }
  walls.instanceMatrix.needsUpdate = true;
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
  scene.add(walls); scene.add(roofs);
}

// Signal pool: only the ~20 signalized crossings nearest the player
// get 3D heads; every signal still runs its phase for cars and tickets.
function buildSignals() {
  for (let i = 0; i < SIG_POOL; i++) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 34, 6), MAT.pole);
    pole.position.set(0, 17, 0); grp.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(7, 20, 7), MAT.dark);
    head.position.set(0, 40, 0); grp.add(head);
    const hMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
    const vMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
    const hLamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), hMat);
    hLamp.position.set(0, 45, 0); grp.add(hLamp);
    const vLamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), vMat);
    vLamp.position.set(0, 35, 0); grp.add(vLamp);
    grp.visible = false;
    scene.add(grp);
    sigPool.push({ grp, hMat, vMat, sig: null, lastPhase: "" });
  }
}
function updateSignalLamps() {
  // each lamp is a full 3-color head for its axis: green / amber / red
  for (const lh of sigPool) {
    if (!lh.sig) continue;
    const phase = lightPhase(lh.sig, elapsed);
    if (phase === lh.lastPhase) continue;
    lh.lastPhase = phase;
    if (phase === "H") lh.hMat.color.setHex(0x2eff70);
    else if (phase === "HY") lh.hMat.color.setHex(0xffe14d);
    else lh.hMat.color.setHex(0xff2a2a);
    if (phase === "V") lh.vMat.color.setHex(0x2eff70);
    else if (phase === "VY") lh.vMat.color.setHex(0xffe14d);
    else lh.vMat.color.setHex(0xff2a2a);
  }
}
// Re-assign the lamp/signal pools to whatever is nearest, 4x per second.
function refreshDressing(dt) {
  lampTimer -= dt; sigTimer -= dt;
  if (lampTimer <= 0) { lampTimer = 0.25; refreshLamps(); }
  if (sigTimer <= 0) { sigTimer = 0.25; refreshSignals(); }
}
function refreshLamps() {
  const R2 = 750 * 750;
  const cand = [];
  for (const s of lampSpots) {
    const dx = s.x - player.x, dz = s.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < R2) cand.push({ d2, s });
  }
  cand.sort((a, b) => a.d2 - b.d2);
  for (let i = 0; i < LAMP_POOL; i++) {
    const L = lampPool[i];
    if (i >= cand.length) { L.grp.visible = false; continue; }
    const s = cand[i].s;
    L.grp.visible = true;
    L.grp.position.set(s.x, 0, s.z);
    const rot = Math.atan2(-s.az, s.ax);
    L.arm.position.set(s.ax * 4, 45, s.az * 4);
    L.arm.rotation.y = rot;
    L.head.position.set(s.ax * 8, 44, s.az * 8);
    L.head.rotation.y = rot;
    L.pool.position.set(s.ax * 8, 0.4, s.az * 8);
  }
}
function refreshSignals() {
  const R2 = 900 * 900;
  const cand = [];
  for (const sig of M.signals) {
    const dx = sig.x - player.x, dz = sig.z - player.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < R2) cand.push({ d2, sig });
  }
  cand.sort((a, b) => a.d2 - b.d2);
  for (let i = 0; i < SIG_POOL; i++) {
    const S = sigPool[i];
    if (i >= cand.length) { S.grp.visible = false; S.sig = null; continue; }
    S.grp.visible = true;
    S.sig = cand[i].sig;
    S.lastPhase = "";
    // Pole at the intersection corner, not dead-center in the crossing:
    // offset perpendicular to the signal's road axis.
    S.grp.position.set(S.sig.x - S.sig.az * 16, 0, S.sig.z + S.sig.ax * 16);
  }
}

/* ---------------- entity meshes ---------------- */
const CAR_COLORS = [0xe74c3c, 0xf39c12, 0x8e44ad, 0x16a085, 0xd35400];
function makeCarMesh(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(15, 6, 30), bodyMat);
  body.position.y = 5; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(13, 5, 14),
    new THREE.MeshLambertMaterial({ color: 0x9fc4d8 }));
  cabin.position.set(0, 10, -2); g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(3, 3, 2.4, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0a0a0a });
  for (const [wx, wz] of [[-8, 10], [8, 10], [-8, -10], [8, -10]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 3, wz);
    g.add(w);
  }
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff9c4 });
  for (const hx of [-5, 5]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 1), hlMat);
    hl.position.set(hx, 5, 15.4); g.add(hl);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x881111 });
  for (const hx of [-5, 5]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 1), tailMat);
    tl.position.set(hx, 5, -15.4); g.add(tl);
  }
  // headlight beam glow
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(20, 34),
    new THREE.MeshBasicMaterial({
      color: 0xfff2b0, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 0.6, 32);
  g.add(beam);
  return { group: g, tailMat };
}
function makePersonMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 7, 8),
    new THREE.MeshLambertMaterial({ color }));
  body.position.y = 4.5; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 10),
    new THREE.MeshLambertMaterial({ color: 0xe8b88a }));
  head.position.y = 9.6; g.add(head);
  return g;
}
function makeBeacon() {
  const g = new THREE.Group();
  const cubeMat = new THREE.MeshBasicMaterial({ color: 0x7fe7f2 });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(15, 15, 15), cubeMat);
  cube.position.y = 24; g.add(cube);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7fe7f2, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(20, 30, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.6;
  g.add(ring);
  g.visible = false;
  scene.add(g);
  return { group: g, cube, cubeMat, ringMat };
}

/* ---------------- game state ---------------- */
let state = "menu";
let timeLeft, score, delivered, missed, tickets;
let stops = [], cars = [], pedestrians = [];
let elapsed = 0, stopVersion = 0;
let lunchDone, lunchTimer, hitCooldown = 0, ticketCooldown = 0;
let flashTimer = 0;
const MAX_CRATES = 10;
let crates; // ice load: full = heavy & grippy, empty = light & skittish
const player = { x: 0, z: 0, heading: Math.PI / 2, speed: 0, vx: 0, vz: 0 };
let steerSm = 0; // smoothed steering input (classic arcade ease-in/out)

const MAX_CARS = 16, MAX_PEDS = 8, MAX_STOPS = 6;
const carPool = [], pedPool = [], stopPool = [];
const PED_COLORS = [0x5d6d7e, 0x7d6608, 0x6e2c00, 0x4a235a];
const CUSTOMERS = ["Joe's Deli", "Bar Neon", "Pizza Corner", "Cafe Luna",
  "The Taproom", "Sushi Bay", "Hotel Grand", "Burger Joint"];

function initPools() {
  for (let i = 0; i < MAX_CARS; i++) {
    const { group, tailMat } = makeCarMesh(CAR_COLORS[i % CAR_COLORS.length]);
    group.visible = false;
    scene.add(group);
    carPool.push({ group, tailMat });
  }
  for (let i = 0; i < MAX_PEDS; i++) {
    const g = makePersonMesh(PED_COLORS[i % PED_COLORS.length]);
    g.visible = false;
    scene.add(g);
    pedPool.push(g);
  }
  for (let i = 0; i < MAX_STOPS; i++) {
    const beacon = makeBeacon();
    const blocker = makePersonMesh(0x7d6608);
    blocker.visible = false;
    scene.add(blocker);
    stopPool.push({ beacon, blocker });
  }
}

function resetGame() {
  timeLeft = SHIFT_LEN;
  score = 0; delivered = 0; missed = 0; tickets = 0;
  crates = MAX_CRATES;
  stops = []; cars = []; pedestrians = [];
  elapsed = 0; stopVersion++;
  lunchDone = false; lunchTimer = 0;
  hitCooldown = 0; ticketCooldown = 0; flashTimer = 0;
  // spawn on a real street in the Lower East Side (Delancey/Orchard
  // area — the improved neighborhood), facing along the road
  const spawn = pickEdgeNear(M, -780, 3400, 0, 600, true, true) ||
    pickEdgeNear(M, -780, 3400, 0, 3000, true, false);
  if (spawn) {
    player.x = spawn.x; player.z = spawn.z;
    const one = M.roadOne[M.edgeRoad[spawn.edge]];
    const dir = one === -1 ? -1 : 1;
    player.heading = Math.atan2(M.edgeUX[spawn.edge] * dir, M.edgeUZ[spawn.edge] * dir);
  } else {
    player.x = M.cx; player.z = M.cz; player.heading = 0;
  }
  player.speed = 0; player.vx = 0; player.vz = 0;
  steerSm = 0;
  for (const p of carPool) p.group.visible = false;
  for (const g of pedPool) g.visible = false;
  for (const s of stopPool) { s.beacon.group.visible = false; s.blocker.visible = false; }
  for (let i = 0; i < 3; i++) spawnStop();
  for (let i = 0; i < 9; i++) spawnCar();
  for (let i = 0; i < 4; i++) spawnPedestrian();
  flashEl.style.display = "none";
  hintEl.style.display = "none";
  lunchOverlay.style.display = "none";
}

function spawnStop() {
  const free = stopPool.find((s) => !s.beacon.group.visible);
  if (!free || stops.length >= MAX_STOPS) return;
  // drop-off on a real street near the player, on the island, pulled to
  // the curb (13 units off the centerline); widen the band if nothing fits
  let pick = pickEdgeNear(M, player.x, player.z, 250, 1000, true, true);
  if (!pick) pick = pickEdgeNear(M, player.x, player.z, 100, 3000, true, true);
  if (!pick) return;
  const ux = M.edgeUX[pick.edge], uz = M.edgeUZ[pick.edge];
  const side = Math.random() < 0.5 ? 1 : -1;
  const meltMax = 55 - Math.min(22, elapsed / 12);
  const stop = {
    x: pick.x - uz * side * 13,
    z: pick.z + ux * side * 13,
    melt: meltMax, meltMax,
    name: CUSTOMERS[(Math.random() * CUSTOMERS.length) | 0],
    blocker: null, mesh: free,
  };
  if (Math.random() < 0.45) {
    stop.blocker = {
      x: stop.x + (Math.random() - 0.5) * 24,
      z: stop.z + (Math.random() - 0.5) * 24,
      wait: 0, leaving: 0,
      dx: Math.random() < 0.5 ? 1 : -1, dz: (Math.random() - 0.5),
    };
  }
  free.beacon.group.visible = true;
  free.beacon.group.position.set(stop.x, 0, stop.z);
  stops.push(stop);
  stopVersion++;
}

function removeStop(i) {
  const s = stops[i];
  s.mesh.beacon.group.visible = false;
  s.mesh.blocker.visible = false;
  stops.splice(i, 1);
  spawnStop();
  stopVersion++;
}

function spawnCar() {
  const free = carPool.find((c) => !c.group.visible);
  if (!free || cars.length >= MAX_CARS) return;
  let pick = pickEdgeNear(M, player.x, player.z, 0, 900, false, false);
  if (!pick) pick = pickEdgeNear(M, player.x, player.z, 0, 4000, false, false);
  if (!pick) return;
  const one = M.roadOne[M.edgeRoad[pick.edge]];
  const dir = one === 1 ? 1 : one === -1 ? -1 : (Math.random() < 0.5 ? 1 : -1);
  const car = {
    edge: pick.edge, dist: pick.dist, dir,
    cruise: (100 + Math.random() * 120) * (1 + elapsed / 300), speed: 0,
    mesh: free,
  };
  free.group.visible = true;
  cars.push(car);
}
function updateCar(car, dt) {
  let target = car.cruise;
  // signal ahead: the node this car is driving toward
  const node = car.dir > 0 ? M.edgeB[car.edge] : M.edgeA[car.edge];
  const remaining = car.dir > 0 ? M.edgeLen[car.edge] - car.dist : car.dist;
  const si = M.nodeSignal[node];
  if (si >= 0) {
    const sig = M.signals[si];
    const tx = M.edgeUX[car.edge] * car.dir, tz = M.edgeUZ[car.edge] * car.dir;
    const axisA = Math.abs(tx * sig.ax + tz * sig.az) > 0.707;
    const phase = lightPhase(sig, elapsed);
    const green = (axisA && phase === "H") || (!axisA && phase === "V");
    const yellow = (axisA && phase === "HY") || (!axisA && phase === "VY");
    const stopLine = remaining - 34;
    if ((!green && !(yellow && stopLine < 28)) && stopLine < 110 && stopLine > -20) {
      if (stopLine <= 3) {
        target = 0;
        car.dist = car.dir > 0 ? M.edgeLen[car.edge] - 34 : 34;
      } else {
        target = Math.min(target, car.cruise * (stopLine / 110));
      }
    }
  }
  const rate = target < car.speed ? 420 : 200;
  const dv = target - car.speed;
  car.speed += Math.max(-rate * dt, Math.min(rate * dt, dv));

  car.dist += car.dir * car.speed * dt;
  const len = M.edgeLen[car.edge];
  let arrived = -1;
  if (car.dist >= len) arrived = M.edgeB[car.edge];
  else if (car.dist <= 0) arrived = M.edgeA[car.edge];
  if (arrived >= 0) {
    // wander the graph: random onward road at each node (one-ways obeyed);
    // dead end means a U-turn on the same edge
    const next = chooseNextEdge(M, arrived, car.edge, false);
    if (next) {
      car.edge = next.edge; car.dir = next.dir;
      car.dist = next.dir > 0 ? 0 : M.edgeLen[next.edge];
    } else {
      car.dir = -car.dir;
      car.dist = Math.max(0, Math.min(len, car.dist));
    }
  }
  const a = M.edgeA[car.edge];
  const ux = M.edgeUX[car.edge], uz = M.edgeUZ[car.edge];
  car.x = M.nodeX[a] + ux * car.dist;
  car.z = M.nodeZ[a] + uz * car.dist;
  car.mesh.group.rotation.y = Math.atan2(ux * car.dir, uz * car.dir);
  car.mesh.group.position.set(car.x, 0, car.z);
  car.mesh.tailMat.color.setHex(car.speed < 4 ? 0xff2222 : 0x881111);
}

function spawnPedestrian() {
  const g = pedPool.find((m) => !m.visible);
  if (!g || pedestrians.length >= MAX_PEDS) return;
  let pick = pickEdgeNear(M, player.x, player.z, 0, 700, true, false);
  if (!pick) pick = pickEdgeNear(M, player.x, player.z, 0, 3000, true, false);
  if (!pick) return;
  const p = {
    mesh: g, edge: pick.edge, dist: pick.dist,
    dir: Math.random() < 0.5 ? 1 : -1,
    speed: 42 + Math.random() * 36,
    side: Math.random() < 0.5 ? 1 : -1,
    x: pick.x, z: pick.z,
  };
  g.visible = true;
  pedestrians.push(p);
}

/* ---------------- input ---------------- */
const keys = {};
const touch = { gas: false, brake: false, left: false, right: false };
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  if (state !== "play" && (k === "enter" || k === " ")) startGame();
  else if (state === "play" && k === " ") honk();
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
function bindHold(id, prop) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); touch[prop] = true; el.classList.add("on"); };
  const off = (e) => { e.preventDefault(); touch[prop] = false; el.classList.remove("on"); };
  el.addEventListener("pointerdown", on);
  el.addEventListener("pointerup", off);
  el.addEventListener("pointercancel", off);
  el.addEventListener("pointerleave", off);
}
bindHold("dUp", "gas"); bindHold("dDown", "brake");
bindHold("dLeft", "left"); bindHold("dRight", "right");
bindHold("btnA", "gas"); bindHold("btnB", "brake");
honkBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); if (state === "play") honk(); });
menuEl.addEventListener("pointerdown", () => { if (state !== "play") startGame(); });
overEl.addEventListener("pointerdown", () => { if (state === "over") startGame(); });

function honk() {
  for (const s of stops) {
    if (s.blocker && s.blocker.leaving <= 0 &&
        Math.hypot(player.x - s.x, player.z - s.z) < 170) {
      s.blocker.leaving = 1.8;
    }
  }
  beep(370, 0.12, "square", 0.15);
  setTimeout(() => beep(294, 0.18, "square", 0.15), 110);
}
function startGame() {
  if (!mapReady) { if (mapFailed) initMap(); return; }
  resetGame();
  state = "play";
  menuEl.style.display = "none";
  overEl.style.display = "none";
  beep(520, 0.12, "square");
}
function flash(text, secs = 1.6) {
  flashEl.textContent = text;
  flashEl.style.display = "block";
  flashTimer = secs;
}

/* ---------------- update ---------------- */
const ACCEL = 330, BRAKE = 420, MAX_FWD = 335, MAX_REV = 120;
const GEAR_TOPS = [70, 140, 210, 285]; // 5 forward gears
function gearFor(speed) {
  if (speed < -2) return "R";
  if (speed < 2) return "N";
  let g = 1;
  for (const t of GEAR_TOPS) if (speed > t) g++;
  return String(Math.min(g, 5));
}
let pitchSm = 0;
function update(dt) {
  elapsed += dt;
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0; state = "over";
    overStats.textContent = `Score ${score} · 📦 ${delivered} delivered · ✖ ${missed} melted · 🚨 ${tickets} tickets`;
    overEl.style.display = "flex";
    beep(220, 0.4, "sawtooth");
    return;
  }

  if (!lunchDone && elapsed >= SHIFT_LEN / 2) {
    lunchDone = true; lunchTimer = 8;
    lunchOverlay.style.display = "flex";
    beep(440, 0.15, "square"); setTimeout(() => beep(330, 0.25, "square"), 170);
  }
  if (lunchTimer > 0) {
    lunchTimer -= dt;
    lunchCount.textContent = Math.ceil(lunchTimer);
    if (lunchTimer <= 0) lunchOverlay.style.display = "none";
  }

  if (stops.length < 3 + Math.floor(elapsed / 45) && stops.length < MAX_STOPS) spawnStop();
  if (cars.length < 9 + Math.floor(elapsed / 40) && Math.random() < 0.02) spawnCar();
  if (pedestrians.length < 7 && Math.random() < 0.015) spawnPedestrian();

  // --- driving ---
  const gas = keys["arrowup"] || keys["w"] || touch.gas;
  const brake = keys["arrowdown"] || keys["s"] || touch.brake;
  const left = keys["arrowleft"] || keys["a"] || touch.left;
  const right = keys["arrowright"] || keys["d"] || touch.right;
  const frozen = lunchTimer > 0;

  if (!frozen) {
    // weight: full ice load = planted & grippy; empty = light, twitchy, long brakes
    const wf = 0.35 + 0.65 * (crates / MAX_CRATES);
    if (gas) {
      if (player.speed >= 0) {
        // torque curve: punchy off the line, tapers toward top speed (~3s 0-to-top)
        const pull = 400 * Math.max(0.3, 1 - player.speed / 430) * (1.25 - 0.25 * wf);
        player.speed += pull * dt;
      } else {
        player.speed += ACCEL * 0.6 * dt; // weak pull out of reverse
      }
    }
    if (brake) {
      // lighter truck = less weight over the wheels = longer stopping distance
      if (player.speed > 0) player.speed -= BRAKE * (0.35 + 0.65 * wf) * dt;
      else player.speed -= ACCEL * 0.6 * dt; // reverse
    }
    // rolling resistance / engine braking
    player.speed -= player.speed * 0.4 * dt;
    if (Math.abs(player.speed) < 2 && !gas && !brake) player.speed = 0;

    const street = onStreetAt(M, player.x, player.z, 30);
    const maxF = street ? MAX_FWD : MAX_FWD * 0.45;
    const maxR = street ? MAX_REV : MAX_REV * 0.45;
    player.speed = Math.max(-maxR, Math.min(maxF, player.speed));

    const steer = (left ? -1 : 0) + (right ? 1 : 0);
    // classic arcade steering: input eases in/out, full lock at low speed,
    // less at speed so you don't spin out
    steerSm += (steer - steerSm) * Math.min(1, dt * (steer !== 0 ? 7 : 11));
    const sr = Math.min(1, Math.abs(player.speed) / MAX_FWD);
    if (Math.abs(steerSm) > 0.02 && player.speed !== 0) {
      // NOTE: heading DECREASES with left input — camera sits behind the truck
      // looking forward, so screen-right is world -x; this keeps ◀ turning
      // toward screen-left (and mirrors correctly in reverse via sign(speed)).
      player.heading -= steerSm * 3.0 * (1 - 0.55 * sr) * (1.15 - 0.15 * wf) *
        Math.sign(player.speed) * dt;
    }
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    // grip model: velocity chases where the truck points.
    // heavy truck = planted, light truck = drifts wide (the Out Run feel)
    const grip = 4 + 4 * wf;
    const gk = Math.min(1, grip * dt);
    player.vx += (fx * player.speed - player.vx) * gk;
    player.vz += (fz * player.speed - player.vz) * gk;
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    player.x = Math.max(M.minX + 20, Math.min(M.minX + M.W - 20, player.x));
    player.z = Math.max(M.minZ + 20, Math.min(M.minZ + M.H - 20, player.z));

  } else {
    // frozen (lunch): bleed off motion so the truck doesn't lurch after
    const dk = Math.max(0, 1 - 5 * dt);
    player.vx *= dk; player.vz *= dk;
  }

  // --- traffic + pedestrians ---
  for (const c of cars) updateCar(c, dt);
  for (const p of pedestrians) {
    p.dist += p.dir * p.speed * dt;
    const len = M.edgeLen[p.edge];
    let node = -1;
    if (p.dist >= len) node = M.edgeB[p.edge];
    else if (p.dist <= 0) node = M.edgeA[p.edge];
    if (node >= 0) {
      const next = chooseNextEdge(M, node, p.edge, true);
      if (next) {
        p.edge = next.edge; p.dir = next.dir;
        p.dist = next.dir > 0 ? 0 : M.edgeLen[next.edge];
      } else {
        p.dir = -p.dir;
        p.dist = Math.max(0, Math.min(len, p.dist));
      }
    }
    const a = M.edgeA[p.edge];
    const ux = M.edgeUX[p.edge], uz = M.edgeUZ[p.edge];
    p.x = M.nodeX[a] + ux * p.dist - uz * p.side * 10;
    p.z = M.nodeZ[a] + uz * p.dist + ux * p.side * 10;
    p.mesh.position.set(p.x, 0, p.z);
  }

  // --- collisions with traffic ---
  hitCooldown = Math.max(0, hitCooldown - dt);
  ticketCooldown = Math.max(0, ticketCooldown - dt);
  if (hitCooldown <= 0) {
    for (const c of cars) {
      if (Math.abs(player.x - c.x) < 26 && Math.abs(player.z - c.z) < 26) {
        hitCooldown = 1.2;
        timeLeft = Math.max(0, timeLeft - 3);
        score = Math.max(0, score - 15);
        flash("💥 CRASH! -3s", 1.2);
        beep(140, 0.25, "sawtooth", 0.2);
        player.speed *= 0.3;
        player.vx *= 0.3; player.vz *= 0.3;
        break;
      }
    }
  }
  if (hitCooldown <= 0) {
    for (const p of pedestrians) {
      if (Math.abs(player.x - p.x) < 16 && Math.abs(player.z - p.z) < 16) {
        hitCooldown = 1.2;
        timeLeft = Math.max(0, timeLeft - 2);
        flash("🚶 HEY! -2s", 1.2);
        beep(200, 0.2, "sawtooth", 0.18);
        p.x += (p.x - player.x) * 1.2;
        p.z += (p.z - player.z) * 1.2;
        break;
      }
    }
  }

  // --- red-light tickets (amber is legal to enter, NYC-style: only red is ticketed) ---
  if (Math.abs(player.speed) > 30 && ticketCooldown <= 0 && !frozen) {
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    for (const sig of M.signals) {
      const dx = player.x - sig.x, dz = player.z - sig.z;
      if (dx < -52 || dx > 52 || dz < -52 || dz > 52) continue;
      if (dx * dx + dz * dz > 52 * 52) continue;
      const axisA = Math.abs(fx * sig.ax + fz * sig.az) > 0.707;
      const p = lightPhase(sig, elapsed);
      const ok = axisA ? (p === "H" || p === "HY") : (p === "V" || p === "VY");
      if (!ok) {
        ticketCooldown = 3; tickets++;
        timeLeft = Math.max(0, timeLeft - 3);
        flash("🚨 RED LIGHT! -3s", 1.6);
        beep(180, 0.3, "sawtooth", 0.2);
        break;
      }
    }
  }

  // --- melting ice + deliveries ---
  for (let i = stops.length - 1; i >= 0; i--) {
    const s = stops[i];
    s.melt -= dt;
    if (s.blocker) {
      const b = s.blocker;
      if (b.leaving > 0) {
        b.leaving -= dt;
        b.x += b.dx * 60 * dt; b.z += b.dz * 60 * dt;
        if (b.leaving <= 0) { s.blocker = null; s.mesh.blocker.visible = false; }
      } else {
        b.wait += dt;
        b.x += Math.sin(elapsed * 3 + b.wait) * 6 * dt;
        if (b.wait > 7) b.leaving = 1.8;
      }
    }
    const d = Math.hypot(player.x - s.x, player.z - s.z);
    if (d < 52 && !s.blocker) {
      const tip = Math.round((s.melt / s.meltMax) * 100);
      score += 100 + tip;
      delivered++;
      if (crates > 0) {
        crates--;
        if (crates === 5) flash("🧊 HALF EMPTY — brakes fading", 1.8);
        else if (crates === 0) flash("🧊 EMPTY — good luck stopping", 2.0);
      }
      beep(660, 0.1, "square"); setTimeout(() => beep(880, 0.14, "square"), 90);
      removeStop(i);
    } else if (s.melt <= 0) {
      missed++;
      score = Math.max(0, score - 25);
      beep(180, 0.3, "sawtooth", 0.15);
      removeStop(i);
    }
  }

  // --- beacon visuals ---
  for (const s of stops) {
    const frac = Math.max(0, s.melt / s.meltMax);
    const col = frac > 0.5 ? 0x7fe7f2 : frac > 0.25 ? 0xf2c14e : 0xef476f;
    const bc = s.mesh.beacon;
    bc.cubeMat.color.setHex(col);
    bc.ringMat.color.setHex(col);
    bc.cube.position.y = 24 + Math.sin(elapsed * 3) * 4;
    bc.cube.rotation.y += dt * 1.5;
    const pulse = 1 + 0.1 * Math.sin(elapsed * 5);
    bc.group.scale.set(pulse, 1, pulse);
    if (s.blocker) {
      s.mesh.blocker.visible = true;
      s.mesh.blocker.position.set(s.blocker.x, 0, s.blocker.z);
    } else {
      s.mesh.blocker.visible = false;
    }
  }

  // --- honk hint ---
  let nearBlocked = false;
  for (const s of stops) {
    if (s.blocker && s.blocker.leaving <= 0 &&
        Math.hypot(player.x - s.x, player.z - s.z) < 170) { nearBlocked = true; break; }
  }
  hintEl.style.display = nearBlocked ? "block" : "none";
  if (nearBlocked) hintEl.textContent = "📯 HONK! (Space) — someone's blocking the drop-off";
  honkBtn.classList.toggle("ready", nearBlocked);

  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) flashEl.style.display = "none";
  }

  // weight-shift feel: pitch the view under accel/brake, widen FOV with speed
  const wantPitch = lunchTimer > 0 ? 0 :
    (gas && player.speed >= 0 ? -7 : (brake && player.speed > 30 ? 9 : 0));
  pitchSm += (wantPitch - pitchSm) * Math.min(1, dt * 5);

  // headlights follow the truck
  const hfx = Math.sin(player.heading), hfz = Math.cos(player.heading);
  headlight.position.set(player.x + hfx * 20, 18, player.z + hfz * 20);
  headlight.target.position.set(player.x + hfx * 300, 0, player.z + hfz * 300);
  headCone.position.set(player.x + hfx * 130, 10, player.z + hfz * 130);
  headCone.rotation.y = player.heading;

  updateSignalLamps();
  refreshDressing(dt);
  updateCamera(dt);
  updateHUD();
}

/* ---------------- camera (windshield POV) ---------------- */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let hoodAdded = false;
function updateCamera(dt) {
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  camPos.set(player.x - fx * 38, 17, player.z - fz * 38);
  camLook.set(player.x + fx * 75, 5 + pitchSm, player.z + fz * 75);
  camera.position.lerp(camPos, Math.min(1, dt * 8));
  const lookCur = new THREE.Vector3();
  camera.getWorldDirection(lookCur);
  const want = camLook.clone().sub(camera.position).normalize();
  lookCur.lerp(want, Math.min(1, dt * 8)).normalize();
  const target = camera.position.clone().add(lookCur);
  camera.lookAt(target);
  // subtle FOV widening with speed
  const targetFov = 68 + Math.min(1, Math.abs(player.speed) / MAX_FWD) * 7;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();

  if (!hoodAdded) {
    hoodAdded = true;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(34, 9, 30),
      new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
    hood.position.set(0, -8.5, -16);
    camera.add(hood);
    // side mirrors
    const mirMat = new THREE.MeshLambertMaterial({ color: 0x0e141b });
    for (const mx of [-19, 19]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(6, 1.5, 1.5), mirMat);
      arm.position.set(mx, -2, -14);
      camera.add(arm);
      const mir = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 1), mirMat);
      mir.position.set(mx + (mx > 0 ? 3 : -3), 0, -14);
      camera.add(mir);
    }
  }
}

/* ---------------- HUD / minimap / compass ---------------- */
let lastStopVersion = -1;
let dstopRefs = [];
let lastLoc = "";
let lastLocCheck = 0, lastLocX = 0, lastLocZ = 0;
function updateHUD() {
  const mm = String(Math.floor(timeLeft / 60)).padStart(1, "0");
  const ss = String(Math.floor(timeLeft % 60)).padStart(2, "0");
  hudTime.textContent = `⏱ ${mm}:${ss}`;
  hudTime.classList.toggle("low", timeLeft < 30);
  hudScore.textContent = `🧊 ${score}`;
  hudCounts.innerHTML = `📦 ${delivered}&nbsp;&nbsp;✖ ${missed}`;

  if (stopVersion !== lastStopVersion) {
    lastStopVersion = stopVersion;
    deliveriesEl.innerHTML = "";
    dstopRefs = stops.map((s) => {
      const div = document.createElement("div");
      div.className = "dstop";
      div.innerHTML = `<div class="nm">${s.name}</div><div class="bar"><div></div></div>`;
      deliveriesEl.appendChild(div);
      return { bar: div.querySelector(".bar > div") };
    });
  }
  stops.forEach((s, i) => {
    const ref = dstopRefs[i];
    if (!ref) return;
    const frac = Math.max(0, s.melt / s.meltMax);
    ref.bar.style.width = `${frac * 100}%`;
    ref.bar.style.background = frac > 0.5 ? "#7fe7f2" : frac > 0.25 ? "#f2c14e" : "#ef476f";
  });

  // compass to nearest stop
  if (stops.length) {
    let best = stops[0], bd = Infinity;
    for (const s of stops) {
      const d = Math.hypot(s.x - player.x, s.z - player.z);
      if (d < bd) { bd = d; best = s; }
    }
    const bearing = Math.atan2(best.x - player.x, best.z - player.z);
    let rel = bearing - player.heading;
    compassArrow.style.transform = `rotate(${rel * 180 / Math.PI - 90}deg)`;
    compassDist.textContent = `${Math.round(bd / 10) * 10}m`;
  }

  // location readout: nearest named real street (throttled hash lookup)
  if (elapsed - lastLocCheck > 0.4 || Math.hypot(player.x - lastLocX, player.z - lastLocZ) > 25) {
    lastLocCheck = elapsed; lastLocX = player.x; lastLocZ = player.z;
    const name = nearestNamedRoad(M, player.x, player.z, 160);
    const locStr = name ? `📍 ${name}` : "📍 Manhattan";
    if (locStr !== lastLoc) { lastLoc = locStr; locEl.textContent = locStr; }
  }

  speedo.innerHTML = `${Math.round(Math.abs(player.speed) * 0.22)} <small>mph</small><span id="gear">${gearFor(player.speed)}</span>`;

  // cargo meter: full bar = planted, empty = skittish
  const cf = crates / MAX_CRATES;
  cargoBar.style.width = `${cf * 100}%`;
  cargoBar.style.background = cf > 0.5 ? "#7fe7f2" : cf > 0.2 ? "#f2c14e" : "#ef476f";

  // minimap: a window of the real map around the player, drawn from the
  // same ground texture canvas (150x104 canvas, 1400x970-unit window).
  // The old full-city minimap can't work: the island is 11,300 units tall
  // and the canvas is only 150x104, so a local window reads far better.
  const mw = mmCanvas.width, mh = mmCanvas.height;
  const winW = 1400, winH = 970;
  mmCtx.fillStyle = "rgba(0,0,0,0.6)";
  mmCtx.fillRect(0, 0, mw, mh);
  if (groundCanvas) {
    const ts = groundCanvas.width / M.W;
    const sx0 = (player.x - winW / 2 - M.minX) * ts;
    const sy0 = (player.z - winH / 2 - M.minZ) * ts;
    mmCtx.drawImage(groundCanvas, sx0, sy0, winW * ts, winH * ts, 0, 0, mw, mh);
  }
  const mwx0 = player.x - winW / 2, mwz0 = player.z - winH / 2;
  for (const s of stops) {
    const dx = (s.x - mwx0) / winW * mw, dz = (s.z - mwz0) / winH * mh;
    if (dx < 0 || dz < 0 || dx > mw || dz > mh) continue;
    mmCtx.fillStyle = "#7fe7f2";
    mmCtx.beginPath(); mmCtx.arc(dx, dz, 3, 0, Math.PI * 2); mmCtx.fill();
  }
  // player wedge, centered
  const px = mw / 2, pz = mh / 2;
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  mmCtx.fillStyle = "#e8c547";
  mmCtx.beginPath();
  mmCtx.moveTo(px + fx * 7, pz + fz * 7);
  mmCtx.lineTo(px - fz * 4 - fx * 4, pz + fx * 4 - fz * 4);
  mmCtx.lineTo(px + fz * 4 - fx * 4, pz - fx * 4 - fz * 4);
  mmCtx.closePath(); mmCtx.fill();
}

/* ---------------- main loop ---------------- */
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (state === "play") update(dt);
  renderer.render(scene, camera);
}

/* ---------------- real-map init ---------------- */
// The game boots only once map.json (the real Manhattan data, deployed next
// to this file) has loaded and been processed. Until then the menu shows a
// loading line and start taps are ignored (or retry after a failure).
let mapReady = false, mapFailed = false;
const loadEl = document.createElement("p");
loadEl.className = "go";
loadEl.textContent = "🗺️ Loading real Manhattan…";
menuEl.appendChild(loadEl);

async function initMap() {
  mapFailed = false;
  loadEl.textContent = "🗺️ Loading real Manhattan…";
  try {
    const res = await fetch("map.json");
    if (!res.ok) throw new Error("map.json HTTP " + res.status);
    RAW = await res.json();
    M = processMapData(RAW);
    buildStatic();
    buildSignals();
    // moon above the real city center instead of the old grid origin
    moonMesh.position.set(M.cx - 500, 700, M.cz - 1400);
    RAW = null; // processed + rasterized; release the parsed JSON
    initPools();
    resetGame();
    state = "menu";
    mapReady = true;
    loadEl.remove();
    // the menu copy in index.html still describes the old grid — fix it live
    for (const p of menuEl.querySelectorAll("p")) {
      if (p.textContent.includes("Midtown Manhattan grid")) {
        p.textContent = "🗽 Real Manhattan — starting in the Lower East Side, with real one-ways and signals.";
      }
    }
    loop();
  } catch (err) {
    mapFailed = true;
    loadEl.textContent = "⚠️ Couldn't load the real map — tap to retry.";
  }
}
initMap();
