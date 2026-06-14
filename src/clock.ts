/**
 * Injectable clock. Production uses `systemClock`; tests inject a fake so that
 * latency assertions (e.g. panel-runner timeouts) are deterministic.
 */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();
