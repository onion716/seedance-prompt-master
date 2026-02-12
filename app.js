const STORAGE_KEYS = {
  settings: "prompt-master-ai-settings",
  records: "prompt-master-records",
  sessionApiKey: "prompt-master-session-api-key",
};

const VIEW_META = {
  generator: {
    title: "提示词生成",
    subtitle: "基于 jimeng-video skills 生成可直接粘贴到即梦的分镜提示词",
  },
  records: {
    title: "生成记录",
    subtitle: "本地保存每次参数与生成结果，支持回填复用",
  },
  settings: {
    title: "AI 设置",
    subtitle: "BYOK 模式：每位成员填写自己的 API Key，经 Vercel 代理调用",
  },
};

const SKILL_FILE_PATHS = [
  "./jimeng-video/SKILL.md",
  "./jimeng-video/references/jimeng_video_guide.md",
  "./jimeng-video/references/prompt_templates.md",
];

const FALLBACK_SKILL_CONTEXT = `
你是即梦 Seedance 2.0 视频分镜提示词专家，请遵循以下规则：
1) 只输出分镜提示词正文，不输出任何标题、说明、建议或附加解释。
2) 分段时长规范：4-6秒=1-2段；7-10秒=2-3段；11-15秒=3-5段。
3) 每段结构：[运镜方式] + [主体] + [动作] + [场景] + [氛围/音效]。
4) 主体、动作、场景必须具体，不可模糊。
5) 输出格式固定为：X-Y秒画面：运镜 + 主体 + 动作 + 场景 + 氛围/音效
`;

const DEFAULT_SETTINGS = {
  mode: "merge",
  provider: "vercel-proxy",
  baseUrl: "/api/generate",
  apiType: "proxy-or-openai-chat-completions",
  modelId: "glm-4.7",
  modelName: "GLM-4.7",
  reasoning: false,
  input: ["text", "image"],
  contextWindow: 200000,
  maxTokens: 8192,
  userAgent: "CodexCLI/2026.1",
  maxOutputTokens: 4096,
  apiKey: "",
};

const state = {
  skillContext: FALLBACK_SKILL_CONTEXT.trim(),
  settings: attachSessionApiKey(sanitizeStoredSettings(readJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS))),
  records: normalizeRecords(readJson(STORAGE_KEYS.records, [])),
  activeView: "generator",
};

const elements = {
  menuItems: Array.from(document.querySelectorAll(".menu-item[data-view-target]")),
  views: Array.from(document.querySelectorAll(".view[data-view]")),
  viewTitle: document.getElementById("view-title"),
  viewSubtitle: document.getElementById("view-subtitle"),
  goSettingsBtn: document.getElementById("go-settings-btn"),
  skillContextStatus: document.getElementById("skill-context-status"),

  promptForm: document.getElementById("prompt-form"),
  clearFormBtn: document.getElementById("clear-form-btn"),
  generateBtn: document.getElementById("generate-btn"),
  generationStatus: document.getElementById("generation-status"),
  outputArea: document.getElementById("generated-output"),
  copyOutputBtn: document.getElementById("copy-output-btn"),
  counters: Array.from(document.querySelectorAll("[data-counter-for]")),

  recordsList: document.getElementById("records-list"),
  recordSearchInput: document.getElementById("record-search-input"),
  clearRecordsBtn: document.getElementById("clear-records-btn"),

  settingsForm: document.getElementById("settings-form"),
  settingsStatus: document.getElementById("settings-status"),
  resetSettingsBtn: document.getElementById("reset-settings-btn"),

  settingApiKey: document.getElementById("setting-api-key"),
  settingBaseUrl: document.getElementById("setting-base-url"),
};

init();

async function init() {
  bindNavigation();
  bindGeneratorEvents();
  bindRecordEvents();
  bindSettingsEvents();
  bindCounters();

  hydrateSettingsForm();
  renderRecords();

  const hashView = parseHashView();
  setActiveView(hashView || "generator", false);

  await loadJimengSkillContext();
  refreshApiHint();
}

