import express from "express";
import dns from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 12000;

app.disable("x-powered-by");
app.use(express.static("public", { extensions: ["html"] }));

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      p[0] >= 224;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    return s === "::1" || s === "::" || s.startsWith("fc") ||
      s.startsWith("fd") || s.startsWith("fe8") ||
      s.startsWith("fe9") || s.startsWith("fea") ||
      s.startsWith("feb") || s.startsWith("::ffff:127.") ||
      s.startsWith("::ffff:10.") || s.startsWith("::ffff:192.168.");
  }
  return true;
}

async function validatePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS links are supported.");
  if (url.username || url.password) throw new Error("Links containing usernames or passwords are blocked.");
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local")) throw new Error("Private and local addresses are blocked.");

  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) {
    if (isPrivateIp(literal)) throw new Error("Private network addresses are blocked.");
  } else {
    let records;
    try { records = await dns.lookup(url.hostname, { all: true, verbatim: true }); }
    catch { throw new Error("That website could not be found."); }
    if (!records.length || records.some(r => isPrivateIp(r.address))) {
      throw new Error("Private or restricted network destinations are blocked.");
    }
  }
  return url;
}

app.get("/proxy", async (req, res) => {
  let target;
  try {
    if (typeof req.query.url !== "string" || req.query.url.length > 2048) {
      return res.status(400).send("Missing or invalid URL.");
    }
    target = await validatePublicUrl(req.query.url);

    // Follow redirects manually so each destination is checked.
    let response;
    for (let hop = 0; hop < 5; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        response = await fetch(target, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": "NexusLinkProxy/1.0" }
        });
      } finally {
        clearTimeout(timer);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;
        target = await validatePublicUrl(new URL(location, target).toString());
        continue;
      }
      break;
    }

    if (!response) return res.status(502).send("The destination did not respond.");
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      return res.status(502).send("Too many redirects.");
    }

    const type = response.headers.get("content-type") || "application/octet-stream";
    if (!/(text\/html|text\/plain|application\/json|image\/|text\/css)/i.test(type)) {
      return res.status(415).send("This proxy preview supports web pages, text, JSON, CSS, and images.");
    }

    const reader = response.body?.getReader();
    if (!reader) return res.status(502).send("Empty response.");
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return res.status(413).send("That page is larger than the 8 MB preview limit.");
      }
      chunks.push(Buffer.from(value));
    }
    const body = Buffer.concat(chunks);

    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    res.set("Cache-Control", "no-store");

    if (/text\/html/i.test(type)) {
      const html = body.toString("utf8");
      const $ = cheerio.load(html);
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:|data:)/i.test(href)) return;
        try { $(el).attr("href", "/proxy?url=" + encodeURIComponent(new URL(href, target).toString())); }
        catch {}
      });
      $("form[action]").each((_, el) => {
        try {
          const action = new URL($(el).attr("action"), target).toString();
          $(el).attr("action", "/proxy?url=" + encodeURIComponent(action));
        } catch {}
      });
      $("base").remove();
      $("head").prepend(`<base href="${target.origin}/">`);
      $("head").append(`<meta name="referrer" content="no-referrer">`);
      res.type("html").send($.html());
    } else {
      res.set("Content-Type", type);
      res.send(body);
    }
  } catch (err) {
    const message = err?.name === "AbortError" ? "The website took too long to respond." : err.message;
    res.status(400).send(message || "Unable to load that link.");
  }
});

app.listen(PORT, () => console.log(`Nexus proxy listening on ${PORT}`));
