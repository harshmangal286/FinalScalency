/**
 * Vinted Extension MVP - Background Service Worker
 *
 * Polling loop: every 15 seconds (with jitter), fetch tasks from backend, execute them, report results
 */

// Configuration - Embedded here since MV3 service workers can't load external scripts
const CONFIG = {
  getApiBaseUrl() {
    return 'http://localhost:8000'; // Updated by build script for production
  },

  API_ENDPOINTS: {
    ENROLL: '/api/v1/vinted/enroll',
    TASKS: '/api/v1/vinted/tasks',
    TASK_RESULT: '/api/v1/vinted/tasks/result',
  },

  POLLING: {
    INTERVAL_DEFAULT_MS: 15000,
    INTERVAL_MIN_MS: 10000,
    INTERVAL_MAX_MS: 30000,
    JITTER_MS: 5000,
    BACKOFF_MULTIPLIER: 1.5,
    MAX_BACKOFF_MS: 120000,
  },

  TASK: {
    TIMEOUT_DEFAULT_MS: 60000,
    RETRY_MAX_ATTEMPTS: 3,
  },

  STORAGE_KEYS: {
    ENROLLMENT_TOKEN: 'enrollment_token',
    PROFILE_ID: 'profile_id',
    LAST_POLL: 'lastPoll',
    TASK_COUNT: 'taskCount',
    ERROR_COUNT: 'errorCount',
  },

  getFullUrl(endpoint) {
    return this.getApiBaseUrl() + endpoint;
  },

  getNextPollInterval(errorCount = 0) {
    let interval = this.POLLING.INTERVAL_DEFAULT_MS;
    if (errorCount > 0) {
      interval = Math.min(
        interval * Math.pow(this.POLLING.BACKOFF_MULTIPLIER, errorCount),
        this.POLLING.MAX_BACKOFF_MS
      );
    }
    const jitter = (Math.random() - 0.5) * 2 * this.POLLING.JITTER_MS;
    return Math.max(
      this.POLLING.INTERVAL_MIN_MS,
      Math.min(this.POLLING.INTERVAL_MAX_MS, interval + jitter)
    );
  },
};

// Global state
let pollInterval = null;
let isPolling = false;
let errorCount = 0; // Track error count for exponential backoff

/**
 * Initialize extension on startup
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Scalency] Extension installed');
  chrome.storage.local.set({
    lastPoll: null,
    taskCount: 0,
    errorCount: 0,
  });
  startPolling();
});

/**
 * Initialize extension on browser startup
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('[Scalency] Browser started');
  startPolling();
});

/**
 * Start polling for tasks
 */
function startPolling() {
  if (isPolling) {
    console.log('[Scalency] Already polling');
    return;
  }

  isPolling = true;
  console.log('[Scalency] Starting polling loop');
  poll(); // Run immediately, then schedule
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  isPolling = false;
  console.log('[Scalency] Stopped polling');
}

/**
 * Main polling loop
 */
