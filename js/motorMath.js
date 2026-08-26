/**
 * PMSM Motor Control dq-Axis Math Engine
 */

export class MotorMath {
    constructor(params = {}) {
        this.updateParams(params);
    }

    updateParams(p) {
        this.Rs = p.Rs !== undefined ? p.Rs : 0.5;          // Ohm
        this.Ld = p.Ld !== undefined ? p.Ld * 1e-3 : 0.010; // Convert mH to H
        this.Lq = p.Lq !== undefined ? p.Lq * 1e-3 : 0.015; // Convert mH to H
        this.psif = p.psif !== undefined ? p.psif : 0.175;  // Wb
        this.poles = p.poles !== undefined ? p.poles : 4;   // Pole pairs
        const requestedRpm = p.rpm !== undefined ? p.rpm : 1500;
        const requestedDirection = p.direction !== undefined
            ? p.direction
            : (requestedRpm < 0 ? -1 : 1);
        this.direction = requestedDirection < 0 ? -1 : 1;
        this.rpmMagnitude = Math.abs(requestedRpm);
        this.rpm = this.direction * this.rpmMagnitude;       // Signed speed RPM
        this.Umax = p.Umax !== undefined ? p.Umax : 150;    // Max Phase Voltage (V)
        this.Imax = p.Imax !== undefined ? p.Imax : 30;     // Max Phase Current (A)

        // Signed electrical angular speed (rad/s): positive forward, negative reverse
        this.omega_e = (this.poles * this.rpm * 2 * Math.PI) / 60;
    }

    /**
     * Solve Voltage Vector (Ud, Uq) from Current Vector (Id, Iq)
     */
    solveVoltage(id, iq) {
        const ud = this.Rs * id - this.omega_e * this.Lq * iq;
        const uq = this.Rs * iq + this.omega_e * (this.Ld * id + this.psif);
        return { ud, uq, Us: Math.hypot(ud, uq), thetaU: Math.atan2(uq, ud) };
    }

    /**
     * Solve Current Vector (Id, Iq) from Voltage Vector (Ud, Uq)
     */
    solveCurrent(ud, uq) {
        const D = this.Rs * this.Rs + this.omega_e * this.omega_e * this.Ld * this.Lq;
        if (D === 0) return { id: 0, iq: 0, Is: 0, thetaI: 0 };

        const id = (this.Rs * ud + this.omega_e * this.Lq * (uq - this.omega_e * this.psif)) / D;
        const iq = (this.Rs * (uq - this.omega_e * this.psif) - this.omega_e * this.Ld * ud) / D;
        return { id, iq, Is: Math.hypot(id, iq), thetaI: Math.atan2(iq, id) };
    }

    /**
     * Calculate Electromagnetic Torque Te
     */
    calcTorque(id, iq) {
        return 1.5 * this.poles * (this.psif * iq + (this.Ld - this.Lq) * id * iq);
    }

    /**
     * Calculate Power Metrics
     */
    calcMetrics(id, iq, ud, uq) {
        const Us = Math.hypot(ud, uq);
        const Is = Math.hypot(id, iq);
        const Te = this.calcTorque(id, iq);
        
        const Pin = 1.5 * (ud * id + uq * iq);
        const Ploss = 1.5 * this.Rs * (id * id + iq * iq);
        const Pmech = Pin - Ploss;
        const S = 1.5 * Us * Is;
        const powerFactor = S > 1e-6 ? Math.min(1.0, Math.max(-1.0, Pin / S)) : 1.0;
        const powerAngle = (Math.atan2(uq, ud) - Math.atan2(iq, id)) * (180 / Math.PI);
        const directionLabel = this.direction > 0 ? '正转' : '反转';
        const speedTorqueProduct = this.rpm * Te;
        let operationMode = '静止';
        if (Math.abs(this.rpm) > 1e-9 && Math.abs(Te) <= 1e-9) {
            operationMode = `${directionLabel}空载 / 零转矩`;
        } else if (Math.abs(this.rpm) > 1e-9) {
            operationMode = speedTorqueProduct > 0
                ? `${directionLabel}电动`
                : `${directionLabel}发电 / 制动`;
        }

        const isVoltageExceeded = Us > this.Umax + 1e-3;
        const isCurrentExceeded = Is > this.Imax + 1e-3;

        return {
            id, iq, Is,
            ud, uq, Us,
            Te,
            Pin, Ploss, Pmech,
            S,
            powerFactor,
            powerAngle,
            rpm: this.rpm,
            omega_e: this.omega_e,
            direction: this.direction,
            operationMode,
            isVoltageExceeded,
            isCurrentExceeded,
            voltageRatio: (Us / this.Umax) * 100,
            currentRatio: (Is / this.Imax) * 100
        };
    }

