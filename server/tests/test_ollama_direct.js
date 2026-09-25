const http = require('http');

console.log('[Test Ollama] Probing http://127.0.0.1:11434/api/tags...');

const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`[Test Ollama] /api/tags status: ${res.statusCode}`);
    console.log(`[Test Ollama] Models:`, data);
    testGenerate();
  });
});

req.on('error', (err) => {
  console.error('[Test Ollama] /api/tags failed:', err.message);
});

function testGenerate() {
  console.log('[Test Ollama] Probing POST /api/generate with simple prompt...');
  const start = Date.now();
  const payload = JSON.stringify({
    model: 'llama3.2:1b',
    prompt: 'Say hello in one sentence.',
    stream: false
  });

  const postReq = http.request({
    hostname: '127.0.0.1',
    port: 11434,
    path: '/api/generate',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 30000
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`[Test Ollama] /api/generate finished in ${Date.now() - start}ms with HTTP ${res.statusCode}`);
      console.log(`[Test Ollama] Response length: ${body.length}`);
      try {
        const parsed = JSON.parse(body);
        console.log(`[Test Ollama] Response text: "${parsed.response?.trim()}"`);
      } catch (e) {
        console.log(`[Test Ollama] Raw response:`, body);
      }
    });
  });

  postReq.on('timeout', () => {
    console.error(`[Test Ollama] /api/generate TIMED OUT after ${Date.now() - start}ms`);
    postReq.destroy();
  });

  postReq.on('error', (err) => {
    console.error('[Test Ollama] /api/generate error:', err.message);
  });

  postReq.write(payload);
  postReq.end();
}
