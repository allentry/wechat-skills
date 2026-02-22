const fs = require("fs");
const path = require("path");

function readUtf8(p) {
  return fs.readFileSync(p, "utf8");
}

function listFiles(dir) {
  return fs.readdirSync(dir).map((n) => path.join(dir, n));
}

function parseSecrets(filePath) {
  const raw = readUtf8(filePath);
  const lines = raw.split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

function pickHtmlFile(dir, preferred) {
  if (preferred) return path.resolve(dir, preferred);
  const html = listFiles(dir).filter((p) => p.toLowerCase().endsWith(".html"));
  if (html.length === 1) return html[0];
  if (html.length > 1) {
    const sorted = html.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return sorted[0];
  }
  throw new Error("HTML file not found in dir");
}

function stripTagsToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleFromHtml(html, fallback) {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return fallback;
  return stripTagsToText(m[1]) || fallback;
}

function extractDigestFromHtml(html) {
  const m = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const text = m ? stripTagsToText(m[1]) : stripTagsToText(html);
  if (!text) return "";
  return text.slice(0, 120);
}

function removeFigureHeaderBlocks(html) {
  return html.replace(
    /<div[^>]*style="[^"]*overflow:\s*hidden;?[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );
}

function sanitizeTags(html) {
  const out = html
    .replace(/<figure\b/gi, "<section")
    .replace(/<\/figure>/gi, "</section>")
    .replace(/<figcaption\b/gi, "<p")
    .replace(/<\/figcaption>/gi, "</p>");
  return out
    .replace(/<p\b[^>]*>\s*<section\b/gi, "<section")
    .replace(/<\/section>\s*<\/p>/gi, "</section>");
}

function findImagePlaceholders(html) {
  return html.match(/<!--\s*IMG:\d+\s*-->/g) || [];
}

function replacePlaceholdersWithUrls(html, urls) {
  const placeholders = findImagePlaceholders(html);
  if (placeholders.length !== urls.length) {
    throw new Error(`Placeholder count ${placeholders.length} does not match urls ${urls.length}`);
  }
  let i = 0;
  return html.replace(/<!--\s*IMG:\d+\s*-->/g, () => {
    const url = urls[i++];
    const style = [
      "max-width:100%",
      "height:auto",
      "border-radius:4px",
      "margin:0",
      "display:block",
    ].join(";");
    return `<img src="${url}" alt="" style="${style}">`;
  });
}

async function wechatGetToken(appid, secret) {
  const u = new URL("https://api.weixin.qq.com/cgi-bin/token");
  u.searchParams.set("grant_type", "client_credential");
  u.searchParams.set("appid", appid);
  u.searchParams.set("secret", secret);
  const resp = await fetch(u.toString());
  const json = await resp.json();
  if (json.access_token) return json.access_token;
  throw new Error(JSON.stringify(json));
}

function mimeByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function wechatUploadPermanentImage(accessToken, filePath) {
  const u = new URL("https://api.weixin.qq.com/cgi-bin/material/add_material");
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("type", "image");

  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("media", new File([buf], path.basename(filePath), { type: mimeByExt(filePath) }));

  const resp = await fetch(u.toString(), { method: "POST", body: fd });
  const json = await resp.json();
  if (json.media_id) return json.media_id;
  throw new Error(JSON.stringify(json));
}

async function wechatUploadContentImage(accessToken, filePath) {
  const u = new URL("https://api.weixin.qq.com/cgi-bin/media/uploadimg");
  u.searchParams.set("access_token", accessToken);

  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("media", new File([buf], path.basename(filePath), { type: mimeByExt(filePath) }));

  const resp = await fetch(u.toString(), { method: "POST", body: fd });
  const json = await resp.json();
  if (json.url) return json.url;
  throw new Error(JSON.stringify(json));
}

async function wechatAddDraft(accessToken, { title, thumbMediaId, content, digest }) {
  const u = new URL("https://api.weixin.qq.com/cgi-bin/draft/add");
  u.searchParams.set("access_token", accessToken);

  const payload = {
    articles: [
      {
        title,
        thumb_media_id: thumbMediaId,
        content,
        digest,
      },
    ],
  };

  const resp = await fetch(u.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (json.media_id) return json.media_id;
  throw new Error(JSON.stringify(json));
}

function pickCoverFile(dir) {
  const p = path.join(dir, "cover.jpg");
  if (fs.existsSync(p)) return p;
  const jpg = listFiles(dir).filter((f) => path.basename(f).toLowerCase() === "cover.jpeg");
  if (jpg[0]) return jpg[0];
  throw new Error("cover.jpg not found");
}

function pickContentPics(dir) {
  const files = listFiles(dir).filter((f) => /^pic\d+\.(jpg|jpeg|png|webp)$/i.test(path.basename(f)));
  const withN = files
    .map((f) => {
      const m = path.basename(f).match(/^pic(\d+)\./i);
      return { f, n: m ? Number(m[1]) : 0 };
    })
    .sort((a, b) => a.n - b.n)
    .map((x) => x.f);
  return withN;
}

async function main() {
  const dirArg = process.argv[2];
  if (!dirArg) throw new Error("Missing article directory argument");
  const articleDir = path.resolve(dirArg);
  const htmlPath = pickHtmlFile(articleDir, process.argv[3]);

  const secretsPath = path.resolve(__dirname, "config", "secrets.md");
  if (!fs.existsSync(secretsPath)) throw new Error(`Missing secrets file: ${secretsPath}`);
  const secrets = parseSecrets(secretsPath);
  const appid = secrets.APPID;
  const appsecret = secrets.APPSECRET;
  if (!appid || !appsecret) throw new Error("APPID/APPSECRET missing in secrets.md");

  const accessToken = await wechatGetToken(appid, appsecret);

  const coverPath = pickCoverFile(articleDir);
  const thumbMediaId = await wechatUploadPermanentImage(accessToken, coverPath);

  const htmlRaw = readUtf8(htmlPath);
  const title = extractTitleFromHtml(htmlRaw, path.basename(htmlPath, path.extname(htmlPath)));
  const digest = extractDigestFromHtml(htmlRaw);

  const cleaned = sanitizeTags(removeFigureHeaderBlocks(htmlRaw));
  const placeholders = findImagePlaceholders(cleaned);
  const pics = pickContentPics(articleDir);

  const urls = [];
  for (let i = 0; i < placeholders.length; i++) {
    const picPath = pics[i];
    if (!picPath) throw new Error(`Not enough pics for placeholder ${i}`);
    const url = await wechatUploadContentImage(accessToken, picPath);
    urls.push(url);
  }

  const contentHtml = replacePlaceholdersWithUrls(cleaned, urls);
  const draftMediaId = await wechatAddDraft(accessToken, {
    title,
    thumbMediaId,
    content: contentHtml,
    digest,
  });

  const outHtmlPath = htmlPath.replace(/\.html$/i, ".wechat.html");
  fs.writeFileSync(outHtmlPath, contentHtml, "utf8");

  process.stdout.write(JSON.stringify({ draft_media_id: draftMediaId, out_html: outHtmlPath }, null, 2));
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
