/**
 * Refractor Telescope Baffle Engine
 * Implements precise optical raytracing for refractor telescope baffle placement
 * based on Berfield's Baffle Placement Guide & Zero-Wall Visibility Raytracing.
 */

export const ALGORITHM_MODES = {
  STRICT_ZERO_WALL: 'strictZeroWall', // Ray from field edge to previous baffle base (CAD benchmark match)
  MINIMUM_BAFFLE: 'minimumBaffle',   // Standard Berfield minimum baffle reflection method
};

export const DEFAULT_PRESETS = [
  {
    name: 'CAD Verification Benchmark (User Scope)',
    d_obj: 60,
    focal_length: 1200,
    d_tube: 67.3,
    d_field: 25,
    lens_offset: -3, // Lens position is 3mm to the left (outside) of tube front
    tube_length: 1008,
    algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
  },
  {
    name: '80mm f/6 ED Refractor',
    d_obj: 80,
    focal_length: 480,
    d_tube: 90,
    d_field: 22,
    lens_offset: -5,
    tube_length: 380,
    algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
  },
  {
    name: '102mm f/7 Triplet Refractor',
    d_obj: 102,
    focal_length: 714,
    d_tube: 114,
    d_field: 28,
    lens_offset: -10,
    tube_length: 580,
    algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
  },
  {
    name: '152mm f/8 Achromat Refractor',
    d_obj: 152,
    focal_length: 1216,
    d_tube: 168,
    d_field: 35,
    lens_offset: -15,
    tube_length: 1050,
    algorithm: ALGORITHM_MODES.STRICT_ZERO_WALL
  }
];

/**
 * Calculates baffle positions and optical ray geometries.
 * 
 * Coordinate System:
 * - Mechanical origin (z_tube = 0): Physical front lip of main tube.
 * - Lens origin (z_opt = 0): Rear element / principal plane of objective lens.
 * - z_opt = z_tube - lens_offset  (if lens_offset is -3mm, z_opt = z_tube + 3mm)
 */
