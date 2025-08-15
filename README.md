# Obsidian EMLOG Publisher

[![GitHub release](https://img.shields.io/github/v/release/qimuai/obsidian-emlog)](https://github.com/qimuai/obsidian-emlog/releases)
[![GitHub license](https://img.shields.io/github/license/qimuai/obsidian-emlog)](https://github.com/qimuai/obsidian-emlog/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/qimuai/obsidian-emlog)](https://github.com/qimuai/obsidian-emlog/stargazers)

一个强大的 Obsidian 插件，让你能够轻松将笔记发布到 EMLOG 博客系统。

## ✨ 功能特性

- 🚀 **一键发布** - 在 Obsidian 中直接发布笔记到 EMLOG 博客
- 📝 **智能更新** - 自动检测已发布的文章，支持增量更新
- 🖼️ **图片上传** - 自动上传本地图片并替换为网络链接
- 📋 **微语发布** - 快速发布短文本内容
- 🏷️ **分类标签** - 支持分类、标签、摘要等元数据
- 🔐 **多种认证** - 支持签名、API Key、Cookie 三种认证方式
- 📱 **草稿模式** - 支持草稿发布和正式发布
- 🎨 **自定义封面** - 支持设置文章封面图片
- 🔧 **灵活配置** - 丰富的设置选项和发布后动作

## 📦 安装

### 方法一：手动安装（推荐）

1. 下载最新版本的发布包
2. 解压到你的 Obsidian 库目录：`.obsidian/plugins/obsidian-emlog/`
3. 在 Obsidian 中启用插件：设置 → 第三方插件 → 启用 `obsidian-emlog`

### 方法二：从源码构建

```bash
git clone https://github.com/qimuai/obsidian-emlog.git
cd obsidian-emlog
npm install
npm run build
```

## ⚙️ 配置

### 基本设置

1. 打开插件设置页面
2. 配置以下必要信息：

#### 必需配置
- **站点地址**: 你的 EMLOG 博客地址（如：`https://yourdomain.com`）
- **鉴权方式**: 选择认证方式
- **API Key**: 根据鉴权方式填写相应的密钥

<img width="1626" height="904" alt="设置页面" src="https://github.com/user-attachments/assets/6c4266eb-06d5-45ae-b5bc-ff27cdcc9ae9" />


#### 可选配置
- **默认作者 UID**: 文章作者ID
- **默认分类**: 文章默认分类
- **默认发布为草稿**: 是否默认以草稿形式发布
- **自动封面**: 是否自动提取首图作为封面
- **允许评论**: 是否允许文章评论
- **发布后动作**: 发布成功后的操作（打开浏览器、复制链接等）

### 认证方式说明

| 方式 | 说明 | 适用场景 |
|------|------|----------|
| **签名** | 使用时间戳和MD5签名 | 生产环境（推荐） |
| **API Key** | 直接使用API密钥 | 开发测试 |
| **Cookie** | 使用登录Cookie | 临时使用 |

## 🚀 使用方法

### 发布文章

1. **打开要发布的 Markdown 文件**
2. **使用命令面板**：
   - `发布当前笔记到 EMLOG` - 正式发布
   - `发布为草稿到 EMLOG` - 草稿发布
   - `自定义发布…` - 自定义发布选项

<img width="504" height="1572" alt="侧边栏样式" src="https://github.com/user-attachments/assets/ca56fd47-4b0e-4d70-b328-7f089aefd01a" />

<img width="1120" height="1342" alt="自定义发布" src="https://github.com/user-attachments/assets/51117d4b-c894-414c-8314-e35aa523b977" />


3. **或使用右键菜单**：
   - 在文件浏览器中右键点击 Markdown 文件
   - 选择相应的发布选项

### 发布微语

1. **选中要发布的文本**
2. **执行命令**：`发布微语（当前选中文本或提示输入）`

### 图片处理

插件会自动处理文章中的图片：
- 扫描本地图片文件
- 自动上传到 EMLOG 服务器
- 替换文章中的图片链接为网络地址

### Frontmatter 支持

在 Markdown 文件头部可以设置元数据：

```yaml
---
title: 自定义标题
tags: [obsidian, emlog]
excerpt: 自定义摘要
cover: https://example.com/cover.png
sort_id: 5
draft: y
author_uid: 1
post_date: "2025-01-02 12:00:00"
---
```

## 🛠️ 开发

### 环境要求

- Node.js ≥ 16
- Obsidian 桌面版 ≥ 0.15.0

### 开发命令

```bash
# 安装依赖
npm install

# 开发模式（自动监听文件变化）
npm run dev

# 构建生产版本
npm run build

# 运行测试
npm test

# 验证 EMLOG API
EMLOG_BASE_URL=https://yourdomain.com EMLOG_API_KEY=your_api_key npm run verify
```

### 项目结构

```
obsidian-emlog/
├── main.ts              # 插件主文件
├── manifest.json        # 插件清单
├── styles.css           # 样式文件
├── package.json         # 项目配置
├── tests/               # 测试文件
│   ├── emlog.article.test.ts
│   └── emlog.integration.test.ts
└── scripts/             # 脚本文件
    └── verify-emlog.sh  # API验证脚本
```

## 🔧 故障排除

### 常见问题

**Q: 认证失败怎么办？**
A: 检查 API Key 是否正确，确认鉴权方式设置正确。

**Q: 图片上传失败？**
A: 确认 EMLOG 服务器支持文件上传，检查网络连接。

**Q: 发布后没有显示？**
A: 检查是否设置为草稿模式，草稿文章不会公开显示。

**Q: 分类下拉菜单为空？**
A: 点击"刷新分类"按钮，或检查网络连接和API权限。

### 调试模式

开启调试日志可以获取详细的错误信息：
1. 在插件设置中启用"调试日志"
2. 查看浏览器控制台输出
3. 日志会自动脱敏敏感信息

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 贡献指南

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Obsidian](https://obsidian.md/) - 优秀的笔记应用
- [EMLOG](https://www.emlog.net/) - 轻量级博客系统
- 所有贡献者和用户

## 📞 支持

如果你遇到问题或有建议，请：

- 📧 提交 [Issue](https://github.com/qimuai/obsidian-emlog/issues)
- ⭐ 给项目点个星
- 🐛 报告 Bug
- 💡 提出新功能建议

---

**享受在 Obsidian 中发布博客的便捷体验！** 🎉
