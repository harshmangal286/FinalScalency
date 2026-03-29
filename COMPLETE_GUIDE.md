# 🚀 Scalency Vinted Extension - Complete Architecture & Interaction Guide

## ✅ System Status

All services are running and ready:

- **Backend**: http://localhost:8000 (FastAPI + SQLite)
- **Frontend**: http://localhost:5173 (React Dashboard)
- **Extension**: Ready to load into Chrome (Manifest V3)

---

## 📊 System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SCALENCY SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐       ┌──────────────────────────┐  │
│  │  Chrome Browser      │       │  User's Computer         │  │
│  │  ┌────────────────┐  │       │  ┌──────────────────┐    │  │
│  │  │  Vinted Tabs   │  │       │  │  Background Jobs │    │  │
│  │  │                │  │       │  │  (Celery/Redis) │    │  │
│  │  │  • vinted.com  │  │       │  │  (Optional)      │    │  │
│  │  │  • Messages    │  │       │  │                  │    │  │
│  │  │  • Listings    │  │       │  │ (Not needed yet) │    │  │
│  │  └────────────────┘  │       │  └──────────────────┘    │  │
│  │          ↑            │       │         ↑                │  │
│  │          │ Message    │       │         │ Task Result    │  │
│  │  ┌───────┴──────────┐ │       │         │ (Success/Fail) │  │
│  │  │ Content Script   │ │       │         │                │  │
│  │  │ (content.js)     │◄├───────┤─────────┤────────────┐   │  │
│  │  │                  │ │       │         │            │   │  │
│  │  │ • DOM Selectors  │ │       │         │            │   │  │
│  │  │ • User Typing    │ │       │         │            │   │  │
│  │  │ • Form Filling   │ │       │         │            │   │  │
│  │  │ • Clicking       │ │       │         │            │   │  │
│  │  └───────▲──────────┘ │       │         │            │   │  │
│  │          │ EXECUTE_   │       │         │            │   │  │
│  │          │ TASK msg   │       │         │            │   │  │
│  │  ┌───────┴──────────┐ │       │         │            │   │  │
│  │  │ Background       │ │       │         │            │   │  │
│  │  │ Service Worker   │ │       │         │            │   │  │
│  │  │ (background.js)  │ │       │         │            │   │  │
│  │  │                  │ │       │         │            │   │  │
│  │  │ Polls every 15s  │ │       │         │            │   │  │
│  │  │ Gets PENDING     │ │       │         │            │   │  │
│  │  │ task → sends to  │ │       │         │            │   │  │
│  │  │ content script   │ │       │         │            │   │  │
│  │  │ Reports result   │ │       │         │            │   │  │
│  │  └─────────┬────────┘ │       │         │            │   │  │
│  │            │          │       │         │            │   │  │
│  │   ▲────────┼──────────►───────┼─────────┼────────────┘   │  │
│  │   │        │          │       │         │                │  │
│  │   │ JSON   │          │       │         │                │  │
│  │   │ API    │          │       │         │                │  │
│  │   │ calls  │          │       │         │                │  │
│  │   │        │          │       │         │                │  │
│  └───┼────────┼──────────┼───────┼─────────┼────────────────┘  │
│      │        │          │       │         │                   │
│  HTTP│/FETCH  │          │       │         │  HTTP             │
│      │        │          │       │         │  API Calls        │
│      │        │          │       │         │                   │
└──────┼────────┼──────────┼───────┼─────────┼───────────────────┘
       │        │          │       │         │
       ▼        ▼          │       │         ▼
   ┌──────────────────────┐│       │ ┌───────────────────────┐
   │ React Dashboard      ││       │ │ FastAPI Backend       │
   │ localhost:5173       ││       │ │ localhost:8000        │
   │                      ││       │ │                       │
   │ • View tasks         ││       │ │ • Task Queue (DB)     │
   │ • Create tasks       ││       │ │ • Profile Management  │
   │ • Monitor status     ││       │ │ • Result Storage      │
   │ • Enroll profiles    ││       │ │                       │
   │                      ││       │ │ Endpoints:            │
   │ API Service Layer    ││       │ │ POST /enroll          │
   │ (fetch calls)        ││       │ │ GET  /tasks           │
   │                      ││       │ │ POST /tasks/create    │
   │                      ││       │ │ POST /tasks/result    │
   └──────────┬───────────┘│       │ └───────────┬──────────┘
              │            │       │             │
              │            │       │             │
              │            │       │             ▼
              │            │       │       ┌─────────────┐
              │            │       │       │ SQLite DB   │
              │            │       │       │ scalency.db │
              │            │       │       │             │
              └────────────┼───────┼───────│ • Profiles  │
                           │       │       │ • Tasks     │
                           │       │       │ • Users     │
                           │       │       │ • Listings  │
                           │       │       └─────────────┘
                           │       │
                           └───────┘
                        HTTP Requests
                        (FastAPI + CORS)
