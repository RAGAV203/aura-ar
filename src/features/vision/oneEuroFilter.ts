/**
 * One Euro filter (Casiez et al. 2012): adaptive low-pass filter that removes
 * jitter at low speeds while keeping latency low during fast movement.
 */
export class OneEuroFilter {
  private previousValue: number | null = null;
  private previousDerivative = 0;
  private previousTime: number | null = null;

  constructor(
    private minCutoff = 1.2,
    private beta = 0.02,
    private derivativeCutoff = 1,
  ) {}

  configure(minCutoff: number, beta: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  reset(): void {
    this.previousValue = null;
    this.previousDerivative = 0;
    this.previousTime = null;
  }

  /** @param timeMs timestamp in milliseconds */
  filter(value: number, timeMs: number): number {
    if (this.previousValue === null || this.previousTime === null) {
      this.previousValue = value;
      this.previousTime = timeMs;
      return value;
    }
    const dt = Math.max((timeMs - this.previousTime) / 1000, 1e-3);
    this.previousTime = timeMs;

    const derivative = (value - this.previousValue) / dt;
    const smoothedDerivative = lowPass(derivative, this.previousDerivative, alpha(this.derivativeCutoff, dt));
    this.previousDerivative = smoothedDerivative;

    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
    const result = lowPass(value, this.previousValue, alpha(cutoff, dt));
    this.previousValue = result;
    return result;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function lowPass(value: number, previous: number, a: number): number {
  return a * value + (1 - a) * previous;
}
