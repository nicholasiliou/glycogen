let sentence;
const axiom = "F";

let rules = {};
let baseLen = 80;
let len = baseLen;

let col;
let angle;
let osc;

let swapInterval = 1;
let lastSwap = 0;

let signalLife = 0;

let running = false;
let audioReady = false;

// ---------- SYSTEM ----------
function makeRule() {
  let result = "";
  let open = 0;

  for (let i = 0; i < 10; i++) {
    const r = random();

    // HARD LIMIT: prevent forward-only chains
    if (i > 2 && random() < 0.25) {
      result += "[F]";
      continue;
    }

    if (r < 0.22) {
      result += "F";
    } 
    else if (r < 0.5) {
      result += random(["+", "-", "^", "&"]);
    } 
    else if (r < 0.78) {
      result += "[F";
      open++;
    } 
    else {
      if (open > 0) {
        result += "]";
        open--;
      } else {
        result += random(["+", "-", "&", "^"]);
      }
    }
  }

  while (open-- > 0) result += "]";

  return result;
}

function randomEGAColor() {
  const ega = [
    color(192, 252, 4),
    color(234, 2, 126),
    color(54, 1, 251),
    color(255, 85, 0),
  ];
  return random(ega);
}

// ---------- PHI ----------
function Phi(str) {
  let stats = { F: 0, "+": 0, "-": 0, "^": 0, "&": 0 };
  let branches = 0;

  for (let c of str) {
    if (stats[c] !== undefined) stats[c]++;
    if (c === "[") branches++;
  }

  let total = Object.values(stats).reduce((a, b) => a + b, 0) || 1;

  return {
    energy: total,
    chaos: stats["^"] + stats["&"],
    rotation: abs(stats["+"] - stats["-"]),
    branches
  };
}

// ---------- AUDIO ----------
function initAudio() {
  if (audioReady) return;

  userStartAudio();

  osc = new p5.Oscillator("sawtooth");
  osc.start();
  osc.amp(0);

  audioReady = true;
}

// ---------- SETUP ----------
function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);

  angle = radians(35);
  col = randomEGAColor();

  generateSystem();
}

// ---------- FIX: ANTI-PILLAR ----------
function injectEarlyDeviation(str) {
  const head = str.slice(0, 20);
  const rest = str.slice(20);

  const hasDeviation =
    head.includes("+") ||
    head.includes("-") ||
    head.includes("&") ||
    head.includes("^");

  if (hasDeviation) return str;

  return random(["+", "-", "&", "^"]) + "F" + rest;
}

// ---------- SYSTEM GENERATION ----------
function generateSystem() {
  sentence = axiom;
  len = baseLen;

  rules.F = makeRule();

  for (let i = 0; i < 4; i++) {
    let next = "";
    for (let c of sentence) next += rules[c] || c;
    sentence = next;
    len *= 0.6;
  }

  // enforce early non-vertical structure
  sentence = injectEarlyDeviation(sentence);
}

// ---------- INPUT ----------
function mousePressed() {
  initAudio();
  running = !running;

  if (!running && osc) {
    osc.amp(0.2);
  }
}

// ---------- DRAW ----------
function draw() {
  scale(3)
  background(0);

  if (!running || !audioReady) return;

  if (frameCount - lastSwap > swapInterval) {
    generateSystem();
    lastSwap = frameCount;

    osc.setType(random(["triangle", "sawtooth", "square", "sine"]));
    //osc.setType("square");
    col = randomEGAColor();

    swapInterval = random(1, 4);
    if (random() < 0.2) swapInterval = random(30, 70);

    signalLife = 0;
  }

  signalLife++;

  let phi = Phi(sentence);

  // softer, darker pitch range
  let freqBase = map(phi.energy, 1, 10000, 10, 100, true);

  // gentle smoothing so it stops snapping
  let currentFreq = osc.getFreq ? osc.getFreq() : freqBase;
  let freq = lerp(currentFreq, freqBase, 0.06);

  // amp stays subtle so pitch feels “closer”
  let ampTarget = map(phi.chaos + phi.branches, 0, 600, 0.02, 0.12, true);
  let currentAmp = osc.getAmp ? osc.getAmp() : ampTarget;
  let amp = lerp(currentAmp, ampTarget, 0.55);

  // apply with slower envelopes
  osc.freq(freq);
  osc.amp(amp, random(0.1, 10));

  angle = map(phi.rotation, 0, 100, radians(10), radians(60));

  rotateX(0.01);
  rotateY(frameCount * 0.06);

  drawTurtle(sentence);
}

// ---------- TURTLE ----------
function drawTurtle(str) {
  push();

  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    switch (c) {
      case "F": {
        depth++;

        stroke(col);

        let w = map(depth, 0, 20, 6, 0.4, true);
        strokeWeight(w);

        let segmentLen = len * map(depth, 0, 20, 1, 0.35, true);

        line(0, 0, 0, 0, -segmentLen, 0);
        translate(0, -segmentLen, 0);
        break;
      }

      case "+":
        rotateY(angle);
        break;

      case "-":
        rotateY(-angle);
        break;

      case "&":
        rotateX(angle);
        rotateZ(angle * 0.3);
        break;

      case "^":
        rotateX(-angle);
        rotateZ(-angle * 0.3);
        break;

      case "[":
        push();
        depth += 2;
        break;

      case "]":
        pop();
        depth = max(0, depth - 2);
        break;
    }
  }

  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}