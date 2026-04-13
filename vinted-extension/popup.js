/**
 * Vinted Extension MVP - Popup UI
 */

// CONFIG is loaded from config.js before this script

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOM loaded');

  // Add button listeners first
  const enrollBtn = document.getElementById('enroll-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const dashboardBtn = document.getElementById('open-dashboard-btn');

  if (enrollBtn) enrollBtn.addEventListener('click', openEnrollPage);
  if (refreshBtn) refreshBtn.addEventListener('click', updateStatus);
  if (dashboardBtn) dashboardBtn.addEventListener('click', openDashboard);

  // Then update status
  updateStatus();
});

/**
 * Check enrollment status and update UI
 */
async function updateStatus() {
  try {
    const result = await chrome.storage.local.get([
      'enrollment_token',
      'lastPoll',
      'taskCount',
      'errorCount',
    ]);

    console.log('[Popup] Storage result:', result);

    if (result && result.enrollment_token) {
      console.log('[Popup] User is enrolled');
      showEnrolledUI(result);
    } else {
      console.log('[Popup] User is NOT enrolled');
      showNotEnrolledUI();
    }
  } catch (error) {
    console.error('[Popup] Error updating status:', error);
    showErrorUI(error.message);
  }
}

/**
 * Show UI when enrolled
 */
function showEnrolledUI(status) {
  const statusPanel = document.getElementById('enrollment-status');
  if (statusPanel) {
    statusPanel.innerHTML = '<p><strong>✓ Enrolled & Active</strong></p>';
  }

  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = 'Connected';
  }

  const accountInfo = document.getElementById('account-info');
  if (accountInfo) accountInfo.style.display = 'block';

  const notEnrolledInfo = document.getElementById('not-enrolled-info');
  if (notEnrolledInfo) notEnrolledInfo.style.display = 'none';

  const errorInfo = document.getElementById('error-info');
  if (errorInfo) errorInfo.style.display = 'none';

  const enrollBtn = document.getElementById('enroll-btn');
  if (enrollBtn) enrollBtn.style.display = 'none';

  const lastPoll = document.getElementById('last-poll');
  if (lastPoll) {
    lastPoll.textContent = status.lastPoll ? new Date(status.lastPoll).toLocaleString() : 'Never';
  }

  const taskCount = document.getElementById('task-count');
  if (taskCount) {
    taskCount.textContent = status.taskCount || 0;
  }

  const errorCount = document.getElementById('error-count');
  if (errorCount) {
    errorCount.textContent = status.errorCount || 0;
  }

  // Add log entry
  addLog('Extension is polling for tasks every 15 seconds');
}

/**
 * Show UI when not enrolled
 */
function showNotEnrolledUI() {
  console.log('[Popup] Showing not-enrolled UI');

  const statusPanel = document.getElementById('enrollment-status');
  if (statusPanel) {
    statusPanel.innerHTML = '<p><strong>⚠ Not Enrolled</strong></p>';
  }

  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = 'Awaiting setup';
  }

  const accountInfo = document.getElementById('account-info');
  if (accountInfo) accountInfo.style.display = 'none';

  const notEnrolledInfo = document.getElementById('not-enrolled-info');
  if (notEnrolledInfo) notEnrolledInfo.style.display = 'block';

  const errorInfo = document.getElementById('error-info');
  if (errorInfo) errorInfo.style.display = 'none';

  const enrollBtn = document.getElementById('enroll-btn');
  if (enrollBtn) {
    enrollBtn.style.display = 'block';
    console.log('[Popup] Enroll button shown');
  } else {
    console.error('[Popup] Enroll button not found in DOM!');
  }

  addLog('Click "Enroll Now" to link your Vinted account');
}

/**
 * Show error UI
 */
function showErrorUI(error) {
  const statusText = document.getElementById('status-text');
  if (statusText) statusText.textContent = 'Error';

  const errorInfo = document.getElementById('error-info');
  if (errorInfo) errorInfo.style.display = 'block';

  const errorMessage = document.getElementById('error-message');
  if (errorMessage) errorMessage.textContent = error;

  addLog(`Error: ${error}`, 'error');
}

/**
 * Open enrollment page
 */
function openEnrollPage() {
  console.log('[Popup] Opening enroll page...');
  const enrollUrl = chrome.runtime.getURL('enroll/enroll.html');
  console.log('[Popup] Enroll URL:', enrollUrl);
  chrome.tabs.create({ url: enrollUrl });
}

function openDashboard() {
  const apiUrl = CONFIG.getApiBaseUrl();
  chrome.tabs.create({ url: `${apiUrl}/docs` });
}

/**
 * Add log entry to popup
 */
function addLog(message, type = 'info') {
  const logsContent = document.getElementById('logs-content');
  if (!logsContent) {
    console.log('[Popup] Logs content element not found');
    return;
  }

  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
  logsContent.insertBefore(entry, logsContent.firstChild);

  // Keep only last 10 entries
  while (logsContent.children.length > 10) {
    logsContent.removeChild(logsContent.lastChild);
  }
}

// Request status from background worker
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response) {
    console.log('Background status:', response);
  }
});

