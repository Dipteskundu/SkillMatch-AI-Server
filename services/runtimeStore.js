const store = globalThis.__runtimeStore || {
  users: new Map(),
  savedJobs: new Map(),
  followedCompanies: new Map(),
};

globalThis.__runtimeStore = store;

export function upsertRuntimeUser(user) {
  const existing = store.users.get(user.firebaseUid) || {};
  const nextUser = {
    ...existing,
    ...user,
  };
  store.users.set(user.firebaseUid, nextUser);
  return nextUser;
}

export function getRuntimeUser(uid) {
  return store.users.get(uid) || null;
}

export function saveRuntimeJob(uid, jobId) {
  const current = store.savedJobs.get(uid) || new Set();
  current.add(jobId);
  store.savedJobs.set(uid, current);
  return current;
}

export function getRuntimeSavedJobs(uid) {
  return Array.from(store.savedJobs.get(uid) || []);
}

export function followRuntimeCompany(uid, companyId) {
  const current = store.followedCompanies.get(uid) || new Set();
  current.add(companyId);
  store.followedCompanies.set(uid, current);
  return current;
}
