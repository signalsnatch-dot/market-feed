/**
 * ChartDrawings Class
 * Manages vector-accurate interactive SVG drawing tools overlayed on Lightweight Charts.
 * Enables zoom, pan, and scroll pass-through while keeping drawing nodes selectable.
 */
class ChartDrawings {
    constructor(marketChart) {
        this.marketChart = marketChart;
        this.drawings = [];
        this.currentTool = 'select'; // select, line, arrow, channel
        
        // Interaction States
        this.selectedId = null;
        this.drawingState = 'idle'; // idle, drawing-1, drawing-2
        this.tempPoints = {};
        
        this.dragMode = null; // null, 'move', 'handle-from', 'handle-to', 'handle-offset'
        this.dragStartPoint = null;
        this.dragSnapshot = null;
        
        this.copiedDrawing = null;
        
        this.initOverlay();
        this.setupKeyboardListeners();
    }

    initOverlay() {
        const chartElement = document.getElementById('main-chart');
        if (!chartElement) return;

        // Strip pre-existing overlays
        const oldOverlay = document.getElementById('drawing-overlay');
        if (oldOverlay) oldOverlay.remove();

        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.id = 'drawing-overlay';
        overlay.setAttribute('width', '100%');
        overlay.setAttribute('height', '100%');
        overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; z-index: 5;';
        
        overlay.innerHTML = `
            <g id="svg-shapes-layer"></g>
            <g id="svg-preview-layer"></g>
            <g id="svg-handles-layer"></g>
        `;
        
        chartElement.style.position = 'relative';
        chartElement.appendChild(overlay);
        this.overlay = overlay;

        // Event hooks
        overlay.addEventListener('pointerdown', this.onPointerDown.bind(this));
        overlay.addEventListener('pointermove', this.onPointerMove.bind(this));
        overlay.addEventListener('pointerup', this.onPointerUp.bind(this));
        
        this.setTool('select');
    }

