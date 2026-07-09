require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors()); // Allow frontend to access proxy

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || '').split(',');

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL query parameter is required');

    try {
        const parsedUrl = new URL(targetUrl);
        
        // Prevent open proxy abuse
        if (ALLOWED_DOMAINS[0] !== '*' && !ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
            return res.status(403).send('Domain not allowed by proxy configuration');
        }

        const isManifest = targetUrl.includes('.m3u8') || targetUrl.includes('.mpd');

        // Configure Upstream Headers
        const headers = {
            'User-Agent': process.env.CUSTOM_USER_AGENT || '',
            'Referer': process.env.CUSTOM_REFERER || '',
            'Origin': process.env.CUSTOM_ORIGIN || '',
            // Pass authorization if provided by client
            ...(req.headers.authorization && { 'Authorization': req.headers.authorization })
        };

        // Remove empty headers
        Object.keys(headers).forEach(key => !headers[key] && delete headers[key]);

        const response = await axios({
            method: 'get',
            url: targetUrl,
            headers: headers,
            responseType: isManifest ? 'text' : 'stream' // Stream media, parse manifests
        });

        res.set('Content-Type', response.headers['content-type']);

        if (isManifest) {
            let content = response.data;
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const proxyBase = `${req.protocol}://${req.get('host')}/proxy?url=`;

            if (targetUrl.includes('.m3u8')) {
                // Rewrite M3U8 URIs to pass through proxy
                const lines = content.split('\n');
                const rewritten = lines.map(line => {
                    if (line.trim() && !line.startsWith('#')) {
                        const absoluteUrl = new URL(line, baseUrl).href;
                        return `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
                    }
                    if (line.startsWith('#EXT-X-KEY:')) {
                        return line.replace(/URI="([^"]+)"/, (match, uri) => {
                            const absoluteUrl = new URL(uri, baseUrl).href;
                            return `URI="${proxyBase}${encodeURIComponent(absoluteUrl)}"`;
                        });
                    }
                    return line;
                });
                res.send(rewritten.join('\n'));

            } else if (targetUrl.includes('.mpd')) {
                // Rewrite DASH BaseURL to pass through proxy
                const absoluteBase = new URL('.', targetUrl).href;
                const proxyAbsoluteBase = `${proxyBase}${encodeURIComponent(absoluteBase)}`;
                
                if (content.includes('<BaseURL>')) {
                    content = content.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (match, p1) => {
                        const absUrl = new URL(p1, absoluteBase).href;
                        return `<BaseURL>${proxyBase}${encodeURIComponent(absUrl)}</BaseURL>`;
                    });
                } else {
                    // Inject BaseURL if missing
                    content = content.replace(/(<MPD[^>]*>)/, `$1\n  <BaseURL>${proxyAbsoluteBase}</BaseURL>`);
                }
                res.send(content);
            }
        } else {
            // Stream media chunks directly to client to avoid memory bloat
            response.data.pipe(res);
        }
    } catch (error) {
        console.error('Proxy Error:', error.message);
        const status = error.response ? error.response.status : 500;
        res.status(status).send('Error fetching upstream resource');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server running on http://localhost:${PORT}`));
