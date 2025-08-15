## Obsidian × EMLOG 插件开发要点

- **目标**: 在 Obsidian 中一键将当前笔记发布/更新至 EMLOG 博客；支持草稿、分类、标签、封面、图片上传与链接替换、微语发布等。

### Obsidian 插件基础（来自示例与 API 结构）
- **核心文件**:
  - `manifest.json`: `id/name/version/minAppVersion/description/isDesktopOnly/...`
  - `main.ts` → 打包为 `main.js`，默认导出类需继承 `Plugin`。
- **生命周期**:
  - `onload()`: 注册功能，如 `addRibbonIcon/addCommand/addSettingTab/registerDomEvent/registerInterval`，以及 `loadData()` 读取插件数据。
  - `onunload()`: 插件卸载时清理资源（事件/计时器自动由 register* 系列托管）。
- **常用能力**:
  - `this.app.vault` 文件读写；`this.app.workspace` 视图操作；`this.app.metadataCache` 提取笔记元数据（frontmatter、标题、标签等）。
  - `this.addCommand()` 注册命令；`this.addStatusBarItem()` 显示状态；`this.addSettingTab()` 插件设置 UI。
- **本地开发与发布**:
  - Node ≥ 16；`npm i` → `npm run dev` 热编译；将 `manifest.json/main.js/styles.css` 拷贝至库目录的 `.obsidian/plugins/<plugin-id>/` 手动安装。

### EMLOG API 关键点（发布相关）
- **鉴权方式**:
  - 签名鉴权：提交 `req_time`(unix 秒) 与 `req_sign = md5(req_time + api_key)`。
  - 免签名鉴权：提交 `api_key`（简单但安全性较弱，建议配合 HTTPS）。
  - Cookie 鉴权：需登录获得 Cookie（桌面端可行，但要处理会话有效期）。
- **主要接口**:
  - 文章发布：`POST https://yourdomain/?rest-api=article_post`
    - 关键参数：`title, content, excerpt?, cover?, author_uid?, sort_id?, tags?, draft?(y/n), post_date?, top?, sortop?, allow_remark?, password?, auto_cover?`
  - 文章编辑：`POST https://yourdomain/?rest-api=article_update`（含 `id` 与待更新字段）。
  - 媒体上传：`POST https://yourdomain/?rest-api=upload`（`file` 二进制，返回 `url`）。
  - 分类列表：`GET https://yourdomain/?rest-api=sort_list`。
  - 草稿列表/详情：`draft_list` / `draft_detail`。
  - 微语发布（可选）：`POST https://yourdomain/?rest-api=note_post`（`t` 文本）。
- **错误信息**：`sign error / api is closed / parameter error / API function is not exist` 等，返回 JSON。

### 插件功能设计（建议）
- **设置项**:
  - 站点地址 `baseUrl`；鉴权方式（签名/免签名/Cookie）；`api_key`；默认 `author_uid/sort_id`；`draft` 默认值；`auto_cover`；`allow_remark`；发布后动作（打开链接/复制链接）。
- **命令**:
  - 发布当前笔记为文章；更新上次发布的文章；发布为草稿；上传图片为封面并插入链接；发布微语。
- **UI/交互**:
  - Ribbon 图标快捷发布；状态栏显示进度与结果；设置页用于配置站点与默认值。
- **元数据映射**:
  - 支持从 frontmatter 读取：`title, tags, excerpt, cover, sort_id, draft, post_date, password, top, sortop, allow_remark, field_keys/field_values`。
  - 若缺省：`title` 取首个 H1 或文件名；`excerpt` 取 `<!--more-->` 之前或前 N 字；`tags` 取 frontmatter `tags` 或文中 `#tag`。
- **内容与图片处理**:
  - 内容 `content` 建议先以 Markdown 直接提交（EMLOG 会保留 `*_raw` 原文）；如需 HTML，可用 `markdown-it` 转换后提交。
  - 扫描本地图片引用：先调用 `upload` 获取 URL，再替换正文内相对/本地路径为绝对 URL。
- **发文去重/更新**:
  - 使用 `loadData()/saveData()` 维护「笔记路径 ↔ article_id」映射；若存在则调用 `article_update`，否则 `article_post`。
- **网络与安全**:
  - 推荐 HTTPS；敏感字段（`api_key`）避免输出到日志；桌面端请求通常少受 CORS 约束，但仍应处理超时与错误提示。

### 最小请求示例（TypeScript 片段）
```ts
// 依赖：blueimp-md5（或其它 MD5 库）
import md5 from 'blueimp-md5';

function buildSignedBody(params: Record<string, string>, apiKey: string) {
  const req_time = Math.floor(Date.now() / 1000).toString();
  const req_sign = md5(req_time + apiKey);
  return new URLSearchParams({ ...params, req_time, req_sign });
}

async function postArticle(baseUrl: string, apiKey: string, payload: {
  title: string;
  content: string;
  excerpt?: string;
  tags?: string; // 逗号分隔
  sort_id?: string;
  draft?: 'y' | 'n';
}) {
  const body = buildSignedBody(payload as Record<string, string>, apiKey);
  const resp = await fetch(`${baseUrl}/?rest-api=article_post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await resp.json();
  if (json.code !== 0) throw new Error(json.msg || 'publish failed');
  return json.data.article_id as number;
}
```

### 实施清单（落地最少改动）
- 在 `main.ts`：
  - 添加设置面板字段：站点、鉴权方式、`api_key`、默认分类/草稿等。
  - 注册命令：读取当前笔记 → 解析 frontmatter → 处理图片上传替换 → 发布/更新。
  - 使用 `saveData()` 记录 `filePath → article_id`。
- 在构建配置：
  - 安装 `blueimp-md5` 或同类库，确保被打包进 `main.js`。

---
以上要点已覆盖插件骨架、EMLOG 接口与实际落地所需的关键决策点，可按此清单快速实现 MVP 并迭代。
