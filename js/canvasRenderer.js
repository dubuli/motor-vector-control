/**
 * Canvas Rendering Engine for Motor Vector Axis Visualization
 */

export class CanvasRenderer {
    constructor(canvas, type = 'current') {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.type = type; // 'current' or 'voltage'

        this.scale = 1.0;
        this.originX = 0;
        this.originY = 0;

        this.handleRadius = 8;
        this.isHovered = false;

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;
        this.width = rect.width || 400;
        this.height = rect.height || 400;

        this.canvas.width = this.width * this.dpr;
        this.canvas.height = this.height * this.dpr;
        this.ctx.scale(this.dpr, this.dpr);

        // Center origin
        this.originX = this.width / 2;
        this.originY = this.height / 2;
    }

    /**
     * Map physical coordinates (x, y) to canvas pixels (px, py)
     */
    toScreen(x, y) {
        return {
            px: this.originX + x * this.scale,
            py: this.originY - y * this.scale // Invert Y
        };
    }

    /**
     * Map canvas pixels (px, py) to physical coordinates (x, y)
     */
    toWorld(px, py) {
        return {
            x: (px - this.originX) / this.scale,
            y: (this.originY - py) / this.scale
        };
    }

    /**
     * Clear & Render background grid, axes
     */
    drawGrid(maxVal, unit = '') {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        // Calculate dynamic scale factor to fit maxVal nicely
        const margin = 0.8;
        this.scale = (Math.min(this.width, this.height) / 2 / (maxVal * 1.5)) * margin;

        // Draw background grid lines
        ctx.save();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        const step = this.getNiceStep(maxVal * 1.5);
        const startVal = Math.floor((-this.width / 2 / this.scale) / step) * step;
        const endVal = Math.ceil((this.width / 2 / this.scale) / step) * step;

        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Vertical grid lines (d values)
        for (let val = startVal; val <= endVal; val += step) {
            if (Math.abs(val) < 1e-4) continue;
            const { px } = this.toScreen(val, 0);
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, this.height);
            ctx.stroke();

            ctx.fillText(`${val}${unit}`, px, this.originY + 15);
        }

        // Horizontal grid lines (q values)
        for (let val = startVal; val <= endVal; val += step) {
            if (Math.abs(val) < 1e-4) continue;
            const { py } = this.toScreen(0, val);
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(this.width, py);
            ctx.stroke();

            ctx.fillText(`${val}${unit}`, this.originX - 25, py);
        }
        ctx.restore();

        // Main Axes (d-axis horizontal, q-axis vertical)
        ctx.save();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;

        // d-axis (X)
        ctx.beginPath();
        ctx.moveTo(0, this.originY);
        ctx.lineTo(this.width, this.originY);
        ctx.stroke();
        this.drawArrowHead(ctx, this.width - 5, this.originY, 0, '#94a3b8');

        // q-axis (Y)
        ctx.beginPath();
        ctx.moveTo(this.originX, this.height);
        ctx.lineTo(this.originX, 0);
        ctx.stroke();
        this.drawArrowHead(ctx, this.originX, 5, -Math.PI / 2, '#94a3b8');