function bindNavigation() {
  for (const item of elements.menuItems) {
    item.addEventListener("click", () => setActiveView(item.dataset.viewTarget || "generator"));
  }

  elements.goSettingsBtn.addEventListener("click", () => setActiveView("settings"));

  window.addEventListener("hashchange", () => {
    const hashView = parseHashView();
    if (hashView && hashView !== state.activeView) {
      setActiveView(hashView, false);
    }
  });
}

function bindGeneratorEvents() {
  elements.promptForm.addEventListener("submit", handleGenerate);

  elements.clearFormBtn.addEventListener("click", () => {
    elements.promptForm.reset();
    updateAllCounters();
    setGenerationStatus("已清空输入。", "info");
  });

  elements.copyOutputBtn.addEventListener("click", async () => {
    const text = elements.outputArea.value.trim();
    if (!text) return;

    const ok = await copyText(text);
    if (ok) {
      setGenerationStatus("已复制生成结果。", "success");
    } else {
      setGenerationStatus("复制失败，请手动复制。", "warning");
    }
  });
}

function bindRecordEvents() {
  elements.recordSearchInput.addEventListener("input", renderRecords);

  elements.clearRecordsBtn.addEventListener("click", () => {
    if (!state.records.length) return;
    const shouldClear = window.confirm("确定清空全部生成记录吗？该操作不可撤销。");
    if (!shouldClear) return;

    state.records = [];
    persistRecords();
    renderRecords();
  });

  elements.recordsList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const actionButton = target.closest("[data-record-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.recordAction;
    const id = actionButton.dataset.id;
    if (!id || !action) return;

    const record = state.records.find((item) => item.id === id);
    if (!record) return;

    if (action === "fill") {
      fillFormByRecord(record);
      setActiveView("generator");
      setGenerationStatus("已回填记录参数，可直接二次生成。", "success");
      return;
    }

    if (action === "copy") {
      const ok = await copyText(record.output);
      setGenerationStatus(ok ? "已复制记录内容。" : "复制失败，请手动复制。", ok ? "success" : "warning");
      return;
    }

    if (action === "delete") {
      state.records = state.records.filter((item) => item.id !== id);
      persistRecords();
      renderRecords();
    }
  });
}

function bindSettingsEvents() {
  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(elements.settingsForm);
    const apiKey = String(formData.get("apiKey") || "").trim();
    const baseUrl = String(formData.get("baseUrl") || "").trim();
    const resolvedBaseUrl = baseUrl || DEFAULT_SETTINGS.baseUrl;

    const next = normalizeSettings({
      ...DEFAULT_SETTINGS,
      apiKey,
      baseUrl: resolvedBaseUrl,
    });

    if (!next.apiKey) {
      setSettingsStatus("BYOK 模式下必须填写 API Key。", "warning");
      return;
    }

    state.settings = next;
    persistSettings();
    writeSessionApiKey(state.settings.apiKey);
    refreshApiHint();
    setSettingsStatus("设置已保存。API Key 仅保存在当前浏览器会话。", "success");
  });

  elements.resetSettingsBtn.addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS, apiKey: "" };
    persistSettings();
    clearSessionApiKey();
    hydrateSettingsForm();
    refreshApiHint();
    setSettingsStatus("已恢复默认配置，请重新填写 API Key。", "warning");
  });
}

function bindCounters() {
  updateAllCounters();
  for (const counter of elements.counters) {
    const fieldId = counter.dataset.counterFor;
    if (!fieldId) continue;
    const field = document.getElementById(fieldId);
    if (!field) continue;

    field.addEventListener("input", () => updateCounter(fieldId, counter));
  }
}

function updateAllCounters() {
  for (const counter of elements.counters) {
    const fieldId = counter.dataset.counterFor;
    if (!fieldId) continue;
    updateCounter(fieldId, counter);
  }
}

