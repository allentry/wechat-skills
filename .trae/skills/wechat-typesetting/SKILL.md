---
name: wechat-typesetting
description: 将 Markdown文档内容 转换为微信公众号 HTML，并调用公众号api接口，将文章内容上传到公众号后台草稿箱。
---

# Markdown 转微信公众号HTML

将用户提供的 Markdown 文章转换为带内联 CSS 的微信公众号格式 HTML

## 调用步骤

### 步骤 1：分析 Markdown

读取 Markdown 文件并提取：

| 元素 | 提取方式 |
|---------|----------------|
| **标题** | 第一个 `# 标题` 或文件名 |
| **作者** | 在前言中查找 `Author:` 或 `作者:` |
| **摘要** | 第一段或根据内容生成（最多 120 字符） |
| **图片** | 收集所有 `![alt](src)` 引用 |
| **结构** | 标题、列表、代码块、引用、表格 |

**图片引用类型**：

| 类型 | 语法 | 处理方式 |
|------|--------|------------|
| 本地 | `![alt](./path/image.png)` | 上传至微信 |
| 在线 | `![alt](https://example.com/image.png )` | 下载后上传 |
| AI 生成 | `![alt](__generate:prompt__)` | 通过 AI 生成后上传 |

---

## 步骤 2：确认模式和主题并生成html
根据对用户提供的markdown文章内容的分析，从 D:\公众号\.trae\skills\wechat-typesetting\themes.md 中选取匹配的风格提示词，生成带内联 CSS 的 HTML。

### 2.1 自动选主题（默认）

在不指定主题时，按文章特征自动选择：

- `字节范`：工具清单/教程/产品文档（命令、参数、链接较多，结构偏“要点+步骤”）
- `苹果范`：观点/叙事/长文（段落为主，代码与列表较少，追求极简阅读）
- `赛博朋克`：AI/黑客/安全/自动化/未来感（含“赛博/黑客/攻防/Agent/自动化”等关键词）
- `中国风`：国学/传统文化/历史/诗词（含“国风/诗词/传统/古典”等关键词）
- `运动风`：运动/健身/训练/赛事（含“训练/肌肉/跑步/运动”等关键词）
- `默认主题`：其它无法明确归类的内容

### 2.2 手动指定主题（覆盖自动选择）

支持主题名：

- `默认主题` / `字节范` / `苹果范` / `运动风` / `中国风` / `赛博朋克`

当用户明确指定主题时，优先使用用户指定。

### 2.3 参考调用方式（本地脚本）

生成 HTML：

- `node D:\公众号\.trae\skills\wechat-typesetting\convert.js <input.md> <output.html> [auto|主题名]`

不传主题名时默认为 `auto`，也可通过环境变量指定：

- `WECHAT_THEME=字节范`

参照D:\公众号\.trae\skills\wechat-typesetting\html-guide.md

重要规则：
所有 CSS 必须内联（在 style 属性中）
不使用外部样式表或脚本
仅使用微信安全的 HTML 标签
图片占位符格式：<!-- IMG:0 -->、<!-- IMG:1 --> 等
安全 HTML 标签：
<p>、<br>、<strong>、<em>、<u>、<a>
<h1> 到 <h6>
<ul>、<ol>、<li>
<blockquote>、<pre>、<code>
<table>、<thead>、<tbody>、<tr>、<th>、<td>
<section>、<span>（带内联样式）
避免使用：
<script>、<iframe>、<form>
外部 CSS/JS 引用
复杂定位（fixed、absolute）
微信关键要求：
在 <body> 后立即创建主 <div> 容器存放所有全局样式
为每个 <p> 标签显式指定 color（否则微信会重置为黑色）
标题符号使用两个 <span> 标签：一个用于颜色+文字阴影，一个用于纯色

将生成的html文件存储在用户所要求的文件夹内

## 步骤 3：调用公众号api接口，将文章内容上传到公众号后台草稿箱

### 3.1 准备文件（用户提供文档目录）

要求目录内包含：

- `cover.jpg`：公众号文章封面图
- `pic1.jpg...picn.jpg`：文章内配图（与 HTML 中的 `<!-- IMG:x -->` 对应）
- `*.html`：步骤 3 生成的文章 HTML（作为草稿 content）

### 3.2 配置密钥

在以下路径准备密钥文件（自行填写，不要把密钥写进文章内容）：

- `D:\公众号\.trae\skills\wechat-typesetting\config\secrets.md`

格式（每行一个键值）：

- `APPID=...`
- `APPSECRET=...`

### 3.3 调用流程（草稿箱）

按顺序完成：

1. 获取 `access_token`
2. 上传封面图（永久素材）获取 `thumb_media_id`
3. 上传正文配图（图文消息内图片）获取图片 URL
4. 将 HTML 内的 `<!-- IMG:x -->` 占位符替换为微信返回的图片 URL
5. 调用“新建草稿”接口，保存到草稿箱

### 3.4 产出与返回

- 输出草稿 `media_id`（用于后续发布或在草稿箱中查看）
- 输出生成/更新后的 HTML（已替换为微信图片 URL）

## 参考文档

- `D:\公众号\.trae\skills\wechat-typesetting\themes.md` - 选择模板风格
- `D:\公众号\.trae\skills\wechat-typesetting\html-guide.md` - 生成html指引
