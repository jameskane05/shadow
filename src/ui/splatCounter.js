/**
 * SplatCounter - Updates splat count display
 *
 * Simply updates an existing element with the current splat count
 */

export class SplatCounter {
  constructor(element, sparkRenderer) {
    this.element = element;
    this.sparkRenderer = sparkRenderer;
  }

  /**
   * Update the splat count display
   */
  update() {
    if (!this.element || !this.sparkRenderer) return;

    // Get visible splat count from SparkRenderer's default view
    const totalSplats =
      this.sparkRenderer.defaultView?.display?.geometry?.instanceCount || 0;

    this.element.textContent = `Splats: ${totalSplats.toLocaleString()}`;
  }
}

export default SplatCounter;
