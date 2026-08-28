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
  `${scripts.at(-1)[1]}\nthis.MotorMathEngineForTest = MotorMathEngine; this.UnifiedCanvasRendererForTest = UnifiedCanvasRenderer; this.StandaloneAppForTest = StandaloneApp;`,
  context
);

const MotorMathEngine = context.MotorMathEngineForTest;
const UnifiedCanvasRenderer = context.UnifiedCanvasRendererForTest;
const StandaloneApp = context.StandaloneAppForTest;
const expectedLayerNames = [
  'grid',
  'currentLimit',
  'voltageCircle',
  'voltageEllipse',
  'mtpa',
  'mtpv',
  'torque',
  'currentVector',
  'voltageVector',
  'projections'
];

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
    'moveTo', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform',
    'stroke', 'translate'
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
  const mtpvPoints = motor.getMTPVCurve(motor.Imax, 240, 1);
  for (const point of mtpvPoints) {
    assert.ok(motor.psif + diff * point.id > 0, 'MTPV must stay on the PM-assisted main branch');
    const lhs = diff * motor.Lq * motor.Lq * point.iq * point.iq;
    const rhs = motor.Ld
      * (motor.psif + motor.Ld * point.id)
      * (motor.psif + diff * point.id);
    assert.ok(Math.abs(lhs - rhs) < 1e-18);
  }

  for (let index = 1; index < mtpvPoints.length; index += 1) {
    const jump = Math.hypot(
      mtpvPoints[index].id - mtpvPoints[index - 1].id,
      mtpvPoints[index].iq - mtpvPoints[index - 1].iq
    );
    assert.ok(jump < motor.Imax * 0.1, `MTPV contains an artificial ${jump.toFixed(1)} A jump`);
  }

  for (const contour of motor.getSuggestedTorqueContours(5, 1)) {
    assert.ok(contour.anchor);
    assert.ok(Math.abs(motor.calcTorque(contour.anchor.id, contour.anchor.iq) - contour.T) < 1e-10);
  }
});

test('IPMSM signed torque contours stay aligned with iq on the normal FOC branch', () => {
  const motor = new MotorMathEngine(presets.ipmsm.params);
  const diff = motor.Ld - motor.Lq;
  const asymptoteId = -motor.psif / diff;

  for (const direction of [1, -1]) {
    const contours = motor.getSuggestedTorqueContours(10, direction);
    const peakTorque = motor.getCurrentLimitedPeakTorque(direction);
    assert.equal(contours.length, 10);

    contours.forEach((contour, index) => {
      assert.ok(Math.abs(contour.T - peakTorque * ((index + 1) / 10)) < 1e-10);
      assert.equal(contour.segments.length, 1);
      assert.ok(contour.segments[0].at(-1).id < asymptoteId);
      if (index < 9) assert.ok(contour.segments[0].some(point => point.id > 0));

      for (const segment of contour.segments) {
        for (const point of segment) {
          assert.ok(motor.psif + diff * point.id > 0);
          assert.equal(Math.sign(point.iq), direction);
          assert.ok(Math.abs(motor.calcTorque(point.id, point.iq) - contour.T) < 1e-9);
          if (diff * (point.id - contour.anchor.id) > 0) {
            assert.ok(Math.hypot(point.id, point.iq) <= motor.Imax * 1.02 + 1e-7);
          }
        }
      }
    });
  }

  const signedMap = motor.getBidirectionalTorqueContours(10);
  assert.equal(signedMap.length, 20);
  assert.equal(signedMap.filter(contour => contour.T > 0).length, 10);
  assert.equal(signedMap.filter(contour => contour.T < 0).length, 10);
  assert.ok(signedMap.filter(contour => contour.T > 0).every(contour => (
    contour.segments.flat().every(point => point.iq > 0)
  )));
  assert.ok(signedMap.filter(contour => contour.T < 0).every(contour => (
    contour.segments.flat().every(point => point.iq < 0)
  )));
});

