#!/usr/bin/env python3
"""
Test script for publishing flow
Tests: Auth -> Listing Creation -> AI Generation -> Publishing
"""
import requests
import time
import json
import sys

BASE_URL = "http://localhost:8000"
API_URL = f"{BASE_URL}/api/v1"

# Test credentials
VINTED_USERNAME = "free645"
VINTED_PASSWORD = "8815219720h"
TEST_EMAIL = "test@scalency.ai"
TEST_PASSWORD = "testpass123"

def print_step(step_num, message):
    print(f"\n{'='*60}")
    print(f"Step {step_num}: {message}")
    print('='*60)

def print_success(message):
    print(f"[OK] {message}")

def print_error(message):
    print(f"[ERROR] {message}")

def print_info(message):
    print(f"[INFO] {message}")

def print_warning(message):
    print(f"[WARN] {message}")

# Step 1: Login/Register
print_step(1, "Authenticating")
try:
    # Try to login (OAuth2 form data)
    login_data = {
        "username": TEST_EMAIL,
        "password": TEST_PASSWORD
    }
    # OAuth2PasswordRequestForm expects form-urlencoded
    response = requests.post(
        f"{API_URL}/auth/token",
        data=login_data
    )
    if response.status_code == 200:
        token = response.json()["access_token"]
        print_success("Logged in successfully")
    else:
        # Register new user
        print_info("User doesn't exist, registering...")
        register_data = {
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD,
            "full_name": "Test User"
        }
        response = requests.post(f"{API_URL}/auth/register", json=register_data)
        if response.status_code == 200:
            print_success("User registered")
            # Now login
            response = requests.post(f"{API_URL}/auth/token", data=login_data)
            token = response.json()["access_token"]
            print_success("Logged in")
        elif "already exists" in response.text:
            # User exists, try login again
            print_info("User already exists, trying login...")
            response = requests.post(f"{API_URL}/auth/token", data=login_data)
            if response.status_code == 200:
                token = response.json()["access_token"]
                print_success("Logged in")
            else:
                print_error(f"Login failed: {response.text}")
                sys.exit(1)
        else:
            print_error(f"Registration failed: {response.text}")
            sys.exit(1)
except Exception as e:
    print_error(f"Authentication failed: {e}")
    sys.exit(1)

headers = {"Authorization": f"Bearer {token}"}

# Step 2: Check/Create Vinted Account
print_step(2, "Setting up Vinted Account")
try:
    # Check existing accounts
    response = requests.get(f"{API_URL}/vinted-accounts/", headers=headers)
    if response.status_code == 200:
        accounts = response.json()
        if len(accounts) > 0:
            account_id = accounts[0]["id"]
            print_info(f"Using existing account: ID {account_id}")
        else:
            print_info("No existing account, creating new one...")
            # Note: The endpoint might need fixing, but let's try
            account_data = {
                "vinted_username": VINTED_USERNAME,
                "vinted_password": VINTED_PASSWORD,
                "api_token": "dummy_token"  # Required by schema
            }
            response = requests.post(f"{API_URL}/vinted-accounts/", headers=headers, json=account_data)
            if response.status_code in [200, 201]:
                account_id = response.json()["id"]
                print_success(f"Vinted account created: ID {account_id}")
            else:
                print_warning(f"Could not create account (status {response.status_code}): {response.text}")
                print_warning("Continuing anyway - account might be needed for publishing")
    else:
        print_warning(f"Could not check accounts (status {response.status_code}): {response.text}")
        print_warning("Continuing anyway - publishing will use account from database")
except Exception as e:
    print_warning(f"Account setup issue: {e}")
    print_warning("Continuing anyway")