    /**
     * Voltage Limit Ellipse Center in Current Plane
     */
    getVoltageEllipseCenterInCurrentPlane() {
        return this.solveCurrent(0, 0);
    }

    /**
     * Sample Voltage Limit Curve points in Current Plane (id, iq)
     */
    getVoltageLimitCurveInCurrentPlane(samples = 120) {
        const points = [];
        for (let i = 0; i <= samples; i++) {
            const angle = (i / samples) * 2 * Math.PI;
            const ud = this.Umax * Math.cos(angle);
            const uq = this.Umax * Math.sin(angle);
            const curr = this.solveCurrent(ud, uq);
            points.push({ id: curr.id, iq: curr.iq, angle });
        }
        return points;
    }

    /**
     * Sample Current Limit Curve points in Voltage Plane (ud, uq)
     */
    getCurrentLimitCurveInVoltagePlane(samples = 120) {
        const points = [];
        for (let i = 0; i <= samples; i++) {
            const angle = (i / samples) * 2 * Math.PI;
            const id = this.Imax * Math.cos(angle);
            const iq = this.Imax * Math.sin(angle);
            const volt = this.solveVoltage(id, iq);
            points.push({ ud: volt.ud, uq: volt.uq, angle });
        }
        return points;
    }

    /**
     * Generate MTPA (Maximum Torque Per Ampere) curve in Current Plane
     */
    getMTPACurve(maxI = this.Imax, samples = 50, torqueDirection = this.direction) {
        const points = [];
        const isSPMSM = Math.abs(this.Ld - this.Lq) < 1e-6;
        const iqSign = torqueDirection < 0 ? -1 : 1;

        for (let i = 0; i <= samples; i++) {
            const iq = iqSign * (i / samples) * maxI * 1.2;
            let id = 0;
            if (!isSPMSM) {
                const diff = this.Ld - this.Lq; // < 0 for IPMSM
                const root = Math.hypot(this.psif, 2 * diff * iq);
                id = (-this.psif + root) / (2 * diff);
            }
            if (Math.hypot(id, iq) <= maxI * 1.5) {
                points.push({ id, iq });
            }
        }
        return points;
    }

    /**
     * Generate Constant Torque Contour curves in Current Plane
     */
    getTorqueContours(torques = [], idMin = -this.Imax * 1.8, idMax = this.Imax * 0.5, samples = 80) {
        const contours = [];
        const diff = this.Ld - this.Lq;

        for (const T of torques) {
            const pts = [];
            for (let i = 0; i <= samples; i++) {
                const id = idMin + (i / samples) * (idMax - idMin);
                const denom = 1.5 * this.poles * (this.psif + diff * id);
                if (Math.abs(denom) > 1e-5) {
                    const iq = T / denom;
                    if (Math.abs(iq) <= this.Imax * 2.0) {
                        pts.push({ id, iq });
                    }
                }
            }
            if (pts.length > 0) {
                contours.push({ T, points: pts });
            }
        }
        return contours;
    }
}
