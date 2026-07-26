/**
 * UI Controller
 * Handles inputs, events, unit switching, table population, and CAD benchmark reports.
 */

import { calculateBaffles, validateAgainstBenchmark, DEFAULT_PRESETS } from './baffleEngine.js';
import { exportCSV, exportSVG, exportPNG } from './exportManager.js';

export class UIController {
  constructor(canvasRenderer) {
    this.renderer = canvasRenderer;
    this.unit = 'mm'; // 'mm' or 'in'
    this.currentBaffleData = null;

    this._cacheDOM();
    this._bindEvents();
    this._populatePresets();
    this.update();
    
    // Auto-fit view after initialization
    setTimeout(() => {
      this.renderer.fitToView();
    }, 100);
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
      presetSelect: document.getElementById('presetSelect'),

      // Value Displays
      valDObj: document.getElementById('valDObj'),
      valFocalLength: document.getElementById('valFocalLength'),
      valDTube: document.getElementById('valDTube'),
      valDField: document.getElementById('valDField'),
      valLensOffset: document.getElementById('valLensOffset'),
      valTubeLength: document.getElementById('valTubeLength'),

      // Outputs
      benchmarkBadge: document.getElementById('benchmarkBadge'),
      benchmarkReport: document.getElementById('benchmarkReport'),
      baffleCountBadge: document.getElementById('baffleCountBadge'),
      baffleTableBody: document.querySelector('#baffleTable tbody'),

      // Buttons & Toggles
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

  _populatePresets() {
    const select = this.dom.presetSelect;
    DEFAULT_PRESETS.forEach((preset, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = preset.name;
      select.appendChild(option);
    });

    select.value = 0; // Default to CAD benchmark preset
  }

  _bindEvents() {
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
      input.addEventListener('input', () => this.update());
      input.addEventListener('change', () => this.update());
    });

    this.dom.selectUnit.addEventListener('change', (e) => {
      this.unit = e.target.value;
      this.update();
    });

    this.dom.presetSelect.addEventListener('change', (e) => {
      const idx = e.target.value;
      if (idx !== '') {
        this.loadPreset(DEFAULT_PRESETS[idx]);
      }
    });

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

    // Export Action Buttons
    this.dom.btnExportCSV.addEventListener('click', () => {
      exportCSV(this.currentBaffleData, this.unit);
    });

    this.dom.btnExportSVG.addEventListener('click', () => {
      exportSVG(this.currentBaffleData);
    });

    this.dom.btnExportPNG.addEventListener('click', () => {
      exportPNG(this.renderer.canvas);
    });
  }

  loadPreset(preset) {
    this.dom.inputDObj.value = preset.d_obj;
    this.dom.inputFocalLength.value = preset.focal_length;
    this.dom.inputDTube.value = preset.d_tube;
    this.dom.inputDField.value = preset.d_field;
    this.dom.inputLensOffset.value = preset.lens_offset;
    this.dom.inputTubeLength.value = preset.tube_length;
    this.dom.selectAlgorithm.value = preset.algorithm;
    this.update();
    this.renderer.fitToView();
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

    this.dom.valDObj.textContent = `${(params.d_obj * factor).toFixed(1)} ${uLabel}`;
    this.dom.valFocalLength.textContent = `${(params.focal_length * factor).toFixed(0)} ${uLabel}`;
    this.dom.valDTube.textContent = `${(params.d_tube * factor).toFixed(1)} ${uLabel}`;
    this.dom.valDField.textContent = `${(params.d_field * factor).toFixed(1)} ${uLabel}`;
    this.dom.valLensOffset.textContent = `${(params.lens_offset * factor).toFixed(1)} ${uLabel}`;
    this.dom.valTubeLength.textContent = `${(params.tube_length * factor).toFixed(0)} ${uLabel}`;

    // Pass data to canvas renderer
    this.renderer.setData(this.currentBaffleData);

    // Populate Baffle Table
    this._renderTable();

    // Check CAD Benchmark
    this._renderBenchmarkReport();
  }

  _renderTable() {
    const tbody = this.dom.baffleTableBody;
    tbody.innerHTML = '';

    const baffles = this.currentBaffleData.baffles;
    this.dom.baffleCountBadge.textContent = `${baffles.length} Baffles Calculated`;

    const factor = this.unit === 'in' ? 1 / 25.4 : 1;
    const uLabel = this.unit === 'in' ? 'in' : 'mm';

    baffles.forEach(b => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:bold; color:var(--accent-emerald);">Baffle #${b.number}</td>
        <td style="font-weight:bold; color:var(--primary-cyan);">${(b.z_tube * factor).toFixed(3)} ${uLabel}</td>
        <td>${(b.z_opt * factor).toFixed(3)} ${uLabel}</td>
        <td>${(b.dist_from_focal_plane * factor).toFixed(3)} ${uLabel}</td>
        <td style="font-weight:bold; color:var(--accent-amber);">⌀ ${(b.aperture_diameter * factor).toFixed(3)} ${uLabel}</td>
        <td>⌀ ${(b.outer_diameter * factor).toFixed(3)} ${uLabel}</td>
        <td>${(b.wall_height * factor).toFixed(3)} ${uLabel}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  _renderBenchmarkReport() {
    // Only test benchmark when using the user's specific CAD parameters setup
    const validation = validateAgainstBenchmark(this.currentBaffleData.baffles);

    const badge = this.dom.benchmarkBadge;
    const reportContainer = this.dom.benchmarkReport;

    if (validation.passed) {
      badge.className = 'benchmark-badge';
      badge.innerHTML = `<span>✓ CAD Benchmark PASSED (5/5 Baffles &le; 0.1mm)</span>`;
    } else {
      badge.className = 'benchmark-badge failed';
      badge.innerHTML = `<span>⚠️ ${validation.message}</span>`;
    }

    // Populate Report Card
    let html = `<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.75rem;">
      Comparison with CAD-verified baseline parameters (60mm aperture, F1200mm, D67.3mm tube, 25mm field, -3mm lens offset):
    </div>`;

    html += `<div style="display:flex; flex-direction:column; gap:0.4rem;">`;

    validation.details.forEach(d => {
      const statusClass = d.passed ? 'pass' : 'fail';
      const statusIcon = d.passed ? '✓' : '✗';
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(15,23,42,0.6); padding:0.4rem 0.6rem; border-radius:6px; font-size:0.78rem;">
          <div>
            <strong>Baffle #${d.baffle}:</strong> ⌀${d.actual.d_baffle.toFixed(3)}mm @ ${d.actual.z_tube.toFixed(3)}mm
          </div>
          <div class="diff-tag ${statusClass}">
            ${statusIcon} Δz: ${d.z_diff.toFixed(3)}mm
          </div>
        </div>
      `;
    });

    html += `</div>`;
    reportContainer.innerHTML = html;
  }
}
