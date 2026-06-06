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

let running = false;

function makeRule() {
  const symbols = ["F", "+", "-", "^", "&"];
  let result = "";
  for (let i = 0; i < 10; i++) result += random(symbols);
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

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);

  osc = new p5.Oscillator("sawtooth");
  osc.start();
  osc.amp(0);

  angle = radians(35);

  col = randomEGAColor();
  generateSystem();
}

function mousePressed() {
  userStartAudio();
  running = !running;

  if (!running) {
    osc.amp(0, 0.2);
  }
}

function generateSystem() {
  sentence = axiom;
  len = baseLen;

  rules.F = makeRule();

  for (let i = 0; i < 4; i++) {
    let next = "";
    for (let c of sentence) {
      next += rules[c] || c;
    }
    sentence = next;
    len *= 0.6;
  }
}

function draw() {
  background(0);

  if (!running) return;

  if (frameCount - lastSwap > swapInterval) {
    generateSystem();
    lastSwap = frameCount;

    strokeWeight(random(2, 10));
    osc.freq(0);
    osc.setType(random(["triangle", "sawtooth", "square", "sine"]));
    col = randomEGAColor();
    swapInterval = random(6, 10);

    if (random() < 0.01) swapInterval = 100;
  }

  let complexity = sentence.length;

  let freq = map(complexity, 20, 2000, 120, 900, true);
  osc.freq(freq, 0.1);

  let amp = map(complexity, 20, 2000, 0.05, 0.25, true);
  osc.amp(amp, 0.1);

  rotateX(-0.6);
  rotateY(frameCount * 0.0012);

  drawTurtle(sentence);
}

function drawTurtle(str) {
  push();

  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    switch (c) {
      case "F":
        stroke(col);
        line(0, 0, 0, 0, -len, 0);
        translate(0, -len, 0);
        break;

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
    }
  }

  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}