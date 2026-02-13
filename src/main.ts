import Matter from "matter-js";

const { Engine, Render, Bodies, Body, Composite, Events, Vector } = Matter;

/* =======================
   Debug
======================= */
const DEBUG_VIEW_GOAL = false; // 시작 전에도 골인쪽 보며 튜닝할 때 true
const DEBUG_SPAWN_ONE = false; // 필요하면 true (공 1개만 미리 생성)

/* =======================
   View / World
======================= */
const W = 520;
const VIEW_H = 760;
const WORLD_H = 2500;
const MAX_BALLS = 10;

/* =======================
   골인 흡입(전원 골인 보장)
======================= */
const SUCTION_RADIUS = 240;
const SUCTION_FORCE = 0.0009;
const NEAR_RADIUS = 58;
const SINK_TIME_MS = 520;

/* =======================
   카메라 / 미니뷰
======================= */
const START_FOCUS_MS = 1400;
const CAMERA_SMOOTH = 0.12;

const MINI_H = 160;
const MINI_W = 220;
const MINI_MARGIN = 18;

/* =======================
   고속 낙하 터널링 방지(중요)
======================= */
const FIXED_DT = 1000 / 60; // 60fps 고정
const MAX_BALL_SPEED = 26;  // 22~30 사이 튜닝 추천

/* =======================
   DOM
======================= */
const namesEl = document.querySelector<HTMLTextAreaElement>("#names")!;
const targetRankEl = document.querySelector<HTMLInputElement>("#targetRank")!;
const btnStart = document.querySelector<HTMLButtonElement>("#start")!;
const btnReset = document.querySelector<HTMLButtonElement>("#reset")!;
const logEl = document.querySelector<HTMLUListElement>("#log")!;
const queueEl = document.querySelector<HTMLElement>("#queue")!;
const maxEl = document.querySelector<HTMLElement>("#max")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const gameHost = document.querySelector<HTMLDivElement>("#game")!;
const miniHost = document.querySelector<HTMLDivElement>("#mini")!;
const miniWrap = document.querySelector<HTMLDivElement>(".mini")!;

maxEl.textContent = String(MAX_BALLS);

