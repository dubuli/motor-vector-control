/**
 * PMSM Motor Control Vector Interactive Axis Application
 */

import { MotorMath } from './motorMath.js';
import { CanvasRenderer } from './canvasRenderer.js';
import { VectorDragController } from './interactiveControls.js';

class MotorVectorApp {
    constructor() {
        this.motor = new MotorMath();

        // Initial Operating Point
        this.state = {
            id: -5,
            iq: 15,
            ud: 0,
            uq: 0
        };

        // Recalculate initial voltage
        const initVolt = this.motor.solveVoltage(this.state.id, this.state.iq);
        this.state.ud = initVolt.ud;
        this.state.uq = initVolt.uq;

        this.initDOM();
        this.initRenderers();
        this.bindEvents();
        this.loadPreset('ipmsm');
        this.renderAll();
    }

    initDOM() {
        // Form inputs
        this.inputs = {
            Rs: document.getElementById('input-rs'),
            Ld: document.getElementById('input-ld'),
            Lq: document.getElementById('input-lq'),
            psif: document.getElementById('input-psif'),
            poles: document.getElementById('input-poles'),
            rpm: document.getElementById('input-rpm'),
            Vdc: document.getElementById('input-vdc'),
            Imax: document.getElementById('input-imax'),
            
            // Slider twins
            Rs_slider: document.getElementById('slider-rs'),
            Ld_slider: document.getElementById('slider-ld'),
            Lq_slider: document.getElementById('slider-lq'),
            psif_slider: document.getElementById('slider-psif'),
            rpm_slider: document.getElementById('slider-rpm'),
            Vdc_slider: document.getElementById('slider-vdc'),
            Imax_slider: document.getElementById('slider-imax'),

            // Manual Vector Inputs
            id_input: document.getElementById('input-id'),
            iq_input: document.getElementById('input-iq'),
            ud_input: document.getElementById('input-ud'),
            uq_input: document.getElementById('input-uq')
        };

        // Metric displays
        this.metricsDOM = {
            id: document.getElementById('val-id'),
            iq: document.getElementById('val-iq'),
            Is: document.getElementById('val-is'),
            ud: document.getElementById('val-ud'),
            uq: document.getElementById('val-uq'),
            Us: document.getElementById('val-us'),
            Te: document.getElementById('val-te'),
            Pin: document.getElementById('val-pin'),
            Ploss: document.getElementById('val-ploss'),
            Pmech: document.getElementById('val-pmech'),
            pf: document.getElementById('val-pf'),
            pAngle: document.getElementById('val-pangle'),
            vBar: document.getElementById('bar-voltage'),
            cBar: document.getElementById('bar-current'),
            vPercent: document.getElementById('percent-voltage'),
            cPercent: document.getElementById('percent-current'),
            alertVoltage: document.getElementById('alert-voltage'),
            alertCurrent: document.getElementById('alert-current')
        };
    }

    initRenderers() {
        const cCurrent = document.getElementById('canvas-current');
        const cVoltage = document.getElementById('canvas-voltage');

        this.currentRenderer = new CanvasRenderer(cCurrent, 'current');
        this.voltageRenderer = new CanvasRenderer(cVoltage, 'voltage');

        // Setup Drag Controllers
        this.currentDrag = new VectorDragController(this.currentRenderer, (id, iq) => {
            this.state.id = id;
            this.state.iq = iq;
            const volt = this.motor.solveVoltage(id, iq);
            this.state.ud = volt.ud;
            this.state.uq = volt.uq;
            this.renderAll();
        });

        this.voltageDrag = new VectorDragController(this.voltageRenderer, (ud, uq) => {
            this.state.ud = ud;
            this.state.uq = uq;
            const curr = this.motor.solveCurrent(ud, uq);
            this.state.id = curr.id;
            this.state.iq = curr.iq;
            this.renderAll();
        });
    }

