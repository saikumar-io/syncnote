const http = require('http');

function postOllama(payload, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const start = Date.now();

    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const elapsed = Date.now() - start;
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, elapsed, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, elapsed, raw: body });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out after ${Date.now() - start}ms`));
    });

    req.on('error', err => reject(err));
    req.write(postData);
    req.end();
  });
}

async function runBenchmarks() {
  console.log('--- BENCHMARK 1: Simple Prompt ("Say hello in one sentence.") ---');
  try {
    const res1 = await postOllama({
      model: 'llama3.2:1b',
      prompt: 'Say hello in one sentence.',
      stream: false
    });
    console.log(`B1 Completed in: ${res1.elapsed}ms | Eval count: ${res1.data?.eval_count} | Speed: ${(res1.data?.eval_count / (res1.data?.eval_duration / 1e9)).toFixed(1)} t/s`);
    console.log(`B1 Response: "${res1.data?.response?.trim()}"\n`);
  } catch (e) {
    console.error(`B1 Error:`, e.message);
  }

  console.log('--- BENCHMARK 2: "Explain PostgreSQL in one sentence." ---');
  try {
    const res2 = await postOllama({
      model: 'llama3.2:1b',
      prompt: 'Explain PostgreSQL in one sentence.',
      stream: false
    });
    console.log(`B2 Completed in: ${res2.elapsed}ms | Eval count: ${res2.data?.eval_count} | Speed: ${(res2.data?.eval_count / (res2.data?.eval_duration / 1e9)).toFixed(1)} t/s`);
    console.log(`B2 Response: "${res2.data?.response?.trim()}"\n`);
  } catch (e) {
    console.error(`B2 Error:`, e.message);
  }

  console.log('--- BENCHMARK 3: Actual Conflict with Current Prompt (format: json, num_predict: 2048) ---');
  const common = 'PostgreSQL is a relational database.';
  const devA = 'PostgreSQL is a powerful relational database used in enterprise applications.';
  const devB = 'PostgreSQL is an open-source database commonly used for web applications.';

  const currentPrompt = `You are resolving a version conflict in a Markdown note.

You are given:
1. A common ancestor.
2. The complete version from Device A.
3. The complete version from Device B.

Compare the actual contents.
Produce a single coherent merged note.
Preserve useful information from both versions when the changes are compatible.
If both versions express the same information differently, combine them into one clear statement instead of duplicating them.
If the changes are contradictory, do not invent facts or blindly combine contradictory claims. Explain the contradiction and provide a safe suggested resolution for the user.
Do not describe the merge process instead of producing the merged note.

The suggestedMerge field MUST contain the actual final Markdown note content.
Never output placeholders.
Never output text like "Full proposed merged note content...", "Device A changes description...", "[insert merged content]", or generic descriptions of what the merge should contain.

You MUST respond with ONLY a single, valid JSON object matching this schema:
{
  "conflictDetected": true,
  "conflictType": "compatible",
  "summary": "Brief summary of semantic differences",
  "changesFromAncestor": ["Specific change from Device A", "Specific change from Device B"],
  "changedSections": ["Name of modified section"],
  "suggestedMerge": "The actual full text of the merged Markdown note",
  "reasoning": "Clear explanation of whether changes are compatible or contradictory, and why this merge resolves the conflict"
}

Do not wrap in Markdown code fences if possible. Return only valid JSON.

=== COMMON ANCESTOR ===
${common}

=== DEVICE A (DEVICE A) ===
${devA}

=== DEVICE B (DEVICE B) ===
${devB}

Compare the actual contents above and provide your structured JSON resolution with the ACTUAL FULL MERGED NOTE in suggestedMerge:`;

  try {
    const res3 = await postOllama({
      model: 'llama3.2:1b',
      prompt: currentPrompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.2,
        num_predict: 2048
      }
    });
    console.log(`B3 Completed in: ${res3.elapsed}ms | Prompt eval: ${res3.data?.prompt_eval_count} (${(res3.data?.prompt_eval_duration / 1e9).toFixed(2)}s) | Eval: ${res3.data?.eval_count} (${(res3.data?.eval_duration / 1e9).toFixed(2)}s)`);
    console.log(`B3 Response:\n${res3.data?.response}\n`);
  } catch (e) {
    console.error(`B3 Error:`, e.message);
  }

  console.log('--- BENCHMARK 4: Optimized Lean Prompt (num_predict: 500, prompt_eval optimized) ---');
  const leanPrompt = `Resolve the version conflict between Device A and Device B for this Markdown note.

COMMON ANCESTOR:
${common}

DEVICE A:
${devA}

DEVICE B:
${devB}

INSTRUCTIONS:
1. Merge compatible changes into one clear note.
2. If contradictory, explain in reasoning and offer options.
3. The suggestedMerge MUST be the complete merged Markdown note content (never placeholders).

Return ONLY valid JSON in this format:
{
  "conflictDetected": true,
  "conflictType": "compatible",
  "summary": "...",
  "changesFromAncestor": ["..."],
  "suggestedMerge": "...",
  "reasoning": "..."
}`;

  try {
    const res4 = await postOllama({
      model: 'llama3.2:1b',
      prompt: leanPrompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.2,
        num_predict: 500
      }
    });
    console.log(`B4 Completed in: ${res4.elapsed}ms | Prompt eval: ${res4.data?.prompt_eval_count} (${(res4.data?.prompt_eval_duration / 1e9).toFixed(2)}s) | Eval: ${res4.data?.eval_count} (${(res4.data?.eval_duration / 1e9).toFixed(2)}s)`);
    console.log(`B4 Response:\n${res4.data?.response}\n`);
  } catch (e) {
    console.error(`B4 Error:`, e.message);
  }
}

runBenchmarks();