/* =======================
   helpers
======================= */
function setStatus(s: string) {
  statusEl.textContent = s;
}
function addLog(text: string) {
  const li = document.createElement("li");
  li.textContent = text;
  logEl.prepend(li);
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function parseNames(raw: string): string[] {
  const parts = raw
    .split(/[,|\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      unique.push(p);
    }
  }
  return unique.slice(0, MAX_BALLS);
}
function getTargetRank(maxRank: number) {
  const v = Number(targetRankEl.value || "1");
  return clamp(Math.floor(v), 1, maxRank);
}

/* =======================
   Matter setup
======================= */
const engine = Engine.create();
engine.gravity.y = 1.15;
engine.positionIterations = 10;   // 기본 6 → 10~12 추천
engine.velocityIterations = 8;    // 기본 4 → 6~8 추천
engine.constraintIterations = 4;  // 기본 2 → 3~4 추천
const world = engine.world;

/* 메인 렌더 */
const render = Render.create({
  element: gameHost,
  engine,
  options: {
    width: W,
    height: VIEW_H,
    wireframes: false,
    background: "#12121a",
    hasBounds: true,
  },
});
Render.run(render);

/* 미니 렌더 */
const miniRender = Render.create({
  element: miniHost,
  engine,
  options: {
    width: MINI_W,
    height: MINI_H,
    wireframes: false,
    background: "#12121a",
    hasBounds: true,
  },
});
Render.run(miniRender);

/* 픽셀비율: 초기 1회 */
(Render as any).setPixelRatio?.(render, window.devicePixelRatio || 1);
(Render as any).setPixelRatio?.(miniRender, window.devicePixelRatio || 1);

/* 미니뷰 랩퍼 기본 숨김 */
miniWrap.style.display = "none";

/* =======================
   고정 타임스텝 루프 (Runner 대체)
======================= */
let lastRAF = performance.now();
let acc = 0;

(function loop(now: number) {
  const frame = now - lastRAF;
  lastRAF = now;

  // 탭 전환/렉으로 dt 폭주 방지
  acc += Math.min(frame, 100);

  while (acc >= FIXED_DT) {
    Engine.update(engine, FIXED_DT);
    acc -= FIXED_DT;
  }
  requestAnimationFrame(loop);
})(lastRAF);

/* =======================
   카메라 유틸
======================= */
function setCameraToY(r: Matter.Render, centerY: number) {
  const cy = clamp(centerY, VIEW_H / 2, WORLD_H - VIEW_H / 2);
  r.bounds.min.x = 0;
  r.bounds.max.x = W;
  r.bounds.min.y = cy - VIEW_H / 2;
  r.bounds.max.y = cy + VIEW_H / 2;
}

function setMiniCamera(mini: Matter.Render, target: Matter.Body | null) {
  const mh = (mini.options.height ?? MINI_H) as number;

  mini.bounds.min.x = 0;
  mini.bounds.max.x = W;

  if (!target) {
    mini.bounds.min.y = 0;
    mini.bounds.max.y = mh;
    return;
  }

  const cy = target.position.y;
  mini.bounds.min.y = clamp(cy - mh / 2, 0, WORLD_H - mh);
  mini.bounds.max.y = mini.bounds.min.y + mh;
}

/* 시작시 원하는 위치(골인쪽/상단)로 1회만 세팅 */
let camY = DEBUG_VIEW_GOAL ? WORLD_H - VIEW_H / 2 : VIEW_H / 2;
setCameraToY(render, camY);
setMiniCamera(miniRender, null);

/* =======================
   Board (벽/장치)
======================= */
// 사이드 월
const wallL = Bodies.rectangle(10, WORLD_H / 2, 20, WORLD_H, {
  isStatic: true,
  render: { fillStyle: "#2b2b3a" },
});
const wallR = Bodies.rectangle(W - 10, WORLD_H / 2, 20, WORLD_H, {
  isStatic: true,
  render: { fillStyle: "#2b2b3a" },
});
Composite.add(world, [wallL, wallR]);

// Top funnel
const funnelL = Bodies.rectangle(W / 2 - 70, 95, 12, 170, {
  isStatic: true,
  angle: Math.PI / 6,
  render: { fillStyle: "#3a3a55" },
});
const funnelR = Bodies.rectangle(W / 2 + 70, 95, 12, 170, {
  isStatic: true,
  angle: -Math.PI / 6,
  render: { fillStyle: "#3a3a55" },
});
Composite.add(world, [funnelL, funnelR]);

// Pegs
function addPeg(x: number, y: number, r = 7) {
  Composite.add(
    world,
    Bodies.circle(x, y, r, {
      isStatic: true,
      render: { fillStyle: "#6c6cf5" },
    })
  );
}
(function buildPegs() {
  const startY = 180;
  const rows = 18;
  const gapY = 62;
  const gapX = 52;

  for (let row = 0; row < rows; row++) {
    const y = startY + row * gapY;
    const cols = row % 2 === 0 ? 8 : 7;
    const offsetX = row % 2 === 0 ? 60 : 86;
    for (let c = 0; c < cols; c++) addPeg(offsetX + c * gapX, y);
  }
})();

/* =======================
   Rotating Obstacle (Spinner)
======================= */
const SPINNER_X = W / 2;
const SPINNER_Y = 760;
const SPINNER_LEN = 440;
const SPINNER_THICK = 14;
const SPINNER_HUB_R = 18;
const SPINNER_SPEED = 0.045; // (60fps 기준 step 보정식에 사용)

const spinnerBar = Bodies.rectangle(
  SPINNER_X,
  SPINNER_Y,
  SPINNER_LEN,
  SPINNER_THICK,
  { render: { fillStyle: "#ffd400" } }
);
const spinnerHub = Bodies.circle(SPINNER_X, SPINNER_Y, SPINNER_HUB_R, {
  render: { fillStyle: "#ffd400" },
});
const spinner = Body.create({
  parts: [spinnerBar, spinnerHub],
  isStatic: true,
  label: "spinner",
  friction: 0,
  frictionStatic: 0,
  restitution: 0.9,
});
Composite.add(world, spinner);

/* =======================
   Obstacles set
   - Red: 좌우 이동 2개 (200 / 120)
   - Blue: 별모양 회전
======================= */
const BAR_THICK = 14;

type MovingBar = {
  body: Matter.Body;
  baseX: number;
  y: number;
  amp: number;
  speed: number; // rad/sec
  phase: number;
};

function createMovingBar(x: number, y: number, len: number, color: string) {
  return Bodies.rectangle(x, y, len, BAR_THICK, {
    isStatic: true,
    label: "mover",
    friction: 0,
    frictionStatic: 0,
    restitution: 0.95,
    render: { fillStyle: color },
  });
}

function calcAmp(len: number, margin = 26) {
  const max = W / 2 - margin - len / 2;
  return Math.max(0, max);
}

const RED1_LEN = 200;
const RED2_LEN = 120;

const redBar1 = createMovingBar(W / 2, 1760, RED1_LEN, "#ff3b3b");
const redBar2 = createMovingBar(W / 2, 1820, RED2_LEN, "#ff3b3b");

const movers: MovingBar[] = [
  { body: redBar1, baseX: W / 2, y: 1760, amp: calcAmp(RED1_LEN), speed: 1.6, phase: 0 },
  { body: redBar2, baseX: W / 2, y: 1820, amp: calcAmp(RED2_LEN), speed: 2.2, phase: Math.PI * 0.6 },
];

const STAR_X = W * 0.66;
const STAR_Y = 2000;
const STAR_LEN = 290;
const STAR_THICK = 12;
const STAR_HUB_R = 16;
const STAR_SPEED = 1.9; // rad/sec

function createStar(x: number, y: number) {
  const a0 = Bodies.rectangle(x, y, STAR_LEN, STAR_THICK, {
    render: { fillStyle: "#2f7bff" },
  });
  const a90 = Bodies.rectangle(x, y, STAR_LEN, STAR_THICK, {
    angle: Math.PI / 2,
    render: { fillStyle: "#2f7bff" },
  });
  const a45 = Bodies.rectangle(x, y, STAR_LEN, STAR_THICK, {
    angle: Math.PI / 4,
    render: { fillStyle: "#2f7bff" },
  });
  const a135 = Bodies.rectangle(x, y, STAR_LEN, STAR_THICK, {
    angle: -Math.PI / 4,
    render: { fillStyle: "#2f7bff" },
  });
  const hub = Bodies.circle(x, y, STAR_HUB_R, {
    render: { fillStyle: "#2f7bff" },
  });

  return Body.create({
    parts: [a0, a90, a45, a135, hub],
    isStatic: true,
    label: "star",
    friction: 0,
    frictionStatic: 0,
    restitution: 0.95,
  });
}

const star = createStar(STAR_X, STAR_Y);
Composite.add(world, [redBar1, redBar2, star]);

/* =======================
   아래 노란 나무 회전
======================= */
const WOOD_LEN = 180;
const WOOD_THICK = 12;
const WOOD_HUB_R = 14;
const WOOD_SPEED = 2.6; // rad/sec
let woodSpinner: Matter.Body | null = null;

function createWoodSpinner(x: number, y: number) {
  const barA = Bodies.rectangle(x, y, WOOD_LEN, WOOD_THICK, {
    render: { fillStyle: "#d6a15b" },
  });
  const barB = Bodies.rectangle(x, y, WOOD_LEN, WOOD_THICK, {
    angle: Math.PI / 2,
    render: { fillStyle: "#d6a15b" },
  });
  const hub = Bodies.circle(x, y, WOOD_HUB_R, {
    render: { fillStyle: "#d6a15b" },
  });

  return Body.create({
    parts: [barA, barB, hub],
    isStatic: true,
    label: "wood",
    friction: 0,
    frictionStatic: 0,
    restitution: 0.95,
  });
}

let obstacleTime = 0;

/* =======================
   Goal Zone (그림판 형태로 고정)
======================= */
const goalX = W / 2;
const goalY = WORLD_H - 30;
const BALL_R = 12;

const HOLE_W = 40;
const FLOOR_Y = WORLD_H - 0;
const FLOOR_H = 20;

const leftFloorW = goalX - HOLE_W / 2;
const rightFloorW = W - (goalX + HOLE_W / 2);

const floorL = Bodies.rectangle(leftFloorW / 2, FLOOR_Y, leftFloorW, FLOOR_H, {
  isStatic: true,
  render: { fillStyle: "#2b2b3a" },
});
const floorR = Bodies.rectangle(
  goalX + HOLE_W / 2 + rightFloorW / 2,
  FLOOR_Y,
  rightFloorW,
  FLOOR_H,
  { isStatic: true, render: { fillStyle: "#2b2b3a" } }
);

const goalSensor = Bodies.rectangle(goalX, goalY + 6, HOLE_W + 18, 24, {
  isStatic: true,
  isSensor: true,
  label: "goal",
  render: { fillStyle: "rgba(255,255,255,0.06)" },
});

const POST_W = 12;
const POST_H = 170;
const postOffsetX = HOLE_W / 2 + POST_W / 2;

const postL = Bodies.rectangle(goalX - postOffsetX, goalY - 38, POST_W, POST_H, {
  isStatic: true,
  render: { fillStyle: "#3a3a55" },
});
const postR = Bodies.rectangle(goalX + postOffsetX, goalY - 38, POST_W, POST_H, {
  isStatic: true,
  render: { fillStyle: "#3a3a55" },
});

const SLOPE_LEN = 240;
const SLOPE_H = 14;
const SLOPE_ANGLE = Math.PI / -10;
const slopeY = goalY - 150;

const slopeL = Bodies.rectangle(
  goalX - (postOffsetX + 105),
  slopeY,
  SLOPE_LEN,
  SLOPE_H,
  {
    isStatic: true,
    angle: -SLOPE_ANGLE,
    render: { fillStyle: "#3a3a55" },
  }
);
const slopeR = Bodies.rectangle(
  goalX + (postOffsetX + 105),
  slopeY,
  SLOPE_LEN,
  SLOPE_H,
  {
    isStatic: true,
    angle: SLOPE_ANGLE,
    render: { fillStyle: "#3a3a55" },
  }
);

Composite.add(world, [floorL, floorR, goalSensor, postL, postR, slopeL, slopeR]);

/* goal 이후에 wood spinner 추가 */
{
  const WOOD_X = W / 2;
  const WOOD_Y = goalY - 180;
  woodSpinner = createWoodSpinner(WOOD_X, WOOD_Y);
  Composite.add(world, woodSpinner);
}

/* =======================
   Mushroom Spring (multi)
======================= */
type MushroomDef = {
  x: number;
  y: number;
  dir?: "right" | "left";
  power?: number;
};

function addMushroom(def: MushroomDef) {
  const { x, y } = def;

  const mushBase = Bodies.circle(x, y + 34, 18, {
    isStatic: true,
    label: "mushBase",
    render: { fillStyle: "#6fd6ff" },
  });

  const mushDot1 = Bodies.circle(x - 26, y - 5, 8, {
    isStatic: true,
    label: "mushDot",
    render: { fillStyle: "#6fd6ff" },
  });
  const mushDot2 = Bodies.circle(x - 0, y + 5, 8, {
    isStatic: true,
    label: "mushDot",
    render: { fillStyle: "#6fd6ff" },
  });
  const mushDot3 = Bodies.circle(x + 22, y - 10, 8, {
    isStatic: true,
    label: "mushDot",
    render: { fillStyle: "#6fd6ff" },
  });

  const mushSpring = Bodies.circle(x, y, 26, {
    isStatic: true,
    isSensor: true,
    label: "mushSpring",
    render: { fillStyle: "rgba(255,255,255,0.95)" },
  });

  (mushSpring as any)._mush = {
    dir: def.dir ?? "right",
    power: def.power ?? 1,
  };

  Composite.add(world, [mushBase, mushSpring, mushDot1, mushDot2, mushDot3]);
}

const MUSHROOMS: MushroomDef[] = [
  { x: 40, y: 1940, dir: "right", power: 1 },
  { x: 420, y: 2200, dir: "left", power: 1 },
  { x: 110, y: 1520, dir: "right", power: 1 },
  { x: 310, y: 1640, dir: "left", power: 1 },
  { x: 120, y: 1260, dir: "right", power: 1 },
  { x: 470, y: 1440, dir: "left", power: 1 },
  { x: 260, y: 1360, dir: "right", power: 1 },
  { x: 120, y: 2100, dir: "right", power: 1 },
];

for (const m of MUSHROOMS) addMushroom(m);

/* =======================
   Game state
======================= */
type BallMeta = { name: string; color: string };

const ballMeta = new Map<number, BallMeta>();
const finished = new Set<number>();
let finishOrder: string[] = [];

let running = false;
let raceStartAt = 0;
let pickedRank = 1;

function setRunning(next: boolean) {
  running = next;
  btnStart.disabled = running;
  namesEl.disabled = running;
  targetRankEl.disabled = running;

  setStatus(next ? "running" : "idle");

  if (!running) {
    miniWrap.style.display = "none";
    setMiniCamera(miniRender, null);
  }
}

function randomColor(i: number) {
  const colors = [
    "#ffcc66",
    "#7dd3fc",
    "#c4b5fd",
    "#86efac",
    "#fda4af",
    "#fbbf24",
    "#a7f3d0",
    "#93c5fd",
    "#f9a8d4",
    "#fde68a",
  ];
  return colors[i % colors.length];
}

function spawnBall(name: string, i: number) {
  const x = W / 2 + (Math.random() * 120 - 60);
  const y = 55 + i * 3;

  const color = randomColor(i);

  const ball = Bodies.circle(x, y, BALL_R, {
    restitution: 0.45,
    friction: 0.02,
    frictionAir: 0.012,
    density: 0.004,
    label: "ball",
    render: { fillStyle: color },
  });

  ballMeta.set(ball.id, { name, color });

  Body.applyForce(
    ball,
    ball.position,
    Vector.create((Math.random() - 0.5) * 0.003, 0)
  );
  Composite.add(world, ball);
}

function clearBalls() {
  const bodies = Composite.allBodies(world);
  for (const b of bodies) {
    if (b.label === "ball") Composite.remove(world, b);
  }
  ballMeta.clear();
  finished.clear();
  finishOrder = [];
  miniWrap.style.display = "none";
}

function startRace(names: string[]) {
  clearBalls();
  setRunning(true);

  queueEl.textContent = String(names.length);

  targetRankEl.max = String(names.length);
  pickedRank = getTargetRank(names.length);
  targetRankEl.value = String(pickedRank);

  addLog(`🎯 Target Rank: ${pickedRank}등`);
  addLog(`🏁 Race started: ${names.length} balls`);

  raceStartAt = performance.now();

  camY = VIEW_H / 2;
  setCameraToY(render, camY);

  names.forEach((name, i) => spawnBall(name, i));

  if (DEBUG_SPAWN_ONE) {
    clearBalls();
    spawnBall(names[0], 0);
    queueEl.textContent = "1";
  }
}

/* =======================
   Finish 처리
======================= */
function finishBall(ball: Matter.Body) {
  finished.add(ball.id);

  const meta = ballMeta.get(ball.id);
  const name = meta?.name ?? "unknown";

  const rank = finishOrder.length + 1;
  finishOrder.push(name);
  addLog(`🏁 ${rank}등: ${name}`);

  if (rank === pickedRank) {
    addLog(`🎯 HIT! 지목 ${pickedRank}등 당첨: ${name}`);
  }

  animateSinkAndRemove(ball, () => {
    Composite.remove(world, ball);
    ballMeta.delete(ball.id);

    if (ballMeta.size === 0) {
      addLog("🎉 Race finished!");
      setStatus("done");
      setRunning(false);
      queueEl.textContent = "0";
    }
  });
}

/* =======================
   전원 골인 보장 로직 + 장애물 업데이트 + 속도 제한
   (beforeUpdate 1개로 통합)
======================= */
Events.on(engine, "beforeUpdate", () => {
  if (!running) return;

  const dt = FIXED_DT; //  runner.delta 대신 고정 dt 사용
  const dtSec = dt / 1000;

  obstacleTime += dtSec;

  // Spinner 회전 (60fps 기준 보정)
  const step = (SPINNER_SPEED * dt) / 16.666;
  Body.setAngle(spinner, spinner.angle + step);

  // 빨간 좌우 이동
  for (const m of movers) {
    const nx = m.baseX + m.amp * Math.sin(obstacleTime * m.speed + m.phase);
    Body.setPosition(m.body, { x: nx, y: m.y });
    Body.setVelocity(m.body, { x: 0, y: 0 });
  }

  // 파란 별 회전
  Body.setAngle(star, star.angle + STAR_SPEED * dtSec);

  // 나무 회전
  if (woodSpinner) {
    Body.setAngle(woodSpinner, woodSpinner.angle + WOOD_SPEED * dtSec);
  }

  // 골 흡입
  const gx = goalSensor.position.x;
  const gy = goalSensor.position.y;

  for (const body of Composite.allBodies(world)) {
    if (body.label !== "ball") continue;
    if (finished.has(body.id)) continue;

    //  고속 낙하 터널링 방지: 속도 상한
    const v = body.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (speed > MAX_BALL_SPEED) {
      const s = MAX_BALL_SPEED / speed;
      Body.setVelocity(body, { x: v.x * s, y: v.y * s });
    }

    const dx = gx - body.position.x;
    const dy = gy - body.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.0001) continue;

    if (dist <= NEAR_RADIUS) {
      finishBall(body);
      continue;
    }

    if (dist <= SUCTION_RADIUS) {
      const t = 1 - dist / SUCTION_RADIUS;
      const fx = (dx / dist) * SUCTION_FORCE * (0.45 + t);
      const fy = (dy / dist) * SUCTION_FORCE * (0.45 + t);
      Body.applyForce(body, body.position, { x: fx, y: fy });
    }
  }
});

