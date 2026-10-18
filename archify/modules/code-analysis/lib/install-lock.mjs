import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const OWNER_FILE = 'owner.json';

// Atomic directory creation coordinates separate Node processes. Never steal a
// timed-out lock from a live owner: it may still be installing into the shared
// directory. A lock whose recorded owner process has exited on this host (an
// interrupted install, for example Ctrl+C during the first `npm ci`) is stale
// and is removed so later starts do not wait for it.
export async function withInstallLock(root, operation, timeout = 120000) {
  const lock = path.join(fs.realpathSync(root), '.code-analysis-install.lock');
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      try { fs.writeFileSync(path.join(lock, OWNER_FILE), JSON.stringify({ pid: process.pid, host: hostId() })); }
      catch (error) { fs.rmSync(lock, { recursive: true, force: true }); throw error; }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (removeIfStale(lock)) continue;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for Code Analysis dependency installation. If no installer is running, remove ${lock} and retry.`);
      await delay(100);
    }
  }
  try { return await operation(); }
  finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

// Returns true when the lock was left by a process that no longer runs on this
// host and has been removed. Locks without a readable owner (a legacy lock, or
// one whose owner has not written its record yet) are kept.
export function removeIfStale(lock) {
  let owner;
  try { owner = JSON.parse(fs.readFileSync(path.join(lock, OWNER_FILE), 'utf8')); }
  catch { return false; }
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0 || owner.host !== hostId()) return false;
  if (processAlive(owner.pid)) return false;
  try {
    // Re-check the record just before removing so a lock that another process
    // already replaced is not taken away from its new owner.
    const current = JSON.parse(fs.readFileSync(path.join(lock, OWNER_FILE), 'utf8'));
    if (current.pid !== owner.pid || current.host !== owner.host) return false;
    fs.rmSync(lock, { recursive: true, force: true });
    return true;
  } catch { return false; }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function hostId() {
  return `${process.platform}:${os.hostname()}`;
}
