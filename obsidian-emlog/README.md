# obsidian-emlog 插件开发 README（唯一真源）

本仓库内，本 README 为 obsidian-emlog 插件开发的唯一权威文档（Single Source of Truth，SSOT）。
- 开发、评审、测试、发布等一切流程均以此文档为准。
- 每次开发前请通读本文件；每次提交前请对照本文件更新状态与勾选 TODO。
- 参考文档：项目根目录 `obsidian-emlog-插件开发要点.md`（作为补充材料）。

## 目标与范围
- 在 Obsidian 中一键将当前笔记发布/更新至 EMLOG 博客。
- 支持草稿/正式发布、分类、标签、封面、摘要、图片上传与链接替换、微语发布。
- 提供良好的设置页、命令面板、状态栏与错误提示体验。

## 运行环境
- Obsidian 桌面版（minAppVersion ≥ 0.15.0）。
- Node.js ≥ 16（开发构建）。
- 插件为桌面端专用（`isDesktopOnly: true`）。
- HTTPS 推荐；确保可访问 EMLOG 站点。

## 目录结构（规划）
- `obsidian-emlog/` 本插件目录
  - `README.md`（本文件）
  - `manifest.json`
  - `main.ts`
  - `styles.css`
  - `esbuild.config.mjs`
  - `package.json`
  - `tsconfig.json`
  - `versions.json`

## 架构与关键点
- 插件入口：`main.ts` 默认导出继承自 `Plugin` 的类。
- 生命周期：
  - `onload()`：注册命令、设置页、状态栏、事件；`loadData()` 读持久化数据。
  - `onunload()`：资源释放（事件/定时器由 Obsidian 注册器自动清理）。
- 能力与模块：
  - Vault/Workspace/MetadataCache：文件/界面/元数据处理。
  - 设置页：收集 `baseUrl/api_key/鉴权方式/默认分类/草稿策略/auto_cover/allow_remark` 等。（已实现）
  - 网络层：封装 EMLOG API 请求（签名/免签名/Cookie），统一错误处理、重试与超时。（基础已实现）
  - 媒体上传：扫描 Markdown 中本地图片，先上传再替换正文链接。（已实现）
  - 去重更新：`filePath ↔ article_id` 映射持久化，存在则 `article_update`，否则 `article_post`。（已实现）
  - 发布后动作：发布/更新成功后获取文章 URL，按设置打开浏览器/复制链接/两者兼有。（已实现）
  - 日志与隐私：支持调试开关，自动对 `api_key/req_sign` 等敏感字段脱敏。（已实现）

## EMLOG 接口（聚焦发布）
- 鉴权：
  - 签名：`req_time` + `req_sign = md5(req_time + api_key)`。
  - 免签名：`api_key`（简易，配合 HTTPS）。
  - Cookie：登录 Cookie（需管理会话有效期）。
- 文章：
  - 发布 `POST /?rest-api=article_post` → `title/content/excerpt/cover/author_uid/sort_id/tags/draft/post_date/...`
  - 编辑 `POST /?rest-api=article_update`（含 `id` 与需更新字段）
- 媒体上传：`POST /?rest-api=upload`，表单字段 `file`（二进制）→ 返回 `url`。
- 分类：`GET /?rest-api=sort_list`
- 草稿：`draft_list` / `draft_detail`
- 微语：`POST /?rest-api=note_post`（字段 `t`）
- 错误：`sign error / api is closed / parameter error / API function is not exist`（均返回 JSON，需弹窗/状态栏提示）。

## 使用指南（快速上手）
1) 构建与安装
   - 在 `obsidian-emlog/` 目录执行：
     - `npm i`
     - `npm run dev`（开发模式，自动 watch）或 `npm run build`（产物压缩）
   - 将 `manifest.json/main.js/styles.css` 拷贝到你的库目录 `.obsidian/plugins/obsidian-emlog/`。
   - 在 Obsidian 设置 → 第三方插件 → 启用 `obsidian-emlog`。
2) 基本配置
   - 打开插件设置，至少配置：
     - `站点地址`（必填，形如 `https://yourdomain`，不要末尾斜杠）
     - `鉴权方式`（默认签名）与 `API Key`（视鉴权方式需要）
     - 可选：默认作者 UID、默认分类 ID、默认发布为草稿、自动封面、允许评论、发布后动作、启用调试日志
3) 发布文章
   - 打开任一 Markdown 笔记，使用命令面板：
     - “发布当前笔记到 EMLOG”：首次发布创建新文章；后续对同一文件执行则更新。
     - “发布为草稿到 EMLOG”：强制草稿发布（无公开 URL）。
   - 图片自动上传：文中相对/本地图片会在发布前自动上传并替换为网络 URL。
4) 发布微语
   - 选中文本后执行命令：“发布微语（当前选中文本或提示输入）”。
5) 发布后动作
   - 可在设置选择：无、打开浏览器、复制链接、同时打开并复制。草稿无公开链接。
6) 调试
   - 如遇问题，可开启“启用调试日志”。日志会自动脱敏敏感字段。

## 配置说明
- `站点地址 baseUrl`
  - 你的 EMLOG 站点根地址，例：`https://blog.example.com`。不要以 `/` 结尾。