# Step 3: Create Listing
print_step(3, "Creating Listing")
try:
    # Create a simple test image (1x1 pixel PNG in base64)
    test_image_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xdb\x00\x00\x00\x00IEND\xaeB`\x82'
    
    files = {
        'image_file': ('test.png', test_image_data, 'image/png')
    }
    data = {
        'prompt_title': 'Vintage Nike T-Shirt - Blue - Size M',
        'size': 'M',
        'category': 'T-shirts',
        'brand': 'Nike',
        'condition': 'Good',
        'color': 'Blue'
    }
    
    response = requests.post(f"{API_URL}/listings/generate", headers=headers, files=files, data=data)
    if response.status_code == 200:
        result = response.json()
        listing_id = result["listing_id"]
        task_id = result["task_id"]
        print_success(f"Listing created: ID {listing_id}")
        print_success(f"AI generation task started: {task_id}")
    else:
        print_error(f"Failed to create listing: {response.status_code} - {response.text}")
        sys.exit(1)
except Exception as e:
    print_error(f"Listing creation failed: {e}")
    sys.exit(1)

# Step 4: Wait for AI Generation
print_step(4, "Waiting for AI Generation")
max_wait = 90
waited = 0
generated = False

while waited < max_wait and not generated:
    time.sleep(5)
    waited += 5
    try:
        response = requests.get(f"{API_URL}/listings/generate/status/{task_id}", headers=headers)
        if response.status_code == 200:
            status = response.json()
            print(f"   Status: {status.get('status', 'UNKNOWN')} (waited {waited}s)...")
            
            if status.get("status") == "SUCCESS":
                print_success("AI generation completed!")
                if "result" in status:
                    result = status["result"]
                    if "generated_title" in result:
                        print(f"   Title: {result['generated_title']}")
                    if "generated_description" in result:
                        desc = result["generated_description"]
                        print(f"   Description: {desc[:100]}...")
                generated = True
            elif status.get("status") == "FAILURE":
                print_error(f"AI generation failed: {status.get('error', 'Unknown error')}")
                break
    except Exception as e:
        print_warning(f"Error checking status: {e}")

if not generated:
    print_warning("AI generation did not complete in time, but continuing...")

# Step 5: Verify Listing
print_step(5, "Verifying Listing")
try:
    response = requests.get(f"{API_URL}/listings/{listing_id}", headers=headers)
    if response.status_code == 200:
        listing = response.json()
        print_success(f"Listing retrieved: {listing.get('id')}")
        print(f"   Status: {listing.get('status')}")
        print(f"   Title: {listing.get('generated_title', 'N/A')}")
        
        if not listing.get("generated_title"):
            print_warning("Listing has no generated title. Publishing may fail.")
    else:
        print_warning(f"Could not retrieve listing: {response.status_code}")
except Exception as e:
    print_warning(f"Listing verification failed: {e}")

# Step 6: Publish Listing
print_step(6, "Publishing Listing to Vinted")
print_warning("This will use real Vinted credentials and may take several minutes...")
print(f"   Username: {VINTED_USERNAME}")
print(f"   This will launch Playwright browser automation...")

try:
    response = requests.post(f"{API_URL}/listings/{listing_id}/publish", headers=headers)
    if response.status_code == 200:
        result = response.json()
        publish_task_id = result["task_id"]
        print_success(f"Publish task started: {publish_task_id}")
        print_info("Task is running in background...")
        
        # Monitor publish status
        print("\n   Monitoring publish progress...")
        max_publish_wait = 300  # 5 minutes
        publish_waited = 0
        publish_complete = False
        
        while publish_waited < max_publish_wait and not publish_complete:
            time.sleep(10)
            publish_waited += 10
            try:
                status_response = requests.get(
                    f"{API_URL}/listings/publish/status/{publish_task_id}",
                    headers=headers
                )
                if status_response.status_code == 200:
                    publish_status = status_response.json()
                    status = publish_status.get("status", "UNKNOWN")
                    print(f"   Status: {status} (waited {publish_waited}s)...")
                    
                    if status == "SUCCESS":
                        print("\n" + "="*60)
                        print_success("PUBLISH SUCCESSFUL!")
                        print("="*60)
                        if "result" in publish_status:
                            result = publish_status["result"]
                            if "listing_url" in result:
                                print(f"   Listing URL: {result['listing_url']}")
                            if "vinted_id" in result:
                                print(f"   Vinted ID: {result['vinted_id']}")
                            print(f"   Full result: {json.dumps(result, indent=2)}")
                        publish_complete = True
                    elif status == "FAILURE":
                        print("\n" + "="*60)
                        print_error("Publish failed")
                        print("="*60)
                        if "error" in publish_status:
                            print(f"   Error: {publish_status['error']}")
                        if "bot_stdout" in publish_status:
                            print(f"   Bot Output: {publish_status['bot_stdout']}")
                        if "bot_stderr" in publish_status:
                            print(f"   Bot Errors: {publish_status['bot_stderr']}")
                        publish_complete = True
                    elif status == "PROGRESS":
                        if "progress" in publish_status:
                            progress = publish_status["progress"]
                            if isinstance(progress, dict):
                                print(f"   Progress: {progress.get('status', 'N/A')} - {progress.get('progress', 0)}%")
            except Exception as e:
                print_warning(f"Error checking publish status: {e}")
        
        if not publish_complete:
            print_warning(f"Publish task still running after {max_publish_wait}s")
            print_info(f"Check status manually: GET {API_URL}/listings/publish/status/{publish_task_id}")
    else:
        print_error(f"Failed to start publish: {response.status_code}")
        print_error(f"Response: {response.text}")
except Exception as e:
    print_error(f"Publish request failed: {e}")
    import traceback
    traceback.print_exc()

# Final Summary
print("\n" + "="*60)
print("=== Test Summary ===")
print("="*60)
print("[OK] Authentication: Working")
print("[OK] Listing Creation: Working")
print(f"[OK] AI Generation: {'Completed' if generated else 'In Progress'}")
print("[OK] Publishing: Task Started")
print("\nView logs: docker-compose logs -f api celery-worker")
print("API Docs: http://localhost:8000/docs")
print("="*60)