function updateCounter(fieldId, counterEl) {
  const field = document.getElementById(fieldId);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;

  const max = field.maxLength > 0 ? field.maxLength : 0;
  const used = field.value.length;
  counterEl.textContent = max ? `${used} / ${max}` : String(used);
}

async function loadJimengSkillContext() {
  setSkillStatus("正在加载 jimeng-video skills 规则...", "info");

  try {
    const results = await Promise.all(
      SKILL_FILE_PATHS.map(async (path) => {
        const text = await fetchTextWithTimeout(path, 8000);
        return { path, text: text.trim() };
      })
    );

    const context = results
      .filter((item) => item.text)
      .map((item) => `### ${item.path}\n${item.text}`)
      .join("\n\n");

    if (!context) {
      throw new Error("技能文档为空");
    }

    state.skillContext = context;
    setSkillStatus("jimeng-video skills 已加载，将按技能规则生成。", "ok");
  } catch (error) {
    console.error(error);
    state.skillContext = FALLBACK_SKILL_CONTEXT.trim();
    setSkillStatus("技能文件读取失败，已切换为内置规则。", "error");
  }
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-cache",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${url} 读取失败（${response.status}）`);
    }

    return await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${url} 读取超时（>${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function setSkillStatus(message, level) {
  const el = elements.skillContextStatus;
  el.textContent = message;
  el.classList.remove("ok", "error");
  if (level === "ok") el.classList.add("ok");
  if (level === "error") el.classList.add("error");
}

function refreshApiHint() {
  if (!state.settings.apiKey) {
    setGenerationStatus("尚未配置 API Key（BYOK），请先到“AI 设置”完成配置。", "warning");
    return;
  }

  const statusText = elements.generationStatus.textContent;
  if (statusText.includes("API Key") || statusText.includes("未检测到")) {
    setGenerationStatus("API 已配置，填写参数后即可生成。", "info");
  }
}

function parseHashView() {
  const hash = window.location.hash.replace("#", "").trim();
  if (!hash) return "";
  return Object.prototype.hasOwnProperty.call(VIEW_META, hash) ? hash : "";
}

function setActiveView(view, syncHash = true) {
  const nextView = Object.prototype.hasOwnProperty.call(VIEW_META, view) ? view : "generator";
  state.activeView = nextView;

  for (const item of elements.menuItems) {
    item.classList.toggle("is-active", item.dataset.viewTarget === nextView);
  }

  for (const section of elements.views) {
    section.classList.toggle("is-active", section.dataset.view === nextView);
  }

  const meta = VIEW_META[nextView];
  elements.viewTitle.textContent = meta.title;
  elements.viewSubtitle.textContent = meta.subtitle;

  if (syncHash) {
    window.location.hash = nextView;
  }
}

async function handleGenerate(event) {
  event.preventDefault();
  const payload = collectPromptFormData();
  const validationMessage = validatePayload(payload);

  if (validationMessage) {
    setGenerationStatus(validationMessage, "error");
    return;
  }

  if (!state.settings.apiKey) {
    setGenerationStatus("未检测到 API Key（BYOK），请先在 AI 设置中完成配置。", "warning");
    setActiveView("settings");
    setSettingsStatus("请先填写 API Key 并保存。", "warning");
    return;
  }

  setGeneratingState(true);
  setGenerationStatus("正在调用 AI 生成，请稍候...", "info");
  const endpoint = isProxyEndpoint(state.settings.baseUrl)
    ? resolveProxyEndpoint(state.settings.baseUrl)
    : resolveChatCompletionsEndpoint(state.settings.baseUrl);

  try {
    const output = ensureCompleteOutput(normalizeGeneratedOutput(await requestAI(payload)), payload);
    setOutput(output);
    saveRecord(payload, output, "AI");
    renderRecords();
    setGenerationStatus("生成成功，已保存到本地记录。", "success");
  } catch (error) {
    console.error(error);
    const diagnostics = explainRequestError(error, endpoint);
    const fallbackOutput = buildFallbackPrompt(payload, diagnostics.rawMessage);
    setOutput(fallbackOutput);
    saveRecord(payload, fallbackOutput, "Fallback");
    renderRecords();
    setGenerationStatus(diagnostics.userMessage, "warning");
  } finally {
    setGeneratingState(false);
  }
}

function setGeneratingState(isLoading) {
  elements.generateBtn.disabled = isLoading;
  elements.generateBtn.textContent = isLoading ? "生成中..." : "生成提示词";
}

function setOutput(text) {
  elements.outputArea.value = text.trim();
  elements.copyOutputBtn.disabled = !elements.outputArea.value;
}

function collectPromptFormData() {
  const formData = new FormData(elements.promptForm);
  return {
    promptTitle: String(formData.get("promptTitle") || "").trim(),
    theme: String(formData.get("theme") || "").trim(),
    videoType: String(formData.get("videoType") || "").trim(),
    videoDuration: String(formData.get("videoDuration") || "").trim(),
    coreContent: String(formData.get("coreContent") || "").trim(),
    stylePreference: String(formData.get("stylePreference") || "").trim(),
    cameraStyle: String(formData.get("cameraStyle") || "").trim(),
    referenceImages: String(formData.get("referenceImages") || "").trim(),
    referenceVideos: String(formData.get("referenceVideos") || "").trim(),
    referenceAudios: String(formData.get("referenceAudios") || "").trim(),
    specialRequirement: String(formData.get("specialRequirement") || "").trim(),
  };
}

function validatePayload(payload) {
  if (!payload.promptTitle) return "请填写提示词标题。";
  if (payload.promptTitle.length > 100) return "提示词标题不能超过 100 字。";
  if (!payload.theme) return "请填写主题。";
  if (payload.theme.length > 300) return "主题不能超过 300 字。";
  if (!payload.videoType) return "请选择视频类型。";
  if (!payload.videoDuration) return "请选择视频时长。";
  if (!payload.coreContent) return "请填写核心内容。";
  if (!payload.stylePreference) return "请填写风格偏好。";
  return "";
}

async function requestAI(payload) {
  if (isProxyEndpoint(state.settings.baseUrl)) {
    return requestAIByProxy(payload);
  }

  return requestAIDirect(payload);
}

async function requestAIByProxy(payload) {
  const endpoint = resolveProxyEndpoint(state.settings.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.settings.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let data = null;

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    if (!response.ok) {
      throw new Error(`请求失败（${response.status}）且返回非 JSON 数据。`);
    }
    throw new Error("AI 返回非 JSON 格式，无法解析。");
  }

  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）：${extractApiError(data)}`);
  }

  const output = extractProxyOutput(data);
  if (!output) {
    throw new Error("代理返回为空。");
  }

  return output;
}

async function requestAIDirect(payload) {
  const endpoint = resolveChatCompletionsEndpoint(state.settings.baseUrl);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(payload);

  const requestBody = {
    model: state.settings.modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    max_tokens: state.settings.maxOutputTokens,
    temperature: 0.2,
    stream: false,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.settings.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const rawText = await response.text();
  let data = null;

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    if (!response.ok) {
      throw new Error(`请求失败（${response.status}）且返回非 JSON 数据。`);
    }
    throw new Error("AI 返回非 JSON 格式，无法解析。");
  }

  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）：${extractApiError(data)}`);
  }

  const output = extractResponseText(data);
  if (!output) {
    throw new Error("AI 返回为空。");
  }

  return output;
}

