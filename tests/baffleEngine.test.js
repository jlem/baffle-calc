import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBaffles,
  validateAgainstBenchmark,
  ALGORITHM_MODES
} from '../src/baffleEngine.js';

const BASE_PARAMS = {
  d_obj: 60,
  focal_length: 1200,
  d_tube: 67.3,
  d_field: 25,
  lens_offset: -3,
  tube_length: 1008
};

test('Specify mode (Strict Zero-Wall): matches 5-baffle CAD benchmark with zero exposed wall sections', () => {
  const result = calculateBaffles({
    ...BASE_PARAMS,
    fieldMode: 'specify',
    algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
  });

  const validation = validateAgainstBenchmark(result.baffles);
  assert.equal(validation.passed, true, validation.message);
  assert.equal(result.baffles.length, 5);
  assert.equal(result.lightCone.hasLightCone, true);
  assert.equal(result.visibleWallSections.length, 0);
});

test('Specify mode (Berfield Minimum Baffle): generates auto baffles with zero exposed wall sections', () => {
  const result = calculateBaffles({
    ...BASE_PARAMS,
    fieldMode: 'specify',
    algorithm: ALGORITHM_MODES.MINIMUM_BAFFLE
  });

  assert.equal(result.baffles.length, 4);
  assert.equal(result.greenReflectionRays.length, 4);
  assert.equal(result.lightCone.hasLightCone, true);
  assert.equal(result.visibleWallSections.length, 0);
});

test('From Baffles mode (Berfield Minimum Baffle): flags trailing unshaded tube wall from user debug JSON', () => {
  const customBaffles = [
    { id: 'custom_1793627928139_vbj3', z_tube: 45.8853, aperture_diameter: 63.1337 },
    { id: 'custom_1793627835731_6wgg', z_tube: 92.4546, aperture_diameter: 61.3 },
    { id: 'custom_1793627840870_cu83', z_tube: 141.59, aperture_diameter: 60.516 },
    { id: 'custom_1793627842678_ifr9', z_tube: 232.1217, aperture_diameter: 51.9352 },
    { id: 'custom_1793627836991_7k8g', z_tube: 344.9398, aperture_diameter: 54.9367 },
    { id: 'custom_1793628157194_42d7', z_tube: 486.5895, aperture_diameter: 52.9364 },
    { id: 'custom_1793628156184_ok9z', z_tube: 733.0309, aperture_diameter: 41.8865 }
  ];

  const result = calculateBaffles(
    {
      ...BASE_PARAMS,
      d_field: 40,
      fieldMode: 'fromBaffles',
      algorithm: ALGORITHM_MODES.MINIMUM_BAFFLE
    },
    customBaffles
  );

  // Effective field diameter determined by Baffle #4
  assert.ok(Math.abs(result.params.d_field - 18.8395448) < 1e-3);
  assert.equal(result.params.isClippedField, false);
  assert.equal(result.lightCone.hasLightCone, true);

  // Baffle #7 only shades up to z_tube ≈ 916.63mm, leaving [916.63mm, 1008mm] exposed
  assert.equal(result.visibleWallSections.length, 1);
  const exposed = result.visibleWallSections[0];
  assert.ok(Math.abs(exposed.z_tube_start - 916.63) < 0.05, `Expected ~916.63mm, got ${exposed.z_tube_start}`);
  assert.ok(Math.abs(exposed.z_tube_end - 1008) < 0.05, `Expected 1008mm, got ${exposed.z_tube_end}`);

  // Adding an 8th baffle at z_tube = 916mm (or moving Baffle #7 back & narrowing it) shades the rest of the tube past 1008mm
  const fixedBaffles = [
    ...customBaffles,
    { id: 'custom_8', z_tube: 916, aperture_diameter: 40 }
  ];
  const fixedResult = calculateBaffles(
    {
      ...BASE_PARAMS,
      d_field: 40,
      fieldMode: 'fromBaffles',
      algorithm: ALGORITHM_MODES.MINIMUM_BAFFLE
    },
    fixedBaffles
  );
  assert.equal(fixedResult.visibleWallSections.length, 0);
});

test('From Baffles mode (Strict Zero-Wall): flags both front and trailing unshaded wall from user debug JSON', () => {
  const customBaffles = [
    { id: 'custom_1793634024079_ooyc', z_tube: 447.0296, aperture_diameter: 41.4898, autoDiameter: false },
    { id: 'custom_1793634028617_sgi0', z_tube: 528.0394, aperture_diameter: 38.1577, autoDiameter: true },
    { id: 'custom_1793634035614_ofn5', z_tube: 589.9464, aperture_diameter: 35.6114, autoDiameter: true },
    { id: 'custom_1793634036439_87gs', z_tube: 645.8396, aperture_diameter: 33.3125, autoDiameter: true },
    { id: 'custom_1793634036968_tiye', z_tube: 700.3178, aperture_diameter: 31.0717, autoDiameter: true }
  ];

  const result = calculateBaffles(
    {
      ...BASE_PARAMS,
      fieldMode: 'fromBaffles',
      algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
    },
    customBaffles
  );

  assert.ok(Math.abs(result.params.d_field - 10.6425947) < 1e-3);
  assert.equal(result.greenReflectionRays.length, 1);
  assert.equal(result.greenReflectionRays[0].baffleIndex, 5);

  // Should report 2 visible wall sections:
  // 1) Front wall [0, 75.7262mm] not hidden by Baffle #1
  // 2) Trailing wall [980.0974mm, 1008mm] after Baffle #5's objective shadow ends
  assert.equal(result.visibleWallSections.length, 2);
  assert.ok(Math.abs(result.visibleWallSections[0].z_tube_start - 0) < 0.05);
  assert.ok(Math.abs(result.visibleWallSections[0].z_tube_end - 75.7262) < 0.05);
  assert.ok(Math.abs(result.visibleWallSections[1].z_tube_start - 980.0974) < 0.05);
  assert.ok(Math.abs(result.visibleWallSections[1].z_tube_end - 1008) < 0.05);
});

