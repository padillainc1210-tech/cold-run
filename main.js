/* ============================================================
   COLD RUN 3D — Ice Delivery
   First-person windshield view. Same city, same rules.
   Controls: ▲ gas · ▼ brake · ◀ ▶ steer · Space = honk
   Touch: on-screen pedals + steering.
   ============================================================ */
import * as THREE from "three";

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const sceneCanvas = $("scene"), mmCanvas = $("minimap"), mmCtx = mmCanvas.getContext("2d");
const hudTime = $("hudTime"), hudScore = $("hudScore"), hudCounts = $("hudCounts");
const deliveriesEl = $("deliveries"), compassArrow = $("compassArrow"), compassDist = $("compassDist");
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

/* ---------------- city data (x right, z down-map) ---------------- */
const WORLD_W = 2600, WORLD_H = 1800;
const BLOCK = 190, STREET_W = 52, SHIFT_LEN = 180;
// NYC DOT-style signal timing: 9s green, 3s amber, 2s all-red clearance per phase
const LIGHT_PERIOD = 28, GREEN_T = 9, YELLOW_T = 3, ALLRED_T = 2;

let vStreets = [], hStreets = [], intersections = [], blocks = [];
function buildCityData() {
  const ox = (WORLD_W % BLOCK) / 2 + BLOCK / 2;
  const oy = (WORLD_H % BLOCK) / 2 + BLOCK / 2;
  for (let x = ox; x < WORLD_W; x += BLOCK) vStreets.push(x);
  for (let y = oy; y < WORLD_H; y += BLOCK) hStreets.push(y);
  for (let i = 0; i < vStreets.length; i++)
    for (let j = 0; j < hStreets.length; j++) {
      const m = (i + j) % 4;
      intersections.push({
        x: vStreets[i], z: hStreets[j], i, j,
        light: m === 0 ? { offset: (i * 3 + j * 7) % LIGHT_PERIOD } : null,
        stop: m === 2,
      });
    }
  for (let i = 0; i < vStreets.length - 1; i++)
    for (let j = 0; j < hStreets.length - 1; j++) {
      const x0 = vStreets[i] + STREET_W / 2 + 8, z0 = hStreets[j] + STREET_W / 2 + 8;
      const w = vStreets[i + 1] - vStreets[i] - STREET_W - 16;
      const d = hStreets[j + 1] - hStreets[j] - STREET_W - 16;
      if (w > 20 && d > 20)
        blocks.push({ x0, z0, w, d, h: 40 + Math.random() * 95 });
    }
}
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
const axisGreen = (light, t, vertical) => {
  const p = lightPhase(light, t);
  return vertical ? p === "V" : p === "H";
};
function onStreet(x, z) {
  for (const sx of vStreets) if (Math.abs(x - sx) < STREET_W / 2 + 14) return true;
  for (const sz of hStreets) if (Math.abs(z - sz) < STREET_W / 2 + 14) return true;
  return false;
}

/* ---------------- three.js setup ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas: sceneCanvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1224);
scene.fog = new THREE.Fog(0x0c1224, 260, 1200);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 1, 2600);
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
function buildingTexture(base, litRatio) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, 64, 128);
  for (let y = 8; y < 118; y += 15)
    for (let x = 7; x < 55; x += 14) {
      g.fillStyle = Math.random() < litRatio ? "rgba(255,214,130,0.95)" : "rgba(16,22,34,1)";
      g.fillRect(x, y, 8, 9);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function dashTexture() {
  const c = document.createElement("canvas");
  c.width = 8; c.height = 128;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 8, 128);
  g.fillStyle = "rgba(232,197,71,0.85)";
  g.fillRect(2, 20, 4, 60);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ---------------- static geometry ---------------- */
