/**
 * UI Controller
 * Handles inputs, events, unit switching, table population, and CAD benchmark reports.
 */

import { calculateBaffles } from './baffleEngine.js';
import { exportCSV, exportSVG, exportPNG } from './exportManager.js';

export class UIController {
  constructor(canvasRenderer) {
    this.renderer = canvasRenderer;
    this.unit = 'mm'; // 'mm' or 'in'
    this.precision = 1; // Default to 0.1mm (1 decimal place)
    this.currentBaffleData = null;
    this.updatePending = false;

    this._cacheDOM();
    this.resetToDefaults();
    this._bindEvents();
    this.update();
    
    // Auto-fit view after initialization
    setTimeout(() => {
      this.renderer.fitToView();
    }, 100);
  }

  resetToDefaults() {
    this.dom.inputDObj.value = 60;
    this.dom.inputFocalLength.value = 1200;
    this.dom.inputDTube.value = 67.3;
    this.dom.inputDField.value = 25;
    this.dom.inputLensOffset.value = -3;
    this.dom.inputTubeLength.value = 1008;
    this.dom.selectAlgorithm.value = 'strictZeroWall';
    this.dom.selectUnit.value = 'mm';
    if (this.dom.selectPrecision) this.dom.selectPrecision.value = '1';
    this.unit = 'mm';
    this.precision = 1;
  }

  requestUpdate() {
    if (!this.updatePending) {
      this.updatePending = true;
      requestAnimationFrame(() => {
        this.updatePending = false;
        this.update();
      });
    }
  }

  _cacheDOM() {
    this.dom = {
      // Inputs
      inputDObj: document.getElementById('inputDObj'),
      inputFocalLength: document.getElementById('inputFocalLength'),
      inputDTube: document.getElementById('inputDTube'),
      inputDField: document.getElementById('inputDField'),
      inputLensOffset: document.getElementById('inputLensOffset'),
      inputTubeLength: document.getElementById('inputTubeLength'),
      selectAlgorithm: document.getElementById('selectAlgorithm'),
      selectUnit: document.getElementById('selectUnit'),
      selectPrecision: document.getElementById('selectPrecision'),

      // Value Displays
      valDObj: document.getElementById('valDObj'),
      valFocalLength: document.getElementById('valFocalLength'),
      valDTube: document.getElementById('valDTube'),
      valDField: document.getElementById('valDField'),
      valLensOffset: document.getElementById('valLensOffset'),
      valTubeLength: document.getElementById('valTubeLength'),

      // Outputs
      baffleCountBadge: document.getElementById('baffleCountBadge'),
      baffleTableBody: document.querySelector('#baffleTable tbody'),

      // Buttons & Toggles
      btnReset: document.getElementById('btnReset'),
      btnExportCSV: document.getElementById('btnExportCSV'),
      btnExportSVG: document.getElementById('btnExportSVG'),
      btnExportPNG: document.getElementById('btnExportPNG'),
      btnFitView: document.getElementById('btnFitView'),

      chkLightCone: document.getElementById('chkLightCone'),
      chkRays: document.getElementById('chkRays'),
      chkBaffles: document.getElementById('chkBaffles'),
      chkLabels: document.getElementById('chkLabels'),
      chkGrid: document.getElementById('chkGrid')
    };
  }

  _bindEvents() {
    if (this.dom.btnReset) {
      this.dom.btnReset.addEventListener('click', () => {
        this.resetToDefaults();
        this.update();
        this.renderer.fitToView();
      });
    }

    const inputs = [
      this.dom.inputDObj,
      this.dom.inputFocalLength,
      this.dom.inputDTube,
      this.dom.inputDField,
      this.dom.inputLensOffset,
      this.dom.inputTubeLength,
      this.dom.selectAlgorithm
    ];

    inputs.forEach(input => {
      input.addEventListener('input', () => this.requestUpdate());
      input.addEventListener('change', () => this.requestUpdate());
    });

    this.dom.selectUnit.addEventListener('change', (e) => {
      this.unit = e.target.value;
      this.requestUpdate();
    });

    if (this.dom.selectPrecision) {
      this.dom.selectPrecision.addEventListener('change', (e) => {
        this.precision = parseInt(e.target.value, 10);
        this.requestUpdate();
      });
    }

    // Layer Toggles
    const toggles = [
      { element: this.dom.chkLightCone, key: 'lightCone' },
      { element: this.dom.chkRays, key: 'rays' },
      { element: this.dom.chkBaffles, key: 'baffles' },
      { element: this.dom.chkLabels, key: 'labels' },
      { element: this.dom.chkGrid, key: 'grid' }
    ];

    toggles.forEach(t => {
      t.element.addEventListener('change', () => {
        this.renderer.setToggles({ [t.key]: t.element.checked });
      });
    });

    this.dom.btnFitView.addEventListener('click', () => {
      this.renderer.fitToView();
    });

    // Register canvas hover callback to highlight table row
    this.renderer.onBaffleHover((baffleNum) => {
      this.highlightTableRow(baffleNum);
    });

    // Export Action Buttons
    this.dom.btnExportCSV.addEventListener('click', () => {
      exportCSV(this.currentBaffleData, this.unit, this.precision);
    });

    this.dom.btnExportSVG.addEventListener('click', () => {
      exportSVG(this.currentBaffleData, this.precision);
    });

    this.dom.btnExportPNG.addEventListener('click', () => {
      exportPNG(this.renderer.canvas);
    });
  }

