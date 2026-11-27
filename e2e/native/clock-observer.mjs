import readline from 'node:readline';
import { TrackingClock } from '../../frontend/desktop-agent/electron/services/trackingClock.ts';
import { trackingTick } from '../../frontend/desktop-agent/electron/services/trackingTick.ts';

const clock = new TrackingClock();
clock.observeServerTime(new Date().toISOString());
let tick = clock.elapsedMs();
let worked = 0;
setInterval(() => {
  const next = trackingTick(tick, clock.elapsedMs());
  tick = next.nextTickMs;
  worked += next.elapsedSeconds;
}, 1000).unref();
const input = readline.createInterface({ input: process.stdin });
input.on('line', () => process.stdout.write(JSON.stringify({
  os: Date.now(), utc: clock.nowMs(), elapsed: clock.elapsedMs(), worked,
}) + '\n'));