export function calculateBaffles(params, customBaffles = []) {
  const {
    d_obj,         // Objective clear aperture (mm)
    focal_length,  // Objective focal length F (mm)
    d_tube,        // Inner tube diameter (mm)
    d_field: input_d_field, // Target illuminated field diameter (mm) when fieldMode is 'specified'
    placementMode: rawPlacementMode, // 'automatic' or 'manual'
    fieldMode: rawFieldMode = 'specified', // 'computed' or 'specified' (legacy: 'fromBaffles' or 'specify')
    lens_offset = 0,// Lens position relative to tube front (mm). Lens left of tube front = negative
    tube_length,   // Physical tube length (mm)
    algorithm = ALGORITHM_MODES.STRICT_ZERO_WALL,
    max_baffles = 25
  } = params;

  // Normalize placementMode ('automatic' | 'manual') and fieldMode ('computed' | 'specified')
  // while preserving backward compatibility with legacy callers passing fieldMode: 'specify' | 'fromBaffles'
  let placementMode = rawPlacementMode;
  if (placementMode !== 'automatic' && placementMode !== 'manual') {
    placementMode = (rawFieldMode === 'fromBaffles' || rawFieldMode === 'computed') ? 'manual' : 'automatic';
  }

  let fieldMode;
  if (placementMode === 'automatic') {
    fieldMode = 'specified';
  } else {
    fieldMode = (rawFieldMode === 'specify' || rawFieldMode === 'specified') ? 'specified' : 'computed';
  }

  const r_obj = d_obj / 2;
  const r_tube = d_tube / 2;

  // Optical positions
  // z_opt = 0 is lens rear surface
  // Tube front in optical coords: z_opt = -lens_offset (e.g. if lens_offset = -3, tube front is at z_opt = +3)
  const z_opt_tube_front = -lens_offset;
  const z_opt_tube_back = z_opt_tube_front + tube_length;
  const z_opt_focal_plane = focal_length; // z_opt = F

  const baffles = [];
  const rays = [];
  const greenReflectionRays = [];

  if (placementMode === 'manual' && fieldMode === 'computed') {
    // --- MANUAL PLACEMENT + COMPUTED FIELD MODE ---
    // Clear auto-generated baffles; compute fully illuminated field from manual baffles + objective
    if (!Array.isArray(customBaffles) || customBaffles.length === 0) {
      return {
        params: {
          d_obj,
          focal_length,
          d_tube,
          d_field: null,
          placementMode,
          fieldMode,
          lens_offset,
          tube_length,
          algorithm
        },
        opticalBounds: {
          z_opt_lens: 0,
          z_opt_tube_front,
          z_opt_tube_back,
          z_opt_focal_plane
        },
        lightCone: {
          m_cone: 0,
          r_obj,
          r_field: 0,
          r_tube,
          hasLightCone: false
        },
        baffles: [],
        rays: [],
        greenReflectionRays: [],
        visibleWallSections: []
      };
    }

    // Compute candidate illuminated field diameter for each manual baffle
    const baffleEvaluations = customBaffles.map((c) => {
      const z_tube_baffle = c.z_tube;
      const z_opt_baffle = z_tube_baffle + z_opt_tube_front;
      const z_opt_safe = Math.max(0.001, z_opt_baffle);
      const isAutoDia = Boolean(c.autoDiameter);
      const d_baffle = (c.aperture_diameter !== undefined && c.aperture_diameter !== null && !isNaN(c.aperture_diameter))
        ? c.aperture_diameter
        : d_obj;
      // Line from (0, d_obj) through (z_opt_baffle, d_baffle) evaluated at z_opt = focal_length
      const d_field_candidate = d_obj + (focal_length / z_opt_safe) * (d_baffle - d_obj);
      const min_axial_diameter = Math.max(0, d_obj * (1 - z_opt_baffle / focal_length));
      const isClipping = !isAutoDia && d_field_candidate <= 0;
      return {
        c,
        isAutoDia,
        z_tube_baffle,
        z_opt_baffle,
        d_baffle,
        d_field_candidate,
        min_axial_diameter,
        isClipping
      };
    });

    const definingEvaluations = baffleEvaluations.filter(e => !e.isAutoDia);
    const hasClippingBaffle = definingEvaluations.some(e => e.isClipping);
    let minCandidateField = 0;
    if (definingEvaluations.length > 0) {
      minCandidateField = Math.min(...definingEvaluations.map(e => e.d_field_candidate));
    } else if (params.fallback_d_field !== undefined && params.fallback_d_field !== null && params.fallback_d_field > 0) {
      minCandidateField = params.fallback_d_field;
    } else {
      minCandidateField = Math.min(...baffleEvaluations.map(e => e.d_field_candidate));
    }

    const hasLightCone = !hasClippingBaffle && minCandidateField > 0;
    const computed_d_field = hasLightCone ? minCandidateField : null;
    const r_field = hasLightCone ? computed_d_field / 2 : 0;
    const m_cone = hasLightCone ? (r_field - r_obj) / focal_length : 0;
    const getLightConeRadius = (z_opt) => r_obj + m_cone * z_opt;

    const allBaffles = baffleEvaluations.map((ev) => {
      const { c, isAutoDia, z_tube_baffle, z_opt_baffle, min_axial_diameter, isClipping } = ev;
      const r_cone = hasLightCone ? getLightConeRadius(z_opt_baffle) : 0;
      const d_cone = hasLightCone ? Math.max(0, 2 * r_cone) : min_axial_diameter;
      const d_baffle = (isAutoDia && hasLightCone)
        ? Math.max(0.1, Math.min(d_tube, d_cone))
        : ev.d_baffle;
      if (isAutoDia && hasLightCone) {
        c.aperture_diameter = d_baffle;
      }
      const r_baffle = d_baffle / 2;

      return {
        id: c.id,
        isCustom: true,
        autoDiameter: isAutoDia,
        isClipping,
        min_axial_diameter,
        expected_cone_diameter: d_cone,
        z_opt: z_opt_baffle,
        z_tube: z_tube_baffle,
        dist_from_focal_plane: z_opt_focal_plane - z_opt_baffle,
        aperture_radius: r_baffle,
        aperture_diameter: d_baffle,
        outer_diameter: d_tube,
        wall_height: r_tube - r_baffle
      };
    });

    // Sort by distance from tube front ascending and re-number sequentially
    allBaffles.sort((a, b) => a.z_tube - b.z_tube);
    const wallEndForRays = Math.min(z_opt_tube_back, z_opt_focal_plane);
    const validForRays = allBaffles.filter((b) => (
      b.z_opt >= z_opt_tube_front && b.z_opt <= wallEndForRays && b.aperture_radius < r_tube
    ));
    const lastValidBaffle = validForRays.length > 0 ? validForRays[validForRays.length - 1] : null;

    allBaffles.forEach((b, idx) => {
      b.number = idx + 1;

      if (hasLightCone) {
        // Compute ray from bottom of computed illuminated field through baffle top tip to tube wall
        if (b.z_opt < z_opt_focal_plane && (b.aperture_radius + r_field) > 0) {
          const m_ray = (b.aperture_radius - (-r_field)) / (b.z_opt - z_opt_focal_plane);
          const z_wall = z_opt_focal_plane + (r_tube - (-r_field)) / m_ray;
          rays.push({
            baffleIndex: b.number,
            start: { z_opt: z_opt_focal_plane, y: -r_field, z_tube: z_opt_focal_plane - z_opt_tube_front },
            wallHit: { z_opt: z_wall, y: r_tube, z_tube: z_wall - z_opt_tube_front },
            baffleHit: { z_opt: b.z_opt, y: b.aperture_radius, z_tube: b.z_tube }
          });
        }

        if ((algorithm === ALGORITHM_MODES.MINIMUM_BAFFLE || b === lastValidBaffle) && b.z_opt > 0 && (b.aperture_radius + r_obj) > 0) {
          const m_obj = (b.aperture_radius - (-r_obj)) / b.z_opt;
          const next_z_wall = (r_tube + r_obj) / m_obj;
          greenReflectionRays.push({
            baffleIndex: b.number,
            start: { z_opt: 0, y: -r_obj, z_tube: -z_opt_tube_front },
            baffleTip: { z_opt: b.z_opt, y: b.aperture_radius, z_tube: b.z_tube },
            wallHit: { z_opt: next_z_wall, y: r_tube, z_tube: next_z_wall - z_opt_tube_front }
          });
        }
      }
    });

    const opticalBounds = {
      z_opt_lens: 0,
      z_opt_tube_front,
      z_opt_tube_back,
      z_opt_focal_plane
    };

    const lightCone = {
      m_cone,
      r_obj,
      r_field,
      r_tube,
      hasLightCone
    };

    const visibleWallSections = computeVisibleWallSections(opticalBounds, lightCone, allBaffles, algorithm);

    return {
      params: {
        d_obj,
        focal_length,
        d_tube,
        d_field: computed_d_field,
        isClippedField: hasClippingBaffle,
        placementMode,
        fieldMode,
        lens_offset,
        tube_length,
        algorithm
      },
      opticalBounds,
      lightCone,
      baffles: allBaffles,
      rays,
      greenReflectionRays,
      visibleWallSections
    };
  }

  // --- SPECIFIED FIELD MODE (Automatic Placement OR Manual Placement with Specified Field) ---
  const d_field = input_d_field;
  const r_field = d_field / 2;

  // Light cone slope: r_cone(z_opt) = r_obj + m_cone * z_opt
  const m_cone = (r_field - r_obj) / focal_length;
  const getLightConeRadius = (z_opt) => r_obj + m_cone * z_opt;

  if (placementMode === 'automatic') {
    // Ray 1: From focal plane bottom field spot (z_opt = F, y = -r_field)
    // to tube wall at physical tube front (z_opt = z_opt_tube_front, y = +r_tube)
    let z_wall_prev = z_opt_tube_front;

    for (let i = 0; i < max_baffles; i++) {
      // Check if previous wall point is beyond tube back or focal plane
      if (z_wall_prev >= z_opt_tube_back || z_wall_prev >= z_opt_focal_plane) {
        break;
      }

      // Ray equation from (z_opt = F, y = -r_field) to (z_opt = z_wall_prev, y = +r_tube)
      const m_ray = (r_tube - (-r_field)) / (z_wall_prev - z_opt_focal_plane);

      // Intersect ray y = r_tube + m_ray * (z_opt - z_wall_prev)
      // with top light cone y = r_obj + m_cone * z_opt
      const z_opt_baffle = (r_obj - r_tube + m_ray * z_wall_prev) / (m_ray - m_cone);

      if (z_opt_baffle >= z_opt_tube_back || z_opt_baffle >= z_opt_focal_plane) {
        break;
      }

      const r_baffle = getLightConeRadius(z_opt_baffle);
      const d_baffle = 2 * r_baffle;
      const z_tube_baffle = z_opt_baffle - z_opt_tube_front;

      rays.push({
        baffleIndex: i + 1,
        start: { z_opt: z_opt_focal_plane, y: -r_field, z_tube: z_opt_focal_plane - z_opt_tube_front },
        wallHit: { z_opt: z_wall_prev, y: r_tube, z_tube: z_wall_prev - z_opt_tube_front },
        baffleHit: { z_opt: z_opt_baffle, y: r_baffle, z_tube: z_tube_baffle }
      });

      baffles.push({
        id: `calc_${i + 1}`,
        isCustom: false,
        isClipping: false,
        number: i + 1,
        z_opt: z_opt_baffle,
        z_tube: z_tube_baffle,
        dist_from_focal_plane: z_opt_focal_plane - z_opt_baffle,
        aperture_radius: r_baffle,
        aperture_diameter: d_baffle,
        outer_diameter: d_tube,
        wall_height: r_tube - r_baffle
      });

      // Determine next z_wall_prev based on selected algorithm
      if (algorithm === ALGORITHM_MODES.STRICT_ZERO_WALL) {
        z_wall_prev = z_opt_baffle;
      } else {
        const m_obj = (r_baffle - (-r_obj)) / z_opt_baffle;
        const next_z_wall = (r_tube + r_obj) / m_obj;

        greenReflectionRays.push({
          baffleIndex: i + 1,
          start: { z_opt: 0, y: -r_obj, z_tube: -z_opt_tube_front },
          baffleTip: { z_opt: z_opt_baffle, y: r_baffle, z_tube: z_tube_baffle },
          wallHit: { z_opt: next_z_wall, y: r_tube, z_tube: next_z_wall - z_opt_tube_front }
        });

        z_wall_prev = next_z_wall;
      }
    }
  } else {
    // Manual placement with a specified target field:
    // Cast the initial guide ray from the bottom of the field spot to the front lip of the tube
    if (z_opt_tube_front < z_opt_tube_back && z_opt_tube_front < z_opt_focal_plane) {
      const m_ray_first = (r_tube - (-r_field)) / (z_opt_tube_front - z_opt_focal_plane);
      const z_opt_first_hit = (r_obj - r_tube + m_ray_first * z_opt_tube_front) / (m_ray_first - m_cone);
      if (z_opt_first_hit < z_opt_tube_back && z_opt_first_hit < z_opt_focal_plane) {
        const r_first_hit = getLightConeRadius(z_opt_first_hit);
        rays.push({
          baffleIndex: 0,
          start: { z_opt: z_opt_focal_plane, y: -r_field, z_tube: z_opt_focal_plane - z_opt_tube_front },
          wallHit: { z_opt: z_opt_tube_front, y: r_tube, z_tube: 0 },
          baffleHit: { z_opt: z_opt_first_hit, y: r_first_hit, z_tube: z_opt_first_hit - z_opt_tube_front }
        });
      }
    }
  }

  // Process Custom / Manual Baffles (if any)
  let hasClippingCustomBaffle = false;
  const allBaffles = [...baffles];
  if (Array.isArray(customBaffles) && customBaffles.length > 0) {
    customBaffles.forEach((c) => {
      const z_tube_baffle = c.z_tube;
      const z_opt_baffle = z_tube_baffle + z_opt_tube_front;
      const z_opt_safe = Math.max(0.001, z_opt_baffle);
      const r_cone = getLightConeRadius(z_opt_baffle);
      const d_cone = Math.max(0.1, Math.min(d_tube, 2 * r_cone));
      const min_axial_diameter = Math.max(0, d_obj * (1 - z_opt_baffle / focal_length));
      const hasCustomDia = c.aperture_diameter !== undefined && c.aperture_diameter !== null && !isNaN(c.aperture_diameter);
      const isAutoDia = Boolean(c.autoDiameter) || !hasCustomDia;
      const d_baffle = isAutoDia ? d_cone : c.aperture_diameter;
      if (isAutoDia) {
        c.aperture_diameter = d_baffle;
      }
      const r_baffle = d_baffle / 2;
      const d_field_candidate = d_obj + (focal_length / z_opt_safe) * (d_baffle - d_obj);
      // In Manual + Specified mode, changing vane height does not impact the specified illuminated field
      const isClipping = placementMode === 'automatic' && !isAutoDia && d_field_candidate <= 0;
      if (isClipping) hasClippingCustomBaffle = true;

      allBaffles.push({
        id: c.id,
        isCustom: true,
        autoDiameter: isAutoDia,
        isClipping,
        min_axial_diameter,
        expected_cone_diameter: d_cone,
        z_opt: z_opt_baffle,
        z_tube: z_tube_baffle,
        dist_from_focal_plane: z_opt_focal_plane - z_opt_baffle,
        aperture_radius: r_baffle,
        aperture_diameter: d_baffle,
        outer_diameter: d_tube,
        wall_height: r_tube - r_baffle
      });
    });
  }

  // Sort all baffles by distance from tube front (z_tube) ascending
  allBaffles.sort((a, b) => a.z_tube - b.z_tube);

  // Re-number sequentially
  allBaffles.forEach((b, idx) => {
    b.number = idx + 1;
  });

  const wallEndForRays = Math.min(z_opt_tube_back, z_opt_focal_plane);
  const validForRays = allBaffles.filter((b) => (
    b.z_opt >= z_opt_tube_front && b.z_opt <= wallEndForRays && b.aperture_radius < r_tube
  ));
  const lastValidBaffle = validForRays.length > 0 ? validForRays[validForRays.length - 1] : null;

  // Add rays for custom/manual baffles in Specified field mode
  if (!hasClippingCustomBaffle) {
    allBaffles.forEach((b) => {
      if (b.isCustom) {
        if (b.z_opt < z_opt_focal_plane && (b.aperture_radius + r_field) > 0) {
          const m_ray = (b.aperture_radius - (-r_field)) / (b.z_opt - z_opt_focal_plane);
          const z_wall = z_opt_focal_plane + (r_tube - (-r_field)) / m_ray;
          rays.push({
            baffleIndex: b.number,
            start: { z_opt: z_opt_focal_plane, y: -r_field, z_tube: z_opt_focal_plane - z_opt_tube_front },
            wallHit: { z_opt: z_wall, y: r_tube, z_tube: z_wall - z_opt_tube_front },
            baffleHit: { z_opt: b.z_opt, y: b.aperture_radius, z_tube: b.z_tube }
          });
        }

        if (algorithm === ALGORITHM_MODES.MINIMUM_BAFFLE && b.z_opt > 0 && (b.aperture_radius + r_obj) > 0) {
          const m_obj = (b.aperture_radius - (-r_obj)) / b.z_opt;
          const next_z_wall = (r_tube + r_obj) / m_obj;
          greenReflectionRays.push({
            baffleIndex: b.number,
            start: { z_opt: 0, y: -r_obj, z_tube: -z_opt_tube_front },
            baffleTip: { z_opt: b.z_opt, y: b.aperture_radius, z_tube: b.z_tube },
            wallHit: { z_opt: next_z_wall, y: r_tube, z_tube: next_z_wall - z_opt_tube_front }
          });
        }
      }
    });

    // In Strict mode, add the objective visibility ray for the last valid baffle in the tube
    if (algorithm === ALGORITHM_MODES.STRICT_ZERO_WALL && lastValidBaffle && lastValidBaffle.z_opt > 0 && (lastValidBaffle.aperture_radius + r_obj) > 0) {
      const m_obj = (lastValidBaffle.aperture_radius - (-r_obj)) / lastValidBaffle.z_opt;
      const next_z_wall = (r_tube + r_obj) / m_obj;
      greenReflectionRays.push({
        baffleIndex: lastValidBaffle.number,
        start: { z_opt: 0, y: -r_obj, z_tube: -z_opt_tube_front },
        baffleTip: { z_opt: lastValidBaffle.z_opt, y: lastValidBaffle.aperture_radius, z_tube: lastValidBaffle.z_tube },
        wallHit: { z_opt: next_z_wall, y: r_tube, z_tube: next_z_wall - z_opt_tube_front }
      });
    }
  }

  const opticalBounds = {
    z_opt_lens: 0,
    z_opt_tube_front,
    z_opt_tube_back,
    z_opt_focal_plane
  };

  const lightCone = {
    m_cone,
    r_obj,
    r_field,
    r_tube,
    hasLightCone: !hasClippingCustomBaffle
  };

  const visibleWallSections = computeVisibleWallSections(opticalBounds, lightCone, allBaffles, algorithm);

  return {
    params: {
      d_obj,
      focal_length,
      d_tube,
      d_field,
      isClippedField: hasClippingCustomBaffle,
      placementMode,
      fieldMode,
      lens_offset,
      tube_length,
      algorithm
    },
    opticalBounds,
    lightCone,
    baffles: allBaffles,
    rays: hasClippingCustomBaffle ? [] : rays,
    greenReflectionRays: hasClippingCustomBaffle ? [] : greenReflectionRays,
    visibleWallSections
  };
}