async function poll() {
  try {
    const token = await getEnrollmentToken();

    if (!token) {
      console.log('[Scalency] Not enrolled - skipping poll');
      updatePopup({ status: 'not_enrolled' });
      scheduleNextPoll();
      return;
    }

    console.log('[Scalency] Polling for tasks...');
    const pollUrl = CONFIG.getFullUrl(CONFIG.API_ENDPOINTS.TASKS) + `?enrollment_token=${token}`;
    const response = await fetch(pollUrl);

    if (response.status === 401) {
      console.error('[Scalency] Token expired or invalid');
      await chrome.storage.local.remove('enrollment_token');
      updatePopup({ status: 'not_enrolled', error: 'Token expired' });
      scheduleNextPoll();
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const tasks = data.tasks || [];

    console.log(`[Scalency] Got ${tasks.length} tasks`);

    // Reset error count on successful poll
    errorCount = 0;

    // Execute each task
    for (const task of tasks) {
      await executeTask(task, token);
    }

    // Update stats
    const stats = await chrome.storage.local.get(['taskCount']);
    await chrome.storage.local.set({
      lastPoll: new Date().toISOString(),
      taskCount: (stats.taskCount || 0) + tasks.length,
    });

    updatePopup({ status: 'enrolled', lastPoll: new Date(), taskCount: (stats.taskCount || 0) + tasks.length });
  } catch (error) {
    console.error('[Scalency] Poll error:', error);
    errorCount++;
    updatePopup({ status: 'error', error: error.message });

    const stats = await chrome.storage.local.get(['errorCount']);
    await chrome.storage.local.set({
      errorCount: (stats.errorCount || 0) + 1,
    });
  }

  scheduleNextPoll();
}

/**
 * Schedule next poll with jitter and exponential backoff
 */
function scheduleNextPoll() {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  const nextInterval = CONFIG.getNextPollInterval(errorCount);
  console.log(`[Scalency] Next poll in ${nextInterval}ms (error count: ${errorCount})`);
  pollInterval = setInterval(poll, nextInterval);
}

/**
 * Execute a task by sending to content script
 */
async function executeTask(task, token) {
  console.log(`[Scalency] Executing task ${task.task_id}: ${task.task_type}`);

  try {
    // Find an active vinted.com tab
    let tabs = await chrome.tabs.query({
      url: ['https://vinted.com/*', 'https://www.vinted.com/*', 'https://vinted.fr/*', 'https://www.vinted.fr/*'],
    });

    console.log(`[Scalency] Found ${tabs.length} Vinted tabs`);

    // For login tasks, create a Vinted tab if none exists
    if (tabs.length === 0) {
      if (task.task_type === 'login_vinted') {
        console.log('[Scalency] No Vinted tab found - creating one for login task');
        try {
          const newTab = await chrome.tabs.create({
            url: 'https://www.vinted.com/member/signup/select_type',
            active: true
          });
          console.log(`[Scalency] Created new tab ${newTab.id}`);
          tabs = [newTab];

          // Wait a bit for page to load
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (createError) {
          console.error('[Scalency] Failed to create Vinted tab:', createError.message);
          await reportTaskResult(task.task_id, {
            status: 'failed',
            error: `Failed to create Vinted tab: ${createError.message}`
          }, token);
          return;
        }
      } else {
        console.log('[Scalency] No active Vinted tab found');
        // Report failure - no tab available
        await reportTaskResult(task.task_id, {
          status: 'failed',
          error: 'No Vinted tab open'
        }, token);
        return;
      }
    }

    const tab = tabs[0];
    console.log(`[Scalency] Sending task to tab ${tab.id}`);
    console.log(`[Scalency] Tab URL: ${tab.url}`);
    console.log(`[Scalency] Tab status: ${tab.status}`);

    // Ensure content script is injected
    if (tab.status !== 'complete') {
      console.warn('[Scalency] Tab not fully loaded');
    }

    // Try to inject content script if needed
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      console.log('[Scalency] Content script injected/verified');
    } catch (injectError) {
      console.error('[Scalency] Failed to inject content script:', injectError.message);
    }

    // Send task to content script with timeout
    let result;
    try {
      // Create a timeout promise
      const timeoutMs = CONFIG.TASK.TIMEOUT_DEFAULT_MS;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Task timeout after ${timeoutMs}ms`)), timeoutMs)
      );

      // Race between task execution and timeout
      result = await Promise.race([
        chrome.tabs.sendMessage(tab.id, {
          type: 'EXECUTE_TASK',
          task: task,
        }),
        timeoutPromise,
      ]);
      console.log(`[Scalency] Content script response:`, result);

      // Check if response indicates an error
      if (result.status === 'error') {
        throw new Error(`Task execution error: ${result.error}`);
      }

      // Extract actual result for reporting
      if (result.status === 'success' && result.result) {
        result = result.result;
      }
    } catch (messageError) {
      console.error(`[Scalency] Content script error:`, messageError.message);
      // Content script not loaded, error sending message, or timeout
      await reportTaskResult(task.task_id, {
        status: 'failed',
        error: `Content script error: ${messageError.message}`
      }, token);
      return;
    }

    // Report result back to backend
    await reportTaskResult(task.task_id, result, token);
  } catch (error) {
    console.error(`[Scalency] Task execution error: ${error.message}`);

    // Report failure
    await reportTaskResult(task.task_id, {
      status: 'failed',
      error: error.message
    }, token);
  }
}

/**
 * Report task result to backend
 */
async function reportTaskResult(taskId, result, token) {
  try {
    const resultUrl = CONFIG.getFullUrl(CONFIG.API_ENDPOINTS.TASK_RESULT);
    const response = await fetch(resultUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          enrollment_token: token,
          status: result.status || 'failed',
          result: result.status === 'success' ? result.result : undefined,
          error_message: result.error || undefined,
        }),
      }
    );

    if (!response.ok) {
      console.error(`[Scalency] Failed to report result: HTTP ${response.status}`);
      return;
    }

    console.log(`[Scalency] Task ${taskId} result reported`);
  } catch (error) {
    console.error(`[Scalency] Report error: ${error.message}`);
  }
}

/**
 * Get enrollment token from local storage
 */
async function getEnrollmentToken() {
  const result = await chrome.storage.local.get('enrollment_token');
  return result.enrollment_token;
}

/**
 * Update popup UI with current status
 */
function updatePopup({ status, lastPoll, taskCount, error }) {
  chrome.storage.local.set({
    popupStatus: status,
    popupLastPoll: lastPoll,
    popupTaskCount: taskCount,
    popupError: error,
  });
}

/**
 * Allow popup to request current stats
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    chrome.storage.local.get(
      ['enrollment_token', 'lastPoll', 'taskCount', 'errorCount'],
      (result) => {
        sendResponse({
          enrolled: !!result.enrollment_token,
          lastPoll: result.lastPoll,
          taskCount: result.taskCount || 0,
          errorCount: result.errorCount || 0,
        });
      }
    );
    return true; // Keep channel open for async response
  }
});

// Start polling when service worker initializes
console.log('[Scalency] Service worker initialized');
