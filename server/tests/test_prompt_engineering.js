const http = require('http');

function postOllama(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = {
      model: 'llama3.2:1b',
      prompt,
      stream: false,
      format: 'json',
      keep_alive: '60m',
      options: {
        temperature: options.temperature || 0.1,
        num_predict: options.num_predict || 300
      }
    };
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
      timeout: 30000
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
      reject(new Error(`Timeout after ${Date.now() - start}ms`));
    });

    req.on('error', err => reject(err));
    req.write(postData);
    req.end();
  });
}

async function testPrompts() {
  const common = 'PostgreSQL is a relational database.';
  const devA = 'PostgreSQL is a powerful relational database used in enterprise applications.';
  const devB = 'PostgreSQL is an open-source database commonly used for web applications.';

  // Variation A: Clear task + direct synthesis instruction + strict one-note rule
  const promptA = `You are a conflict resolver. Merge the edits from Device A and Device B that branched from the Common Ancestor into a single coherent Markdown note.

COMMON ANCESTOR:
${common}

DEVICE A:
${devA}

DEVICE B:
${devB}

TASK:
1. Compare the actual text above.
2. If changes are compatible, combine them into ONE coherent statement (e.g. combine enterprise and web application details into a single sentence). Do NOT duplicate or prefix with "Device A:" / "Device B:".
3. If changes contradict, explain the contradiction in reasoning and give options.
4. "suggestedMerge" MUST be the actual full merged note text, never placeholders or descriptions.

Respond with JSON:
{
  "conflictDetected": true,
  "conflictType": "compatible",
  "reasoning": "Explain why these changes can be merged",
  "summary": "Short summary of differences",
  "suggestedMerge": "Full merged note text combining both changes"
}`;

  console.log('Testing Prompt A...');
  try {
    const resA = await postOllama(promptA, { num_predict: 250, temperature: 0.1 });
    console.log(`Prompt A completed in ${resA.elapsed}ms (eval: ${resA.data?.eval_count} tokens, prompt eval: ${resA.data?.prompt_eval_count} tokens)`);
    console.log('Output:\n', resA.data?.response);
    try {
      const parsed = JSON.parse(resA.data?.response);
      console.log('Parsed suggestedMerge:\n', parsed.suggestedMerge);
    } catch(e) {}
  } catch (e) {
    console.error('Prompt A error:', e.message);
  }

  // Variation B: Few-shot demonstration for the 1B model
  const promptB = `You are a conflict resolver merging concurrent edits to a Markdown note.

Example:
COMMON: Python is a programming language.
DEVICE A: Python is a popular programming language used in data science.
DEVICE B: Python is an open-source programming language used for web development.
MERGE: Python is a popular open-source programming language used in data science and web development.

Now merge this note:
COMMON ANCESTOR:
${common}

DEVICE A:
${devA}

DEVICE B:
${devB}

INSTRUCTIONS:
- Combine compatible facts into a unified note without "Device A/B" labels or placeholders.
- If contradictory, explain in reasoning.

Respond ONLY with JSON:
{
  "conflictDetected": true,
  "conflictType": "compatible",
  "reasoning": "Why this resolves the conflict",
  "summary": "Summary of differences",
  "suggestedMerge": "The complete merged note content"
}`;

  console.log('\nTesting Prompt B (with few-shot example)...');
  try {
    const resB = await postOllama(promptB, { num_predict: 250, temperature: 0.1 });
    console.log(`Prompt B completed in ${resB.elapsed}ms (eval: ${resB.data?.eval_count} tokens, prompt eval: ${resB.data?.prompt_eval_count} tokens)`);
    console.log('Output:\n', resB.data?.response);
    try {
      const parsed = JSON.parse(resB.data?.response);
      console.log('Parsed suggestedMerge:\n', parsed.suggestedMerge);
    } catch(e) {}
  } catch (e) {
    console.error('Prompt B error:', e.message);
  }
}

testPrompts();
