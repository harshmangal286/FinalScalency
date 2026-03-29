# ⚡ Scalency Vinted Extension - Quick Reference Card

## 📍 Right Now - SERVICES STATUS

```
✅ Backend:   http://localhost:8000
✅ Frontend:  http://localhost:5173
✅ Extension: Ready (in c:\Users\Dell\OneDrive\Desktop\Scalency2\vinted-extension)
```

---

## 🎯 IMMEDIATE NEXT STEPS (5 minutes)

### 1️⃣ Load Extension
```
1. Open Chrome
2. Go to chrome://extensions
3. Turn ON "Developer mode" (top right)
4. Click "Load unpacked"
5. Select: c:\Users\Dell\OneDrive\Desktop\Scalency2\vinted-extension
6. ✓ Extension loaded!
```

### 2️⃣ Verify Identity
```
Profile ID: 6f048dac-181f-49c6-9e6b-aa538c8d5a86
Token:      8845c8ab-5aeb-47a2-b2d5-2eb6cace4ed5
```

### 3️⃣ Check DevTools
```
chrome://extensions
  → Find "Scalency Vinted Agent"
  → Click "Details"
  → Scroll down
  → Click "Inspect views"
  → See Service Worker console
```

---

## 🔧 QUICK TEST (10 minutes)

### Create a Task
```bash
curl -X POST http://localhost:8000/api/v1/vinted/tasks/create \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "6f048dac-181f-49c6-9e6b-aa538c8d5a86",
    "task_type": "send_message",
    "payload": {
      "user_id": "test-user-123",
      "message": "Hello from Scalency!"
    }
  }'
```

### Watch Execution
```
1. Open vinted.com (new tab)
2. Go back to extension DevTools
3. Look for logs containing [POLL], [TASK]
4. Check vinted.com tab console for [Content] logs
5. See task execute in real-time!
```

---

## 📊 THREE KEY FLOWS

### Flow 1: Task Creation (Dashboard → Backend)
```
Dashboard
   ↓
Click "Create Task"
   ↓
Select task type + payload
   ↓
POST /api/v1/vinted/tasks/create
   ↓
Task stored in DB (status: PENDING)
   ↓
Dashboard shows pending task
```

### Flow 2: Task Polling (Extension → Backend)
```
Extension (every 15 seconds)
   ↓
GET /api/v1/vinted/tasks?enrollment_token=xxx
   ↓
Backend returns PENDING tasks
   ↓
Extension marks task as ASSIGNED
   ↓
Waits 15 seconds, polls again
```

### Flow 3: Task Execution (Background → Content → DOM)
```
Extension gets task
   ↓
Sends chrome.tabs.sendMessage()
   ↓
Content script receives on vinted.com
   ↓
Executes DOM automation:
  • Navigate
  • Wait for elements
  • Type/Click/Fill
  • Submit
   ↓
Reports result to background
   ↓
Background sends POST /tasks/result
   ↓
Task status updated: SUCCESS/FAILED
```

---

## 🎮 TESTING COMMANDS

### Test 1: Health Check
```bash
curl http://localhost:8000/health
# Expected: {"status":"ok","version":"1.0.0","database":"ok"}
```

### Test 2: List Profiles
```bash
curl http://localhost:8000/api/v1/vinted/profiles
# Expected: Profile list with IDs
```

### Test 3: Create Task
```bash
curl -X POST http://localhost:8000/api/v1/vinted/tasks/create \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "6f048dac-181f-49c6-9e6b-aa538c8d5a86",
    "task_type": "send_message",
    "payload": {"user_id": "user123", "message": "test"}
  }'
# Expected: {"task_id":"..."}
```

### Test 4: View Task Queue
```bash
curl http://localhost:8000/api/v1/vinted/tasks/list?profile_id=6f048dac-181f-49c6-9e6b-aa538c8d5a86
# Expected: Task list with statuses
```

---

## 🔍 DEBUGGING CHECKLIST

**Extension Not Polling?**
- [ ] DevTools → Service Worker → Check console
- [ ] Verify enrollment_token in chrome.storage.local
- [ ] Check backend health: `curl http://localhost:8000/health`

**Content Script Not Running?**
- [ ] Vinted.com tab open?
- [ ] Right-click vinted.com → Inspect → Console
- [ ] Look for "[Content]" logs
- [ ] Check manifest patterns match vinted domain

**Task Stuck as PENDING?**
- [ ] Check task in DB: `sqlite3 scalency-backend/scalency.db`
- [ ] Verify profile_id matches
- [ ] Check enrollment_token is correct

---

## 📋 WHAT EACH FILE DOES

| File | Purpose |
|------|---------|
| `background.js` | Polls backend every 15s, sends tasks to content script |
| `content.js` | Runs on vinted.com, automates DOM clicks/typing |
| `manifest.json` | Configuration for Manifest V3 |
| `popup.html/js` | Quick UI for extension popup |
| `vinted.py` | Backend API endpoints |
| `vinted_profile.py` | Database model for profiles |
| `vinted_task.py` | Database model for tasks |

---

