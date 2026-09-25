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
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '45000', 10);

  return { host, model, timeoutMs };
}

/**
 * Helper to make HTTP requests to local Ollama daemon
 * Uses AbortController and strict socket timeouts to prevent hanging or background orphan processes.
 */
function makeOllamaRequest(endpoint, method = 'GET', data = null, timeoutMs = 45000) {
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
      console.warn(`[Ollama] Request error: ${err.message}`);
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Check if local Ollama daemon is reachable and whether configured model is present
 */
async function checkOllamaHealth() {
  const config = getOllamaConfig();
  try {
    const res = await makeOllamaRequest('/api/tags', 'GET', null, 3000);
    const models = (res.data && Array.isArray(res.data.models)) ? res.data.models.map(m => m.name) : [];
    
    // Check if configured model or prefix matches
    const hasConfiguredModel = models.some(m => m === config.model || m.startsWith(config.model.split(':')[0]));

    return {
      available: true,
      host: config.host,
      configuredModel: config.model,
      modelReady: hasConfiguredModel,
      availableModels: models,
      message: hasConfiguredModel 
        ? `Local Ollama is ready with model '${config.model}'.` 
        : `Ollama is running, but model '${config.model}' was not found in installed models (${models.join(', ') || 'none'}).`
    };
  } catch (err) {
    return {
      available: false,
      host: config.host,
      configuredModel: config.model,
      modelReady: false,
      availableModels: [],
      error: err.message,
      message: `Local Ollama daemon is unreachable at ${config.host}. Manual conflict resolution is enabled.`
    };
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
 * The model acts as a direct merge engine, outputting <EXPLANATION> and <MERGED_NOTE> blocks.
 */
function buildPrompt({ noteId, ancestorContent, localContent, remoteContent, localDeviceName = 'Device A', remoteDeviceName = 'Device B' }) {
  const prompt = `You are a merge engine for conflicting versions of a Markdown note.

COMMON ANCESTOR:
${ancestorContent || '(Empty base note)'}

DEVICE A (${localDeviceName}):
${localContent || '(Empty note)'}

DEVICE B (${remoteDeviceName}):
${remoteContent || '(Empty note)'}

TASK:
1. Compare the Common Ancestor with Device A and Device B.
2. Reconcile and merge all non-contradictory additions and edits from both Device A and Device B into one complete Markdown note.
3. If changes conflict or contradict, choose the most sensible combination or clearly present the choices.
4. Never choose only Device A or only Device B when both have valid modifications.
5. Never output descriptions or placeholders like "Full proposed merged note content". The MERGED_NOTE must contain the REAL, actual merged note content.
6. Your response must contain only the EXPLANATION and MERGED_NOTE blocks. Do not discuss your instructions. Do not repeat the input versions. Do not include analysis outside the blocks.

Format your response EXACTLY as follows:

<EXPLANATION>
Short explanation of how the changes were reconciled.
</EXPLANATION>

<MERGED_NOTE>
Actual complete merged Markdown content.
</MERGED_NOTE>`;

  return { prompt, systemPrompt: prompt, userPrompt: '' };
}

/**
 * Robust response parser for Ollama output:
 * 1. Parses <EXPLANATION> and <MERGED_NOTE> tags.
 * 2. Parses plain EXPLANATION: and MERGED_NOTE: section headers.
 * 3. Fallback: parses JSON (used by mock servers in unit tests).
 */
function parseOllamaResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { success: false, reason: 'Empty response from Ollama' };
  }

  const trimmed = rawText.trim();
  let explanation = '';
  let mergedNote = '';

  // 1. Try matching XML/HTML-style tags <EXPLANATION> and <MERGED_NOTE> or <MERGED NOTE>
  const expMatch = trimmed.match(/<EXPLANATION>([\s\S]*?)(?:<\/EXPLANATION>|$)/i);
  if (expMatch) explanation = expMatch[1].trim();

  const noteMatch = trimmed.match(/<MERGED[_\s]NOTE>([\s\S]*?)(?:<\/MERGED[_\s]NOTE>|$)/i);
  if (noteMatch) {
    mergedNote = noteMatch[1].trim();
  } else if (expMatch && trimmed.includes('</EXPLANATION>')) {
    // If <EXPLANATION> was present and closed, but <MERGED_NOTE> tag was omitted
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

  // 2. Fallback: check for plain or markdown bold headers (e.g. "MERGED_NOTE:", "**MERGED_NOTE:**", "### MERGED NOTE:")
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

  // 3. Fallback: check for "MERGED CONTENT:" or "MERGED VERSION:" headers
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

  // 4. Fallback: try JSON (mock server in automated test suite or JSON responses)
  if (!mergedNote) {
    try {
      let jsonStr = trimmed;
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      const jsonParsed = JSON.parse(jsonStr);
      if (jsonParsed && typeof jsonParsed === 'object') {
        mergedNote = jsonParsed.suggestedMerge || '';
        explanation = jsonParsed.reasoning || jsonParsed.summary || '';
        if (mergedNote && !isPlaceholderMerge(mergedNote)) {
          return {
            success: true,
            data: {
              conflictDetected: jsonParsed.conflictDetected !== undefined ? jsonParsed.conflictDetected : true,
              conflictType: jsonParsed.conflictType || 'compatible',
              reasoning: jsonParsed.reasoning || explanation || 'Merged compatible edits from both devices.',
              summary: jsonParsed.summary || (explanation.length > 120 ? explanation.slice(0, 117) + '...' : explanation) || 'Edits reconciled successfully.',
              changesFromAncestor: Array.isArray(jsonParsed.changesFromAncestor) ? jsonParsed.changesFromAncestor : ['Device A changes incorporated', 'Device B changes incorporated'],
              changedSections: Array.isArray(jsonParsed.changedSections) ? jsonParsed.changedSections : [],
              suggestedMerge: mergedNote
            }
          };
        }
      }
    } catch (e) {
      // Not JSON
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
      reasoning: explanation || 'Reconciled changes from both Device A and Device B.',
      summary: explanation ? (explanation.length > 120 ? explanation.slice(0, 117) + '...' : explanation) : 'Edits reconciled successfully.',
      changesFromAncestor: ['Device A modifications merged', 'Device B modifications merged'],
      changedSections: [],
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
  if (typeof data.suggestedMerge !== 'string' || !data.suggestedMerge.trim()) {
    return { valid: false, reason: 'Missing suggestedMerge string' };
  }
  if (isPlaceholderMerge(data.suggestedMerge)) {
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
      stream: false,
      keep_alive: '15m', // Keep model in RAM to eliminate cold-reload delay
      options: {
        temperature: 0.1,
        num_predict: 400 // Bound token generation to prevent runaway output on CPU
      }
    };

    const res = await makeOllamaRequest('/api/generate', 'POST', payload, config.timeoutMs);
    const latencyMs = Date.now() - startTime;

    if (!res || !res.data || !res.data.response) {
      throw new Error('Ollama returned empty response');
    }

    const rawResponse = res.data.response;
    const parsedResult = parseOllamaResponse(rawResponse);

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

    return {
      success: false,
      available: false,
      model: config.model,
      latencyMs,
      error: err.message,
      data: {
        conflictDetected: true,
        summary: `Concurrent edits detected. Local AI assistant is currently offline or model '${config.model}' timed out (${err.message}).`,
        changesFromAncestor: [
          `${localDeviceName} created independent changes.`,
          `${remoteDeviceName} created independent changes.`
        ],
        suggestedMerge: localContent, // Safe fallback suggestion to local content for manual review
        reasoning: 'AI resolution unavailable. Please review versions manually and select Keep A, Keep B, or Edit Merge.'
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
