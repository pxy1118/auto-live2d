export type MotionStyle = 'restrained' | 'natural' | 'lively';
export const DEFAULT_MOTION_STYLE: MotionStyle = 'lively';
/** Frequency and execution envelope. Gesture/body joint trajectories come from the
 * authored catalog; the continuous background trajectory comes from the learned
 * continuous branch. */
export const motionStyles = {
  restrained: {head: .5, body: .4, arm: 1, gap: 6000, bodyGap: 4000, duration: 3200},
  natural: {head: .75, body: .7, arm: 1, gap: 5000, bodyGap: 3200, duration: 3200},
  lively: {head: 1, body: 1, arm: 1.04, gap: 4000, bodyGap: 2600, duration: 3400},
};
