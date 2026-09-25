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

async function testContradiction() {
  const common = 'My primary database is undecided.';
  const devA = 'My primary database is PostgreSQL.';
  const devB = 'My primary database is MySQL.';

  const prompt = `You are a conflict resolver. Merge the edits from Device A and Device B that branched from the Common Ancestor into a single coherent Markdown note.

COMMON ANCESTOR:
${common}

DEVICE A:
${devA}

DEVICE B:
${devB}

TASK:
1. Compare the actual text above.
2. If changes are compatible, combine them into ONE coherent statement. Do NOT duplicate or prefix with "Device A:" / "Device B:".
3. If changes contradict (e.g. mutually exclusive choices like different primary databases), DO NOT blindly combine them. Explain the contradiction in reasoning, and provide a clear suggested resolution noting the choices for user review.
4. "suggestedMerge" MUST be the actual full merged note text, never placeholders or descriptions.

Respond with JSON:
{
  "conflictDetected": true,
  "conflictType": "contradictory",
  "reasoning": "Explain why these changes contradict",
  "summary": "Short summary of differences",
  "suggestedMerge": "Suggested resolution note presenting the choices"
}`;

  console.log('Testing Contradiction with Prompt A template...');
  const res = await postOllama(prompt, { num_predict: 250, temperature: 0.1 });
  console.log(`Completed in ${res.elapsed}ms`);
  console.log('Output:\n', res.data?.response);
}

testContradiction();
