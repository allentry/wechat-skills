---
name: "wechat-link-extract"
description: "批量打开公众号文章链接并提取标题/作者/时间/正文，写入 .imitation_article/ Markdown，并同步到指定飞书多维表格。用户提供多个公众号链接并要求批量录入时调用。"
---

# 批量提取公众号链接（wechat-link-extract）

## 目标

用户输入多个微信公众号文章链接后：

1. 启动/连接 Chrome，并逐个打开链接。
2. 使用 MCP：chrome-devtools 提取每篇文章的标题、作者、发布时间、正文全文。
3. 在仓库根目录创建（如不存在）`.imitation_article/`，为每篇文章生成一个 Markdown 文件，文件名为 `作者名+标题.md`。
4. 使用 MCP：lark-mcp 将每篇文章写入飞书多维表格（从用户给定的飞书链接定位对应的多维表格），新增记录并填入字段。

## 何时调用

- 用户一次性提供多个 `mp.weixin.qq.com/s/...` 链接，希望批量提取与归档。
- 用户要求把公众号文章内容同步到本地 Markdown 与飞书多维表格。

## 输入

- `urls`: 公众号文章链接数组（至少 1 个）。
- `bitable_entry_url`: 飞书入口链接（用户提供的 wiki/base 链接）。

## 输出

- 本地文件：`.imitation_article/<作者名>+<标题>.md`（每篇 1 个）。
- 飞书多维表格：新增 N 条记录（每篇 1 行）。
- 返回摘要：成功/失败数量、失败原因、每篇文章的文件路径与 record_id（如可获取）。

## 工作流（必须按顺序执行）

### A. 准备与浏览器连接

1. 确认 chrome-devtools MCP 已连接到可调试的 Chrome浏览器（browserUrl 通常为 `http://127.0.0.1:9222`）。
2. 打开/复用一个页面用于逐个导航（优先复用已选中的页面；全程复用同一 tab，不为每篇文章新建页面）。
3. 默认启用“快速模式”，仅在快速模式失败时回退到“稳妥模式”。

### B. 逐篇提取（对每个 URL 重复）

对每个 `url`：

1. 导航到该 URL（建议设置超时，避免卡死在单篇文章上）。
2. 单次执行脚本完成：触发懒加载滚动 → 提取字段 → 返回结构化结果（快速模式）。
3. 若快速模式结果不完整，再执行一次稳妥模式脚本（更长滚动与更严格的“收敛判定”）。

#### 提取字段

提取字段（示例选择器，按公众号文章常见结构）：

- 标题：`#activity-name`
- 作者：`#js_author_name`（无则回退为 `#js_name` 或页面 meta 文本）
- 公众号：`#js_name`
- 发布时间：`#publish_time`
- 正文全文：`#js_content.innerText`

需要返回结构：

- `url`
- `title`
- `author`
- `account`（公众号名）
- `publishTime`（文本或时间戳）
- `contentText`（纯文本）
- `contentHTML`（可选）
- `images`（可选，正文图片 URL 列表）

#### 快速模式（默认）

目标：每篇文章尽量做到 “1 次导航 + 1 次 evaluate_script”。

判断标准（任一不满足则触发稳妥模式回退一次）：

- `title` 为空
- `contentText` 为空或明显过短（例如 < 200 字）
- 识别到验证/异常页面

快速模式脚本模板（直接在浏览器页内执行）：

```js
async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const abs = (u) => {
    try {
      return new URL(u, location.href).toString();
    } catch {
      return "";
    }
  };
  const textOf = (sel) => (document.querySelector(sel)?.innerText || "").trim();

  const isVerify = () => {
    const t = (document.body?.innerText || "").slice(0, 3000);
    return (
      /环境异常|完成验证|滑块|请在微信客户端打开|安全验证|操作频繁/i.test(t) ||
      /Weixin Official Accounts Platform/i.test(document.title || "")
    );
  };

  const waitForReady = async (budgetMs) => {
    const start = Date.now();
    while (Date.now() - start < budgetMs) {
      const ok = !!document.querySelector("#js_content") && !!textOf("#activity-name");
      if (ok) return true;
      await sleep(120);
    }
    return false;
  };

  const collectImages = () => {
    const root = document.querySelector("#js_content") || document;
    const urls = Array.from(root.querySelectorAll("img"))
      .map((img) => {
        const src =
          img.getAttribute("data-src") ||
          img.getAttribute("data-original") ||
          img.getAttribute("data-actualsrc") ||
          img.currentSrc ||
          img.getAttribute("src") ||
          "";
        return abs(src);
      })
      .filter((u) => u && !u.startsWith("data:"))
      .map((u) => u.split("#")[0]);
    return Array.from(new Set(urls));
  };

  const adaptiveScroll = async ({ maxRounds, settleRounds, stepMs }) => {
    let stable = 0;
    let lastCount = -1;
    for (let i = 0; i < maxRounds; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(stepMs);
      const c = collectImages().length;
      if (c === lastCount) stable++;
      else stable = 0;
      lastCount = c;
      if (stable >= settleRounds) break;
    }
    window.scrollTo(0, 0);
    await sleep(80);
  };

  await waitForReady(2500);
  if (isVerify()) {
    return { ok: false, needVerification: true, url: location.href };
  }

  await adaptiveScroll({ maxRounds: 8, settleRounds: 2, stepMs: 450 });

  const title = textOf("#activity-name");
  const author = textOf("#js_author_name") || textOf("#js_name");
  const account = textOf("#js_name");
  const publishTime = textOf("#publish_time");
  const contentText = (document.querySelector("#js_content")?.innerText || "").trim();
  const images = collectImages();

  return {
    ok: true,
    needVerification: false,
    url: location.href,
    title,
    author,
    account,
    publishTime,
    contentText,
    images,
    imageCount: images.length
  };
};
```

