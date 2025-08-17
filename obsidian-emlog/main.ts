import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, DropdownComponent, requestUrl, ItemView, WorkspaceLeaf, Modal } from 'obsidian';
import md5 from 'blueimp-md5';
// Electron shell 可能在类型上不可用，这里用可选调用 + window.open 兜底
let openExternal: ((url: string) => void) | undefined;
try { openExternal = (require('electron') as any)?.shell?.openExternal; } catch {}

interface EmlogSettings {
	baseUrl: string;
	authMode: 'sign' | 'apikey' | 'cookie';
	apiKey: string;
	defaultAuthorUid: string;
	defaultSortId: string;
	defaultDraft: boolean;
	autoCover: boolean;
	allowRemark: boolean;
	postAction: 'none' | 'open' | 'copy' | 'both';
	enableDebug: boolean;
}

interface PluginState {
	settings: EmlogSettings;
	articleMap: Record<string, number>; // filePath -> article_id
}

type FlatSort = { id: number; name: string; depth: number };

const DEFAULT_SETTINGS: EmlogSettings = {
	baseUrl: '',
	authMode: 'sign',
	apiKey: '',
	defaultAuthorUid: '',
	defaultSortId: '',
	defaultDraft: true,
	autoCover: true,
	allowRemark: true,
	postAction: 'open',
	enableDebug: false,
}

const VIEW_TYPE_EMLOG_PANEL = 'emlog-panel';

type PublishOverrides = {
	title?: string;
	sortId?: string;
	tags?: string;
	excerpt?: string;
	draft?: boolean;
	postDate?: string;
	coverImage?: string;
	top?: string; // 首页置顶，是y，否n，默认否
	sortop?: string; // 分类置顶，是y，否n，默认否
	allowRemark?: string; // 允许评论，是y，否n，默认否
	password?: string; // 访问密码
};

export default class ObsidianEmlogPlugin extends Plugin {
	settings: EmlogSettings;
	articleMap: Record<string, number> = {};
	private statusEl: HTMLElement | null = null;
	private cachedSorts: FlatSort[] = [];
	private lastMarkdownFile: TFile | null = null;

