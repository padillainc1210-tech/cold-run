/* ============================================================
   COLD RUN — Ice Delivery (v3)
   Bigger city, scrolling camera, traffic lights & stop signs.
   Controls: Arrow keys / WASD, or press-and-drag on touch/mouse.
   Space (or 📯 button) = honk.
   ============================================================ */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
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

/* ---------------- world & city grid ---------------- */
const WORLD_W = 2600, WORLD_H = 1800;
const BLOCK = 190;          // distance between street centers
const STREET_W = 52;
const SHIFT_LEN = 180;      // 3 minute shift

let vStreets = [], hStreets = [];
let intersections = [];     // {x, y, i, j, light, stop}

const LIGHT_PERIOD = 12, GREEN_T = 5, YELLOW_T = 1;

function buildCity() {
  vStreets = []; hStreets = []; intersections = [];
  const ox = (WORLD_W % BLOCK) / 2 + BLOCK / 2;
  const oy = (WORLD_H % BLOCK) / 2 + BLOCK / 2;
  for (let x = ox; x < WORLD_W; x += BLOCK) vStreets.push(x);
  for (let y = oy; y < WORLD_H; y += BLOCK) hStreets.push(y);
  for (let i = 0; i < vStreets.length; i++) {
    for (let j = 0; j < hStreets.length; j++) {
      const m = (i + j) % 4;
      intersections.push({
        x: vStreets[i], y: hStreets[j], i, j,
        light: m === 0 ? { offset: (i * 3 + j * 7) % LIGHT_PERIOD } : null,
        stop: m === 2,
      });
    }
  }
}

// light phase at game-time t: 'H' | 'HY' | 'V' | 'VY'
function lightPhase(light, t) {
  const l = (t + light.offset) % LIGHT_PERIOD;
  if (l < GREEN_T) return "H";
  if (l < GREEN_T + YELLOW_T) return "HY";
  if (l < GREEN_T + YELLOW_T + GREEN_T) return "V";
  return "VY";
}
function axisGreen(light, t, vertical) {
  const p = lightPhase(light, t);
  return vertical ? p === "V" : p === "H";
}

function onStreet(x, y) {
  for (const sx of vStreets) if (Math.abs(x - sx) < STREET_W / 2 + 14) return true;
  for (const sy of hStreets) if (Math.abs(y - sy) < STREET_W / 2 + 14) return true;
  return false;
}

/* ---------------- game state ---------------- */
let state = "menu";
let timeLeft, score, delivered, missed, tickets;
let stops = [], cars = [], pedestrians = [];
let elapsed = 0;
let lunchDone, lunchTimer;
let hitCooldown = 0, ticketCooldown = 0;
let flash = null; // {text, timer}
const cam = { x: 0, y: 0 };
const truck = { x: 0, y: 0, w: 64, h: 34, speed: 5.4, mvx: 0, mvy: 0 };

function resetGame() {
  timeLeft = SHIFT_LEN;
  score = 0; delivered = 0; missed = 0; tickets = 0;
  stops = []; cars = []; pedestrians = [];
  elapsed = 0;
  lunchDone = false; lunchTimer = 0;
  hitCooldown = 0; ticketCooldown = 0; flash = null;
  truck.x = vStreets[0] - truck.w / 2;
  truck.y = hStreets[0] - truck.h / 2;
  truck.mvx = 0; truck.mvy = 0;
  cam.x = 0; cam.y = 0;
  for (let i = 0; i < 3; i++) spawnStop();
  for (let i = 0; i < 9; i++) spawnCar();
  for (let i = 0; i < 4; i++) spawnPedestrian();
}

/* ---------------- deliveries ---------------- */
const CUSTOMERS = ["Joe's Deli", "Bar Neon", "Pizza Corner", "Cafe Luna",
  "The Taproom", "Sushi Bay", "Hotel Grand", "Burger Joint"];

