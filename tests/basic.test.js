const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length > 0, 'index.html must contain its standalone script');

let domReadyHandler = null;
const context = {
  console,
  document: { querySelectorAll: () => [] },
  Math,
  window: {
    addEventListener: (eventName, handler) => {
      if (eventName === 'DOMContentLoaded') domReadyHandler = handler;
    },
    devicePixelRatio: 1
  }
};
vm.createContext(context);
vm.runInContext(
  `${scripts.at(-1)[1]}\nthis.MotorMathEngineForTest = MotorMathEngine; this.StandaloneAppForTest = StandaloneApp;`,
  context
);

const MotorMathEngine = context.MotorMathEngineForTest;
const StandaloneApp = context.StandaloneAppForTest;

function createFakeElement(id) {
  return {
    id,
    classList: { toggle: () => {} },
    className: '',
    dataset: {},
    min: '',
    max: '',
    setAttribute: () => {},
    style: {},
    textContent: '',
    value: '',
    addEventListener: () => {}
  };
}

function createFakeCanvas(id) {
  const canvas = createFakeElement(id);
  const context2d = {};
  for (const method of [
    'arc', 'beginPath', 'clearRect', 'closePath', 'fill', 'fillText', 'lineTo',
    'moveTo', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'stroke', 'translate'
  ]) {
    context2d[method] = () => {};
  }
  canvas.getBoundingClientRect = () => ({ width: 1000, height: 640, left: 0, top: 0 });
  canvas.getContext = () => context2d;
  return canvas;
}

const presets = {
  ipmsm: {
    params: { Rs: 0.02, Ld: 0.2, Lq: 0.35, psif: 0.045, poles: 4, rpm: 9000, Vdc: 800, Imax: 500 },
    point: { id: -220, iq: 300 }
  },
  spmsm: {
    params: { Rs: 0.5, Ld: 12, Lq: 12, psif: 0.18, poles: 4, rpm: 1500, Vdc: 260, Imax: 30 },
    point: { id: 0, iq: 10 }
  },
  highspeed: {
    params: { Rs: 0.5, Ld: 10, Lq: 18, psif: 0.175, poles: 4, rpm: 3600, Vdc: 260, Imax: 30 },
    point: { id: -19, iq: 5 }
  },
  fieldweakening: {
    params: { Rs: 0.5, Ld: 10, Lq: 18, psif: 0.175, poles: 4, rpm: 4800, Vdc: 260, Imax: 30 },
    point: { id: -18.5, iq: 3.8 }
  }
};

test('all presets are inside current and voltage limits', () => {
  for (const [name, { params, point }] of Object.entries(presets)) {
    const motor = new MotorMathEngine(params);
    const voltage = motor.solveVoltage(point.id, point.iq);
    const metrics = motor.calcMetrics(point.id, point.iq, voltage.ud, voltage.uq);
    assert.ok(metrics.currentRatio <= 100, `${name} exceeds current limit`);
    assert.ok(metrics.voltageRatio <= 100, `${name} exceeds voltage limit`);
  }
});

test('voltage/current round trip and power balance hold in both directions', () => {
  for (const direction of [1, -1]) {
    for (const { params, point } of Object.values(presets)) {
      const motor = new MotorMathEngine({ ...params, direction });
      const iq = direction * Math.abs(point.iq);
      const voltage = motor.solveVoltage(point.id, iq);
      const current = motor.solveCurrent(voltage.ud, voltage.uq);
      assert.ok(current);
      assert.ok(Math.hypot(current.id - point.id, current.iq - iq) < 1e-9);

      const metrics = motor.calcMetrics(point.id, iq, voltage.ud, voltage.uq);
      const mechanicalSpeed = motor.omega_e / motor.poles;
      assert.ok(Math.abs(metrics.Pmech - metrics.Te * mechanicalSpeed) < 1e-8);
    }
  }
});

test('MTPA point agrees with a brute-force current-circle search', () => {
  const motor = new MotorMathEngine(presets.ipmsm.params);
  for (const current of [50, 200, 500]) {
    const mtpa = motor.getMTPAPointAtCurrent(current, 1);
    let bruteForceTorque = -Infinity;
    const samples = 50000;
    for (let index = 0; index < samples; index += 1) {
      const angle = (2 * Math.PI * index) / samples;
      bruteForceTorque = Math.max(
        bruteForceTorque,
        motor.calcTorque(current * Math.cos(angle), current * Math.sin(angle))
      );
    }
    assert.ok(Math.abs(mtpa.T - bruteForceTorque) / Math.max(1, Math.abs(bruteForceTorque)) < 1e-7);
  }
});

