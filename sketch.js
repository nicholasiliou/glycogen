let sentence;
const axiom = "F";

const rules = {};

let baseLen = 160;
let len = baseLen;

let angle;
let iterations = 0;

let lastReset = 0;
let resetInterval = 12;

let osc;

function makeRule() {
  const symbols = ["F", "+", "-", "^", "&", "*"];
  let result = "";

  for (let i = 0; i < 10; i++) {
    result += random(symbols);
  }

  return result;
}

function regenerateSystem() {
  rules.F = makeRule();
  sentence = axiom;

  len = baseLen;
  iterations = 0;
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);

  osc = new p5.Oscillator('sine');
  osc.start();
  osc.amp(0.2);

  angle = radians(22.5);

  regenerateSystem();
}

function draw() {
  background(0);

  let radius = 600;
  let speed = 0.01;

  camera(
    radius * cos(frameCount * speed),
    0,
    radius * sin(frameCount * speed),
    0, 0, 0,
    0, 1, 0
  );

  ambientLight(80);

  if (frameCount - lastReset > resetInterval) {
    regenerateSystem();
    lastReset = frameCount;
  }

  if (iterations < 5) {
    generate();
    iterations++;
  }

  push();
  drawTurtle(sentence);
  pop();

  // AUDIO FROM PIXELS
  loadPixels();

  let total = 0;

  for (let i = 0; i < pixels.length; i += 16) {
    let r = pixels[i];
    let g = pixels[i + 1];
    let b = pixels[i + 2];

    total += (r + g + b) / 3;
  }

  let avg = total / (pixels.length / 64);

  let freq = map(avg, 0, 255, 100, 800);

  osc.freq(freq, 0.1);
}

function generate() {
  let next = "";

  for (let c of sentence) {
    next += rules[c] || c;
  }

  sentence = next;
  len *= 0.5;
}

function drawTurtle(str) {
  stroke(220);
  noFill();

  for (let i = 0; i < str.length; i++) {
    let c = str[i];

    switch (c) {
      case "F":
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
        break;

      case "^":
        rotateX(-angle);
        break;

      case "[":
        push();
        break;

      case "]":
        pop();
        break;
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}