---
name: "wechat-erchuang-system"
description: "按指定作者风格对公众号文章做等义二创，并落盘到 erchuang/。用户提供作者名+文章链接或文章文档（txt或md格式）时调用。"
---

# 公众号文章二创系统（wechat-erchuang-system）

## 目标

用户提供：

- 需要模仿的公众号作者名
- 需要二创的公众号文章链接或文章文档（txt或md格式）

系统输出：

1. 生成一篇“风格贴近目标作者、内容严格不增不减”的二创文章（Markdown）。
2. 将二创文章落盘到 `erchuang/` 目录。

## 何时调用

- 用户明确要求：用某个公众号作者的写作风格，对指定公众号文章做二次创作，并同步到本地。

## 输入

- `target_author`：需要模仿的公众号作者名（例如：王笑东）
- `source_url`：需要二创的公众号文章链接（`https://mp.weixin.qq.com/s/...`）或文章文档（txt或md格式）

## 输出

- 本地文件：`erchuang/<作者名>+<YYYYMMDD>+<二创标题>.md`

## 样本与依赖

### A. 风格样本（必须）

从 `style/` 目录读取目标作者的风格文件：

- `style/<作者名>文章风格分析与模仿系统.md`

若不存在该文件：

- 终止二创流程
- 提示用户先准备目标作者的 3-5 篇样本文章到 `imitation_article/`
- 然后调用“公众号文章风格分析与模仿系统”生成该风格文件，再继续二创

### B. 作者样本文章（建议）

从 `imitation_article/` 目录读取该作者的所有样本文章（用于强化微观句式与惯用表达）：

- 文件名通常形如：`imitation_article/<作者名>+*.md`

若样本文章少于 2 篇：

- 仍可二创，但需在结果元信息中标注“风格稳定性受限”

## 工作流（必须按顺序执行）

### 1) 发现与校验输入

1. 校验 `target_author`、`source_url` 均存在且非空。
2. 校验 `source_url` 是否为 `mp.weixin.qq.com` 链接或文章文档（txt或md格式）；否则提示用户提供公众号文章链接或文章文档（txt或md格式）。

### 2) 读取风格文件与样本文章

1. 打开并解析 `style/<作者名>文章风格分析与模仿系统.md`：
   - 优先读取其中 JSON 代码块
   - 提取：
     - 风格核心要素
     - 结构模板（目录与推进方式）
     - 口头禅/标志性表达
     - 结尾 CTA 模板
2. 读取 `imitation_article/<作者名>+*.md`：
   - 提取可复用的“微观语言特征”：
     - 常用过渡句
     - 常用编号格式
     - 常见结尾模块（往期内容/关注/加微信等）

### 3) 抽取原文章内容（如果提供的是`mp.weixin.qq.com` 链接，则调用 mcp：Chrome DevTools MCP；如果提供的是txt或md文档，则直接进行下一步）

使用浏览器运行态抽取 `source_url`，至少包含：

- 标题（title）
- 作者（author）
- 发布时间（publishTime，可选但建议）
- 正文全文纯文本（contentText）

执行要点：

1. 复用同一个 Chrome 页面。
2. 导航到 `source_url`。
3. 单次 `evaluate_script` 完成：等待页面就绪 → 自适应滚动触发懒加载 → 抽取字段并返回结构化结果。

脚本模板（直接在页面执行）：

