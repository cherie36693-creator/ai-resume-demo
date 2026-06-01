const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3456;
const HTML_FILE = path.join(__dirname, 'public', 'index.html');

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
    let targetUrl = '';
    if (req.url.startsWith('/proxy/textin/')) {
        targetUrl = 'https://api.textin.com/' + req.url.replace('/proxy/textin/', '');
    } else if (req.url.startsWith('/proxy/claude/')) {
        targetUrl = 'http://deepseek-work.intsig.net/proxy/aws/claude/bedrock/' + req.url.replace('/proxy/claude/', '');
    } else if (req.url.startsWith('/proxy/cdn/')) {
        targetUrl = 'https://cdn.jsdelivr.net/npm/' + req.url.replace('/proxy/cdn/', '');
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    // 读取请求体并转发
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
        body = Buffer.concat(body);
        try {
            const result = await proxyRequest(targetUrl, req, body);
            res.writeHead(result.statusCode, {
                ...CORS_HEADERS,
                'Content-Type': result.headers['content-type'] || 'application/json',
            });
            res.end(result.body);
        } catch (err) {
            res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`AI简历助手服务已启动: http://0.0.0.0:${PORT}`);
});
