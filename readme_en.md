# Claude-to-OpenAI API Proxy (Hono TypeScript Version)

A TypeScript/Node.js implementation of the Claude-to-OpenAI API proxy using the Hono web framework.

## Features

- **Fast and lightweight**: Built with Hono framework for optimal performance
- **TypeScript**: Full type safety and modern development experience
- **API compatibility**: Translates Claude API requests to OpenAI format
- **Streaming support**: Real-time streaming responses
- **Model mapping**: Automatic mapping between Claude and OpenAI models
- **Client validation**: Optional Anthropic API key validation
- **Flexible configuration**: Environment-based configuration

## Installation

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
```

## Configuration

Edit the `.env` file with your configuration:

```env
# Optional - API Configuration
OPENAI_BASE_URL=https://api.openai.com/v1

# Optional - Server settings
HOST=0.0.0.0
PORT=8082
LOG_LEVEL=INFO
```

Note: OPENAI_API_KEY is no longer configured globally. Clients must provide their own OpenAI API key in each request via the `x-api-key` header or `Authorization: Bearer` header.

## Usage

```bash
# Development mode with hot reload
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Type checking
pnpm type-check

# Linting
pnpm lint
```

## API Endpoints

- `POST /v1/messages` - Create a message (supports streaming)
- `POST /v1/messages/count_tokens` - Count tokens in a request
- `GET /health` - Health check
- `GET /test-connection` - Test OpenAI API connectivity
- `GET /` - API information

## Model Mapping

- Claude Haiku models → `SMALL_MODEL` (default: openai/gpt-oss-120b)
- Claude Sonnet models → `MIDDLE_MODEL` (default: openai/gpt-oss-120b)
- Claude Opus models → `BIG_MODEL` (default: openai/gpt-oss-120b)

## Architecture

```
src/
├── api/           # API routes and handlers
├── core/          # Core functionality (config, client, logging)
├── models/        # TypeScript type definitions
├── conversion/    # Request/response converters
└── index.ts       # Application entry point
```

## Development

The project uses:
- **Hono**: Fast web framework
- **TypeScript**: Type safety
- **tsx**: Fast TypeScript execution
- **ESLint**: Code linting
- **OpenAI SDK**: OpenAI API client

## Environment Variables

See `.env.example` for all available configuration options.

## License

MIT