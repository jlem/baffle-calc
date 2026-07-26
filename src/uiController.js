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
    this.customBaffles = []; // Custom user baffles: [{ id, z_tube }]
    this.editingBaffleId = null;
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
    this.customBaffles = [];
    this.editingBaffleId = null;
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
    this.currentBaffleData = calculateBaffles(params, this.customBaffles);

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
    const calcCount = baffles.filter(b => !b.isCustom).length;
    const customCount = baffles.filter(b => b.isCustom).length;
    this.dom.baffleCountBadge.textContent = `${baffles.length} Total (${calcCount} Auto, ${customCount} Custom)`;

    const factor = this.unit === 'in' ? 1 / 25.4 : 1;
    const uLabel = this.unit === 'in' ? 'in' : 'mm';
    const p = this.precision;

    baffles.forEach(b => {
      const tr = document.createElement('tr');
      tr.dataset.baffleNumber = b.number;
      if (b.isCustom) tr.classList.add('custom-baffle-row');

      tr.addEventListener('mouseenter', () => {
        this.renderer.setHighlightBaffle(b.number);
        tr.classList.add('active-hover-row');
      });

      tr.addEventListener('mouseleave', () => {
        this.renderer.setHighlightBaffle(null);
        tr.classList.remove('active-hover-row');
      });

      if (b.isCustom && this.editingBaffleId === b.id) {
        // --- IN-LINE EDIT MODE ---
        tr.innerHTML = `
          <td>
            <span style="font-weight:bold; color:#c084fc;">Baffle #${b.number}</span>
            <span style="font-size:0.65rem; background:rgba(168,85,247,0.3); color:#e9d5ff; padding:1px 5px; border-radius:3px; margin-left:4px; border:1px solid #c084fc;">Editing</span>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:4px;">
              <input type="number" id="input_edit_${b.id}" value="${(b.z_tube * factor).toFixed(p)}" step="0.1" style="width:90px; padding:3px 6px; font-size:0.85rem; background:rgba(15,23,42,0.9); border:1px solid #c084fc; border-radius:4px; color:#fff;">
              <span style="font-size:0.8rem; color:var(--text-muted);">${uLabel}</span>
            </div>
          </td>
          <td style="color:var(--text-muted); font-size:0.82rem;">⌀ ${(b.aperture_diameter * factor).toFixed(p)} ${uLabel}</td>
          <td>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--text-muted); font-size:0.82rem;">${(b.wall_height * factor).toFixed(p)} ${uLabel}</span>
              <div style="display:flex; gap:6px;">
                <button class="btn-save-custom" data-id="${b.id}" style="padding:3px 8px; font-size:0.75rem; background:#10b981; color:#000; font-weight:700; border:none; border-radius:4px; cursor:pointer;">Save</button>
                <button class="btn-cancel-custom" style="padding:3px 8px; font-size:0.75rem; background:rgba(255,255,255,0.15); color:#fff; border:none; border-radius:4px; cursor:pointer;">Cancel</button>
              </div>
            </div>
          </td>
        `;

        setTimeout(() => {
          const editInput = tr.querySelector(`#input_edit_${b.id}`);
          const btnSave = tr.querySelector('.btn-save-custom');
          const btnCancel = tr.querySelector('.btn-cancel-custom');

          const handleSave = () => {
            if (editInput) {
              let newZDisplay = parseFloat(editInput.value);
              if (!isNaN(newZDisplay)) {
                let newZ_mm = this.unit === 'in' ? newZDisplay * 25.4 : newZDisplay;
                const target = this.customBaffles.find(cb => cb.id === b.id);
                if (target) target.z_tube = newZ_mm;
              }
            }
            this.editingBaffleId = null;
            this.update();
          };

          if (btnSave) btnSave.addEventListener('click', handleSave);
          if (btnCancel) btnCancel.addEventListener('click', () => {
            this.editingBaffleId = null;
            this.update();
          });
          if (editInput) {
            editInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') {
                this.editingBaffleId = null;
                this.update();
              }
            });
            editInput.focus();
            editInput.select();
          }
        }, 0);

      } else if (b.isCustom) {
        // --- DISPLAY MODE FOR CUSTOM BAFFLE ---
        tr.innerHTML = `
          <td>
            <span style="font-weight:bold; color:#c084fc;">Baffle #${b.number}</span>
            <span style="font-size:0.65rem; background:rgba(168,85,247,0.2); color:#c084fc; padding:1px 5px; border-radius:3px; margin-left:4px; border:1px solid rgba(168,85,247,0.4);">Custom</span>
          </td>
          <td style="font-weight:bold; color:var(--primary-cyan);">${(b.z_tube * factor).toFixed(p)} ${uLabel}</td>
          <td style="font-weight:bold; color:var(--accent-amber);">⌀ ${(b.aperture_diameter * factor).toFixed(p)} ${uLabel}</td>
          <td>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>${(b.wall_height * factor).toFixed(p)} ${uLabel}</span>
              <div style="display:flex; gap:4px;">
                <button class="btn-edit-custom" data-id="${b.id}" title="Edit Custom Baffle" style="background:none; border:none; color:#c084fc; cursor:pointer; font-size:0.85rem; padding:2px 4px;">✏️</button>
                <button class="btn-delete-custom" data-id="${b.id}" title="Delete Custom Baffle" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.85rem; padding:2px 4px;">🗑️</button>
              </div>
            </div>
          </td>
        `;

        setTimeout(() => {
          const btnEdit = tr.querySelector('.btn-edit-custom');
          const btnDelete = tr.querySelector('.btn-delete-custom');
          if (btnEdit) {
            btnEdit.addEventListener('click', (e) => {
              e.stopPropagation();
              this.editingBaffleId = b.id;
              this.update();
            });
          }
          if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
              e.stopPropagation();
              this.customBaffles = this.customBaffles.filter(cb => cb.id !== b.id);
              if (this.editingBaffleId === b.id) this.editingBaffleId = null;
              this.update();
            });
          }
        }, 0);

      } else {
        // --- NORMAL CALCULATED BAFFLE ---
        tr.innerHTML = `
          <td style="font-weight:bold; color:var(--accent-emerald);">Baffle #${b.number}</td>
          <td style="font-weight:bold; color:var(--primary-cyan);">${(b.z_tube * factor).toFixed(p)} ${uLabel}</td>
          <td style="font-weight:bold; color:var(--accent-amber);">⌀ ${(b.aperture_diameter * factor).toFixed(p)} ${uLabel}</td>
          <td>${(b.wall_height * factor).toFixed(p)} ${uLabel}</td>
        `;
      }

      tbody.appendChild(tr);
    });

    // --- ALWAYS APPEND PLACEHOLDER ROW AT THE BOTTOM ---
    const placeholderTr = document.createElement('tr');
    placeholderTr.className = 'placeholder-row';
    placeholderTr.style.background = 'rgba(168, 85, 247, 0.05)';
    placeholderTr.style.borderTop = '1px dashed rgba(168, 85, 247, 0.3)';

    placeholderTr.innerHTML = `
      <td>
        <span style="font-weight:bold; color:#c084fc; font-size:0.82rem;">+ Custom</span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:4px;">
          <input type="number" id="inputAddCustomZ" placeholder="Distance..." step="0.1" min="0" style="width:100px; padding:3px 6px; font-size:0.82rem; background:rgba(15,23,42,0.8); border:1px dashed #c084fc; border-radius:4px; color:#fff;">
          <span style="font-size:0.8rem; color:var(--text-muted);">${uLabel}</span>
        </div>
      </td>
      <td style="color:var(--text-muted); font-size:0.78rem; font-style:italic;">Auto-calculated</td>
      <td>
        <div style="display:flex; justify-content:flex-end;">
          <button id="btnAddCustomBaffle" class="btn" style="padding:3px 10px; font-size:0.78rem; background:rgba(168, 85, 247, 0.25); border:1px solid #c084fc; color:#e9d5ff; font-weight:600; cursor:pointer;">+ Add Baffle</button>
        </div>
      </td>
    `;

    tbody.appendChild(placeholderTr);

    // Bind Add Event
    const inputAdd = placeholderTr.querySelector('#inputAddCustomZ');
    const btnAdd = placeholderTr.querySelector('#btnAddCustomBaffle');

    const handleAdd = () => {
      if (!inputAdd) return;
      let valDisplay = parseFloat(inputAdd.value);
      if (!isNaN(valDisplay) && valDisplay >= 0) {
        let val_mm = this.unit === 'in' ? valDisplay * 25.4 : valDisplay;
        this.customBaffles.push({
          id: `custom_${Date.now()}`,
          z_tube: val_mm
        });
        inputAdd.value = '';
        this.update();
      }
    };

    if (btnAdd) btnAdd.addEventListener('click', handleAdd);
    if (inputAdd) {
      inputAdd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAdd();
      });
    }
  }
}