  highlightTableRow(baffleNumber) {
    const rows = this.dom.baffleTableBody.querySelectorAll('tr');
    rows.forEach(tr => {
      if (baffleNumber !== null && tr.dataset.baffleNumber == baffleNumber) {
        tr.classList.add('active-hover-row');
      } else {
        tr.classList.remove('active-hover-row');
      }
    });
  }

  getInputs() {
    return {
      d_obj: parseFloat(this.dom.inputDObj.value) || 60,
      focal_length: parseFloat(this.dom.inputFocalLength.value) || 1200,
      d_tube: parseFloat(this.dom.inputDTube.value) || 67.3,
      d_field: parseFloat(this.dom.inputDField.value) || 25,
      lens_offset: parseFloat(this.dom.inputLensOffset.value) || -3,
      tube_length: parseFloat(this.dom.inputTubeLength.value) || 1008,
      algorithm: this.dom.selectAlgorithm.value
    };
  }

  update() {
    const params = this.getInputs();
    this.currentBaffleData = calculateBaffles(params);

    // Update value displays
    const uLabel = this.unit === 'in' ? 'in' : 'mm';
    const factor = this.unit === 'in' ? 1 / 25.4 : 1;
    const p = this.precision;

    this.dom.valDObj.textContent = `${(params.d_obj * factor).toFixed(p)} ${uLabel}`;
    this.dom.valFocalLength.textContent = `${(params.focal_length * factor).toFixed(p)} ${uLabel}`;
    this.dom.valDTube.textContent = `${(params.d_tube * factor).toFixed(p)} ${uLabel}`;
    this.dom.valDField.textContent = `${(params.d_field * factor).toFixed(p)} ${uLabel}`;
    this.dom.valLensOffset.textContent = `${(params.lens_offset * factor).toFixed(p)} ${uLabel}`;
    this.dom.valTubeLength.textContent = `${(params.tube_length * factor).toFixed(p)} ${uLabel}`;

    // Pass data and precision to canvas renderer
    this.renderer.setPrecision(p, this.unit);
    this.renderer.setData(this.currentBaffleData);

    // Populate Baffle Table
    this._renderTable();
  }

  _renderTable() {
    const tbody = this.dom.baffleTableBody;
    tbody.innerHTML = '';

    const baffles = this.currentBaffleData.baffles;
    this.dom.baffleCountBadge.textContent = `${baffles.length} Baffles Calculated`;

    const factor = this.unit === 'in' ? 1 / 25.4 : 1;
    const uLabel = this.unit === 'in' ? 'in' : 'mm';
    const p = this.precision;

    baffles.forEach(b => {
      const tr = document.createElement('tr');
      tr.dataset.baffleNumber = b.number;

      tr.addEventListener('mouseenter', () => {
        this.renderer.setHighlightBaffle(b.number);
        tr.classList.add('active-hover-row');
      });

      tr.addEventListener('mouseleave', () => {
        this.renderer.setHighlightBaffle(null);
        tr.classList.remove('active-hover-row');
      });

      tr.innerHTML = `
        <td style="font-weight:bold; color:var(--accent-emerald);">Baffle #${b.number}</td>
        <td style="font-weight:bold; color:var(--primary-cyan);">${(b.z_tube * factor).toFixed(p)} ${uLabel}</td>
        <td style="font-weight:bold; color:var(--accent-amber);">⌀ ${(b.aperture_diameter * factor).toFixed(p)} ${uLabel}</td>
        <td>${(b.wall_height * factor).toFixed(p)} ${uLabel}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}