## 🚀 TASK TYPES (Copy-Paste Examples)

### send_message
```json
{
  "profile_id": "6f048dac-181f-49c6-9e6b-aa538c8d5a86",
  "task_type": "send_message",
  "payload": {
    "user_id": "vinted-user-id",
    "message": "Hi! Are you selling this?"
  }
}
```

### publish_listing
```json
{
  "profile_id": "6f048dac-181f-49c6-9e6b-aa538c8d5a86",
  "task_type": "publish_listing",
  "payload": {
    "title": "Nike Shoes Size 10",
    "description": "Barely worn, perfect condition",
    "price": 49.99,
    "category": "shoes",
    "images": ["url1", "url2"]
  }
}
```

### bump_listing
```json
{
  "profile_id": "6f048dac-181f-49c6-9e6b-aa538c8d5a86",
  "task_type": "bump_listing",
  "payload": {
    "listing_id": "vinted-listing-id"
  }
}
```

### follow_user
```json
{
  "profile_id": "6f048dac-181f-49c6-9e6b-aa538c8d5a86",
  "task_type": "follow_user",
  "payload": {
    "user_id": "vinted-user-id"
  }
}
```

---

## 💾 USEFUL DATABASE QUERIES

### View all tasks
```sql
sqlite3 scalency-backend/scalency.db \
  "SELECT id, task_type, status, created_at FROM vinted_task ORDER BY created_at DESC;"
```

### View specific profile
```sql
sqlite3 scalency-backend/scalency.db \
  "SELECT id, account_name, created_at FROM vinted_profile WHERE id = '6f048dac-181f-49c6-9e6b-aa538c8d5a86';"
```

### Count pending tasks
```sql
sqlite3 scalency-backend/scalency.db \
  "SELECT COUNT(*) FROM vinted_task WHERE status = 'PENDING';"
```

### Delete test data
```sql
sqlite3 scalency-backend/scalency.db \
  "DELETE FROM vinted_task WHERE created_at < datetime('now', '-1 day');"
```

---

## 🎯 SUCCESS INDICATORS

### ✅ Backend Working
```
curl http://localhost:8000/health
→ {"status":"ok"} ✓
```

### ✅ Extension Loaded
```
chrome://extensions
→ "Scalency Vinted Agent" in list ✓
```

### ✅ Task Created
```
POST /api/v1/vinted/tasks/create
→ {"task_id": "uuid"} ✓
```

### ✅ Extension Polling
```
DevTools → Service Worker console
→ [POLL] logs appearing every ~15s ✓
```

### ✅ Task Executing
```
vinted.com DevTools console
→ [Content] logs showing execution ✓
```

### ✅ Result Reported
```
Backend logs
→ "Updated task status: SUCCESS" ✓
```

---

## ⏱️ TIMING

| Event | Duration |
|-------|----------|
| Load extension | < 1s |
| Create task | < 1s |
| Poll interval | ~15s (with random jitter ±2s) |
| Task execution | 3-10s (depends on task type) |
| Result reporting | < 1s |
| **Total end-to-end** | **~20-30 seconds** |

---

## 🔗 IMPORTANT URLS

| Service | URL |
|---------|-----|
| Backend | http://localhost:8000 |
| Frontend | http://localhost:5173 |
| API Docs | http://localhost:8000/docs |
| Extension | chrome://extensions |

---

## 💡 PRO TIPS

1. **Keep two browser windows open:**
   - Window 1: DevTools for extension
   - Window 2: vinted.com for execution

2. **Monitor three consoles simultaneously:**
   - Extension Service Worker console
   - vinted.com content script console
   - Backend terminal output

3. **Test with a single task first:**
   - Create one task
   - Watch it execute
   - Verify completion
   - Then batch test

4. **Check database between tests:**
   - `sqlite3 scalency-backend/scalency.db "SELECT * FROM vinted_task ORDER BY created_at DESC LIMIT 1;"`

5. **Use dashboard for monitoring:**
   - http://localhost:5173 → ⚡ Vinted Tasks
   - Real-time task queue display

---

## 🎓 LEARN MORE

- **Manifest V3**: https://developer.chrome.com/docs/extensions/mv3/
- **Chrome Messaging**: https://developer.chrome.com/docs/extensions/mv3/messaging/
- **FastAPI**: https://fastapi.tiangolo.com/docs

---

## 📞 QUICK HELP

**Q: Extension not in chrome://extensions?**
A: Did you select the vinted-extension folder? Not the parent Scalency2 folder?

**Q: Content script console is empty?**
A: Ensure vinted.com tab is open AND you inspect that tab's console.

**Q: Task stays PENDING forever?**
A: Check Service Worker console - is it stopping? Is enrollment_token valid?

**Q: "404 Not found" errors?**
A: Check backend is running: `curl http://localhost:8000/health`

---

## 🚀 YOU'RE ALL SET!

Everything is running and ready.

**Next action:** Load the extension and watch it work!

Monitor both the extension console and vinted.com tab as it executes tasks in real-time.

Questions? Check COMPLETE_GUIDE.md for detailed architecture explanation.