```

---

## 🔄 Complete Data Flow

### 1️⃣ **Profile Enrollment (One-time setup)**

```
Dashboard / Browser Console
        ↓
POST /api/v1/vinted/enroll
{
  "account_name": "my-vinted-account"
}
        ↓
Backend creates VintedProfile record
         ↓
Generates:
  • profile_id (UUID)
  • enrollment_token (unique token)
         ↓
Response sent to frontend:
{
  "profile_id": "abc-123...",
  "enrollment_token": "xyz-789...",
  "created_at": "2026-03-26T..."
}
         ↓
User stores credentials in extension
(chrome.storage.local)
```

### 2️⃣ **Task Creation (Dashboard → Backend)**

```
Dashboard (React)
    ▼
User clicks "Create Task"
    ▼
Select task type + fill payload
    ▼
Frontend calls API:
POST /api/v1/vinted/tasks/create
{
  "profile_id": "abc-123...",
  "task_type": "send_message",
  "payload": {
    "user_id": "some-user",
    "message": "Hello!"
  }
}
    ▼
Backend creates VintedTask record
  • status = PENDING
  • task_type = send_message
  • payload = JSON data
    ▼
Response:
{
  "task_id": "def-456..."
}
    ▼
Task stored in DB, waiting for execution
```

### 3️⃣ **Task Polling (Extension → Backend)**

```
Browser starts → Extension loads
    ↓
Every 15 seconds (with jitter):
    ↓
Background Worker polls:
GET /api/v1/vinted/tasks?enrollment_token=xyz-789
    ↓
Backend queries:
  SELECT * FROM vinted_tasks
  WHERE profile_id = ? AND status = PENDING
    ↓
If tasks found:
  1. Return FIRST task to extension
  2. Mark it as ASSIGNED (status change in DB)
  3. Set poll_interval = 15000 (keep polling)
    ↓
If no tasks:
  1. Return empty task list
  2. Set poll_interval = 30000 (back off)
    ↓
Extension receives response:
{
  "tasks": [
    {
      "task_id": "def-456...",
      "task_type": "send_message",
      "payload": { "user_id": "...", "message": "..." }
    }
  ],
  "poll_interval_ms": 15000
}
    ↓
Next poll scheduled for 15 seconds later
```

### 4️⃣ **Task Execution (Content Script on Vinted Tab)**

```
Extension receives task from polling
    ↓
Checks: Is there a Vinted tab open?
    ↓
YES → Sends message to content script:
chrome.tabs.sendMessage(vinted_tab_id, {
  type: 'EXECUTE_TASK',
  task: {
    taskType: 'send_message',
    payload: { user_id: '...', message: '...' }
  }
})
    ↓
Content script receives in vinted.com context
    ↓
Executes task:
  1. Navigate to URL if needed
  2. Wait for DOM elements (5s timeout)
  3. Find message input field
  4. Type message character by character (30ms delay)
  5. Find send button
  6. Click button
  7. Wait for success indicator
    ↓
Result:
  • SUCCESS: Message sent, task completed
  • FAILURE: Element not found, timeout, error thrown
    ↓
Content script sends result back to background worker:
chrome.runtime.sendMessage({
  type: 'TASK_RESULT',
  taskId: 'def-456...',
  status: 'SUCCESS' or 'FAILED',
  message: 'Message sent successfully'
})
```

### 5️⃣ **Result Reporting (Background Worker → Backend)**

```
Background worker receives result from content script
    ↓
Sends result to backend:
POST /api/v1/vinted/tasks/result
{
  "task_id": "def-456...",
  "enrollment_token": "xyz-789...",
  "status": "success",
  "result": { "message": "Message sent successfully" },
  "error_message": null
}
    ↓
Backend updates VintedTask record:
  • status = SUCCESS / FAILED
  • result = JSON data
  • updated_at = NOW
    ↓
Response: { "success": true }
    ↓