#### 稳妥模式（回退一次）

仅在快速模式失败时执行一次，特点：

- 更长的等待预算（例如 6s）
- 更强的滚动触发（更多轮次）
- “图片数量收敛”判定更严格（稳定轮次更多）

建议做法：复用同一个脚本，将 `waitForReady` 的 budget、`adaptiveScroll` 的参数加大即可（避免额外的 take_snapshot / network 检查）。

#### 反爬/验证处理（必须）

若出现以下任一情况，判定为“需要人工验证”：

- 标题为 `Weixin Official Accounts Platform` 或正文为空/明显是验证页面。
- 页面正文包含“环境异常”“完成验证”“滑块”等字样。

处理策略：

- 暂停该 URL 的自动提取，把失败原因记录为 `need_verification`。
- 提示用户在浏览器中完成验证后，重新对该 URL 执行一次提取。

### C. 写入本地 Markdown

1. 确保根目录存在 `.imitation_article/`；不存在则创建。
2. 生成安全文件名：

- 规则：`<作者名>+<标题>.md`
- 替换 Windows 非法字符：`\\ / : * ? \" < > |` → `-`
- 去除首尾空格，连续空格压缩为单空格
- 限制总长度（建议 120 字符以内）；超出则截断标题部分
- 若文件已存在，追加后缀：` (2)`, ` (3)`…

3. Markdown 内容格式（固定模板）：

```markdown
---
url: "<原链接>"
title: "<标题>"
author: "<作者>"
account: "<公众号>"
publish_time: "<发布时间文本>"
---

# <标题>

**作者**：<作者>  
**公众号**：<公众号>  
**发布时间**：<发布时间>  
**原文链接**：<链接>

## 正文全文

<正文纯文本>
```

### D. 写入飞书多维表格（lark-mcp）

用户给的是 wiki/base 入口链接时，先定位对应的 bitable：

1. 优先策略：用浏览器打开 `bitable_entry_url`，在页面 URL、DOM 或网络请求中解析出 `app_token` / `table_id`（常见形态为 `.../base/<app_token>?table=<table_id>`）。
2. 若无法自动解析：要求用户提供可直接打开的数据表链接（包含 `base/<app_token>?table=<table_id>`），或提供 `app_token/table_id`。

定位到表后：

1. 列出字段，确认目标字段名称存在；若字段名不匹配，采用最接近的字段名映射或提示用户指定映射。
2. 为每篇文章新增记录，写入最少字段集：

- 链接
- 标题
- 作者
- 发布时间（按字段类型写入：文本或毫秒时间戳）
- 正文全文

3. 若接口返回 `no session` / `user_access_token invalid or expired`：

- 触发 OAuth 授权：返回的 instruction 中会包含 `http://localhost:3000/authorize?...`（60 秒有效），提示用户立即打开完成授权，再重试写入。

## 失败与重试规则

- 单篇失败不影响其它链接继续处理，最后汇总输出。
- 每篇文章最多两次提取：快速模式 1 次 + 稳妥模式回退 1 次；仍失败则记录失败原因并继续下一篇。
- 对 `need_verification` 的链接：用户完成验证后只重试失败项。
- 对飞书写入失败：先保留本地 Markdown 已生成结果，再单独重试飞书写入。

## 返回结果格式（建议）

- `success`: 成功提取并落库/落盘的数量
- `failed`: 失败数量与原因列表（按 URL）
- `files`: 每篇对应的本地文件路径
- `lark_records`: 每篇对应的 `record_id`（如成功）