function spawnStop() {
  const sx = vStreets[(Math.random() * vStreets.length) | 0];
  const sy = hStreets[(Math.random() * hStreets.length) | 0];
  const meltMax = 55 - Math.min(22, elapsed / 12);
  const stop = {
    x: Math.max(40, Math.min(WORLD_W - 40, sx + (Math.random() - 0.5) * 30)),
    y: Math.max(40, Math.min(WORLD_H - 40, sy + (Math.random() - 0.5) * 30)),
    melt: meltMax, meltMax,
    name: CUSTOMERS[(Math.random() * CUSTOMERS.length) | 0],
    blocker: null,
  };
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
  const cruise = (1.7 + Math.random() * 2.0) * (1 + elapsed / 300);
  const base = { dir: Math.random() < 0.5 ? 1 : -1, cruise, speed: cruise,
    color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
    waitT: 0, stopKey: "" };
  if (vertical) {
    Object.assign(base, { vertical: true,
      x: vStreets[(Math.random() * vStreets.length) | 0] + (Math.random() < 0.5 ? -12 : 12),
      y: Math.random() * WORLD_H, w: 26, h: 44 });
  } else {
    Object.assign(base, { vertical: false,
      x: Math.random() * WORLD_W,
      y: hStreets[(Math.random() * hStreets.length) | 0] + (Math.random() < 0.5 ? -12 : 12),
      w: 44, h: 26 });
  }
  cars.push(base);
}

// nearest intersection ahead of the car on its street (within lookahead px)
function nextIntersection(car, lookahead) {
  let best = null, bestD = lookahead;
  for (const n of intersections) {
    if (car.vertical) {
      if (Math.abs(n.x - car.x) > STREET_W) continue;
      const d = (n.y - car.y) * car.dir;
      if (d > -10 && d < bestD) { best = n; bestD = d; }
    } else {
      if (Math.abs(n.y - car.y) > STREET_W) continue;
      const d = (n.x - car.x) * car.dir;
      if (d > -10 && d < bestD) { best = n; bestD = d; }
    }
  }
  return best ? { n: best, d: bestD } : null;
}

function updateCar(car, dt) {
  let target = car.cruise;
  const ahead = nextIntersection(car, 130);

  if (ahead) {
    const { n, d } = ahead;
    const stopLine = d - (STREET_W / 2 + 26); // where the nose should halt
    if (n.light) {
      const green = axisGreen(n.light, elapsed, car.vertical);
      const phase = lightPhase(n.light, elapsed);
      const yellow = phase === "HY" || phase === "VY";
      // stop on red; stop on yellow unless too close to halt safely
      if ((!green && !(yellow && stopLine < 24)) && stopLine < 95 && stopLine > -20) {
        if (stopLine <= 2) {
          target = 0;
          // pin at the stop line
          if (car.vertical) car.y = n.y - car.dir * (STREET_W / 2 + 26);
          else car.x = n.x - car.dir * (STREET_W / 2 + 26);
        } else {
          target = Math.min(target, car.cruise * (stopLine / 95));
        }
      }
    } else if (n.stop) {
      const key = n.i + "," + n.j;
      if (car.stopKey !== key && stopLine < 55 && stopLine > -20) {
        if (stopLine <= 6) {
          car.waitT += dt;
          target = 0;
          if (car.vertical) car.y = n.y - car.dir * (STREET_W / 2 + 26);
          else car.x = n.x - car.dir * (STREET_W / 2 + 26);
          if (car.waitT > 0.9) { car.stopKey = key; car.waitT = 0; }
        } else {
          target = Math.min(target, car.cruise * (stopLine / 55));
          car.waitT = 0;
        }
      }
    }
  }

  // ease toward target speed
  const rate = target < car.speed ? 6 : 2.5;
  car.speed += Math.max(-rate * dt * 60 * 0.12, Math.min(rate * dt * 60 * 0.12, target - car.speed));
  if (Math.abs(target - car.speed) < 0.05) car.speed = target;

  if (car.vertical) {
    car.y += car.dir * car.speed * dt * 60;
    if (car.y > WORLD_H + 60) { car.y = -60; car.stopKey = ""; }
    if (car.y < -60) { car.y = WORLD_H + 60; car.stopKey = ""; }
  } else {
    car.x += car.dir * car.speed * dt * 60;
    if (car.x > WORLD_W + 60) { car.x = -60; car.stopKey = ""; }
    if (car.x < -60) { car.x = WORLD_W + 60; car.stopKey = ""; }
  }
}