    setTool(tool) {
        this.currentTool = tool;
        this.drawingState = 'idle';
        this.tempPoints = {};
        this.clearPreview();

        document.querySelectorAll('.draw-tool-btn').forEach(btn => {
            if (btn.id === 'clear-drawings-btn') return;
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        if (this.overlay) {
            // When tool is 'select', set overlay itself to 'none' so pan/scroll events bypass it to the chart canvas.
            // Child elements with pointer-events explicitly enabled will still capture clicks.
            this.overlay.style.pointerEvents = tool === 'select' ? 'none' : 'all';
            this.overlay.style.cursor = tool === 'select' ? 'default' : 'crosshair';
        }
    }

    setupKeyboardListeners() {
        window.addEventListener('keydown', (e) => {
            // Delete active drawing
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
                this.deleteDrawing(this.selectedId);
            }
            // Copy Shortcut
            if ((e.ctrlKey || e.metaKey) && e.key === 'c' && this.selectedId) {
                const drawing = this.drawings.find(d => d.id === this.selectedId);
                if (drawing) {
                    this.copiedDrawing = JSON.parse(JSON.stringify(drawing));
                }
            }
            // Paste Shortcut
            if ((e.ctrlKey || e.metaKey) && e.key === 'v' && this.copiedDrawing) {
                e.preventDefault();
                const duplicate = JSON.parse(JSON.stringify(this.copiedDrawing));
                duplicate.id = 'draw-' + Date.now();
                
                // Shift coordinates slightly to signify paste success
                duplicate.from.time += 600; 
                duplicate.to.time += 600;
                duplicate.from.price *= 1.002;
                duplicate.to.price *= 1.002;

                this.drawings.push(duplicate);
                this.selectedId = duplicate.id;
                this.render();
            }
        });
    }

    deleteDrawing(id) {
        this.drawings = this.drawings.filter(d => d.id !== id);
        if (this.selectedId === id) this.selectedId = null;
        this.render();
    }

    clearAll() {
        this.drawings = [];
        this.selectedId = null;
        this.render();
    }

    chartToScreen(coords) {
        if (!coords || !this.marketChart.chart || !this.marketChart.candleSeries) return null;
        const x = this.marketChart.chart.timeScale().timeToCoordinate(coords.time);
        const y = this.marketChart.candleSeries.priceToCoordinate(coords.price);
        if (x === null || y === null) return null;
        return { x, y };
    }

    screenToChart(point) {
        if (!point || !this.marketChart.chart || !this.marketChart.candleSeries) return null;
        const rect = this.overlay.getBoundingClientRect();
        const localX = point.clientX - rect.left;
        const localY = point.clientY - rect.top;
        
        const time = this.marketChart.chart.timeScale().coordinateToTime(localX);
        const price = this.marketChart.candleSeries.coordinateToPrice(localY);
        
        if (!time || typeof price !== 'number') return null;
        return { time, price, x: localX, y: localY };
    }

    onPointerDown(e) {
        const target = e.target;
        const chartPos = this.screenToChart(e);
        if (!chartPos) return;

        // 1. Handle Selection & Handle Dragging
        if (this.currentTool === 'select') {
            const handleType = target.getAttribute('data-handle');
            const targetId = target.getAttribute('data-id');

            if (handleType && targetId) {
                // Dragging a specific resizing node
                this.dragMode = `handle-${handleType}`;
                this.selectedId = targetId;
                const drawing = this.drawings.find(d => d.id === targetId);
                this.dragSnapshot = JSON.parse(JSON.stringify(drawing));
                this.dragStartPoint = { x: chartPos.x, y: chartPos.y, ...chartPos };
                return;
            }

            if (targetId) {
                // Dragging the main line body
                this.selectedId = targetId;
                this.dragMode = 'move';
                const drawing = this.drawings.find(d => d.id === targetId);
                this.dragSnapshot = JSON.parse(JSON.stringify(drawing));
                this.dragStartPoint = { x: chartPos.x, y: chartPos.y, ...chartPos };
                this.render();
                return;
            }

            // Clicked empty background
            this.selectedId = null;
            this.render();
            return;
        }

        // 2. Click-to-Draw Execution
        if (this.drawingState === 'idle') {
            this.tempPoints.from = { time: chartPos.time, price: chartPos.price };
            
            if (this.currentTool === 'channel') {
                this.drawingState = 'drawing-channel-line';
            } else {
                this.drawingState = 'drawing-line';
            }
        } else if (this.drawingState === 'drawing-line') {
            this.drawings.push({
                id: 'draw-' + Date.now(),
                type: this.currentTool,
                from: { ...this.tempPoints.from },
                to: { time: chartPos.time, price: chartPos.price },
                color: '#f9a825'
            });
            this.setTool('select');
            this.render();
        } else if (this.drawingState === 'drawing-channel-line') {
            this.tempPoints.to = { time: chartPos.time, price: chartPos.price };
            this.drawingState = 'drawing-channel-offset';
        } else if (this.drawingState === 'drawing-channel-offset') {
            const midTime = (this.tempPoints.from.time + this.tempPoints.to.time) / 2;
            const channelSlope = (this.tempPoints.to.price - this.tempPoints.from.price) / (this.tempPoints.to.time - this.tempPoints.from.time || 1);
            const anchorPrice = this.tempPoints.from.price + channelSlope * (midTime - this.tempPoints.from.time);
            const offsetPrice = chartPos.price - anchorPrice;

            this.drawings.push({
                id: 'draw-' + Date.now(),
                type: 'channel',
                from: { ...this.tempPoints.from },
                to: { ...this.tempPoints.to },
                offsetPrice: offsetPrice,
                color: '#f9a825'
            });
            this.setTool('select');
            this.render();
        }
    }

    onPointerMove(e) {
        const chartPos = this.screenToChart(e);
        if (!chartPos) return;

        // 1. Manage Active Drags
        if (this.dragMode && this.selectedId) {
            const drawing = this.drawings.find(d => d.id === this.selectedId);
            const snap = this.dragSnapshot;

            if (this.dragMode === 'move') {
                const deltaTime = chartPos.time - this.dragStartPoint.time;
                const deltaPrice = chartPos.price - this.dragStartPoint.price;
                
                drawing.from.time = snap.from.time + deltaTime;
                drawing.from.price = snap.from.price + deltaPrice;
                drawing.to.time = snap.to.time + deltaTime;
                drawing.to.price = snap.to.price + deltaPrice;
            } else if (this.dragMode === 'handle-from') {
                drawing.from.time = chartPos.time;
                drawing.from.price = chartPos.price;
            } else if (this.dragMode === 'handle-to') {
                drawing.to.time = chartPos.time;
                drawing.to.price = chartPos.price;
            } else if (this.dragMode === 'handle-offset') {
                const midTime = (drawing.from.time + drawing.to.time) / 2;
                const channelSlope = (drawing.to.price - drawing.from.price) / (drawing.to.time - drawing.from.time || 1);
                const anchorPrice = drawing.from.price + channelSlope * (midTime - drawing.from.time);
                drawing.offsetPrice = chartPos.price - anchorPrice;
            }
            this.render();
            return;
        }

        // 2. Manage Uncommitted Hover Preview Rendering
        if (this.drawingState !== 'idle') {
            this.drawPreview(chartPos);
        }
    }

    onPointerUp() {
        this.dragMode = null;
        this.dragStartPoint = null;
        this.dragSnapshot = null;
    }

    clearPreview() {
        const previewLayer = this.overlay?.querySelector('#svg-preview-layer');
        if (previewLayer) previewLayer.innerHTML = '';
    }

    drawPreview(chartPos) {
        const previewLayer = this.overlay.querySelector('#svg-preview-layer');
        previewLayer.innerHTML = '';

        const fromPt = this.chartToScreen(this.tempPoints.from);
        if (!fromPt) return;

        if (this.drawingState === 'drawing-line' || this.drawingState === 'drawing-channel-line') {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(fromPt.x));
            line.setAttribute('y1', String(fromPt.y));
            line.setAttribute('x2', String(chartPos.x));
            line.setAttribute('y2', String(chartPos.y));
            line.setAttribute('stroke', '#f9a825');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-dasharray', '4');
            previewLayer.appendChild(line);
        } else if (this.drawingState === 'drawing-channel-offset') {
            const toPt = this.chartToScreen(this.tempPoints.to);
            if (!toPt) return;

            const midTime = (this.tempPoints.from.time + this.tempPoints.to.time) / 2;
            const channelSlope = (this.tempPoints.to.price - this.tempPoints.from.price) / (this.tempPoints.to.time - this.tempPoints.from.time || 1);
            const anchorPrice = this.tempPoints.from.price + channelSlope * (midTime - this.tempPoints.from.time);
            const offsetPrice = chartPos.price - anchorPrice;

            const offsetFrom = this.chartToScreen({ time: this.tempPoints.from.time, price: this.tempPoints.from.price + offsetPrice });
            const offsetTo = this.chartToScreen({ time: this.tempPoints.to.time, price: this.tempPoints.to.price + offsetPrice });

            if (offsetFrom && offsetTo) {
                const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                poly.setAttribute('points', `${fromPt.x},${fromPt.y} ${toPt.x},${toPt.y} ${offsetTo.x},${offsetTo.y} ${offsetFrom.x},${offsetFrom.y}`);
                poly.setAttribute('fill', 'rgba(249, 168, 37, 0.15)');
                poly.setAttribute('stroke', '#f9a825');
                poly.setAttribute('stroke-width', '1.5');
                poly.setAttribute('stroke-dasharray', '4');
                previewLayer.appendChild(poly);
            }
        }
    }