/**
 * Computes sections of the physical tube wall that are visible from the fully illuminated field
 * according to the selected strategy ('strictZeroWall' or 'minimumBaffle').
 */
function computeVisibleWallSections(opticalBounds, lightCone, baffles, algorithm) {
  if (!lightCone.hasLightCone) return [];

  const { z_opt_tube_front, z_opt_tube_back, z_opt_focal_plane } = opticalBounds;
  const { r_obj, r_field, r_tube } = lightCone;

  const wallStart = z_opt_tube_front;
  const wallEnd = Math.min(z_opt_tube_back, z_opt_focal_plane);
  if (wallEnd <= wallStart) return [];

  const validBaffles = baffles.filter((b) => (
    b.z_opt >= wallStart && b.z_opt <= wallEnd && b.aperture_radius < r_tube
  ));
  const lastBaffle = validBaffles.length > 0 ? validBaffles[validBaffles.length - 1] : null;

  const protectedIntervals = [];

  validBaffles.forEach((b) => {
    const z_k = b.z_opt;
    const r_k = b.aperture_radius;

    // 1. Interval in front of baffle k hidden from the illuminated field (z_opt = F, y = -r_field)
    if (z_k < z_opt_focal_plane && (r_k + r_field) > 0) {
      const z_shadow_front = z_opt_focal_plane - ((r_tube + r_field) / (r_k + r_field)) * (z_opt_focal_plane - z_k);
      const start = Math.max(wallStart, z_shadow_front);
      const end = Math.min(wallEnd, z_k);
      if (end > start) {
        protectedIntervals.push([start, end]);
      }
    }

    // 2. Interval behind baffle k shaded from direct objective light (z_opt = 0, y = -r_obj):
    //    Applied to all baffles in Minimum Baffle mode, and only to the last baffle in Strict mode.
    if ((algorithm === ALGORITHM_MODES.MINIMUM_BAFFLE || b === lastBaffle) && z_k > 0 && (r_k + r_obj) > 0) {
      const z_shade_end = ((r_tube + r_obj) / (r_k + r_obj)) * z_k;
      const start = Math.max(wallStart, z_k);
      const end = Math.min(wallEnd, z_shade_end);
      if (end > start) {
        protectedIntervals.push([start, end]);
      }
    }
  });

  // Sort and merge overlapping/adjacent protected intervals (1.5mm tolerance for 0.1mm input rounding)
  const MERGE_TOL = 1.5;
  protectedIntervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of protectedIntervals) {
    if (merged.length === 0) {
      merged.push([...interval]);
    } else {
      const last = merged[merged.length - 1];
      if (interval[0] <= last[1] + MERGE_TOL) {
        last[1] = Math.max(last[1], interval[1]);
      } else {
        merged.push([...interval]);
      }
    }
  }

  // Find uncovered intervals in [wallStart, wallEnd]
  const rawUncovered = [];
  let cursor = wallStart;
  for (const [start, end] of merged) {
    if (start > cursor + MERGE_TOL) {
      rawUncovered.push([cursor, start]);
    }
    cursor = Math.max(cursor, end);
  }
  if (wallEnd > cursor + MERGE_TOL) {
    rawUncovered.push([cursor, wallEnd]);
  }

  return rawUncovered.map(([s, e]) => ({
    z_opt_start: s,
    z_opt_end: e,
    z_tube_start: s - z_opt_tube_front,
    z_tube_end: e - z_opt_tube_front
  }));
}