```js
async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (sel) => (document.querySelector(sel)?.innerText || "").trim();
  const abs = (u) => { try { return new URL(u, location.href).toString(); } catch { return ""; } };

  const isVerify = () => {
    const t = (document.body?.innerText || "").slice(0, 3000);
    return /环境异常|完成验证|滑块|请在微信客户端打开|安全验证|操作频繁/i.test(t) ||
      /Weixin Official Accounts Platform/i.test(document.title || "");
  };

  const waitForReady = async (budgetMs) => {
    const start = Date.now();
    while (Date.now() - start < budgetMs) {
      if (!!document.querySelector("#js_content") && !!textOf("#activity-name")) return true;
      await sleep(120);
    }
    return false;
  };

  const adaptiveScroll = async ({ maxRounds, settleRounds, stepMs }) => {
    const root = document.querySelector("#js_content") || document;
    const collectImgCount = () => Array.from(new Set(
      Array.from(root.querySelectorAll("img"))
        .map((img) => abs(img.getAttribute("data-src") || img.currentSrc || img.getAttribute("src") || ""))
        .filter((u) => u && !u.startsWith("data:"))
        .map((u) => u.split("#")[0])
    )).length;

    let stable = 0;
    let last = -1;
    for (let i = 0; i < maxRounds; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(stepMs);
      const c = collectImgCount();
      if (c === last) stable++;
      else stable = 0;
      last = c;
      if (stable >= settleRounds) break;
    }
    window.scrollTo(0, 0);
    await sleep(80);
  };

  await waitForReady(2500);
  if (isVerify()) return { ok: false, need_verification: true, url: location.href };

  await adaptiveScroll({ maxRounds: 8, settleRounds: 2, stepMs: 450 });

  const title = textOf("#activity-name");
  const author = textOf("#js_author_name") || textOf("#js_name");
  const publishTime = textOf("#publish_time");
  const contentText = (document.querySelector("#js_content")?.innerText || "").trim();

  return {
    ok: true,
    need_verification: false,
    url: location.href,
    title,
    author,
    publishTime,
    contentText
  };
}
```

若 `need_verification=true`：

- 记录失败原因为 `need_verification`
- 提示用户在浏览器中完成验证后再重试

### 4) 生成二创文章（核心）

#### 4.1 核心约束（必须严格遵守）

1. 要求文章风格完全贴近需要模仿的作者（参考style/<作者名>文章风格分析与模仿系统.md和imitation_article/<作者名>+*.md），而文章内容则完全是用户提供文章链接里面的内容，也就是说模仿这个作者将用户提供的文章内容创作出来，这是任务的核心；
2. 创作出来的内容，不要超过原文章内容范围，也不要缩减原文章内容。
3. 内容不得缩减：原文所有要点都要覆盖；章节/段落不允许删减成摘要。
4. 创作文章要自然，要让人感觉像是需要模仿的作者写出来的一样。
5. 创作出来的文章字数要与原文章字数相当，相差不能超过正负100个字。

#### 4.2 二创标题规则

二创标题应满足：

- 语义覆盖原文标题
- 贴近目标作者的标题风格（通常包含工具名/结果导向/括号补充）
- 不增加原文不存在的承诺或结论

#### 4.3 二创结构规则（建议模板）

优先使用目标作者常见骨架：

1. 开头两段：价值承诺/提醒（若目标作者风格中存在此模块）
2. 一段背景：承接原文开头语境
3. 明确目录：本文分为 X 个部分（X 需与原文内容结构一致）
4. 主体：严格按原文信息推进，使用“编号 + 过渡语”组织
5. 结尾：保留目标作者风格的结尾模块，但不得新增原文不存在的联系方式/收费/资料包等信息
   - 若原文末尾已包含相关信息，可按作者风格重写呈现
   - 若原文末尾不包含此类信息，则结尾只做“总结与行动建议”，不得强行添加转化信息

#### 4.4 二创输出 Markdown 模板（必须）

```markdown
---
source_url: "<原文章链接>"
target_author: "<需要模仿的作者名>"
source_title: "<原文章标题>"
source_author: "<原文章作者>"
rewrite_date: "<YYYY-MM-DD>"
---

# <二创标题>

**二创风格作者**：<需要模仿的作者名>  
**原文标题**：<原文章标题>  
**原文作者**：<原文章作者>  
**原文链接**：<原文章链接>

## 正文

<二创正文，信息不增不减，完整覆盖原文>
```

### 5) 落盘到 erchuang/ 目录

1. 确保项目根目录存在 `erchuang/`；不存在则创建。
2. 文件名规则：
   - `erchuang/<作者名>+<YYYYMMDD>+<二创标题>.md`
   - Windows 非法字符替换：`\\ / : * ? \" < > |` → `-`
   - 限制总长度（建议 160 字符以内）；超出则截断标题部分
   - 若文件已存在，追加后缀：` (2)`, ` (3)`…

## 失败与重试规则

- 原文抽取失败（含 need_verification）：不生成二创文章，返回失败原因。

## 返回结果（建议）

- `ok`: true/false
- `target_author`
- `source_url`
- `rewrite_title`
- `rewrite_file_path`
- `errors`（如失败）
