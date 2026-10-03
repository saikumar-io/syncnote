const http = require('http');

/**
 * Modular Local Ollama AI Service for SyncNote
 * 
 * Interacts exclusively with local Ollama HTTP API (default: http://127.0.0.1:11434).
 * Completely offline-first and private; never sends note contents to external cloud LLM APIs.
 */

// Configurable via environment variables
function getOllamaConfig() {
  const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2:1b';
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10);

  return { host, model, timeoutMs };
}

/**
 * Helper to make HTTP requests to local Ollama daemon
 * Uses AbortController and strict socket timeouts to prevent hanging or background orphan processes.
 */
function makeOllamaRequest(endpoint, method = 'GET', data = null, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const config = getOllamaConfig();
    const parsedUrl = new URL(endpoint, config.host);

    const postData = data ? JSON.stringify(data) : null;
    const startTime = Date.now();

    // Safe diagnostic logging (never logs note content)
    if (endpoint.includes('/generate') && data) {
      console.log(`[Ollama] Request start`);
      console.log(`Model: ${data.model || config.model}`);
      console.log(`Prompt chars: ${data.prompt ? data.prompt.length : 0}`);
      if (postData) console.log(`Payload size: ${Buffer.byteLength(postData)} bytes`);
    }

    const controller = new AbortController();
    let isSettled = false;

    const timeoutId = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      const elapsed = Date.now() - startTime;
      console.warn(`[Ollama] Request timed out after ${elapsed}ms (configured limit: ${timeoutMs}ms)`);
      try {
        controller.abort();
      } catch (e) {}
      reject(new Error(`Ollama request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...(postData ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        } : {})
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;
        if (endpoint.includes('/generate')) {
          console.log(`[Ollama] Response received`);
          console.log(`Status: ${res.statusCode}`);
          console.log(`Duration: ${duration} ms`);
          console.log(`Response chars: ${body.length}`);
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            resolve({ statusCode: res.statusCode, data: parsed, duration });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: body, duration });
          }
        } else {
          let errData;
          try {
            errData = JSON.parse(body);
          } catch (e) {
            errData = { message: body };
          }
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${errData.error || errData.message || res.statusMessage}`));
        }
      });
    });

    req.on('error', (err) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutId);
      if (err.code !== 'ECONNREFUSED') {
        console.warn(`[Ollama] Request error: ${err.message}`);
      }
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

let cachedOllamaHealth = null;
let lastOllamaCheckAt = 0;
const OLLAMA_OFFLINE_CACHE_MS = 30000; // 30 seconds
let lastLoggedOllamaState = null;

/**
 * Check if local Ollama daemon is reachable and whether configured model is present
 * Includes caching and backoff to avoid continuous network attempt spam when offline.
 */
async function checkOllamaHealth(forceCheck = false) {
  const config = getOllamaConfig();

  // If previously checked and was offline, return cached offline state until cache expires or forced
  if (!forceCheck && cachedOllamaHealth && !cachedOllamaHealth.available && (Date.now() - lastOllamaCheckAt < OLLAMA_OFFLINE_CACHE_MS)) {
    return cachedOllamaHealth;
  }

  try {
    const res = await makeOllamaRequest('/api/tags', 'GET', null, 2500);
    const models = (res.data && Array.isArray(res.data.models)) ? res.data.models.map(m => m.name) : [];
    
    // Check if configured model or prefix matches
    const hasConfiguredModel = models.some(m => m === config.model || m.startsWith(config.model.split(':')[0]));

    if (lastLoggedOllamaState !== 'ONLINE') {
      console.log(`[Ollama] Service is ONLINE at ${config.host}`);
      lastLoggedOllamaState = 'ONLINE';
    }

    cachedOllamaHealth = {
      available: true,
      status: 'ONLINE',
      host: config.host,
      configuredModel: config.model,
      modelReady: hasConfiguredModel,
      availableModels: models,
      message: hasConfiguredModel 
        ? `Local Ollama is ready with model '${config.model}'.` 
        : `Ollama is running, but model '${config.model}' was not found in installed models (${models.join(', ') || 'none'}).`
    };
    lastOllamaCheckAt = Date.now();
    return cachedOllamaHealth;
  } catch (err) {
    if (lastLoggedOllamaState !== 'OFFLINE') {
      console.log(`[Ollama] Service unavailable at ${config.host} (offline)`);
      lastLoggedOllamaState = 'OFFLINE';
    }

    cachedOllamaHealth = {
      available: false,
      status: 'OFFLINE',
      host: config.host,
      configuredModel: config.model,
      modelReady: false,
      availableModels: [],
      error: err.code === 'ECONNREFUSED' ? 'ECONNREFUSED' : err.message,
      message: 'Ollama is offline. Start Ollama to use local AI features.'
    };
    lastOllamaCheckAt = Date.now();
    return cachedOllamaHealth;
  }
}

