/**
 * A fake clock for timer tests: a number the test moves by hand.
 *
 * The timer never reads the system clock, so this is the whole time surface.
 */
export function createFakeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
      return current;
    },
    set(ms) {
      current = ms;
      return current;
    },
  };
}
