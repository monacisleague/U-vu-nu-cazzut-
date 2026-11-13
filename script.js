const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 480, H = 270;
canvas.width = W;
canvas.height = H;
ctx.imageSmoothingEnabled = false;

// ---------- SCENA (ring + pubblico animato) ----------
const sceneImg = new Image();
sceneImg.src = 'scene.svg';

const GROUND = 200;
const LEFT = 30, RIGHT = W - 30;

const DIFF = [
  { name: 'FACILE',    reaction: 40, attack: 0.25, grab: 0.05, speed: 1.0,  dmg: 0.7 },
  { name: 'MEDIO',     reaction: 22, attack: 0.45, grab: 0.10, speed: 1.25, dmg: 1.0 },
  { name: 'DIFFICILE', reaction: 10, attack: 0.70, grab: 0.20, speed: 1.5,  dmg: 1.3 },
];

const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyZ: 'punch', KeyX: 'kick', KeyC: 'grab', Enter: 'start', KeyR: 'start',
};

let state = 'menu';   // 'menu' | 'fight' | 'over'
let sel = 1;
let diff = DIFF[1];
let P = null, C = null;
let frame = 0;
let intro = 0;
let koTimer = 0, koWinner = null;
let endText = '';
let sparks = [];
const held = {};
let queue = [];

function makeFighter(x, color, facing, isCPU) {
  return {
    x, vx: 0, y: GROUND, color, facing, isCPU,
    hp: 100, state: 'idle', timer: 0, total: 1, hitDone: false,
    downT: 0, holding: null, heldBy: null, grabT: 0, escape: 0,
    pinT: 0, pinner: null, kick: 0, stun: 0, cd: 60, ko: false,
  };
}

function startFight() {
  diff = DIFF[sel];
  P = makeFighter(120, '#2563eb', 1, false);
  C = makeFighter(360, '#dc2626', -1, true);
  sparks = [];
  koTimer = 0; koWinner = null; endText = '';
  intro = 90;
  queue = [];
  state = 'fight';
}

function endMatch(winner, text) {
  if (state !== 'fight') return;
  endText = (winner === P ? 'HAI VINTO! ' : 'HAI PERSO! ') + text;
  state = 'over';
}

function onAction(a) {
  if (state === 'menu') {
    if (a === 'left' || a === 'up') sel = (sel + DIFF.length - 1) % DIFF.length;
    else if (a === 'right' || a === 'down') sel = (sel + 1) % DIFF.length;
    else if (a === 'start' || a === 'punch') startFight();
  } else if (state === 'over') {
    if (a === 'start' || a === 'punch' || a === 'grab') state = 'menu';
  } else if (state === 'fight') {
    queue.push(a);
  }
}

// ---------- AZIONI ----------

function startAttack(f, type) {
  f.state = type;
  f.timer = type === 'punch' ? 22 : 28;
  f.total = f.timer;
  f.hitDone = false;
  f.vx = 0;
}

function startPin(f, o) {
  f.state = 'pinning';
  f.holding = o;
  f.vx = 0;
  o.state = 'pinned';
  o.pinT = 0;
  o.kick = 0;
  o.pinner = f;
  o.vx = 0;
}

function cancelHolds(o) {
  if (o.state === 'grabbing' && o.holding) {
    o.holding.state = 'idle';
    o.holding.heldBy = null;
    o.holding = null;
  }
  if (o.state === 'pinning' && o.holding) {
    o.holding.state = 'down';
    o.holding.downT = 60;
    o.holding.pinner = null;
    o.holding = null;
  }
}

function ko(o, winner) {
  o.state = 'down';
  o.downT = 9999;
  o.ko = true;
  koTimer = 80;
  koWinner = winner;
}

function throwOpp(f, dir) {
  const o = f.holding;
  f.holding = null;
  f.state = 'idle';
  f.stun = 10;
  if (!o) return;
  o.heldBy = null;
  o.hp = Math.max(0, o.hp - (f.isCPU ? 5 * diff.dmg : 5));
  sparks.push({ x: o.x, y: GROUND - 20, t: 12 });
  if (o.hp <= 0) { ko(o, f); return; }
  o.state = 'down';
  o.downT = 100;
  o.vx = dir * 3.2;
}

function resolveGrab(f, o) {
  const dist = Math.abs(f.x - o.x);
  const blocked = ['down', 'pinned', 'held', 'grabbing', 'pinning'].includes(o.state);
  if (dist < 50 && !blocked) {
    f.state = 'grabbing';
    f.holding = o;
    f.grabT = 150;
    o.state = 'held';
    o.heldBy = f;
    o.escape = 0;
    o.vx = 0;
  } else {
    f.state = 'idle';
    f.stun = 12;
  }
}