test('From Baffles mode (Strict Zero-Wall): detects trailing wall after last baffle objective shadow', () => {
  const benchmarkManual = [
    { id: 'b1', z_tube: 154.09, aperture_diameter: 55.418 },
    { id: 'b2', z_tube: 354.337, aperture_diameter: 49.578 },
    { id: 'b3', z_tube: 574.854, aperture_diameter: 43.145 },
    { id: 'b4', z_tube: 777.505, aperture_diameter: 37.235 },
    { id: 'b5', z_tube: 935.027, aperture_diameter: 32.641 }
  ];

  // Complete 5-baffle set has no exposed wall in Strict mode (Baffle #5 shades past 1008mm)
  const fullStrict = calculateBaffles(
    {
      ...BASE_PARAMS,
      fieldMode: 'fromBaffles',
      algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
    },
    benchmarkManual
  );
  assert.equal(fullStrict.visibleWallSections.length, 0);

  // With only the first 3 baffles, Baffle #3's objective shadow ends at z_tube ≈ 710.18mm,
  // leaving [710.18mm, 1008mm] exposed at the rear of the tube
  const missingRear = calculateBaffles(
    {
      ...BASE_PARAMS,
      fieldMode: 'fromBaffles',
      algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
    },
    benchmarkManual.slice(0, 3)
  );
  assert.equal(missingRear.visibleWallSections.length, 1);
  assert.ok(Math.abs(missingRear.visibleWallSections[0].z_tube_start - 710.175) < 0.1);
  assert.ok(Math.abs(missingRear.visibleWallSections[0].z_tube_end - 1008) < 0.1);
});

test('Clipping baffle detection: suppresses light cone and flags clipping baffle when d_field <= 0', () => {
  // At z_opt = 600mm (z_tube = 597mm), axial cone diameter is 60 * (1 - 600/1200) = 30mm
  const clippingBaffles = [
    { id: 'clip1', z_tube: 597, aperture_diameter: 28 }
  ];

  const result = calculateBaffles(
    {
      ...BASE_PARAMS,
      fieldMode: 'fromBaffles',
      algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
    },
    clippingBaffles
  );

  assert.equal(result.params.isClippedField, true);
  assert.equal(result.params.d_field, null);
  assert.equal(result.lightCone.hasLightCone, false);
  assert.equal(result.baffles[0].isClipping, true);
  assert.equal(result.visibleWallSections.length, 0);
});

test('Baffle at tube front lip (z_tube = 0) casts objective shadow in Minimum Baffle mode', () => {
  const twoBaffles = [
    { id: 'front', z_tube: 0, aperture_diameter: 61 },
    { id: 'rear', z_tube: 500, aperture_diameter: 45 }
  ];
  const res = calculateBaffles(
    {
      ...BASE_PARAMS,
      fieldMode: 'fromBaffles',
      algorithm: ALGORITHM_MODES.MINIMUM_BAFFLE
    },
    twoBaffles
  );
  assert.equal(res.lightCone.hasLightCone, true);
  // Front baffle at z_opt = 3mm with r_k = 30.5mm casts shadow behind z_tube = 0
  assert.ok(res.visibleWallSections[0].z_tube_start > 0.15);
});

test('autoDiameter keeps custom and manual baffles snapped to the active light cone', () => {
  // 1. In Automatic ('specify') mode, autoDiameter overrides manual aperture_diameter and snaps to cone
  const autoSpec = calculateBaffles(
    {
      ...BASE_PARAMS,
      fieldMode: 'specify',
      algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
    },
    [{ id: 'c_auto', z_tube: 597, aperture_diameter: 10, autoDiameter: true }]
  );
  const cAutoBaffle = autoSpec.baffles.find(b => b.id === 'c_auto');
  // At z_opt = 600mm (halfway to F=1200mm), cone diameter between d_obj=60 and d_field=25 is 42.5mm
  assert.equal(cAutoBaffle.autoDiameter, true);
  assert.equal(cAutoBaffle.isClipping, false);
  assert.ok(Math.abs(cAutoBaffle.aperture_diameter - 42.5) < 1e-4);

  // 2. In Manual ('fromBaffles') mode, non-auto baffles define the cone and autoDiameter baffles snap to it
  const manualWithAuto = calculateBaffles(
    {
      ...BASE_PARAMS,
      fieldMode: 'fromBaffles',
      algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
    },
    [
      { id: 'm_def', z_tube: 597, aperture_diameter: 42.5, autoDiameter: false },
      { id: 'm_snap', z_tube: 297, aperture_diameter: 60, autoDiameter: true }
    ]
  );
  assert.ok(Math.abs(manualWithAuto.params.d_field - 25) < 1e-4);
  const snapped = manualWithAuto.baffles.find(b => b.id === 'm_snap');
  // At z_opt = 300mm (1/4 of F=1200mm), cone diameter between 60 and 25 is 51.25mm
  assert.equal(snapped.autoDiameter, true);
  assert.ok(Math.abs(snapped.aperture_diameter - 51.25) < 1e-4);
});