/**
 * Helper to check if text contains placeholder markers
 */
function isPlaceholderMerge(text) {
  if (!text || typeof text !== 'string') return true;
  const lower = text.toLowerCase().trim();
  if (lower.length === 0) return true;
  const placeholders = [
    'full proposed merged',
    'changes description',
    'semantic divergence between',
    '[insert',
    'proposed merged note content',
    'insert merged content',
    '<write the complete',
    'placeholder'
  ];
  return placeholders.some(p => lower.includes(p));
}

/**
 * Robust semantic extraction of sentences/paragraphs and headings
 */
function extractSemanticUnits(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const units = [];
  let currentParagraph = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentParagraph.length > 0) {
        units.push({ type: 'paragraph', text: currentParagraph.join(' ') });
        currentParagraph = [];
      }
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
      if (currentParagraph.length > 0) {
        units.push({ type: 'paragraph', text: currentParagraph.join(' ') });
        currentParagraph = [];
      }
      units.push({ type: trimmed.startsWith('#') ? 'header' : 'list_item', text: trimmed });
    } else {
      currentParagraph.push(trimmed);
    }
  }
  if (currentParagraph.length > 0) {
    units.push({ type: 'paragraph', text: currentParagraph.join(' ') });
  }

  // Also extract sentence units from paragraphs
  const result = [];
  for (const u of units) {
    if (u.type === 'paragraph') {
      const sentences = u.text.split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 0);
      for (const s of sentences) {
        result.push({ text: s.trim(), type: 'sentence' });
      }
    } else {
      result.push({ text: u.text.trim(), type: u.type });
    }
  }
  return result;
}

/**
 * Grounded Information Classifier
 * Enforces strict ground-truth classification between Common, Local-only, Remote-only, and Contradictions.
 */
