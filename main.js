/* ============================================================
   COLD RUN — Ice Delivery
   Deliver ice across the city before it melts. Beat traffic.
   Controls: Arrow keys / WASD, or press-and-drag on touch/mouse.
   ============================================================ */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  buildCity();
}
window.addEventListener("resize", resize);

/* ---------------- audio (tiny beeps, guarded) ---------------- */
let AC = null;
function beep(freq, dur, type = "sine", vol = 0.12) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch (e) { /* audio unavailable — game still works */ }
}

/* ---------------- city grid ---------------- */
const BLOCK = 190;          // distance between street centers
const STREET_W = 52;        // street width
let vStreets = [];          // x positions of vertical streets
let hStreets = [];          // y positions of horizontal streets

function buildCity() {
  vStreets = [];
  hStreets = [];
  const ox = (canvas.width % BLOCK) / 2 + BLOCK / 2;
  const oy = (canvas.height % BLOCK) / 2 + BLOCK / 2;
  for (let x = ox; x < canvas.width; x += BLOCK) vStreets.push(x);
  for (let y = oy; y < canvas.height; y += BLOCK) hStreets.push(y);
}

function onStreet(x, y) {
  for (const sx of vStreets) if (Math.abs(x - sx) < STREET_W / 2 + 14) return true;
  for (const sy of hStreets) if (Math.abs(y - sy) < STREET_W / 2 + 14) return true;
  return false;
}

/* ---------------- game state ---------------- */
const SHIFT_LEN = 180;      // 3 minute shift
let state = "menu";         // menu | play | over
let timeLeft, score, delivered, missed;
let stops = [];
let cars = [];
let pedestrians = [];
let elapsed = 0;
let lunchDone, lunchTimer;

const truck = { x: 0, y: 0, w: 64, h: 34, speed: 5.2 };

function resetGame() {
  timeLeft = SHIFT_LEN;
  score = 0; delivered = 0; missed = 0;
  stops = []; cars = []; pedestrians = [];
  elapsed = 0;
  lunchDone = false; lunchTimer = 0;
  hitCooldown = 0;
  truck.x = vStreets[0] - truck.w / 2;
  truck.y = hStreets[0] - truck.h / 2;
  for (let i = 0; i < 2; i++) spawnStop();
  for (let i = 0; i < 7; i++) spawnCar();
}

/* ---------------- deliveries (melting ice!) ---------------- */
const CUSTOMERS = ["Joe's Deli", "Bar Neon", "Pizza Corner", "Cafe Luna",
  "The Taproom", "Sushi Bay", "Hotel Grand", "Burger Joint"];

function spawnStop() {
  // drop the stop on a random street intersection
  const sx = vStreets[(Math.random() * vStreets.length) | 0];
  const sy = hStreets[(Math.random() * hStreets.length) | 0];
  const meltMax = 50 - Math.min(20, elapsed / 12); // melts faster later
  const stop = {
    x: sx + (Math.random() - 0.5) * 30,
    y: sy + (Math.random() - 0.5) * 30,
    melt: meltMax, meltMax,
    name: CUSTOMERS[(Math.random() * CUSTOMERS.length) | 0],
    blocker: null,
  };
  // sometimes a loiterer is camped in front of the drop-off
  if (Math.random() < 0.45) {
    stop.blocker = {
      x: stop.x + (Math.random() - 0.5) * 24,
      y: stop.y + (Math.random() - 0.5) * 24,
      wait: 0, leaving: 0,
      dx: Math.random() < 0.5 ? 1 : -1, dy: (Math.random() - 0.5),
    };
  }
  stops.push(stop);
}

/* ---------------- traffic ---------------- */
const CAR_COLORS = ["#e74c3c", "#f39c12", "#8e44ad", "#16a085", "#d35400"];
function spawnCar() {
  const vertical = Math.random() < 0.5;
  const speed = (1.6 + Math.random() * 2.2) * (1 + elapsed / 240);
  if (vertical) {
    cars.push({
      vertical: true,
      x: vStreets[(Math.random() * vStreets.length) | 0],
      y: Math.random() * canvas.height,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed, w: 26, h: 44,
      color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
    });
  } else {
    cars.push({
      vertical: false,
      x: Math.random() * canvas.width,
      y: hStreets[(Math.random() * hStreets.length) | 0],
      dir: Math.random() < 0.5 ? 1 : -1,
      speed, w: 44, h: 26,
      color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
    });
  }
}