/* =======================
   collisionStart (goal + mushroom)
======================= */
Events.on(engine, "collisionStart", (evt) => {
  for (const pair of evt.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;

    // (1) goal 처리
    const ball = a.label === "ball" ? a : b.label === "ball" ? b : null;
    const goal = a.label === "goal" ? a : b.label === "goal" ? b : null;

    if (ball && goal) {
      if (!finished.has(ball.id)) finishBall(ball);
      continue;
    }

    // (2) mushroom spring kick
    const spring = a.label === "mushSpring" ? a : b.label === "mushSpring" ? b : null;
    const ball2 = a.label === "ball" ? a : b.label === "ball" ? b : null;

    if (!spring || !ball2) continue;
    if (finished.has(ball2.id)) continue;

    const cfg = (spring as any)._mush as
      | { dir: "right" | "left"; power: number }
      | undefined;

    const dir = cfg?.dir ?? "right";
    const p = cfg?.power ?? 1;

    const baseVx = 8.5;
    const baseVy = -14.5;

    const vx = (dir === "right" ? 1 : -1) * baseVx * p;
    const vy = baseVy * p;

    Body.setVelocity(ball2, { x: vx, y: vy });
    Body.applyForce(ball2, ball2.position, {
      x: (dir === "right" ? 1 : -1) * 0.008 * p,
      y: -0.012 * p,
    });
  }
});

