require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors()); 

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || '').split(',');

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const clientReferer = req.query.referer || ''; 

    if (!targetUrl) return res.status(400).send('URL query parameter is required');

    try {
        const parsedUrl = new URL(targetUrl);
        
        if (ALLOWED_DOMAINS[0] !== '*' && !ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
            return res.status(403).send('Domain not allowed by proxy configuration');
        }

        const isManifest = targetUrl.includes('.m3u8') || targetUrl.includes('.mpd');

        // হেডার সেট করা হচ্ছে (এখানে ক্লায়েন্ট থেকে আসা Referer ব্যবহার হবে)
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': clientReferer,
            ...(req.headers.authorization && { 'Authorization': req.headers.authorization })
        };

        // খালি হেডারগুলো বাদ দেওয়া
        Object.keys(headers).forEach(key => !headers[key] && delete headers[key]);

        const response = await axios({
            method: 'get',
            url: targetUrl,
            headers: headers,
            responseType: isManifest ? 'text' : 'stream'
        });

        res.set('Content-Type', response.headers['content-type']);

        if (isManifest) {
            let content = response.data;
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            
            // পরবর্তী চাঙ্ক রিকোয়েস্টগুলোতেও যেন Referer যায় তার জন্য URL তৈরি
            let proxyBase = `${req.protocol}://${req.get('host')}/proxy?`;
            if (clientReferer) {
                proxyBase += `referer=${encodeURIComponent(clientReferer)}&`;
            }
            proxyBase += `url=`;

            if (targetUrl.includes('.m3u8')) {
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
                const absoluteBase = new URL('.', targetUrl).href;
                const proxyAbsoluteBase = `${proxyBase}${encodeURIComponent(absoluteBase)}`;
                
                if (content.includes('<BaseURL>')) {
                    content = content.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (match, p1) => {
                        const absUrl = new URL(p1, absoluteBase).href;
                        return `<BaseURL>${proxyBase}${encodeURIComponent(absUrl)}</BaseURL>`;
                    });
                } else {
                    content = content.replace(/(<MPD[^>]*>)/, `$1\n  <BaseURL>${proxyAbsoluteBase}</BaseURL>`);
                }
                res.send(content);
            }
        } else {
            // মিডিয়া ফাইল সরাসরি স্ট্রীম করা
            response.data.pipe(res);
        }
    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(error.response ? error.response.status : 500).send('Error fetching upstream resource');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server running on http://localhost:${PORT}`));
