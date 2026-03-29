# Vinted Browser Extension - Phase 1 Implementation Complete

## Overview

I've successfully implemented **Phase 1 (Backend Foundation)** of the Vinted browser extension architecture. The backend is now ready to support the Chrome extension for automating Vinted actions (publish, message, bump, scrape, follow) inside antidetect browser profiles.

## What Was Built

### 1. **Database Models** (2 new models)

#### VintedProfile Model (`app/models/vinted_profile.py`)
- Tracks each Vinted account linked to a user
- Stores enrollment tokens (authentication)
- Browser profile fingerprinting for isolation
- Encrypted settings (AES-128 Fernet)
- Multi-user support (one user can have multiple Vinted accounts)
- Status tracking (is_active, is_paused, last_sync_at)

#### VintedTask Model (`app/models/vinted_task.py`)
- Polymorphic task queue for 10+ action types
- Task types supported:
  - `publish_listing` - Publish new item
  - `send_message` - Send message to buyer
  - `bump_listing` / `refresh_listing` - Bump/refresh listing
  - `follow_user` / `unfollow_user` - Follow actions
  - `scrape_listing` - Extract listing data
  - `like_item` / `unlike_item` - Like item
  - `mark_as_sold` - Mark as sold
  - `delete_listing` / `update_listing` - Manage listings
- Status lifecycle: PENDING → ASSIGNED → EXECUTING → SUCCESS/FAILED/ABANDONED/TIMEOUT/REJECTED
- Automatic retry with exponential backoff (max 3 retries by default)
- HMAC-SHA256 signature for tamper-proofing

### 2. **API Endpoints** (6 endpoints)

