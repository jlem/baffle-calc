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
    
    // Data & Toggles
    this.baffleData = null;
    this.hoverInfo = null;
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

  setData(baffleData) {
    this.baffleData = baffleData;
    this.render();
  }

  setToggles(newToggles) {
    this.toggles = { ...this.toggles, ...newToggles };
    this.render();
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
    this.render();
  }

  _initEvents() {
    window.addEventListener('resize', () => this._handleResize());

    // Pan & Zoom mouse controls
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.panX = e.clientX - this.dragStart.x;
        this.panY = e.clientY - this.dragStart.y;
        this.render();
      } else {
        this._handleHover(e);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
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
      this.render();
    }, { passive: false });
  }

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  _handleHover(e) {
    if (!this.baffleData) return;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert mouse to optical coords
    const optZ = (mouseX - this.panX) / this.scale;
    const optY = (mouseY - this.panY) / this.scale;

    const { opticalBounds, baffles } = this.baffleData;
    const tubeFrontZ = opticalBounds.z_opt_tube_front;
    const tubeZ = optZ - tubeFrontZ;

    // Check if mouse is near a baffle
    let foundBaffle = null;
    for (const b of baffles) {
      const bZScreen = this.panX + b.z_opt * this.scale;
      if (Math.abs(mouseX - bZScreen) < 8) {
        foundBaffle = b;
        break;
      }
    }

    if (foundBaffle) {
      this.hoverInfo = {
        type: 'baffle',
        baffle: foundBaffle,
        screenX: mouseX,
        screenY: mouseY
      };
    } else if (optZ >= 0 && optZ <= opticalBounds.z_opt_focal_plane && Math.abs(optY) <= this.baffleData.lightCone.r_tube * 1.2) {
      this.hoverInfo = {
        type: 'point',
        optZ,
        tubeZ,
        optY,
        screenX: mouseX,
        screenY: mouseY
      };
    } else {
      this.hoverInfo = null;
    }

    this.render();
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

    // Lens Cell (Shaded gradient box)
    const lensCellWidth = Math.abs(xTubeFront - xLens) + 8;
    const lensCellX = Math.min(xLens, xTubeFront) - 4;
    const grad = ctx.createLinearGradient(lensCellX, 0, lensCellX + lensCellWidth, 0);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.1)');
    ctx.fillStyle = grad;
    ctx.fillRect(lensCellX, yTopLens - 5, lensCellWidth, (yBotLens - yTopLens) + 10);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(lensCellX, yTopLens - 5, lensCellWidth, (yBotLens - yTopLens) + 10);

    // Objective Lens Clear Aperture curve
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(xLens + 15, toY(0), Math.abs(yBotLens - yTopLens)/2, Math.PI * 0.7, Math.PI * 1.3);
    ctx.stroke();

    // Objective Lens Label
    if (this.toggles.labels) {
      ctx.fillStyle = '#00f0ff';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`Lens (${params.lens_offset > 0 ? '+' : ''}${params.lens_offset}mm)`, xLens - 35, yTopLens - 16);
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

    // Field spot highlight at focal plane
    ctx.strokeStyle = '#facc15'; // Bright yellow illuminated field spot
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(xFocal, yTopField);
    ctx.lineTo(xFocal, yBotField);
    ctx.stroke();

    if (this.toggles.labels) {
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText(`Illuminated Field (${params.d_field}mm)`, xFocal + 6, yTopField - 10);
    }

    // --- 4. Light Cone Layer ---
    if (this.toggles.lightCone) {
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

      rays.forEach((ray, idx) => {
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
    }

    // --- 6. Baffles Layer ---
    if (this.toggles.baffles) {
      baffles.forEach((b) => {
        const xBaffle = toX(b.z_opt);
        const yBaffleTop = toY(b.aperture_radius);
        const yBaffleBot = toY(-b.aperture_radius);

        // Top Baffle Vane (from wall to light cone)
        ctx.strokeStyle = '#00ff88'; // Vibrant emerald green
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(xBaffle, yTopWall);
        ctx.lineTo(xBaffle, yBaffleTop);
        ctx.stroke();

        // Bottom Baffle Vane
        ctx.beginPath();
        ctx.moveTo(xBaffle, yBotWall);
        ctx.lineTo(xBaffle, yBaffleBot);
        ctx.stroke();

        // Baffle Tip Dot
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.arc(xBaffle, yBaffleTop, 2.5, 0, Math.PI * 2);
        ctx.arc(xBaffle, yBaffleBot, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Baffle Number Label
        if (this.toggles.labels) {
          ctx.fillStyle = '#00ff88';
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.fillText(`B${b.number}`, xBaffle - 6, yTopWall - 8);
          ctx.font = '10px Inter, monospace';
          ctx.fillText(`${b.z_tube.toFixed(1)}mm`, xBaffle - 14, yBotWall + 18);
        }
      });
    }

    // --- 7. Hover Tooltip Overlay ---
    if (this.hoverInfo) {
      this._renderTooltip(ctx, width, height);
    }
  }

  _renderTooltip(ctx, width, height) {
    const info = this.hoverInfo;
    let title = '';
    let lines = [];

    if (info.type === 'baffle') {
      const b = info.baffle;
      title = `Baffle #${b.number}`;
      lines = [
        `Distance from Tube Front: ${b.z_tube.toFixed(3)} mm`,
        `Distance from Lens: ${b.z_opt.toFixed(3)} mm`,
        `Distance from Focal Plane: ${b.dist_from_focal_plane.toFixed(3)} mm`,
        `Aperture Diameter: ⌀ ${b.aperture_diameter.toFixed(3)} mm`,
        `Wall Vane Height: ${b.wall_height.toFixed(3)} mm`
      ];
    } else if (info.type === 'point') {
      title = `Coordinate Inspection`;
      lines = [
        `Distance from Tube Front: ${info.tubeZ.toFixed(2)} mm`,
        `Distance from Lens: ${info.optZ.toFixed(2)} mm`,
        `Height from Optical Axis: Y = ${info.optY.toFixed(2)} mm`
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
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(posX, posY, boxWidth, boxHeight, 6);
    ctx.fill();
    ctx.stroke();

    // Tooltip Header
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText(title, posX + padding, posY + padding + 12);

    // Tooltip Text Lines
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px Inter, monospace';
    lines.forEach((line, i) => {
      ctx.fillText(line, posX + padding, posY + padding + 30 + i * 18);
    });
  }
}
