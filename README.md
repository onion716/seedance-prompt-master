# 提示词大师（Prompt Master）

纯前端（HTML + CSS + JavaScript）提示词生成工具，面向即梦 Seedance 2.0 分镜提示词创作。

## 页面结构

- **提示词生成**：根据 `jimeng-video` skills 规则生成提示词
- **生成记录**：本地记录每次输入参数与生成结果
- **AI 设置**：默认 gmn + OpenAI Responses 配置，首次需填写 API Key

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
  "models": {
    "mode": "merge",
    "providers": {
      "gmn": {
        "baseUrl": "https://gmn.chuangzuoli.com/v1",
        "apiKey": "OPENAI_API_KEY",
        "api": "openai-responses",
        "models": [
          {
            "id": "gpt-5.3-codex",
            "name": "GPT 5.3 Codex",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 16384,
            "headers": { "User-Agent": "CodexCLI/2026.1" }
          }
        ]
      }
    }
  }
}
```

> 注意：浏览器环境无法手动设置 `User-Agent` 请求头，该字段会在页面中保留用于配置展示。
