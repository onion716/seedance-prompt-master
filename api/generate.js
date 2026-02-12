const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4";
const DEFAULT_MODEL = "glm-4.7";

const SKILL_FILE_PATHS = [
  path.join(process.cwd(), "jimeng-video", "SKILL.md"),
  path.join(process.cwd(), "jimeng-video", "references", "jimeng_video_guide.md"),
  path.join(process.cwd(), "jimeng-video", "references", "prompt_templates.md"),
];

const FALLBACK_SKILL_CONTEXT = `
你是即梦 Seedance 2.0 视频分镜提示词专家，请遵循以下规则：
1) 只输出分镜提示词正文，不输出任何标题、说明、建议或附加解释。
2) 分段时长规范：4-6秒=1-2段；7-10秒=2-3段；11-15秒=3-5段。
3) 每段结构：[运镜方式] + [主体] + [动作] + [场景] + [氛围/音效]。
4) 主体、动作、场景必须具体，不可模糊。
5) 输出格式固定为：X-Y秒画面：运镜 + 主体 + 动作 + 场景 + 氛围/音效
`;

let cachedSkillContext = "";

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "仅支持 POST 请求。" });
    return;
  }

  try {
    const payload = parsePayload(req.body);
    const validationMessage = validatePayload(payload);
    if (validationMessage) {
      res.status(400).json({ error: validationMessage });
      return;
    }

    const apiKey = resolveApiKey(req, payload);
    if (!apiKey) {
      res.status(401).json({ error: "缺少 API Key。请在页面 AI 设置中填写后再生成。" });
      return;
    }

    const baseUrl = resolveBaseUrl(process.env.GLM_BASE_URL || DEFAULT_BASE_URL);
    const endpoint = resolveEndpoint(baseUrl);
    const model = String(process.env.GLM_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const skillContext = await loadSkillContext();

    const requestBody = {
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(skillContext) },
        { role: "user", content: buildUserPrompt(payload) },
      ],
      max_tokens: 4096,
      temperature: 0.2,
      stream: false,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const rawText = await response.text();
    let data = {};

    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      if (!response.ok) {
        res.status(response.status).json({ error: `上游返回非 JSON（${response.status}）。` });
        return;
      }
      res.status(502).json({ error: "上游返回非 JSON，无法解析。" });
      return;
    }

    if (!response.ok) {
      res.status(response.status).json({ error: extractApiError(data) });
      return;
    }

    const output = ensureCompleteOutput(normalizeGeneratedOutput(extractResponseText(data)), payload);
    if (!output) {
      res.status(502).json({ error: "上游返回为空内容。" });
      return;
    }

    res.status(200).json({
      output,
      model,
      provider: "glm",
      mode: "vercel-proxy-byok",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `代理请求失败：${message}` });
  }
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parsePayload(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (error) {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
}

function resolveApiKey(req, payload) {
  const authHeader = readHeader(req, "authorization");
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch && bearerMatch[1]) {
      return bearerMatch[1].trim();
    }
    return authHeader.trim();
  }

  const bodyKey = payload && typeof payload === "object" ? String(payload.apiKey || "").trim() : "";
  return bodyKey;
}

function readHeader(req, name) {
  if (!req || !req.headers) return "";
  const lowerName = String(name || "").toLowerCase();
  if (typeof req.headers.get === "function") {
    return String(req.headers.get(lowerName) || req.headers.get(name) || "").trim();
  }
  const value = req.headers[lowerName] ?? req.headers[name];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "请求体为空。";
  if (!String(payload.promptTitle || "").trim()) return "请填写提示词标题。";
  if (!String(payload.theme || "").trim()) return "请填写主题。";
  if (!String(payload.videoType || "").trim()) return "请选择视频类型。";
  if (!String(payload.videoDuration || "").trim()) return "请选择视频时长。";
  if (!String(payload.coreContent || "").trim()) return "请填写核心内容。";
  if (!String(payload.stylePreference || "").trim()) return "请填写风格偏好。";
  return "";
}

async function loadSkillContext() {
  if (cachedSkillContext) return cachedSkillContext;

  try {
    const contents = await Promise.all(
      SKILL_FILE_PATHS.map(async (filePath) => {
        const text = await fs.readFile(filePath, "utf8");
        return `### ${path.basename(filePath)}\n${text.trim()}`;
      })
    );
    const merged = contents.filter(Boolean).join("\n\n").trim();
    cachedSkillContext = merged || FALLBACK_SKILL_CONTEXT.trim();
  } catch (error) {
    cachedSkillContext = FALLBACK_SKILL_CONTEXT.trim();
  }

  return cachedSkillContext;
}

function resolveBaseUrl(baseUrl) {
  const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
  return clean || DEFAULT_BASE_URL;
}

function resolveEndpoint(baseUrl) {
  if (baseUrl.endsWith("/chat/completions")) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function buildSystemPrompt(skillContext) {
  const contextSnippet = String(skillContext || "").slice(0, 16000);
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
    `提示词标题：${String(payload.promptTitle || "").trim()}`,
    `主题：${String(payload.theme || "").trim()}`,
    `视频类型：${String(payload.videoType || "").trim()}`,
    `视频时长：${String(payload.videoDuration || "").trim()}`,
    `核心内容：${String(payload.coreContent || "").trim()}`,
    `风格偏好：${String(payload.stylePreference || "").trim()}`,
    `运镜偏好：${String(payload.cameraStyle || "").trim() || "无额外偏好，请按主题设计"}`,
    `特殊要求：${String(payload.specialRequirement || "").trim() || "无"}`,
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

function getDurationSlots(duration) {
  if (duration === "4-6秒") return ["0-3秒", "3-6秒"];
  if (duration === "7-10秒") return ["0-3秒", "3-7秒", "7-10秒"];
  return ["0-3秒", "3-6秒", "6-9秒", "9-12秒", "12-15秒"];
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

function buildSegments(duration, payload) {
  const slots = getDurationSlots(duration);
  const cameraDefaults = String(payload.cameraStyle || "")
    .split(/[，。；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const fallbackCameras = cameraDefaults.length ? cameraDefaults : ["推镜头", "跟随镜头", "环绕镜头", "拉镜头", "一镜到底"];

  return slots.map((slot, index) => {
    const camera = fallbackCameras[index] || fallbackCameras[fallbackCameras.length - 1] || "跟随镜头";
    return `${slot}画面：${camera} + 主体动作「${payload.coreContent}」 + 场景围绕「${payload.theme}」展开 + 氛围风格「${payload.stylePreference}」`;
  });
}