Task lifecycle complete:
  PENDING → ASSIGNED → SUCCESS
    ↓
Dashboard refreshes and shows:
  ✓ Task completed
```

---

## 💬 Supported Task Types

### **send_message**
Send a direct message to a Vinted user.

**Payload:**
```json
{
  "user_id": "vinted-user-id",
  "message": "Your message text",
  "catalog_id": "optional-listing-id"
}
```

**DOM Flow:**
1. Navigate to `/member/{user_id}`
2. Find message button
3. Type message
4. Submit form

---

### **publish_listing**
Publish a new item to Vinted for sale.

**Payload:**
```json
{
  "title": "Item title",
  "description": "Item description",
  "price": 49.99,
  "category": "shoes",
  "images": ["url1", "url2"]
}
```

**DOM Flow:**
1. Navigate to `/sell` (create listing page)
2. Fill title field
3. Fill description
4. Fill price field
5. Select category from dropdown
6. Upload images
7. Submit listing

---

### **bump_listing**
Refresh/bump an existing listing to the top.

**Payload:**
```json
{
  "listing_id": "vinted-listing-id"
}
```

**DOM Flow:**
1. Navigate to listing URL
2. Find bump button
3. Click bump button
4. Confirm action

---

### **follow_user**
Follow a Vinted user.

**Payload:**
```json
{
  "user_id": "vinted-user-id"
}
```

**DOM Flow:**
1. Navigate to user profile
2. Find follow button
3. Click follow button

---

### **scrape_data**
Extract data from a listing or profile.

**Payload:**
```json
{
  "url": "https://vinted.com/items/..."
}
```

**Returns:**
```json
{
  "data": {
    "title": "...",
    "price": 99.99,
    "seller": "...",
    "rating": 4.8
  }
}
```

---

### **search_listings**
Search for items on Vinted.

**Payload:**
```json
{
  "query": "nike shoes",
  "filters": {
    "max_price": 100,
    "condition": "like new"
  }
}
```

**Returns:**
```json
{
  "results": [
    { "id": "...", "title": "...", "price": "..." },
    { "id": "...", "title": "...", "price": "..." }
  ]
}
```

---

## 📡 API Endpoints Reference

### **Profile Enrollment**
```
POST /api/v1/vinted/enroll
Content-Type: application/json

{
  "account_name": "my-account"
}

Response:
{
  "profile_id": "uuid",
  "account_name": "my-account",
  "enrollment_token": "token-string",
  "created_at": "2026-03-26T..."
}
```

### **Poll Tasks**
```
GET /api/v1/vinted/tasks?enrollment_token={token}

Response:
{
  "tasks": [
    {
      "task_id": "uuid",
      "task_type": "send_message",
      "payload": { "user_id": "...", "message": "..." }
    }
  ]
}

If empty:
{
  "tasks": []
}
```

### **Create Task**
```
POST /api/v1/vinted/tasks/create
Content-Type: application/json

{
  "profile_id": "uuid",
  "task_type": "send_message",
  "payload": { ... }
}

Response:
{
  "task_id": "uuid"
}
```

### **Report Result**
```
POST /api/v1/vinted/tasks/result
Content-Type: application/json

{
  "task_id": "uuid",
  "enrollment_token": "token",
  "status": "success",
  "result": { "data": "..." },
  "error_message": null
}

Response:
{
  "success": true,
  "message": null
}
```

### **List Profiles**
```
GET /api/v1/vinted/profiles

Response:
[
  {
    "profile_id": "uuid",
    "account_name": "...",
    "created_at": "..."
  }
]
```

### **List Tasks for Profile**
```
GET /api/v1/vinted/tasks/list?profile_id={uuid}

Response:
[
  {
    "id": "uuid",
    "task_type": "send_message",
    "status": "SUCCESS",
    "created_at": "...",
    "updated_at": "..."
  }
]
```

---

## 🧪 Quick Test Scenarios

### **Scenario 1: Send a Message**

1. Create a task:
```bash
curl -X POST http://localhost:8000/api/v1/vinted/tasks/create \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "YOUR_PROFILE_ID",
    "task_type": "send_message",
    "payload": {
      "user_id": "target-user-id",
      "message": "Hi! Interested in this item?"
    }
  }'