/* =======================
   싱크 연출 + 제거
======================= */
function animateSinkAndRemove(ball: Matter.Body, done: () => void) {
  const start = performance.now();
  const from = { x: ball.position.x, y: ball.position.y };
  const to = { x: goalSensor.position.x, y: goalSensor.position.y };

  // 연출 중 충돌 제거
  ball.collisionFilter.mask = 0;
  ball.collisionFilter.category = 0;

  const step = (now: number) => {
    const t = clamp((now - start) / SINK_TIME_MS, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);

    const nx = from.x + (to.x - from.x) * e;
    const ny = from.y + (to.y - from.y) * e;

    Body.setPosition(ball, { x: nx, y: ny });
    Body.setVelocity(ball, { x: 0, y: 0 });

    const scale = 1 - 0.55 * e;
    const current = (ball as any)._sinkScale ?? 1;
    const ratio = scale / current;
    (ball as any)._sinkScale = scale;
    Body.scale(ball, ratio, ratio);

    if (t < 1) requestAnimationFrame(step);
    else done();
  };

  requestAnimationFrame(step);
}

/* =======================
   Leader / Last (카메라 추적용)
======================= */
function getLeaderAndLast() {
  const balls: Matter.Body[] = [];
  for (const body of Composite.allBodies(world)) {
    if (body.label === "ball") balls.push(body);
  }
  if (balls.length === 0) {
    return { leader: null as Matter.Body | null, last: null as Matter.Body | null };
  }

  let leader = balls[0];
  let lastB = balls[0];

  for (const b of balls) {
    if (b.position.y > leader.position.y) leader = b;
    if (b.position.y < lastB.position.y) lastB = b;
  }

  return { leader, last: lastB };
}