function resolveProxyEndpoint(baseUrl) {
  const clean = String(baseUrl || "").trim();
  if (!clean) return "/api/generate";
  return clean;
}

function resolveChatCompletionsEndpoint(baseUrl) {
  const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!clean) return "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions";
  if (clean.endsWith("/chat/completions")) return clean;
  return `${clean}/chat/completions`;
}

function explainRequestError(error, endpoint) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const endpointOrigin = safeOrigin(endpoint);

  if (rawMessage.includes("401") || rawMessage.includes("Unauthorized")) {
    return {
      rawMessage,
      userMessage: "认证失败（401）。请检查你在页面中填写的 GLM API Key（通常为 id.secret）是否正确且仍有效。",
    };
  }

  if (rawMessage.includes("403")) {
    return {
      rawMessage,
      userMessage: `访问被拒绝（403）。若使用 Vercel 代理，请检查 Vercel 环境变量与账号权限；若直连，请确认 ${endpointOrigin} 的跨域策略。`,
    };
  }

  if (rawMessage.includes("Failed to fetch")) {
    return {
      rawMessage: `${rawMessage}（可能是 CORS 拦截）`,
      userMessage: `AI 请求被浏览器拦截（CORS）。请让 ${endpointOrigin} 放开当前站点跨域，或改用支持 CORS 的 Base URL。`,
    };
  }

  return {
    rawMessage,
    userMessage: `AI 请求失败：${rawMessage}`,
  };
}

