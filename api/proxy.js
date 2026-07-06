// api/proxy.js
export default async function handler(req, res) {
    // 1. Configure CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url, referer, user_agent } = req.query;

    if (!url) {
        return res.status(400).json({ error: "Missing 'url' parameter" });
    }

    try {
        // 2. Prepare headers for the target server
        const fetchHeaders = new Headers();
        
        if (referer) {
            fetchHeaders.append('Referer', referer);
        }
        
        if (user_agent) {
            fetchHeaders.append('User-Agent', user_agent);
        } else {
            fetchHeaders.append('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        }

        // 3. Fetch data from target URL
        const response = await fetch(url, {
            method: 'GET',
            headers: fetchHeaders,
            redirect: 'follow'
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Server returned status ${response.status}` });
        }

        // 4. Pass Content-Type to the frontend
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        // 5. Send the stream/data back to the player
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        return res.status(200).send(buffer);

    } catch (error) {
        return res.status(500).json({ error: "Failed to fetch stream", details: error.message });
    }
}
