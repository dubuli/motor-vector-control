/**
 * Interactive Dragging & Touch Handler for Vector Canvas
 */

export class VectorDragController {
    constructor(renderer, onDragCallback) {
        this.renderer = renderer;
        this.canvas = renderer.canvas;
        this.onDragCallback = onDragCallback;

        this.isDragging = false;
        this.currentPos = { x: 0, y: 0 };

        this.initEvents();
    }

    setVectorPosition(x, y) {
        this.currentPos = { x, y };
    }

    initEvents() {
        const c = this.canvas;

        c.addEventListener('mousedown', (e) => this.handleDown(e));
        c.addEventListener('mousemove', (e) => this.handleMove(e));
        window.addEventListener('mouseup', () => this.handleUp());

        c.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                this.handleDown(e.touches[0]);
                e.preventDefault();
            }
        }, { passive: false });

        c.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && this.isDragging) {
                this.handleMove(e.touches[0]);
                e.preventDefault();
            }
        }, { passive: false });

        window.addEventListener('touchend', () => this.handleUp());
    }

    getCanvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            px: e.clientX - rect.left,
            py: e.clientY - rect.top
        };
    }

    isOverHandle(px, py) {
        const handleScreen = this.renderer.toScreen(this.currentPos.x, this.currentPos.y);
        const dist = Math.hypot(px - handleScreen.px, py - handleScreen.py);
        return dist <= this.renderer.handleRadius + 8; // Extra padding for easy grab
    }

    handleDown(e) {
        const { px, py } = this.getCanvasPos(e);
        if (this.isOverHandle(px, py)) {
            this.isDragging = true;
            this.renderer.isHovered = true;
            this.canvas.style.cursor = 'grabbing';
        }
    }

    handleMove(e) {
        const { px, py } = this.getCanvasPos(e);
        const isHover = this.isOverHandle(px, py);

        if (isHover !== this.renderer.isHovered && !this.isDragging) {
            this.renderer.isHovered = isHover;
            this.canvas.style.cursor = isHover ? 'grab' : 'default';
        }

        if (this.isDragging) {
            const world = this.renderer.toWorld(px, py);
            this.currentPos = { x: world.x, y: world.y };
            if (this.onDragCallback) {
                this.onDragCallback(world.x, world.y);
            }
        }
    }

    handleUp() {
        if (this.isDragging) {
            this.isDragging = false;
            this.canvas.style.cursor = this.renderer.isHovered ? 'grab' : 'default';
        }
    }
}