function isBodyInMainView(body: Matter.Body) {
  const top = render.bounds.min.y;
  const bottom = render.bounds.max.y;

  const y = body.position.y;
  const r = BALL_R;

  return y + r >= top - MINI_MARGIN && y - r <= bottom + MINI_MARGIN;
}

/* =======================
   카메라 루프
   - running 아닐 때는 카메라 자동추적 "절대" 안 함
======================= */
Events.on(engine, "afterUpdate", () => {
  if (!running) return;

  const now = performance.now();
  const { leader, last } = getLeaderAndLast();

  const inStartFocus = now - raceStartAt < START_FOCUS_MS;

  if (inStartFocus || !leader) {
    camY = VIEW_H / 2;
  } else {
    const targetCamY = leader.position.y;
    camY = camY + (targetCamY - camY) * CAMERA_SMOOTH;
  }

  setCameraToY(render, camY);

  // 미니뷰 처리 (꼴찌가 메인뷰 밖이면 켜기)
  if (!last) {
    miniWrap.style.display = "none";
    setMiniCamera(miniRender, null);
    return;
  }

  const lastVisible = isBodyInMainView(last);
  if (lastVisible) {
    miniWrap.style.display = "none";
    setMiniCamera(miniRender, null);
  } else {
    miniWrap.style.display = "block";
    setMiniCamera(miniRender, last);
  }
});

