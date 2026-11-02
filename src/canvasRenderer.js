/**
 * Refractor Telescope Visualizer (Canvas 2D Renderer)
 * High-DPI interactive raytrace diagram with zoom, pan, hover inspection, and layer toggles.
 */

export class BaffleCanvasRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    
    // Viewport transform (zoom & pan)
    this.scale = 1;
    this.panX = 60;
    this.panY = 0;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.draggingBaffle = null;
    this.hoveredTip = null;
    
    // Data & Toggles
    this.baffleData = null;
    this.hoverInfo = null;
    this.renderPending = false;
    this.precision = 1;
    this.unit = 'mm';
    this.highlightBaffleNumber = null;
    this.onBaffleHoverCallback = null;
    this.onBaffleDragCallback = null;
    this.onBaffleAddCallback = null;
    this.onBaffleSnapCallback = null;
    this.lastWallAddInfo = null;
    this.lastReportedBaffleHover = null;
    this.toggles = {
      lightCone: true,
      rays: true,
      baffles: true,
      grid: true,
      labels: true,
      shadows: true
    };

    this._initEvents();
    this._handleResize();
  }

  setPrecision(precision, unit = 'mm') {
    this.precision = precision;
    this.unit = unit;
    this.requestRender();
  }

  setHighlightBaffle(baffleNumber) {
    if (this.highlightBaffleNumber !== baffleNumber) {
      this.highlightBaffleNumber = baffleNumber;
      this.requestRender();
    }
  }

  onBaffleHover(callback) {
    this.onBaffleHoverCallback = callback;
  }

  onBaffleDrag(callback) {
    this.onBaffleDragCallback = callback;
  }

  onBaffleAdd(callback) {
    this.onBaffleAddCallback = callback;
  }

  onBaffleSnap(callback) {
    this.onBaffleSnapCallback = callback;
  }

  requestRender() {
    if (!this.renderPending) {
      this.renderPending = true;
      requestAnimationFrame(() => {
        this.renderPending = false;
        this.render();
      });
    }
  }

  setData(baffleData) {
    this.baffleData = baffleData;
    this.requestRender();
  }

  setToggles(newToggles) {
    this.toggles = { ...this.toggles, ...newToggles };
    this.requestRender();
  }

  fitToView() {
    if (!this.baffleData) return;
    const { opticalBounds, lightCone } = this.baffleData;
    const minZ = Math.min(0, opticalBounds.z_opt_tube_front) - 20;
    const maxZ = opticalBounds.z_opt_focal_plane + 40;
    const totalLength = maxZ - minZ;
    const totalHeight = lightCone.r_tube * 2.6;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = (rect.width - 100) / totalLength;
    const scaleY = (rect.height - 80) / totalHeight;
    
    this.scale = Math.min(scaleX, scaleY);
    this.panX = 60 - minZ * this.scale;
    this.panY = rect.height / 2;
    this.requestRender();
  }

  _findBaffleTipAtScreenPos(mouseX, mouseY) {
    if (!this.baffleData || !this.toggles.baffles) return null;
    const { baffles } = this.baffleData;
    const hitRadius = 9;

    let bestHit = null;
    let bestDist = Infinity;
    for (const b of baffles) {
      if (!b.isCustom) continue;
      const xBaffle = this.panX + b.z_opt * this.scale;
      const yBaffleTop = this.panY - b.aperture_radius * this.scale;
      const yBaffleBot = this.panY + b.aperture_radius * this.scale;

      const distTop = Math.hypot(mouseX - xBaffle, mouseY - yBaffleTop);
      const distBot = Math.hypot(mouseX - xBaffle, mouseY - yBaffleBot);
      const chooseTop = Math.abs(distTop - distBot) < 0.01 ? (mouseY <= this.panY) : (distTop < distBot);

      if (chooseTop && distTop <= hitRadius && distTop < bestDist) {
        bestHit = { baffle: b, side: 'top' };
        bestDist = distTop;
      } else if (!chooseTop && distBot <= hitRadius && distBot < bestDist) {
        bestHit = { baffle: b, side: 'bottom' };
        bestDist = distBot;
      }
    }
    return bestHit;
  }

  _findTubeWallAtScreenPos(mouseX, mouseY) {
    if (!this.baffleData) return null;
    const { opticalBounds, lightCone } = this.baffleData;
    const optZ = (mouseX - this.panX) / this.scale;
    const tubeZ = optZ - opticalBounds.z_opt_tube_front;
    const tubeLength = opticalBounds.z_opt_tube_back - opticalBounds.z_opt_tube_front;

    if (tubeZ < 0 || tubeZ > tubeLength) return null;

    const yTopWall = this.panY - lightCone.r_tube * this.scale;
    const yBotWall = this.panY + lightCone.r_tube * this.scale;
    const distTop = Math.abs(mouseY - yTopWall);
    const distBot = Math.abs(mouseY - yBotWall);
    const wallHitThreshold = 9;

    if (distTop <= wallHitThreshold && distTop <= distBot) {
      return { side: 'top', z_tube: tubeZ };
    }
    if (distBot <= wallHitThreshold) {
      return { side: 'bottom', z_tube: tubeZ };
    }
    return null;
  }

  _findBaffleAtScreenPos(mouseX, mouseY) {
    if (!this.baffleData || !this.toggles.baffles) return null;
    const { baffles, lightCone } = this.baffleData;
    const yTopWall = this.panY - lightCone.r_tube * this.scale;
    const yBotWall = this.panY + lightCone.r_tube * this.scale;

    let bestBaffle = null;
    let bestDx = Infinity;
    for (const b of baffles) {
      const bZScreen = this.panX + b.z_opt * this.scale;
      const dx = Math.abs(mouseX - bZScreen);
      const onVane = dx < 8 && mouseY >= yTopWall - 6 && mouseY <= yBotWall + 6;
      const onTopLabel = this.toggles.labels && dx < 28 && mouseY >= yTopWall - 24 && mouseY <= yTopWall;
      const onBotLabel = this.toggles.labels && dx < 45 && mouseY >= yBotWall + 2 && mouseY <= yBotWall + 36;

      if ((onVane || onTopLabel || onBotLabel) && dx < bestDx) {
        bestBaffle = b;
        bestDx = dx;
      }
    }
    return bestBaffle;
  }

  _initEvents() {
    window.addEventListener('resize', () => this._handleResize(), { passive: true });

    // Hover is scoped ONLY to the canvas element itself
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isDragging && !this.draggingBaffle) {
        this._handleHover(e);
      }
    }, { passive: true });

    this.canvas.addEventListener('mouseleave', () => {
      if (this.draggingBaffle) return;
      if (this.hoverInfo !== null || this.hoveredTip !== null) {
        this.hoverInfo = null;
        this.hoveredTip = null;
        this.requestRender();
      }
      if (this.lastReportedBaffleHover !== null) {
        this.lastReportedBaffleHover = null;
        if (this.onBaffleHoverCallback) {
          this.onBaffleHoverCallback(null);
        }
      }
    }, { passive: true });

    // Dragging events (only attach window listeners during active drag)
    const onDragMove = (e) => {
      if (this.draggingBaffle) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const dx = mouseX - this.draggingBaffle.startMouseX;
        const dy = mouseY - this.draggingBaffle.startMouseY;

        // Horizontal drag changes position (z_tube).
        // Vertical drag follows the grabbed tip:
        // - Upper tip ('top'): dragging up (dy < 0) shrinks the upper vane (increases aperture diameter).
        // - Lower tip ('bottom'): dragging down (dy > 0) shrinks the lower vane (increases aperture diameter).
        const newZTube = this.draggingBaffle.startZTube + dx / this.scale;
        const sign = this.draggingBaffle.side === 'top' ? -1 : 1;
        const newDiameter = this.draggingBaffle.startDiameter + sign * 2 * (dy / this.scale);

        if (this.onBaffleDragCallback) {
          this.onBaffleDragCallback(this.draggingBaffle.id, newZTube, newDiameter, mouseX, mouseY);
        }
      } else if (this.isDragging) {
        this.panX = e.clientX - this.dragStart.x;
        this.panY = e.clientY - this.dragStart.y;
        this.requestRender();
      }
    };

    const onDragEnd = (e) => {
      if (this.draggingBaffle) {
        this.draggingBaffle = null;
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
        if (e) {
          this._handleHover(e);
        } else {
          this.canvas.style.cursor = 'crosshair';
        }
      } else if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'crosshair';
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
      }
    };

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 1. Check if clicking an existing custom baffle's tip dot
      const hitTip = this._findBaffleTipAtScreenPos(mouseX, mouseY);
      if (hitTip) {
        const hitBaffle = hitTip.baffle;
        this.draggingBaffle = {
          id: hitBaffle.id,
          side: hitTip.side,
          startMouseX: mouseX,
          startMouseY: mouseY,
          startZTube: hitBaffle.z_tube,
          startDiameter: hitBaffle.aperture_diameter
        };
        this.hoveredTip = { baffleId: hitBaffle.id, side: hitTip.side };
        this.isDragging = false;
        this.canvas.style.cursor = 'grabbing';
        this.setHighlightBaffle(hitBaffle.number);
        if (this.onBaffleHoverCallback) {
          this.onBaffleHoverCallback(hitBaffle.number);
        }
        window.addEventListener('mousemove', onDragMove, { passive: true });
        window.addEventListener('mouseup', onDragEnd, { passive: true });
        return;
      }

      // 2. Check if clicking on the top or bottom tube wall to add a new baffle & immediately drag its tip
      const hitWall = this._findTubeWallAtScreenPos(mouseX, mouseY);
      if (hitWall && this.onBaffleAddCallback) {
        const now = Date.now();
        if (this.lastWallAddInfo && (now - this.lastWallAddInfo.time) < 350 && Math.abs(mouseX - this.lastWallAddInfo.x) < 12) {
          return;
        }
        this.lastWallAddInfo = { time: now, x: mouseX, id: null };
        const createdBaffle = this.onBaffleAddCallback(hitWall.z_tube, 3, mouseX, mouseY);
        if (createdBaffle) {
          this.lastWallAddInfo.id = createdBaffle.id;
          this.draggingBaffle = {
            id: createdBaffle.id,
            side: hitWall.side,
            startMouseX: mouseX,
            startMouseY: mouseY,
            startZTube: createdBaffle.z_tube,
            startDiameter: createdBaffle.aperture_diameter
          };
          this.hoveredTip = { baffleId: createdBaffle.id, side: hitWall.side };
          this.isDragging = false;
          this.canvas.style.cursor = 'grabbing';
          this.setHighlightBaffle(createdBaffle.number);
          if (this.onBaffleHoverCallback) {
            this.onBaffleHoverCallback(createdBaffle.number);
          }
          window.addEventListener('mousemove', onDragMove, { passive: true });
          window.addEventListener('mouseup', onDragEnd, { passive: true });
          return;
        }
      }

      this.isDragging = true;
      this.dragStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      this.canvas.style.cursor = 'grabbing';
      window.addEventListener('mousemove', onDragMove, { passive: true });
      window.addEventListener('mouseup', onDragEnd, { passive: true });
    });

    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const hitTip = this._findBaffleTipAtScreenPos(mouseX, mouseY);
      if (hitTip && this.onBaffleSnapCallback) {
        this.onBaffleSnapCallback(hitTip.baffle.id, mouseX, mouseY);
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Zoom towards mouse
      this.panX = mouseX - (mouseX - this.panX) * zoomFactor;
      this.panY = mouseY - (mouseY - this.panY) * zoomFactor;
      this.scale *= zoomFactor;
      this.requestRender();
    }, { passive: false });
  }

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.requestRender();
  }

  _handleHover(e) {
    if (!this.baffleData) return;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert mouse to optical coords
    const optZ = (mouseX - this.panX) / this.scale;
    const optY = (mouseY - this.panY) / this.scale;

    const { opticalBounds, lightCone } = this.baffleData;
    const tubeFrontZ = opticalBounds.z_opt_tube_front;
    const tubeZ = optZ - tubeFrontZ;
    const yTopWall = this.panY - lightCone.r_tube * this.scale;
    const yBotWall = this.panY + lightCone.r_tube * this.scale;

    // Check if mouse is over a custom baffle's upper or lower tip dot (for dragging)
    const hitTip = this._findBaffleTipAtScreenPos(mouseX, mouseY);
    const hitWall = hitTip ? null : this._findTubeWallAtScreenPos(mouseX, mouseY);
    this.hoveredTip = hitTip ? { baffleId: hitTip.baffle.id, side: hitTip.side } : null;
    this.canvas.style.cursor = hitTip
      ? (hitTip.baffle.autoDiameter ? 'ew-resize' : 'move')
      : (hitWall ? 'copy' : 'crosshair');

    // Check if mouse is near a baffle vane or its top/bottom text labels (for hover inspection)
    const foundBaffle = hitTip ? hitTip.baffle : this._findBaffleAtScreenPos(mouseX, mouseY);

    const foundBaffleNumber = foundBaffle ? foundBaffle.number : null;
    if (this.lastReportedBaffleHover !== foundBaffleNumber) {
      this.lastReportedBaffleHover = foundBaffleNumber;
      if (this.onBaffleHoverCallback) {
        this.onBaffleHoverCallback(foundBaffleNumber);
      }
    }

    let newHover = null;
    if (foundBaffle) {
      newHover = {
        type: 'baffle',
        baffle: foundBaffle,
        screenX: mouseX,
        screenY: mouseY
      };
    } else {
      // Check if mouse is hovering over a red visible tube wall section
      const nearWallY = Math.abs(mouseY - yTopWall) < 10 || Math.abs(mouseY - yBotWall) < 10;
      const visibleSections = this.baffleData.visibleWallSections || [];
      const foundWallSection = nearWallY
        ? visibleSections.find(sec => optZ >= sec.z_opt_start && optZ <= sec.z_opt_end)
        : null;

      if (foundWallSection) {
        newHover = {
          type: 'visibleWall',
          section: foundWallSection,
          screenX: mouseX,
          screenY: mouseY
        };
      } else if (optZ >= 0 && optZ <= opticalBounds.z_opt_focal_plane && Math.abs(optY) <= this.baffleData.lightCone.r_tube * 1.2) {
        newHover = {
          type: 'point',
          optZ,
          tubeZ,
          optY,
          screenX: mouseX,
          screenY: mouseY
        };
      }
    }

    // Only trigger re-render if hover state or position changed significantly
    if (newHover !== null || this.hoverInfo !== null) {
      this.hoverInfo = newHover;
      this.requestRender();
    }
  }

  render() {
    const { ctx, canvas } = this;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Clear background (astronomical dark slate)
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width, height);

    if (!this.baffleData) return;

    const { opticalBounds, lightCone, baffles, rays, params } = this.baffleData;
    const { z_opt_lens, z_opt_tube_front, z_opt_tube_back, z_opt_focal_plane } = opticalBounds;
    const { r_obj, r_tube, r_field } = lightCone;

    // Helper functions for coordinate transformation
    const toX = (z_opt) => this.panX + z_opt * this.scale;
    const toY = (y_val) => this.panY - y_val * this.scale;

    // --- 1. Grid / Ruler Layer ---
    if (this.toggles.grid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      const step = 50 * Math.pow(10, Math.floor(Math.log10(100 / this.scale)));
      
      // Vertical grid lines (z_tube step)
      const startTubeZ = Math.floor(( (0 - this.panX) / this.scale - z_opt_tube_front ) / step) * step;
      const endTubeZ = Math.ceil(( (width - this.panX) / this.scale - z_opt_tube_front ) / step) * step;
      
      for (let zT = startTubeZ; zT <= endTubeZ; zT += step) {
        const zOpt = zT + z_opt_tube_front;
        const xScreen = toX(zOpt);
        ctx.beginPath();
        ctx.moveTo(xScreen, 0);
        ctx.lineTo(xScreen, height);
        ctx.stroke();

        // Label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.font = '10px Inter, monospace';
        ctx.fillText(`${zT}mm`, xScreen + 3, this.panY + toY(-r_tube * 1.4 - 15) * 0.1);
      }
    }

    // --- 2. Optical Axis ---
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this.panY);
    ctx.lineTo(width, this.panY);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- 3. Tube Wall & Lens Cell ---
    const xTubeFront = toX(z_opt_tube_front);
    const xTubeBack = toX(z_opt_tube_back);
    const yTopWall = toY(r_tube);
    const yBotWall = toY(-r_tube);
    const xLens = toX(z_opt_lens);
    const yTopLens = toY(r_obj);
    const yBotLens = toY(-r_obj);

    // Tube background shadow/fill
    if (this.toggles.shadows) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
      ctx.fillRect(xTubeFront, yTopWall, xTubeBack - xTubeFront, yBotWall - yTopWall);
    }

    // Main Tube Wall (outer lines)
    ctx.strokeStyle = '#38bdf8'; // Sky blue metallic outline
    ctx.lineWidth = 2;
    // Top wall
    ctx.beginPath();
    ctx.moveTo(xTubeFront, yTopWall);
    ctx.lineTo(xTubeBack, yTopWall);
    ctx.stroke();
    // Bottom wall
    ctx.beginPath();
    ctx.moveTo(xTubeFront, yBotWall);
    ctx.lineTo(xTubeBack, yBotWall);
    ctx.stroke();

    // Paint Visible / Exposed Tube Wall Sections in Red
    const visibleSections = this.baffleData.visibleWallSections || [];
    if (visibleSections.length > 0) {
      ctx.save();
      ctx.lineCap = 'butt';
      visibleSections.forEach((sec) => {
        const xStart = toX(sec.z_opt_start);
        const xEnd = toX(sec.z_opt_end);

        // Soft red glow halo
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.28)';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(xStart, yTopWall);
        ctx.lineTo(xEnd, yTopWall);
        ctx.moveTo(xStart, yBotWall);
        ctx.lineTo(xEnd, yBotWall);
        ctx.stroke();

        // Crisp red wall highlight
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(xStart, yTopWall);
        ctx.lineTo(xEnd, yTopWall);
        ctx.moveTo(xStart, yBotWall);
        ctx.lineTo(xEnd, yBotWall);
        ctx.stroke();
      });
      ctx.restore();
    }

    // Physical Tube Front Lip (Mechanical Origin marker)
    ctx.strokeStyle = '#f59e0b'; // Amber lip indicator
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(xTubeFront, yTopWall - 10);
    ctx.lineTo(xTubeFront, yBotWall + 10);
    ctx.stroke();

    // Mechanical Origin Label
    if (this.toggles.labels) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText('Tube Front (z = 0)', xTubeFront - 45, yTopWall - 16);
    }

    // --- Objective Lens (Flat Rectangle Stand-in) ---
    // The rear surface of the objective lens is at z_opt = 0 (xLensRear)
    const lensThickness = 15; // 15mm visual thickness for the objective lens assembly
    const xLensRear = toX(z_opt_lens);
    const xLensFront = toX(z_opt_lens - lensThickness);
    const lensRectWidth = Math.abs(xLensRear - xLensFront);

    // Lens Cell Outer Flange (Housing connecting lens to tube wall)
    const minCellX = Math.min(xLensFront, xTubeFront);
    const maxCellX = Math.max(xLensRear, xTubeFront);
    const cellWidth = maxCellX - minCellX;

    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.fillRect(minCellX, yTopWall, cellWidth, yBotWall - yTopWall);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(minCellX, yTopWall, cellWidth, yBotWall - yTopWall);

    // Lens Element (Flat Glass Block with rear surface aligned at z_opt = 0)
    ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.fillRect(xLensFront, yTopLens, lensRectWidth, yBotLens - yTopLens);

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(xLensFront, yTopLens, lensRectWidth, yBotLens - yTopLens);

    // Rear surface indicator line (bold line at z_opt = 0)
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(xLensRear, yTopLens);
    ctx.lineTo(xLensRear, yBotLens);
    ctx.stroke();

    // Objective Lens Label
    if (this.toggles.labels) {
      ctx.fillStyle = '#00f0ff';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`Lens Rear (${params.lens_offset > 0 ? '+' : ''}${params.lens_offset}mm)`, xLensFront - 10, yTopLens - 16);
    }

    // Focal Plane line
    const xFocal = toX(z_opt_focal_plane);
    const yTopField = toY(r_field);
    const yBotField = toY(-r_field);

    ctx.strokeStyle = '#e11d48'; // Rose red focal plane line
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xFocal, yTopWall + 15);
    ctx.lineTo(xFocal, yBotWall - 15);
    ctx.stroke();
    ctx.setLineDash([]);

    const hasLightCone = lightCone.hasLightCone !== false;

    if (hasLightCone) {
      // Field spot highlight at focal plane
      ctx.strokeStyle = '#facc15'; // Bright yellow illuminated field spot
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(xFocal, yTopField);
      ctx.lineTo(xFocal, yBotField);
      ctx.stroke();

      if (this.toggles.labels && params.d_field !== null) {
        const factor = this.unit === 'in' ? 1 / 25.4 : 1;
        const uLabel = this.unit === 'in' ? 'in' : 'mm';
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillText(`Illuminated Field (${(params.d_field * factor).toFixed(this.precision)}${uLabel})`, xFocal + 6, yTopField - 10);
      }
    }

    // --- 4. Light Cone Layer ---
    if (this.toggles.lightCone && hasLightCone) {
      // Light cone polygon fill
      ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(xLens, yTopLens);
      ctx.lineTo(xFocal, yTopField);
      ctx.lineTo(xFocal, yBotField);
      ctx.lineTo(xLens, yBotLens);
      ctx.closePath();
      ctx.fill();

      // Light cone boundary lines
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.7)';
      ctx.lineWidth = 1.5;
      // Top edge
      ctx.beginPath();
      ctx.moveTo(xLens, yTopLens);
      ctx.lineTo(xFocal, yTopField);
      ctx.stroke();
      // Bottom edge
      ctx.beginPath();
      ctx.moveTo(xLens, yBotLens);
      ctx.lineTo(xFocal, yBotField);
      ctx.stroke();
    }

    // --- 5. Ray Tracing Layer ---
    if (this.toggles.rays) {
      ctx.lineWidth = 1;

      // Draw red/amber field spot boundary rays
      rays.forEach((ray) => {
        const xStart = toX(ray.start.z_opt);
        const yStart = toY(ray.start.y);
        const xWall = toX(ray.wallHit.z_opt);
        const yWall = toY(ray.wallHit.y);
        const xHit = toX(ray.baffleHit.z_opt);
        const yHit = toY(ray.baffleHit.y);

        // Ray from field spot to wall/baffle
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)'; // Amber stray ray
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xStart, yStart);
        ctx.lineTo(xWall, yWall);
        ctx.stroke();

        // Highlight intersection hit point at light cone
        ctx.setLineDash([]);
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath();
        ctx.arc(xHit, yHit, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Green Dotted Reflection Rays (Berfield Minimum Baffle Method)
      if (this.baffleData.greenReflectionRays && this.baffleData.greenReflectionRays.length > 0) {
        this.baffleData.greenReflectionRays.forEach((gray) => {
          const xStart = toX(gray.start.z_opt);
          const yStart = toY(gray.start.y);
          const xWall = toX(gray.wallHit.z_opt);
          const yWall = toY(gray.wallHit.y);

          ctx.strokeStyle = '#00ff88'; // Bright green dotted ray
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 4]); // Dotted pattern
          ctx.beginPath();
          ctx.moveTo(xStart, yStart);
          ctx.lineTo(xWall, yWall);
          ctx.stroke();

          // Green hit point dot at tube wall
          ctx.setLineDash([]);
          ctx.fillStyle = '#00ff88';
          ctx.beginPath();
          ctx.arc(xWall, yWall, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // --- 6. Baffles Layer ---
    if (this.toggles.baffles) {
      baffles.forEach((b) => {
        const xBaffle = toX(b.z_opt);
        const yBaffleTop = toY(b.aperture_radius);
        const yBaffleBot = toY(-b.aperture_radius);

        const isHighlighted = (b.number === this.highlightBaffleNumber) || 
                              (this.hoverInfo && this.hoverInfo.type === 'baffle' && this.hoverInfo.baffle.number === b.number);
        const baseColor = b.isClipping ? '#ef4444' : (b.isCustom ? '#c084fc' : '#00ff88');
        const baffleColor = b.isClipping ? (isHighlighted ? '#f87171' : '#ef4444') : (isHighlighted ? '#f59e0b' : baseColor);
        const strokeWidth = isHighlighted ? 5 : 3.5;
        const dotRadius = isHighlighted ? (b.isCustom ? 4.5 : 4) : (b.isCustom ? 3.5 : 2.5);
        const activeTipSide = (this.draggingBaffle && this.draggingBaffle.id === b.id)
          ? this.draggingBaffle.side
          : ((this.hoveredTip && this.hoveredTip.baffleId === b.id) ? this.hoveredTip.side : null);

        // Top & Bottom Baffle Vanes
        ctx.strokeStyle = baffleColor;
        ctx.lineWidth = strokeWidth;
        ctx.beginPath();
        ctx.moveTo(xBaffle, yTopWall);
        ctx.lineTo(xBaffle, yBaffleTop);
        ctx.moveTo(xBaffle, yBotWall);
        ctx.lineTo(xBaffle, yBaffleBot);
        ctx.stroke();

        // Baffle Tip Dots
        ctx.fillStyle = baffleColor;
        ctx.beginPath();
        ctx.arc(xBaffle, yBaffleTop, dotRadius, 0, Math.PI * 2);
        ctx.arc(xBaffle, yBaffleBot, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        if (activeTipSide) {
          const activeY = activeTipSide === 'top' ? yBaffleTop : yBaffleBot;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(xBaffle, activeY, dotRadius + 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Baffle Label (Baffle # at top, 2-line centered diameter and @ distance at bottom)
        if (this.toggles.labels) {
          const factor = this.unit === 'in' ? 1 / 25.4 : 1;
          const uLabel = this.unit === 'in' ? 'in' : 'mm';
          const p = this.precision;
          const hasTriangle = Boolean(b.isClipping);

          // Top Badge
          ctx.font = 'bold 11px Inter, sans-serif';
          const topBadgeText = `B${b.number}`;
          if (hasTriangle) {
            const badgeWidth = ctx.measureText(topBadgeText).width;
            const iconSize = 11;
            const gap = 3;
            const totalW = iconSize + gap + badgeWidth;
            const startX = xBaffle - totalW / 2;
            this._drawWarningTriangle(ctx, startX + iconSize / 2, yTopWall - 12, iconSize, true);
            ctx.fillStyle = baffleColor;
            ctx.textAlign = 'left';
            ctx.fillText(topBadgeText, startX + iconSize + gap, yTopWall - 8);
          } else {
            ctx.fillStyle = baffleColor;
            ctx.textAlign = 'center';
            ctx.fillText(topBadgeText, xBaffle, yTopWall - 8);
          }

          // Bottom 2-Line Label
          ctx.font = '10px Inter, monospace';
          const diameterText = `${(b.aperture_diameter * factor).toFixed(p)}${uLabel}`;
          const distanceText = `@ ${(b.z_tube * factor).toFixed(p)}${uLabel}`;

          if (hasTriangle) {
            const diaWidth = ctx.measureText(diameterText).width;
            const iconSize = 11;
            const gap = 3;
            const totalW = iconSize + gap + diaWidth;
            const startX = xBaffle - totalW / 2;
            this._drawWarningTriangle(ctx, startX + iconSize / 2, yBotWall + 12, iconSize, true);
            ctx.fillStyle = baffleColor;
            ctx.textAlign = 'left';
            ctx.fillText(diameterText, startX + iconSize + gap, yBotWall + 16);
          } else {
            ctx.fillStyle = baffleColor;
            ctx.textAlign = 'center';
            ctx.fillText(diameterText, xBaffle, yBotWall + 16);
          }

          ctx.fillStyle = baffleColor;
          ctx.textAlign = 'center';
          ctx.fillText(distanceText, xBaffle, yBotWall + 28);

          // Reset text align for subsequent rendering
          ctx.textAlign = 'left';
        }
      });
    }

    // --- 7. Hover Tooltip Overlay ---
    if (this.hoverInfo) {
      this._renderTooltip(ctx, width, height);
    }
  }

  _drawWarningTriangle(ctx, cx, cy, size = 11, isError = false) {
    const h = size * 0.9;
    const halfW = size * 0.55;
    const topY = cy - h * 0.55;
    const botY = cy + h * 0.45;

    ctx.save();
    ctx.fillStyle = isError ? '#ef4444' : '#f59e0b';
    ctx.strokeStyle = isError ? '#f87171' : '#fbbf24';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.lineTo(cx + halfW, botY);
    ctx.lineTo(cx - halfW, botY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Exclamation mark inside triangle
    ctx.fillStyle = isError ? '#ffffff' : '#0b0f19';
    ctx.fillRect(cx - 0.8, topY + h * 0.28, 1.6, h * 0.36);
    ctx.beginPath();
    ctx.arc(cx, botY - h * 0.16, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _renderTooltip(ctx, width, height) {
    const info = this.hoverInfo;
    let title = '';
    let lines = [];
    let isError = false;
    const factor = this.unit === 'in' ? 1 / 25.4 : 1;
    const uLabel = this.unit === 'in' ? 'in' : 'mm';
    const p = this.precision;

    if (info.type === 'baffle') {
      const b = info.baffle;
      isError = Boolean(b.isClipping);
      title = isError ? `Baffle #${b.number} (Clips Light Cone)` : `Baffle #${b.number}`;
      lines = [
        `Distance from Tube Front: ${(b.z_tube * factor).toFixed(p)} ${uLabel}`,
        `Inner Diameter: ⌀ ${(b.aperture_diameter * factor).toFixed(p)} ${uLabel}`,
        `Wall Vane Height: ${(b.wall_height * factor).toFixed(p)} ${uLabel}`
      ];
      if (isError) {
        if (b.min_axial_diameter !== undefined) {
          lines.push(`Min Diameter for >0${uLabel} Field: > ⌀ ${(b.min_axial_diameter * factor).toFixed(p)} ${uLabel}`);
        }
        lines.push(`! Cannot compute illuminated field > 0${uLabel} (baffle aperture blocks on-axis light cone).`);
      }
    } else if (info.type === 'visibleWall') {
      isError = true;
      const sec = info.section;
      const isStrict = this.baffleData.params.algorithm === 'strictZeroWall';
      title = `Exposed Tube Wall (${isStrict ? 'Strict' : 'Minimum'} Strategy)`;
      lines = [
        `Exposed Span: ${(sec.z_tube_start * factor).toFixed(p)} – ${(sec.z_tube_end * factor).toFixed(p)} ${uLabel}`,
        `! Tube wall is visible from the fully illuminated field.`,
        `! Add a baffle or adjust an existing baffle to hide this section.`
      ];
    } else if (info.type === 'point') {
      title = `Coordinate Inspection`;
      lines = [
        `Distance from Tube Front: ${(info.tubeZ * factor).toFixed(p)} ${uLabel}`,
        `Distance from Lens: ${(info.optZ * factor).toFixed(p)} ${uLabel}`,
        `Height from Axis: Y = ${(info.optY * factor).toFixed(p)} ${uLabel}`
      ];
    }

    ctx.font = 'bold 12px Inter, sans-serif';
    const titleWidth = ctx.measureText(title).width;
    ctx.font = '11px Inter, monospace';
    const maxLineWidth = Math.max(titleWidth, ...lines.map(l => ctx.measureText(l).width));
    
    const padding = 10;
    const boxWidth = maxLineWidth + padding * 2;
    const boxHeight = (lines.length + 1) * 18 + padding;

    let posX = info.screenX + 15;
    let posY = info.screenY + 15;
    if (posX + boxWidth > width - 10) posX = info.screenX - boxWidth - 10;
    if (posY + boxHeight > height - 10) posY = info.screenY - boxHeight - 10;

    // Tooltip Card Box
    const borderColor = isError ? '#ef4444' : '#38bdf8';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(posX, posY, boxWidth, boxHeight, 6);
    ctx.fill();
    ctx.stroke();

    // Tooltip Header
    ctx.fillStyle = borderColor;
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText(title, posX + padding, posY + padding + 12);

    // Tooltip Text Lines
    ctx.font = '11px Inter, monospace';
    lines.forEach((line, i) => {
      ctx.fillStyle = line.startsWith('!') ? '#fca5a5' : '#e2e8f0';
      ctx.fillText(line, posX + padding, posY + padding + 30 + i * 18);
    });
  }
}