/* ---------------- pedestrians ---------------- */
const PED_COLORS = ["#5d6d7e", "#7d6608", "#6e2c00", "#4a235a"];
function spawnPedestrian() {
  const vertical = Math.random() < 0.5;
  const side = Math.random() < 0.5 ? 1 : -1;
  const off = STREET_W / 2 + 12;
  if (vertical) {
    const sx = vStreets[(Math.random() * vStreets.length) | 0];
    pedestrians.push({
      x: sx + side * off, y: Math.random() * canvas.height,
      vx: 0, vy: side * (0.7 + Math.random() * 0.6),
      color: PED_COLORS[(Math.random() * PED_COLORS.length) | 0],
    });
  } else {
    const sy = hStreets[(Math.random() * hStreets.length) | 0];
    pedestrians.push({
      x: Math.random() * canvas.width, y: sy + side * off,
      vx: side * (0.7 + Math.random() * 0.6), vy: 0,
      color: PED_COLORS[(Math.random() * PED_COLORS.length) | 0],
    });
  }
}

/* ---------------- honking ---------------- */
function honk() {
  const tx = truck.x + truck.w / 2, ty = truck.y + truck.h / 2;
  let shooed = false;
  for (const s of stops) {
    if (s.blocker && s.blocker.leaving <= 0 &&
        Math.hypot(tx - s.x, ty - s.y) < 170) {
      s.blocker.leaving = 1.8;
      shooed = true;
    }
  }
  // two-tone horn
  beep(370, 0.12, "square", 0.15);
  setTimeout(() => beep(294, 0.18, "square", 0.15), 110);
  return shooed;
}

function honkButton() {
  return { x: canvas.width - 62, y: canvas.height - 62, r: 36 };
}
/* ---------------- input ---------------- */
const keys = {};
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  if (state !== "play" && (k === "enter" || k === " ")) startGame();
  if (state === "play" && k === " ") honk();
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

let dragging = false, dragX = 0, dragY = 0;
canvas.addEventListener("pointerdown", (e) => {
  if (state !== "play") { startGame(); return; }
  // honk button first — it's not steering
  const hb = honkButton();
  if (Math.hypot(e.clientX - hb.x, e.clientY - hb.y) < hb.r + 8) {
    honk();
    return;
  }
  dragging = true; dragX = e.clientX; dragY = e.clientY;
});
window.addEventListener("pointermove", (e) => {
  if (dragging) { dragX = e.clientX; dragY = e.clientY; }
});
window.addEventListener("pointerup", () => { dragging = false; });

function startGame() {
  resetGame();
  state = "play";
  beep(520, 0.12, "square");
}

/* ---------------- update ---------------- */
let hitCooldown = 0;

