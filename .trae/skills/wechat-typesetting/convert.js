const fs = require("fs");
const path = require("path");

function readUtf8(p) {
  return fs.readFileSync(p, "utf8");
}

function stripFrontmatter(md) {
  const m = md.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/);
  if (m) return md.slice(m[0].length);
  return md;
}

function extractTitle(md, fallback) {
  const m = md.match(/^#\s+(.+)\s*$/m);
  if (m) return m[1].trim();
  return fallback;
}

function autoPickTheme(md, title) {
  const text = `${title}\n${md}`.toLowerCase();
  const codeBlocks = (md.match(/```/g) || []).length / 2;
  const inlineCode = (md.match(/`[^`\n]+`/g) || []).length;
  const links = (md.match(/\bhttps?:\/\/\S+/g) || []).length;
  const cmds = (md.match(/\b(npm|pip|curl|clawhub|git)\b/gi) || []).length;
  const bullets = (md.match(/^\s*[-*+]\s+/gm) || []).length;
  const headings = (md.match(/^\s*#{1,6}\s+/gm) || []).length;

  const cyberKw = /\b(赛博|朋克|黑客|攻防|渗透|漏洞|安全|hack|hacker|security)\b/i;
  const chinaKw = /\b(中国风|国风|传统|古典|诗词|国学|汉服|书法|山水|唐宋)\b/i;
  const sportKw = /\b(运动|跑步|健身|训练|肌肉|燃脂|赛事|配速|力量)\b/i;

  if (cyberKw.test(text)) return "赛博朋克";
  if (chinaKw.test(text)) return "中国风";
  if (sportKw.test(text)) return "运动风";

  const techScore = codeBlocks * 3 + inlineCode * 0.5 + links * 1 + cmds * 2 + bullets * 0.6 + headings * 0.4;
  const proseScore = Math.max(0, text.length / 800 - (codeBlocks + cmds + bullets / 10));

  if (techScore >= 8) return "字节范";
  if (proseScore >= 3 && techScore < 6) return "苹果范";
  return "默认主题";
}

function extractWrapperStylesFromTemplate(html) {
  const bodyStyle = (html.match(/<body\b[^>]*\sstyle="([^"]*)"/i) || [])[1] || "";
  const divStyle = (html.match(/<body[\s\S]*?<div\b[^>]*\sstyle="([^"]*)"/i) || [])[1] || "";
  return { bodyStyle, divStyle };
}

function resolveThemeTemplatePath(themeName) {
  const base = path.resolve(__dirname);
  const map = {
    "默认主题": "默认主题.html",
    "字节范": "字节范.html",
    "苹果范": "苹果范.html",
    "运动风": "运动风.html",
    "中国风": "中国风.html",
    "赛博朋克": "赛博朋客.html",
    "赛博朋客": "赛博朋客.html",
  };
  const file = map[themeName] || map["默认主题"];
  return path.join(base, file);
}

function wrapWeChatContainer(innerHtml, { containerStyle, cardStyle }) {
  return `<div style="${containerStyle}"><section style="${cardStyle}">${innerHtml}</section></div>`;
}

function addImagePlaceholders(html) {
  let i = 0;
  return html.replace(/<img\b[^>]*>/g, () => `<!-- IMG:${i++} -->`);
}

function sanitizeInlineStyles(html) {
  return html.replace(/transition\s*:[^;"']*;?/gi, "");
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

function extractFirstTagStyle(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*\\sstyle="([^"]*)"` , "i");
  const m = html.match(re);
  return m ? m[1] : "";
}

function applyThemeTagStyles(html, templateHtml) {
  const tags = ["h1", "h2", "h3", "p", "a", "pre", "code", "ul", "ol", "li", "blockquote", "table", "th", "td", "hr"];
  let out = html;
  for (const tag of tags) {
    const style = extractFirstTagStyle(templateHtml, tag);
    if (!style) continue;
    const re = new RegExp(`<${tag}\\b([^>]*?)\\sstyle="[^"]*"`, "gi");
    out = out.replace(re, `<${tag}$1 style="${style}"`);
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  const themeArg = process.argv[4] || process.env.WECHAT_THEME || "auto";

  if (!inputPath) {
    process.stderr.write("Missing input markdown path\\n");
    process.exit(1);
  }
  const inAbs = path.resolve(inputPath);
  const outAbs = outputPath ? path.resolve(outputPath) : inAbs.replace(/\\.md$/i, ".html");

  global.window = global;
  global.markdownit = require(path.resolve(__dirname, "../../../.obsidian/plugins/obsidian-apple-style/lib/markdown-it.min.js"));
  require(path.resolve(__dirname, "../../../.obsidian/plugins/obsidian-apple-style/themes/apple-theme.js"));
  require(path.resolve(__dirname, "../../../.obsidian/plugins/obsidian-apple-style/converter.js"));

  const mdRaw = readUtf8(inAbs);
  const md = stripFrontmatter(mdRaw);
  const title = extractTitle(md, path.basename(inAbs, path.extname(inAbs)));
  const themeName = themeArg === "auto" ? autoPickTheme(md, title) : themeArg;

  const theme = global.AppleTheme;
  const Converter = global.AppleStyleConverter;
  const converter = new Converter(theme, "medium", title);

  const converted = await converter.convert(md);
  const withPlaceholders = addImagePlaceholders(converted);
  const sanitized = sanitizeTags(sanitizeInlineStyles(withPlaceholders));

  const templatePath = resolveThemeTemplatePath(themeName);
  const templateHtml = readUtf8(templatePath);
  const wrapper = extractWrapperStylesFromTemplate(templateHtml);
  const containerStyle = wrapper.bodyStyle || "margin:0;padding:40px 10px;background-color:#faf9f5;letter-spacing:0.5px";
  const cardStyle = wrapper.divStyle || "max-width:677px;margin:0 auto";

  const themed = applyThemeTagStyles(sanitized, templateHtml);
  const wechatHtml = wrapWeChatContainer(themed, { containerStyle, cardStyle });

  ensureDir(path.dirname(outAbs));
  fs.writeFileSync(outAbs, wechatHtml, "utf8");
  process.stdout.write(outAbs);
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
