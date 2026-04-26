/**
 * Centralized i18n module for LLM-for-Zotero Lite.
 *
 * Design: English is the source of truth. All UI strings stay hardcoded in
 * English throughout the codebase. The `t()` function wraps them — when the
 * user picks Chinese, it looks up a translation map; otherwise it returns the
 * original English string unchanged.
 *
 * Adding a new English string requires NO changes here — it will just show
 * in English until a Chinese translation is added to the map.
 */

// ── Chinese (Simplified) translation map ────────────────────────────────────

const zhCN: Record<string, string> = {
  // ── Shortcut actions ────────────────────────────────────────────────────
  Summarize: "摘要",
  "Key Points": "要点",
  Methodology: "方法论",
  Limitations: "局限性",

  // ── Chat panel UI ───────────────────────────────────────────────────────
  "LLM-for-Zotero Lite": "LLM-for-Zotero Lite",
  "Start a new chat": "开始新对话",
  "Conversation history": "对话历史",
  "Paper chat": "论文对话",
  Settings: "设置",
  "Open plugin settings": "打开插件设置",
  Clear: "清除",
  Rename: "重命名",
  "Rename chat": "重命名对话",
  Undo: "撤销",
  "Restore deleted conversation": "恢复已删除的对话",
  Copy: "复制",
  "Delete conversation": "删除对话",
  "Delete this turn": "删除此轮对话",
  "Delete this prompt and response": "删除此提问和回答",
  "Question timeline": "问题导航",
  Question: "问题",
  "Jump to question": "跳转到问题",
  "Upload files": "上传文件",
  "Add documents or images": "添加文档或图片",
  "Select references": "选择参考文献",
  "Add papers from your library": "从你的文献库添加论文",
  "Selected image preview": "已选图片预览",
  "Expand figures": "展开图片",
  "Clear selected images": "清除已选图片",
  "Expand files": "展开文件",
  "Clear uploaded files": "清除已上传文件",
  "Ask about this paper... Use + to add context, @ to search papers":
    "询问关于这篇论文的问题... 用 + 添加上下文，@ 搜索论文",
  "Open a PDF first": "请先打开一个 PDF",
  "Add context": "添加上下文",
  Reasoning: "推理",
  Send: "发送",
  Cancel: "取消",
  Ready: "就绪",
  "Select an item or open a PDF": "选择一个条目或打开 PDF",

  // ── Status messages ─────────────────────────────────────────────────────
  "No assistant text selected": "没有选中助手文本",
  "Copied response": "已复制回复",
  "No deletable turn found": "没有可删除的对话轮次",
  "Could not open plugin settings": "无法打开插件设置",
  "Could not focus this paper": "无法聚焦到此论文",
  "Failed to fully delete turn. Check logs.":
    "未能完全删除对话轮次，请查看日志。",
  "Turn deleted": "已删除对话轮次",
  "Turn restored": "已恢复对话轮次",
  "Cannot delete while generating": "生成中无法删除",
  "Delete target changed": "删除目标已更改",
  "Turn deleted. Undo available.": "已删除对话轮次。可撤销。",
  "Conversation restored": "对话已恢复",
  "Chat title cannot be empty": "对话标题不能为空",
  "History is unavailable while generating": "生成中无法查看历史",
  "Conversation renamed": "对话已重命名",
  "Failed to rename conversation": "重命名对话失败",
  "No active library for deletion": "没有可用的文献库用于删除",
  "Cannot resolve active paper session": "无法解析当前论文会话",
  "Cannot delete active conversation right now": "当前无法删除活跃的对话",
  "Conversation deleted. Undo available.": "对话已删除。可撤销。",
  "Open a paper to start a paper chat": "打开一篇论文以开始论文对话",
  "No active paper for paper chat": "没有活跃的论文用于论文对话",
  "Failed to create paper chat": "创建论文对话失败",
  "Reused existing new chat": "已复用现有新对话",
  "Started new paper chat": "已开始新的论文对话",
  "Conversation loaded": "对话已加载",
  "Paper already selected": "论文已选中",
  "File already selected": "文件已选中",
  "Figures cleared": "图片已清除",
  "Files cleared": "文件已清除",
  "File pinned for next sends": "文件已固定于后续发送",
  "File unpinned": "文件已取消固定",
  "Selected text removed": "已移除选中文本",
  Cancelled: "已取消",
  "Selection cancelled": "选择已取消",
  "Type after @ to search papers.": "在 @ 后输入内容以搜索论文。",
  "Deleted one turn": "已删除一轮对话",
  "No models configured yet.": "尚未配置模型。",
  "Select model": "选择模型",
  "Reasoning level": "推理级别",
  "Expand files panel": "展开文件面板",
  "Collapse files panel": "收起文件面板",
  "Expand figures panel": "展开图片面板",
  "Collapse figures panel": "收起图片面板",
  "Text context pinned for next sends": "文本上下文已固定于后续发送",
  "Text context unpinned": "文本上下文已取消固定",
  "Image pinned for next sends": "图片已固定于后续发送",
  "Image unpinned": "图片已取消固定",
  "Paper set to always send full text.": "论文已设为始终发送全文。",
  "Paper set to retrieval mode.": "论文已设为检索模式。",
  "Paper context added. Full text will be sent on the next turn.":
    "论文上下文已添加。全文将在下一轮发送。",
  "Source: MinerU (enhanced markdown)": "来源: MinerU（增强 Markdown）",
  "(MinerU)": "（MinerU）",
  "Failed to fully delete conversation. Check logs.":
    "未能完全删除对话，请查看日志。",

  // ── Constants / count labels ────────────────────────────────────────────
  "Add Text": "添加文本",
  "Add selected text to LLM panel": "将选中文本添加到 LLM 面板",
  Figure: "图片",
  Figures: "图片",
  Files: "文件",
  Papers: "论文",
  Primary: "主要",
  Secondary: "次要",

  Title: "标题",
  Author: "作者",
  Year: "年份",
  Added: "添加日期",
  Failed: "失败",
  Processing: "解析中",

  // ── Preferences page ───────────────────────────────────────────────────
  "AI Providers": "AI 服务商",
  Customization: "自定义",
  MinerU: "MinerU",
  "Custom System Prompt (Optional)": "自定义系统提示词（可选）",
  "Custom instructions for the AI assistant...": "为 AI 助手设置自定义指令...",
  "Add custom instructions to the default system prompt (leave empty to use default only)":
    "在默认系统提示词基础上添加自定义指令（留空则仅使用默认）",
  "View default system prompt": "查看默认系统提示词",
  "MinerU PDF Parsing": "MinerU PDF 解析",
  "Use existing MinerU cache as a structured paper-chat text source when available.":
    "可用时使用已有 MinerU 缓存作为结构化论文聊天文本源。",
  "Prefer MinerU cache when available": "可用时优先使用 MinerU 缓存",
  "Test Connection": "测试连接",
  "Testing…": "测试中…",
  "✓ Connection successful": "✓ 连接成功",
  "Each provider has an auth mode, API URL, and one or more model variants.":
    "每个服务商有一个认证模式、API URL 和一个或多个模型变体。",
  "Choose a preset above, or switch to Customized to enter a full base URL or endpoint manually.":
    '选择上方的预设，或切换到"自定义"以手动输入完整的基础 URL 或端点。',
  "codex auth usually uses https://chatgpt.com/backend-api/codex/responses":
    "codex 认证通常使用 https://chatgpt.com/backend-api/codex/responses",
  "Switch Provider to Customized to edit this URL manually.":
    '将服务商切换到"自定义"以手动编辑此 URL。',
  "Switch to Customized to edit the URL manually.":
    '切换到"自定义"以手动编辑 URL。',
  Provider: "服务商",
  Customized: "自定义",
  Protocol: "协议",
  "API URL": "API URL",
  "API Key": "API 密钥",
  "codex auth": "codex 认证",
  "Codex Auth": "Codex 认证",
  "Auth Mode": "认证模式",
  "Model names": "模型名称",
  "Add model": "添加模型",
  "Fill in the current model name first": "请先填写当前模型名称",
  Test: "测试",
  "Advanced options": "高级选项",
  "Remove model": "移除模型",
  "Remove provider": "移除服务商",
  Temperature: "温度",
  "Max tokens": "最大 Token 数",
  "Input cap": "输入上限",
  "Temperature: randomness (0–2)  ·  Max tokens: output limit  ·  Input cap: context limit (optional)":
    "温度：随机性 (0–2)  ·  最大 Token 数：输出限制  ·  输入上限：上下文限制（可选）",
  "Complete the empty provider first": "请先完善空白的服务商",
  "Add provider": "添加服务商",
  "+ Add Provider": "+ 添加服务商",
  "API URL is required": "API URL 为必填项",
  "API Key is required": "API 密钥为必填项",
  "codex token missing. Run `codex login` first.":
    "codex 令牌缺失。请先运行 `codex login`。",
  "Provider capability: ": "服务商能力: ",
  "✓ Success — model says: ": "✓ 成功 — 模型回复: ",
  "codex auth reuses local `codex login` credentials from ~/.codex/auth.json":
    "codex 认证复用本地 `codex login` 凭据（~/.codex/auth.json）",
  "GitHub Copilot": "GitHub Copilot",
  "Login with GitHub Copilot": "使用 GitHub Copilot 登录",
  "Re-login": "重新登录",
  "Logged in to GitHub Copilot": "已登录 GitHub Copilot",
  "Log out": "登出",
  "Requesting device code…": "正在请求设备码…",
  "Enter this code on GitHub:": "在 GitHub 上输入此代码：",
  "Login successful!": "登录成功！",
  "Copilot token missing. Click Login first.":
    "Copilot 令牌缺失。请先点击登录。",
  "GitHub Copilot uses device-based login. Click Login to authenticate via GitHub.":
    "GitHub Copilot 使用设备认证。点击登录按钮通过 GitHub 进行认证。",
  "Fetch available models": "获取可用模型",
  "Fetching models…": "正在获取模型…",
  "No models found": "未找到模型",
  "Synced %n models": "已同步 %n 个模型",

  // ── Language setting ────────────────────────────────────────────────────
  Language: "语言",
  "Auto (follow Zotero)": "自动（跟随 Zotero）",
  "Restart Zotero to apply language change.": "重启 Zotero 以应用语言更改。",
};

