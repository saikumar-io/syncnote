const crypto = require('crypto');

/**
 * Bounded LRU Cache for reconstructed note versions (in-memory optimization)
 */
class BoundedLRUCache {
  constructor(capacity = 100) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    // Refresh LRU order
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict oldest (least recently used) key
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

// Global bounded LRU cache instance
const versionCache = new BoundedLRUCache(100);

/**
 * Compute line-based diff hunks between oldText and newText
 */
function computeLineDiffHunks(oldText = '', newText = '') {
  const normOld = (oldText || '').replace(/\r\n/g, '\n');
  const normNew = (newText || '').replace(/\r\n/g, '\n');

  const lines1 = normOld === '' ? [] : normOld.split('\n');
  const lines2 = normNew === '' ? [] : normNew.split('\n');

  const m = lines1.length;
  const n = lines2.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (lines1[i] === lines2[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = 0;
  let j = 0;
  const edits = [];

  while (i < m || j < n) {
    if (i < m && j < n && lines1[i] === lines2[j]) {
      edits.push({ type: 'equal', line: lines1[i] });
      i++;
      j++;
    } else if (i < m && (j >= n || dp[i + 1][j] >= dp[i][j + 1])) {
      edits.push({ type: 'remove', line: lines1[i] });
      i++;
    } else {
      edits.push({ type: 'add', line: lines2[j] });
      j++;
    }
  }

  const hunks = [];
  let oldLineIdx = 0;
  let currentHunk = null;

  for (const edit of edits) {
    if (edit.type === 'equal') {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      oldLineIdx++;
    } else {
      if (!currentHunk) {
        currentHunk = {
          oldStart: oldLineIdx,
          oldCount: 0,
          removed: [],
          added: []
        };
      }
      if (edit.type === 'remove') {
        currentHunk.oldCount++;
        currentHunk.removed.push(edit.line);
        oldLineIdx++;
      } else if (edit.type === 'add') {
        currentHunk.added.push(edit.line);
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Apply diff hunks to oldText lines to produce newText
 */
function applyLineDiffHunks(oldText = '', hunks = []) {
  const normOld = (oldText || '').replace(/\r\n/g, '\n');
  const lines = normOld === '' ? [] : normOld.split('\n');

  // Apply hunks in reverse order to preserve line indices
  const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

  for (const hunk of sortedHunks) {
    lines.splice(hunk.oldStart, hunk.oldCount, ...hunk.added);
  }

  return lines.join('\n');
}

/**
 * Reconstruct text for a target version ID by walking up parent chain
 */
function reconstructVersionContent(targetVersionId, VersionModel, userId = 'usr_local_default') {
  if (!targetVersionId) return '';

  const cacheKey = `${userId}:${targetVersionId}`;

  // 1. Check cache first
  const cached = versionCache.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  // 2. Fetch full ancestor chain back to base V1
  const versionChain = [];
  let currId = targetVersionId;

  while (currId) {
    const ver = VersionModel.getById(currId, userId);
    if (!ver) break;
    versionChain.unshift(ver); // Put oldest (V1) first
    currId = ver.parent_version_id;
  }

  if (versionChain.length === 0) {
    throw new Error(`Version ${targetVersionId} not found`);
  }

  // 3. Reconstruct sequentially starting from base ""
  let currentContent = '';
  for (const ver of versionChain) {
    const ancestorCacheKey = `${userId}:${ver.id}`;
    // Check if intermediate version is already cached
    const ancestorCached = versionCache.get(ancestorCacheKey);
    if (ancestorCached !== null && ancestorCached !== undefined) {
      currentContent = ancestorCached;
      continue;
    }

    const diffRecord = VersionModel.getDiffByVersionId(ver.id, userId);
    const hunks = diffRecord && diffRecord.diff_data ? JSON.parse(diffRecord.diff_data) : [];
    currentContent = applyLineDiffHunks(currentContent, hunks);

    // Cache intermediate reconstructed state
    versionCache.set(ancestorCacheKey, currentContent);
  }

  return currentContent;
}

/**
 * Format line-by-line diff view data between parent and version
 */
function getDiffViewData(targetVersionId, VersionModel, userId = 'usr_local_default') {
  const targetVer = VersionModel.getById(targetVersionId, userId);
  if (!targetVer) throw new Error(`Version ${targetVersionId} not found`);

  let parentContent = '';
  if (targetVer.parent_version_id) {
    parentContent = reconstructVersionContent(targetVer.parent_version_id, VersionModel, userId);
  }

  const targetContent = reconstructVersionContent(targetVersionId, VersionModel, userId);

  const normOld = (parentContent || '').replace(/\r\n/g, '\n');
  const normNew = (targetContent || '').replace(/\r\n/g, '\n');

  const lines1 = normOld === '' ? [] : normOld.split('\n');
  const lines2 = normNew === '' ? [] : normNew.split('\n');

  const m = lines1.length;
  const n = lines2.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (lines1[i] === lines2[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = 0;
  let j = 0;
  const diffLines = [];
  let additionsCount = 0;
  let deletionsCount = 0;

  while (i < m || j < n) {
    if (i < m && j < n && lines1[i] === lines2[j]) {
      diffLines.push({ type: 'unchanged', text: lines1[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (i < m && (j >= n || dp[i + 1][j] >= dp[i][j + 1])) {
      diffLines.push({ type: 'removed', text: lines1[i], oldLine: i + 1, newLine: null });
      deletionsCount++;
      i++;
    } else {
      diffLines.push({ type: 'added', text: lines2[j], oldLine: null, newLine: j + 1 });
      additionsCount++;
      j++;
    }
  }

  return {
    version: targetVer,
    stats: { additions: additionsCount, deletions: deletionsCount },
    lines: diffLines
  };
}

/**
 * Get ordered chain of ancestor version IDs from target back to root
 */
function getAncestorChain(startVersionId, VersionModel, userId = 'usr_local_default') {
  if (!startVersionId) return [];
  const chain = [];
  const visited = new Set();
  let currId = startVersionId;

  while (currId && !visited.has(currId)) {
    visited.add(currId);
    chain.push(currId);
    const ver = VersionModel.getById(currId, userId);
    if (!ver || !ver.parent_version_id) break;
    currId = ver.parent_version_id;
  }

  return chain;
}

/**
 * Find the Lowest Common Ancestor (LCA) version ID between two version trees
 */
function findCommonAncestor(versionIdA, versionIdB, VersionModel, userId = 'usr_local_default') {
  if (!versionIdA || !versionIdB) return null;
  if (versionIdA === versionIdB) return versionIdA;

  const chainA = getAncestorChain(versionIdA, VersionModel, userId);
  const setA = new Set(chainA);

  const chainB = getAncestorChain(versionIdB, VersionModel, userId);
  for (const bId of chainB) {
    if (setA.has(bId)) {
      return bId;
    }
  }

  return null;
}

/**
 * Determine ancestry relationship between two version IDs:
 * - 'EQUAL': same version
 * - 'A_ANCESTOR_OF_B': Version B is a direct descendant of A (Fast-forward)
 * - 'B_ANCESTOR_OF_A': Version A is a direct descendant of B (Fast-forward)
 * - 'CONCURRENT_DIVERGENCE': Both branched from a common ancestor (Conflict!)
 * - 'NO_COMMON_ANCESTOR': Independent lineages
 */
function detectAncestryRelationship(versionIdA, versionIdB, VersionModel, userId = 'usr_local_default') {
  if (!versionIdA || !versionIdB) {
    return { relationship: 'NO_COMMON_ANCESTOR', commonAncestorId: null };
  }

  if (versionIdA === versionIdB) {
    return { relationship: 'EQUAL', commonAncestorId: versionIdA };
  }

  const chainA = getAncestorChain(versionIdA, VersionModel, userId);
  const chainB = getAncestorChain(versionIdB, VersionModel, userId);

  const setA = new Set(chainA);
  const setB = new Set(chainB);

  // If A is in B's ancestor chain, B is a direct descendant of A (fast-forward)
  if (setB.has(versionIdA)) {
    return { relationship: 'A_ANCESTOR_OF_B', commonAncestorId: versionIdA };
  }

  // If B is in A's ancestor chain, A is a direct descendant of B (fast-forward)
  if (setA.has(versionIdB)) {
    return { relationship: 'B_ANCESTOR_OF_A', commonAncestorId: versionIdB };
  }

  // Find lowest common ancestor in tree
  for (const bId of chainB) {
    if (setA.has(bId)) {
      return { relationship: 'CONCURRENT_DIVERGENCE', commonAncestorId: bId };
    }
  }

  return { relationship: 'NO_COMMON_ANCESTOR', commonAncestorId: null };
}

module.exports = {
  versionCache,
  computeLineDiffHunks,
  applyLineDiffHunks,
  reconstructVersionContent,
  getDiffViewData,
  getAncestorChain,
  findCommonAncestor,
  detectAncestryRelationship
};
