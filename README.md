# 提示词大师（Prompt Master）

前端 + Vercel 轻量代理提示词生成工具，面向即梦 Seedance 2.0 分镜提示词创作。

## 页面结构

- **提示词生成**：根据 `jimeng-video` skills 规则生成提示词
- **生成记录**：本地记录每次输入参数与生成结果
- **AI 设置**：BYOK（每位用户填写自己的 API Key，服务端不保存）

## 本地运行（前端）

```bash
python3 -m http.server 8080
```

访问 `http://localhost:8080`

> 说明：该方式仅预览前端，`/api/generate` 需要部署到 Vercel 后才可用。

## 部署到 Vercel（推荐）

1. 将仓库推送到 GitHub（`main` 分支）。
2. 在 Vercel 导入此仓库（Framework 选择 `Other`）。
3. 在 Vercel 项目 `Settings -> Environment Variables` 可选配置：
   - `GLM_BASE_URL`：`https://open.bigmodel.cn/api/coding/paas/v4`（可选）
   - `GLM_MODEL`：`glm-4.7`（可选）
4. 重新部署后，前端 `AI 设置` 中 Base URL 填 `/api/generate`（默认即是）。
5. 每位使用者都需要在页面中填写自己的 API Key（BYOK）。

## 默认 AI 配置（Vercel 代理模式）

```json
{
  "provider": "vercel-proxy",
  "baseUrl": "/api/generate",
  "apiType": "proxy-or-openai-chat-completions",
  "modelId": "glm-4.7",
  "maxOutputTokens": 2048,
  "apiKey": "每位用户自行填写"
}
```

> 注意：API Key 仅保存在浏览器当前会话（sessionStorage）。关闭页面后需重新填写。