const MAT = {
  ground: new THREE.MeshLambertMaterial({ color: 0x0b0e14 }),
  road: new THREE.MeshLambertMaterial({ color: 0x232a38 }),
  roof: new THREE.MeshLambertMaterial({ color: 0x11141c }),
  pole: new THREE.MeshLambertMaterial({ color: 0x3a3f47 }),
  signRed: new THREE.MeshLambertMaterial({ color: 0xc0392b }),
  dark: new THREE.MeshLambertMaterial({ color: 0x14161c }),
};
function buildStatic() {
  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W + 600, WORLD_H + 600), MAT.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD_W / 2, -0.5, WORLD_H / 2);
  scene.add(ground);

  // street strips
  for (const sx of vStreets) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(STREET_W, WORLD_H), MAT.road);
    r.rotation.x = -Math.PI / 2;
    r.position.set(sx, 0, WORLD_H / 2);
    scene.add(r);
    addDashes(sx, WORLD_H / 2, false);
  }
  for (const sz of hStreets) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, STREET_W), MAT.road);
    r.rotation.x = -Math.PI / 2;
    r.position.set(WORLD_W / 2, 0, sz);
    scene.add(r);
    addDashes(WORLD_W / 2, sz, true);
  }

  // buildings
  const sideMats = [
    new THREE.MeshLambertMaterial({ map: buildingTexture("#232a3d", 0.45) }),
    new THREE.MeshLambertMaterial({ map: buildingTexture("#262c3a", 0.3) }),
    new THREE.MeshLambertMaterial({ map: buildingTexture("#1c2334", 0.55) }),
  ];
  for (const b of blocks) {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    const side = sideMats[(Math.random() * sideMats.length) | 0];
    const mesh = new THREE.Mesh(geo, [side, side, MAT.roof, MAT.dark, side, side]);
    mesh.position.set(b.x0 + b.w / 2, b.h / 2 - 0.5, b.z0 + b.d / 2);
    scene.add(mesh);
  }

  // NYC DOT-standard cobra-head streetlights: staggered sides, every other block,
  // warm sodium-vapor glow like the real city at night
  const poleGeo = new THREE.CylinderGeometry(1.1, 1.5, 46, 6);
  const armGeo = new THREE.BoxGeometry(16, 1.6, 1.6);
  const headGeo = new THREE.BoxGeometry(7, 2.2, 3.2);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffa64d });
  const poolGeo = new THREE.CircleGeometry(40, 18);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xff9a3c, transparent: true, opacity: 0.10,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  function cobraHead(px, pz, armDirX, armDirZ) {
    const pole = new THREE.Mesh(poleGeo, MAT.pole);
    pole.position.set(px, 23, pz); scene.add(pole);
    const arm = new THREE.Mesh(armGeo, MAT.pole);
    arm.position.set(px + armDirX * 8, 45, pz + armDirZ * 8);
    if (armDirZ !== 0) arm.rotation.y = Math.PI / 2;
    scene.add(arm);
    const hx = px + armDirX * 15, hz = pz + armDirZ * 15;
    const head = new THREE.Mesh(headGeo, lampMat);
    head.position.set(hx, 44, hz);
    if (armDirZ !== 0) head.rotation.y = Math.PI / 2;
    scene.add(head);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(hx, 0.4, hz); scene.add(pool);
  }
  for (let i = 0; i < vStreets.length; i++) {
    for (let j = 0; j < hStreets.length - 1; j += 2) {
      const side = ((i + j) % 2 === 0) ? 1 : -1;
      cobraHead(vStreets[i] + side * (STREET_W / 2 + 7),
        (hStreets[j] + hStreets[j + 1]) / 2, -side, 0);
    }
  }
  for (let j = 0; j < hStreets.length; j++) {
    for (let i = 0; i < vStreets.length - 1; i += 2) {
      const side = ((i + j) % 2 === 0) ? 1 : -1;
      cobraHead((vStreets[i] + vStreets[i + 1]) / 2,
        hStreets[j] + side * (STREET_W / 2 + 7), 0, -side);
    }
  }
}
const dashTexBase = dashTexture();
function addDashes(cx, cz, horizontal) {
  const len = horizontal ? WORLD_W : WORLD_H;
  const tex = dashTexBase.clone();
  tex.needsUpdate = true;
  tex.repeat.set(1, len / 130);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(horizontal ? len : 4, horizontal ? 4 : len),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(cx, 0.25, cz);
  scene.add(m);
}