function groundInformationClassification(localText = '', remoteText = '', modelData = {}) {
  const localUnits = extractSemanticUnits(localText);
  const remoteUnits = extractSemanticUnits(remoteText);

  const normalize = (t) => t.toLowerCase().replace(/^[#\s\-*]+/, '').replace(/[.,!?;:]+$/, '').trim();

  const localNorms = localUnits.map(u => ({ raw: u.text, norm: normalize(u.text), type: u.type }));
  const remoteNorms = remoteUnits.map(u => ({ raw: u.text, norm: normalize(u.text), type: u.type }));

  const common = [];
  const localUnique = [];
  const remoteUnique = [];

  // Identify common information explicitly present in both versions
  for (const l of localNorms) {
    if (l.norm.length < 3) continue;
    const match = remoteNorms.find(r => r.norm === l.norm || (l.norm.length > 10 && (r.norm.includes(l.norm) || l.norm.includes(r.norm))));
    if (match) {
      if (!common.some(c => normalize(c) === l.norm)) {
        common.push(l.raw);
      }
    } else {
      if (l.type !== 'header') {
        localUnique.push(l.raw);
      }
    }
  }

  for (const r of remoteNorms) {
    if (r.norm.length < 3) continue;
    const isCommon = common.some(c => normalize(c) === r.norm);
    if (!isCommon && r.type !== 'header') {
      if (!remoteUnique.some(u => normalize(u) === r.norm)) {
        remoteUnique.push(r.raw);
      }
    }
  }

  // Filter contradictions: discard hallucinations (technologies or words absent from source texts)
  const lTextLower = (localText || '').toLowerCase();
  const rTextLower = (remoteText || '').toLowerCase();

  let rawContradictions = Array.isArray(modelData.contradictions) ? modelData.contradictions : [];
  const validContradictions = rawContradictions.filter(c => {
    if (typeof c !== 'string') return false;
    const cLower = c.toLowerCase();
    const hallucinatedTech = ['mongodb', 'redis', 'postgres', 'postgresql', 'mysql'].filter(t => 
      cLower.includes(t) && !lTextLower.includes(t) && !rTextLower.includes(t)
    );
    if (hallucinatedTech.length > 0) return false;
    return true;
  });

  return {
    common,
    localUnique,
    remoteUnique,
    contradictions: validContradictions
  };
}

/**
 * Grounded Semantic Merge Builder
 * Generates merged document strictly grounded in the original LOCAL and REMOTE note contents.
 */
function buildGroundedSemanticMerge(localText = '', remoteText = '', modelMergeText = null) {
  const lClean = (localText || '').trim();
  const rClean = (remoteText || '').trim();
  if (!lClean) return rClean;
  if (!rClean) return lClean;
  if (lClean === rClean) return lClean;

  const localUnits = extractSemanticUnits(lClean);
  const remoteUnits = extractSemanticUnits(rClean);

  const normalize = (t) => t.toLowerCase().replace(/^[#\s\-*]+/, '').replace(/[.,!?;:]+$/, '').trim();

  // If model provided a valid, non-placeholder merge:
  if (modelMergeText && typeof modelMergeText === 'string') {
    const trimmed = modelMergeText.trim();
    const lower = trimmed.toLowerCase();
    const isPlaceholder = lower.includes('complete merged') || 
                          lower.includes('placeholder') || 
                          lower.includes('insert merged') ||
                          lower.includes('<write') ||
                          trimmed.length < 15;
    
    // Check if model merge hallucinated tech not in either text
    const techWords = ['mongodb', 'redis', 'postgres', 'postgresql', 'mysql'];
    const hasHallucination = techWords.some(t => lower.includes(t) && !lClean.toLowerCase().includes(t) && !rClean.toLowerCase().includes(t));

    // Check if model merge contains meaningful facts from both
    const localStatements = localUnits.filter(u => u.type !== 'header').map(u => u.text);
    const remoteStatements = remoteUnits.filter(u => u.type !== 'header').map(u => u.text);

    const hasLocal = localStatements.some(s => lower.includes(normalize(s).slice(0, 20)));
    const hasRemote = remoteStatements.some(s => lower.includes(normalize(s).slice(0, 20)));

    if (!isPlaceholder && !hasHallucination && (hasLocal || localStatements.length === 0) && (hasRemote || remoteStatements.length === 0)) {
      // Clean meta labels like "REMOTE VERSION:", "LOCAL VERSION:"
      let cleaned = trimmed
        .replace(/(?:^|\n)\s*(?:LOCAL|REMOTE)\s+VERSION:?\s*(?:\r?\n)?/gi, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Deduplicate identical repeated headings
      const cleanLines = cleaned.split(/\r?\n/);
      const dedupedLines = [];
      const seenHeadings = new Set();
      for (const line of cleanLines) {
        const t = line.trim();
        if (t.startsWith('#')) {
          const normH = normalize(t);
          if (seenHeadings.has(normH)) {
            continue;
          }
          seenHeadings.add(normH);
        }
        dedupedLines.push(line);
      }
      cleaned = dedupedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

      // Ensure any missing statement from either version is preserved
      let finalDoc = cleaned;
      for (const s of localStatements) {
        if (!finalDoc.toLowerCase().includes(normalize(s))) {
          finalDoc += `\n\n${s}`;
        }
      }
      for (const s of remoteStatements) {
        if (!finalDoc.toLowerCase().includes(normalize(s))) {
          finalDoc += `\n\n${s}`;
        }
      }
      return finalDoc.trim();
    }
  }

  // Deterministic seamless merge preserving document structure
  const linesL = lClean.split(/\r?\n/);
  const linesR = rClean.split(/\r?\n/);

  const mergedLines = [];
  const seenNorm = new Set();

  const addLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (mergedLines.length > 0 && mergedLines[mergedLines.length - 1] !== '') {
        mergedLines.push('');
      }
      return;
    }
    const norm = normalize(trimmed);
    if (!seenNorm.has(norm)) {
      seenNorm.add(norm);
      mergedLines.push(trimmed);
    }
  };

  for (const l of linesL) addLine(l);
  for (const r of linesR) addLine(r);

  return mergedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Build system and user prompt for semantic conflict resolution.
 * Requires structured JSON response detailing semantic analysis, common info, contradictions, and merge.
 */
function buildPrompt({ noteId, ancestorContent, localContent, remoteContent, localDeviceName = 'Device A', remoteDeviceName = 'Device B' }) {
  const prompt = `You are an expert semantic reconciliation engine for two conflicting versions of a Markdown note.

CRITICAL INSTRUCTIONS & STRICT GROUNDING:
1. Strict Grounding:
   - Compare ONLY the actual factual content provided in the LOCAL and REMOTE note versions below.
   - The original note contents are the absolute source of truth.
   - The AI MUST NOT invent facts, technologies, databases, caches, features, target audiences, or performance claims.
   - Do NOT introduce any technology or detail not present in either version (e.g. do NOT mention MongoDB, Redis, PostgreSQL, MySQL, caching, or unstated architectures).
   - "Not mentioned" is NOT false and NOT a contradiction. Missing or non-overlapping details are complementary, NOT contradictory.

2. Information Classification:
   - "common_information": ONLY facts explicitly stated in BOTH versions or genuinely semantically equivalent in both.
   - "local_unique_information": ONLY facts from the LOCAL version not in the remote version.
   - "remote_unique_information": ONLY facts from the REMOTE version not in the local version.
   - "contradictions": ONLY mutually exclusive incompatible assertions about the exact SAME subject. If the two versions describe different features or compatible aspects of the application, they are complementary and "contradictions" MUST be [] (empty array). Do NOT invent contradictions.

3. Suggested Merge Content:
   - "suggested_merge" MUST be generated directly from the ORIGINAL LOCAL and ORIGINAL REMOTE note contents.
   - Preserve ALL meaningful facts and details from BOTH versions.
   - Maintain the original Markdown structure, headings, and formatting.
   - "suggested_merge" MUST contain ONLY the final Markdown note content.
   - Do NOT include explanations, instructions, JSON, analysis, or meta-commentary inside "suggested_merge".

LOCAL VERSION:
${localContent || '(Empty note)'}

REMOTE VERSION:
${remoteContent || '(Empty note)'}

${ancestorContent ? `COMMON ANCESTOR:\n${ancestorContent}\n` : ''}
Respond with a JSON object conforming strictly to:
{
  "semantic_analysis": "string explaining equivalence, common points, unique facts, or compatibility",
  "common_information": ["facts present in both versions"],
  "local_unique_information": ["facts unique to local"],
  "remote_unique_information": ["facts unique to remote"],
  "contradictions": [],
  "suggested_merge": "final merged markdown note content",
  "confidence": "high or low"
}`;

  return { prompt, systemPrompt: prompt, userPrompt: '' };
}

/**
 * Detect explicit semantic contradictions between conflicting notes (e.g. mutually exclusive database choices)
 */
function detectSemanticContradiction(localText = '', remoteText = '') {
  const l = (localText || '').trim();
  const r = (remoteText || '').trim();
  if (!l || !r || l === r) return null;

  // Incompatible choices across known categories
  const techPairs = [
    ['mongodb', 'postgresql', 'database'],
    ['mongo', 'postgres', 'database'],
    ['mysql', 'postgres', 'database'],
    ['mysql', 'postgresql', 'database'],
    ['sqlite', 'mongodb', 'database'],
    ['sqlite', 'postgresql', 'database'],
    ['react', 'vue', 'frontend framework'],
    ['angular', 'react', 'frontend framework'],
    ['dev', 'prod', 'environment'],
    ['staging', 'production', 'environment']
  ];

  const lLower = l.toLowerCase();
  const rLower = r.toLowerCase();

  for (const [t1, t2, category] of techPairs) {
    const lHas1 = lLower.includes(t1);
    const lHas2 = lLower.includes(t2);
    const rHas1 = rLower.includes(t1);
    const rHas2 = rLower.includes(t2);

    if ((lHas1 && !lHas2 && rHas2 && !rHas1) || (lHas2 && !lHas1 && rHas1 && !rHas2)) {
      const localChoice = lHas1 ? t1 : t2;
      const remoteChoice = lHas1 ? t2 : t1;
      const localPretty = localChoice.charAt(0).toUpperCase() + localChoice.slice(1);
      const remotePretty = remoteChoice.charAt(0).toUpperCase() + remoteChoice.slice(1);
      const categoryMsg = category ? ` ${category}` : '';
      return {
        contradictions: [
          `Local says ${localPretty}.`,
          `Remote says ${remotePretty}.`,
          `The statements contain contradictory information.`
        ],
        suggestedMerge: `Both versions contain different${categoryMsg} choices. User decision required.`,
        semanticAnalysis: `Conflict:\n- Local says ${localPretty}.\n- Remote says ${remotePretty}.\n- The statements contain contradictory information.`
      };
    }
  }

  // Parallel single-sentence statements with same prefix but differing distinct final tokens
  const lWords = l.split(/\s+/);
  const rWords = r.split(/\s+/);
  if (lWords.length >= 3 && rWords.length >= 3 && Math.abs(lWords.length - rWords.length) <= 2) {
    let commonPrefixCount = 0;
    while (
      commonPrefixCount < lWords.length &&
      commonPrefixCount < rWords.length &&
      lWords[commonPrefixCount].toLowerCase() === rWords[commonPrefixCount].toLowerCase()
    ) {
      commonPrefixCount++;
    }
    if (commonPrefixCount >= Math.min(lWords.length, rWords.length) - 2 && commonPrefixCount >= 2) {
      const lDiff = lWords.slice(commonPrefixCount).join(' ').replace(/[.,!?;:]+$/, '');
      const rDiff = rWords.slice(commonPrefixCount).join(' ').replace(/[.,!?;:]+$/, '');
      if (lDiff && rDiff && lDiff.toLowerCase() !== rDiff.toLowerCase()) {
        // If not an addition (neither is a substring of the other)
        if (!rDiff.toLowerCase().includes(lDiff.toLowerCase()) && !lDiff.toLowerCase().includes(rDiff.toLowerCase())) {
          return {
            contradictions: [
              `Local says ${lDiff}.`,
              `Remote says ${rDiff}.`,
              `The statements contain contradictory information.`
            ],
            suggestedMerge: `Both versions contain different choices. User decision required.`,
            semanticAnalysis: `Conflict:\n- Local says ${lDiff}.\n- Remote says ${rDiff}.\n- The statements contain contradictory information.`
          };
        }
      }
    }
  }

  return null;
}

/**
 * Detect additive / complementary containment between versions (e.g. one adds Redis caching to MongoDB)
 */
function detectComplementaryMerge(localText = '', remoteText = '') {
  const l = (localText || '').trim();
  const r = (remoteText || '').trim();
  if (!l || !r || l === r) return null;

  const lClean = l.replace(/[.,!?;:]+$/, '').trim();
  const rClean = r.replace(/[.,!?;:]+$/, '').trim();

  // If one contains the other as a substring
  if (rClean.toLowerCase().includes(lClean.toLowerCase())) {
    return rClean.endsWith('.') ? rClean : rClean + '.';
  }
  if (lClean.toLowerCase().includes(rClean.toLowerCase())) {
    return lClean.endsWith('.') ? lClean : lClean + '.';
  }

  return null;
}

/**
 * Robust response parser for Ollama output:
 * 1. Primary: parses structured JSON conforming to the semantic reconciliation schema.
 * 2. Fallback: parses <EXPLANATION> and <MERGED_NOTE> tags.
 * 3. Fallback: parses plain EXPLANATION: and MERGED_NOTE: section headers.
 */
function parseOllamaResponse(rawText, { localContent = '', remoteContent = '' } = {}) {
  if (!rawText || typeof rawText !== 'string') {
    return { success: false, reason: 'Empty response from Ollama' };
  }

  const trimmed = rawText.trim();
  const directContradiction = detectSemanticContradiction(localContent, remoteContent);
  const complementaryMerge = detectComplementaryMerge(localContent, remoteContent);

  // Helper to normalize array or string fields
  const normalizeList = (val) => {
    if (!val) return [];
    if (typeof val === 'string') {
      const vTrim = val.trim();
      if (!vTrim || /^(none|n\/a|no contradictions?|\[\s*\])$/i.test(vTrim)) return [];
      try {
        const parsed = JSON.parse(vTrim);
        if (Array.isArray(parsed)) return normalizeList(parsed);
      } catch (e) {}
      return [vTrim];
    }
    if (Array.isArray(val)) {
      return val
        .map(v => typeof v === 'string' ? v.trim() : JSON.stringify(v))
        .filter(v => v.length > 0 && !/^(none|n\/a|no contradictions?|\[\s*\])$/i.test(v));
    }
    return [];
  };

  // 1. Primary: try JSON parsing
  try {
    let jsonStr = trimmed;
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    const jsonParsed = JSON.parse(jsonStr);
    if (jsonParsed && typeof jsonParsed === 'object') {
      let mergedNote = jsonParsed.suggested_merge || jsonParsed.suggestedMerge || '';
      
      // If mergedNote is stringified JSON, unwrap it
      if (typeof mergedNote === 'string' && (mergedNote.trim().startsWith('{') || mergedNote.includes('"semantic_analysis"'))) {
        try {
          const innerJson = JSON.parse(mergedNote);
          if (innerJson && typeof innerJson === 'object') {
            mergedNote = innerJson.suggested_merge || innerJson.suggestedMerge || mergedNote;
          }
        } catch (e) {}
      }

      let explanation = jsonParsed.semantic_analysis || jsonParsed.semanticAnalysis || jsonParsed.reasoning || jsonParsed.summary || '';
      const commonInfo = normalizeList(jsonParsed.common_information || jsonParsed.commonInformation);
      const localUnique = normalizeList(jsonParsed.local_unique_information || jsonParsed.localUniqueInformation);
      const remoteUnique = normalizeList(jsonParsed.remote_unique_information || jsonParsed.remoteUniqueInformation);
      let contradictions = normalizeList(jsonParsed.contradictions);

      // Apply strict ground-truth classification
      const groundedClass = groundInformationClassification(localContent, remoteContent, {
        commonInfo,
        localUnique,
        remoteUnique,
        contradictions
      });

      const commonInfoFinal = groundedClass.common;
      const localUniqueFinal = groundedClass.localUnique;
      const remoteUniqueFinal = groundedClass.remoteUnique;
      let contradictionsFinal = groundedClass.contradictions;
      
      let confidence = jsonParsed.confidence || (contradictionsFinal.length > 0 ? 'low' : 'high');

      // Check for direct contradictions (either detected structurally or by model)
      if (directContradiction) {
        contradictionsFinal = directContradiction.contradictions;
        mergedNote = directContradiction.suggestedMerge;
        explanation = directContradiction.semanticAnalysis;
        confidence = 'low';
      } else {
        if (contradictionsFinal.length === 0) {
          confidence = 'high';
        } else {
          confidence = 'low';
        }
      }

      // Strictly ground the suggested merge from original local & remote note contents
      let finalSuggestedMerge = buildGroundedSemanticMerge(localContent, remoteContent, mergedNote);
      if (contradictionsFinal.length > 0 && directContradiction) {
        finalSuggestedMerge = directContradiction.suggestedMerge;
      }

      if (finalSuggestedMerge && !isPlaceholderMerge(finalSuggestedMerge)) {
        return {
          success: true,
          data: {
            conflictDetected: true,
            conflictType: contradictionsFinal.length > 0 ? 'contradictory' : 'compatible',
            semantic_analysis: explanation || 'Reconciled changes from both Device A and Device B.',
            semanticAnalysis: explanation || 'Reconciled changes from both Device A and Device B.',
            reasoning: explanation || 'Reconciled changes from both Device A and Device B.',
            summary: explanation ? (explanation.length > 120 ? explanation.slice(0, 117) + '...' : explanation) : 'Edits reconciled successfully.',
            common_information: commonInfoFinal,
            commonInformation: commonInfoFinal,
            local_unique_information: localUniqueFinal,
            localUniqueInformation: localUniqueFinal,
            remote_unique_information: remoteUniqueFinal,
            remoteUniqueInformation: remoteUniqueFinal,
            contradictions: contradictionsFinal,
            confidence,
            changesFromAncestor: [
              ...localUniqueFinal.map(u => `Device A: ${u}`),
              ...remoteUniqueFinal.map(u => `Device B: ${u}`),
              ...contradictionsFinal.map(c => `Contradiction: ${c}`)
            ],
            changedSections: [],
            suggested_merge: finalSuggestedMerge,
            suggestedMerge: finalSuggestedMerge
          }
        };
      }
    }
  } catch (e) {
    // Not JSON, continue to fallback parsers
  }

  let explanation = '';
  let mergedNote = '';

  // 2. Fallback: Try matching XML/HTML-style tags <EXPLANATION> and <MERGED_NOTE> or <MERGED NOTE>
  const expMatch = trimmed.match(/<EXPLANATION>([\s\S]*?)(?:<\/EXPLANATION>|$)/i);
  if (expMatch) explanation = expMatch[1].trim();

  const noteMatch = trimmed.match(/<MERGED[_\s]NOTE>([\s\S]*?)(?:<\/MERGED[_\s]NOTE>|$)/i);
  if (noteMatch) {
    mergedNote = noteMatch[1].trim();
  } else if (expMatch && trimmed.includes('</EXPLANATION>')) {
    const afterExp = trimmed.slice(trimmed.indexOf('</EXPLANATION>') + '</EXPLANATION>'.length).trim();
    if (afterExp) {
      const cleanedAfter = afterExp
        .replace(/^(?:#+\s*|\*{1,2})?(?:here is the |proposed |final )?merged (?:note|markdown|version|content)[:\s]*/i, '')
        .replace(/^```(?:markdown)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      if (cleanedAfter && !isPlaceholderMerge(cleanedAfter)) {
        mergedNote = cleanedAfter;
      }
    }
  }

  // 3. Fallback: check for plain headers (e.g. "MERGED_NOTE:", "**MERGED_NOTE:**")
  if (!mergedNote) {
    const textBlocksMatch = trimmed.match(/(?:^|\n)\s*(?:#+\s*|\*{1,2})?(?:<\s*)?MERGED[_\s]NOTE(?:\s*>)?(?:\*{1,2})?[:\s]*([\s\S]*)$/i);
    if (textBlocksMatch) {
      mergedNote = textBlocksMatch[1].trim();
    }
  }

  if (!explanation) {
    const expBlocksMatch = trimmed.match(/(?:^|\n)\s*(?:#+\s*|\*{1,2})?(?:<\s*)?EXPLANATION(?:\s*>)?(?:\*{1,2})?[:\s]*([\s\S]*?)(?=(?:^|\n)\s*(?:#+\s*|\*{1,2})?(?:<\s*)?MERGED[_\s]NOTE|$)/i);
    if (expBlocksMatch) {
      explanation = expBlocksMatch[1].trim();
    }
  }

  // 4. Fallback: check for "MERGED CONTENT:" or "MERGED VERSION:" headers
  if (!mergedNote) {
    const anyMergedHeaderMatch = trimmed.match(/(?:^|\n)\s*(?:#+\s*|\*{1,2})?(?:MERGED\s+CONTENT|MERGED\s+VERSION|FINAL\s+NOTE)[:\s]*([\s\S]*)$/i);
    if (anyMergedHeaderMatch) {
      mergedNote = anyMergedHeaderMatch[1].trim();
    }
  }

  // Clean up any trailing closing tags or outer code fences if present
  if (mergedNote) {
    mergedNote = mergedNote.replace(/<\/MERGED[_\s]NOTE>\s*$/i, '').trim();
    if (mergedNote.startsWith('```markdown')) {
      mergedNote = mergedNote.replace(/^```markdown\s*/i, '').replace(/\s*```$/, '').trim();
    } else if (mergedNote.startsWith('```')) {
      mergedNote = mergedNote.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }
  }

  // 5. Fallback: if model outputted the merged note directly without tags or "explanation"
  if (!mergedNote && !trimmed.toLowerCase().includes('explanation') && !isPlaceholderMerge(trimmed)) {
    mergedNote = trimmed;
    explanation = 'Merged note generated directly.';
  }

  const groundedClassFallback = groundInformationClassification(localContent, remoteContent, {
    contradictions: []
  });
  const groundedMergeFallback = buildGroundedSemanticMerge(localContent, remoteContent, mergedNote);

  // Validate that a non-empty, non-placeholder merge was extracted
  if (!groundedMergeFallback || isPlaceholderMerge(groundedMergeFallback)) {
    return {
      success: false,
      reason: !groundedMergeFallback ? 'Could not extract MERGED_NOTE from response' : `Placeholder content detected: "${groundedMergeFallback}"`,
      raw: rawText
    };
  }

  return {
    success: true,
    data: {
      conflictDetected: true,
      conflictType: 'compatible',
      semantic_analysis: explanation || 'Reconciled changes from both Device A and Device B.',
      semanticAnalysis: explanation || 'Reconciled changes from both Device A and Device B.',
      reasoning: explanation || 'Reconciled changes from both Device A and Device B.',
      summary: explanation ? (explanation.length > 120 ? explanation.slice(0, 117) + '...' : explanation) : 'Edits reconciled successfully.',
      common_information: groundedClassFallback.common,
      commonInformation: groundedClassFallback.common,
      local_unique_information: groundedClassFallback.localUnique,
      localUniqueInformation: groundedClassFallback.localUnique,
      remote_unique_information: groundedClassFallback.remoteUnique,
      remoteUniqueInformation: groundedClassFallback.remoteUnique,
      contradictions: [],
      confidence: 'high',
      changesFromAncestor: ['Device A modifications merged', 'Device B modifications merged'],
      changedSections: [],
      suggested_merge: groundedMergeFallback,
      suggestedMerge: groundedMergeFallback
    }
  };
}

/**
 * Validate conflict resolution data object structure
 */
function validateConflictResolution(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, reason: 'Invalid data object' };
  }
  const merge = data.suggested_merge || data.suggestedMerge;
  if (typeof merge !== 'string' || !merge.trim()) {
    return { valid: false, reason: 'Missing suggested_merge string' };
  }
  if (isPlaceholderMerge(merge)) {
    return { valid: false, reason: 'suggestedMerge contains placeholder text' };
  }
  return { valid: true, data };
}

/**
 * Generate semantic conflict analysis using local Ollama model
 */
async function generateSemanticConflictResolution({
  noteId,
  ancestorContent = '',
  localContent = '',
  remoteContent = '',
  localDeviceName = 'Device A',
  remoteDeviceName = 'Device B'
}) {
  console.log('[Ollama]\nStarting conflict analysis');
  const config = getOllamaConfig();
  const startTime = Date.now();

  const { prompt } = buildPrompt({
    noteId,
    ancestorContent,
    localContent,
    remoteContent,
    localDeviceName,
    remoteDeviceName
  });

  try {
    const payload = {
      model: config.model,
      prompt,
      format: 'json',
      stream: false,
      keep_alive: '15m', // Keep model in RAM to eliminate cold-reload delay
      options: {
        temperature: 0.1,
        num_predict: 500 // Bound token generation to prevent runaway output on CPU
      }
    };

    const res = await makeOllamaRequest('/api/generate', 'POST', payload, config.timeoutMs);
    const latencyMs = Date.now() - startTime;

    if (!res || !res.data || !res.data.response) {
      throw new Error('Ollama returned empty response');
    }

    const rawResponse = res.data.response;
    const parsedResult = parseOllamaResponse(rawResponse, { localContent, remoteContent });

    if (!parsedResult.success) {
      console.warn(`[Ollama] Parse error: ${parsedResult.reason}`);
      throw new Error(`AI response parsing failed: ${parsedResult.reason}`);
    }

    console.log(`[Ollama] Parsed merge successfully`);
    console.log(`Merged chars: ${parsedResult.data.suggestedMerge.length}`);
    console.log('[Ollama]\nConflict analysis completed');

    return {
      success: true,
      available: true,
      model: config.model,
      latencyMs,
      data: parsedResult.data
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    console.warn(`[OllamaService Notice] Local AI conflict resolution unavailable (${err.message}). Falling back to manual resolution.`);
    console.log('[Ollama]\nConflict analysis completed');

    const fallbackSummary = `Concurrent edits detected. Local AI assistant is currently offline or model '${config.model}' timed out (${err.message}).`;
    return {
      success: false,
      available: false,
      model: config.model,
      latencyMs,
      error: err.message,
      data: {
        conflictDetected: true,
        semantic_analysis: fallbackSummary,
        semanticAnalysis: fallbackSummary,
        summary: fallbackSummary,
        reasoning: 'AI resolution unavailable. Please review versions manually and select Keep Local, Keep Remote, or Edit & Accept.',
        common_information: [],
        commonInformation: [],
        local_unique_information: [`${localDeviceName} created independent changes.`],
        localUniqueInformation: [`${localDeviceName} created independent changes.`],
        remote_unique_information: [`${remoteDeviceName} created independent changes.`],
        remoteUniqueInformation: [`${remoteDeviceName} created independent changes.`],
        contradictions: [],
        confidence: 'low',
        changesFromAncestor: [
          `${localDeviceName} created independent changes.`,
          `${remoteDeviceName} created independent changes.`
        ],
        suggested_merge: 'AI suggestion unavailable',
        suggestedMerge: 'AI suggestion unavailable'
      }
    };
  }
}

/**
 * Diagnostic test helper: Test the SAME makeOllamaRequest path with a simple prompt
 */
async function testOllamaConnection(testPrompt = 'Say hello in one sentence.') {
  const config = getOllamaConfig();
  const payload = {
    model: config.model,
    prompt: testPrompt,
    stream: false,
    keep_alive: '15m',
    options: {
      temperature: 0.1,
      num_predict: 100
    }
  };

  const res = await makeOllamaRequest('/api/generate', 'POST', payload, 15000);
  return {
    status: res.statusCode,
    durationMs: res.duration,
    response: res.data?.response?.trim()
  };
}

module.exports = {
  getOllamaConfig,
  checkOllamaHealth,
  validateConflictResolution,
  parseOllamaResponse,
  generateSemanticConflictResolution,
  buildPrompt,
  makeOllamaRequest,
  testOllamaConnection
};
