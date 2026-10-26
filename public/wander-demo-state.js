// Public fictional recording fixture. No production policy, clock or authority.
export function freshWanderDemo() {
  return {
    hours: 0,
    stage: 'parked',
    holder: 'fixture_keeper',
    rings: 9,
    streak: 3,
    warning: false,
    moved: false,
  };
}
export function wanderDemoStep(previous, action) {
  const s = { ...previous };
  if (action === 'reset') return freshWanderDemo();
  if (action === 'warn' && !s.moved) {
    s.hours = 60;
    s.stage = 'warning';
    s.warning = true;
  }
  if (action === 'move' && s.warning && !s.moved) {
    s.hours = 72;
    s.stage = 'wandered';
    s.moved = true;
    s.holder = 'fixture_seeker';
    s.rings++;
    s.streak = 0;
  }
  return s;
}