```

2. Open vinted.com in a tab

3. Wait for extension to poll (15 seconds)

4. Watch content script execute:
   - Navigate to user profile
   - Open message dialog
   - Type message
   - Click send

5. Check backend for result status

---

### **Scenario 2: Publish a Listing**

1. Create task with `publish_listing` type

2. Extension navigates to `/sell` page

3. Content script fills form fields

4. Images uploaded (if provided)

5. Listing published

---

### **Scenario 3: Batch Processing**

1. Create multiple tasks from dashboard

2. Extension queues them in database

3. Polls and executes sequentially:
   - Poll → Get task 1
   - Execute task 1 → Report result
   - Poll → Get task 2
   - Execute task 2 → Report result
   - Continue...

4. Dashboard shows progress

---

## 🔍 Monitoring & Debugging

### **Extension Logs**

```
chrome://extensions/
→ Find extension
→ Click "Details"
→ Scroll down → "Inspect views"
→ Click "service_worker"
→ View console logs
```

**Look for patterns:**
```
[POLL] Starting poll...
[POLL] Fetched tasks for profile xxx
[POLL] Found 1 PENDING task
[TASK ASSIGNED] Sending to content script
[CONTENT:MSG] Received EXECUTE_TASK
[CONTENT:EXEC] Executing send_message
[CONTENT:SUCCESS] Message sent
[RESULT] Reporting success to backend
```

### **Content Script Logs**

```
1. Open vinted.com
2. Right-click → Inspect
3. Go to Console
4. Look for logs starting with [Content]
```

**Example:**
```
[Content] Message listener registered
[Content] EXECUTE_TASK received
[Content] send_message: { user_id: 'xxx', message: 'Hi' }
[Content] Navigating to /member/xxx
[Content] Waiting for message button...
[Content] Found message button
[Content] Task success!
```

### **Backend Logs**

```
http://localhost:8000

Watch terminal output:
[INFO] Polled 1 tasks for profile abc-123
[INFO] Task abc-456 marked as ASSIGNED
[INFO] Updated task status: SUCCESS
```

### **Database**

```
Query recent tasks:
sqlite3 scalency-backend/scalency.db

SELECT id, task_type, status, created_at FROM vinted_task
ORDER BY created_at DESC LIMIT 10;
```

---

## ⚙️ Configuration

**Extension Configuration** (`vinted-extension/config.js`):
```javascript
API_BASE_URL: 'http://localhost:8000'
POLLING_INTERVAL: 15000 (ms)
TASK_TIMEOUT: 60000 (ms)
```

**Backend Configuration** (`scalency-backend/.env`):
```
DATABASE_URL=sqlite:///./scalency.db
OPENROUTER_API_KEY=...
```

**Frontend Configuration** (`scalency-frontend/.env`):
```
VITE_API_URL=http://localhost:8000
```

---

## 🚨 Troubleshooting

### **Extension Not Polling**
- Check DevTools Service Worker console
- Verify `enrollment_token` in `chrome.storage.local`
- Check backend is responding: `curl http://localhost:8000/health`

### **Content Script Not Executing**
- Ensure vinted.com tab is open
- Check `manifest.json` content_scripts patterns
- Verify content.js is loaded (check console on vinted.com)

### **Tasks Not Getting Picked Up**
- Check task status in database: should be `PENDING`
- Verify `profile_id` matches in extension storage
- Check `enrollment_token` is correct

### **DOM Selectors Not Working**
- Open vinted.com DevTools
- Check if DOM elements exist at expected selectors
- Vinted UI may have changed → update selectors in content.js
- Add logging to trace: `console.log('[Content] Looking for:', selector)`

---

## 📚 Architecture Summary

| Component | Tech Stack | Purpose |
|-----------|-----------|---------|
| **Backend API** | FastAPI, SQLite, Python | Task queue, profile mgmt, result storage |
| **Frontend Dashboard** | React, Vite, JavaScript | UI for creating tasks, monitoring status |
| **Extension (Background)** | Manifest V3, JavaScript | Polls backend, sends tasks to content script |
| **Extension (Content)** | Manifest V3, JavaScript | DOM automation on vinted.com |
| **Database** | SQLite | Persistent storage for profiles, tasks |

---

## 🎯 Next Steps

1. ✅ Load extension into Chrome
2. ✅ Enroll a profile
3. ✅ Create test tasks from dashboard
4. ✅ Monitor extension polling and execution
5. 🚀 Scale to production deployment

---

**Created**: 2026-03-26
**Service Status**: ✓ All running
**Extension Status**: ✓ Ready to load

