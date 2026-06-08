const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3456;
const HTML_FILE = path.join(__dirname, 'public', 'index.html');
const LLM_API_KEY = 'sk-pifyixapbhdfdjuniwizakekksoezalquhosuyjbqwgrunma';
const LLM_API_HOST = 'api.siliconflow.cn';
const LLM_MODEL = 'deepseek-ai/DeepSeek-V3';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ti-app-id, x-ti-secret-code',
    'Access-Control-Max-Age': '86400',
};

function proxyRequest(targetUrl, req, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;

        const headers = { ...req.headers };
        delete headers.host;
        delete headers.origin;
        delete headers.referer;
        delete headers.connection;
        delete headers['accept-encoding'];
        headers['content-length'] = Buffer.byteLength(body);

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: req.method,
            headers,
        };

        const proxyReq = lib.request(options, (proxyRes) => {
            let data = [];
            proxyRes.on('data', chunk => data.push(chunk));
            proxyRes.on('end', () => {
                resolve({
                    statusCode: proxyRes.statusCode,
                    headers: proxyRes.headers,
                    body: Buffer.concat(data),
                });
            });
        });

        proxyReq.setTimeout(180000, () => {
            proxyReq.destroy(new Error('Request timeout (180s)'));
        });

        proxyReq.on('error', reject);
        proxyReq.write(body);
        proxyReq.end();
    });
}

const server = http.createServer(async (req, res) => {
    // 静态页面
    const urlPath = req.url.split('?')[0];
    if (urlPath === '/' || urlPath === '/index.html' || urlPath === '/pc.html') {
        const fileName = urlPath === '/' ? 'index.html' : urlPath.slice(1);
        const filePath = path.join(__dirname, 'public', fileName);
        try {
            const html = fs.readFileSync(filePath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch(e) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        }
        return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    // API 代理路由
    if (req.url.startsWith('/proxy/textin/')) {
        const targetUrl = 'https://api.textin.com/' + req.url.replace('/proxy/textin/', '');
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', async () => {
            body = Buffer.concat(body);
            try {
                const result = await proxyRequest(targetUrl, req, body);
                res.writeHead(result.statusCode, { ...CORS_HEADERS, 'Content-Type': result.headers['content-type'] || 'application/json' });
                res.end(result.body);
            } catch (err) {
                res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    if (req.url.startsWith('/proxy/claude/')) {
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', async () => {
            body = Buffer.concat(body);
            try {
                const reqBody = JSON.parse(body.toString());
                const messages = [];
                if (reqBody.system) messages.push({ role: 'system', content: reqBody.system });
                if (reqBody.messages) {
                    reqBody.messages.forEach(m => {
                        messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(c => c.text || '').join('') });
                    });
                }
                const openaiBody = JSON.stringify({ model: LLM_MODEL, messages, max_tokens: reqBody.max_tokens || 4096, temperature: 0.7, stream: false });
                const result = await proxyRequest('https://' + LLM_API_HOST + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LLM_API_KEY } }, Buffer.from(openaiBody));
                const openaiResp = JSON.parse(result.body.toString());
                let text = '';
                if (openaiResp.choices && openaiResp.choices[0]) text = openaiResp.choices[0].message.content || '';
                const claudeResp = { content: [{ type: 'text', text }], stop_reason: 'end_turn', model: LLM_MODEL };
                res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                res.end(JSON.stringify(claudeResp));
            } catch (err) {
                res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    if (req.url.startsWith('/proxy/cdn/')) {
        const targetUrl = 'https://cdn.jsdelivr.net/npm/' + req.url.replace('/proxy/cdn/', '');
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', async () => {
            body = Buffer.concat(body);
            try {
                const result = await proxyRequest(targetUrl, req, body);
                res.writeHead(result.statusCode, { ...CORS_HEADERS, 'Content-Type': result.headers['content-type'] || 'application/json' });
                res.end(result.body);
            } catch (err) {
                res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`AI简历助手服务已启动: http://0.0.0.0:${PORT}`);
});