// ── Runtime state ────────────────────────────────────────────────────────────

let currentLocale: string = "auto";

/**
 * Initialize i18n — call once at plugin startup.
 */
export function initI18n(): void {
  try {
    const pref = Zotero.Prefs.get(
      "extensions.zotero.llmforzoterolite.locale",
      true,
    );
    currentLocale = typeof pref === "string" ? pref : "auto";
  } catch {
    currentLocale = "auto";
  }
}

function getEffectiveLocale(): string {
  if (currentLocale !== "auto") return currentLocale;
  try {
    return (Zotero as unknown as { locale?: string }).locale || "en-US";
  } catch {
    return "en-US";
  }
}

/**
 * Translate an English UI string.
 *
 * - When locale is Chinese: look up the zhCN map; fall back to the English
 *   string if no translation exists.
 * - When locale is English (or anything else): return the English string as-is.
 *
 * Usage:  `button.textContent = t("Start All");`
 */
export function t(en: string): string {
  if (getEffectiveLocale().startsWith("zh")) {
    return zhCN[en] ?? en;
  }
  return en;
}

/**
 * Returns the welcome screen HTML, translated if needed.
 * Centralized here to keep the full welcome text in one place.
 */
export function getWebChatWelcomeHtml(
  targetLabel?: string,
  targetDomain?: string,
): string {
  const label = targetLabel || "WebChat";
  const domain = targetDomain || "the chat site";
  if (getEffectiveLocale().startsWith("zh")) {
    return `
      <div class="llm-welcome">
        <div class="llm-welcome-icon">🌐</div>
        <div class="llm-welcome-text">
          <div class="llm-welcome-title">${label} Web Sync 模式</div>
          <ul class="llm-welcome-list">
            <li>你的问题将通过浏览器扩展直接发送到 <strong>${domain}</strong>。请确保扩展已安装并且对应的标签页已打开。</li>
            <li>右键点击论文标签可切换是否发送 <strong>PDF 全文</strong>。紫色 = 发送，灰色 = 跳过。</li>
            <li>在模型支持视觉输入时，可附加图片文件或 PDF 页面。</li>
            <li>点击 <strong>Exit</strong> 按钮可退出 WebChat 模式，恢复到常规 API 模式。</li>
          </ul>
        </div>
      </div>
    `;
  }
  return `
    <div class="llm-welcome">
      <div class="llm-welcome-icon">🌐</div>
      <div class="llm-welcome-text">
        <div class="llm-welcome-title">${label} Web Sync mode</div>
        <ul class="llm-welcome-list">
          <li>Your questions are sent directly to <strong>${domain}</strong> via the browser extension. Make sure the extension is installed and a ${label} tab is open.</li>
          <li>Right-click a paper chip to toggle sending its <strong>full PDF</strong>. Purple = send, grey = skip.</li>
          <li>Attach image files or PDF pages when the model supports vision.</li>
          <li>Click the <strong>Exit</strong> button to leave WebChat mode and return to regular API mode.</li>
        </ul>
      </div>
    </div>
  `;
}