test('torque map renders both signs independently of speed direction', () => {
  assert.match(html, /getBidirectionalTorqueContours\(10\)/);
  assert.doesNotMatch(html, /getSuggestedTorqueContours\(10, m\.direction\)/);
  assert.doesNotMatch(html, /c\.isPeak \? '#e2e8f0'/);
  assert.match(html, /±0\.1 \/ ±0\.2 \/ … \/ ±1\.0 × Tmax/);

  const forwardMotor = new MotorMathEngine({ ...presets.ipmsm.params, direction: 1 });
  const reverseMotor = new MotorMathEngine({ ...presets.ipmsm.params, direction: -1 });
  assert.equal(
    JSON.stringify(forwardMotor.getBidirectionalTorqueContours(4)),
    JSON.stringify(reverseMotor.getBidirectionalTorqueContours(4))
  );
});

test('canvas layers are independently switchable and default to visible', () => {
  const layerNames = [...html.matchAll(/class="btn-layer active" data-layer="([^"]+)"/g)]
    .map(match => match[1]);
  assert.deepEqual(layerNames, expectedLayerNames);
  assert.match(html, /if \(this\.layerVisibility\.torque\) \{[\s\S]*?getBidirectionalTorqueContours\(10\)/);
  assert.match(html, /drawGrid\(m\.Imax, m\.Umax, this\.layerVisibility\.grid\)/);
  assert.match(html, /this\.layerVisibility\.projections/);

  const app = Object.create(StandaloneApp.prototype);
  app.layerVisibility = Object.fromEntries(expectedLayerNames.map(name => [name, true]));
  app.layerDOM = {
    buttons: expectedLayerNames.map(name => {
      const button = createFakeElement(`layer-${name}`);
      button.dataset.layer = name;
      return button;
    }),
    showAll: createFakeElement('show-all-layers')
  };
  let renderCount = 0;
  app.renderAll = () => { renderCount += 1; };

  app.setLayerVisibility('torque', false);
  assert.equal(app.layerVisibility.torque, false);
  assert.equal(renderCount, 1);

  app.setLayerVisibility('not-a-layer', false);
  assert.equal(renderCount, 1);

  app.showAllLayers();
  assert.ok(Object.values(app.layerVisibility).every(Boolean));
  assert.equal(renderCount, 2);
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
  assert.match(html, /new ResizeObserver\(scheduleCanvasResize\)/);
  assert.match(html, /window\.addEventListener\('pageshow', scheduleCanvasResize\)/);
  assert.match(html, /if \(!document\.hidden\) scheduleCanvasResize\(\)/);
  assert.match(html, /\.workspace \{[\s\S]*?order: -1;/);
});

test('a transient zero-size layout does not clear the last valid canvas', () => {
  const canvas = createFakeCanvas('resize-test');
  let rect = { width: 1000, height: 640, left: 0, top: 0 };
  canvas.getBoundingClientRect = () => rect;
  const renderer = new UnifiedCanvasRenderer(canvas);
  const validBitmap = [canvas.width, canvas.height];

  rect = { width: 0, height: 0, left: 0, top: 0 };
  assert.equal(renderer.resize(), false);
  assert.deepEqual([canvas.width, canvas.height], validBitmap);
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
  const layerButtons = expectedLayerNames.map(name => {
    const button = createFakeElement(`layer-${name}`);
    button.dataset.layer = name;
    return button;
  });

  context.document = {
    addEventListener: () => {},
    getElementById: id => elements.get(id) || null,
    querySelectorAll: selector => {
      if (selector === '.btn-direction') return directionButtons;
      if (selector === '.btn-preset') return presetButtons;
      if (selector === '.btn-layer') return layerButtons;
      return [];
    }
  };

  assert.equal(typeof domReadyHandler, 'function');
  domReadyHandler();
  assert.ok(context.window.app);
  assert.equal(context.window.app.motor.direction, 1);
  assert.ok(Object.values(context.window.app.layerVisibility).every(Boolean));
  assert.match(elements.get('val-te').textContent, /N·m$/);
  assert.equal(elements.get('alert-voltage').style.display, 'none');
  assert.equal(elements.get('alert-current').style.display, 'none');

  let torqueRenderCount = 0;
  context.window.app.motor.getBidirectionalTorqueContours = () => {
    torqueRenderCount += 1;
    return [];
  };
  context.window.app.setLayerVisibility('torque', false);
  assert.equal(torqueRenderCount, 0, 'hidden torque layer must skip contour generation');
  context.window.app.setLayerVisibility('torque', true);
  assert.equal(torqueRenderCount, 1, 'visible torque layer must generate contours');
});