/* ---------------- pedestrians ---------------- */
const PED_COLORS = ["#5d6d7e", "#7d6608", "#6e2c00", "#4a235a"];
function spawnPedestrian() {
  const vertical = Math.random() < 0.5;
  const side = Math.random() < 0.5 ? 1 : -1;
  const off = STREET_W / 2 + 12;
  if (vertical) {
    pedestrians.push({
      x: vStreets[(Math.random() * vStreets.length) | 0] + side * off,
      y: Math.random() * WORLD_H,
      vx: 0, vy: side * (0.7 + Math.random() * 0.6),
      color: PED_COLORS[(Math.random() * PED_COLORS.length) | 0],
    });
  } else {
    pedestrians.push({
      x: Math.random() * WORLD_W,
      y: hStreets[(Math.random() * hStreets.length) | 0] + side * off,
      vx: side * (0.7 + Math.random() * 0.6), vy: 0,
      color: PED_COLORS[(Math.random() * PED_COLORS.length) | 0],
    });
  }
}

/* ---------------- honking ---------------- */
function honk() {
  const tx = truck.x + truck.w / 2, ty = truck.y + truck.h / 2;
  for (const s of stops) {
    if (s.blocker && s.blocker.leaving <= 0 &&
        Math.hypot(tx - s.x, ty - s.y) < 170) {
      s.blocker.leaving = 1.8;
    }
  }
  beep(370, 0.12, "square", 0.15);
  setTimeout(() => beep(294, 0.18, "square", 0.15), 110);
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
  const hb = honkButton();
  if (Math.hypot(e.clientX - hb.x, e.clientY - hb.y) < hb.r + 8) { honk(); return; }
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
function update(dt) {
  elapsed += dt;
  timeLeft -= dt;
  if (timeLeft <= 0) { timeLeft = 0; state = "over"; beep(220, 0.4, "sawtooth"); return; }

  if (!lunchDone && elapsed >= SHIFT_LEN / 2) {
    lunchDone = true; lunchTimer = 8;
    beep(440, 0.15, "square"); setTimeout(() => beep(330, 0.25, "square"), 170);
  }
  if (lunchTimer > 0) lunchTimer -= dt;

  if (stops.length < 3 + Math.floor(elapsed / 45) && stops.length < 6) spawnStop();
  if (cars.length < 9 + Math.floor(elapsed / 40) && Math.random() < 0.02) spawnCar();
  if (pedestrians.length < 7 && Math.random() < 0.015) spawnPedestrian();

  // --- truck movement (frozen during mandatory lunch) ---
  truck.mvx = 0; truck.mvy = 0;
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
      truck.mvx = (vx / len) * spd; truck.mvy = (vy / len) * spd;
      truck.x += truck.mvx; truck.y += truck.mvy;
    } else if (dragging) {
      // drag target is screen coords -> convert to world
      const wx = dragX + cam.x, wy = dragY + cam.y;
      const dx = wx - (truck.x + truck.w / 2);
      const dy = wy - (truck.y + truck.h / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > 8) {
        const step = Math.min(spd, dist / 6);
        truck.mvx = (dx / dist) * step; truck.mvy = (dy / dist) * step;
        truck.x += truck.mvx; truck.y += truck.mvy;
      }
    }
    truck.x = Math.max(0, Math.min(WORLD_W - truck.w, truck.x));
    truck.y = Math.max(0, Math.min(WORLD_H - truck.h, truck.y));
  }

  // --- camera follows the truck ---
  const txc = truck.x + truck.w / 2, tyc = truck.y + truck.h / 2;
  cam.x = Math.max(0, Math.min(WORLD_W - canvas.width, txc - canvas.width / 2));
  cam.y = Math.max(0, Math.min(WORLD_H - canvas.height, tyc - canvas.height / 2));

  // --- traffic ---
  for (const c of cars) updateCar(c, dt);

  // --- pedestrians ---
  for (const p of pedestrians) {
    p.x += p.vx * dt * 60; p.y += p.vy * dt * 60;
    if (p.x < -30) p.x = WORLD_W + 30;
    if (p.x > WORLD_W + 30) p.x = -30;
    if (p.y < -30) p.y = WORLD_H + 30;
    if (p.y > WORLD_H + 30) p.y = -30;
  }

  // --- collisions ---
  hitCooldown = Math.max(0, hitCooldown - dt);
  ticketCooldown = Math.max(0, ticketCooldown - dt);
  const tx = truck.x + truck.w / 2, ty = truck.y + truck.h / 2;
  for (const c of cars) {
    if (Math.abs(tx - c.x) < (truck.w + c.w) / 2 - 8 &&
        Math.abs(ty - c.y) < (truck.h + c.h) / 2 - 8) {
      if (hitCooldown <= 0) {
        hitCooldown = 1.2;
        timeLeft = Math.max(0, timeLeft - 3);
        score = Math.max(0, score - 15);
        beep(140, 0.25, "sawtooth", 0.2);
        truck.x -= (c.x - tx) * 0.4;
        truck.y -= (c.y - ty) * 0.4;
      }
    }
  }
  for (const p of pedestrians) {
    if (Math.abs(tx - p.x) < 30 && Math.abs(ty - p.y) < 30) {
      if (hitCooldown <= 0) {
        hitCooldown = 1.2;
        timeLeft = Math.max(0, timeLeft - 2);
        beep(200, 0.2, "sawtooth", 0.18);
        p.x += (p.x - tx) * 0.8;
        p.y += (p.y - ty) * 0.8;
      }
    }
  }

  // --- red-light tickets for the player ---
  const moving = Math.hypot(truck.mvx, truck.mvy) > 0.5;
  if (moving && ticketCooldown <= 0) {
    const horiz = Math.abs(truck.mvx) >= Math.abs(truck.mvy);
    for (const n of intersections) {
      if (!n.light) continue;
      if (Math.hypot(tx - n.x, ty - n.y) > 52) continue;
      const green = axisGreen(n.light, elapsed, !horiz);
      if (!green) {
        ticketCooldown = 3;
        tickets++;
        timeLeft = Math.max(0, timeLeft - 3);
        flash = { text: "🚨 RED LIGHT! -3s", timer: 1.6 };
        beep(180, 0.3, "sawtooth", 0.2);
        break;
      }
    }
  }
  if (flash) { flash.timer -= dt; if (flash.timer <= 0) flash = null; }

  // --- melting ice + deliveries ---
  for (let i = stops.length - 1; i >= 0; i--) {
    const s = stops[i];
    s.melt -= dt;
    if (s.blocker) {
      const b = s.blocker;
      if (b.leaving > 0) {
        b.leaving -= dt;
        b.x += b.dx * 60 * dt; b.y += b.dy * 60 * dt;
        if (b.leaving <= 0) s.blocker = null;
      } else {
        b.wait += dt;
        b.x += Math.sin(elapsed * 3 + b.wait) * 6 * dt;
        if (b.wait > 7) b.leaving = 1.8;
      }
    }
    const d = Math.hypot(tx - s.x, ty - s.y);
    if (d < 46 && !s.blocker) {
      const tip = Math.round((s.melt / s.meltMax) * 100);
      score += 100 + tip;
      delivered++;
      beep(660, 0.1, "square"); setTimeout(() => beep(880, 0.14, "square"), 90);
      stops.splice(i, 1);
      spawnStop();
    } else if (s.melt <= 0) {
      missed++;
      score = Math.max(0, score - 25);
      beep(180, 0.3, "sawtooth", 0.15);
      stops.splice(i, 1);
      spawnStop();
    }
  }
}

