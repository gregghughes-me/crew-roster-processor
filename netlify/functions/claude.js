const https = require('https');

exports.handler = async function(event) {

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'Method not allowed' } })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'API key not configured' } })
    };
  }

  try {
    let body = event.body || '';
    if (event.isBase64Encoded) {
      body = Buffer.from(body, 'base64').toString('utf8');
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch(e) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: { message: 'Invalid JSON: ' + e.message } })
      };
    }

    parsed.model = 'claude-haiku-4-5-20251001';
    parsed.max_tokens = 8000;
    // Use streaming to prevent inactivity timeout
    parsed.stream = true;

    const postData = Buffer.from(JSON.stringify(parsed), 'utf8');

    const result = await new Promise(function(resolve, reject) {
      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length,
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      };

      var chunks = [];
      var req = https.request(options, function(res) {
        res.on('data', function(chunk) { chunks.push(chunk); });
        res.on('end', function() {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
      });

      req.on('error', function(e) { reject(new Error('HTTPS error: ' + e.message)); });
      req.write(postData);
      req.end();
    });

    // Parse streaming SSE response and extract full text
    var fullText = '';
    var lines = result.body.split('\n');
    lines.forEach(function(line) {
      if (line.startsWith('data: ')) {
        var data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          var evt = JSON.parse(data);
          if (evt.type === 'content_block_delta' && evt.delta && evt.delta.text) {
            fullText += evt.delta.text;
          }
        } catch(e) {}
      }
    });

    // Clean markdown fences
    fullText = fullText.trim()
      .replace(/^```json\s*/im, '').replace(/^```\s*/im, '').replace(/```\s*$/m, '').trim();
    var start = fullText.indexOf('{');
    var end = fullText.lastIndexOf('}');
    if (start >= 0 && end > start) fullText = fullText.substring(start, end + 1);

    // Return in same format as non-streaming response
    var responseObj = {
      content: [{ type: 'text', text: fullText }]
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(responseObj)
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: err.message } })
    };
  }
};