    bindEvents() {
        // Sync number input & slider twins
        const paramKeys = ['Rs', 'Ld', 'Lq', 'psif', 'rpm', 'Vdc', 'Imax'];
        paramKeys.forEach(key => {
            const num = this.inputs[key];
            const slider = this.inputs[`${key}_slider`];

            if (num && slider) {
                num.addEventListener('input', () => {
                    slider.value = num.value;
                    this.onParamsChanged();
                });
                slider.addEventListener('input', () => {
                    num.value = slider.value;
                    this.onParamsChanged();
                });
            }
        });

        if (this.inputs.poles) {
            this.inputs.poles.addEventListener('change', () => this.onParamsChanged());
        }

        // Manual Vector Numeric Inputs
        this.inputs.id_input.addEventListener('change', () => {
            this.state.id = parseFloat(this.inputs.id_input.value) || 0;
            const volt = this.motor.solveVoltage(this.state.id, this.state.iq);
            this.state.ud = volt.ud;
            this.state.uq = volt.uq;
            this.renderAll();
        });

        this.inputs.iq_input.addEventListener('change', () => {
            this.state.iq = parseFloat(this.inputs.iq_input.value) || 0;
            const volt = this.motor.solveVoltage(this.state.id, this.state.iq);
            this.state.ud = volt.ud;
            this.state.uq = volt.uq;
            this.renderAll();
        });

        this.inputs.ud_input.addEventListener('change', () => {
            this.state.ud = parseFloat(this.inputs.ud_input.value) || 0;
            const curr = this.motor.solveCurrent(this.state.ud, this.state.uq);
            this.state.id = curr.id;
            this.state.iq = curr.iq;
            this.renderAll();
        });

        this.inputs.uq_input.addEventListener('change', () => {
            this.state.uq = parseFloat(this.inputs.uq_input.value) || 0;
            const curr = this.motor.solveCurrent(this.state.ud, this.state.uq);
            this.state.id = curr.id;
            this.state.iq = curr.iq;
            this.renderAll();
        });

        // Presets
        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const presetKey = e.currentTarget.dataset.preset;
                this.loadPreset(presetKey);
            });
        });
    }

    onParamsChanged() {
        const p = {
            Rs: parseFloat(this.inputs.Rs.value),
            Ld: parseFloat(this.inputs.Ld.value),
            Lq: parseFloat(this.inputs.Lq.value),
            psif: parseFloat(this.inputs.psif.value),
            poles: parseInt(this.inputs.poles.value),
            rpm: parseFloat(this.inputs.rpm.value),
            Vdc: parseFloat(this.inputs.Vdc.value),
            Imax: parseFloat(this.inputs.Imax.value)
        };

        this.motor.updateParams(p);

        // Keep current vector and re-solve voltage
        const volt = this.motor.solveVoltage(this.state.id, this.state.iq);
        this.state.ud = volt.ud;
        this.state.uq = volt.uq;

        this.renderAll();
    }

    loadPreset(name) {
        let p = {};
        if (name === 'spmsm') {
            p = { Rs: 0.5, Ld: 12, Lq: 12, psif: 0.18, poles: 4, rpm: 1500, Vdc: 260, Imax: 30 };
            this.state.id = 0;
            this.state.iq = 18;
        } else if (name === 'ipmsm') {
            p = { Rs: 0.02, Ld: 0.2, Lq: 0.35, psif: 0.045, poles: 4, rpm: 9000, Vdc: 800, Imax: 500 };
            this.state.id = -220;
            this.state.iq = 300;
        } else if (name === 'highspeed') {
            p = { Rs: 0.5, Ld: 10, Lq: 18, psif: 0.175, poles: 4, rpm: 3600, Vdc: 260, Imax: 30 };
            this.state.id = -18;
            this.state.iq = 12;
        } else if (name === 'fieldweakening') {
            p = { Rs: 0.5, Ld: 10, Lq: 18, psif: 0.175, poles: 4, rpm: 4800, Vdc: 260, Imax: 30 };
            this.state.id = -22;
            this.state.iq = 8;
        }

        // Set DOM inputs
        for (const [k, v] of Object.entries(p)) {
            if (this.inputs[k]) this.inputs[k].value = v;
            if (this.inputs[`${k}_slider`]) this.inputs[`${k}_slider`].value = v;
        }

        this.motor.updateParams(p);
        const volt = this.motor.solveVoltage(this.state.id, this.state.iq);
        this.state.ud = volt.ud;
        this.state.uq = volt.uq;

        // Highlight preset button
        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.preset === name);
        });

        this.renderAll();
    }

    renderAll() {
        const m = this.motor;
        const s = this.state;

        // Update Drag handles positions
        this.currentDrag.setVectorPosition(s.id, s.iq);
        this.voltageDrag.setVectorPosition(s.ud, s.uq);

        // Update Manual numerical fields
        this.inputs.id_input.value = s.id.toFixed(2);
        this.inputs.iq_input.value = s.iq.toFixed(2);
        this.inputs.ud_input.value = s.ud.toFixed(2);
        this.inputs.uq_input.value = s.uq.toFixed(2);

        // Compute metrics
        const metrics = m.calcMetrics(s.id, s.iq, s.ud, s.uq);

        // Update Dashboard Text
        this.metricsDOM.id.textContent = `${metrics.id.toFixed(2)} A`;
        this.metricsDOM.iq.textContent = `${metrics.iq.toFixed(2)} A`;
        this.metricsDOM.Is.textContent = `${metrics.Is.toFixed(2)} A`;

        this.metricsDOM.ud.textContent = `${metrics.ud.toFixed(2)} V`;
        this.metricsDOM.uq.textContent = `${metrics.uq.toFixed(2)} V`;
        this.metricsDOM.Us.textContent = `${metrics.Us.toFixed(2)} V`;

        this.metricsDOM.Te.textContent = `${metrics.Te.toFixed(2)} N·m`;
        this.metricsDOM.Pin.textContent = `${metrics.Pin.toFixed(1)} W`;
        this.metricsDOM.Ploss.textContent = `${metrics.Ploss.toFixed(1)} W`;
        this.metricsDOM.Pmech.textContent = `${metrics.Pmech.toFixed(1)} W`;
        this.metricsDOM.pf.textContent = `${metrics.powerFactor.toFixed(3)}`;
        this.metricsDOM.pAngle.textContent = `${metrics.powerAngle.toFixed(1)}°`;

        // Limits Progress Bars
        this.metricsDOM.vPercent.textContent = `${metrics.voltageRatio.toFixed(1)}%`;
        this.metricsDOM.vBar.style.width = `${Math.min(100, metrics.voltageRatio)}%`;
        this.metricsDOM.vBar.className = `progress-fill ${metrics.isVoltageExceeded ? 'exceeded' : ''}`;

        this.metricsDOM.cPercent.textContent = `${metrics.currentRatio.toFixed(1)}%`;
        this.metricsDOM.cBar.style.width = `${Math.min(100, metrics.currentRatio)}%`;
        this.metricsDOM.cBar.className = `progress-fill ${metrics.isCurrentExceeded ? 'exceeded' : ''}`;

        // Warnings
        this.metricsDOM.alertVoltage.style.display = metrics.isVoltageExceeded ? 'inline-flex' : 'none';
        this.metricsDOM.alertCurrent.style.display = metrics.isCurrentExceeded ? 'inline-flex' : 'none';

        // ---------------- CURRENT PLANE CANVAS RENDER ----------------
        this.currentRenderer.drawGrid(m.Imax, 'A');
        
        // Current Limit Circle
        this.currentRenderer.drawLimitCircle(m.Imax, `Imax (${m.Imax}A)`, '#38bdf8');

        // Voltage Limit Ellipse in Current Plane
        const vEllipsePts = m.getVoltageLimitCurveInCurrentPlane();
        this.currentRenderer.drawCurve(vEllipsePts, `Umax Ellipse (${m.Umax.toFixed(1)}V)`, '#f59e0b', 'rgba(245, 158, 11, 0.08)');

        // Flux Center Point (-psif/Ld, 0)
        const fluxCenter = m.getVoltageEllipseCenterInCurrentPlane();
        this.currentRenderer.drawMarker(fluxCenter.id, fluxCenter.iq, `Center (-ψf/Ld)`, '#ef4444');

        // MTPA Curve
        const mtpaPts = m.getMTPACurve(m.Imax);
        this.currentRenderer.drawMTPA(mtpaPts, '#10b981');

        // MTPV Curve
        const mtpvPts = m.getMTPVCurve(m.Imax);
        this.currentRenderer.drawMTPV(mtpvPts, '#a855f7');

        // Torque Contours
        const torqueValues = m.getSuggestedTorqueLevels(5);
        const contours = m.getTorqueContours(torqueValues);
        this.currentRenderer.drawTorqueContours(contours);

        // Vector Is
        this.currentRenderer.drawVector(s.id, s.iq, 'Is', '#38bdf8', 'rgba(56, 189, 248, 0.3)', metrics.isCurrentExceeded);

        // ---------------- VOLTAGE PLANE CANVAS RENDER ----------------
        this.voltageRenderer.drawGrid(m.Umax, 'V');

        // Voltage Limit Circle
        this.voltageRenderer.drawLimitCircle(m.Umax, `Umax (${m.Umax.toFixed(1)}V)`, '#f59e0b');

        // Current Limit Ellipse in Voltage Plane
        const cEllipsePts = m.getCurrentLimitCurveInVoltagePlane();
        this.voltageRenderer.drawCurve(cEllipsePts, `Imax Mapped (${m.Imax}A)`, '#38bdf8', 'rgba(56, 189, 248, 0.08)');

        // Vector Us
        this.voltageRenderer.drawVector(s.ud, s.uq, 'Us', '#f59e0b', 'rgba(245, 158, 11, 0.3)', metrics.isVoltageExceeded);
    }
}

// Instantiate App when DOM Ready
window.addEventListener('DOMContentLoaded', () => {
    window.app = new MotorVectorApp();
});