// traffic lights & stop signs (also store lamp materials for phase updates)
const lightHeads = []; // {n, hMat, vMat, lastPhase}
function buildSignals() {
  for (const n of intersections) {
    if (n.stop) {
      const px = n.x + STREET_W / 2 + 10, pz = n.z - STREET_W / 2 - 10;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 26, 6), MAT.pole);
      pole.position.set(px, 13, pz);
      scene.add(pole);
      const sign = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 1.5, 8), MAT.signRed);
      sign.rotation.x = Math.PI / 2;
      sign.rotation.y = Math.PI / 8;
      sign.position.set(px, 28, pz);
      scene.add(sign);
    }
    if (n.light) {
      const px = n.x - STREET_W / 2 - 8, pz = n.z - STREET_W / 2 - 8;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.4, 34, 6), MAT.pole);
      pole.position.set(px, 17, pz);
      scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(7, 20, 7), MAT.dark);
      head.position.set(px, 40, pz);
      scene.add(head);
      const hMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
      const vMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
      const hLamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), hMat);
      hLamp.position.set(px, 45, pz); scene.add(hLamp);
      const vLamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), vMat);
      vLamp.position.set(px, 35, pz); scene.add(vLamp);
      lightHeads.push({ n, hMat, vMat, lastPhase: "" });
    }
  }
}
function updateSignalLamps() {
  // each lamp is a full 3-color head for its axis: green / amber / red
  for (const lh of lightHeads) {
    const phase = lightPhase(lh.n.light, elapsed);
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
let lunchDone, lunchTimer, hitCooldown = 0, ticketCooldown = 0, buildCooldown = 0;
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
  hitCooldown = 0; ticketCooldown = 0; buildCooldown = 0; flashTimer = 0;
  player.x = vStreets[0]; player.z = hStreets[0];
  player.heading = Math.PI / 2; player.speed = 0; player.vx = 0; player.vz = 0;
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
  const sx = vStreets[(Math.random() * vStreets.length) | 0];
  const sz = hStreets[(Math.random() * hStreets.length) | 0];
  const meltMax = 55 - Math.min(22, elapsed / 12);
  const stop = {
    x: Math.max(40, Math.min(WORLD_W - 40, sx + (Math.random() - 0.5) * 30)),
    z: Math.max(40, Math.min(WORLD_H - 40, sz + (Math.random() - 0.5) * 30)),
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
  const vertical = Math.random() < 0.5;
  const cruise = (100 + Math.random() * 120) * (1 + elapsed / 300);
  const car = {
    vertical, dir: Math.random() < 0.5 ? 1 : -1,
    cruise, speed: cruise, waitT: 0, stopKey: "",
    mesh: free,
  };
  if (vertical) {
    car.x = vStreets[(Math.random() * vStreets.length) | 0] + (Math.random() < 0.5 ? -13 : 13);
    car.z = Math.random() * WORLD_H;
  } else {
    car.x = Math.random() * WORLD_W;
    car.z = hStreets[(Math.random() * hStreets.length) | 0] + (Math.random() < 0.5 ? -13 : 13);
  }
  free.group.visible = true;
  cars.push(car);
}
function nextIntersection(car, lookahead) {
  let best = null, bestD = lookahead;
  for (const n of intersections) {
    if (car.vertical) {
      if (Math.abs(n.x - car.x) > STREET_W) continue;
      const d = (n.z - car.z) * car.dir;
      if (d > -10 && d < bestD) { best = n; bestD = d; }
    } else {
      if (Math.abs(n.z - car.z) > STREET_W) continue;
      const d = (n.x - car.x) * car.dir;
      if (d > -10 && d < bestD) { best = n; bestD = d; }
    }
  }
  return best ? { n: best, d: bestD } : null;
}
function updateCar(car, dt) {
  let target = car.cruise;
  const ahead = nextIntersection(car, 150);
  if (ahead) {
    const { n, d } = ahead;
    const stopLine = d - (STREET_W / 2 + 30);
    if (n.light) {
      const green = axisGreen(n.light, elapsed, car.vertical);
      const phase = lightPhase(n.light, elapsed);
      const yellow = phase === "HY" || phase === "VY";
      if ((!green && !(yellow && stopLine < 28)) && stopLine < 110 && stopLine > -20) {
        if (stopLine <= 3) {
          target = 0;
          if (car.vertical) car.z = n.z - car.dir * (STREET_W / 2 + 30);
          else car.x = n.x - car.dir * (STREET_W / 2 + 30);
        } else {
          target = Math.min(target, car.cruise * (stopLine / 110));
        }
      }
    } else if (n.stop) {
      const key = n.i + "," + n.j;
      if (car.stopKey !== key && stopLine < 60 && stopLine > -20) {
        if (stopLine <= 7) {
          car.waitT += dt; target = 0;
          if (car.vertical) car.z = n.z - car.dir * (STREET_W / 2 + 30);
          else car.x = n.x - car.dir * (STREET_W / 2 + 30);
          if (car.waitT > 0.9) { car.stopKey = key; car.waitT = 0; }
        } else {
          target = Math.min(target, car.cruise * (stopLine / 60));
          car.waitT = 0;
        }
      }
    }
  }
  const rate = target < car.speed ? 420 : 200;
  const dv = target - car.speed;
  car.speed += Math.max(-rate * dt, Math.min(rate * dt, dv));

  if (car.vertical) {
    car.z += car.dir * car.speed * dt;
    if (car.z > WORLD_H + 60) { car.z = -60; car.stopKey = ""; }
    if (car.z < -60) { car.z = WORLD_H + 60; car.stopKey = ""; }
    car.mesh.group.rotation.y = car.dir > 0 ? 0 : Math.PI;
  } else {
    car.x += car.dir * car.speed * dt;
    if (car.x > WORLD_W + 60) { car.x = -60; car.stopKey = ""; }
    if (car.x < -60) { car.x = WORLD_W + 60; car.stopKey = ""; }
    car.mesh.group.rotation.y = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  car.mesh.group.position.set(car.x, 0, car.z);
  car.mesh.tailMat.color.setHex(car.speed < 4 ? 0xff2222 : 0x881111);
}

function spawnPedestrian() {
  const g = pedPool.find((m) => !m.visible);
  if (!g || pedestrians.length >= MAX_PEDS) return;
  const vertical = Math.random() < 0.5;
  const side = Math.random() < 0.5 ? 1 : -1;
  const off = STREET_W / 2 + 12;
  const p = { mesh: g, vx: 0, vz: 0 };
  if (vertical) {
    p.x = vStreets[(Math.random() * vStreets.length) | 0] + side * off;
    p.z = Math.random() * WORLD_H;
    p.vz = side * (42 + Math.random() * 36);
  } else {
    p.x = Math.random() * WORLD_W;
    p.z = hStreets[(Math.random() * hStreets.length) | 0] + side * off;
    p.vx = side * (42 + Math.random() * 36);
  }
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

    const street = onStreet(player.x, player.z);
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
    player.x = Math.max(20, Math.min(WORLD_W - 20, player.x));
    player.z = Math.max(20, Math.min(WORLD_H - 20, player.z));

    // building collision: circle vs block AABB (slide along walls, thud on hard hits)
    buildCooldown = Math.max(0, buildCooldown - dt);
    for (const b of blocks) {
      if (player.x < b.x0 - 14 || player.x > b.x0 + b.w + 14 ||
          player.z < b.z0 - 14 || player.z > b.z0 + b.d + 14) continue;
      const cx = Math.max(b.x0, Math.min(player.x, b.x0 + b.w));
      const cz = Math.max(b.z0, Math.min(player.z, b.z0 + b.d));
      const dx = player.x - cx, dz = player.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < 14 * 14) {
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d, nz = dz / d;
        player.x = cx + nx * 14;
        player.z = cz + nz * 14;
        // strip velocity into the wall so the truck slides along it
        const vn = player.vx * nx + player.vz * nz;
        if (vn < 0) { player.vx -= nx * vn; player.vz -= nz * vn; }
        // velocity into the wall?
        const fx0 = Math.sin(player.heading), fz0 = Math.cos(player.heading);
        const vn0 = fx0 * player.speed * nx + fz0 * player.speed * nz;
        if (vn0 < -80) {
          // hard hit
          if (buildCooldown <= 0) {
            buildCooldown = 0.8;
            flash("💥 OUCH", 0.9);
            beep(120, 0.25, "sawtooth", 0.2);
          }
          player.speed *= 0.35;
          player.vx *= 0.35; player.vz *= 0.35;
        } else {
          // scrape: keep most of the speed so wall-sliding works
          player.speed *= 0.985;
          player.vx *= 0.985; player.vz *= 0.985;
        }
        break;
      }
    }
  } else {
    // frozen (lunch): bleed off motion so the truck doesn't lurch after
    const dk = Math.max(0, 1 - 5 * dt);
    player.vx *= dk; player.vz *= dk;
  }

  // --- traffic + pedestrians ---
  for (const c of cars) updateCar(c, dt);
  for (const p of pedestrians) {
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (p.x < -30) p.x = WORLD_W + 30;
    if (p.x > WORLD_W + 30) p.x = -30;
    if (p.z < -30) p.z = WORLD_H + 30;
    if (p.z > WORLD_H + 30) p.z = -30;
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
    const horiz = Math.abs(Math.sin(player.heading)) >= Math.abs(Math.cos(player.heading));
    for (const n of intersections) {
      if (!n.light) continue;
      if (Math.hypot(player.x - n.x, player.z - n.z) > 52) continue;
      const p = lightPhase(n.light, elapsed);
      const ok = horiz ? (p === "H" || p === "HY") : (p === "V" || p === "VY");
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

  speedo.innerHTML = `${Math.round(Math.abs(player.speed) * 0.22)} <small>mph</small><span id="gear">${gearFor(player.speed)}</span>`;

  // cargo meter: full bar = planted, empty = skittish
  const cf = crates / MAX_CRATES;
  cargoBar.style.width = `${cf * 100}%`;
  cargoBar.style.background = cf > 0.5 ? "#7fe7f2" : cf > 0.2 ? "#f2c14e" : "#ef476f";

  // minimap
  const mw = mmCanvas.width, mh = mmCanvas.height;
  const sx = mw / WORLD_W, sz = mh / WORLD_H;
  mmCtx.fillStyle = "rgba(0,0,0,0.6)";
  mmCtx.fillRect(0, 0, mw, mh);
  mmCtx.strokeStyle = "rgba(255,255,255,0.25)";
  mmCtx.lineWidth = 1;
  for (const vx of vStreets) {
    mmCtx.beginPath(); mmCtx.moveTo(vx * sx, 0); mmCtx.lineTo(vx * sx, mh); mmCtx.stroke();
  }
  for (const hz of hStreets) {
    mmCtx.beginPath(); mmCtx.moveTo(0, hz * sz); mmCtx.lineTo(mw, hz * sz); mmCtx.stroke();
  }
  for (const s of stops) {
    mmCtx.fillStyle = "#7fe7f2";
    mmCtx.beginPath(); mmCtx.arc(s.x * sx, s.z * sz, 3, 0, Math.PI * 2); mmCtx.fill();
  }
  // player wedge
  const px = player.x * sx, pz = player.z * sz;
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

buildCityData();
buildStatic();
buildSignals();
initPools();
resetGame();
state = "menu";
loop();
