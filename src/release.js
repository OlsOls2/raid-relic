export function validateReleaseCommit(value, { required = false } = {}) {
  if (value === undefined && !required) return null;
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))
    throw new Error('RELEASE_COMMIT must be a full lowercase Git commit hash');
  return value;
}