function extractProxyOutput(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.output === "string") return data.output.trim();
  if (typeof data.result === "string") return data.result.trim();
  return "";
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (error) {
    return url;
  }
}

function buildSystemPrompt() {
  const contextSnippet = state.skillContext.slice(0, 16000);
  return [
    "你是提示词大师中的即梦 Seedance 2.0 视频分镜提示词专家。",
    "目标：输出可直接粘贴到即梦的分镜提示词正文。",
    "硬性规则：",
    "1) 严格遵循用户指定时长段落，按时间顺序输出。",
    "2) 每段必须使用结构：运镜 + 主体 + 动作 + 场景 + 氛围/音效。",
    "3) 主体、动作、场景要具体，禁止模糊词（如“一个人”“某个地方”）。",
    "4) 仅输出分镜段落正文，禁止输出任何标题、说明、素材引用、优化建议、总结。",
    "5) 不要输出 Markdown 标题符号（#）和加粗符号（**）。",
    "6) 严禁输出与分镜段落无关内容。",
    "",
    "输出模板（只允许这种行结构）：",
    "X-Y秒画面：运镜 + 主体 + 动作 + 场景 + 氛围/音效",
    "X-Y秒画面：运镜 + 主体 + 动作 + 场景 + 氛围/音效",
    "",
    "以下为必须遵循的技能规则摘录：",
    contextSnippet,
  ].join("\n");
}

function buildUserPrompt(payload) {
  const slots = getDurationSlots(payload.videoDuration);
  return [
    "请根据以下需求生成即梦 Seedance 2.0 分镜提示词：",
    `提示词标题：${payload.promptTitle}`,
    `主题：${payload.theme}`,
    `视频类型：${payload.videoType}`,
    `视频时长：${payload.videoDuration}`,
    `核心内容：${payload.coreContent}`,
    `风格偏好：${payload.stylePreference}`,
    `运镜偏好：${payload.cameraStyle || "无额外偏好，请按主题设计"}`,
    `参考图片：${payload.referenceImages || "无"}`,
    `参考视频：${payload.referenceVideos || "无"}`,
    `参考音频：${payload.referenceAudios || "无"}`,
    `特殊要求：${payload.specialRequirement || "无"}`,
    "",
    "段落时间规划（必须逐条对应输出）：",
    ...slots.map((slot) => `- ${slot}画面`),
    "",
    "额外要求：",
    `- 必须输出 ${slots.length} 段分镜，不能多也不能少。`,
    "- 每段都写成可直接用于生成的视频画面描述，不要写占位符。",
    "- 除分镜段落正文外，不要输出任何其他字段。",
    "- 语言使用简体中文。",
  ].join("\n");
}

