/**
 * PMSM Motor Control dq-Axis Math Engine
 */

export class MotorMath {
    constructor(params = {}) {
        this.updateParams(params);
    }

    updateParams(p) {
        this.Rs = p.Rs !== undefined ? p.Rs : 0.02;           // Ohm
        this.Ld = p.Ld !== undefined ? p.Ld * 1e-3 : 0.0002;  // Convert mH to H
        this.Lq = p.Lq !== undefined ? p.Lq * 1e-3 : 0.00035; // Convert mH to H
        this.psif = p.psif !== undefined ? p.psif : 0.045;    // Wb
        this.poles = p.poles !== undefined ? p.poles : 4;   // Pole pairs
        const requestedRpm = p.rpm !== undefined ? p.rpm : 9000;
        const requestedDirection = p.direction !== undefined
            ? p.direction
            : (requestedRpm < 0 ? -1 : 1);
        this.direction = requestedDirection < 0 ? -1 : 1;
        this.rpmMagnitude = Math.abs(requestedRpm);
        this.rpm = this.direction * this.rpmMagnitude;       // Signed speed RPM
        if (p.Vdc !== undefined) {
            this.Vdc = p.Vdc;
            this.Umax = this.Vdc / Math.sqrt(3);             // SVPWM phase-voltage peak
        } else if (p.Umax !== undefined) {
            this.Umax = p.Umax;                              // Backward-compatible direct limit
            this.Vdc = this.Umax * Math.sqrt(3);
        } else {
            this.Vdc = 800;
            this.Umax = this.Vdc / Math.sqrt(3);
        }
        this.Imax = p.Imax !== undefined ? p.Imax : 500;     // Max Phase Current (A)

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
            Vdc: this.Vdc,
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
     * Generate the Maximum Torque Per Voltage trajectory in the current plane.
     * The standard high-speed expression neglects stator resistance.
     */
    getMTPVCurve(maxI = this.Imax, samples = 160, torqueDirection = this.direction) {
        const points = [];
        const iqSign = torqueDirection < 0 ? -1 : 1;
        const diff = this.Ld - this.Lq;
        const currentRange = maxI * 1.6;

        if (!(this.Ld > 0) || !(this.Lq > 0) || !(currentRange > 0)) return points;

        // For SPMSM, MTPV degenerates to the flux-cancellation vertical line.
        if (Math.abs(diff) < 1e-9) {
            const id = -this.psif / this.Ld;
            const maxIq = Math.sqrt(Math.max(0, currentRange * currentRange - id * id));
            for (let i = 0; i <= samples; i++) {
                points.push({ id, iq: iqSign * (i / samples) * maxIq });
            }
            return points;
        }

        for (let i = 0; i <= samples; i++) {
            const id = -currentRange + (2 * currentRange * i) / samples;
            const torqueFlux = this.psif + diff * id;
            const dAxisFlux = this.psif + this.Ld * id;
            const iqSquared = (this.Ld * dAxisFlux * torqueFlux) / (diff * this.Lq * this.Lq);

            if (iqSquared < -1e-9) continue;
            const iq = iqSign * Math.sqrt(Math.max(0, iqSquared));
            if (Math.hypot(id, iq) > currentRange + 1e-6) continue;
            if (iqSign * this.calcTorque(id, iq) < -1e-6) continue;
            points.push({ id, iq });
        }
        return points;
    }

    /**
     * Exact MTPA operating point for a specified current magnitude.
     */
    getMTPAPointAtCurrent(currentMagnitude = this.Imax, torqueDirection = this.direction) {
        const torqueSign = torqueDirection < 0 ? -1 : 1;
        const current = Math.abs(currentMagnitude);
        const diff = this.Ld - this.Lq;

        if (!(current > 0) || !(this.poles > 0)) {
            return { id: 0, iq: 0, Is: 0, T: 0 };
        }

        const candidates = [0];
        if (Math.abs(diff) > 1e-12) {
            const root = Math.sqrt(this.psif * this.psif + 8 * diff * diff * current * current);
            candidates.push(
                (-this.psif + root) / (4 * diff),
                (-this.psif - root) / (4 * diff)
            );
        }

        let bestPoint = null;
        let bestDirectedTorque = -Infinity;
        for (const id of candidates) {
            if (!Number.isFinite(id) || Math.abs(id) > current + 1e-9) continue;
            const iqMagnitude = Math.sqrt(Math.max(0, current * current - id * id));
            const torqueFlux = this.psif + diff * id;
            // Keep the normal PM-assisted branch. Continuing through zero
            // torque flux would reverse iq and create the unwanted mirrored
            // branch in the opposite q half-plane.
            if (!(torqueFlux > 1e-12)) continue;
            const iq = torqueSign * iqMagnitude;
            const T = this.calcTorque(id, iq);
            const directedTorque = torqueSign * T;
            if (directedTorque > bestDirectedTorque) {
                bestDirectedTorque = directedTorque;
                bestPoint = { id, iq, Is: current, T };
            }
        }
        return bestPoint || { id: 0, iq: torqueSign * current, Is: current, T: this.calcTorque(0, torqueSign * current) };
    }

    /**
     * Exact peak torque on the current-limit circle.
     */
    getCurrentLimitedPeakTorque(torqueDirection = this.direction) {
        return this.getMTPAPointAtCurrent(this.Imax, torqueDirection).T;
    }

    /**
     * Use evenly spaced current magnitudes on MTPA to obtain physically
     * meaningful torque levels. The final level is the exact Imax peak.
     */
    getSuggestedTorqueOperatingPoints(count = 5, torqueDirection = this.direction) {
        const levelCount = Math.max(0, Math.floor(count));
        if (!(this.Imax > 0) || levelCount === 0) return [];

        return Array.from(
            { length: levelCount },
            (_, index) => this.getMTPAPointAtCurrent(
                this.Imax * ((index + 1) / levelCount),
                torqueDirection
            )
        );
    }

    getSuggestedTorqueLevels(count = 5, torqueDirection = this.direction) {
        return this.getSuggestedTorqueOperatingPoints(count, torqueDirection).map(point => point.T);
    }

    getSuggestedTorqueContours(
        count = 5,
        torqueDirection = this.direction,
        idMin = -this.Imax * 1.6,
        idMax = this.Imax * 1.6,
        samples = 480
    ) {
        const anchors = this.getSuggestedTorqueOperatingPoints(count, torqueDirection);
        const contours = this.getTorqueContours(
            anchors.map(point => point.T),
            idMin,
            idMax,
            samples,
            anchors
        );
        contours.forEach((contour, index) => {
            contour.isPeak = index === contours.length - 1;
        });
        return contours;
    }

    /**
     * Generate Constant Torque Contour curves in Current Plane
     */
    getTorqueContours(
        torques = [],
        idMin = -this.Imax * 1.6,
        idMax = this.Imax * 1.6,
        samples = 480,
        anchors = []
    ) {
        const contours = [];
        const diff = this.Ld - this.Lq;
        const torqueConstant = 1.5 * this.poles;
        const iqLimit = this.Imax * 1.6;
        const fullSpan = idMax - idMin;

        if (!(torqueConstant > 0) || !(iqLimit > 0) || !(fullSpan > 0)) return contours;

        torques.forEach((T, torqueIndex) => {
            if (!Number.isFinite(T) || Math.abs(T) < 1e-12) return;

            let intervals = [];
            if (Math.abs(diff) < 1e-12) {
                const iq = T / (torqueConstant * this.psif);
                if (this.psif > 0 && Number.isFinite(iq) && Math.abs(iq) <= iqLimit + 1e-9) {
                    intervals = [[idMin, idMax]];
                }
            } else {
                // Draw only the PM-assisted branch where torque flux is
                // positive and iq has the requested torque sign. The algebraic
                // branch beyond zero torque flux reverses iq and is not part of
                // the normal motoring/generating operating region.
                const minimumFluxMagnitude = Math.abs(T) / (torqueConstant * iqLimit);
                const visibleBoundary = (minimumFluxMagnitude - this.psif) / diff;
                if (diff < 0) {
                    intervals = [[idMin, Math.min(idMax, visibleBoundary)]];
                } else {
                    intervals = [[Math.max(idMin, visibleBoundary), idMax]];
                }
            }

            const segments = [];
            for (const [startId, endId] of intervals) {
                if (!(endId > startId)) continue;
                const segmentSamples = Math.max(2, Math.ceil(samples * ((endId - startId) / fullSpan)));
                const segment = [];
                for (let i = 0; i <= segmentSamples; i++) {
                    const id = startId + (i / segmentSamples) * (endId - startId);
                    const denom = torqueConstant * (this.psif + diff * id);
                    const iq = T / denom;
                    if (Number.isFinite(iq) && Math.abs(iq) <= iqLimit + 1e-7) {
                        segment.push({ id, iq });
                    }
                }
                if (segment.length > 1) segments.push(segment);
            }

            const anchor = anchors[torqueIndex];
            if (anchor && Number.isFinite(anchor.id) && Number.isFinite(anchor.iq)) {
                const targetSegment = segments.find(segment => (
                    anchor.id >= segment[0].id - 1e-9 &&
                    anchor.id <= segment[segment.length - 1].id + 1e-9
                ));
                if (targetSegment) {
                    targetSegment.push({ id: anchor.id, iq: anchor.iq, isAnchor: true });
                    targetSegment.sort((a, b) => a.id - b.id);
                }
            }

            if (segments.length > 0) {
                const points = [];
                segments.forEach((segment, segmentIndex) => {
                    if (segmentIndex > 0) points.push(null);
                    points.push(...segment);
                });
                contours.push({ T, segments, points, anchor: anchor || null });
            }
        });
        return contours;
    }
}