/* ---------------- draw (world space) ---------------- */
function drawCity(t) {
  ctx.fillStyle = "#0b0e14";
  ctx.fillRect(cam.x, cam.y, canvas.width, canvas.height);

  // blocks
  for (let i = 0; i < vStreets.length - 1; i++) {
    for (let j = 0; j < hStreets.length - 1; j++) {
      const x = vStreets[i] + STREET_W / 2 + 8;
      const y = hStreets[j] + STREET_W / 2 + 8;
      const w = vStreets[i + 1] - vStreets[i] - STREET_W - 16;
      const h = hStreets[j + 1] - hStreets[j] - STREET_W - 16;
      if (w > 20 && h > 20) {
        // skip drawing blocks totally off-screen
        if (x > cam.x + canvas.width || x + w < cam.x ||
            y > cam.y + canvas.height || y + h < cam.y) continue;
        ctx.fillStyle = "#141a26";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "rgba(255,220,120,0.10)";
        for (let wx = x + 10; wx < x + w - 10; wx += 22)
          for (let wy = y + 10; wy < y + h - 10; wy += 22)
            ctx.fillRect(wx, wy, 8, 8);
      }
    }
  }

  // streets
  ctx.fillStyle = "#232a38";
  for (const sx of vStreets) {
    if (sx < cam.x - STREET_W || sx > cam.x + canvas.width + STREET_W) continue;
    ctx.fillRect(sx - STREET_W / 2, cam.y, STREET_W, canvas.height);
  }
  for (const sy of hStreets) {
    if (sy < cam.y - STREET_W || sy > cam.y + canvas.height + STREET_W) continue;
    ctx.fillRect(cam.x, sy - STREET_W / 2, canvas.width, STREET_W);
  }

  // lane dashes
  ctx.strokeStyle = "rgba(232,197,71,0.5)";
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 16]);
  for (const sx of vStreets) {
    if (sx < cam.x - STREET_W || sx > cam.x + canvas.width + STREET_W) continue;
    ctx.beginPath(); ctx.moveTo(sx, cam.y); ctx.lineTo(sx, cam.y + canvas.height); ctx.stroke();
  }
  for (const sy of hStreets) {
    if (sy < cam.y - STREET_W || sy > cam.y + canvas.height + STREET_W) continue;
    ctx.beginPath(); ctx.moveTo(cam.x, sy); ctx.lineTo(cam.x + canvas.width, sy); ctx.stroke();
  }
  ctx.setLineDash([]);

  // stop signs + traffic lights
  for (const n of intersections) {
    if (n.x < cam.x - 60 || n.x > cam.x + canvas.width + 60 ||
        n.y < cam.y - 60 || n.y > cam.y + canvas.height + 60) continue;
    if (n.stop) {
      // stop sign octagon
      ctx.fillStyle = "#c0392b";
      ctx.beginPath();
      const r = 11, ox = n.x + STREET_W / 2 + 14, oy = n.y - STREET_W / 2 - 14;
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + k * Math.PI / 4;
        const px = ox + r * Math.cos(a), py = oy + r * Math.sin(a);
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("STOP", ox, oy + 3);
    }
    if (n.light) {
      const phase = lightPhase(n.light, elapsed);
      const hCol = phase === "H" ? "#2ecc71" : phase === "HY" ? "#f1c40f" : "#e74c3c";
      const vCol = phase === "V" ? "#2ecc71" : phase === "VY" ? "#f1c40f" : "#e74c3c";
      const px = n.x - STREET_W / 2 - 12, py = n.y - STREET_W / 2 - 12;
      // pole
      ctx.fillStyle = "#555";
      ctx.fillRect(px - 2, py - 2, 4, 30);
      // signal heads: top = horizontal axis, bottom = vertical axis
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.roundRect(px - 9, py - 4, 18, 34, 5); ctx.fill();
      ctx.fillStyle = hCol;
      ctx.beginPath(); ctx.arc(px, py + 4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = vCol;
      ctx.beginPath(); ctx.arc(px, py + 22, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawStops(t) {
  for (const s of stops) {
    if (s.x < cam.x - 80 || s.x > cam.x + canvas.width + 80 ||
        s.y < cam.y - 80 || s.y > cam.y + canvas.height + 80) continue;
    const pulse = 1 + 0.12 * Math.sin(t / 180);
    const r = 20 * pulse;
    const frac = Math.max(0, s.melt / s.meltMax);
    const col = frac > 0.5 ? "#7fe7f2" : frac > 0.25 ? "#f2c14e" : "#ef476f";

    ctx.strokeStyle = col; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(127,231,242,0.25)";
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#aed6f1";
    ctx.fillRect(s.x - 9, s.y - 9, 18, 18);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillRect(s.x - 9, s.y - 9, 18, 5);

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(s.x - 26, s.y - 34, 52, 8);
    ctx.fillStyle = col;
    ctx.fillRect(s.x - 25, s.y - 33, 50 * frac, 6);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(s.name, s.x, s.y + 34);
    ctx.fillStyle = col;
    ctx.fillText(Math.ceil(s.melt) + "s", s.x, s.y + 48);

    if (s.blocker) {
      const b = s.blocker;
      const alpha = b.leaving > 0 ? Math.max(0.25, b.leaving / 1.8) : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#7d6608";
      ctx.fillRect(b.x - 7, b.y - 6, 14, 22);
      ctx.fillStyle = "#e8b88a";
      ctx.beginPath(); ctx.arc(b.x, b.y - 12, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ef476f";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("!", b.x, b.y - 24);
      ctx.globalAlpha = 1;
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
    if (c.x < cam.x - 80 || c.x > cam.x + canvas.width + 80 ||
        c.y < cam.y - 80 || c.y > cam.y + canvas.height + 80) continue;
    ctx.fillStyle = c.color;
    const x = c.x - c.w / 2, y = c.y - c.h / 2;
    ctx.beginPath(); ctx.roundRect(x, y, c.w, c.h, 7); ctx.fill();
    ctx.fillStyle = "rgba(180,220,255,0.8)";
    if (c.vertical) ctx.fillRect(x + 5, c.dir > 0 ? y + 6 : y + c.h - 14, c.w - 10, 8);
    else ctx.fillRect(c.dir > 0 ? x + 6 : x + c.w - 14, y + 5, 8, c.h - 10);
    ctx.fillStyle = "#fff9c4";
    if (c.vertical) {
      const hy = c.dir > 0 ? y + c.h - 3 : y;
      ctx.fillRect(x + 3, hy, 6, 3); ctx.fillRect(x + c.w - 9, hy, 6, 3);
    } else {
      const hx = c.dir > 0 ? x + c.w - 3 : x;
      ctx.fillRect(hx, y + 3, 3, 6); ctx.fillRect(hx, y + c.h - 9, 3, 6);
    }
    // brake lights when stopped
    if (c.speed < 0.2) {
      ctx.fillStyle = "#ff2d2d";
      if (c.vertical) {
        const by = c.dir > 0 ? y : y + c.h - 4;
        ctx.fillRect(x + 3, by, 6, 4); ctx.fillRect(x + c.w - 9, by, 6, 4);
      } else {
        const bx = c.dir > 0 ? x : x + c.w - 4;
        ctx.fillRect(bx, y + 3, 4, 6); ctx.fillRect(bx, y + c.h - 9, 4, 6);
      }
    }
  }
}

function drawPedestrians() {
  for (const p of pedestrians) {
    if (p.x < cam.x - 40 || p.x > cam.x + canvas.width + 40 ||
        p.y < cam.y - 40 || p.y > cam.y + canvas.height + 40) continue;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 6, p.y - 4, 12, 18);
    ctx.fillStyle = "#e8b88a";
    ctx.beginPath(); ctx.arc(p.x, p.y - 10, 6, 0, Math.PI * 2); ctx.fill();
  }
}

function drawTruck() {
  const { x, y, w, h } = truck;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h + 4, w / 2, 8, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#7fb3d5";
  ctx.beginPath(); ctx.roundRect(x, y, w * 0.62, h, 5); ctx.fill();
  ctx.fillStyle = "#0b2a3a";
  ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("ICE", x + w * 0.31, y + h / 2 + 4);

  ctx.fillStyle = "#e8c547";
  ctx.beginPath(); ctx.roundRect(x + w * 0.62, y + 6, w * 0.38, h - 6, 5); ctx.fill();
  ctx.fillStyle = "#85c1e9";
  ctx.fillRect(x + w * 0.76, y + 11, w * 0.17, 10);
  const beam = ctx.createLinearGradient(x + w, 0, x + w + 70, 0);
  beam.addColorStop(0, "rgba(255,249,196,0.35)");
  beam.addColorStop(1, "rgba(255,249,196,0)");
  ctx.fillStyle = beam;
  ctx.fillRect(x + w, y + 2, 70, h);

  ctx.fillStyle = "#0a0a0a";
  for (const wx of [x + w * 0.16, x + w * 0.82]) {
    ctx.beginPath(); ctx.arc(wx, y + h, 9, 0, Math.PI * 2); ctx.fill();
  }
  if (!onStreet(x + w / 2, y + h / 2) && Math.random() < 0.4) {
    ctx.fillStyle = "rgba(160,140,110,0.35)";
    ctx.beginPath(); ctx.arc(x + w / 2 + (Math.random() - 0.5) * 20, y + h + 6, 5, 0, Math.PI * 2); ctx.fill();
  }
}

/* ---------------- draw (screen space) ---------------- */
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

  if (flash) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ef476f";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(flash.text, canvas.width / 2, 84);
  }
}

function drawMinimap() {
  const mw = 150, mh = 150 * (WORLD_H / WORLD_W);
  const mx = canvas.width - mw - 12, my = 54;
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath(); ctx.roundRect(mx - 4, my - 4, mw + 8, mh + 8, 6); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  for (const vx of vStreets) {
    ctx.beginPath(); ctx.moveTo(mx + vx * sx, my); ctx.lineTo(mx + vx * sx, my + mh); ctx.stroke();
  }
  for (const hy of hStreets) {
    ctx.beginPath(); ctx.moveTo(mx, my + hy * sy); ctx.lineTo(mx + mw, my + hy * sy); ctx.stroke();
  }
  for (const s of stops) {
    ctx.fillStyle = "#7fe7f2";
    ctx.beginPath(); ctx.arc(mx + s.x * sx, my + s.y * sy, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#e8c547";
  ctx.beginPath();
  ctx.arc(mx + (truck.x + truck.w / 2) * sx, my + (truck.y + truck.h / 2) * sy, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawStopArrow() {
  if (!stops.length) return;
  const tx = truck.x + truck.w / 2, ty = truck.y + truck.h / 2;
  let best = stops[0], bd = Infinity;
  for (const s of stops) {
    const d = Math.hypot(s.x - tx, s.y - ty);
    if (d < bd) { bd = d; best = s; }
  }
  const sx = best.x - cam.x, sy = best.y - cam.y;
  if (sx > 40 && sx < canvas.width - 40 && sy > 80 && sy < canvas.height - 40) return; // on screen
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const ang = Math.atan2(sy - cy, sx - cx);
  const rx = canvas.width / 2 - 60, ry = canvas.height / 2 - 60;
  const ax = cx + Math.cos(ang) * rx, ay = cy + Math.sin(ang) * ry;
  ctx.save();
  ctx.translate(ax, ay); ctx.rotate(ang);
  ctx.fillStyle = "rgba(127,231,242,0.9)";
  ctx.beginPath();
  ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-3, 0); ctx.lineTo(-8, 9);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawOverlays() {
  const hb = honkButton();
  const anyBlocked = stops.some((s) => s.blocker);
  ctx.globalAlpha = anyBlocked ? 1 : 0.35;
  ctx.fillStyle = anyBlocked ? "#e8c547" : "#555";
  ctx.beginPath(); ctx.arc(hb.x, hb.y, hb.r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = "28px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("📯", hb.x, hb.y + 10);

  if (lunchTimer > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
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
  ctx.fillStyle = "#0b0e14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#7fe7f2";
  ctx.font = "bold 52px sans-serif";
  ctx.fillText("🧊 COLD RUN", canvas.width / 2, canvas.height / 2 - 110);
  ctx.fillStyle = "#fff";
  ctx.font = "20px sans-serif";
  ctx.fillText("Deliver ice before it melts.", canvas.width / 2, canvas.height / 2 - 60);
  ctx.fillStyle = "#aed6f1";
  ctx.font = "16px sans-serif";
  ctx.fillText("Bigger city. Streets are fast, cutting through blocks is slow.", canvas.width / 2, canvas.height / 2 - 28);
  ctx.fillText("Traffic obeys lights & stop signs — running a red costs you 3s. 🚦", canvas.width / 2, canvas.height / 2 - 2);
  ctx.fillText("Green means cross-traffic is stopped: that's your window to move.", canvas.width / 2, canvas.height / 2 + 24);
  ctx.fillText("Pedestrians wander. Honk 📯 (Space) to shoo blockers.", canvas.width / 2, canvas.height / 2 + 50);
  ctx.fillText("Mandatory lunch at halftime. The ice keeps melting. 🍔", canvas.width / 2, canvas.height / 2 + 76);
  ctx.fillStyle = "#e8c547";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("Tap or press Enter to start your shift", canvas.width / 2, canvas.height / 2 + 116);
  ctx.fillStyle = "#888";
  ctx.font = "14px sans-serif";
  ctx.fillText("Arrows / WASD or drag to drive", canvas.width / 2, canvas.height / 2 + 144);
}

function drawOver() {
  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  drawCity(elapsed); drawStops(elapsed); drawCars(); drawPedestrians(); drawTruck();
  ctx.restore();
  drawHUD(); drawMinimap();
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
  ctx.fillText(`📦 ${delivered} delivered   ✖ ${missed} melted   🚨 ${tickets} tickets`, canvas.width / 2, canvas.height / 2 + 22);
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
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    drawCity(now); drawStops(now); drawCars(); drawPedestrians(); drawTruck();
    ctx.restore();
    drawHUD(); drawMinimap(); drawStopArrow(); drawOverlays();
  } else if (state === "menu") {
    drawMenu();
  } else {
    drawOver();
  }
  requestAnimationFrame(loop);
}

resize();
buildCity();
resetGame();
state = "menu";
requestAnimationFrame(loop);