	async onload() {
		await this.loadSettings();

		this.statusEl = this.addStatusBarItem();
		this.setStatus('就绪');

		// 记录最近激活的 Markdown 文件
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			const view = leaf?.view as any;
			if (view && view.file && view instanceof MarkdownView) {
				this.lastMarkdownFile = view.file;
			}
		}));

		// 将操作挂到右侧面板视图
		this.registerView(VIEW_TYPE_EMLOG_PANEL, (leaf) => new EmlogPanelView(leaf, this));

		// 顶部图标：打开面板
		this.addRibbonIcon('dice', '打开 EMLOG 面板', () => {
			this.activatePanelView();
		});

		// 命令
		this.addCommand({ id: 'emlog-open-panel', name: '打开/切换 EMLOG 面板', callback: () => this.activatePanelView() });
		this.addCommand({ id: 'emlog-publish-current', name: '发布当前笔记到 EMLOG', callback: () => this.publishCurrentNote(false) });
		this.addCommand({ id: 'emlog-publish-draft', name: '发布为草稿到 EMLOG', callback: () => this.publishCurrentNote(true) });
		this.addCommand({ id: 'emlog-publish-note', name: '发布微语（当前选中文本或提示输入）', callback: () => this.publishNote() });
		this.addCommand({ id: 'emlog-publish-custom', name: '自定义发布…', callback: () => {
			const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file || this.lastMarkdownFile;
			if (!file) { new Notice('未检测到 Markdown 文件'); return; }
			new Notice('打开自定义发布窗口…');
			this.openPublishModal(file, this.app.workspace.getActiveViewOfType(MarkdownView)?.editor);
		}});

		// 将发布命令挂到编辑器“更多选项”菜单
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor: Editor, view: MarkdownView) => {
			if (!view?.file) return;
			menu.addItem((i) => i.setTitle('发布到 EMLOG（正式）').setIcon('paper-plane').onClick(() => this.publishFromContext(editor, view, false)));
			menu.addItem((i) => i.setTitle('发布到 EMLOG（草稿）').setIcon('paper-plane').onClick(() => this.publishFromContext(editor, view, true)));
			menu.addItem((i) => i.setTitle('自定义发布…').setIcon('forms').onClick(() => this.openPublishModal((view.file) || this.lastMarkdownFile)));
			menu.addSeparator();
			menu.addItem((i) => i.setTitle('发布微语（选中文本）').setIcon('message-square').onClick(async () => {
				const text = editor.getSelection();
				if (!text) { new Notice('请选择要发布为微语的文本'); return; }
				try { await this.httpForm('note_post', { t: text }); new Notice('微语发布成功'); } catch (e: any) { new Notice(`微语发布失败：${e.message ?? e}`); }
			}));
		}));

		// 将发布命令挂到文件浏览器菜单
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file: TFile) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			menu.addItem((i) => i.setTitle('发布到 EMLOG（正式）').setIcon('paper-plane').onClick(async () => {
				const content = await this.app.vault.cachedRead(file);
				await this.publishCore(file, content, false, {});
			}));
			menu.addItem((i) => i.setTitle('发布到 EMLOG（草稿）').setIcon('paper-plane').onClick(async () => {
				const content = await this.app.vault.cachedRead(file);
				await this.publishCore(file, content, true, {});
			}));
			menu.addItem((i) => i.setTitle('自定义发布…').setIcon('forms').onClick(() => this.openPublishModal(file)));
		}));

		this.addSettingTab(new EmlogSettingTab(this.app, this));
	}

	onunload() {}

	private async loadSettings() {
		const raw = await this.loadData();
		if (!raw) {
			this.settings = { ...DEFAULT_SETTINGS };
			this.articleMap = {};
			return;
		}
		if (raw.settings) {
			this.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
			this.articleMap = raw.articleMap || {};
		} else {
			this.settings = { ...DEFAULT_SETTINGS, ...(raw as EmlogSettings) };
			this.articleMap = {};
		}
	}

	private async saveState() {
		const state: PluginState = {
			settings: this.settings,
			articleMap: this.articleMap,
		};
		await this.saveData(state);
	}

	async saveSettings() {
		await this.saveState();
	}

	private setStatus(text: string) {
		if (this.statusEl) this.statusEl.setText(`EMLOG: ${text}`);
	}

	private debug(...args: any[]) {
		if (!this.settings.enableDebug) return;
		const safe = (v: any) => {
			try {
				if (typeof v === 'string') {
					return this.redactString(v);
				}
				if (typeof v === 'object' && v !== null) {
					const json = JSON.stringify(v);
					return this.redactString(json);
				}
				return v;
			} catch {
				return v;
			}
		};
		try {
			console.debug('[obsidian-emlog]', ...args.map(safe));
		} catch {}
	}

	private redactString(s: string) {
		let out = s;
		if (this.settings.apiKey) {
			const k = this.escapeRegExp(this.settings.apiKey);
			out = out.replace(new RegExp(k, 'g'), '***');
		}
		out = out.replace(/"req_sign"\s*:\s*"[a-fA-F0-9]{16,}"/g, '"req_sign":"***"');
		return out;
	}

	private getActiveMarkdown(): { editor?: Editor, view?: MarkdownView, file: TFile } | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) {
			return { editor: view.editor, view, file: view.file };
		}
		if (this.lastMarkdownFile) {
			return { file: this.lastMarkdownFile };
		}
		new Notice('未找到活动的 Markdown 窗口');
		return null;
	}

	// 实用方法
	public deriveTitle(content: string, file?: TFile, frontmatter?: Record<string, any>): string {
		// 优先从 frontmatter 获取标题
		if (frontmatter?.title) return String(frontmatter.title);
		
		// 从文件名获取标题（去掉扩展名）
		if (file?.basename) return file.basename;
		
		// 从内容中提取第一个标题
		const lines = content.split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith('# ')) {
				return trimmed.substring(2).trim();
			}
		}
		
		// 默认标题
		return '无标题文章';
	}

	public deriveExcerpt(markdown: string, frontmatter?: Record<string, any>): string {
		// 优先从 frontmatter 获取摘要
		if (frontmatter?.excerpt) return String(frontmatter.excerpt);
		
		// 从内容中提取（去掉 frontmatter 和标题）
		let content = markdown;
		
		// 移除 frontmatter
		if (content.startsWith('---\n')) {
			const endIndex = content.indexOf('\n---\n', 4);
			if (endIndex !== -1) {
				content = content.substring(endIndex + 5);
			}
		}
		
		// 移除标题行和空行，取前150字符
		const lines = content.split('\n').filter(line => {
			const trimmed = line.trim();
			return trimmed && !trimmed.startsWith('#');
		});
		
		const text = lines.join(' ').replace(/!\[.*?\]\(.*?\)/g, '').trim();
		return text.length > 150 ? text.substring(0, 150) + '...' : text;
	}

	public extractFrontmatter(file: TFile): Record<string, any> | undefined {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter;
	}

	// 从内容中移除 frontmatter，返回纯内容
	private removeFromContent(content: string): string {
		if (!content.startsWith('---\n')) return content;
		
		const endIndex = content.indexOf('\n---\n', 4);
		if (endIndex === -1) return content;
		
		return content.substring(endIndex + 5);
	}
	public async publishCore(file: TFile, content: string, asDraft: boolean, overrides: PublishOverrides) {
		const fm = this.extractFrontmatter(file) || {};
		const title0 = this.deriveTitle(content, file, fm);
		const title = overrides.title ?? title0;
		const excerpt0 = this.deriveExcerpt(content, fm);
		const excerpt = overrides.excerpt ?? excerpt0;
		const tags = overrides.tags ?? (Array.isArray(fm.tags) ? (fm.tags as any[]).map(String).join(',') : (typeof fm.tags === 'string' ? fm.tags : ''));
		const sortId = overrides.sortId ?? ((fm.sort_id ?? this.settings.defaultSortId) ? String(fm.sort_id ?? this.settings.defaultSortId) : '');
		const authorUid = (fm.author_uid ?? this.settings.defaultAuthorUid) ? String(fm.author_uid ?? this.settings.defaultAuthorUid) : '';
		const postDate = overrides.postDate; // 允许自定义发布时间
		const coverImage = overrides.coverImage ?? (fm.cover_image || fm.coverImage || ''); // 封面图
		const draftFlag = asDraft ? true : (overrides.draft != null ? overrides.draft : (fm.draft === 'y' || fm.draft === true ? true : false));
		// 处理新的发布选项
		const top = overrides.top ?? (fm.top === 'y' || fm.top === true ? 'y' : 'n'); // 首页置顶
		const sortop = overrides.sortop ?? (fm.sortop === 'y' || fm.sortop === true ? 'y' : 'n'); // 分类置顶
		const allowRemarkOverride = overrides.allowRemark ?? (fm.allow_remark === 'n' || fm.allow_remark === false ? 'n' : 'y'); // 允许评论
		const password = overrides.password ?? fm.password ?? ''; // 访问密码

		this.setStatus('上传图片中...');
		// 移除 frontmatter，只发布纯内容
		let finalContent = this.removeFromContent(content);
		try {
			const res = await this.processImages(finalContent, file);
			finalContent = res.content;
		} catch (e) { this.debug('处理图片失败', (e as any)?.message ?? String(e)); }

		const isUpdate = this.articleMap[file.path] != null;
		this.setStatus(isUpdate ? '更新文章中...' : '发布文章中...');
		new Notice(isUpdate ? '正在更新到 EMLOG...' : '正在发布到 EMLOG...');
		
		// 详细调试信息
		this.debug('开始发布文章', {
			isUpdate,
			title,
			contentLength: finalContent.length,
			sortId,
			tags,
			draftFlag,
			authMode: this.settings.authMode,
			baseUrl: this.settings.baseUrl
		});
		
		try {
			if (isUpdate) {
				const id = Number(this.articleMap[file.path]);
				await this.httpForm('article_update', {
					id: String(id),
					title,
					content: finalContent,
					excerpt,
					...(tags ? { tags } : {}),
					...(sortId ? { sort_id: sortId } : {}),
					...(authorUid ? { author_uid: authorUid } : {}),
					draft: draftFlag ? 'y' : 'n',
					...(postDate ? { post_date: postDate } : {}),
					...(coverImage ? { cover: coverImage } : {}),
					// 新增的发布选项
					top: top,
					sortop: sortop,
					allow_remark: allowRemarkOverride,
					...(password ? { password: password } : {}),
				});
				new Notice(`更新成功：${title} (ID: ${id})`);
				this.setStatus('更新成功');
				await this.performPostAction(id, draftFlag);
				const url = await this.fetchArticleUrlById(id);
				await this.upsertFrontmatterKeys(file, { published: !draftFlag, sort_id: sortId || (fm.sort_id ?? ''), emlog_article_id: id, publish_date: this.formatDate(), url: url || '' });
			} else {
				const data = await this.httpForm('article_post', {
					title,
					content: finalContent,
					excerpt,
					...(tags ? { tags } : {}),
					...(sortId ? { sort_id: sortId } : {}),
					...(authorUid ? { author_uid: authorUid } : {}),
					draft: draftFlag ? 'y' : 'n',
					allow_remark: allowRemarkOverride,
					auto_cover: this.settings.autoCover ? 'y' : 'n',
					...(postDate ? { post_date: postDate } : {}),
					...(coverImage ? { cover: coverImage } : {}),
					// 新增的发布选项
					top: top,
					sortop: sortop,
					...(password ? { password: password } : {}),
				});
				
				// EMLOG API 返回格式：{"code":0,"msg":"ok","data":{"article_id":123}}
				const articleId: number = data?.data?.article_id || data?.article_id;
				this.debug('发布响应数据', { data, articleId });
				
				if (articleId) { 
					this.articleMap[file.path] = articleId; 
					await this.saveState(); 
				}
				
				new Notice(`发布成功：${title} (ID: ${articleId ?? '未知'})`);
				this.setStatus('发布成功');
				await this.performPostAction(articleId ?? null, draftFlag);
				
				// 无论是否有 articleId，都更新 frontmatter
				const url = articleId ? await this.fetchArticleUrlById(articleId) : null;
				await this.upsertFrontmatterKeys(file, { 
					published: !draftFlag, 
					sort_id: sortId || (fm.sort_id ?? ''), 
					emlog_article_id: articleId || '', 
					publish_date: this.formatDate(), 
					url: url || '' 
				});
			}
		} catch (e: any) {
			// 详细的错误信息
			const errorDetails = {
				message: e?.message || String(e),
				stack: e?.stack,
				name: e?.name,
				cause: e?.cause,
				response: e?.response,
				status: e?.status,
				statusText: e?.statusText
			};
			
			this.debug('发布失败详细信息', errorDetails);
			
			let userMsg = `发布失败：${e.message ?? e}`;
			
			// 根据错误类型提供更具体的提示
			if (e?.message?.includes('401')) {
				userMsg += '\n🔑 认证失败，请检查 API Key 和认证方式设置';
			} else if (e?.message?.includes('404')) {
				userMsg += '\n🌐 API 路径不正确，请检查博客地址配置';
			} else if (e?.message?.includes('timeout')) {
				userMsg += '\n⏱️ 请求超时，请检查网络连接';
			} else if (e?.message?.includes('CORS')) {
				userMsg += '\n🚫 跨域请求被阻止，这是浏览器安全限制';
			} else if (e?.message?.includes('Request failed')) {
				userMsg += '\n📡 网络请求失败，请检查博客地址和网络连接';
			}
			
			new Notice(userMsg, 10000); // 显示10秒
			this.setStatus('失败');
		}
	}

	private async publishFromContext(editor: Editor, view: MarkdownView, asDraft: boolean) {
		const file = view?.file; if (!file) { new Notice('未检测到 Markdown 文件'); return; }
		const content = editor?.getValue() ?? await this.app.vault.cachedRead(file);
		await this.publishCore(file, content, asDraft, {});
	}

	public async publishCurrentNote(asDraft: boolean) {
		const ctx = this.getActiveMarkdown();
		if (!ctx) return;
		const { editor, file } = ctx;
		const content = editor ? editor.getValue() : await this.app.vault.cachedRead(file);
		await this.publishCore(file, content, asDraft, {});
	}

	public async publishNote() {
		// 尝试多种方式获取选中的文本
		let text = '';
		let editor: Editor | undefined;
		
		// 方法1：从当前活动的 Markdown 视图获取
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.editor) {
			editor = activeView.editor;
			text = editor.getSelection();
		}
		
		// 方法2：如果方法1失败，尝试从最近活动的 Markdown 文件获取
		if (!text && this.lastMarkdownFile) {
			const leaf = this.app.workspace.getLeavesOfType('markdown').find(l => {
				const view = l.view as MarkdownView;
				return view?.file?.path === this.lastMarkdownFile?.path;
			});
			if (leaf) {
				const view = leaf.view as MarkdownView;
				if (view?.editor) {
					editor = view.editor;
					text = editor.getSelection();
				}
			}
		}
		
		// 方法3：如果还是没有选中文本，提示用户
		if (!text) {
			new Notice('请选择要发布为微语的文本');
			return;
		}
		
		this.debug('发布微语', { textLength: text.length, textPreview: text.substring(0, 50) });
		this.setStatus('发布微语中...');
		try {
			await this.httpForm('note_post', { t: text });
			new Notice('微语发布成功');
			this.setStatus('微语已发布');
		} catch (e: any) {
			new Notice(`微语发布失败：${e.message ?? e}`);
			this.setStatus('失败');
			this.debug('微语失败', e?.message ?? String(e));
		}
	}

	private async activatePanelView() {
		let leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) leaf = this.app.workspace.getRightLeaf(true);
		if (!leaf) { new Notice('无法打开右侧面板'); return; }
		await leaf.setViewState({ type: VIEW_TYPE_EMLOG_PANEL, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	public openPublishModal(file: TFile | null, editor?: Editor) {
		if (!file) { new Notice('未找到要发布的 Markdown 文件'); return; }
		new PublishModal(this.app, this, file, editor).open();
	}

	private async fetchArticleUrlById(id: number): Promise<string | null> {
		try {
			// 首先尝试从 API 获取 URL
			const data = await this.httpGet('article_detail', { id: String(id) });
			const url: string | undefined = data?.data?.article?.url || data?.article?.url;
			if (url) return url;
			
			// 如果 API 没有返回 URL，根据博客地址构造 URL
			const baseUrl = this.settings.baseUrl.replace(/\/$/, '');
			const constructedUrl = `${baseUrl}/?post=${id}`;
			this.debug('构造文章 URL', { id, constructedUrl });
			return constructedUrl;
		} catch (e) {
			this.debug('获取文章 URL 失败，使用构造的 URL', e?.message ?? String(e));
			// 即使 API 调用失败，也返回构造的 URL
			const baseUrl = this.settings.baseUrl.replace(/\/$/, '');
			return `${baseUrl}/?post=${id}`;
		}
	}

	private async performPostAction(articleId: number | null, isDraft: boolean) {
		if (isDraft) {
			new Notice('草稿已保存（草稿无公开链接）');
			return;
		}
		if (!articleId) return;
		const action = this.settings.postAction;
		if (action === 'none') return;
		const url = await this.fetchArticleUrlById(articleId);
		if (!url) return;
		if (action === 'open' || action === 'both') {
			try { openExternal ? openExternal(url) : window.open(url, '_blank'); } catch { window.open(url, '_blank'); }
		}
		if (action === 'copy' || action === 'both') {
			try {
				await navigator.clipboard?.writeText?.(url);
				new Notice('文章链接已复制');
			} catch {}
		}
	}

	private flattenSorts(sorts: any[], depth = 0): FlatSort[] {
		const out: FlatSort[] = [];
		for (const s of sorts) {
			const id = Number(s.sid ?? s.id ?? s.sort_id);
			const name = String(s.sortname ?? s.name ?? '未命名');
			out.push({ id, name, depth });
			if (Array.isArray(s.children) && s.children.length > 0) {
				out.push(...this.flattenSorts(s.children, depth + 1));
			}
		}
		return out;
	}

	// 改为 public，供设置页调用
	public async refreshSortOptions(): Promise<void> {
		try {
			const data = await this.httpGet('sort_list', {});
			// EMLOG API 返回格式：{"code":0,"msg":"ok","data":{"sorts":[...]}}
			const sorts = Array.isArray(data?.data?.sorts) ? data.data.sorts : (Array.isArray(data?.sorts) ? data.sorts : []);
			this.cachedSorts = this.flattenSorts(sorts);
			this.debug('分类已刷新', this.cachedSorts.length, '个分类');
			new Notice(`已刷新 ${this.cachedSorts.length} 个分类`);
		} catch (e: any) {
			new Notice(`获取分类失败：${e.message ?? e}`);
			this.cachedSorts = [];
		}
	}

	// 改为 public，供设置页调用
	public populateSortDropdown(dd: DropdownComponent) {
		dd.selectEl.textContent = '';
		dd.addOption('', '（不指定）');
		if (!this.cachedSorts.length) {
			dd.addOption('__placeholder__', this.settings.baseUrl ? '尚未加载分类，点击右侧刷新' : '请先配置站点地址');
			return;
		}
		for (const s of this.cachedSorts) {
			const pad = ' '.repeat(s.depth * 2);
			dd.addOption(String(s.id), `${pad}${s.name}`);
		}
	}

	// 改为 public，供设置页调用
	public getSortNameByIdPublic(id: number | string | null | undefined): string | null {
		if (id == null || id === '') return null;
		const nid = Number(id);
		const f = this.cachedSorts.find(s => s.id === nid);
		return f ? f.name : null;
	}

	private formatDate(d = new Date()): string {
		const pad = (n: number) => n.toString().padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}

	private async upsertFrontmatterKeys(file: TFile, kv: Record<string, string | number | boolean>) {
		const cache = this.app.metadataCache.getFileCache(file);
		const content = await this.app.vault.read(file);
		const fmPos = (cache as any)?.frontmatterPosition;
		const serialize = (v: any) => typeof v === 'boolean' || typeof v === 'number' ? String(v) : JSON.stringify(String(v));
		const upsertInYaml = (yaml: string) => {
			for (const [k, v] of Object.entries(kv)) {
				const re = new RegExp(`^${this.escapeRegExp(k)}\s*:\s*.*$`, 'm');
				if (re.test(yaml)) yaml = yaml.replace(re, `${k}: ${serialize(v)}`);
				else yaml += `\n${k}: ${serialize(v)}`;
			}
			return yaml;
		};
		let next = '';
		if (fmPos) {
			const head = content.slice(0, fmPos.start.offset);
			const yaml = content.slice(fmPos.start.offset + 4, fmPos.end.offset - 4); // remove ---\n and \n---
			const tail = content.slice(fmPos.end.offset);
			const newYaml = upsertInYaml(yaml);
			next = `${head}---\n${newYaml}\n---${tail}`;
		} else if (content.startsWith('---\n')) {
			// 容错：无缓存但文本有 YAML
			const end = content.indexOf('\n---', 4);
			if (end > 0) {
				const yaml = content.slice(4, end);
				const rest = content.slice(end + 4);
				const newYaml = upsertInYaml(yaml);
				next = `---\n${newYaml}\n---${rest}`;
			}
		}
		if (!next) {
			// 无 frontmatter，新建
			let yaml = '';
			for (const [k, v] of Object.entries(kv)) yaml += `${k}: ${serialize(v)}\n`;
			next = `---\n${yaml}---\n${content}`;
		}
		await this.app.vault.modify(file, next);
	}

	public async httpForm(endpoint: string, params: Record<string, string>) {
		// 使用正确的 EMLOG API 路径格式
		const baseUrl = this.settings.baseUrl.replace(/\/$/, ''); // 移除末尾斜杠
		const url = `${baseUrl}/?rest-api=${endpoint}`;
		
		// 构建表单参数，包含认证信息
		const formParams = { ...params };
		let headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
		
		// article_post、article_update 和 note_post 强制使用签名认证（与集成测试一致）
		if (endpoint === 'article_post' || endpoint === 'article_update' || endpoint === 'note_post') {
			const req_time = Math.floor(Date.now() / 1000).toString();
			formParams.req_time = req_time;
			formParams.req_sign = md5(req_time + this.settings.apiKey);
			this.debug('强制使用签名认证', { endpoint, req_time });
		} else if (this.settings.authMode === 'sign') {
			// 其他 API 使用表单参数认证
			const req_time = Math.floor(Date.now() / 1000).toString();
			formParams.req_time = req_time;
			formParams.req_sign = md5(req_time + this.settings.apiKey);
		} else if (this.settings.authMode === 'apikey') {
			headers['X-API-Key'] = this.settings.apiKey;
		} else if (this.settings.authMode === 'cookie') {
			headers['Cookie'] = this.settings.apiKey;
		}
		
		const query = new URLSearchParams(formParams).toString();
		this.debug('HTTP POST', url, '参数长度:', query.length);

		try {
			const response = await requestUrl({
				url: url,
				method: 'POST',
				headers: headers,
				body: query,
			});
			if (response.status === 200) {
				const data = JSON.parse(response.text);
				// EMLOG API 返回格式：{"code":0,"msg":"ok","data":{...}}
				if (data.code === 0 || data.success) {
					this.debug('HTTP POST 成功', data);
					return data;
				} else {
					this.debug('HTTP POST 失败', data);
					throw new Error(`API 调用失败: ${data.msg || data.message || JSON.stringify(data)}`);
				}
			} else {
				throw new Error(`HTTP 状态码: ${response.status}`);
			}
		} catch (e: any) {
			this.debug('HTTP POST 错误，尝试备用路径', e?.message ?? String(e));
			// 尝试备用路径 /index.php?rest-api=...
			const fallbackUrl = `${baseUrl}/index.php?rest-api=${endpoint}`;
			this.debug('HTTP POST 备用路径', fallbackUrl);
			try {
				const response = await requestUrl({
					url: fallbackUrl,
					method: 'POST',
					headers: headers,
					body: query,
				});
				if (response.status === 200) {
					const data = JSON.parse(response.text);
					if (data.code === 0 || data.success) {
						this.debug('HTTP POST 备用路径成功', data);
						return data;
					} else {
						this.debug('HTTP POST 备用路径失败', data);
						throw new Error(`API 调用失败: ${data.msg || data.message || JSON.stringify(data)}`);
					}
				} else {
					throw new Error(`HTTP 状态码: ${response.status}`);
				}
			} catch (fallbackError: any) {
				this.debug('HTTP POST 备用路径也失败', fallbackError?.message ?? String(fallbackError));
				
				// 提供更详细的错误信息
				let detailedError = `API 调用失败，已尝试多个路径:\n`;
				detailedError += `主路径错误: ${e.message}\n`;
				detailedError += `备用路径错误: ${fallbackError?.message ?? String(fallbackError)}\n`;
				detailedError += `请求的 API: ${endpoint}\n`;
				detailedError += `认证方式: ${this.settings.authMode}\n`;
				detailedError += `博客地址: ${baseUrl}`;
				
				throw new Error(detailedError);
			}
		}
	}

	public async httpGet(endpoint: string, params: Record<string, string>): Promise<any> {
		// 使用正确的 EMLOG API 路径格式
		const baseUrl = this.settings.baseUrl.replace(/\/$/, ''); // 移除末尾斜杠
		const query = new URLSearchParams(params).toString();
		const fullUrl = `${baseUrl}/?rest-api=${endpoint}${query ? '&' + query : ''}`;

		this.debug('HTTP GET', fullUrl);

		let headers: Record<string, string> = {};
		if (this.settings.authMode === 'sign') {
			const timestamp = Date.now();
			const nonce = md5(`${timestamp}${this.settings.apiKey}`);
			const reqSign = md5(`${timestamp}${nonce}${this.settings.apiKey}`);
			headers = {
				'X-API-Key': this.settings.apiKey,
				'X-API-Nonce': nonce,
				'X-API-Req-Sign': reqSign,
				'X-API-Timestamp': String(timestamp),
			};
		} else if (this.settings.authMode === 'apikey') {
			headers = { 'X-API-Key': this.settings.apiKey };
		} else if (this.settings.authMode === 'cookie') {
			headers = { 'Cookie': this.settings.apiKey };
		}

		try {
			const response = await requestUrl({
				url: fullUrl,
				method: 'GET',
				headers: headers,
			});
			if (response.status === 200) {
				const data = JSON.parse(response.text);
				// EMLOG API 返回格式：{"code":0,"msg":"ok","data":{...}}
				if (data.code === 0 || data.success) {
					this.debug('HTTP GET 成功', data);
					return data;
				} else {
					this.debug('HTTP GET 失败', data);
					throw new Error(`API 调用失败: ${data.msg || data.message || JSON.stringify(data)}`);
				}
			} else {
				throw new Error(`HTTP 状态码: ${response.status}`);
			}
		} catch (e: any) {
			this.debug('HTTP GET 错误，尝试备用路径', e?.message ?? String(e));
			// 尝试备用路径 /index.php?rest-api=...
			const fallbackUrl = `${baseUrl}/index.php?rest-api=${endpoint}${query ? '&' + query : ''}`;
			this.debug('HTTP GET 备用路径', fallbackUrl);
			try {
				const response = await requestUrl({
					url: fallbackUrl,
					method: 'GET',
					headers: headers,
				});
				if (response.status === 200) {
					const data = JSON.parse(response.text);
					if (data.code === 0 || data.success) {
						this.debug('HTTP GET 备用路径成功', data);
						return data;
					} else {
						this.debug('HTTP GET 备用路径失败', data);
						throw new Error(`API 调用失败: ${data.msg || data.message || JSON.stringify(data)}`);
					}
				} else {
					throw new Error(`HTTP 状态码: ${response.status}`);
				}
			} catch (fallbackError: any) {
				this.debug('HTTP GET 备用路径也失败', fallbackError?.message ?? String(fallbackError));
				
				// 提供更详细的错误信息
				let detailedError = `API 调用失败，已尝试多个路径:\n`;
				detailedError += `主路径错误: ${e.message}\n`;
				detailedError += `备用路径错误: ${fallbackError?.message ?? String(fallbackError)}\n`;
				detailedError += `请求的 API: ${endpoint}\n`;
				detailedError += `认证方式: ${this.settings.authMode}\n`;
				detailedError += `博客地址: ${baseUrl}`;
				
				throw new Error(detailedError);
			}
		}
	}

	public async processImages(markdown: string, current: TFile): Promise<{ content: string; uploaded: Record<string, string> }>{
		const mapping: Record<string, string> = {};
		// ![alt](path)
		const mdImg = /!\[[^\]]*\]\(([^)]+)\)/g;
		let m: RegExpExecArray | null;
		while ((m = mdImg.exec(markdown)) !== null) {
			const p = m[1].trim();
			if (/^(https?:)?\/\//i.test(p) || p.startsWith('data:')) continue;
			const f = this.resolveFile(p, current);
			if (f) {
				try { const url = await (this as any).uploadBinary(f); mapping[p] = url; } catch (e) { this.debug('图片上传失败', p, (e as any)?.message ?? String(e)); }
			}
		}
		// ![[path|...]]
		const wikiImg = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
		while ((m = wikiImg.exec(markdown)) !== null) {
			const p = m[1].trim();
			const f = this.resolveFile(p, current);
			if (f) {
				try { const url = await (this as any).uploadBinary(f); mapping[p] = url; } catch (e) { this.debug('图片上传失败', p, (e as any)?.message ?? String(e)); }
			}
		}
		let next = markdown;
		for (const [p, url] of Object.entries(mapping)) {
			next = next.replace(new RegExp(`!\\[[^\\]]*\\]\\(\n?\t?${this.escapeRegExp(p)}\\)`, 'g'), (mm) => mm.replace(p, url));
			next = next.replace(new RegExp(`!\\[\\[${this.escapeRegExp(p)}(\\|[^\\]]*)?\\]\\]`, 'g'), `![](${url})`);
		}
		return { content: next, uploaded: mapping };
	}

	public joinPath(parentPath: string, relative: string): string {
		if (relative.startsWith('/')) return relative.slice(1);
		const parentDir = parentPath.substring(0, parentPath.lastIndexOf('/'));
		const parts = (parentDir ? parentDir + '/' : '') .concat(relative).split('/');
		const stack: string[] = [];
		for (const seg of parts) {
			if (!seg || seg === '.') continue;
			if (seg === '..') { stack.pop(); continue; }
			stack.push(seg);
		}
		return stack.join('/');
	}

	public resolveFile(pathLike: string, current: TFile): TFile | null {
		const vault = this.app.vault;
		const rel = this.joinPath(current.path, pathLike);
		let f = vault.getFileByPath(rel);
		if (f) return f;
		f = vault.getFileByPath(pathLike);
		if (f) return f;
		const base = pathLike.split('/').pop();
		if (!base) return null;
		const candidates = this.app.vault.getFiles().filter(x => x.name === base);
		return candidates[0] ?? null;
	}

	public escapeRegExp(s: string) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}