function update(dt) {
  elapsed += dt;
  timeLeft -= dt;
  if (timeLeft <= 0) { timeLeft = 0; state = "over"; beep(220, 0.4, "sawtooth"); return; }

  // --- mandatory lunch: halfway through the shift, 8 seconds, no driving ---
  // (the ice keeps melting. union rules.)
  if (!lunchDone && elapsed >= SHIFT_LEN / 2) {
    lunchDone = true;
    lunchTimer = 8;
    beep(440, 0.15, "square"); setTimeout(() => beep(330, 0.25, "square"), 170);
  }
  if (lunchTimer > 0) lunchTimer -= dt;

  // ramp difficulty: more stops, more cars
  if (stops.length < 2 + Math.floor(elapsed / 45) && stops.length < 5) spawnStop();
  if (cars.length < 7 + Math.floor(elapsed / 40) && Math.random() < 0.02) spawnCar();

  // --- truck movement (frozen during mandatory lunch) ---
  if (lunchTimer <= 0) {
  let vx = 0, vy = 0;
  if (keys["arrowleft"] || keys["a"]) vx -= 1;
  if (keys["arrowright"] || keys["d"]) vx += 1;
  if (keys["arrowup"] || keys["w"]) vy -= 1;
  if (keys["arrowdown"] || keys["s"]) vy += 1;

  const street = onStreet(truck.x + truck.w / 2, truck.y + truck.h / 2);
  const spd = truck.speed * (street ? 1 : 0.45) * (dt * 60);

  if (vx !== 0 || vy !== 0) {
    const len = Math.hypot(vx, vy);
    truck.x += (vx / len) * spd;
    truck.y += (vy / len) * spd;
  } else if (dragging) {
    const dx = dragX - (truck.x + truck.w / 2);
    const dy = dragY - (truck.y + truck.h / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > 8) {
      truck.x += (dx / dist) * Math.min(spd, dist / 6);
      truck.y += (dy / dist) * Math.min(spd, dist / 6);
    }
  }
  truck.x = Math.max(0, Math.min(canvas.width - truck.w, truck.x));
  truck.y = Math.max(0, Math.min(canvas.height - truck.h, truck.y));
  } // end lunch freeze

  // --- traffic movement ---
  for (const c of cars) {
    if (c.vertical) {
      c.y += c.dir * c.speed * dt * 60;
      if (c.y > canvas.height + 60) c.y = -60;
      if (c.y < -60) c.y = canvas.height + 60;
    } else {
      c.x += c.dir * c.speed * dt * 60;
      if (c.x > canvas.width + 60) c.x = -60;
      if (c.x < -60) c.x = canvas.width + 60;
    }
  }

  // --- pedestrian movement (sidewalk wanderers) ---
  if (pedestrians.length < 6 && Math.random() < 0.015) spawnPedestrian();
  for (const p of pedestrians) {
    p.x += p.vx * dt * 60;
    p.y += p.vy * dt * 60;
    if (p.x < -30) p.x = canvas.width + 30;
    if (p.x > canvas.width + 30) p.x = -30;
    if (p.y < -30) p.y = canvas.height + 30;
    if (p.y > canvas.height + 30) p.y = -30;
  }

  // --- collisions: traffic costs time, pedestrians cost time + guilt ---
  hitCooldown = Math.max(0, hitCooldown - dt);
  const tx = truck.x + truck.w / 2, ty = truck.y + truck.h / 2;
  for (const c of cars) {
    const cx = c.x, cy = c.y;
    if (Math.abs(tx - cx) < (truck.w + c.w) / 2 - 8 &&
        Math.abs(ty - cy) < (truck.h + c.h) / 2 - 8) {
      if (hitCooldown <= 0) {
        hitCooldown = 1.2;
        timeLeft = Math.max(0, timeLeft - 3);
        score = Math.max(0, score - 15);
        beep(140, 0.25, "sawtooth", 0.2);
        // shove the truck back a little
        truck.x -= (cx - tx) * 0.4;
        truck.y -= (cy - ty) * 0.4;
      }
    }
  }
  // pedestrians: clipping one costs 2 seconds (and you feel bad)
  for (const p of pedestrians) {
    if (Math.abs(tx - p.x) < 30 && Math.abs(ty - p.y) < 30) {
      if (hitCooldown <= 0) {
        hitCooldown = 1.2;
        timeLeft = Math.max(0, timeLeft - 2);
        beep(200, 0.2, "sawtooth", 0.18);
        // the pedestrian dives out of the way
        p.x += (p.x - tx) * 0.8;
        p.y += (p.y - ty) * 0.8;
      }
    }
  }

  // --- melting ice + deliveries ---
  for (let i = stops.length - 1; i >= 0; i--) {
    const s = stops[i];
    s.melt -= dt;
    // the loiterer: honk them off, or they wander away on their own eventually
    if (s.blocker) {
      const b = s.blocker;
      if (b.leaving > 0) {
        b.leaving -= dt;
        b.x += b.dx * 60 * dt;
        b.y += b.dy * 60 * dt;
        if (b.leaving <= 0) s.blocker = null;
      } else {
        b.wait += dt;
        // small idle shuffle so they look alive
        b.x += Math.sin(elapsed * 3 + b.wait) * 6 * dt;
        if (b.wait > 7) b.leaving = 1.8; // gives up and wanders off
      }
    }
    const d = Math.hypot(tx - s.x, ty - s.y);
    if (d < 46 && !s.blocker) {
      // delivered!
      const tip = Math.round((s.melt / s.meltMax) * 100);
      score += 100 + tip;
      delivered++;
      beep(660, 0.1, "square"); setTimeout(() => beep(880, 0.14, "square"), 90);
      stops.splice(i, 1);
      spawnStop();
    } else if (s.melt <= 0) {
      // melted — customer lost
      missed++;
      score = Math.max(0, score - 25);
      beep(180, 0.3, "sawtooth", 0.15);
      stops.splice(i, 1);
      spawnStop();
    }
  }
}

