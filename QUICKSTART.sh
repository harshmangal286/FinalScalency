#!/bin/bash
# Scalency Vinted Extension - Quick Start Setup

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BOLD}${BLUE}🚀 Scalency Vinted Extension - Quick Start${NC}${NC}"
echo

# Step 1: Check services
echo -e "${BOLD}Step 1: Checking services...${NC}"
BACKEND_OK=$(curl -s http://localhost:8000/health | grep -q "ok" && echo "yes" || echo "no")
FRONTEND_OK=$(curl -s http://localhost:5173 | grep -q "root" && echo "yes" || echo "no")

if [ "$BACKEND_OK" = "yes" ]; then
  echo -e "${GREEN}✓ Backend running on http://localhost:8000${NC}"
else
  echo -e "${BOLD}Backend not running. Starting...${NC}"
  cd c:/Users/Dell/OneDrive/Desktop/Scalency2/scalency-backend
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /dev/null 2>&1 &
  sleep 3
  echo -e "${GREEN}✓ Backend started${NC}"
fi

if [ "$FRONTEND_OK" = "yes" ]; then
  echo -e "${GREEN}✓ Frontend running on http://localhost:5173${NC}"
else
  echo -e "${BOLD}Frontend not running. Starting...${NC}"
  cd c:/Users/Dell/OneDrive/Desktop/Scalency2/scalency-frontend
  npm run dev > /dev/null 2>&1 &
  sleep 3
  echo -e "${GREEN}✓ Frontend started${NC}"
fi

echo

# Step 2: Create test profile
echo -e "${BOLD}Step 2: Creating test Vinted profile...${NC}"
PROFILE_JSON=$(curl -s -X POST http://localhost:8000/api/v1/vinted/enroll \
  -H "Content-Type: application/json" \
  -d '{
    "account_name": "test_profile_'$(date +%s)'"
  }')

PROFILE_ID=$(echo "$PROFILE_JSON" | grep -o '"profile_id":"[^"]*"' | cut -d'"' -f4)
ENROLLMENT_TOKEN=$(echo "$PROFILE_JSON" | grep -o '"enrollment_token":"[^"]*"' | cut -d'"' -f4)

echo -e "${GREEN}✓ Profile created${NC}"
echo "  Profile ID: $PROFILE_ID"
echo "  Token: ${ENROLLMENT_TOKEN:0:30}..."
echo

# Step 3: Instructions
echo -e "${BOLD}Step 3: Load Extension into Chrome${NC}"
echo -e "1. Open ${BLUE}chrome://extensions${NC}"
echo -e "2. Enable ${BOLD}Developer mode${NC} (toggle in top-right)"
echo -e "3. Click ${BOLD}Load unpacked${NC}"
echo -e "4. Navigate to: ${BLUE}c:\\Users\\Dell\\OneDrive\\Desktop\\Scalency2\\vinted-extension${NC}"
echo -e "5. The extension will appear in the list"
echo

# Step 4: Access dashboard
echo -e "${BOLD}Step 4: Open Dashboard${NC}"
echo -e "Go to: ${BLUE}http://localhost:5173${NC}"
echo -e "Click: ${BOLD}⚡ Vinted Tasks${NC} tab to create tasks"
echo

# Step 5: Enroll extension
echo -e "${BOLD}Step 5: Enroll Extension Profile${NC}"
echo "1. Click the extension icon in Chrome"
echo "2. Enter profile credentials:"
echo "   - Username: test_profile"
echo "   - Account ID: Any ID"
echo "3. Or use the test profile created above:"
echo -e "   ${BLUE}Profile ID: $PROFILE_ID${NC}"
echo -e "   ${BLUE}Token: $ENROLLMENT_TOKEN${NC}"
echo

# Step 6: Create a test task
echo -e "${BOLD}Step 6: Create Test Task${NC}"
TASK_JSON=$(curl -s -X POST http://localhost:8000/api/v1/vinted/tasks/create \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "'$PROFILE_ID'",
    "task_type": "send_message",
    "payload": {
      "user_id": "test_user_123",
      "message": "Hello! This is a test message from Scalency."
    }
  }')

TASK_ID=$(echo "$TASK_JSON" | grep -o '"task_id":"[^"]*"' | cut -d'"' -f4)
echo -e "${GREEN}✓ Test task created${NC}"
echo "  Task ID: $TASK_ID"
echo "  Type: send_message"
echo "  Status: PENDING"
echo

# Step 7: Monitor
echo -e "${BOLD}Step 7: Monitor Execution${NC}"
echo "1. Extension polls backend every 10-30 seconds"
echo "2. Check DevTools Service Worker for polling logs:"
echo -e "   - Right-click extension → ${BOLD}Inspect views${NC}"
echo "   - Look for logs starting with [POLL]"
echo "3. Open vinted.com in a tab and check console for DOM automation"
echo

# Summary
echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}✓ Setup Complete!${NC}"
echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo
echo "📋 Quick Links:"
echo -e "  ${BLUE}Backend API:${NC}      http://localhost:8000"
echo -e "  ${BLUE}API Docs:${NC}         http://localhost:8000/docs"
echo -e "  ${BLUE}Dashboard:${NC}        http://localhost:5173"
echo -e "  ${BLUE}Extension Path:${NC}   c:\\Users\\Dell\\OneDrive\\Desktop\\Scalency2\\vinted-extension"
echo
echo "🔑 Profile Credentials:"
echo -e "  ${BLUE}Profile ID:${NC}       $PROFILE_ID"
echo -e "  ${BLUE}Enrollment Token:${NC} $ENROLLMENT_TOKEN"
echo
echo "📝 Next Steps:"
echo "1. Load extension into Chrome (instructions above)"
echo "2. Enroll the extension with the profile credentials"
echo "3. Open http://localhost:5173 and create tasks"
echo "4. Extension will automatically poll and execute them"
echo "5. Check DevTools console to monitor execution"
echo