        // Axis Labels
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`+d (${this.type === 'current' ? 'A' : 'V'})`, this.width - 40, this.originY - 15);
        ctx.fillText(`+q (${this.type === 'current' ? 'A' : 'V'})`, this.originX + 25, 15);
        ctx.restore();
    }

    getNiceStep(range) {
        const rawStep = range / 4;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const residual = rawStep / mag;
        if (residual > 5) return 10 * mag;
        if (residual > 2) return 5 * mag;
        if (residual > 1) return 2 * mag;
        return mag;
    }

    drawArrowHead(ctx, x, y, angle, color) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-8, -4);
        ctx.lineTo(-8, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /**
     * Render Limit Circle (e.g. Current Limit Imax or Voltage Limit Umax)
     */
    drawLimitCircle(radius, label, color = '#38bdf8') {
        const ctx = this.ctx;
        ctx.save();
        const { px, py } = this.toScreen(0, 0);
        const rPx = radius * this.scale;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(px, py, rPx, 0, 2 * Math.PI);
        ctx.stroke();

        // Glow effect
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(px, py, rPx, 0, 2 * Math.PI);
        ctx.stroke();

        // Label
        ctx.globalAlpha = 1.0;
        ctx.font = '11px sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(label, px + rPx * Math.cos(Math.PI / 4) + 6, py - rPx * Math.sin(Math.PI / 4));

        ctx.restore();
    }

    /**
     * Render Polygon / Parametric Curve (e.g., Voltage Ellipse or Mapped Ellipse)
     */
    drawCurve(points, label, strokeColor = '#f59e0b', fillColor = 'rgba(245, 158, 11, 0.08)') {
        if (!points || points.length === 0) return;
        const ctx = this.ctx;
        ctx.save();

        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            const x = pt.id !== undefined ? pt.id : pt.ud;
            const y = pt.iq !== undefined ? pt.iq : pt.uq;
            const { px, py } = this.toScreen(x, y);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();

        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        if (label && points.length > 0) {
            const firstPt = points[0];
            const x = firstPt.id !== undefined ? firstPt.id : firstPt.ud;
            const y = firstPt.iq !== undefined ? firstPt.iq : firstPt.uq;
            const { px, py } = this.toScreen(x, y);
            ctx.font = '11px sans-serif';
            ctx.fillStyle = strokeColor;
            ctx.fillText(label, px + 8, py);
        }

        ctx.restore();
    }

    /**
     * Draw Center Point Marker (e.g. Center of Voltage Limit Ellipse in Current Plane)
     */
    drawMarker(x, y, label, color = '#ef4444') {
        const ctx = this.ctx;
        ctx.save();
        const { px, py } = this.toScreen(x, y);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, 2 * Math.PI);
        ctx.stroke();

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(px - 7, py);
        ctx.lineTo(px + 7, py);
        ctx.moveTo(px, py - 7);
        ctx.lineTo(px, py + 7);
        ctx.stroke();

        ctx.font = '11px sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(label, px + 8, py - 8);
        ctx.restore();
    }

    /**
     * Draw MTPA Curve
     */
    drawMTPA(points, color = '#10b981') {
        if (!points || points.length < 2) return;
        const ctx = this.ctx;
        ctx.save();

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);

        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const { px, py } = this.toScreen(points[i].id, points[i].iq);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();

        const last = points[points.length - 1];
        const { px, py } = this.toScreen(last.id, last.iq);
        ctx.font = '11px sans-serif';
        ctx.fillStyle = color;
        ctx.fillText('MTPA', px + 6, py - 4);

        ctx.restore();
    }

    /**
     * Draw Torque Contours
     */
    drawTorqueContours(contours, color = 'rgba(148, 163, 184, 0.4)') {
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);

        for (const contour of contours) {
            if (contour.points.length < 2) continue;
            ctx.beginPath();
            for (let i = 0; i < contour.points.length; i++) {
                const { px, py } = this.toScreen(contour.points[i].id, contour.points[i].iq);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();

            const mid = contour.points[Math.floor(contour.points.length / 2)];
            const { px, py } = this.toScreen(mid.id, mid.iq);
            ctx.font = '9px sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(`${contour.T.toFixed(0)}Nm`, px + 4, py - 2);
        }

        ctx.restore();
    }

    /**
     * Draw Interactive Vector
     */
    drawVector(vx, vy, label, mainColor = '#38bdf8', secondaryColor = 'rgba(56, 189, 248, 0.25)', isOverLimit = false) {
        const ctx = this.ctx;
        ctx.save();

        const color = isOverLimit ? '#f43f5e' : mainColor;

        const { px: x0, py: y0 } = this.toScreen(0, 0);
        const { px: x1, py: y1 } = this.toScreen(vx, vy);

        // Dashed component projection lines to axes
        const { px: xProj, py: yProjZero } = this.toScreen(vx, 0);
        const { px: xProjZero, py: yProj } = this.toScreen(0, vy);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.globalAlpha = 0.5;

        // Projections
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(xProj, yProjZero);
        ctx.moveTo(x1, y1);
        ctx.lineTo(xProjZero, yProj);
        ctx.stroke();

        ctx.globalAlpha = 1.0;
        ctx.setLineDash([]);

        // Vector line
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        // Arrow head
        const angle = Math.atan2(y1 - y0, x1 - x0);
        this.drawArrowHead(ctx, x1, y1, angle, color);

        // Interactive Drag Handle Circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x1, y1, this.handleRadius, 0, 2 * Math.PI);
        ctx.fill();

        // Glowing outer handle ring when hovered/dragging
        if (this.isHovered) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x1, y1, this.handleRadius + 5, 0, 2 * Math.PI);
            ctx.stroke();
        }

        // Vector text badge
        const magnitude = Math.hypot(vx, vy);
        const deg = (Math.atan2(vy, vx) * 180 / Math.PI).toFixed(1);
        const unit = this.type === 'current' ? 'A' : 'V';

        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.fillStyle = color;
        const text = `${label}: ${magnitude.toFixed(1)}${unit} @ ${deg}°`;
        ctx.fillText(text, x1 + 12, y1 - 12);

        ctx.restore();
    }
}