/* ---------------- draw ---------------- */
function drawCity() {
  ctx.fillStyle = "#0b0e14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // blocks (buildings)
  ctx.fillStyle = "#141a26";
  for (let i = 0; i < vStreets.length - 1; i++) {
    for (let j = 0; j < hStreets.length - 1; j++) {
      const x = vStreets[i] + STREET_W / 2 + 8;
      const y = hStreets[j] + STREET_W / 2 + 8;
      const w = vStreets[i + 1] - vStreets[i] - STREET_W - 16;
      const h = hStreets[j + 1] - hStreets[j] - STREET_W - 16;
      if (w > 20 && h > 20) {
        ctx.fillRect(x, y, w, h);
        // windows
        ctx.fillStyle = "rgba(255,220,120,0.10)";
        for (let wx = x + 10; wx < x + w - 10; wx += 22)
          for (let wy = y + 10; wy < y + h - 10; wy += 22)
            ctx.fillRect(wx, wy, 8, 8);
        ctx.fillStyle = "#141a26";
      }
    }
  }

  // streets
  ctx.fillStyle = "#232a38";
  for (const sx of vStreets) ctx.fillRect(sx - STREET_W / 2, 0, STREET_W, canvas.height);
  for (const sy of hStreets) ctx.fillRect(0, sy - STREET_W / 2, canvas.width, STREET_W);

  // lane dashes
  ctx.strokeStyle = "rgba(232,197,71,0.5)";
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 16]);
  for (const sx of vStreets) {
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke();
  }
  for (const sy of hStreets) {
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawStops(t) {
  for (const s of stops) {
    const pulse = 1 + 0.12 * Math.sin(t / 180);
    const r = 20 * pulse;
    // melt ring color: cyan -> red
    const frac = Math.max(0, s.melt / s.meltMax);
    const col = frac > 0.5 ? "#7fe7f2" : frac > 0.25 ? "#f2c14e" : "#ef476f";

    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = "rgba(127,231,242,0.25)";
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();

    // ice cube icon
    ctx.fillStyle = "#aed6f1";
    ctx.fillRect(s.x - 9, s.y - 9, 18, 18);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillRect(s.x - 9, s.y - 9, 18, 5);

    // melt bar
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(s.x - 26, s.y - 34, 52, 8);
    ctx.fillStyle = col;
    ctx.fillRect(s.x - 25, s.y - 33, 50 * frac, 6);

    // name + countdown
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(s.name, s.x, s.y + 34);
    ctx.fillStyle = col;
    ctx.fillText(Math.ceil(s.melt) + "s", s.x, s.y + 48);

    // the loiterer blocking the drop-off
    if (s.blocker) {
      const b = s.blocker;
      const alpha = b.leaving > 0 ? Math.max(0.25, b.leaving / 1.8) : 1;
      ctx.globalAlpha = alpha;
      // body
      ctx.fillStyle = "#7d6608";
      ctx.fillRect(b.x - 7, b.y - 6, 14, 22);
      // head
      ctx.fillStyle = "#e8b88a";
      ctx.beginPath(); ctx.arc(b.x, b.y - 12, 7, 0, Math.PI * 2); ctx.fill();
      // "!" bubble
      ctx.fillStyle = "#ef476f";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("!", b.x, b.y - 24);
      ctx.globalAlpha = 1;
      // hint when the truck is close
      const td = Math.hypot(truck.x + truck.w / 2 - s.x, truck.y + truck.h / 2 - s.y);
      if (td < 170 && b.leaving <= 0) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText("📯 HONK! (Space / 📯 button)", s.x, s.y - 44);
      }
    }
  }
}

