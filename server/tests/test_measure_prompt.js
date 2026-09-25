const http = require('http');
const { buildPrompt, getOllamaConfig } = require('../src/services/ollamaService');

async function testConflictPrompt() {
  const commonAncestor = 'PostgreSQL is a relational database.';
  const localContent = 'PostgreSQL is a powerful relational database used in enterprise applications.';
  const remoteContent = 'PostgreSQL is an open-source database commonly used for web applications.';

  const { systemPrompt, userPrompt } = buildPrompt({
    noteId: 'note_test_123',
    ancestorContent: commonAncestor,
    localContent,
    remoteContent,
    localDeviceName: 'Device A',
    remoteDeviceName: 'Device B'
  });

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  console.log(`[Diagnostic] System prompt chars: ${systemPrompt.length}`);
  console.log(`[Diagnostic] User prompt chars: ${userPrompt.length}`);
  console.log(`[Diagnostic] Full prompt chars: ${fullPrompt.length}`);

  // Test 1: Exact payload as currently in ollamaService.js
  const payload = {
    model: 'llama3.2:1b',
    prompt: fullPrompt,
    stream: false,
    format: 'json',
    options: {
      temperature: 0.2,
      num_predict: 2048
    }
  };

  const postData = JSON.stringify(payload);
  console.log(`[Diagnostic] Request payload bytes: ${Buffer.byteLength(postData)}`);
  console.log(`[Diagnostic] Sending to http://127.0.0.1:11434/api/generate...`);

  const startTime = Date.now();

  const req = http.request({
    hostname: '127.0.0.1',
    port: 11434,
    path: '/api/generate',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 60000 // allow up to 60s to measure actual duration
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      const elapsed = Date.now() - startTime;
      console.log(`[Diagnostic] Response received in ${elapsed}ms! HTTP ${res.statusCode}`);
      console.log(`[Diagnostic] Raw response length: ${body.length}`);
      try {
        const parsed = JSON.parse(body);
        console.log(`[Diagnostic] Model: ${parsed.model}`);
        console.log(`[Diagnostic] Total duration from Ollama: ${(parsed.total_duration / 1e9).toFixed(2)}s`);
        console.log(`[Diagnostic] Load duration: ${(parsed.load_duration / 1e9).toFixed(2)}s`);
        console.log(`[Diagnostic] Prompt eval count: ${parsed.prompt_eval_count}`);
        console.log(`[Diagnostic] Prompt eval duration: ${(parsed.prompt_eval_duration / 1e9).toFixed(2)}s`);
        console.log(`[Diagnostic] Eval count: ${parsed.eval_count}`);
        console.log(`[Diagnostic] Eval duration: ${(parsed.eval_duration / 1e9).toFixed(2)}s`);
        console.log(`[Diagnostic] Model Output response:\n${parsed.response}`);
      } catch (e) {
        console.log(`[Diagnostic] Body:`, body);
      }
    });
  });

  req.on('timeout', () => {
    console.error(`[Diagnostic] Request timed out after ${Date.now() - startTime}ms`);
    req.destroy();
  });

  req.on('error', (err) => {
    console.error(`[Diagnostic] Request error:`, err.message);
  });

  req.write(postData);
  req.end();
}

testConflictPrompt();