- `鉴权方式 authMode`
  - `sign`：签名鉴权（推荐，需 `api_key`，请求附带 `req_time/req_sign`）。
  - `apikey`：免签名鉴权（开发/内网可用，注意仅 HTTPS 场景）。
  - `cookie`：Cookie 鉴权（须先在同域登录后台，Obsidian 桌面端一般可用）。
- `API Key apiKey`
  - 与 `authMode` 搭配使用。签名或免签名均会用到。建议谨慎保管，不在日志/UI 明文展示。
- `默认作者 UID defaultAuthorUid`
  - 不填则使用 EMLOG 后端默认作者；可在后台用户管理查看 UID。
- `默认分类 defaultSortId`
  - 动态从 `sort_list` 获取并显示为下拉选项；点击右侧“刷新分类”按钮可实时更新分类缓存。
  - 文章发布时若 frontmatter 指定了 `sort_id` 将优先生效，否则使用该默认值。
- `默认发布为草稿 defaultDraft`
  - 开启后默认以草稿发布（命令“发布当前笔记”会被草稿化）。
- `自动封面 autoCover`
  - EMLOG 端自动取文中首图作为封面。
- `允许评论 allowRemark`
  - 是否允许文章评论。
- `发布后动作 postAction`
  - `none/open/copy/both`，影响发布/更新成功后的行为。草稿无链接。
- `启用调试日志 enableDebug`
  - 打印受控调试日志（自动脱敏 `api_key/req_sign`）。仅在排查问题时启用。

### Frontmatter 映射
- 支持在 Markdown 最上方 YAML 区块提供元数据（示例）：
  ```yaml
  title: 自定义标题
  tags: [obsidian, emlog]
  excerpt: 自定义摘要
  cover: https://example.com/cover.png
  sort_id: 5
  draft: y
  author_uid: 1
  post_date: "2025-01-02 12:00:00"
  allow_remark: y
  top: n
  sortop: n
  ```
- 未提供时：
  - `title` 取首个 H1 或文件名；
  - `excerpt` 取 `<!--more-->` 前文或自动截取；
  - `tags` 支持数组或逗号分隔字符串。

### 命令说明
- 发布当前笔记到 EMLOG：创建/更新文章（基于 `filePath → article_id` 映射）。
- 发布为草稿到 EMLOG：强制草稿发布（不公开）。
- 发布微语：使用选中文本作为内容字段 `t`。

> 注意：鉴权失败、API 未开启、参数缺失等错误会以 Notice/状态栏提示。

## 问题排查（FAQ）与快速验证
- 一键快速验证四项 API（分类、微语、上传、发文/更新）
  - 在 `obsidian-emlog/` 目录执行：
    ```bash
    EMLOG_BASE_URL=https://yourdomain EMLOG_API_KEY=your_api_key npm run verify
    ```
  - 成功会打印“所有检查通过 ✅”。
- 手工单项验证（可选）
  - 运行集成测试（全部）：
    ```bash
    RUN_EMLOG_TESTS=1 npx vitest run tests/emlog.integration.test.ts tests/emlog.article.test.ts
    ```
  - 仅验证分类：
    ```bash
    RUN_EMLOG_TESTS=1 npx vitest run tests/emlog.integration.test.ts -t sort_list
    ```
- 网络失败/跨域
  - 插件与测试均内置 `/?rest-api=...` → `/index.php?rest-api=...` 回退。
  - 若提示 `Failed to fetch`，请检查 HTTPS 与服务器 CORS 响应头（`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`）。

## TODO 清单（实时更新，做到就勾）
- [x] 创建 `obsidian-emlog` 目录
- [x] 创建 `README.md` 并声明为唯一真源
- [x] 初始化插件脚手架：`manifest.json`、`main.ts`、构建配置
- [x] 设置页：`baseUrl/api_key/鉴权方式/默认 author_uid/sort_id/draft/auto_cover/allow_remark`
- [x] Ribbon 图标与状态栏：一键发布、状态提示（基础）
- [x] 命令：发布当前笔记（新建/更新 判定）、发布草稿、发布微语（基础）
- [x] 图片扫描与上传：相对/本地图片批量上传并替换正文链接（基础）
- [x] 文章映射持久化：`filePath ↔ article_id`
- [x] 网络层封装：签名生成、超时、错误标准化、重试策略（基础）
- [x] 发布后动作：打开浏览器预览/复制文章链接
- [x] 日志与隐私：敏感字段脱敏
- [x] 文档完善：使用指南与配置说明
- [x] 分类下拉动态获取
- [x] 集成测试与一键验证脚本
- [ ] 单元测试/集成测试（可选）

> 注意：每完成一项，务必在本 TODO 清单打勾，并补充实现要点与相关提交号。

## 版本发布流程
1) 更新 `manifest.json` 中 `minAppVersion`（如需）。
2) 执行 `npm version patch|minor|major`，自动：
   - 同步 `manifest.json.version` 与 `versions.json`。
   - 生成提交：`manifest.json` 与 `versions.json`。
3) 打包产物：`npm run build`。
4) 手动上传发布：`manifest.json/main.js/styles.css` 到发行渠道（或 Obsidian 社区 PR 流程）。

—— 始终以本 README 为准进行开发与验收。
