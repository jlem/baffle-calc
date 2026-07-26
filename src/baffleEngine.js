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
export function calculateBaffles(params) {
  const {
    d_obj,         // Objective clear aperture (mm)
    focal_length,  // Objective focal length F (mm)
    d_tube,        // Inner tube diameter (mm)
    d_field,       // Target illuminated field diameter (mm)
    lens_offset = 0,// Lens position relative to tube front (mm). Lens left of tube front = negative
    tube_length,   // Physical tube length (mm)
    algorithm = ALGORITHM_MODES.STRICT_ZERO_WALL,
    max_baffles = 25
  } = params;

  const r_obj = d_obj / 2;
  const r_tube = d_tube / 2;
  const r_field = d_field / 2;

  // Optical positions
  // z_opt = 0 is lens rear surface
  // Tube front in optical coords: z_opt = -lens_offset (e.g. if lens_offset = -3, tube front is at z_opt = +3)
  const z_opt_tube_front = -lens_offset;
  const z_opt_tube_back = z_opt_tube_front + tube_length;
  const z_opt_focal_plane = focal_length; // z_opt = F

  // Light cone slope: r_cone(z_opt) = r_obj + m_cone * z_opt
  // At z_opt = 0: r = r_obj
  // At z_opt = F: r = r_field
  const m_cone = (r_field - r_obj) / focal_length;

  const getLightConeRadius = (z_opt) => r_obj + m_cone * z_opt;

  const baffles = [];
  const rays = [];

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
    // r_tube - m_ray * z_wall_prev + m_ray * z_opt = r_obj + m_cone * z_opt
    // z_opt * (m_ray - m_cone) = r_obj - r_tube + m_ray * z_wall_prev
    const z_opt_baffle = (r_obj - r_tube + m_ray * z_wall_prev) / (m_ray - m_cone);

    // Stop if baffle is past physical tube back or past focal plane
    if (z_opt_baffle >= z_opt_tube_back || z_opt_baffle >= z_opt_focal_plane) {
      break;
    }

    const r_baffle = getLightConeRadius(z_opt_baffle);
    const d_baffle = 2 * r_baffle;
    const z_tube_baffle = z_opt_baffle - z_opt_tube_front;

    // Record Ray
    rays.push({
      baffleIndex: i + 1,
      start: { z_opt: z_opt_focal_plane, y: -r_field, z_tube: z_opt_focal_plane - z_opt_tube_front },
      wallHit: { z_opt: z_wall_prev, y: r_tube, z_tube: z_wall_prev - z_opt_tube_front },
      baffleHit: { z_opt: z_opt_baffle, y: r_baffle, z_tube: z_tube_baffle }
    });

    // Record Baffle
    baffles.push({
      number: i + 1,
      z_tube: z_tube_baffle,
      z_opt: z_opt_baffle,
      dist_from_focal_plane: z_opt_focal_plane - z_opt_baffle,
      aperture_radius: r_baffle,
      aperture_diameter: d_baffle,
      outer_diameter: d_tube,
      wall_height: r_tube - r_baffle
    });

    // Determine next z_wall_prev based on selected algorithm
    if (algorithm === ALGORITHM_MODES.STRICT_ZERO_WALL) {
      // Ray to previous baffle base at tube wall
      z_wall_prev = z_opt_baffle;
    } else {
      // Minimum Baffle Method: Ray from bottom edge of objective (-r_obj, z_opt=0)
      // through baffle tip (r_baffle, z_opt_baffle) extended to y = +r_tube
      const m_obj = (r_baffle - (-r_obj)) / z_opt_baffle;
      z_wall_prev = (r_tube + r_obj) / m_obj;
    }
  }

  return {
    params: {
      d_obj,
      focal_length,
      d_tube,
      d_field,
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
      m_cone,
      r_obj,
      r_field,
      r_tube
    },
    baffles,
    rays
  };
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