function drawCars() {
  for (const c of cars) {
    ctx.fillStyle = c.color;
    const w = c.vertical ? c.w : c.w, h = c.vertical ? c.h : c.h;
    const x = c.x - w / 2, y = c.y - h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 7);
    ctx.fill();
    // windshield
    ctx.fillStyle = "rgba(180,220,255,0.8)";
    if (c.vertical) ctx.fillRect(x + 5, c.dir > 0 ? y + 6 : y + h - 14, w - 10, 8);
    else ctx.fillRect(c.dir > 0 ? x + 6 : x + w - 14, y + 5, 8, h - 10);
    // headlights
    ctx.fillStyle = "#fff9c4";
    if (c.vertical) {
      const hy = c.dir > 0 ? y + h - 3 : y;
      ctx.fillRect(x + 3, hy, 6, 3); ctx.fillRect(x + w - 9, hy, 6, 3);
    } else {
      const hx = c.dir > 0 ? x + w - 3 : x;
      ctx.fillRect(hx, y + 3, 3, 6); ctx.fillRect(hx, y + h - 9, 3, 6);
    }
  }
}

function drawPedestrians() {
  for (const p of pedestrians) {
    // little walker: body + head
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 6, p.y - 4, 12, 18);
    ctx.fillStyle = "#e8b88a";
    ctx.beginPath(); ctx.arc(p.x, p.y - 10, 6, 0, Math.PI * 2); ctx.fill();
  }
}