function escapeRelease(f) {
  const h = f.heldBy;
  f.state = 'idle';
  f.heldBy = null;
  f.stun = 20;
  if (h) {
    h.state = 'idle';
    h.holding = null;
    h.stun = 40;
  }
}

function kickOut(o) {
  const f = o.pinner;
  o.state = 'down';
  o.downT = 70;
  o.pinner = null;
  o.kick = 0;
  if (f) {
    f.state = 'idle';
    f.holding = null;
    f.stun = 25;
  }
}

function checkHit(f, o) {
  const range = f.state === 'punch' ? 34 : 44;
  const dx = (o.x - f.x) * f.facing;
  if (dx < 0 || dx > range) return;
  if (['down', 'pinned', 'held'].includes(o.state)) return;

  f.hitDone = true;
  let dmg = f.state === 'punch' ? 6 : 9;
  if (f.isCPU) dmg *= diff.dmg;

  cancelHolds(o);
  o.hp = Math.max(0, o.hp - dmg);
  sparks.push({ x: o.x, y: GROUND - 30, t: 12 });

  if (o.hp <= 0) {
    ko(o, f);
    o.vx = f.facing * 2;
    return;
  }
  o.state = 'hurt';
  o.timer = 14;
  o.vx = f.facing * 2.2;
}

function act(f, a, o, isDown) {
  if (state !== 'fight' || f.stun > 0) return;
  const dist = Math.abs(f.x - o.x);
  const atk = a === 'punch' || a === 'kick' || a === 'grab';

  switch (f.state) {
    case 'held':
      if (atk) f.escape++;
      return;
    case 'pinned':
      if (atk) f.kick += 12;
      return;
    case 'grabbing':
      if (a === 'left' || a === 'right') throwOpp(f, a === 'left' ? -1 : 1);
      return;
    case 'idle':
    case 'walk':
      break;
    default:
      return;
  }

  if (a === 'punch') {
    if (isDown && o.state === 'down' && dist < 44) startPin(f, o);
    else startAttack(f, 'punch');
  } else if (a === 'kick') {
    startAttack(f, 'kick');
  } else if (a === 'grab') {
    if (o.state === 'down' && dist < 44) startPin(f, o);
    else if (dist < 50) { f.state = 'grab'; f.timer = 14; f.vx = 0; }
  }
}

// ---------- CPU ----------

function cpuThink(c, p) {
  c.cd--;

  if (c.state === 'held' || c.state === 'pinned') {
    if (c.cd <= 0) {
      c.cd = 6 + diff.reaction * 0.4;
      act(c, Math.random() < 0.5 ? 'punch' : 'kick', p, false);
    }
    return;
  }

  if (c.state === 'grabbing') {
    if (c.cd <= 0) {
      c.cd = 20 + Math.random() * 30;
      act(c, Math.random() < 0.5 ? 'left' : 'right', p, false);
    }
    return;
  }

  if (c.state !== 'idle' && c.state !== 'walk') return;

  const dist = Math.abs(c.x - p.x);
  const dir = Math.sign(p.x - c.x) || 1;

  if (p.state === 'down') {
    c.vx = dist > 40 ? dir * diff.speed * 1.5 : 0;
    if (dist < 44 && c.cd <= 0) {
      c.cd = diff.reaction;
      act(c, 'grab', p, false);
    }
    return;
  }

  if (dist > 50) {
    c.vx = dir * diff.speed;
    return;
  }

  c.vx = 0;
  if (c.cd <= 0) {
    c.cd = diff.reaction + Math.random() * diff.reaction;
    const r = Math.random();
    if (r < diff.grab) act(c, 'grab', p, false);
    else if (r < diff.grab + diff.attack) act(c, Math.random() < 0.6 ? 'punch' : 'kick', p, false);
  }
}

// ---------- STEP ----------