function normalizeGeneratedOutput(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureCompleteOutput(text, payload) {
  const slots = getDurationSlots(payload.videoDuration);
  const fallbackSegments = buildSegments(payload.videoDuration, payload);

  const segmentMatches = Array.from(text.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?(\d+\-\d+秒画面：[^\n]+)/g))
    .map((match) => match[1].trim())
    .filter(Boolean);
  const segmentLines = [];

  for (let index = 0; index < slots.length; index += 1) {
    segmentLines.push(segmentMatches[index] || fallbackSegments[index]);
  }

  return segmentLines.join("\n\n");
}

function extractApiError(data) {
  if (!data) return "未知错误";
  if (typeof data.error === "string") return data.error;
  if (typeof data.message === "string") return data.message;
  if (data.error && typeof data.error.message === "string") return data.error.message;
  return "服务端返回异常";
}

function extractResponseText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  collectText(data.output, chunks);
  if (!chunks.length) collectText(data.response, chunks);
  if (!chunks.length) collectText(data.choices, chunks);

  const deduped = [];
  for (const chunk of chunks.map((item) => String(item).trim()).filter(Boolean)) {
    if (!deduped.length || deduped[deduped.length - 1] !== chunk) {
      deduped.push(chunk);
    }
  }

  return deduped.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function collectText(value, bucket) {
  if (!value) return;

  if (typeof value === "string") {
    bucket.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, bucket);
    return;
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") bucket.push(value.text);
    if (typeof value.output_text === "string") bucket.push(value.output_text);
    if (typeof value.content === "string") {
      bucket.push(value.content);
    } else if (value.content) {
      collectText(value.content, bucket);
    }
    if (typeof value.message === "string") {
      bucket.push(value.message);
    } else if (value.message) {
      collectText(value.message, bucket);
    }
    if (value.output) collectText(value.output, bucket);
  }
}

function buildFallbackPrompt(payload, reason) {
  const segments = buildSegments(payload.videoDuration, payload);
  void reason;
  return segments.join("\n\n");
}

