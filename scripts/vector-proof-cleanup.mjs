import {ChildProcess} from 'node:child_process';

function budget(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) {
    throw new TypeError('Cleanup budget must be an integer from 1 to 10000 ms.');
  }
  return value;
}

// Attach immediately after spawn. Only the caller's actual ChildProcess is used;
// never accept a PID, signal a process group, restart a service, or delete data.
export function trackProofRuntime(child, {graceMs = 1000, forceMs = 1000} = {}) {
  if (!(child instanceof ChildProcess)) throw new TypeError('An owned ChildProcess is required.');
  budget(graceMs); budget(forceMs);
  let closed = false, errorCode = null, wake = null, stopPromise = null, complete = false;
  const ended = () => closed || child.exitCode !== null || child.signalCode !== null ||
    (errorCode !== null && !child.pid);
  function detach() {
    child.off('exit', onChange); child.off('close', onClose); child.off('error', onError);
  }
  function onChange() { if (wake) wake(); if (complete && ended()) detach(); }
  function onClose() { closed = true; onChange(); }
  function onError(error) {
    errorCode = /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'CHILD_PROCESS_ERROR';
    onChange();
  }
  child.on('exit', onChange); child.on('close', onClose); child.on('error', onError);

  function phase(signal, timeoutMs) {
    return new Promise(resolve => {
      let timer, settled = false;
      const finish = () => {
        if (settled) return;
        settled = true; clearTimeout(timer); if (wake === observed) wake = null; resolve();
      };
      const observed = () => { if (ended()) finish(); };
      wake = observed;
      timer = setTimeout(finish, timeoutMs);
      if (ended()) return finish();
      try { child.kill(signal); } catch (error) { onError(error); }
      observed();
    });
  }

  return function stopRuntime() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      let forced = false;
      if (!ended()) await phase('SIGTERM', graceMs);
      if (!ended()) { forced = true; await phase('SIGKILL', forceMs); }
      const stopped = ended();
      complete = true;
      if (stopped) detach(); // Otherwise retain error observation until the owned child ends.
      return {stopped, forced, exitCode: child.exitCode, signalCode: child.signalCode,
        errorCode: stopped ? errorCode : 'RUNTIME_STOP_TIMEOUT'};
    })();
    return stopPromise;
  };
}

async function bounded(action, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action).then(value => ({ok: true, value}), () => ({ok: false, code: 'CLEANUP_FAILED'})),
      new Promise(resolve => { timer = setTimeout(() => resolve({ok: false, code: 'CLEANUP_TIMEOUT'}), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

// Cleanup success is NOT a successful browser test. Return failures without
// replacing the original exception or logging error text/credentials/screenshots.
export async function cleanupProofResources({context, browser, stopRuntime} = {}, {timeoutMs = 3000} = {}) {
  budget(timeoutMs);
  const failures = [];
  for (const [component, resource] of [['context', context], ['browser', browser]]) {
    if (!resource) continue;
    const result = await bounded(() => resource.close(), timeoutMs);
    if (!result.ok) failures.push({component, code: result.code});
  }
  const runtime = await bounded(() => {
    if (typeof stopRuntime !== 'function') throw Error('Missing owned runtime cleanup.');
    return stopRuntime();
  }, timeoutMs);
  const runtimeStopped = runtime.ok && runtime.value?.stopped === true;
  if (!runtimeStopped) failures.push({component: 'runtime', code: runtime.code || 'RUNTIME_STOP_UNCONFIRMED'});
  return {status: failures.length ? 'FAIL' : 'PASS', runtimeStopped, failures};
}
