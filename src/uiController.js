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
    this.fieldMode = 'specify'; // 'specify' or 'fromBaffles'
    this.specifiedDField = 25;
    this.lastManualDField = null;
    this.customBafflesSpecify = []; // Custom baffles in 'specify' mode: [{ id, z_tube, aperture_diameter?, autoDiameter }]
    this.manualBaffles = []; // Manual baffles in 'fromBaffles' mode: [{ id, z_tube, aperture_diameter, autoDiameter }]
    this.editingBaffleId = null;
    this.currentBaffleData = null;
    this.updatePending = false;
    this.isDebugMode = this._checkDebugUrlParam();

    this._cacheDOM();
    this._initDebugMode();
    this.resetToDefaults();
    this._bindEvents();
    this.update();
    
    // Auto-fit view after initialization
    setTimeout(() => {
      this.renderer.fitToView();
    }, 100);
  }

  _checkDebugUrlParam() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug')) {
      const val = (params.get('debug') || '').toLowerCase();
      return val !== 'false' && val !== '0';
    }
    if (params.has('debugMode')) {
      const val = (params.get('debugMode') || '').toLowerCase();
      return val !== 'false' && val !== '0';
    }
    return false;
  }

  _initDebugMode() {
    if (this.dom.debugCard) {
      this.dom.debugCard.style.display = this.isDebugMode ? 'block' : 'none';
    }
  }

  getActiveCustomBaffles() {
    return this.fieldMode === 'fromBaffles' ? this.manualBaffles : this.customBafflesSpecify;
  }

  setActiveCustomBaffles(list) {
    if (this.fieldMode === 'fromBaffles') {
      this.manualBaffles = list;
    } else {
      this.customBafflesSpecify = list;
    }
  }

  resetToDefaults() {
    this.dom.inputDObj.value = 60;
    this.dom.inputFocalLength.value = 1200;
    this.dom.inputDTube.value = 67.3;
    this.specifiedDField = 25;
    this.lastManualDField = null;
    this.dom.inputLensOffset.value = -3;
    this.dom.inputTubeLength.value = 1008;
    this.dom.selectAlgorithm.value = 'strictZeroWall';
    this.dom.selectUnit.value = 'mm';
    if (this.dom.selectPrecision) this.dom.selectPrecision.value = '1';
    this.unit = 'mm';
    this.precision = 1;
    this.customBafflesSpecify = [];
    this.manualBaffles = [];
    this.editingBaffleId = null;
    this.setFieldMode('specify', false);
    this.dom.inputDField.value = 25;
  }

  setFieldMode(mode, shouldUpdate = true) {
    if (mode === 'fromBaffles' && this.fieldMode === 'specify') {
      const currentVal = parseFloat(this.dom.inputDField.value);
      if (!isNaN(currentVal)) {
        this.specifiedDField = currentVal;
      }
    }

    this.fieldMode = mode;
    this.editingBaffleId = null;

    if (this.dom.fieldModeControl) {
      const buttons = this.dom.fieldModeControl.querySelectorAll('.segment-btn');
      buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });
    }

    if (mode === 'fromBaffles') {
      this.dom.inputDField.type = 'text';
      this.dom.inputDField.readOnly = true;
      this.dom.inputDField.classList.add('readonly-field');
    } else {
      this.dom.inputDField.type = 'number';
      this.dom.inputDField.readOnly = false;
      this.dom.inputDField.classList.remove('readonly-field');
      this.dom.inputDField.value = this.specifiedDField;
    }

    if (shouldUpdate) {
      this.update();
    }
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
      unitDField: document.getElementById('unitDField'),
      fieldModeControl: document.getElementById('fieldModeControl'),
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
      debugCard: document.getElementById('debugCard'),
      debugJsonOutput: document.getElementById('debugJsonOutput'),
      btnCopyDebugJson: document.getElementById('btnCopyDebugJson'),

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

    if (this.dom.fieldModeControl) {
      this.dom.fieldModeControl.querySelectorAll('.segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode;
          if (mode && mode !== this.fieldMode) {
            this.setFieldMode(mode, true);
          }
        });
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
      input.addEventListener('input', () => {
        if (input === this.dom.inputDField && this.fieldMode === 'fromBaffles') return;
        this.requestUpdate();
      });
      input.addEventListener('change', () => {
        if (input === this.dom.inputDField && this.fieldMode === 'fromBaffles') return;
        this.requestUpdate();
      });
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
        this._updateDebugView();
      });
    });

    this.dom.btnFitView.addEventListener('click', () => {
      this.renderer.fitToView();
    });

    // Register canvas hover callback to highlight table row
    this.renderer.onBaffleHover((baffleNum) => {
      this.highlightTableRow(baffleNum);
    });

    // Register canvas baffle drag callback for real-time position & diameter updates
    this.renderer.onBaffleDrag((baffleId, newZ_mm, newDia_mm, screenX, screenY) => {
      const activeList = this.getActiveCustomBaffles();
      const target = activeList.find(cb => cb.id === baffleId);
      if (!target) return;

      const params = this.getInputs();
      const clampedZ = Math.max(0, Math.min(params.tube_length, newZ_mm));
      const clampedDia = Math.max(0.1, Math.min(params.d_tube, newDia_mm));

      target.z_tube = clampedZ;
      if (!target.autoDiameter) {
        target.aperture_diameter = clampedDia;
      }
      if (this.editingBaffleId === baffleId) {
        this.editingBaffleId = null;
      }

      this.update();

      const updatedBaffle = this.currentBaffleData.baffles.find(b => b.id === baffleId);
      if (updatedBaffle) {
        this.renderer.lastReportedBaffleHover = updatedBaffle.number;
        this.renderer.setHighlightBaffle(updatedBaffle.number);
        this.highlightTableRow(updatedBaffle.number);
        this.renderer.hoverInfo = {
          type: 'baffle',
          baffle: updatedBaffle,
          screenX,
          screenY
        };
        this.renderer.requestRender();
      }
    });

    // Register canvas tube-wall click callback to place a new baffle and immediately drag its tip
    this.renderer.onBaffleAdd((z_tube_mm, vaneHeight_mm, screenX, screenY) => {
      const params = this.getInputs();
      const clampedZ = Math.max(0, Math.min(params.tube_length, z_tube_mm));
      const hasExistingCone = Boolean(
        this.currentBaffleData &&
        this.currentBaffleData.lightCone &&
        this.currentBaffleData.lightCone.hasLightCone
      );

      let initialDia;
      if (hasExistingCone) {
        const z_opt = clampedZ - params.lens_offset;
        const { r_obj, m_cone } = this.currentBaffleData.lightCone;
        const d_cone = 2 * (r_obj + m_cone * z_opt);
        initialDia = Math.max(0.1, Math.min(params.d_tube, d_cone));
      } else {
        initialDia = Math.max(0.1, Math.min(params.d_tube, params.d_tube - 2 * vaneHeight_mm));
      }

      const defaultAuto = this.fieldMode === 'specify';
      const newBaffle = {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        z_tube: clampedZ,
        aperture_diameter: initialDia,
        autoDiameter: defaultAuto
      };

      const activeList = this.getActiveCustomBaffles();
      activeList.push(newBaffle);
      this.editingBaffleId = null;
      this.update();

      const createdBaffle = this.currentBaffleData.baffles.find(b => b.id === newBaffle.id);
      if (createdBaffle) {
        this.renderer.lastReportedBaffleHover = createdBaffle.number;
        this.renderer.setHighlightBaffle(createdBaffle.number);
        this.highlightTableRow(createdBaffle.number);
        this.renderer.hoverInfo = {
          type: 'baffle',
          baffle: createdBaffle,
          screenX,
          screenY
        };
        this.renderer.requestRender();
      }
      return createdBaffle || null;
    });

    // Register double-click on drag handle to snap baffle diameter to existing light cone
    this.renderer.onBaffleSnap((baffleId, screenX, screenY) => {
      const activeList = this.getActiveCustomBaffles();
      const target = activeList.find(cb => cb.id === baffleId);
      if (!target) return;

      const params = this.getInputs();
      const z_opt_front = -params.lens_offset;
      const z_opt_target = target.z_tube + z_opt_front;
      let snappedDia = null;

      if (this.fieldMode === 'specify') {
        const b = this.currentBaffleData?.baffles.find(item => item.id === baffleId);
        if (b && b.expected_cone_diameter > 0) {
          snappedDia = b.expected_cone_diameter;
        }
      } else {
        // In Manual mode, check the light cone defined by the other baffles first (or current light cone)
        const otherBaffles = activeList.filter(cb => cb.id !== baffleId && !cb.autoDiameter);
        if (otherBaffles.length > 0) {
          const candidateFields = otherBaffles.map(cb => {
            const z_opt = Math.max(0.001, cb.z_tube + z_opt_front);
            return params.d_obj + (params.focal_length / z_opt) * (cb.aperture_diameter - params.d_obj);
          });
          const minOtherField = Math.min(...candidateFields);
          if (minOtherField > 0) {
            const r_obj = params.d_obj / 2;
            const r_field = minOtherField / 2;
            const m_cone = (r_field - r_obj) / params.focal_length;
            snappedDia = 2 * (r_obj + m_cone * z_opt_target);
          }
        } else if (this.currentBaffleData?.lightCone?.hasLightCone) {
          const { r_obj, m_cone } = this.currentBaffleData.lightCone;
          snappedDia = 2 * (r_obj + m_cone * z_opt_target);
        }
      }

      if (snappedDia !== null && snappedDia > 0) {
        target.aperture_diameter = Math.max(0.1, Math.min(params.d_tube, snappedDia));
        this.editingBaffleId = null;
        this.update();

        const updatedBaffle = this.currentBaffleData.baffles.find(b => b.id === baffleId);
        if (updatedBaffle) {
          this.renderer.lastReportedBaffleHover = updatedBaffle.number;
          this.renderer.setHighlightBaffle(updatedBaffle.number);
          this.highlightTableRow(updatedBaffle.number);
          this.renderer.hoverInfo = {
            type: 'baffle',
            baffle: updatedBaffle,
            screenX,
            screenY
          };
          this.renderer.requestRender();
        }
      }
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

    if (this.dom.btnCopyDebugJson) {
      this.dom.btnCopyDebugJson.addEventListener('click', () => {
        if (!this.dom.debugJsonOutput) return;
        navigator.clipboard.writeText(this.dom.debugJsonOutput.value).then(() => {
          const origText = this.dom.btnCopyDebugJson.textContent;
          this.dom.btnCopyDebugJson.textContent = '✅ Copied!';
          setTimeout(() => {
            this.dom.btnCopyDebugJson.textContent = origText;
          }, 1500);
        });
      });
    }
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
    if (this.fieldMode === 'specify') {
      const parsedField = parseFloat(this.dom.inputDField.value);
      if (!isNaN(parsedField)) {
        this.specifiedDField = parsedField;
      }
    }
    return {
      d_obj: parseFloat(this.dom.inputDObj.value) || 60,
      focal_length: parseFloat(this.dom.inputFocalLength.value) || 1200,
      d_tube: parseFloat(this.dom.inputDTube.value) || 67.3,
      d_field: this.specifiedDField,
      fallback_d_field: this.lastManualDField,
      fieldMode: this.fieldMode,
      lens_offset: parseFloat(this.dom.inputLensOffset.value) || -3,
      tube_length: parseFloat(this.dom.inputTubeLength.value) || 1008,
      algorithm: this.dom.selectAlgorithm.value
    };
  }

  update() {
    const params = this.getInputs();
    this.currentBaffleData = calculateBaffles(params, this.getActiveCustomBaffles());
    if (this.fieldMode === 'fromBaffles' && this.currentBaffleData.params.d_field > 0) {
      this.lastManualDField = this.currentBaffleData.params.d_field;
    }

    // Update value displays
    const uLabel = this.unit === 'in' ? 'in' : 'mm';
    const factor = this.unit === 'in' ? 1 / 25.4 : 1;
    const p = this.precision;

    this.dom.valDObj.textContent = `${(params.d_obj * factor).toFixed(p)} ${uLabel}`;
    this.dom.valFocalLength.textContent = `${(params.focal_length * factor).toFixed(p)} ${uLabel}`;
    this.dom.valDTube.textContent = `${(params.d_tube * factor).toFixed(p)} ${uLabel}`;
    this.dom.valLensOffset.textContent = `${(params.lens_offset * factor).toFixed(p)} ${uLabel}`;
    this.dom.valTubeLength.textContent = `${(params.tube_length * factor).toFixed(p)} ${uLabel}`;

    if (this.dom.unitDField) {
      this.dom.unitDField.textContent = uLabel;
    }

    if (this.fieldMode === 'fromBaffles') {
      const computedDField = this.currentBaffleData.params.d_field;
      const isClipped = this.currentBaffleData.params.isClippedField;
      if (isClipped) {
        this.dom.inputDField.value = `≤ ${(0).toFixed(p)} (Clipped)`;
        this.dom.inputDField.style.color = '#ef4444';
        this.dom.inputDField.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        this.dom.valDField.textContent = `≤ ${(0).toFixed(p)} ${uLabel}`;
        this.dom.valDField.style.color = '#ef4444';
      } else if (computedDField !== null && computedDField !== undefined) {
        const formattedField = (computedDField * factor).toFixed(p);
        this.dom.inputDField.value = formattedField;
        this.dom.inputDField.style.color = '';
        this.dom.inputDField.style.borderColor = '';
        this.dom.valDField.textContent = `${formattedField} ${uLabel}`;
        this.dom.valDField.style.color = '';
      } else {
        this.dom.inputDField.value = '— (Add Baffles)';
        this.dom.inputDField.style.color = '';
        this.dom.inputDField.style.borderColor = '';
        this.dom.valDField.textContent = '—';
        this.dom.valDField.style.color = '';
      }
    } else {
      this.dom.inputDField.style.color = '';
      this.dom.inputDField.style.borderColor = '';
      this.dom.valDField.style.color = '';
      this.dom.valDField.textContent = `${(params.d_field * factor).toFixed(p)} ${uLabel}`;
    }

    // Pass data and precision to canvas renderer
    this.renderer.setPrecision(p, this.unit);
    this.renderer.setData(this.currentBaffleData);

    // Populate Baffle Table
    this._renderTable();

    // Update Debug JSON View if active
    this._updateDebugView();
  }

  _updateDebugView() {
    if (!this.isDebugMode || !this.dom.debugJsonOutput || !this.currentBaffleData) return;

    const { params, opticalBounds, lightCone, baffles, visibleWallSections = [] } = this.currentBaffleData;
    const debugState = {
      configuration: {
        unit: this.unit,
        precision: this.precision,
        algorithm: params.algorithm,
        fieldMode: this.fieldMode,
        layerToggles: { ...this.renderer.toggles }
      },
      opticalGeometry: {
        d_obj_mm: params.d_obj,
        focal_length_mm: params.focal_length,
        d_field_specified_mm: this.specifiedDField,
        d_field_effective_mm: params.d_field,
        isClippedField: Boolean(params.isClippedField)
      },
      mechanicalGeometry: {
        d_tube_mm: params.d_tube,
        lens_offset_mm: params.lens_offset,
        tube_length_mm: params.tube_length
      },
      opticalBounds,
      lightCone,
      visibleWallSections: visibleWallSections.map(s => ({
        z_tube_start_mm: Number(s.z_tube_start.toFixed(4)),
        z_tube_end_mm: Number(s.z_tube_end.toFixed(4)),
        z_opt_start_mm: Number(s.z_opt_start.toFixed(4)),
        z_opt_end_mm: Number(s.z_opt_end.toFixed(4))
      })),
      baffles: baffles.map(b => ({
        number: b.number,
        id: b.id,
        isCustom: b.isCustom,
        autoDiameter: Boolean(b.autoDiameter),
        z_tube_mm: Number(b.z_tube.toFixed(4)),
        z_opt_mm: Number(b.z_opt.toFixed(4)),
        aperture_diameter_mm: Number(b.aperture_diameter.toFixed(4)),
        wall_height_mm: Number(b.wall_height.toFixed(4)),
        isClipping: Boolean(b.isClipping),
        expected_cone_diameter_mm: b.expected_cone_diameter !== undefined ? Number(b.expected_cone_diameter.toFixed(4)) : undefined,
        min_axial_diameter_mm: b.min_axial_diameter !== undefined ? Number(b.min_axial_diameter.toFixed(4)) : undefined
      }))
    };

    this.dom.debugJsonOutput.value = JSON.stringify(debugState, null, 2);
  }

  _renderTable() {
    const tbody = this.dom.baffleTableBody;
    tbody.innerHTML = '';

    const baffles = this.currentBaffleData.baffles;
    const calcCount = baffles.filter(b => !b.isCustom).length;
    const customCount = baffles.filter(b => b.isCustom).length;
    const clippingCount = baffles.filter(b => b.isClipping).length;

    if (this.fieldMode === 'fromBaffles') {
      const statusSuffix = clippingCount > 0 ? ` (${clippingCount} Clipping)` : '';
      this.dom.baffleCountBadge.textContent = `${baffles.length} Manual Baffle${baffles.length === 1 ? '' : 's'}${statusSuffix}`;
      this.dom.baffleCountBadge.style.color = clippingCount > 0 ? '#ef4444' : 'var(--accent-emerald)';
    } else {
      this.dom.baffleCountBadge.textContent = `${baffles.length} Total (${calcCount} Auto, ${customCount} Custom)`;
      this.dom.baffleCountBadge.style.color = clippingCount > 0 ? '#ef4444' : 'var(--accent-emerald)';
    }

    const factor = this.unit === 'in' ? 1 / 25.4 : 1;
    const uLabel = this.unit === 'in' ? 'in' : 'mm';
    const p = this.precision;

    baffles.forEach(b => {
      const tr = document.createElement('tr');
      tr.dataset.baffleNumber = b.number;
      if (b.isClipping) {
        tr.classList.add('clipping-baffle-row');
      } else if (b.isCustom) {
        tr.classList.add('custom-baffle-row');
      }
      if (this.renderer.highlightBaffleNumber === b.number) {
        tr.classList.add('active-hover-row');
      }

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
              <input type="number" id="input_edit_z_${b.id}" value="${(b.z_tube * factor).toFixed(p)}" step="0.1" style="width:90px; padding:3px 6px; font-size:0.85rem; background:rgba(15,23,42,0.9); border:1px solid #c084fc; border-radius:4px; color:#fff;">
              <span style="font-size:0.8rem; color:var(--text-muted);">${uLabel}</span>
            </div>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="color:var(--accent-amber);">⌀</span>
              <input type="number" id="input_edit_dia_${b.id}" value="${(b.aperture_diameter * factor).toFixed(p)}" step="0.1" ${b.autoDiameter ? 'disabled' : ''} style="width:90px; padding:3px 6px; font-size:0.85rem; background:rgba(15,23,42,0.9); border:1px solid #c084fc; border-radius:4px; color:#fff; opacity:${b.autoDiameter ? '0.5' : '1'};">
              <span style="font-size:0.8rem; color:var(--text-muted);">${uLabel}</span>
              <label title="Keep baffle diameter automatically snapped to the light cone" style="display:inline-flex; align-items:center; gap:3px; font-size:0.75rem; color:#c084fc; cursor:pointer; user-select:none;">
                <input type="checkbox" id="chk_edit_auto_${b.id}" ${b.autoDiameter ? 'checked' : ''} style="accent-color:#c084fc; cursor:pointer; margin:0;">
                Auto
              </label>
            </div>
          </td>
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
          const editInputZ = tr.querySelector(`#input_edit_z_${b.id}`);
          const editInputDia = tr.querySelector(`#input_edit_dia_${b.id}`);
          const editChkAuto = tr.querySelector(`#chk_edit_auto_${b.id}`);
          const btnSave = tr.querySelector('.btn-save-custom');
          const btnCancel = tr.querySelector('.btn-cancel-custom');

          if (editChkAuto && editInputDia) {
            editChkAuto.addEventListener('change', () => {
              editInputDia.disabled = editChkAuto.checked;
              editInputDia.style.opacity = editChkAuto.checked ? '0.5' : '1';
            });
          }

          const handleSave = () => {
            const activeList = this.getActiveCustomBaffles();
            const target = activeList.find(cb => cb.id === b.id);
            if (target) {
              if (editInputZ) {
                const newZDisplay = parseFloat(editInputZ.value);
                if (!isNaN(newZDisplay) && newZDisplay >= 0) {
                  target.z_tube = this.unit === 'in' ? newZDisplay * 25.4 : newZDisplay;
                }
              }
              if (editChkAuto) {
                target.autoDiameter = editChkAuto.checked;
              }
              if (!target.autoDiameter && editInputDia) {
                const newDiaDisplay = parseFloat(editInputDia.value);
                if (!isNaN(newDiaDisplay) && newDiaDisplay > 0) {
                  target.aperture_diameter = this.unit === 'in' ? newDiaDisplay * 25.4 : newDiaDisplay;
                }
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
          [editInputZ, editInputDia].forEach(inp => {
            if (inp) {
              inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') {
                  this.editingBaffleId = null;
                  this.update();
                }
              });
            }
          });
          if (editInputZ) {
            editInputZ.focus();
            editInputZ.select();
          }
        }, 0);

      } else if (b.isCustom) {
        // --- DISPLAY MODE FOR CUSTOM / MANUAL BAFFLE ---
        const labelColor = b.isClipping ? '#ef4444' : '#c084fc';
        const diaColor = b.isClipping ? '#ef4444' : 'var(--accent-amber)';
        let warningHtml = '';
        if (b.isClipping) {
          const minReqText = b.min_axial_diameter !== undefined ? ` (requires > ⌀ ${(b.min_axial_diameter * factor).toFixed(p)} ${uLabel})` : '';
          const clipTooltip = `Cannot compute illuminated field > 0${uLabel}: baffle inner diameter is too small and blocks the on-axis light cone${minReqText}`;
          warningHtml = `<span class="baffle-warning-icon error" data-tooltip="${clipTooltip}" title="${clipTooltip}"><svg width="14" height="14" viewBox="0 0 24 24" fill="#ef4444" stroke="#f87171" stroke-width="1.5"><path d="M12 2L1 21h22L12 2z"/><rect x="11" y="8.5" width="2" height="6.5" fill="#ffffff" stroke="none"/><circle cx="12" cy="17.8" r="1.2" fill="#ffffff" stroke="none"/></svg></span>`;
        }

        tr.innerHTML = `
          <td>
            <span style="font-weight:bold; color:${labelColor};">Baffle #${b.number}</span>
            ${warningHtml}
            <span style="font-size:0.65rem; background:rgba(168,85,247,0.2); color:#c084fc; padding:1px 5px; border-radius:3px; margin-left:4px; border:1px solid rgba(168,85,247,0.4);">Custom</span>
          </td>
          <td style="font-weight:bold; color:var(--primary-cyan);">${(b.z_tube * factor).toFixed(p)} ${uLabel}</td>
          <td style="font-weight:bold; color:${diaColor};">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <span>⌀ ${(b.aperture_diameter * factor).toFixed(p)} ${uLabel}</span>
              <label title="Keep baffle diameter automatically snapped to the light cone" style="display:inline-flex; align-items:center; gap:4px; font-size:0.74rem; font-weight:500; color:${b.autoDiameter ? '#c084fc' : 'var(--text-muted)'}; cursor:pointer; user-select:none;">
                <input type="checkbox" class="chk-auto-dia" data-id="${b.id}" ${b.autoDiameter ? 'checked' : ''} style="accent-color:#c084fc; cursor:pointer; margin:0;">
                Auto
              </label>
            </div>
          </td>
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

        const chkAuto = tr.querySelector('.chk-auto-dia');
        const btnEdit = tr.querySelector('.btn-edit-custom');
        const btnDelete = tr.querySelector('.btn-delete-custom');
        if (chkAuto) {
          chkAuto.addEventListener('change', (e) => {
            e.stopPropagation();
            const activeList = this.getActiveCustomBaffles();
            const target = activeList.find(cb => cb.id === b.id);
            if (target) {
              target.autoDiameter = e.target.checked;
              if (!target.autoDiameter) {
                target.aperture_diameter = b.aperture_diameter;
              }
              this.update();
            }
          });
        }
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
            const filtered = this.getActiveCustomBaffles().filter(cb => cb.id !== b.id);
            this.setActiveCustomBaffles(filtered);
            if (this.editingBaffleId === b.id) this.editingBaffleId = null;
            this.update();
          });
        }

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

    const isFromBaffles = this.fieldMode === 'fromBaffles';
    const hasExistingCone = Boolean(
      this.currentBaffleData &&
      this.currentBaffleData.lightCone &&
      this.currentBaffleData.lightCone.hasLightCone
    );
    const defaultAddAuto = !isFromBaffles;
    const diaPlaceholder = isFromBaffles
      ? (hasExistingCone ? 'Auto-snap (or Ø...)' : 'Inner Ø...')
      : 'Auto (snapped)';

    placeholderTr.innerHTML = `
      <td>
        <span style="font-weight:bold; color:#c084fc; font-size:0.82rem;">+ Custom</span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:4px;">
          <input type="number" id="inputAddCustomZ" placeholder="Distance..." step="0.1" min="0" style="width:110px; padding:3px 6px; font-size:0.82rem; background:rgba(15,23,42,0.8); border:1px dashed #c084fc; border-radius:4px; color:#fff;">
          <span style="font-size:0.8rem; color:var(--text-muted);">${uLabel}</span>
        </div>
      </td>
      <td>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="color:var(--accent-amber); font-size:0.82rem;">⌀</span>
            <input type="number" id="inputAddCustomDia" placeholder="${diaPlaceholder}" step="0.1" min="0" style="width:115px; padding:3px 6px; font-size:0.82rem; background:rgba(15,23,42,0.8); border:1px dashed #c084fc; border-radius:4px; color:#fff;">
            <span style="font-size:0.8rem; color:var(--text-muted);">${uLabel}</span>
          </div>
          <label title="Keep baffle diameter automatically snapped to the light cone" style="display:inline-flex; align-items:center; gap:4px; font-size:0.74rem; font-weight:500; color:#c084fc; cursor:pointer; user-select:none;">
            <input type="checkbox" id="chkAddCustomAuto" ${defaultAddAuto ? 'checked' : ''} style="accent-color:#c084fc; cursor:pointer; margin:0;">
            Auto
          </label>
        </div>
      </td>
      <td>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="color:var(--text-muted); font-size:0.78rem; font-style:italic;">Auto-calculated</span>
          <button id="btnAddCustomBaffle" class="btn" style="padding:3px 10px; font-size:0.78rem; background:rgba(168, 85, 247, 0.25); border:1px solid #c084fc; color:#e9d5ff; font-weight:600; cursor:pointer;">+ Add Baffle</button>
        </div>
      </td>
    `;

    tbody.appendChild(placeholderTr);

    // Bind Add Event
    const inputAddZ = placeholderTr.querySelector('#inputAddCustomZ');
    const inputAddDia = placeholderTr.querySelector('#inputAddCustomDia');
    const chkAddAuto = placeholderTr.querySelector('#chkAddCustomAuto');
    const btnAdd = placeholderTr.querySelector('#btnAddCustomBaffle');

    if (inputAddDia && chkAddAuto) {
      inputAddDia.addEventListener('input', () => {
        if (inputAddDia.value !== '' && chkAddAuto.checked) {
          chkAddAuto.checked = false;
        }
      });
      chkAddAuto.addEventListener('change', () => {
        if (chkAddAuto.checked) {
          inputAddDia.value = '';
        }
      });
    }

    const handleAdd = () => {
      if (!inputAddZ) return;
      const valZDisplay = parseFloat(inputAddZ.value);
      const valDiaDisplay = inputAddDia && inputAddDia.value !== '' ? parseFloat(inputAddDia.value) : null;
      const useAutoDia = chkAddAuto ? chkAddAuto.checked : defaultAddAuto;

      if (isNaN(valZDisplay) || valZDisplay < 0) {
        inputAddZ.style.borderColor = '#ef4444';
        inputAddZ.focus();
        return;
      }

      const hasDiaInput = valDiaDisplay !== null && !isNaN(valDiaDisplay) && valDiaDisplay > 0;
      if (isFromBaffles && !hasDiaInput && !hasExistingCone) {
        if (inputAddDia) {
          inputAddDia.style.borderColor = '#ef4444';
          inputAddDia.focus();
        }
        return;
      }

      const params = this.getInputs();
      const valZ_mm = this.unit === 'in' ? valZDisplay * 25.4 : valZDisplay;
      let initialDia_mm;
      if (hasDiaInput && !useAutoDia) {
        initialDia_mm = this.unit === 'in' ? valDiaDisplay * 25.4 : valDiaDisplay;
      } else if (hasExistingCone) {
        const z_opt = valZ_mm - params.lens_offset;
        const { r_obj, m_cone } = this.currentBaffleData.lightCone;
        const d_cone = 2 * (r_obj + m_cone * z_opt);
        initialDia_mm = Math.max(0.1, Math.min(params.d_tube, d_cone));
      } else {
        initialDia_mm = Math.max(0.1, params.d_tube - 6);
      }

      const newBaffle = {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        z_tube: valZ_mm,
        aperture_diameter: initialDia_mm,
        autoDiameter: useAutoDia
      };

      const activeList = this.getActiveCustomBaffles();
      activeList.push(newBaffle);
      this.update();
    };

    if (btnAdd) btnAdd.addEventListener('click', handleAdd);
    [inputAddZ, inputAddDia].forEach(inp => {
      if (inp) {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') handleAdd();
        });
      }
    });
  }
}