All endpoints are at `/api/v1/vinted/`:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/profiles` | Enroll new Vinted account → returns `enrollment_token` |
| GET | `/profiles` | List user's linked Vinted accounts |
| GET | `/tasks` | Extension polls for PENDING tasks (10-30s poll interval) |
| POST | `/tasks/{id}/status` | Extension reports task result (success/failed/rejected) |
| POST | `/tasks` | Web dashboard enqueues new task |
| GET | `/tasks/{id}` | Check specific task status |

### 3. **Security Infrastructure**

#### HMAC-SHA256 Signatures (`app/services/vinted_service.py`)
```python
generate_task_signature(payload) → signature
verify_task_signature(payload, signature) → bool
```
- Every task is signed with HMAC-SHA256
- Extension verifies before executing (prevents tampering)
- Protects against replay attacks

#### Browser Fingerprinting
```python
calculate_browser_fingerprint(antidetect_profile_id, user_agent, browser_id)
validate_browser_fingerprint(stored, current, threshold=0.7)
```
- Each profile gets unique antidetect ID (from AdsPower/Multilogin)
- Detects if extension running in correct profile
- Pauses profile if fingerprint changes significantly

#### Fernet Encryption (AES-128)
```python
encrypt_settings(profile_settings_dict) → encrypted_str
decrypt_settings(encrypted_str) → profile_settings_dict
```
- Encrypts sensitive profile config at rest
- Keys stored in env: `VINTED_PROFILE_ENCRYPTION_KEY`

#### Rate Limiting (`app/core/redis_client.py`)
- 100 tasks/hour per profile (configurable)
- Redis-backed (production) or in-memory graceful degradation (local dev)
- Prevents bot detection by Vinted

### 4. **Configuration** (`app/core/config.py`)

New environment variables:
```bash
VINTED_TASK_SECRET=your-secret-key          # For HMAC signing
VINTED_PROFILE_ENCRYPTION_KEY=your-key      # For Fernet (32 chars base64)
VINTED_RATE_LIMIT=100/hour                  # Tasks per profile per hour
VINTED_TASK_TIMEOUT_DEFAULT=60              # Task execution timeout (seconds)
VINTED_TASK_POLL_INTERVAL_MIN=10            # Min poll interval (seconds)
VINTED_TASK_POLL_INTERVAL_MAX=30            # Max poll interval (seconds)
```

### 5. **Data Validation** (Pydantic Schemas)

Created `app/schemas/vinted_schema.py` with:
- Enrollment requests/responses
- Task polling responses
- Task result reporting schema
- Task enqueueing schema
- Polymorphic task payloads:
  - PublishListingPayload (title, price, photos, category, etc.)
  - SendMessagePayload (recipient_id, message_text)
  - BumpListingPayload (listing_id, bump_type)
  - ScrapeListingPayload (fields to extract)
  - And 6 more...

### 6. **Comprehensive Tests** (25+ tests)

File: `tests/test_vinted_api.py`

**Test coverage:**
- ✅ Enrollment (new profiles, duplicates, validation)
- ✅ Profile listing (empty, multiple profiles, access control)
- ✅ Task polling (invalid token, empty queue, task assignment)
- ✅ Task result reporting (success, failure with retry, max retries → abandon)
- ✅ Task enqueueing (ownership validation)
- ✅ HMAC signatures (generation, verification, tampering detection, order-independence)
- ✅ Authorization (wrong user can't access profile)

Run tests with:
```bash
cd scalency-backend
pytest tests/test_vinted_api.py -v
```

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Extension (Manifest V3, runs in antidetect browser profile) │
│                                                             │
│  Background Service Worker                                │
│    └─ Poll loop (10-30s): GET /tasks?enrollment_token=X   │
│    └─ Receive PENDING tasks                               │
│    └─ Route to content scripts                            │
│                                                             │
│  Content Scripts (on vinted.com/vinted.fr)                │
│    └─ Execute DOM actions (publish, message, bump, etc)   │
│    └─ Report result: POST /tasks/{id}/status              │
│                                                             │
│  Local Storage (isolated, no sync to Google)              │
│    └─ enrollment_token (secret, never shared)             │
│    └─ profile_id                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ HTTP/HTTPS
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ Scalency Backend (FastAPI + SQLAlchemy + PostgreSQL)       │
│                                                             │
│  Vinted API Router (/api/v1/vinted)                       │
│    └─ Profile enrollment & management                     │
│    └─ Task polling & assignment                           │
│    └─ Result reporting & retry logic                      │
│    └─ HMAC signature verification                         │
│    └─ Rate limiting                                       │
│                                                             │
│  Database Tables                                          │
│    └─ vinted_profiles (user → Vinted accounts)           │
│    └─ vinted_tasks (polymorphic task queue)              │
│                                                             │
│  Services                                                 │
│    └─ vinted_service (HMAC, encryption, fingerprinting)  │
│    └─ redis_client (rate limiting)                       │
└─────────────────────────────────────────────────────────────┘
```

## File Structure Created

```
scalency-backend/
├── app/
│   ├── api/
│   │   ├── vinted.py                 # NEW: 6 API endpoints
│   ├── models/
│   │   ├── vinted_profile.py         # NEW: Profile model
│   │   ├── vinted_task.py            # NEW: Task model
│   │   └── __init__.py               # MODIFIED: Added imports
│   ├── services/
│   │   └── vinted_service.py         # NEW: HMAC, crypto, utilities
│   ├── schemas/
│   │   └── vinted_schema.py          # NEW: Pydantic models
│   ├── core/
│   │   ├── config.py                 # MODIFIED: Added Vinted config
│   │   ├── database.py               # MODIFIED: Import models
│   │   └── redis_client.py           # NEW: Rate limiting
│   └── main.py                       # MODIFIED: Include vinted router
└── tests/
    ├── test_vinted_api.py            # NEW: 25+ comprehensive tests
    └── __init__.py                   # NEW: Package file
```

## Key Design Decisions

### 1. **Enrollment Token vs Profile ID**
- Using opaque, long-lived **enrollment tokens** as API keys
- More secure than exposing profile IDs directly
- Tokens stored in extension's isolated `chrome.storage.local`
- Can be revoked by backend if compromised

### 2. **Polling vs WebSocket**
- Using **REST polling** (10-30 seconds with jitter)
- Simpler, no persistent connections needed
- Exponential backoff when tasks empty (reduces load)
- Lower resource usage on extension side

