# Security Policy

## Overview

OpenTerminalUI is a financial trading and market data platform. This document describes the security architecture, threat model, and reporting procedures.

## STRIDE Threat Model

| Category | Description | Mitigation |
|----------|-------------|------------|
| **S**poofing | Unauthorized actors impersonating users or services | JWT-based auth with short TTLs, token rotation, dev-bypass restricted to dev environments |
| **T**ampering | Modification of data in transit or at rest | HMAC-signed cache blobs, CSRF double-submit cookies, parameter validation |
| **R**epudiation | Users denying actions taken | Audit logging for all OMS orders, restricted list changes, and system events |
| **I**nformation Disclosure | Exposure of sensitive data (API keys, tokens, PII) | Ephemeral dev secrets, env-var based secret management, no secrets in code |
| **D**enial of Service | Service degradation via resource exhaustion | Rate limiting with exponential backoff, circuit breakers on external providers, request timeouts |
| **E**levation of Privilege | Unauthorized privilege escalation | Role-based access control (Viewer/Trader/Admin), token type validation, auth exempt allowlist |

## Architecture & Data Flow

```
Client Browser/App
    │
    ▼
┌─────────────────────────────────────────┐
│  API Layer (FastAPI)                    │
│  ├─ AuthMiddleware - JWT validation     │
│  ├─ CsrfProtectMiddleware - CSRF token  │
│  └─ Rate limiting (shared/rate_limiter) │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Business Logic                       │
│  ├─ OMS - Pre-trade checks, kill switch│
│  ├─ Alerts - Expression sandbox         │
│  ├─ Screener - AST-based formula eval   │
│  └─ Strategy - Code execution sandbox   │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  External Providers                     │
│  ├─ Alpaca (market data, trading)       │
│  ├─ Yahoo Finance (historical data)     │
│  └─ FMP / other providers               │
│  Circuit breaker pattern on all calls   │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Data Storage                          │
│  ├─ PostgreSQL (primary)               │
│  ├─ Redis (L2 cache, optional)         │
│  └─ SQLite (L3 cache fallback)         │
└─────────────────────────────────────────┘
```

### Authentication / Authorization Model

1. **Authentication**: JWT (HS256) with short-lived access tokens (15 min default) and refresh tokens (1 day default).
2. **Authorization**: Role-based access with three tiers:
   - `Viewer` (rank 1): Read-only access
   - `Trader` (rank 2): Trading and order management
   - `Admin` (rank 3): Full system access
3. **Dev Bypass**: Development environments with `OPENTERMINALUI_ENV` set to dev values and `E2E_DEV_AUTH=1` allow a persisted `dev-user`. This is **strictly disabled** in production.
4. **Auth Exempt Paths**: Explicit allowlist of public endpoints (`/health`, `/docs`, auth routes). No blanket prefix exemptions.

### Rate Limiting

- Implemented via `shared/rate_limiter.py` using exponential backoff with jitter.
- Applied to external API calls (Alpaca, Yahoo, FMP) to prevent throttling.
- Rate limit scheduler resets on success; intervals double on rate-limit response up to a configurable maximum.

### API Key Management

- API keys (Alpaca, FMP, etc.) are stored exclusively in environment variables.
- No hardcoded secrets in source code.
- Development ephemeral secrets are automatically generated and cannot leak to production.
- Redis cache values are HMAC-sha256 signed before serialization.

## Known Mitigations

### Code Execution Sandboxing

- **Alert Expressions**: Custom alert expressions use a restricted `eval()` with only whitelisted field names and comparison operators. No function calls or attribute access.
- **Strategy Runner**: Code execution is sandboxed with timeout, dunder attribute traversal blocked, and `__globals__` / `__class__` access denied.
- **Formula Engine**: AST-based validation before evaluation. Only arithmetic operations and allowed fields are permitted. No `import`, `eval()`, or `exec()` calls.

### CSRF Protection

- Double-submit cookie pattern for all state-changing endpoints.
- Exempt paths explicitly listed (health, docs, auth routes, WebSocket endpoints).
- Tokens use `secrets.compare_digest()` for constant-time comparison.
- Token rotation on every response.

### Cache Security

- HMAC-verified pickle blobs prevent deserialization of tampered data.
- Redis is optional; graceful fallback to in-memory + SQLite.
- Cache key signing prevents cache poisoning attacks.

### OMS Safety Controls

- Kill switch prevents all order submission.
- Restricted symbol list blocks trading on compliance-blocked securities.
- Position notional limits (default: 5M) prevent oversized orders.
- ADV participation limits (default: 10%) prevent market impact.
- All orders and fills are audit-logged.

## Report a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please follow these steps:

1. **Do NOT** create a public GitHub issue.
2. Email **security@openterminalui.com** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. We will acknowledge receipt within 48 hours and provide a timeline for remediation.

### Responsible Disclosure

- Please allow at least 90 days for a fix before public disclosure.
- Include proof-of-concept attachments if helpful (videos, code).
- We will not take legal action against researchers following this process.

### Security Headers

- All API responses include standard security headers via FastAPI middleware configuration.
- HTTPS is enforced in production environments.
- `SameSite=strict` and `HttpOnly` on CSRF cookies.