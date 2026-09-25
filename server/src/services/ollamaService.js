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
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '30000', 10);

  return { host, model, timeoutMs };
}

/**
 * Helper to make HTTP requests to local Ollama daemon
 */
function makeOllamaRequest(endpoint, method = 'GET', data = null, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const config = getOllamaConfig();
    const parsedUrl = new URL(endpoint, config.host);

    const postData = data ? JSON.stringify(data) : null;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Accept': 'application/json',
        ...(postData ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        } : {})
      },
      timeout: timeoutMs
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: body });
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

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Ollama request timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
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
 * Validate structured response from AI
 */
function validateConflictResolution(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, reason: 'Response is not a valid JSON object' };
  }

  if (typeof parsed.conflictDetected !== 'boolean') {
    parsed.conflictDetected = true;
  }

  if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
    parsed.summary = 'Concurrent modifications detected in both versions.';
  }

  if (!Array.isArray(parsed.changesFromAncestor)) {
    parsed.changesFromAncestor = typeof parsed.changesFromAncestor === 'string' 
      ? [parsed.changesFromAncestor] 
      : ['Device A modified note content', 'Device B modified note content'];
  }

  if (typeof parsed.suggestedMerge !== 'string') {
    return { valid: false, reason: 'Response missing required suggestedMerge text' };
  }

  if (typeof parsed.reasoning !== 'string' || !parsed.reasoning.trim()) {
    parsed.reasoning = 'Merged content based on non-contradictory semantic additions from both versions.';
  }

  return { valid: true, data: parsed };
}

/**
 * Build system and user prompt for semantic conflict resolution
 */
function buildPrompt({ noteId, ancestorContent, localContent, remoteContent, localDeviceName = 'Device A', remoteDeviceName = 'Device B' }) {
  const systemPrompt = `You are the SyncNote AI Conflict Resolver Assistant.
Your task is to analyze concurrent, independent edits made to the SAME note (note_id: "${noteId}") by two devices that branched from a common ancestor version.

Strict Requirements:
1. Understand the SEMANTIC meaning and content of the edits from the common ancestor.
2. DO NOT use filenames, titles, file paths, or device identifiers as the basis for the merge.
3. If changes are compatible and non-contradictory, combine both sets of information cleanly without redundancy.
4. If changes are contradictory (e.g., Device A states "Database uses MySQL" and Device B states "Database uses PostgreSQL"), DO NOT blindly concatenate them. Explicitly explain the contradiction in "reasoning", summarize the difference in "summary", and provide a clear, balanced suggestedMerge noting both options or framing the choice for the user.
5. The user will always review your suggestion before accepting, editing, or rejecting it.
6. You MUST respond with ONLY a single, valid JSON object matching this exact schema:

{
  "conflictDetected": true,
  "summary": "Short explanation of semantic differences",
  "changesFromAncestor": [
    "Device A changes description...",
    "Device B changes description..."
  ],
  "suggestedMerge": "Full proposed merged note content preserving both sets of useful information",
  "reasoning": "Clear rationale explaining whether changes were compatible or contradictory, and why this merge resolves the conflict"
}

Do not wrap in Markdown code fences if possible. Return only valid JSON.`;

  const userPrompt = `=== COMMON ANCESTOR VERSION ===
${ancestorContent || '(Empty base note)'}

=== ${localDeviceName.toUpperCase()} (LOCAL VERSION) ===
${localContent || '(Empty note)'}

=== ${remoteDeviceName.toUpperCase()} (REMOTE VERSION) ===
${remoteContent || '(Empty note)'}

Analyze semantic divergence from the common ancestor and provide your structured JSON resolution:`;

  return { systemPrompt, userPrompt };
}

/**
 * Generate semantic conflict analysis using local Ollama model
 */
async function generateSemanticConflictResolution({
  noteId,
  ancestorContent = '',
  localContent = '',
  remoteContent = '',
  localDeviceName = 'Device A (Local)',
  remoteDeviceName = 'Device B (Remote)'
}) {
  const config = getOllamaConfig();
  const startTime = Date.now();

  const { systemPrompt, userPrompt } = buildPrompt({
    noteId,
    ancestorContent,
    localContent,
    remoteContent,
    localDeviceName,
    remoteDeviceName
  });

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  try {
    const payload = {
      model: config.model,
      prompt: fullPrompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.2, // Low temperature for deterministic, factual merge
        num_predict: 2048
      }
    };

    const res = await makeOllamaRequest('/api/generate', 'POST', payload, config.timeoutMs);
    const latencyMs = Date.now() - startTime;

    if (!res || !res.data || !res.data.response) {
      throw new Error('Ollama returned empty response');
    }

    let parsed;
    try {
      let rawText = res.data.response.trim();
      // Remove optional markdown json code blocks if returned
      if (rawText.startsWith('```json')) {
        rawText = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
      } else if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      // Retry once with a strict formatting prompt if model output failed to parse
      console.warn(`[OllamaService] Initial JSON parse failed. Retrying with correction prompt...`);
      const correctionPrompt = `${fullPrompt}\n\nIMPORTANT: Your previous output could not be parsed as JSON. Return ONLY the JSON object, starting with { and ending with }.`;
      
      const retryRes = await makeOllamaRequest('/api/generate', 'POST', {
        model: config.model,
        prompt: correctionPrompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 2048 }
      }, config.timeoutMs);

      let retryText = (retryRes?.data?.response || '').trim();
      if (retryText.startsWith('```json')) {
        retryText = retryText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
      } else if (retryText.startsWith('```')) {
        retryText = retryText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      parsed = JSON.parse(retryText);
    }

    const validation = validateConflictResolution(parsed);
    if (!validation.valid) {
      throw new Error(`AI response failed schema validation: ${validation.reason}`);
    }

    return {
      success: true,
      available: true,
      model: config.model,
      latencyMs,
      data: validation.data
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    console.warn(`[OllamaService Notice] Local AI conflict resolution unavailable (${err.message}). Falling back to manual resolution.`);

    return {
      success: false,
      available: false,
      model: config.model,
      latencyMs,
      error: err.message,
      data: {
        conflictDetected: true,
        summary: `Concurrent edits detected. Local AI assistant is currently offline or model '${config.model}' is not ready (${err.message}).`,
        changesFromAncestor: [
          `${localDeviceName} created independent changes.`,
          `${remoteDeviceName} created independent changes.`
        ],
        suggestedMerge: localContent, // Safe fallback suggestion to local content
        reasoning: 'AI resolution unavailable. Please review versions manually and select Accept, Edit, Keep Local, or Keep Remote.'
      }
    };
  }
}

module.exports = {
  getOllamaConfig,
  checkOllamaHealth,
  validateConflictResolution,
  generateSemanticConflictResolution
};
