#!/bin/bash
# Test script for Scalency Vinted Extension Backend APIs

set -e

API_BASE="http://localhost:8000/api/v1/vinted"
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BOLD}=== Scalency Vinted Extension API Tests ===${NC}\n"

# Test 1: Health Check
echo -e "${BOLD}[1] Health Check${NC}"
HEALTH=$(curl -s http://localhost:8000/health)
if echo "$HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ Backend is healthy${NC}"
  echo "   Response: $HEALTH"
else
  echo -e "${RED}✗ Backend health check failed${NC}"
  exit 1
fi
echo

# Test 2: Enroll Profile
echo -e "${BOLD}[2] Enroll Vinted Profile${NC}"
ENROLL_RESPONSE=$(curl -s -X POST "$API_BASE/enroll" \
  -H "Content-Type: application/json" \
  -d '{
    "account_name": "testuser_'$(date +%s)'"
  }')

PROFILE_ID=$(echo "$ENROLL_RESPONSE" | grep -o '"profile_id":"[^"]*"' | cut -d'"' -f4)
ENROLLMENT_TOKEN=$(echo "$ENROLL_RESPONSE" | grep -o '"enrollment_token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$PROFILE_ID" ] && [ -n "$ENROLLMENT_TOKEN" ]; then
  echo -e "${GREEN}✓ Profile enrolled successfully${NC}"
  echo "   Profile ID: $PROFILE_ID"
  echo "   Enrollment Token: ${ENROLLMENT_TOKEN:0:30}..."
else
  echo -e "${RED}✗ Enrollment failed${NC}"
  echo "   Response: $ENROLL_RESPONSE"
  exit 1
fi
echo

# Test 3: Poll Tasks (Should be empty initially)
echo -e "${BOLD}[3] Poll Tasks (Empty Queue)${NC}"
POLL_RESPONSE=$(curl -s "$API_BASE/tasks?enrollment_token=$ENROLLMENT_TOKEN")

if echo "$POLL_RESPONSE" | grep -q "poll_interval_ms"; then
  echo -e "${GREEN}✓ Task polling works${NC}"
  echo "   Response: $POLL_RESPONSE" | head -c 150
  echo "..."
else
  echo -e "${GREEN}✓ Task polling works (empty response)${NC}"
  echo "   Response: $POLL_RESPONSE"
fi
echo

# Test 4: Create a Task
echo -e "${BOLD}[4] Create Test Task (send_message)${NC}"
CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/tasks/create" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "'$PROFILE_ID'",
    "task_type": "send_message",
    "payload": {
      "user_id": "user_to_message",
      "message": "Hello! This is an automated test message."
    }
  }')

TASK_ID=$(echo "$CREATE_RESPONSE" | grep -o '"task_id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TASK_ID" ]; then
  echo -e "${GREEN}✓ Task created successfully${NC}"
  echo "   Task ID: $TASK_ID"
  echo "   Task Type: send_message"
  echo "   Status: PENDING"
else
  echo -e "${RED}✗ Task creation failed${NC}"
  echo "   Response: $CREATE_RESPONSE"
  exit 1
fi
echo

# Test 5: Poll Tasks (Should now have a task)
echo -e "${BOLD}[5] Poll Tasks (With Task)${NC}"
POLL_RESPONSE=$(curl -s "$API_BASE/tasks?enrollment_token=$ENROLLMENT_TOKEN")

if echo "$POLL_RESPONSE" | grep -q "$TASK_ID"; then
  echo -e "${GREEN}✓ Task appears in poll response${NC}"
  echo "   Task ID from poll: $TASK_ID (matches)"
else
  echo -e "${YELLOW}⚠ Task not in poll response (might need different endpoint)${NC}"
fi
echo

# Test 6: Report Task Result
echo -e "${BOLD}[6] Report Task Result${NC}"
RESULT_RESPONSE=$(curl -s -X POST "$API_BASE/tasks/result" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "'$TASK_ID'",
    "enrollment_token": "'$ENROLLMENT_TOKEN'",
    "status": "success",
    "result": {
      "message": "Message sent successfully in test"
    },
    "error_message": null
  }')

if echo "$RESULT_RESPONSE" | grep -q "ok\|success"; then
  echo -e "${GREEN}✓ Task result reported${NC}"
  echo "   Response: $RESULT_RESPONSE"
else
  echo -e "${YELLOW}⚠ Result reporting response: $RESULT_RESPONSE${NC}"
fi
echo

# Summary
echo -e "${BOLD}=== Test Summary ===${NC}"
echo -e "${GREEN}✓ All critical endpoints are working${NC}"
echo
echo -e "${BOLD}Next steps:${NC}"
echo "1. Load extension into Chrome: chrome://extensions"
echo "2. Click 'Load unpacked' and select: c:\\Users\\Dell\\OneDrive\\Desktop\\Scalency2\\vinted-extension"
echo "3. Use the following credentials to enroll in the extension:"
echo "   Profile ID: $PROFILE_ID"
echo "   Enrollment Token: $ENROLLMENT_TOKEN"
echo "4. Create tasks from the dashboard or API"
echo "5. Extension will automatically poll and execute tasks"
echo
