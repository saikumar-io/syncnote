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
 * Build system and user prompt for semantic conflict resolution.
 * Requires structured JSON response detailing semantic analysis, common info, contradictions, and merge.
 */
function buildPrompt({ noteId, ancestorContent, localContent, remoteContent, localDeviceName = 'Device A', remoteDeviceName = 'Device B' }) {
  const prompt = `You are an expert semantic reconciliation engine for two conflicting versions of a Markdown note.

LOCAL VERSION:
${localContent || '(Empty note)'}

REMOTE VERSION:
${remoteContent || '(Empty note)'}

${ancestorContent ? `COMMON ANCESTOR:\n${ancestorContent}\n` : ''}
TASK AND MERGE RULES:
1. Semantic Understanding & Meaningful Merge:
   - Understand the meaning and context of both versions rather than simply choosing Local or Remote.
   - Do NOT blindly concatenate the two versions.
   - Preserve information from both versions when they are compatible and complementary.
   - Remove duplicate or repeated information.
   - Resolve wording differences naturally into coherent sentences.
   - Preserve important technical details from both versions.
2. Structure & Markdown Preservation:
   - Maintain the original Markdown structure where possible.
   - Preserve headings, lists, code blocks, links, tables, and formatting.
3. Integrity & Accuracy:
   - Do NOT invent facts or details that do not exist in either version.
   - Do NOT silently discard unique information from either version.
4. Contradiction Detection:
   - Complementary information or phrasing differences about the same subject (e.g., "MongoDB is used as the database" and "MongoDB is used to store application data. Redis is used for caching") are COMPATIBLE, NOT contradictions. In this case, "contradictions" MUST be [] (empty array) and "suggested_merge" should naturally merge both facts into a coherent note: e.g. "# Database\n\nMongoDB is used to store application data, while Redis is used for caching."
   - ONLY list items in "contradictions" if the two versions contain mutually exclusive facts that cannot both be true simultaneously (e.g., Local chooses PostgreSQL while Remote chooses MongoDB as the primary database).
   - If mutually exclusive contradictions exist, do NOT arbitrarily decide which is correct; list them in "contradictions", explain them in "semantic_analysis", and state in "suggested_merge" that user decision is required.

Respond with a JSON object conforming strictly to:
{
  "semantic_analysis": "string explaining equivalence, common points, unique facts, or contradictions",
  "common_information": ["string list of facts present in both versions"],
  "local_unique_information": ["string list of facts unique to Local"],
  "remote_unique_information": ["string list of facts unique to Remote"],
  "contradictions": ["string list of contradictory facts identified between versions, or empty array if compatible"],
  "suggested_merge": "string containing the meaningful merged note content preserving both versions, or explaining that user decision is required if mutually exclusive contradictions exist",
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
      
      let confidence = jsonParsed.confidence || (contradictions.length > 0 ? 'low' : 'high');

      // Check for direct contradictions (either detected structurally or by model)
      if (directContradiction) {
        contradictions = directContradiction.contradictions;
        mergedNote = directContradiction.suggestedMerge;
        explanation = directContradiction.semanticAnalysis;
        confidence = 'low';
      } else {
        // If not a direct structural contradiction, filter out false-positive "contradictions" where both sides agree on the subject
        if (contradictions.length > 0) {
          const lLower = (localContent || '').toLowerCase();
          const rLower = (remoteContent || '').toLowerCase();
          contradictions = contradictions.filter(c => {
            const cLower = c.toLowerCase();
            // If both local and remote agree on the tech (e.g. mongodb), differences in phrasing are complementary, not contradictions
            if (lLower.includes('mongodb') && rLower.includes('mongodb') && cLower.includes('mongodb')) {
              return false;
            }
            return true;
          });
        }

        if (contradictions.length === 0) {
          confidence = 'high';
          if ((!mergedNote || isPlaceholderMerge(mergedNote)) && complementaryMerge) {
            mergedNote = complementaryMerge;
            explanation = explanation || 'Preserved complementary useful information from both versions.';
          }
        } else {
          confidence = 'low';
          if (!mergedNote || isPlaceholderMerge(mergedNote)) {
            mergedNote = "Both versions contain different choices. User decision required.";
          }
        }
      }

      if (mergedNote && !isPlaceholderMerge(mergedNote)) {
        return {
          success: true,
          data: {
            conflictDetected: true,
            conflictType: contradictions.length > 0 ? 'contradictory' : 'compatible',
            semantic_analysis: explanation || 'Reconciled changes from both Device A and Device B.',
            semanticAnalysis: explanation || 'Reconciled changes from both Device A and Device B.',
            reasoning: explanation || 'Reconciled changes from both Device A and Device B.',
            summary: explanation ? (explanation.length > 120 ? explanation.slice(0, 117) + '...' : explanation) : 'Edits reconciled successfully.',
            common_information: commonInfo,
            commonInformation: commonInfo,
            local_unique_information: localUnique,
            localUniqueInformation: localUnique,
            remote_unique_information: remoteUnique,
            remoteUniqueInformation: remoteUnique,
            contradictions,
            confidence,
            changesFromAncestor: [
              ...localUnique.map(u => `Device A: ${u}`),
              ...remoteUnique.map(u => `Device B: ${u}`),
              ...contradictions.map(c => `Contradiction: ${c}`)
            ],
            changedSections: [],
            suggested_merge: mergedNote,
            suggestedMerge: mergedNote
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

  // Validate that a non-empty, non-placeholder merge was extracted
  if (!mergedNote || isPlaceholderMerge(mergedNote)) {
    return {
      success: false,
      reason: !mergedNote ? 'Could not extract MERGED_NOTE from response' : `Placeholder content detected: "${mergedNote}"`,
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
      common_information: [],
      commonInformation: [],
      local_unique_information: [],
      localUniqueInformation: [],
      remote_unique_information: [],
      remoteUniqueInformation: [],
      contradictions: [],
      confidence: 'high',
      changesFromAncestor: ['Device A modifications merged', 'Device B modifications merged'],
      changedSections: [],
      suggested_merge: mergedNote,
      suggestedMerge: mergedNote
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