    render() {
        if (!this.overlay) return;
        const shapesLayer = this.overlay.querySelector('#svg-shapes-layer');
        const handlesLayer = this.overlay.querySelector('#svg-handles-layer');

        shapesLayer.innerHTML = '';
        handlesLayer.innerHTML = '';

        this.drawings.forEach(drawing => {
            const fromPt = this.chartToScreen(drawing.from);
            const toPt = this.chartToScreen(drawing.to);
            if (!fromPt || !toPt) return;

            const color = drawing.color || '#f9a825';
            const isActive = drawing.id === this.selectedId;

            if (drawing.type === 'line' || drawing.type === 'arrow') {
                const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                
                // Wide invisible hit-area line for precise touch selection
                const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                hitLine.setAttribute('x1', String(fromPt.x));
                hitLine.setAttribute('y1', String(fromPt.y));
                hitLine.setAttribute('x2', String(toPt.x));
                hitLine.setAttribute('y2', String(toPt.y));
                hitLine.setAttribute('stroke', 'transparent');
                hitLine.setAttribute('stroke-width', '12');
                hitLine.setAttribute('cursor', 'pointer');
                hitLine.setAttribute('data-id', drawing.id);
                hitLine.setAttribute('pointer-events', 'stroke'); // Restores selectability under pointer-events: none
                group.appendChild(hitLine);

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', String(fromPt.x));
                line.setAttribute('y1', String(fromPt.y));
                line.setAttribute('x2', String(toPt.x));
                line.setAttribute('y2', String(toPt.y));
                line.setAttribute('stroke', color);
                line.setAttribute('stroke-width', isActive ? '3' : '2');
                if (isActive) line.setAttribute('stroke-dasharray', '3 3');
                line.setAttribute('pointer-events', 'none');
                group.appendChild(line);

                if (drawing.type === 'arrow') {
                    const arrow = this.createArrowHead(fromPt, toPt, color, isActive ? 14 : 10);
                    if (arrow) group.appendChild(arrow);
                }

                shapesLayer.appendChild(group);

                // Render handles if active
                if (isActive) {
                    this.renderHandle(handlesLayer, drawing.id, 'from', fromPt.x, fromPt.y);
                    this.renderHandle(handlesLayer, drawing.id, 'to', toPt.x, toPt.y);
                }
            } else if (drawing.type === 'channel') {
                const offsetFromCoords = { time: drawing.from.time, price: drawing.from.price + (drawing.offsetPrice || 0) };
                const offsetToCoords = { time: drawing.to.time, price: drawing.to.price + (drawing.offsetPrice || 0) };

                const offsetFrom = this.chartToScreen(offsetFromCoords);
                const offsetTo = this.chartToScreen(offsetToCoords);

                if (offsetFrom && offsetTo) {
                    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

                    // Closed polygon backdrop
                    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    poly.setAttribute('points', `${fromPt.x},${fromPt.y} ${toPt.x},${toPt.y} ${offsetTo.x},${offsetTo.y} ${offsetFrom.x},${offsetFrom.y}`);
                    poly.setAttribute('fill', isActive ? 'rgba(249, 168, 37, 0.22)' : 'rgba(249, 168, 37, 0.06)');
                    poly.setAttribute('cursor', 'pointer');
                    poly.setAttribute('data-id', drawing.id);
                    poly.setAttribute('pointer-events', 'fill'); // Restores selectability under pointer-events: none
                    group.appendChild(poly);

                    // Top channel vector
                    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line1.setAttribute('x1', String(fromPt.x));
                    line1.setAttribute('y1', String(fromPt.y));
                    line1.setAttribute('x2', String(toPt.x));
                    line1.setAttribute('y2', String(toPt.y));
                    line1.setAttribute('stroke', color);
                    line1.setAttribute('stroke-width', isActive ? '2.5' : '1.5');
                    line1.setAttribute('pointer-events', 'none');
                    group.appendChild(line1);

                    // Parallel offset vector
                    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line2.setAttribute('x1', String(offsetFrom.x));
                    line2.setAttribute('y1', String(offsetFrom.y));
                    line2.setAttribute('x2', String(offsetTo.x));
                    line2.setAttribute('y2', String(offsetTo.y));
                    line2.setAttribute('stroke', color);
                    line2.setAttribute('stroke-width', isActive ? '2.5' : '1.5');
                    line2.setAttribute('pointer-events', 'none');
                    group.appendChild(line2);

                    shapesLayer.appendChild(group);

                    if (isActive) {
                        this.renderHandle(handlesLayer, drawing.id, 'from', fromPt.x, fromPt.y);
                        this.renderHandle(handlesLayer, drawing.id, 'to', toPt.x, toPt.y);
                        
                        // Render handle directly in center of offset parallel boundary
                        const offsetMidX = (offsetFrom.x + offsetTo.x) / 2;
                        const offsetMidY = (offsetFrom.y + offsetTo.y) / 2;
                        this.renderHandle(handlesLayer, drawing.id, 'offset', offsetMidX, offsetMidY);
                    }
                }
            }
        });
    }