export function getPaperChatStartPageHtml(): string {
  if (getEffectiveLocale().startsWith("zh")) {
    return `
      <div class="llm-start-page">
        <div class="llm-start-page-title">LLM-for-Zotero Lite</div>
        <div class="llm-start-page-subtitle">从这里开始，读懂这篇论文的一切</div>
        <div class="llm-start-page-desc">
          <p>论文对话回答关于当前活跃论文的问题。论文将在你提问前预加载到上下文中。</p>
          <p>内联添加上下文：选中文本后点击 <strong>Add Text</strong>，或使用 <strong>@论文</strong>。左键点击论文标签发送 PDF；右键点击切换全文/检索模式。</p>
          <p>如果启用了 <strong>MinerU</strong>，这里会优先使用增强 Markdown 和图像信息；没有缓存时会自动回退到 PDF 文本。</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="llm-start-page">
      <div class="llm-start-page-title">LLM-for-Zotero Lite</div>
      <div class="llm-start-page-subtitle">Understand everything of this paper, from here</div>
      <div class="llm-start-page-desc">
        <p>Paper chat answers questions about your current active paper. The paper will be pre-loaded into context before your first question.</p>
        <p>Add context inline: select text and click <strong>Add Text</strong>, or use <strong>@papers</strong>. Left-click a paper chip to send its PDF; right-click to toggle between full-text and retrieval mode.</p>
        <p>If <strong>MinerU</strong> is enabled, the panel prefers enhanced markdown and figure-aware context; otherwise it falls back to standard PDF text.</p>
      </div>
    </div>
  `;
}
