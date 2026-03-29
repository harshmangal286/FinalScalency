# Scalency Vinted Extension - Complete Setup & Test Guide

## ✅ Services Running

### Backend (FastAPI)
- **URL**: http://localhost:8000
- **Status**: ✓ Running on port 8000
- **Health Check**: `curl http://localhost:8000/health`
- **API Docs**: http://localhost:8000/docs

### Frontend (React Vite)
- **URL**: http://localhost:5173
- **Status**: ✓ Running on port 5173
- **Purpose**: Dashboard for creating tasks

### Extension
- **Location**: `/vinted-extension`
- **Type**: Manifest V3 Chrome Extension
- **Status**: Ready to load into Chrome

---

## 📋 Step 1: Load Extension into Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the folder: `c:\Users\Dell\OneDrive\Desktop\Scalency2\vinted-extension`
5. The extension should appear in the list with ID and status "Errors" if any

### Check Extension Logs
- Right-click extension → **Inspect views** → Click "service_worker" (background.js)
- Or: Open `chrome://extensions/` → Click "Details" on extension → "Inspect views"

---

## 🧪 Step 2: Enroll a Vinted Profile

The extension needs a profile enrolled in the backend before it can execute tasks.

### Option A: Via Browser DevTools Console
```javascript
// In browser console on localhost:5173:
fetch('http://localhost:8000/api/v1/vinted/enroll', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: 'test-user-123',
    vinted_username: 'testuser',
    vinted_account_id: 'vinted-acc-001'
  })
})
.then(r => r.json())
.then(d => {
  console.log('Enrollment response:', d);
  localStorage.setItem('enrollment_token', d.enrollment_token);
  localStorage.setItem('profile_id', d.profile_id);
});
```

### Option B: Via Extension Popup
- Click extension icon in Chrome
- Click "Enroll New Profile"
- Fill in Vinted username and account ID
- Submit and copy the enrollment token

### Result
- **enrollment_token**: Unique token for this profile
- **profile_id**: UUID of the profile
- Save these in extension's `chrome.storage.local`

---

## 🔄 Step 3: Create a Test Task

Tasks are created from the Dashboard and queued for the extension to execute.

### Create via API (Direct)
```bash
curl -X POST http://localhost:8000/api/v1/vinted/tasks/create \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "{YOUR_PROFILE_ID}",
    "task_type": "send_message",
    "payload": {
      "user_id": "some-vinted-user-id",
      "message": "Hello! Are you interested in this item?"
    }
  }'
```

### Supported Task Types (in content.js)
1. **send_message** - Send DM to a user
   - Payload: `{ user_id, message, catalog_id? }`
2. **publish_listing** - Publish a new item
   - Payload: `{ title, description, price, category, images[] }`
3. **bump_listing** - Bump/refresh a listing
   - Payload: `{ listing_id }`
4. **follow_user** - Follow a user
   - Payload: `{ user_id }`
5. **search_listings** - Search for items
   - Payload: `{ query, filters? }`
6. **scrape_data** - Scrape listing data
   - Payload: `{ url }`

---

## 🚀 Step 4: Start Extension Poll Loop

The extension's background worker continuously polls the backend for tasks every 10-30 seconds (with jitter).

### Monitor Polling
1. Open Chrome DevTools for the extension:
   - `chrome://extensions` → Find extension → Click **service_worker** link
2. You'll see logs like:
   ```
   [POLL] Fetching tasks for profile xxx...
   [POLL] Found 1 PENDING task
   [TASK ASSIGNED] Sending to content script...
   ```

### Extension Behavior
- Polls `GET /api/v1/vinted/tasks?profile_id={uuid}` every 15s
- Receives **first PENDING task** or empty queue (`poll_interval_ms`: 15000)
- Updates task status to **ASSIGNED** immediately
- Sends `EXECUTE_TASK` message to content script (on Vinted domain tab)
- Waits for content script to execute the task
- Reports result: `POST /api/v1/vinted/tasks/result` with status ✓/✗

---

## 💬 Step 5: Content Script DOM Automation

When the extension sends a task to the content script, it reads/executes DOM selectors on vinted.com.