class EmlogSettingTab extends PluginSettingTab {
	plugin: ObsidianEmlogPlugin;
	private didRegisterLiveUpdates = false;

	constructor(app: App, plugin: ObsidianEmlogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'obsidian-emlog 设置' });

		new Setting(containerEl)
			.setName('站点地址')
			.setDesc('例如：https://yourdomain')
			.addText(t => t
				.setPlaceholder('https://yourdomain')
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (v) => {
					this.plugin.settings.baseUrl = v.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('鉴权方式')
			.setDesc('签名优先；开发可用 API Key；或使用 Cookie')
			.addDropdown(dd => dd
				.addOption('sign', '签名')
				.addOption('apikey', 'API Key')
				.addOption('cookie', 'Cookie')
				.setValue(this.plugin.settings.authMode)
				.onChange(async (v: 'sign' | 'apikey' | 'cookie') => {
					this.plugin.settings.authMode = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('仅在免签名或签名鉴权中使用；请勿泄露')
			.addText(t => t
				.setPlaceholder('your_api_key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (v) => {
					this.plugin.settings.apiKey = v;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('默认作者 UID')
			.addText(t => t
				.setPlaceholder('可留空')
				.setValue(this.plugin.settings.defaultAuthorUid)
				.onChange(async (v) => {
					this.plugin.settings.defaultAuthorUid = v;
					await this.plugin.saveSettings();
				}));

		const sortSetting = new Setting(containerEl)
			.setName('默认分类')
			.setDesc('从站点动态获取分类列表，选择默认分类（可留空）');
		let sortDD: DropdownComponent;
		sortSetting.addDropdown(dd => {
			sortDD = dd;
			this.plugin.populateSortDropdown(dd);
			dd.setValue(this.plugin.settings.defaultSortId || '');
			dd.onChange(async (v) => {
				if (v === '__placeholder__') return;
				this.plugin.settings.defaultSortId = v;
				await this.plugin.saveSettings();
			});
		});
		sortSetting.addExtraButton(btn => {
			btn.setIcon('reset').setTooltip('刷新分类').onClick(async () => {
				btn.setDisabled(true);
				await this.plugin.refreshSortOptions();
				this.plugin.populateSortDropdown(sortDD);
				sortDD.setValue(this.plugin.settings.defaultSortId || '');
				updateFrontmatterSortLabel();
				btn.setDisabled(false);
			});
		});

		const fmSortSetting = new Setting(containerEl).setName('当前笔记 frontmatter 分类');
		const labelEl = fmSortSetting.settingEl.createDiv({ text: '' });
		labelEl.style.opacity = '0.8';

		const updateFrontmatterSortLabel = () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file;
			if (!file) {
				labelEl.setText('未检测到活动笔记');
				return;
			}
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
			const id = fm.sort_id != null ? Number(fm.sort_id) : null;
			if (!id) {
				labelEl.setText('未设置（frontmatter 中无 sort_id）');
				return;
			}
			const name = this.plugin.getSortNameByIdPublic(id);
			if (name) labelEl.setText(`${name} (ID: ${id})`);
			else labelEl.setText(`未匹配到分类 (ID: ${id})，请先点击上方“刷新分类”`);
		};

		updateFrontmatterSortLabel();

		if (this.plugin.settings.baseUrl) {
			this.plugin.refreshSortOptions().then(() => {
				this.plugin.populateSortDropdown(sortDD);
				sortDD.setValue(this.plugin.settings.defaultSortId || '');
				updateFrontmatterSortLabel();
			}).catch(() => {});
		}

		if (!this.didRegisterLiveUpdates) {
			this.plugin.registerEvent(this.app.workspace.on('active-leaf-change', () => updateFrontmatterSortLabel()));
			this.plugin.registerEvent(this.app.metadataCache.on('changed', () => updateFrontmatterSortLabel()));
			this.didRegisterLiveUpdates = true;
		}
	}
}

class EmlogPanelView extends ItemView {
	plugin: ObsidianEmlogPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: ObsidianEmlogPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE_EMLOG_PANEL; }
	getDisplayText() { return 'EMLOG 发布'; }
	getIcon() { return 'paper-plane'; }

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'EMLOG 操作面板' });

		const wrap = contentEl.createDiv({ cls: 'emlog-panel-actions' });
		const btnPublish = wrap.createEl('button', { text: '发布（正式）' });
		const btnDraft = wrap.createEl('button', { text: '发布为草稿' });
		const btnNote = wrap.createEl('button', { text: '发布微语（选中文本）' });
		const btnRefresh = wrap.createEl('button', { text: '刷新分类' });
		const btnSettings = wrap.createEl('button', { text: '打开设置' });
		const btnCustom = wrap.createEl('button', { text: '自定义发布…' });

		const logEl = contentEl.createEl('div', { cls: 'emlog-panel-log' });
		logEl.setAttr('style', 'margin-top:8px;font-size:12px;opacity:.85;white-space:pre-wrap;');
		const log = (msg: string) => { logEl.setText(`[${new Date().toLocaleTimeString()}] ${msg}`); };

		btnPublish.onclick = async () => { log('发布中...'); await this.plugin.publishCurrentNote(false); };
		btnDraft.onclick = async () => { log('草稿发布中...'); await this.plugin.publishCurrentNote(true); };
		btnNote.onclick = async () => { log('发布微语中...'); await this.plugin.publishNote(); };
		btnRefresh.onclick = async () => { log('刷新分类中...'); await this.plugin.refreshSortOptions(); log('分类已刷新'); };
		btnSettings.onclick = () => (this.app as any).setting?.open();
		btnCustom.onclick = () => this.plugin.openPublishModal((this.app.workspace.getActiveViewOfType(MarkdownView)?.file) || this.plugin['lastMarkdownFile']);
	}

	async onClose() { this.contentEl.empty(); }
}