function step(f, o) {
  if (state !== 'fight') return;
  if (f.stun > 0) f.stun--;

  switch (f.state) {
    case 'punch':
    case 'kick': {
      f.timer--;
      const el = f.total - f.timer;
      const win = f.state === 'punch' ? [7, 13] : [10, 17];
      if (!f.hitDone && el >= win[0] && el <= win[1]) checkHit(f, o);
      if (f.timer <= 0 && (f.state === 'punch' || f.state === 'kick')) f.state = 'idle';
      break;
    }
    case 'grab':
      f.timer--;
      if (f.timer <= 0) resolveGrab(f, o);
      break;
    case 'hurt':
      f.timer--;
      if (f.timer <= 0) f.state = 'idle';
      break;
    case 'down':
      f.downT--;
      if (f.downT <= 0 && !f.ko) f.state = 'idle';
      break;
    case 'grabbing':
      if (!f.holding) { f.state = 'idle'; break; }
      f.grabT--;
      f.holding.x = f.x + f.facing * 16;
      f.holding.vx = 0;
      if (f.grabT <= 0) throwOpp(f, f.facing);
      break;
    case 'held':
      if (f.escape >= 6) escapeRelease(f);
      break;
    case 'pinned':
      f.pinT++;
      f.kick = Math.max(0, f.kick - 0.6);
      if (Math.floor(f.pinT / 50) + 1 >= 3 && f.pinner) {
        endMatch(f.pinner, 'PIN! 1-2-3');
        return;
      }
      if (f.kick >= 100) kickOut(f);
      break;
  }

  if (state !== 'fight') return;

  if (f.state === 'idle' || f.state === 'walk') {
    f.state = Math.abs(f.vx) > 0.1 ? 'walk' : 'idle';
  }

  // Movimento
  if (f.state === 'idle' || f.state === 'walk') {
    f.x += f.vx;
    f.facing = Math.sign(o.x - f.x) || f.facing;
  } else if (f.state === 'hurt' || f.state === 'down') {
    f.x += f.vx;
    f.vx *= 0.9;
  } else {
    f.vx = 0;
  }
}

// ---------- UPDATE ----------

function update() {
  frame++;
  if (state !== 'fight') return;

  if (intro > 0) {
    intro--;
    queue = [];
    return;
  }

  for (const a of queue) act(P, a, C, !!held.down);
  queue = [];

  if (P.state === 'idle' || P.state === 'walk') {
    P.vx = (held.right ? 2 : 0) - (held.left ? 2 : 0);
  }

  cpuThink(C, P);
  step(P, C);
  step(C, P);

  if (state !== 'fight') return;

  // Separazione dei due lottatori
  const busy = [P, C].some(f => ['held', 'grabbing', 'pinning', 'pinned', 'down'].includes(f.state));
  if (!busy) {
    const d = P.x - C.x;
    const min = 18;
    if (Math.abs(d) < min) {
      const push = ((min - Math.abs(d)) / 2) * Math.sign(d || 1);
      P.x += push;
      C.x -= push;
    }
  }

  P.x = Math.max(LEFT + 8, Math.min(RIGHT - 8, P.x));
  C.x = Math.max(LEFT + 8, Math.min(RIGHT - 8, C.x));

  if (koTimer > 0) {
    koTimer--;
    if (koTimer === 0) endMatch(koWinner, 'K.O.!');
  }
}

// ---------- DISEGNO ----------

// Sfondo: ring + pubblico animato, dallo sprite scene.svg (due frame affiancati)
function drawRing() {
  if (sceneImg.complete && sceneImg.naturalWidth > 0) {
    const fr = Math.floor(frame / 18) % 2; // cambia frame ogni 18 frame di gioco
    ctx.drawImage(sceneImg, fr * 480, 0, 480, 270, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);
  }
}

function drawFighter(f) {
  const x = Math.round(f.x), y = Math.round(f.y);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(f.facing, 1);

  const SKIN = '#f1c27d', HAIR = '#3f2a14', BOOT = '#111827';
  const step = f.state === 'walk' ? (Math.floor(frame / 6) % 2) : 0;
  const off = step ? 2 : -2;

  if (f.state === 'down' || f.state === 'pinned') {
    ctx.fillStyle = BOOT;
    ctx.fillRect(-26, -6, 6, 6);
    ctx.fillStyle = f.color;
    ctx.fillRect(-20, -10, 26, 10);
    ctx.fillStyle = SKIN;
    ctx.fillRect(6, -12, 10, 11);
    ctx.fillStyle = HAIR;
    ctx.fillRect(6, -12, 10, 3);
    ctx.restore();
    return;
  }

  // Gambe
  ctx.fillStyle = BOOT;
  if (f.state === 'kick') {
    ctx.fillRect(-4, -6, 4, 6);
    ctx.fillRect(0, -14, 18, 4);
  } else {
    ctx.fillRect(-5 + off, -6, 4, 6);
    ctx.fillRect(1 - off, -6, 4, 6);
  }

  // Corpo e tuta
  ctx.fillStyle = f.color;
  ctx.fillRect(-7, -24, 14, 18);

  // Testa
  ctx.fillStyle = SKIN;
  ctx.fillRect(-6, -34, 12, 10);
  ctx.fillStyle = HAIR;
  ctx.fillRect(-6, -34, 12, 3);
  ctx.fillStyle = '#111';
  ctx.fillRect(2, -28, 2, 2);

  // Braccia
  ctx.fillStyle = SKIN;
  if (f.state === 'punch') {
    ctx.fillRect(7, -22, 14, 4);
    ctx.fillRect(-10, -20, 4, 10);
  } else if (f.state === 'grab' || f.state === 'grabbing' || f.state === 'pinning') {
    ctx.fillRect(7, -22, 8, 4);
    ctx.fillRect(7, -16, 8, 4);
  } else if (f.state === 'held') {
    ctx.fillRect(-10, -30, 4, 10);
    ctx.fillRect(6, -30, 4, 10);
  } else {
    ctx.fillRect(-10, -22, 4, 12);
    ctx.fillRect(6, -22, 4, 12);
  }

  ctx.restore();
}