    renderHandle(layer, id, type, x, y) {
        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        handle.setAttribute('cx', String(x));
        handle.setAttribute('cy', String(y));
        handle.setAttribute('r', '5.5');
        handle.setAttribute('fill', '#ffffff');
        handle.setAttribute('stroke', '#2962FF');
        handle.setAttribute('stroke-width', '2');
        handle.setAttribute('cursor', 'pointer');
        handle.setAttribute('data-id', id);
        handle.setAttribute('data-handle', type);
        handle.setAttribute('pointer-events', 'all'); // Restores drag functionality under pointer-events: none
        layer.appendChild(handle);
    }

    createArrowHead(fromPt, toPt, color, size) {
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return null;

        const unitX = dx / len;
        const unitY = dy / len;
        
        const perpX = -unitY;
        const perpY = unitX;

        const tipX = toPt.x;
        const tipY = toPt.y; // Corrected typo: bypassed 'toPoint' validation
        
        const baseX = tipX - unitX * size;
        const baseY = tipY - unitY * size;

        const p1x = baseX + perpX * (size * 0.5);
        const p1y = baseY + perpY * (size * 0.5);
        const p2x = baseX - perpX * (size * 0.5);
        const p2y = baseY - perpY * (size * 0.5);

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', `${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`);
        polygon.setAttribute('fill', color);
        polygon.setAttribute('pointer-events', 'none');
        return polygon;
    }
}

window.ChartDrawings = ChartDrawings;