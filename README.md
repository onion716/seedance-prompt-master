# 提示词大师（Prompt Master）

纯前端（HTML + CSS + JavaScript）提示词生成工具，面向即梦 Seedance 2.0 分镜提示词创作。

## 页面结构

- **提示词生成**：根据 `jimeng-video` skills 规则生成提示词
- **生成记录**：本地记录每次输入参数与生成结果
- **AI 设置**：默认 GLM Coding 配置，首次需填写 API Key

## 本地运行

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## 部署到 GitHub Pages

1. 将仓库推送到 GitHub（`main` 分支）。
2. 打开仓库 `Settings` -> `Pages`。
3. `Build and deployment` 选择 `Deploy from a branch`。
4. Branch 选择 `main`，Folder 选择 `/ (root)`，保存。
5. 等待 1-3 分钟后，访问生成的网址（格式通常为 `https://<用户名>.github.io/<仓库名>/`）。

## 默认 AI 配置

```json
{
  "provider": "glm",
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "apiType": "openai-chat-completions",
  "modelId": "glm-4.7-flash",
  "maxOutputTokens": 2048,
  "apiKey": "GLM_API_KEY"
}
```

> 注意：如果出现 `Failed to fetch`，通常是 CORS 限制。请改用支持当前站点跨域的 Base URL，或使用你自己的后端代理。