function buildSegments(duration, payload) {
  const slots = getDurationSlots(duration);
  const cameraDefaults = payload.cameraStyle
    ? payload.cameraStyle
        .split(/[，。；;\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : ["推镜头", "跟随镜头", "环绕镜头", "拉镜头", "一镜到底"];

  return slots.map((slot, index) => {
    const camera = cameraDefaults[index] || cameraDefaults[cameraDefaults.length - 1] || "跟随镜头";
    return `${slot}画面：${camera} + 主体动作「${payload.coreContent}」 + 场景围绕「${payload.theme}」展开 + 氛围风格「${payload.stylePreference}」`;
  });
}

function getDurationSlots(duration) {
  if (duration === "4-6秒") return ["0-3秒", "3-6秒"];
  if (duration === "7-10秒") return ["0-3秒", "3-7秒", "7-10秒"];
  return ["0-3秒", "3-6秒", "6-9秒", "9-12秒", "12-15秒"];
}

function setGenerationStatus(message, type = "info") {
  elements.generationStatus.textContent = message;
  elements.generationStatus.className = `status status-${type}`;
}

function setSettingsStatus(message, type = "info") {
  elements.settingsStatus.textContent = message;
  elements.settingsStatus.className = `status status-${type}`;
}

function saveRecord(input, output, source) {
  const record = {
    id: createId(),
    createdAt: new Date().toISOString(),
    source,
    input,
    output,
  };

  state.records.unshift(record);
  persistRecords();
}

function persistRecords() {
  writeJson(STORAGE_KEYS.records, state.records);
}

function persistSettings() {
  writeJson(STORAGE_KEYS.settings, {
    ...state.settings,
    apiKey: "",
  });
}

function renderRecords() {
  const keyword = elements.recordSearchInput.value.trim().toLowerCase();
  const filtered = state.records.filter((record) => {
    if (!keyword) return true;
    const title = record.input.promptTitle.toLowerCase();
    const theme = record.input.theme.toLowerCase();
    return title.includes(keyword) || theme.includes(keyword);
  });

  if (!filtered.length) {
    elements.recordsList.innerHTML = '<p class="empty-tip">暂无记录，先去“提示词生成”创建一条吧。</p>';
    return;
  }

  elements.recordsList.innerHTML = filtered
    .map((record) => {
      const details = [
        `视频类型：${record.input.videoType}`,
        `视频时长：${record.input.videoDuration}`,
        `核心内容：${record.input.coreContent}`,
        `风格偏好：${record.input.stylePreference}`,
        `运镜偏好：${record.input.cameraStyle || "无"}`,
        `参考图片：${record.input.referenceImages || "无"}`,
        `参考视频：${record.input.referenceVideos || "无"}`,
        `参考音频：${record.input.referenceAudios || "无"}`,
        `特殊要求：${record.input.specialRequirement || "无"}`,
      ];

      return `
      <article class="record-card">
        <div class="record-head">
          <div>
            <h4>${escapeHtml(record.input.promptTitle)}</h4>
            <p class="record-time">${formatDate(record.createdAt)}</p>
          </div>
          <span class="record-source">${escapeHtml(record.source)}</span>
        </div>
        <p class="record-theme">主题：${escapeHtml(record.input.theme)}</p>
        <div class="record-meta">
          <span>类型：${escapeHtml(record.input.videoType)}</span>
          <span>时长：${escapeHtml(record.input.videoDuration)}</span>
        </div>
        <details>
          <summary>查看完整参数与生成内容</summary>
          <div class="record-details">
            <div class="detail-grid">
              ${details.map((item) => `<div><strong>${escapeHtml(item.split("：")[0])}</strong>：${escapeHtml(item.split("：").slice(1).join("："))}</div>`).join("")}
            </div>
            <pre class="record-output">${escapeHtml(record.output)}</pre>
            <div class="record-actions">
              <button class="btn-secondary" data-record-action="fill" data-id="${record.id}" type="button">回填生成</button>
              <button class="btn-secondary" data-record-action="copy" data-id="${record.id}" type="button">复制结果</button>
              <button class="btn-danger" data-record-action="delete" data-id="${record.id}" type="button">删除记录</button>
            </div>
          </div>
        </details>
      </article>`;
    })
    .join("");
}

function fillFormByRecord(record) {
  const data = record.input;
  const entries = {
    promptTitle: data.promptTitle,
    theme: data.theme,
    videoType: data.videoType,
    coreContent: data.coreContent,
    stylePreference: data.stylePreference,
    cameraStyle: data.cameraStyle,
    referenceImages: data.referenceImages,
    referenceVideos: data.referenceVideos,
    referenceAudios: data.referenceAudios,
    specialRequirement: data.specialRequirement,
  };

  for (const [key, value] of Object.entries(entries)) {
    const field = elements.promptForm.elements.namedItem(key);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
      field.value = value || "";
    }
  }

  const durationRadios = elements.promptForm.querySelectorAll('input[name="videoDuration"]');
  for (const radio of durationRadios) {
    if (!(radio instanceof HTMLInputElement)) continue;
    radio.checked = radio.value === data.videoDuration;
  }

  setOutput(record.output);
  updateAllCounters();
}

function hydrateSettingsForm() {
  elements.settingApiKey.value = state.settings.apiKey;
  elements.settingBaseUrl.value = state.settings.baseUrl;
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readSessionApiKey() {
  try {
    return String(window.sessionStorage.getItem(STORAGE_KEYS.sessionApiKey) || "").trim();
  } catch (error) {
    return "";
  }
}

function writeSessionApiKey(apiKey) {
  try {
    if (!apiKey) {
      window.sessionStorage.removeItem(STORAGE_KEYS.sessionApiKey);
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEYS.sessionApiKey, String(apiKey).trim());
  } catch (error) {
    // no-op
  }
}

function clearSessionApiKey() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEYS.sessionApiKey);
  } catch (error) {
    // no-op
  }
}

function attachSessionApiKey(settings) {
  return {
    ...settings,
    apiKey: readSessionApiKey(),
  };
}