/* =======================
   텍스트 오버레이(카메라 보정)
======================= */
function worldToScreen(r: Matter.Render, p: Matter.Vector) {
  const bw = r.bounds.max.x - r.bounds.min.x;
  const bh = r.bounds.max.y - r.bounds.min.y;

  const sx = (r.options.width as number) / bw;
  const sy = (r.options.height as number) / bh;

  return {
    x: (p.x - r.bounds.min.x) * sx,
    y: (p.y - r.bounds.min.y) * sy,
  };
}

Events.on(render, "afterRender", () => {
  const ctx = render.context;
  ctx.save();

  ctx.font = "12px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const body of Composite.allBodies(world)) {
    if (body.label !== "ball") continue;
    const meta = ballMeta.get(body.id);
    if (!meta) continue;

    const sp = worldToScreen(render, body.position);
    const x = sp.x;
    const y = sp.y - 18;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - 34, y - 10, 68, 18);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(meta.name, x, y - 1);
  }

  const cw = render.options.width as number;

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(cw - 170, 14, 156, 20 + finishOrder.length * 16);

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.fillText("Finish:", cw - 160, 28);

  finishOrder.forEach((n, i) => {
    ctx.fillText(`${i + 1}. ${n}`, cw - 160, 46 + i * 16);
  });

  ctx.restore();
});

/* =======================
   UI events
======================= */
btnStart.addEventListener("click", () => {
  const names = parseNames(namesEl.value);
  if (names.length === 0) {
    addLog("⚠️ 이름을 1개 이상 입력해줘!");
    return;
  }

  startRace(names);

  //  Start 눌렀을 때만, 880px 미만에서만 이동
  if (window.matchMedia("(max-width: 879px)").matches) {
    requestAnimationFrame(() => {
      gameHost.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
});

btnReset.addEventListener("click", () => {
  logEl.innerHTML = "";
  clearBalls();
  setRunning(false);

  setStatus("idle");
  queueEl.textContent = "0";

  camY = DEBUG_VIEW_GOAL ? WORLD_H - VIEW_H / 2 : VIEW_H / 2;
  setCameraToY(render, camY);
});

/* init */
setStatus("idle");
queueEl.textContent = "0";

/* =======================
   Debug camera keys
======================= */
window.addEventListener("keydown", (e) => {
  if (e.key === "g" || e.key === "G") {
    camY = WORLD_H - VIEW_H / 2;
    setCameraToY(render, camY);
  }
  if (e.key === "t" || e.key === "T") {
    camY = VIEW_H / 2;
    setCameraToY(render, camY);
  }
});
