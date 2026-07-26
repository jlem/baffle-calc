/**
 * Export Manager
 * Handles CSV export, SVG CAD file generation, and Canvas PNG downloads.
 */

export function exportCSV(baffleData, unit = 'mm', precision = 1) {
  if (!baffleData || !baffleData.baffles) return;

  const unitFactor = unit === 'in' ? 1 / 25.4 : 1;
  const unitLabel = unit === 'in' ? 'in' : 'mm';
  const p = precision;

  let csvContent = `Baffle #,Distance from Tube Front (${unitLabel}),Inner Diameter (${unitLabel}),Vane Wall Height (${unitLabel})\n`;

  baffleData.baffles.forEach((b) => {
    csvContent += [
      b.number,
      (b.z_tube * unitFactor).toFixed(p),
      (b.aperture_diameter * unitFactor).toFixed(p),
      (b.wall_height * unitFactor).toFixed(p)
    ].join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `baffle_specifications_${unitLabel}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportSVG(baffleData, precision = 1) {
  if (!baffleData) return;
  const { params, baffles, opticalBounds, lightCone } = baffleData;
  const { d_obj, d_tube, tube_length, focal_length } = params;
  const p = precision;

  const width = opticalBounds.z_opt_focal_plane + 100;
  const height = d_tube * 2;
  const cy = height / 2;
  const xTubeFront = opticalBounds.z_opt_tube_front;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}mm" height="${height}mm">
  <style>
    .axis { stroke: #888888; stroke-dasharray: 4,4; stroke-width: 0.5; }
    .tube { stroke: #000000; stroke-width: 1.5; fill: none; }
    .baffle { stroke: #00aa00; stroke-width: 2; }
    .lightcone { stroke: #00aaff; stroke-width: 0.8; stroke-dasharray: 2,2; fill: none; }
    .text { font-family: monospace; font-size: 8px; fill: #000; }
  </style>

  <!-- Optical Axis -->
  <line x1="0" y1="${cy}" x2="${width}" y2="${cy}" class="axis" />

  <!-- Tube Boundaries -->
  <rect x="${xTubeFront}" y="${cy - d_tube/2}" width="${tube_length}" height="${d_tube}" class="tube" />

  <!-- Light Cone -->
  <polygon points="0,${cy - d_obj/2} ${focal_length},${cy - params.d_field/2} ${focal_length},${cy + params.d_field/2} 0,${cy + d_obj/2}" class="lightcone" />

  <!-- Baffles -->
`;

  baffles.forEach((b) => {
    const x = b.z_opt;
    const rIn = b.aperture_radius;
    const rOut = d_tube / 2;

    // Top Vane
    svg += `  <line x1="${x}" y1="${cy - rOut}" x2="${x}" y2="${cy - rIn}" class="baffle" />\n`;
    // Bottom Vane
    svg += `  <line x1="${x}" y1="${cy + rIn}" x2="${x}" y2="${cy + rOut}" class="baffle" />\n`;
    // Label
    svg += `  <text x="${x + 2}" y="${cy - rOut - 3}" class="text">B${b.number}: ${b.aperture_diameter.toFixed(p)}mm @ ${b.z_tube.toFixed(p)}mm</text>\n`;
  });

  // Green Reflection Rays (Berfield Minimum Baffle Method)
  if (baffleData.greenReflectionRays && baffleData.greenReflectionRays.length > 0) {
    baffleData.greenReflectionRays.forEach(gray => {
      svg += `  <line x1="${gray.start.z_opt}" y1="${cy - gray.start.y}" x2="${gray.wallHit.z_opt}" y2="${cy - gray.wallHit.y}" stroke="#00aa55" stroke-dasharray="2,2" stroke-width="0.8" />\n`;
    });
  }

  svg += `</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'telescope_baffles_cad.svg');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportPNG(canvasElement) {
  const link = document.createElement('a');
  link.download = 'baffle_raytrace_render.png';
  link.href = canvasElement.toDataURL('image/png');
  link.click();
}