function drawBar(x, y, f, label, alignRight) {
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, 180, 10);
  ctx.fillStyle = f.hp > 30 ? '#22c55e' : '#ef4444';
  ctx.fillRect(x + 1, y + 1, 178 * (f.hp / 100), 8);
  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';
  ctx.textAlign = alignRight ? 'right' : 'left';
  ctx.fillText(label, alignRight ? x + 180 : x, y - 3);
  ctx.textAlign = 'left';
}

function drawHUD() {
  drawBar(8, 14, P, 'TU', false);
  drawBar(W - 188, 14, C, 'CPU ' + diff.name, true);

  for (const f of [P, C]) {
    if (f.state === 'pinned') {
      const count = Math.min(3, Math.floor(f.pinT / 50) + 1);
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(count), W / 2, 60);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText('MASH! PUGNO / CALCIO / PRESA', W / 2, 74);
      ctx.fillStyle = '#000';
      ctx.fillRect(W / 2 - 60, 80, 120, 8);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(W / 2 - 59, 81, Math.min(118, f.kick * 1.18), 6);
      ctx.textAlign = 'left';
    }
  }
}

function drawSparks() {
  for (const s of sparks) {
    ctx.fillStyle = '#fde047';
    ctx.fillRect(s.x - 4 + (s.t % 3), s.y + (s.t % 4) - 2, 3, 3);
    ctx.fillRect(s.x + 2 - (s.t % 2), s.y - 3, 3, 3);
    s.t--;
  }
  sparks = sparks.filter(s => s.t > 0);
}

function centerText(text, y, size, color) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, y);
  ctx.textAlign = 'left';
}

function drawMenu() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, W, H);
  centerText('PIXEL WRESTLING', 50, 24, '#facc15');
  ctx.font = '12px monospace';
  centerText('SCEGLI LA DIFFICOLTA', 85, 12, '#fff');
  DIFF.forEach((d, i) => {
    const y = 120 + i * 28;
    centerText(i === sel ? `> ${d.name} <` : d.name, y, 16, i === sel ? '#facc15' : '#cbd5e1');
  });
  centerText('Frecce: muovi  Z pugno  X calcio  C presa', 210, 10, '#e2e8f0');
  centerText('Giu + Z sull\'avversario a terra = schienamento', 226, 10, '#e2e8f0');
  centerText('INVIO o PUGNO per iniziare', 248, 11, '#86efac');
}

function drawOver() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, W, H);
  centerText('FINE INCONTRO', 110, 22, '#facc15');
  centerText(endText, 150, 14, '#fff');
  centerText('INVIO / R / PUGNO per il menu', 220, 11, '#86efac');
}

function render() {
  drawRing();
  if (state === 'menu') {
    drawMenu();
    return;
  }
  if (C) drawFighter(C);
  if (P) drawFighter(P);
  drawHUD();
  drawSparks();
  if (intro > 0) centerText('FIGHT!', 110, 28, '#fde047');
  if (state === 'over') drawOver();
}

// ---------- INPUT ----------

document.addEventListener('keydown', e => {
  const a = KEYMAP[e.code];
  if (!a) return;
  e.preventDefault();
  if (e.repeat) return;
  held[a] = true;
  onAction(a);
});

document.addEventListener('keyup', e => {
  const a = KEYMAP[e.code];
  if (a) held[a] = false;
});

document.querySelectorAll('#touch button').forEach(btn => {
  const a = btn.dataset.action;
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    held[a] = true;
    onAction(a);
  });
  const release = e => {
    e.preventDefault();
    held[a] = false;
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
});

// ---------- LOOP ----------

function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

loop();