function drawTruck() {
  const { x, y, w, h } = truck;
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h + 4, w / 2, 8, 0, 0, Math.PI * 2); ctx.fill();

  // cargo box
  ctx.fillStyle = "#7fb3d5";
  ctx.beginPath(); ctx.roundRect(x, y, w * 0.62, h, 5); ctx.fill();
  ctx.fillStyle = "#0b2a3a";
  ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("ICE", x + w * 0.31, y + h / 2 + 4);

  // cab
  ctx.fillStyle = "#e8c547";
  ctx.beginPath(); ctx.roundRect(x + w * 0.62, y + 6, w * 0.38, h - 6, 5); ctx.fill();
  ctx.fillStyle = "#85c1e9";
  ctx.fillRect(x + w * 0.76, y + 11, w * 0.17, 10);
  // headlight beam
  const beam = ctx.createLinearGradient(x + w, 0, x + w + 70, 0);
  beam.addColorStop(0, "rgba(255,249,196,0.35)");
  beam.addColorStop(1, "rgba(255,249,196,0)");
  ctx.fillStyle = beam;
  ctx.fillRect(x + w, y + 2, 70, h);

  // wheels
  ctx.fillStyle = "#0a0a0a";
  for (const wx of [x + w * 0.16, x + w * 0.82]) {
    ctx.beginPath(); ctx.arc(wx, y + h, 9, 0, Math.PI * 2); ctx.fill();
  }

  // off-road dust when cutting through blocks
  if (!onStreet(x + w / 2, y + h / 2) && Math.random() < 0.4) {
    ctx.fillStyle = "rgba(160,140,110,0.35)";
    ctx.beginPath(); ctx.arc(x + w / 2 + (Math.random() - 0.5) * 20, y + h + 6, 5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHUD() {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, canvas.width, 44);

  const mm = String(Math.floor(timeLeft / 60)).padStart(1, "0");
  const ss = String(Math.floor(timeLeft % 60)).padStart(2, "0");
  ctx.textAlign = "left";
  ctx.fillStyle = timeLeft < 30 ? "#ef476f" : "#fff";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(`⏱ ${mm}:${ss}`, 14, 30);

  ctx.textAlign = "center";
  ctx.fillStyle = "#7fe7f2";
  ctx.fillText(`🧊 ${score}`, canvas.width / 2, 30);

  ctx.textAlign = "right";
  ctx.fillStyle = "#aed6f1";
  ctx.fillText(`📦 ${delivered}  ✖ ${missed}`, canvas.width - 14, 30);
}

function drawOverlays() {
  // honk button (bottom-right)
  const hb = honkButton();
  const anyBlocked = stops.some((s) => s.blocker);
  ctx.globalAlpha = anyBlocked ? 1 : 0.35;
  ctx.fillStyle = anyBlocked ? "#e8c547" : "#555";
  ctx.beginPath(); ctx.arc(hb.x, hb.y, hb.r, 0, Math.PI * 2); ctx.fill();
  ctx.font = "28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("📯", hb.x, hb.y + 10);
  ctx.globalAlpha = 1;

  // mandatory lunch overlay
  if (lunchTimer > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText("🍔 MANDATORY LUNCH", canvas.width / 2, canvas.height / 2 - 20);
    ctx.fillStyle = "#e8c547";
    ctx.font = "bold 60px sans-serif";
    ctx.fillText(Math.ceil(lunchTimer), canvas.width / 2, canvas.height / 2 + 50);
    ctx.fillStyle = "#aed6f1";
    ctx.font = "16px sans-serif";
    ctx.fillText("Union rules. The ice keeps melting.", canvas.width / 2, canvas.height / 2 + 90);
  }
}

function drawMenu() {
  drawCity();
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#7fe7f2";
  ctx.font = "bold 52px sans-serif";
  ctx.fillText("🧊 COLD RUN", canvas.width / 2, canvas.height / 2 - 90);
  ctx.fillStyle = "#fff";
  ctx.font = "20px sans-serif";
  ctx.fillText("Deliver ice before it melts.", canvas.width / 2, canvas.height / 2 - 40);
  ctx.fillStyle = "#aed6f1";
  ctx.font = "16px sans-serif";
  ctx.fillText("Streets are fast. Cutting through blocks is slow.", canvas.width / 2, canvas.height / 2 - 8);
  ctx.fillText("Traffic costs you 3 seconds. Melted ice loses the customer.", canvas.width / 2, canvas.height / 2 + 18);
  ctx.fillText("Pedestrians wander — don't clip them. Honk 📯 (Space) to shoo blockers.", canvas.width / 2, canvas.height / 2 + 44);
  ctx.fillText("Mandatory lunch at halftime. The ice keeps melting. 🍔", canvas.width / 2, canvas.height / 2 + 70);
  ctx.fillStyle = "#e8c547";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Tap or press Enter to start your shift", canvas.width / 2, canvas.height / 2 + 110);
  ctx.fillStyle = "#888";
  ctx.font = "14px sans-serif";
  ctx.fillText("Arrows / WASD or drag to drive", canvas.width / 2, canvas.height / 2 + 138);
}

function drawOver() {
  drawCity(); drawStops(0); drawCars(); drawTruck(); drawHUD();
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#7fe7f2";
  ctx.font = "bold 46px sans-serif";
  ctx.fillText("SHIFT OVER", canvas.width / 2, canvas.height / 2 - 60);
  ctx.fillStyle = "#fff";
  ctx.font = "22px sans-serif";
  ctx.fillText(`Score: ${score}`, canvas.width / 2, canvas.height / 2 - 12);
  ctx.fillStyle = "#aed6f1";
  ctx.font = "18px sans-serif";
  ctx.fillText(`📦 ${delivered} delivered   ✖ ${missed} melted`, canvas.width / 2, canvas.height / 2 + 22);
  ctx.fillStyle = "#e8c547";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("Tap or press Enter to run it back", canvas.width / 2, canvas.height / 2 + 62);
}

/* ---------------- main loop ---------------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === "play") {
    update(dt);
    drawCity(); drawStops(now); drawCars(); drawPedestrians(); drawTruck(); drawHUD(); drawOverlays();
  } else if (state === "menu") {
    drawMenu();
  } else {
    drawOver();
  }
  requestAnimationFrame(loop);
}

resize();
resetGame();
state = "menu";
requestAnimationFrame(loop);