function sanitizeStoredSettings(raw) {
  const storedBaseUrl = String(raw?.baseUrl || "").trim();
  const storedModelId = String(raw?.modelId || "").trim();
  const storedModelName = String(raw?.modelName || "").trim();
  const legacyDirectBaseUrls = [
    "https://open.bigmodel.cn/api/paas/v4",
    "https://open.bigmodel.cn/api/coding/paas/v4",
  ];

  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...raw,
    apiKey: "",
    baseUrl: legacyDirectBaseUrls.includes(storedBaseUrl) ? "/api/generate" : storedBaseUrl || DEFAULT_SETTINGS.baseUrl,
    modelId: storedModelId === "glm-4.7-flash" ? "glm-4.7" : storedModelId || DEFAULT_SETTINGS.modelId,
    modelName: storedModelName === "GLM-4.7-Flash" ? "GLM-4.7" : storedModelName || DEFAULT_SETTINGS.modelName,
  });
}

function isProxyEndpoint(baseUrl) {
  const clean = String(baseUrl || "").trim();
  if (!clean) return true;
  if (clean.includes("/api/generate")) return true;
  if (clean.startsWith("/api/")) return true;
  try {
    const url = new URL(clean, window.location.origin);
    return url.pathname.startsWith("/api/");
  } catch (error) {
    return false;
  }
}

function normalizeSettings(raw) {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    maxOutputTokens: toPositiveInt(raw?.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens),
    contextWindow: toPositiveInt(raw?.contextWindow, DEFAULT_SETTINGS.contextWindow),
    maxTokens: toPositiveInt(raw?.maxTokens, DEFAULT_SETTINGS.maxTokens),
    reasoning: Boolean(raw?.reasoning ?? DEFAULT_SETTINGS.reasoning),
    apiKey: String(raw?.apiKey || DEFAULT_SETTINGS.apiKey).trim(),
    baseUrl: String(raw?.baseUrl || DEFAULT_SETTINGS.baseUrl).trim(),
    provider: String(raw?.provider || DEFAULT_SETTINGS.provider).trim(),
    mode: String(raw?.mode || DEFAULT_SETTINGS.mode).trim(),
    modelId: String(raw?.modelId || DEFAULT_SETTINGS.modelId).trim(),
    modelName: String(raw?.modelName || DEFAULT_SETTINGS.modelName).trim(),
    apiType: String(raw?.apiType || DEFAULT_SETTINGS.apiType).trim(),
    userAgent: String(raw?.userAgent || DEFAULT_SETTINGS.userAgent).trim(),
    input: Array.isArray(raw?.input) && raw.input.length ? raw.input : DEFAULT_SETTINGS.input,
  };
}

function normalizeRecords(rawRecords) {
  if (!Array.isArray(rawRecords)) return [];
  return rawRecords
    .filter((item) => item && typeof item === "object" && item.id && item.input && item.output)
    .map((item) => ({
      id: String(item.id),
      createdAt: item.createdAt || new Date().toISOString(),
      source: item.source || "AI",
      input: {
        promptTitle: String(item.input.promptTitle || ""),
        theme: String(item.input.theme || ""),
        videoType: String(item.input.videoType || ""),
        videoDuration: String(item.input.videoDuration || ""),
        coreContent: String(item.input.coreContent || ""),
        stylePreference: String(item.input.stylePreference || ""),
        cameraStyle: String(item.input.cameraStyle || ""),
        referenceImages: String(item.input.referenceImages || ""),
        referenceVideos: String(item.input.referenceVideos || ""),
        referenceAudios: String(item.input.referenceAudios || ""),
        specialRequirement: String(item.input.specialRequirement || ""),
      },
      output: String(item.output || ""),
    }));
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function formatDate(isoString) {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch (error) {
    return isoString;
  }
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "readonly");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();
    const result = document.execCommand("copy");
    document.body.removeChild(helper);
    return Boolean(result);
  }
}