/**
 * Validates calculated baffles against user CAD benchmark parameters
 */
export function validateAgainstBenchmark(calculatedBaffles) {
  const benchmark = [
    { z_tube: 154.09, d_baffle: 55.418 },
    { z_tube: 354.337, d_baffle: 49.578 },
    { z_tube: 574.854, d_baffle: 43.145 },
    { z_tube: 777.505, d_baffle: 37.235 },
    { z_tube: 935.027, d_baffle: 32.641 }
  ];

  if (!calculatedBaffles || calculatedBaffles.length !== benchmark.length) {
    return {
      passed: false,
      message: `Expected ${benchmark.length} baffles, calculated ${calculatedBaffles ? calculatedBaffles.length : 0}`,
      details: []
    };
  }

  const details = benchmark.map((bench, idx) => {
    const calc = calculatedBaffles[idx];
    const z_diff = Math.abs(calc.z_tube - bench.z_tube);
    const d_diff = Math.abs(calc.aperture_diameter - bench.d_baffle);
    const z_ok = z_diff <= 0.1;
    const d_ok = d_diff <= 0.1;

    return {
      baffle: idx + 1,
      expected: bench,
      actual: { z_tube: calc.z_tube, d_baffle: calc.aperture_diameter },
      z_diff,
      d_diff,
      passed: z_ok && d_ok
    };
  });

  const allPassed = details.every(d => d.passed);

  return {
    passed: allPassed,
    message: allPassed
      ? 'All 5 baffles match CAD benchmark within 0.1mm tolerance!'
      : 'Some baffle parameters fell outside 0.1mm tolerance.',
    details
  };
}