### 3. **Task Status Lifecycle**
- Tasks flow: PENDING → ASSIGNED → (EXECUTING) → SUCCESS/FAILED/ABANDONED
- Failed tasks auto-retry up to max_retries (default 3)
- Exponential backoff between retries (5s, 10s, 20s)
- Abandoned tasks after max retries exceed or extension disconnects

### 4. **Security Layers**
- **Authentication**: Enrollment token
- **Authorization**: User ownership of profile
- **Integrity**: HMAC-SHA256 signatures
- **Encryption**: Fernet for profile settings at rest
- **Isolation**: Browser fingerprinting prevents profile hijacking
- **Rate Limiting**: 100 tasks/hour per profile

### 5. **Local vs Remote Settings**
- Profile settings encrypted in database (not extension)
- Extension fetches decrypted settings on-demand
- Update feature for remote settings management later
- Profile can be paused/resumed by backend

## Local Development Setup

### 1. Environment Variables
Add to `.env` file:
```bash
# AI (existing)
OPENROUTER_API_KEY=sk-or-v1-...
CLAUDE_API_KEY=sk-ant-...

# Vinted Integration (new)
VINTED_TASK_SECRET=your-super-secret-key-here-minimum-32-chars
VINTED_PROFILE_ENCRYPTION_KEY=KeepPlainTextPrivateForFernetUseBase64EncodedKeyOnly==
```

### 2. Install Dependencies
```bash
cd scalency-backend
pip install cryptography python-multipart pytest
```

### 3. Run Application
```bash
python -m uvicorn app.main:app --reload
```

### 4. Run Tests
```bash
pytest tests/test_vinted_api.py -v --tb=short
```

### 5. View API Documentation
Open browser to: `http://localhost:8000/docs` (Swagger UI)

## Testing the API Manually

### 1. Create User
```bash
curl -X POST "http://localhost:8000/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

### 2. Enroll Vinted Account
```bash
curl -X POST "http://localhost:8000/api/v1/vinted/profiles?user_id=<USER_ID>" \
  -H "Content-Type: application/json" \
  -d '{"vinted_account_id":"my_vinted_username","antidetect_profile_id":"adspowerid_123"}'
```

Response includes `enrollment_token` → save this for polling

### 3. Poll for Tasks (as extension would)
```bash
curl "http://localhost:8000/api/v1/vinted/tasks?enrollment_token=<TOKEN>&limit=5"
```

### 4. Enqueue Task (from web dashboard)
```bash
curl -X POST "http://localhost:8000/api/v1/vinted/tasks?user_id=<USER_ID>" \
  -H "Content-Type: application/json" \
  -d '{
    "vinted_profile_id":"<PROFILE_ID>",
    "task_type":"publish_listing",
    "payload":{"title":"Nike Shoes","price":50.0,"category":"shoes"},
    "max_retries":3,
    "timeout_seconds":60
  }'
```

### 5. Report Task Result
```bash
curl -X POST "http://localhost:8000/api/v1/vinted/tasks/<TASK_ID>/status?enrollment_token=<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "status":"success",
    "result":{"listing_created":true,"listing_id":"vinted_999"},
    "execution_time_ms":5000
  }'
```

## Next Steps: Phase 2 (Extension Skeleton)

Ready to build the Chrome extension. Next will implement:

1. **Manifest V3 configuration** with proper permissions and host access
2. **Background service worker** with polling loop (jitter + exponential backoff)
3. **Enrollment popup UI** to link Vinted account
4. **Status dashboard** in extension popup
5. **Message passing system** between background worker and content scripts

Would you like me to proceed with Phase 2, or would you prefer to test/review the backend implementation first?

## Summary Statistics

- **Lines of code**: ~2,000 (backend + tests)
- **Models created**: 2 (VintedProfile, VintedTask)
- **API endpoints**: 6
- **Tests written**: 25+
- **Security measures**: 5 (HMAC, encryption, fingerprinting, tokens, rate limiting)
- **Configuration options**: 6 new env vars
- **Supported task types**: 10+
- **Status codes**: Proper HTTP semantics (201 Created, 202 Accepted, 401/403 auth, 404/409 conflicts)
