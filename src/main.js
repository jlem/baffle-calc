import { BaffleCanvasRenderer } from './canvasRenderer.js';
import { UIController } from './uiController.js';

document.addEventListener('DOMContentLoaded', () => {
  const canvasElement = document.getElementById('raytraceCanvas');
  const renderer = new BaffleCanvasRenderer(canvasElement);
  const controller = new UIController(renderer);

  // Make controller accessible globally for debugging if needed
  window.appController = controller;
});
