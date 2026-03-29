/**
 * Scalency Vinted Extension - Configuration
 * Handles environment-aware API URL detection and constants
 */

const CONFIG = {
  // Get API base URL from multiple sources in priority order:
  // 1. Environment variable at build time (set by build script)
  // 2. Chrome manifest v3_execution_world data (if injected)
  // 3. Development default (localhost)
  getApiBaseUrl() {
    // Check if URL was injected at build time via manifest
    if (typeof VINTED_API_BASE_URL !== 'undefined') {
      return VINTED_API_BASE_URL;
    }

    // Check for production flag or injected config
    const isProduction = chrome.runtime.getManifest().version.includes('-prod');
    if (isProduction) {
      // In production build, look for injected constant
      try {
        return chrome.runtime.getManifest().action?.default_popup
          ? 'https://api.scalency.app' // fallback production URL
          : 'http://localhost:8000';
      } catch (e) {
        return 'http://localhost:8000';
      }
    }

    // Default to localhost for development
    return 'http://localhost:8000';
  },

  // API endpoint paths
  API_ENDPOINTS: {
    ENROLL: '/api/v1/vinted/enroll',
    TASKS: '/api/v1/vinted/tasks',
    TASK_RESULT: '/api/v1/vinted/tasks/result',
    PROFILES: '/api/v1/vinted/profiles',
  },

  // Polling configuration
  POLLING: {
    INTERVAL_DEFAULT_MS: 15000, // 15 seconds
    INTERVAL_MIN_MS: 10000,     // 10 seconds
    INTERVAL_MAX_MS: 30000,     // 30 seconds
    JITTER_MS: 5000,            // ±5 seconds random jitter
    BACKOFF_MULTIPLIER: 1.5,    // Exponential backoff on errors
    MAX_BACKOFF_MS: 120000,     // Max 2 minutes
  },

  // Task execution
  TASK: {
    TIMEOUT_DEFAULT_MS: 60000, // 60 seconds default
    TIMEOUT_MAX_MS: 300000,    // 5 minutes max
    RETRY_MAX_ATTEMPTS: 3,
    RETRY_BACKOFF_MS: 5000,
  },

  // Storage keys
  STORAGE_KEYS: {
    ENROLLMENT_TOKEN: 'enrollment_token',
    PROFILE_ID: 'profile_id',
    ACCOUNT_NAME: 'account_name',
    ENROLLED_AT: 'enrolled_at',
    TASK_COUNT: 'taskCount',
    ERROR_COUNT: 'errorCount',
    LAST_POLL: 'lastPoll',
    TASK_HISTORY: 'taskHistory', // New: Last 50 task executions
    ERROR_LOG: 'errorLog',         // New: Last 20 errors
    DEBUG_MODE: 'debugMode',       // New: Debug logging toggle
  },

  // DOM interaction timeouts
  DOM: {
    ELEMENT_WAIT_TIMEOUT_MS: 10000, // Wait up to 10s for elements
    PAGE_LOAD_TIMEOUT_MS: 15000,    // Wait up to 15s for page load
    KEYSTROKE_DELAY_MS: 30,         // 30ms between keystrokes (realistic typing)
    CLICK_DELAY_MS: 200,            // 200ms delay before/after clicks
  },

  // Build full API URL for endpoint
  getFullUrl(endpoint) {
    return this.getApiBaseUrl() + endpoint;
  },

  // Utility: Calculate polling interval with jitter
  getNextPollInterval(errorCount = 0) {
    let interval = this.POLLING.INTERVAL_DEFAULT_MS;

    // Apply exponential backoff on repeated errors
    if (errorCount > 0) {
      const backoffInterval = Math.min(
        interval * Math.pow(this.POLLING.BACKOFF_MULTIPLIER, errorCount),
        this.POLLING.MAX_BACKOFF_MS
      );
      interval = backoffInterval;
    }

    // Add random jitter (±50% of JITTER_MS)
    const jitter = (Math.random() - 0.5) * 2 * this.POLLING.JITTER_MS;
    return Math.max(
      this.POLLING.INTERVAL_MIN_MS,
      Math.min(
        this.POLLING.INTERVAL_MAX_MS,
        interval + jitter
      )
    );
  },

  // Utility: Get task timeout (with safety bounds)
  getTaskTimeout(customTimeout = null) {
    if (customTimeout && customTimeout > 0) {
      return Math.min(customTimeout, this.TASK.TIMEOUT_MAX_MS);
    }
    return this.TASK.TIMEOUT_DEFAULT_MS;
  },

  // Utility: Should be initialized only once per extension load
  // Returns true if successfully initialized, false if already running
  initializeExtension() {
    const isAlreadyInitialized = sessionStorage.getItem('extensionInitialized');
    if (!isAlreadyInitialized) {
      sessionStorage.setItem('extensionInitialized', 'true');
      console.log('[CONFIG] Extension initialized with API:', this.getApiBaseUrl());
      return true;
    }
    return false;
  },
};

// Log configuration on load
console.log('[CONFIG] Loaded with API base URL:', CONFIG.getApiBaseUrl());
