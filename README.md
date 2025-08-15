# Claude-to-OpenAI API 代理 (Hono TypeScript 版本)

使用 Hono Web 框架的 TypeScript/Node.js 实现的 Claude-to-OpenAI API 代理。

[English Version](./readme_en.md)

## 功能特性

- **快速轻量**: 基于 Hono 框架构建，实现最佳性能
- **TypeScript**: 完整的类型安全和现代化开发体验
- **API 兼容性**: 将 Claude API 请求转换为 OpenAI 格式
- **流式支持**: 实时流式响应
- **模型映射**: Claude 和 OpenAI 模型之间的自动映射
- **客户端验证**: 可选的 Anthropic API 密钥验证
- **灵活配置**: 基于环境变量的配置

## 安装

```bash
# 安装依赖
pnpm install

# 复制环境配置文件
cp .env.example .env
```

## 配置

编辑 `.env` 文件进行配置：

```env
# 可选 - API 配置
OPENAI_BASE_URL=https://api.openai.com/v1

# 可选 - 服务器设置
HOST=0.0.0.0
PORT=8082
LOG_LEVEL=INFO
```

注意：OPENAI_API_KEY 不再全局配置。客户端必须通过 `x-api-key` 头或 `Authorization: Bearer` 头在每个请求中提供自己的 OpenAI API 密钥。

## 使用方法

```bash
# 开发模式，支持热重载
pnpm dev

# 构建生产版本
pnpm build

# 启动生产服务器
pnpm start

# 类型检查
pnpm type-check

# 代码检查
pnpm lint
```

## API 端点

- `POST /v1/messages` - 创建消息（支持流式传输）
- `POST /v1/messages/count_tokens` - 计算请求中的令牌数
- `GET /health` - 健康检查
- `GET /test-connection` - 测试 OpenAI API 连接
- `GET /` - API 信息

## 模型映射

- Claude Haiku 模型 → `SMALL_MODEL`（默认：openai/gpt-oss-120b）
- Claude Sonnet 模型 → `MIDDLE_MODEL`（默认：openai/gpt-oss-120b）
- Claude Opus 模型 → `BIG_MODEL`（默认：openai/gpt-oss-120b）

## 架构

```
src/
├── api/           # API 路由和处理器
├── core/          # 核心功能（配置、客户端、日志）
├── models/        # TypeScript 类型定义
├── conversion/    # 请求/响应转换器
└── index.ts       # 应用程序入口点
```

## 开发

项目使用：
- **Hono**: 快速 Web 框架
- **TypeScript**: 类型安全
- **tsx**: 快速 TypeScript 执行
- **ESLint**: 代码检查
- **OpenAI SDK**: OpenAI API 客户端

## Cloudflare Workers 部署

该项目可以部署为 Cloudflare Worker，步骤如下：

1. 安装 wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. 登录 Cloudflare:
   ```bash
   wrangler login
   ```

3. 构建 Cloudflare Worker 版本:
   ```bash
   pnpm build-cf
   ```

4. 部署到 Cloudflare:
   ```bash
   pnpm deploy-cf
   ```

Cloudflare Worker 版本使用标准 fetch API 而不是 OpenAI SDK，以确保与 Cloudflare Workers 运行时的兼容性。

配置变量可以在 `wrangler.toml` 文件中设置，或通过 Cloudflare 仪表板进行配置。

## 环境变量

请参阅 `.env.example` 文件了解所有可用的配置选项。

## 许可证

MIT