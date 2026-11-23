# NEXUS Link Proxy

A small Node.js website that lets visitors enter a public HTTP/HTTPS URL and fetches it through your server.

## Deploy online (Render)

1. Create a GitHub repository and upload the contents of this folder.
2. Sign in to Render and choose **New → Web Service**.
3. Connect the repository.
4. Set **Runtime** to Node, **Build Command** to `npm install`, and **Start Command** to `npm start`.
5. Deploy. Render will give you a public `onrender.com` address.

You can also deploy to another Node.js host that supports Node 20+.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Important limitations

This is a lightweight page-fetching proxy, not a complete browser or an anonymity service. Some websites will not work because they require login, complex JavaScript, cookies, anti-bot checks, or special browser APIs. Some site assets and navigation may not behave exactly as they do in a normal browser.

Do not use this as an unrestricted public proxy. Before sharing it publicly, add rate limiting, abuse monitoring, a clear acceptable-use policy, and hosting-provider safeguards. Never add credentials or ask visitors to enter passwords into proxied pages. The server blocks private/local destinations, limits redirects, request time, and response size, but this starter is not a security-audited production service.