class PublishModal extends Modal {
	private plugin: ObsidianEmlogPlugin;
	private file: TFile;
	private editor?: Editor;

	private title = '';
	private sortId = '';
	private tags = '';
	private excerpt = '';
	private draft = false;
	private postDate = '';
	private coverImage = '';
	private top = false; // 首页置顶
	private sortop = false; // 分类置顶
	private allowRemark = true; // 允许评论，默认允许
	private password = ''; // 访问密码

	constructor(app: App, plugin: ObsidianEmlogPlugin, file: TFile, editor?: Editor) {
		super(app);
		this.plugin = plugin;
		this.file = file;
		this.editor = editor;
	}

	async onOpen() {
		const { contentEl, modalEl } = this;
		modalEl.addClass('mod-publish-emlog');
		contentEl.empty();
		contentEl.createEl('h3', { text: '自定义发布到 EMLOG' });

		const raw = this.editor ? this.editor.getValue() : await this.app.vault.cachedRead(this.file);
		const fm = this.plugin.extractFrontmatter(this.file) || {};
		this.title = this.plugin.deriveTitle(raw, this.file, fm);
		this.excerpt = this.plugin.deriveExcerpt(raw, fm);
		this.tags = Array.isArray(fm.tags) ? (fm.tags as any[]).map(String).join(',') : (typeof fm.tags === 'string' ? fm.tags : '');
		this.sortId = (fm.sort_id ?? this.plugin.settings.defaultSortId) ? String(fm.sort_id ?? this.plugin.settings.defaultSortId) : '';
		this.draft = fm.draft === 'y' || fm.draft === true || this.plugin.settings.defaultDraft;
		this.coverImage = fm.cover_image || fm.coverImage || '';
		// 初始化新的选项
		this.top = fm.top === 'y' || fm.top === true || false;
		this.sortop = fm.sortop === 'y' || fm.sortop === true || false;
		this.allowRemark = fm.allow_remark !== 'n' && fm.allow_remark !== false; // 默认允许评论
		this.password = fm.password || '';

		new Setting(contentEl).setName('标题').addText(t => t.setValue(this.title).onChange(v => this.title = v));
		new Setting(contentEl).setName('摘要').addTextArea(t => t.setValue(this.excerpt).onChange(v => this.excerpt = v));
		new Setting(contentEl).setName('标签（逗号分隔）').addText(t => t.setValue(this.tags).onChange(v => this.tags = v));
		new Setting(contentEl).setName('封面图').setDesc('图片URL或本地图片路径').addText(t => t.setValue(this.coverImage).onChange(v => this.coverImage = v));

		// 分类刷新与选择
		const sortSetting = new Setting(contentEl).setName('分类');
		const sel = document.createElement('select');
		sel.appendChild(new Option('（不指定）', ''));
		if (this.plugin['cachedSorts']?.length) {
			for (const s of this.plugin['cachedSorts']) {
				const pad = ' '.repeat(s.depth * 2);
				sel.appendChild(new Option(`${pad}${s.name}`, String(s.id)));
			}
		}
		sel.value = this.sortId;
		sel.onchange = () => this.sortId = (sel.value || '');
		sortSetting.settingEl.appendChild(sel);
		new Setting(contentEl).addButton(b => b.setButtonText('刷新分类').onClick(async () => {
			await this.plugin.refreshSortOptions();
			while (sel.firstChild) sel.removeChild(sel.firstChild);
			sel.appendChild(new Option('（不指定）', ''));
			for (const s of this.plugin['cachedSorts']) {
				const pad = ' '.repeat(s.depth * 2);
				sel.appendChild(new Option(`${pad}${s.name}`, String(s.id)));
			}
			if (this.sortId) sel.value = this.sortId;
		}));

		new Setting(contentEl).setName('草稿').addToggle(t => t.setValue(this.draft).onChange(v => this.draft = v));
		new Setting(contentEl).setName('发布时间（可选）').setDesc('格式：YYYY-MM-DD HH:mm:ss').addText(t => t.setPlaceholder('2025-08-15 10:00:00').onChange(v => this.postDate = v));
		
		// 新增的发布选项
		new Setting(contentEl).setName('首页置顶').setDesc('是否在首页置顶显示此文章').addToggle(t => t.setValue(this.top).onChange(v => this.top = v));
		new Setting(contentEl).setName('分类置顶').setDesc('是否在分类页面置顶显示此文章').addToggle(t => t.setValue(this.sortop).onChange(v => this.sortop = v));
		new Setting(contentEl).setName('允许评论').setDesc('是否允许读者对此文章进行评论').addToggle(t => t.setValue(this.allowRemark).onChange(v => this.allowRemark = v));
		new Setting(contentEl).setName('访问密码').setDesc('设置文章访问密码（可选）').addText(t => t.setPlaceholder('留空表示无密码').setValue(this.password).onChange(v => this.password = v));

		new Setting(contentEl).addButton(b => b.setCta().setButtonText('发布').onClick(async () => {
			const raw2 = this.editor ? this.editor.getValue() : await this.app.vault.cachedRead(this.file);
			await this.plugin.publishCore(this.file, raw2, false, {
				title: this.title,
				excerpt: this.excerpt,
				tags: this.tags,
				sortId: this.sortId,
				draft: this.draft,
				postDate: this.postDate || undefined,
				coverImage: this.coverImage || undefined,
				top: this.top ? 'y' : 'n',
				sortop: this.sortop ? 'y' : 'n',
				allowRemark: this.allowRemark ? 'y' : 'n',
				password: this.password || undefined,
			});
			this.close();
		}));
	}
}