### How It Works
1. Extension (background.js) detects a Vinted tab is open
2. Sends `{ type: 'EXECUTE_TASK', task }` via `chrome.tabs.sendMessage()`
3. **content.js** receives the message in the Vinted domain
4. Parses task type: `send_message`, `publish_listing`, etc.
5. Calls appropriate executor function
6. DOM selectors are executed:
   - Waits for elements with: `querySelector(selector)` + timeout
   - Simulates user interactions: typing, clicking, form submission
   - Reports success or error

### Monitoring Content Script
1. Open vinted.com in a tab
2. Right-click → **Inspect** → **Console**
3. You'll see logs like:
   ```
   [Content] Message listener triggered!
   [Content] EXECUTE_TASK received
   [Content] send_message: { user_id: 'xxx', message: 'Hello!' }
   [Content] Task success / error: Element not found
   ```

---

## 🔗 Complete Flow Diagram

```
Dashboard (localhost:5173)
    ↓
[Create Task: "Send Message to user123"]
    ↓
Backend API (localhost:8000)
    ↓ POST /api/v1/vinted/tasks/create
    ↓
[Task stored in DB: status=PENDING]
    ↓
Extension Background Worker (every 15s)
    ↓ GET /api/v1/vinted/tasks?profile_id=xyz
    ↓
[Receives task, updates status → ASSIGNED]
    ↓ chrome.tabs.sendMessage({ type: 'EXECUTE_TASK', task })
    ↓
Content Script (on vinted.com tab)
    ↓
[Executes task: navigates URL, waits for DOM, types message, clicks button]
    ↓
[Task completes: ✓ or ✗]
    ↓ chrome.runtime.sendMessage → background.js
    ↓
Background Worker
    ↓ POST /api/v1/vinted/tasks/result
    ↓
[Task status updated: SUCCESS / FAILED / TIMEOUT]
    ↓
Dashboard (refreshes, shows completed task)
```

---

## 🧪 Quick Test Checklist

- [ ] Backend running: `curl http://localhost:8000/health` → `{"status":"ok"}`
- [ ] Frontend running: `curl http://localhost:5173` → HTML page
- [ ] Extension loaded: `chrome://extensions/` → Extension listed
- [ ] Profile enrolled: Save enrollment_token to `chrome.storage.local`
- [ ] Task created: `POST /api/v1/vinted/tasks/create` → Task ID received
- [ ] Background worker polling: Check DevTools Service Worker console
- [ ] Content script listening: Open vinted.com tab, check console for registering message listener
- [ ] Task executed: See DOM selectors being executed in Vinted tab console

---

## 🐛 Troubleshooting

### Extension Not Communicating
- Check `chrome://extensions/` → extension details for errors
- Verify background.js has `enrollment_token` and `profile_id` in storage
- Check `GET /api/v1/vinted/tasks` endpoint is responding

### Content Script Not Executing
- Ensure you have vinted.com tab open
- Check manifest.json content_scripts matches vinted domain
- Right-click Vinted tab → Inspect → Console should show message listener registering

### Task Not Polling
- Check DevTools → Service Worker console for log messages
- Verify `enrollment_token` is stored correctly
- Check backend `GET /api/v1/vinted/tasks?profile_id=xxx` returns 200

### DOM Selectors Not Finding Elements
- Open Vinted tab console, manually inspect DOM
- Update selectors in content.js executor functions if Vinted UI changed
- Add logging to trace element search: `console.log('[Content] Looking for:', selector)`

---

## 📡 API Reference

### Enroll Profile
```
POST /api/v1/vinted/enroll
{
  "user_id": "uuid",
  "vinted_username": "string",
  "vinted_account_id": "string"
}

→ {
  "profile_id": "uuid",
  "enrollment_token": "string",
  "status": "active"
}
```

### Get Tasks (Extension Polls)
```
GET /api/v1/vinted/tasks?profile_id=uuid

→ {
  "task": {
    "id": "uuid",
    "task_type": "send_message",
    "payload": { ... },
    "status": "PENDING"
  },
  "poll_interval_ms": 15000
}
```

### Report Task Result
```
POST /api/v1/vinted/tasks/result
{
  "task_id": "uuid",
  "status": "SUCCESS",
  "result": "Message sent successfully",
  "error": null
}

→ { "status": "ok" }
```

---

## 🎯 Next Steps

1. Load extension into Chrome
2. Enroll a profile
3. Create a test task from dashboard
4. Watch extension poll, execute, and report
5. Verify task completion in dashboard

Good luck! 🚀