test('MTPV condition and torque-contour anchors remain exact', () => {
  const motor = new MotorMathEngine(presets.ipmsm.params);
  const diff = motor.Ld - motor.Lq;
  for (const point of motor.getMTPVCurve(motor.Imax, 240, 1)) {
    const lhs = diff * motor.Lq * motor.Lq * point.iq * point.iq;
    const rhs = motor.Ld
      * (motor.psif + motor.Ld * point.id)
      * (motor.psif + diff * point.id);
    assert.ok(Math.abs(lhs - rhs) < 1e-18);
  }

  for (const contour of motor.getSuggestedTorqueContours(5, 1)) {
    assert.ok(contour.anchor);
    assert.ok(Math.abs(motor.calcTorque(contour.anchor.id, contour.anchor.iq) - contour.T) < 1e-10);
  }
});

test('singular inverse is reported and power-factor angle is normalized', () => {
  const singularMotor = new MotorMathEngine({
    Rs: 0,
    Ld: 0.2,
    Lq: 0.35,
    psif: 0.045,
    poles: 4,
    rpm: 0,
    Vdc: 800,
    Imax: 500
  });
  assert.equal(singularMotor.canSolveCurrent(), false);
  assert.equal(singularMotor.solveCurrent(100, 50), null);

  const motor = new MotorMathEngine(presets.ipmsm.params);
  const voltage = motor.solveVoltage(-500, 0);
  const metrics = motor.calcMetrics(-500, 0, voltage.ud, voltage.uq);
  assert.ok(metrics.powerAngle >= -180 && metrics.powerAngle < 180);
});

test('loading a preset preserves and synchronizes reverse direction', () => {
  const app = Object.create(StandaloneApp.prototype);
  app.motor = new MotorMathEngine();
  app.direction = -1;
  app.state = { id: 0, iq: 0, ud: 0, uq: 0 };
  app.renderAll = () => {};
  app.inputs = {};

  for (const key of ['Rs', 'Ld', 'Lq', 'psif', 'poles', 'rpm', 'Vdc', 'Imax']) {
    app.inputs[key] = { value: '0' };
  }
  for (const key of ['Rs', 'Ld', 'Lq', 'psif', 'rpm', 'Vdc', 'Imax']) {
    app.inputs[`${key}_slider`] = { value: '0' };
  }

  app.loadPreset('spmsm');
  assert.equal(app.direction, -1);
  assert.equal(app.motor.direction, -1);
  app.onParamsChanged();
  assert.equal(app.motor.direction, -1);
});

test('canvas grid and resize fixes remain present', () => {
  assert.match(html, /ctx\.moveTo\(0, py\);/);
  assert.doesNotMatch(html, /ctx\.moveTo\(0, this\.width\);/);
  assert.match(html, /requestAnimationFrame\(\(\) => \{/);
});

test('standalone page boots and renders with every required DOM element', () => {
  const elements = new Map();
  for (const match of html.matchAll(/id="([^"]+)"/g)) {
    const id = match[1];
    elements.set(id, id === 'unified-canvas' ? createFakeCanvas(id) : createFakeElement(id));
  }

  const directionButtons = [1, -1].map(direction => {
    const button = createFakeElement(`direction-${direction}`);
    button.dataset.direction = String(direction);
    return button;
  });
  const presetButtons = ['ipmsm', 'spmsm', 'highspeed', 'fieldweakening'].map(name => {
    const button = createFakeElement(`preset-${name}`);
    button.dataset.preset = name;
    return button;
  });

  context.document = {
    getElementById: id => elements.get(id) || null,
    querySelectorAll: selector => {
      if (selector === '.btn-direction') return directionButtons;
      if (selector === '.btn-preset') return presetButtons;
      return [];
    }
  };

  assert.equal(typeof domReadyHandler, 'function');
  domReadyHandler();
  assert.ok(context.window.app);
  assert.equal(context.window.app.motor.direction, 1);
  assert.match(elements.get('val-te').textContent, /N·m$/);
  assert.equal(elements.get('alert-voltage').style.display, 'none');
  assert.equal(elements.get('alert-current').style.display, 'none');
});
