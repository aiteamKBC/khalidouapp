import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const fixture = JSON.parse(open(__ENV.KHALIDUO_LOAD_FIXTURE));
if (fixture.api !== 'http://127.0.0.1:8010/api/v1') throw new Error('Load tests require the isolated E2E API');
const users = new SharedArray('isolated users', () => fixture.users);
http.setResponseCallback(http.expectedStatuses(200, 429));
const nightly = __ENV.KHALIDUO_TEST_PROFILE === 'nightly';
export const options = {
  vus: nightly ? 20 : 3,
  duration: nightly ? '90s' : '12s',
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
  },
};

let sessionId;
let startedAt;
function post(url, body, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = http.post(url, body, params);
    if (response.status !== 429 || attempt === 3) return response;
    sleep(2);
  }
}
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.floor(Math.random() * 16);
  return (c === 'x' ? r : ((r & 3) | 8)).toString(16);
});

export default function () {
  const user = users[__VU - 1];
  if (!user) throw new Error('Every virtual user needs a distinct seeded device');
  const params = { headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' }, timeout: '15s' };
  if (!sessionId) {
    startedAt = Date.now() - 120000;
    const start = post(`${fixture.api}/agent/sessions/start`, JSON.stringify({ started_at: new Date(startedAt).toISOString() }), params);
    check(start, { 'session starts': r => r.status === 200 });
    if (start.status !== 200) return;
    sessionId = start.json('data.session.id');
  }
  const payload = JSON.stringify({
    event_id: uuid(), timestamp: new Date().toISOString(), status: 'active',
    active_seconds: Math.floor((Date.now() - startedAt) / 1000), idle_seconds: 0, agent_version: '9.9.9',
  });
  const first = post(`${fixture.api}/agent/sessions/${sessionId}/heartbeat`, payload, params);
  const duplicate = post(`${fixture.api}/agent/sessions/${sessionId}/heartbeat`, payload, params);
  check(first, { 'heartbeat succeeds': r => r.status === 200 });
  check(duplicate, {
    'replay succeeds': r => r.status === 200,
    'replay is idempotent': r => r.status === 200 && r.json('data.duplicate') === true,
    'replay preserves work': r => r.status === 200 && first.status === 200 && r.json('data.session.active_seconds') === first.json('data.session.active_seconds'),
  });
  sleep(0.2);
}
