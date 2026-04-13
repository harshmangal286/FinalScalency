/**
 * Vinted Extension - Content Script
 *
 * Handles DOM automation on vinted.com/vinted.fr:
 * - send_message: Send a message to a user via chat
 * - publish_listing: Publish a new listing via /sell page
 * - bump_listing: Bump/refresh an existing listing
 *
 * All interactions respect Vinted's DOM structure and include proper waiting for elements.
 */

console.log('[Scalency] Content script initializing...');

// Check for pending tasks saved in sessionStorage (from previous page navigation)
window.addEventListener('load', async () => {
  console.log('[Content] Page fully loaded - checking for pending tasks in sessionStorage...');

  // Check for pending login task
  const pendingLoginJson = sessionStorage.getItem('scalency_pending_login');
  if (pendingLoginJson) {
    console.log('[Content] ✓ Found pending LOGIN task in sessionStorage, executing now...');
    sessionStorage.removeItem('scalency_pending_login');

    try {
      const payload = JSON.parse(pendingLoginJson);
      console.log('[Content] Executing pending login_vinted task after navigation...');
      await executeLoginVinted(payload);
    } catch (err) {
      console.error('[Content] ⚠ Failed to execute pending login task:', err.message);
    }
  }

  const pendingTaskJson = sessionStorage.getItem('scalency_pending_task');
  if (pendingTaskJson) {
    console.log('[Content] ✓ Found pending task in sessionStorage, executing now...');
    sessionStorage.removeItem('scalency_pending_task');

    try {
      const payload = JSON.parse(pendingTaskJson);
      if (payload.title && payload.description && payload.price) {
        console.log('[Content] Executing pending publish_listing task after navigation...');
        await executePublishListing(payload);
      }
    } catch (err) {
      console.error('[Content] ⚠ Failed to execute pending task:', err.message);
    }
  }
});

// Check if chrome API is available
if (typeof chrome !== 'undefined' && chrome.runtime) {
  console.log('[Scalency] chrome.runtime is available');

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[Content] Message listener triggered!');
      console.log('[Content] Message:', JSON.stringify(message));

      if (message.type === 'EXECUTE_TASK') {
        console.log('[Content] EXECUTE_TASK received');
        const task = message.task;

        // Create response wrapper to ensure we always respond
        let responded = false;
        const sendResponseOnce = (data) => {
          if (!responded) {
            responded = true;
            console.log('[Content] Sending response:', data);
            sendResponse(data);
          }
        };

        // Timeout after 5 minutes
        const timeoutId = setTimeout(() => {
          if (!responded) {
            console.error('[Content] Task execution timeout');
            sendResponseOnce({
              status: 'error',
              error: 'Task execution timeout'
            });
          }
        }, 300000); // 5 minutes

        // Execute task and send response when complete
        (async () => {
          try {
            console.log('[Content] Starting task execution...');
            const result = await executeTask(task);
            clearTimeout(timeoutId);
            console.log('[Content] Task completed with result:', result);
            sendResponseOnce({
              status: 'success',
              result: result
            });
          } catch (error) {
            clearTimeout(timeoutId);
            console.error('[Content] Task execution failed:', error.message, error.stack);
            sendResponseOnce({
              status: 'error',
              error: error.message
            });
          }
        })();

        return true; // Will respond asynchronously
      }

      sendResponse({ received: true });
    });

    console.log('[Scalency] Message listener registered successfully');
  } catch (err) {
    console.error('[Scalency] Error registering listener:', err);
  }
} else {
  console.error('[Scalency] chrome.runtime not available - extension communication disabled');
}

console.log('[Scalency] Content script loaded');

/**
 * Execute task by type
 */
async function executeTask(task) {
  switch (task.task_type) {
    case 'login_vinted':
      return await executeLoginVinted(task.payload);
    case 'send_message':
      return await executeSendMessage(task.payload);
    case 'publish_listing':
      return await executePublishListing(task.payload);
    case 'bump_listing':
      return await executeBumpListing(task.payload);
    case 'follow_user':
      return await executeFollowUser(task.payload);
    case 'search_listings':
      return await executeSearchListings(task.payload);
    case 'scrape_data':
      return await executeScrapeData(task.payload);
    default:
      throw new Error(`Unknown task type: ${task.task_type}`);
  }
}

/**
 * AUTO-DETECT form field selectors by inspecting the form
 * Returns object: { title: selector, description: selector, price: selector }
 */
async function detectFormFields() {
  console.log('[Content] Starting form field detection...');

  const detected = {
    title: null,
    description: null,
    price: null,
    category: null,
    imageUpload: null,
  };

  // Inspect all inputs
  const allInputs = document.querySelectorAll('input');
  console.log(`[Content] Found ${allInputs.length} input elements on page`);

  allInputs.forEach((input, idx) => {
    const info = {
      index: idx,
      id: input.id,
      name: input.name,
      type: input.type,
      placeholder: input.placeholder,
      ariaLabel: input.getAttribute('aria-label'),
      dataTestid: input.getAttribute('data-testid'),
      className: input.className,
      value: input.value,
    };
    console.log(`[Content] Input[${idx}]:`, info);

    // Skip search/filter inputs
    const isSearchInput = input.name?.toLowerCase().includes('search') ||
                        input.id?.toLowerCase().includes('search') ||
                        input.placeholder?.toLowerCase().includes('search');

    if (isSearchInput) {
      console.log(`[Content] Skipping search input: ${input.name || input.id}`);
    }

    // Detect TITLE field (prioritize by name, avoid search inputs)
    if (!detected.title && !isSearchInput) {
      if (
        input.name?.toLowerCase().includes('title') ||
        input.id?.toLowerCase().includes('title')
      ) {
        detected.title = getUniqueSelector(input);
        console.log(`[Content] ✓ Detected TITLE field by name: ${detected.title}`);
      }
    }

    // TITLE field fallback: look for "Tell buyers" or similar selling-related placeholders
    if (!detected.title && !isSearchInput && !detected.title) {
      if (
        input.placeholder?.toLowerCase().includes('what you') ||
        input.placeholder?.toLowerCase().includes('selling') ||
        input.placeholder?.toLowerCase().includes('product name') ||
        input.placeholder?.toLowerCase().includes('item name')
      ) {
        detected.title = getUniqueSelector(input);
        console.log(`[Content] ✓ Detected TITLE field by placeholder: ${detected.title}`);
      }
    }

    // Detect PRICE field (by name or exact pattern)
    if (!detected.price) {
      if (
        input.name?.toLowerCase().includes('price') ||
        input.id?.toLowerCase().includes('price') ||
        input.placeholder?.toLowerCase().includes('$') ||
        input.placeholder?.toLowerCase().includes('€')
      ) {
        detected.price = getUniqueSelector(input);
        console.log(`[Content] ✓ Detected PRICE field: ${detected.price}`);
      }
    }

    // Detect IMAGE UPLOAD (file input)
    if (!detected.imageUpload && input.type === 'file') {
      detected.imageUpload = getUniqueSelector(input);
      console.log(`[Content] ✓ Detected IMAGE UPLOAD field: ${detected.imageUpload}`);
    }

    // Detect CATEGORY (input element with data-testid or name)
    if (!detected.category && !isSearchInput) {
      const isCategoryByName = input.name?.toLowerCase().includes('category');
      const isCategoryById = input.id?.toLowerCase().includes('category');
      const isCategoryByTestId = input.getAttribute('data-testid')?.toLowerCase().includes('category');

      if (isCategoryByName || isCategoryById || isCategoryByTestId) {
        detected.category = getUniqueSelector(input);
        console.log(`[Content] ✓ Detected CATEGORY field from input: ${detected.category} (byName:${isCategoryByName} byId:${isCategoryById} byTestId:${isCategoryByTestId})`);
      }
    }
  });

  // Inspect all textareas
  const allTextareas = document.querySelectorAll('textarea');
  console.log(`[Content] Found ${allTextareas.length} textarea elements on page`);

  allTextareas.forEach((textarea, idx) => {
    const info = {
      index: idx,
      id: textarea.id,
      name: textarea.name,
      placeholder: textarea.placeholder,
    };
    console.log(`[Content] Textarea[${idx}]:`, info);

    if (!detected.description) {
      if (
        textarea.name?.toLowerCase().includes('description') ||
        textarea.placeholder?.toLowerCase().includes('description')
      ) {
        detected.description = getUniqueSelector(textarea);
        console.log(`[Content] ✓ Detected DESCRIPTION field: ${detected.description}`);
      }
    }

    if (!detected.description && idx === 0) {
      detected.description = getUniqueSelector(textarea);
      console.log(`[Content] ✓ DESCRIPTION fallback: first textarea: ${detected.description}`);
    }
  });

  // Detect CATEGORY (select or dropdown)
  const selectElements = document.querySelectorAll('select, [role="combobox"], [role="listbox"]');
  console.log(`[Content] Found ${selectElements.length} select/dropdown elements`);

  selectElements.forEach((elem, idx) => {
    const info = {
      index: idx,
      tagName: elem.tagName,
      name: elem.name,
      id: elem.id,
      ariaLabel: elem.getAttribute('aria-label'),
      placeholder: elem.placeholder,
    };
    console.log(`[Content] Select[${idx}]:`, info);

    if (!detected.category) {
      if (
        elem.name?.toLowerCase().includes('category') ||
        elem.getAttribute('aria-label')?.toLowerCase().includes('category') ||
        elem.textContent?.toLowerCase().includes('category')
      ) {
        detected.category = getUniqueSelector(elem);
        console.log(`[Content] ✓ Detected CATEGORY field: ${detected.category}`);
      }
    }

    // Fallback: first select is often category
    if (!detected.category && idx === 0 && elem.tagName === 'SELECT') {
      detected.category = getUniqueSelector(elem);
      console.log(`[Content] ✓ CATEGORY fallback: first select: ${detected.category}`);
    }
  });

  // Fallback: if title not found, try first text input
  if (!detected.title && allInputs.length > 0) {
    detected.title = getUniqueSelector(allInputs[0]);
    console.log(`[Content] ✓ TITLE fallback: first input: ${detected.title}`);
  }

  // Fallback: if price not found, try to find number input
  if (!detected.price) {
    const numberInput = document.querySelector('input[type="number"], input[inputmode="decimal"], input[pattern*="0-9"]');
    if (numberInput) {
      detected.price = getUniqueSelector(numberInput);
      console.log(`[Content] ✓ PRICE fallback: number input: ${detected.price}`);
    }
  }

  console.log('[Content] ===== DETECTION COMPLETE =====');
  console.log('[Content] Detected fields:', detected);

  return detected;
}

/**
 * Generate a unique CSS selector for an element
 */
function getUniqueSelector(element) {
  // Try to use ID first
  if (element.id) {
    return `#${element.id}`;
  }

  // Try to use name attribute
  if (element.name) {
    const tagName = element.tagName.toLowerCase();
    return `${tagName}[name="${element.name}"]`;
  }

  // Try to use data-testid
  const testid = element.getAttribute('data-testid');
  if (testid) {
    return `[data-testid="${testid}"]`;
  }

  // Try to use placeholder
  if (element.placeholder) {
    const tagName = element.tagName.toLowerCase();
    return `${tagName}[placeholder="${element.placeholder}"]`;
  }

  // Fallback: use position
  const tagName = element.tagName.toLowerCase();
  const allOfType = document.querySelectorAll(tagName);
  const index = Array.from(allOfType).indexOf(element);
  return `${tagName}:nth-of-type(${index + 1})`;
}

/**
 * Try to fill a dropdown field by its name (e.g., 'brand', 'size', 'condition', 'color')
 * This is a generic helper for filling readonly combobox dropdowns
 */
async function tryFillDropdown(fieldName, value) {
  console.log(`[Content] tryFillDropdown: field="${fieldName}", value="${value}"`);

  try {
    // Map field names to their data-testid values
    const testIdMap = {
      'brand': 'brand-select-dropdown-input',
      'size': 'size-select-dropdown-input',
      'condition': 'category-condition-single-list-input',
      'color': 'color-select-dropdown-input',
      'material': 'category-material-multi-list-input'
    };

    const testId = testIdMap[fieldName];
    let element = null;

    if (testId) {
      element = document.querySelector(`[data-testid="${testId}"]`);
      console.log(`[Content] Found ${fieldName} by data-testid: ${testId}`, element ? '✓' : '✗');
    }

    // Fallback: try traditional selectors
    if (!element) {
      element = document.querySelector(`input[name="${fieldName}"]`);
    }
    if (!element) {
      element = document.querySelector(`input[id="${fieldName}"]`);
    }

    if (!element) {
      console.warn(`[Content] ⚠ Could not find field "${fieldName}"`);
      return false;
    }

    console.log(`[Content] ✓ Found ${fieldName} field, clicking to open dropdown...`);

    // Scroll into view first
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(300);

    // Click the input element
    element.click();
    await delay(700); // Give dropdown time to appear

    // Helper to find all visible clickable options
    const getDropdownOptions = () => {
      // Vinted uses this selector for clickable options in dropdowns
      return Array.from(document.querySelectorAll(
        'div[role="button"][tabindex="0"]'
      )).filter(opt => {
        const style = window.getComputedStyle(opt);
        const text = opt.textContent?.trim();

        // Must be visible
        if (style.display === 'none' || style.visibility === 'hidden') return false;

        // Must have text
        if (!text || text.length === 0) return false;

        // Filter out search/input elements that are sometimes buttons
        if (opt.querySelector('input[type="text"], input[type="search"]')) return false;

        return true;
      });
    };

    let allOptions = getDropdownOptions();
    console.log(`[Content] Found ${allOptions.length} options for ${fieldName}`);

    if (allOptions.length === 0) {
      console.warn(`[Content] ⚠ No dropdown options found for ${fieldName}`);

      // Try clicking the chevron/suffix icon instead
      const chevron = element.parentElement?.querySelector('[role="button"][class*="suffix"]') ||
                      element.parentElement?.querySelector('[data-testid*="chevron"]');
      if (chevron) {
        console.log(`[Content] Trying to click chevron icon...`);
        chevron.click();
        await delay(600);
        allOptions = getDropdownOptions();
        console.log(`[Content] After clicking chevron, found ${allOptions.length} options`);
      }
    }

    if (allOptions.length === 0) {
      console.warn(`[Content] ⚠ Still no options found for ${fieldName}, giving up`);
      return false;
    }

    // Extract option texts with better parsing
    const optionTexts = allOptions.slice(0, 20).map(o => {
      const titleEl = o.querySelector('.web_ui__Cell__title');
      const bodyEl = o.querySelector('.web_ui__Cell__body');
      const title = titleEl?.textContent?.trim() || '';
      const body = bodyEl?.textContent?.trim() || '';
      return `"${title}"${body ? ` (${body})` : ''}`;
    });

    console.log(`[Content] Available options for ${fieldName}:`, optionTexts);

    // Try exact match first
    let matching = allOptions.find(opt => {
      const titleEl = opt.querySelector('.web_ui__Cell__title');
      const text = (titleEl?.textContent || opt.textContent)?.toLowerCase().trim() || '';
      const search = value.toLowerCase().trim();
      return text === search;
    });

    if (matching) {
      console.log(`[Content] ✓ Found exact match for ${fieldName}: ${value}`);
      matching.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(200);
      matching.click();
      await delay(600);

      // For multi-select fields, don't close dropdown yet
      if (fieldName !== 'color' && fieldName !== 'material') {
        const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
        document.dispatchEvent(escapeEvent);
        await delay(300);
      }

      console.log(`[Content] ✓ ${fieldName} value after selection:`, element.value);
      return true;
    }

    // Try substring match
    matching = allOptions.find(opt => {
      const titleEl = opt.querySelector('.web_ui__Cell__title');
      const text = (titleEl?.textContent || opt.textContent)?.toLowerCase().trim() || '';
      const search = value.toLowerCase().trim();
      return text.includes(search) || search.includes(text);
    });

    if (matching) {
      console.log(`[Content] ✓ Found substring match for ${fieldName}: ${matching.querySelector('.web_ui__Cell__title')?.textContent?.trim() || matching.textContent?.trim()}`);
      matching.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(200);
      matching.click();
      await delay(600);

      // For multi-select fields, don't close dropdown yet
      if (fieldName !== 'color' && fieldName !== 'material') {
        const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
        document.dispatchEvent(escapeEvent);
        await delay(300);
      }

      console.log(`[Content] ✓ ${fieldName} value after selection:`, element.value);
      return true;
    }

    console.warn(`[Content] ⚠ No match found for "${value}" in ${fieldName}`);
    console.log(`[Content] Closing dropdown...`);
    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
    document.dispatchEvent(escapeEvent);
    return false;
  } catch (err) {
    console.error(`[Content] ⚠ Error filling ${fieldName}:`, err.message);
    return false;
  }
}

/**
 * Select a category from dropdown
 */
async function selectCategory(categoryName, categorySelector) {
  console.log(`[Content] selectCategory: "${categoryName}" using selector "${categorySelector}"`);

  const categoryElement = document.querySelector(categorySelector);
  if (!categoryElement) {
    throw new Error(`Category element not found with selector: ${categorySelector}`);
  }

  // IMPORTANT: Trim trailing spaces from form input
  const cleanName = categoryName.trim();
  console.log(`[Content] Cleaned category name: "${cleanName}"`);

  // If it's a readonly INPUT (Vinted-style combobox)
  if (categoryElement.tagName === 'INPUT' && categoryElement.readOnly) {
    console.log('[Content] Detected readonly combobox-style input, clicking to open dropdown...');

    categoryElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(300);

    categoryElement.click();
    await delay(800); // Wait for dropdown to fully appear

    // Helper to find all clickable catalog items (not suggestions, but main catalog sections)
    const getCatalogOptions = () => {
      // Look for ALL div[id^="catalog-"] with role="button" anywhere on the page
      const allCatalogDivs = Array.from(document.querySelectorAll('div[id^="catalog-"][role="button"]')).filter(opt => {
        const style = window.getComputedStyle(opt);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && opt.offsetParent !== null;
        const hasTitle = opt.querySelector('.web_ui__Cell__title');
        return isVisible && hasTitle;
      });

      console.log(`[Content] Found ${allCatalogDivs.length} total catalog options`);
      return allCatalogDivs;
    };

    let options = getCatalogOptions();

    if (options.length === 0) {
      console.warn('[Content] ⚠ No catalog options found in dropdown');
      return;
    }

    const optionTexts = options.map(o => {
      const titleEl = o.querySelector('.web_ui__Cell__title');
      return titleEl ? titleEl.textContent?.trim() : '';
    }).filter(Boolean);

    console.log(`[Content] Available catalog options:`, optionTexts.slice(0, 8));

    // Try parent categories for hierarchical matching (e.g., "Formal shoes" might be under "Men > Shoes")
    const commonParents = ['Women', 'Men', 'Kids', 'Home', 'Electronics', 'Entertainment', 'Hobbies & collectibles', 'Sports'];
    const searchLower = cleanName.toLowerCase();

    // Special mapping for common shoe/clothing terms
    const subcategoryMap = {
      'sneakers': 'Shoes',
      'boots': 'Shoes',
      'heels': 'Shoes',
      'trainers': 'Shoes',
      'sandals': 'Shoes',
      'flats': 'Shoes',
      'clothing': 'Clothing',
      'dress': 'Clothing',
      'jeans': 'Clothing',
      'tops': 'Clothing',
      'bags': 'Bags',
      'handbag': 'Bags',
      'accessories': 'Accessories',
      'jewelry': 'Accessories',
    };

    // Find the parent subcategory hint
    const parentSubcategory = subcategoryMap[searchLower.split(' ')[0]]; // e.g., "sneakers" -> "Shoes"

    // First try to find exact match or parent/child combo in text
    for (const parent of commonParents) {
      const parentOption = options.find(opt => {
        const titleEl = opt.querySelector('.web_ui__Cell__title');
        const text = titleEl?.textContent?.toLowerCase().trim() || '';
        return text === parent.toLowerCase();
      });

      if (parentOption) {
        console.log(`[Content] Trying parent category: ${parent}`);
        parentOption.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(300);
        parentOption.click();
        await delay(1200); // Wait for subcategories to load

        // Get fresh options after navigating
        let subOptions = getCatalogOptions();
        console.log(`[Content] After clicking ${parent}, found ${subOptions.length} subcategory options`);

        if (subOptions.length > 0) {
          const subTexts = subOptions.map(o => {
            const titleEl = o.querySelector('.web_ui__Cell__title');
            return titleEl ? titleEl.textContent?.trim() : '';
          }).filter(Boolean);
          console.log(`[Content] Subcategory options:`, subTexts);

          // Try to match the subcategory
          let subMatching = subOptions.find(opt => {
            const titleEl = opt.querySelector('.web_ui__Cell__title');
            const text = titleEl?.textContent?.toLowerCase().trim() || '';
            // Match if exact or if search term is in the option text
            return text === searchLower || text.includes(searchLower);
          });

          // If no exact match but we have a mapped subcategory, try that
          if (!subMatching && parentSubcategory) {
            console.log(`[Content] No exact match for "${cleanName}", trying mapped subcategory: "${parentSubcategory}"`);
            subMatching = subOptions.find(opt => {
              const titleEl = opt.querySelector('.web_ui__Cell__title');
              const text = titleEl?.textContent?.trim() || '';
              return text === parentSubcategory;
            });
          }

          if (subMatching) {
            const matchTitle = subMatching.querySelector('.web_ui__Cell__title')?.textContent?.trim();
            console.log(`[Content] ✓ Found matching subcategory: ${matchTitle}`);
            subMatching.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await delay(300);
            subMatching.click();
            await delay(1000);

            // Check if this opens a 3rd level (e.g., Shoes > Trainers / Sneakers)
            const thirdLevelOptions = getCatalogOptions();
            if (thirdLevelOptions.length > 0 && thirdLevelOptions.length < 20) {
              console.log(`[Content] Found ${thirdLevelOptions.length} third-level options, searching for "${searchLower}"...`);
              const thirdMatching = thirdLevelOptions.find(opt => {
                const titleEl = opt.querySelector('.web_ui__Cell__title');
                const text = titleEl?.textContent?.toLowerCase().trim() || '';
                return text === searchLower || text.includes(searchLower);
              });

              if (thirdMatching) {
                const thirdTitle = thirdMatching.querySelector('.web_ui__Cell__title')?.textContent?.trim();
                console.log(`[Content] ✓ Found exact match at 3rd level: ${thirdTitle}`);
                thirdMatching.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await delay(300);
                thirdMatching.click();
                await delay(1000);
              }
            }

            // Close dropdown
            const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
            document.dispatchEvent(escapeEvent);
            await delay(400);

            console.log(`[Content] ✓ Category field value after selection:`, categoryElement.value);
            return;
          }
        }
      }
    }

    // If hierarchical didn't work, try direct match on top-level
    const directMatch = options.find(opt => {
      const titleEl = opt.querySelector('.web_ui__Cell__title');
      const text = titleEl?.textContent?.toLowerCase().trim() || '';
      return text === searchLower || text.includes(searchLower);
    });

    if (directMatch) {
      const matchTitle = directMatch.querySelector('.web_ui__Cell__title')?.textContent?.trim();
      console.log(`[Content] ✓ Found direct match: ${matchTitle}`);
      directMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      directMatch.click();
      await delay(1000);

      // Close dropdown
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
      document.dispatchEvent(escapeEvent);
      await delay(400);

      console.log(`[Content] ✓ Category field value after selection:`, categoryElement.value);
      return;
    }

    console.warn(`[Content] ⚠ Could not find category "${cleanName}"`);
    console.log(`[Content] Available options were:`, optionTexts);
    return;
  }


  // If it's a SELECT element (rare for Vinted but handle it anyway)
  if (categoryElement.tagName === 'SELECT') {
    const options = Array.from(categoryElement.options);
    console.log(`[Content] HTML SELECT: Found ${options.length} options`);

    const matchOption = options.find(opt =>
      opt.textContent.toLowerCase().includes(categoryName.toLowerCase())
    );

    if (!matchOption) {
      console.log('[Content] Available categories:', options.map(o => o.textContent));
      throw new Error(`Category "${categoryName}" not found`);
    }

    categoryElement.value = matchOption.value;
    categoryElement.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(300);
    return;
  }

  console.warn('[Content] ⚠ Unexpected category element type:', categoryElement.tagName);
}

/**
 * Upload images by fetching URLs and populating file input
 */
async function uploadImages(imageUrls, fileInputSelector) {
  console.log(`[Content] uploadImages: ${imageUrls?.length || 0} URLs, selector: "${fileInputSelector}"`);

  if (!imageUrls || imageUrls.length === 0) {
    console.warn('[Content] ⚠ No image URLs provided in task payload');
    return;
  }

  const fileInput = document.querySelector(fileInputSelector);
  if (!fileInput) {
    throw new Error(`File input not found with selector: ${fileInputSelector}`);
  }

  try {
    // Fetch images and convert to File objects
    const files = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      if (!url) {
        console.warn(`[Content] ⚠ Image ${i + 1} URL is empty`);
        continue;
      }

      console.log(`[Content] Fetching image ${i + 1}/${imageUrls.length}: ${url.substring(0, 80)}...`);

      try {
        // Fetch the image with cors mode (no credentials to avoid CORS rejection)
        const response = await fetch(url, {
          mode: 'cors'
        });

        if (!response.ok) {
          console.warn(`[Content] ⚠ Failed to fetch image ${i + 1}: HTTP ${response.status}`);
          continue;
        }

        const blob = await response.blob();
        if (blob.size === 0) {
          console.warn(`[Content] ⚠ Image ${i + 1} blob is empty`);
          continue;
        }

        // Determine proper MIME type
        let mimeType = blob.type || 'image/jpeg';
        if (!mimeType.startsWith('image/')) {
          mimeType = 'image/jpeg';
        }

        const filename = `photo_${i + 1}.jpg`;
        const file = new File([blob], filename, { type: mimeType });

        files.push(file);
        console.log(`[Content] ✓ Image ${i + 1} fetched: ${filename} (${(blob.size / 1024).toFixed(2)}KB, ${mimeType})`);
      } catch (err) {
        console.warn(`[Content] ⚠ Error fetching image ${i + 1}: ${err.message}`);
        continue;
      }
    }

    if (files.length === 0) {
      console.warn('[Content] ⚠ Could not fetch any images successfully');
      return;
    }

    console.log(`[Content] Successfully fetched ${files.length}/${imageUrls.length} images`);

    // Inject files into the file input using DataTransfer
    try {
      const dt = new DataTransfer();
      files.forEach((file) => dt.items.add(file));

      // Set the files on the input
      fileInput.files = dt.files;
      console.log(`[Content] ✓ Set ${files.length} files on input element`);

      // Trigger events to notify React/Vue about file change
      fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event('drop', { bubbles: true, composed: true }));

      console.log(`[Content] ✓ Injected ${files.length} images into file input (files on input: ${fileInput.files.length})`);

      await delay(1500);
      return;
    } catch (injectionErr) {
      console.error('[Content] ✗ DataTransfer injection failed:', injectionErr.message);
      throw new Error(`Failed to inject images: ${injectionErr.message}`);
    }
  } catch (err) {
    console.error('[Content] Image upload error:', err.message);
    // Don't throw - image upload is not critical for publishing
    console.warn('[Content] ⚠ Image upload failed, but continuing with form submission');
  }
}

/**
 * TASK: login_vinted
 * Payload: { username, password }
 *
 * Logs into Vinted by filling the login form directly.
 * Handles both initial login and 2FA verification if required.
 */
async function executeLoginVinted(payload) {
  const { username, password } = payload;

  if (!username || !password) {
    throw new Error('Missing required fields: username, password');
  }

  console.log('[Content] Executing Vinted login...');

  try {
    // Check if we're on the login page
    const currentUrl = window.location.href;
    console.log('[Content] Current URL:', currentUrl);

    // If not on login page, save task to sessionStorage and navigate
    if (!currentUrl.includes('/member/signup') && !currentUrl.includes('/member/login')) {
      console.log('[Content] Not on login page, saving task and navigating...');

      // Save the login task to sessionStorage so it persists after navigation
      sessionStorage.setItem('scalency_pending_login', JSON.stringify({
        username: username,
        password: password
      }));

      // Navigate to login page
      window.location.href = 'https://www.vinted.com/member/signup/select_type';

      // Script will be paused here during page navigation
      await delay(3000);
      return; // This won't actually execute since page is navigating
    }

    console.log('[Content] Already on login page, proceeding with form fill...');

    // Wait for page to fully render
    await delay(1500);

    // Click "Or log in with email" link to reveal the form
    let emailLink = document.querySelector('[data-testid="auth-select-type--login-email"]');

    if (!emailLink) {
      // Try to find by text content - look for clickable element with "email"
      const allElements = document.querySelectorAll('span, a, button, div[role="button"]');
      for (const el of allElements) {
        const text = el.textContent.toLowerCase();
        if (text.includes('email') && text.length < 100) {
          emailLink = el;
          break;
        }
      }
    }

    if (emailLink) {
      console.log('[Content] Found and clicking "log in with email" link');
      emailLink.click();
      await delay(1500); // Wait for form to appear
    } else {
      console.warn('[Content] Email link not found, form might already be visible');
    }

    // Find and fill username field
    let usernameInput = document.querySelector('input[id="username"], input[name="username"]');

    if (!usernameInput) {
      const allInputs = document.querySelectorAll('input[type="text"]');
      for (const input of allInputs) {
        if (input.placeholder && input.placeholder.includes('Username')) {
          usernameInput = input;
          break;
        }
      }
    }

    if (!usernameInput) {
      throw new Error('Username field not found');
    }

    console.log('[Content] ✓ Found username field, filling with:', username);
    usernameInput.value = username;
    usernameInput.focus();
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
    usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(500);

    // Find and fill password field
    let passwordInput = document.querySelector('input[id="password"], input[name="password"]');

    if (!passwordInput) {
      const allInputs = document.querySelectorAll('input[type="password"]');
      if (allInputs.length > 0) {
        passwordInput = allInputs[0];
      }
    }

    if (!passwordInput) {
      throw new Error('Password field not found');
    }

    console.log('[Content] ✓ Found password field, filling...');
    passwordInput.value = password;
    passwordInput.focus();
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(500);

    // Find and click submit button
    let submitButton = document.querySelector('button[type="submit"]');

    if (!submitButton) {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('continue') || text.includes('log in')) {
          submitButton = btn;
          break;
        }
      }
    }

    if (!submitButton) {
      throw new Error('Submit button not found');
    }

    console.log('[Content] ✓ Found submit button, clicking...');
    submitButton.click();

    // Wait for page to redirect (login processing)
    await delay(5000);

    // Check if we're on a 2FA verification page
    const is2FAPage = document.textContent.includes('Verify your activity') ||
                      document.textContent.includes('verify your activity') ||
                      document.querySelector('input[placeholder*="code" i]') !== null ||
                      document.querySelector('input[placeholder*="digit" i]') !== null ||
                      document.querySelector('input[inputmode="numeric"]') !== null;

    console.log(`[Content] Checking for 2FA page... is2FAPage=${is2FAPage}`);

    if (is2FAPage) {
      console.log('[Content] 🔐 2FA verification page DETECTED');
      const verificationCode = await wait2FACode();

      if (!verificationCode) {
        throw new Error('2FA verification timed out - no code received from user');
      }

      console.log('[Content] ✓ Received verification code from frontend, filling form...');
      await fill2FAVerification(verificationCode);

      // Wait for 2FA to complete and redirect
      console.log('[Content] Waiting for 2FA completion...');
      await delay(3000);
    }

    // Check if login was successful
    const isBrowsingPage = !window.location.href.includes('/member/');
    const hasError = document.querySelector('[class*="error"]') !== null;

    if (isBrowsingPage && !hasError) {
      console.log('[Content] ✓ Login successful! Redirected to:', window.location.href);
      return {
        status: 'success',
        result: {
          message: 'Login successful',
          url: window.location.href
        }
      };
    } else {
      throw new Error(`Login failed or still on login page. Current URL: ${window.location.href}`);
    }
  } catch (error) {
    console.error('[Content] Login error:', error.message);
    return {
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Wait for user to provide 2FA verification code via sessionStorage
 * Sets a flag so frontend knows 2FA is required
 * Times out after 5 minutes
 */
async function wait2FACode(timeoutMs = 300000) {
  console.log('[Content] Waiting for 2FA code from user (timeout: 5 minutes)...');

  // Signal to frontend that 2FA is required
  sessionStorage.setItem('scalency_2fa_waiting', 'true');
  console.log('[Content] Set 2FA flag for frontend');

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const code = sessionStorage.getItem('scalency_2fa_code');
    if (code) {
      console.log('[Content] ✓ Received 2FA code from frontend');
      sessionStorage.removeItem('scalency_2fa_code'); // Clean up
      sessionStorage.removeItem('scalency_2fa_waiting'); // Clean up flag
      return code;
    }

    await delay(500);
  }

  console.warn('[Content] 2FA code timeout - user did not provide code in time');
  sessionStorage.removeItem('scalency_2fa_waiting'); // Clean up flag
  return null;
}

/**
 * Fill and submit 2FA verification form
 */
async function fill2FAVerification(code) {
  try {
    console.log('[Content] Starting 2FA form fill with code:', code);

    // Find the code input field - try multiple strategies
    let codeInput = null;

    // Strategy 1: Search by placeholder
    codeInput = document.querySelector('input[placeholder*="code" i]') ||
                document.querySelector('input[placeholder*="digit" i]') ||
                document.querySelector('input[placeholder*="enter" i]');

    // Strategy 2: Search by type and maxlength
    if (!codeInput) {
      codeInput = document.querySelector('input[type="text"][maxlength="4"]') ||
                  document.querySelector('input[type="number"][maxlength="4"]');
    }

    // Strategy 3: Search by inputmode
    if (!codeInput) {
      codeInput = document.querySelector('input[inputmode="numeric"]');
    }

    // Strategy 4: Search by aria-label
    if (!codeInput) {
      const allInputs = document.querySelectorAll('input[type="text"], input[type="number"]');
      for (const input of allInputs) {
        const placeholder = input.placeholder?.toLowerCase() || '';
        const ariaLabel = input.getAttribute('aria-label')?.toLowerCase() || '';
        const ariaPlaceholder = input.getAttribute('aria-placeholder')?.toLowerCase() || '';

        if (placeholder.includes('code') || placeholder.includes('digit') ||
            ariaLabel.includes('code') || ariaLabel.includes('digit') ||
            ariaPlaceholder.includes('code') || ariaPlaceholder.includes('digit')) {
          codeInput = input;
          break;
        }
      }
    }

    if (!codeInput) {
      console.error('[Content] ✗ 2FA code input field not found');
      throw new Error('2FA code input field not found');
    }

    console.log('[Content] ✓ Found 2FA code input, filling with code...');
    codeInput.value = code;
    codeInput.focus();

    // Trigger all necessary events for React/Vue to register the change
    codeInput.dispatchEvent(new Event('input', { bubbles: true }));
    codeInput.dispatchEvent(new Event('change', { bubbles: true }));
    codeInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    await delay(300);

    // Try to check "Remember this device" checkbox
    let rememberCheckbox = document.querySelector('input[type="checkbox"]');

    if (rememberCheckbox && !rememberCheckbox.checked) {
      console.log('[Content] ✓ Checking "Remember this device" checkbox...');
      rememberCheckbox.click();
      await delay(300);
    }

    // Find and click Verify button - try multiple strategies
    let verifyButton = null;

    // Strategy 1: By data-testid
    verifyButton = document.querySelector('button[data-testid*="verify" i]');

    // Strategy 2: By text content
    if (!verifyButton) {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('verify') || text.includes('confirm')) {
          verifyButton = btn;
          break;
        }
      }
    }

    if (!verifyButton) {
      console.error('[Content] ✗ Verify button not found');
      throw new Error('Verify button not found');
    }

    console.log('[Content] ✓ Found verify button, clicking...');
    verifyButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(200);
    verifyButton.click();

    console.log('[Content] ✓ 2FA verification submitted');

  } catch (error) {
    console.error('[Content] Error during 2FA verification:', error.message);
    throw error;
  }
}

/**
 * TASK: send_message
 * Payload: { user_id, message, catalog_id? }
 *
 * Sends a direct message to a user via Vinted's messaging system.
 */
async function executeSendMessage(payload) {
  console.log('[Content] send_message:', payload);
  const { user_id, message, catalog_id } = payload;

  if (!user_id || !message) {
    throw new Error('Missing required fields: user_id, message');
  }

  try {
    // Navigate to user profile or chat
    const profileUrl = `${window.location.origin}/member/${user_id}`;

    if (!window.location.href.includes(`/member/${user_id}`) && !window.location.href.includes('/messages')) {
      console.log(`[Content] Navigating to ${profileUrl}`);
      window.location.href = profileUrl;
      await delay(3000); // Wait for page load
    }

    // Try to find and click "Message" button
    let messageButton = await waitForElement([
      '[data-testid="user-card-message-button"]',
      'button[class*="message"]',
      '[aria-label*="message" i]',
    ], 5000);

    // If still not found, search by text content
    if (!messageButton) {
      messageButton = findElementByText(['Message', 'Send Message'], 'button');
    }

    console.log('[Content] Found message button, clicking...');
    await click(messageButton);
    await delay(1000); // Wait for chat UI to open

    // Find message input and type message
    const messageInput = await waitForElement([
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="type" i]',
      'input[placeholder*="message" i]',
      '[class*="input"][class*="message"]',
    ], 5000);

    console.log('[Content] Found message input, typing...');
    await typeInto(messageInput, message);
    await delay(500);

    // Find and click send button
    const sendButton = await waitForElement([
      'button:has-text("Send")',
      'button[aria-label*="send" i]',
      '[data-testid="send-button"]',
      'button[class*="send"]',
    ], 5000);

    console.log('[Content] Found send button, clicking...');
    await click(sendButton);
    await delay(1000);

    // Verify message was sent
    console.log(`[Content] Message sent to user ${user_id}`);
    return {
      sent: true,
      user_id,
      message_preview: message.substring(0, 100),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(`Failed to send message: ${error.message}`);
  }
}

/**
 * Wait for form to be fully loaded and rendered
 */
async function waitForFormToLoad(maxWaitMs = 10000) {
  console.log('[Content] Waiting for form to load...');
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    // Check if key form fields are present
    const titleField = document.querySelector('input[name="title"], #title');
    const descField = document.querySelector('textarea[name="description"], #description');
    const priceField = document.querySelector('input[name="price"], #price');
    const categoryField = document.querySelector('input[name="category"], #category');

    if (titleField && descField && priceField && categoryField) {
      console.log('[Content] ✓ Form elements detected, form is ready!');
      return true;
    }

    // Wait a bit before trying again
    await delay(500);
  }

  console.warn('[Content] ⚠ Form elements not found after', maxWaitMs, 'ms');
  return false;
}

/**
 * TASK: publish_listing
 * Payload: { title, description, price, category, brand?, size?, condition?, photos_urls? }
 *
 * Publishes a new listing on the /sell page.
 */
async function executePublishListing(payload) {
  console.log('[Content] publish_listing:', payload);
  const { title, description, price, category, brand, size, condition, color, material, photos_urls } = payload;

  if (!title || !description || !price) {
    throw new Error('Missing required fields: title, description, price');
  }

  try {
    // Navigate to /items/new page if not already there
    if (!window.location.pathname.includes('/items/new')) {
      console.log('[Content] Navigating to /items/new page...');

      // Save the task to sessionStorage so it persists after navigation
      sessionStorage.setItem('scalency_pending_task', JSON.stringify(payload));
      console.log('[Content] Saved task to sessionStorage for execution after navigation');

      window.location.href = `${window.location.origin}/items/new`;
      // Stop execution - task will resume on new page
      return;
    }

    // If we get here, we're already on /items/new or just navigated here
    // Remove pending task from storage (we're about to execute it)
    sessionStorage.removeItem('scalency_pending_task');

    // Step 1: INSPECT & DETECT FORM FIELDS
    console.log('[Content] ===== FORM INSPECTION STARTING =====');
    const formFields = await detectFormFields();
    console.log('[Content] Detected form fields:', formFields);

    if (!formFields.title || !formFields.description || !formFields.price) {
      throw new Error('Could not detect all required form fields. Detected: ' + JSON.stringify(formFields));
    }

    // Step 2: FILL FORM FIELDS using detected selectors
    console.log('[Content] ===== FILLING FORM FIELDS =====');

    // Fill title
    console.log(`[Content] Filling title: "${title}"`);
    const titleEl = document.querySelector(formFields.title);
    if (!titleEl) throw new Error(`Title element not found with selector: ${formFields.title}`);
    titleEl.value = title;
    titleEl.focus();
    titleEl.dispatchEvent(new Event('input', { bubbles: true }));
    titleEl.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(300);
    console.log('[Content] ✓ Title filled:', titleEl.value);

    // Fill description
    console.log(`[Content] Filling description...`);
    const descEl = document.querySelector(formFields.description);
    if (!descEl) throw new Error(`Description element not found with selector: ${formFields.description}`);
    descEl.value = description;
    descEl.focus();
    descEl.dispatchEvent(new Event('input', { bubbles: true }));
    descEl.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(300);
    console.log('[Content] ✓ Description filled:', descEl.value.substring(0, 50) + '...');

    // Fill price - TEXT field (Vinted uses a currency formatter)
    console.log(`[Content] Filling price: €${price}`);
    const priceEl = document.querySelector(formFields.price);
    if (!priceEl) throw new Error(`Price element not found with selector: ${formFields.price}`);

    // Parse price as number
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) {
      throw new Error(`Invalid price value: ${price}`);
    }

    // Use native property descriptor to bypass React's controlled component
    const nativeSetValue = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(priceEl),
      'value'
    )?.set;

    if (nativeSetValue) {
      nativeSetValue.call(priceEl, numPrice.toString());
      console.log(`[Content] Set price via native descriptor: ${numPrice}`);
    } else {
      priceEl.value = numPrice.toString();
      console.log(`[Content] Set price via direct assignment: ${numPrice}`);
    }

    // Focus and trigger input events
    priceEl.focus();

    // Dispatch multiple events to trigger React's onChange handling
    const inputEvent = new Event('input', { bubbles: true, composed: true });
    priceEl.dispatchEvent(inputEvent);

    await delay(100);

    const changeEvent = new Event('change', { bubbles: true, composed: true });
    priceEl.dispatchEvent(changeEvent);

    await delay(100);

    // Try keydown/keyup sequence
    const keydownEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true });
    priceEl.dispatchEvent(keydownEvent);

    const keyupEvent = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, composed: true });
    priceEl.dispatchEvent(keyupEvent);

    await delay(200);

    // Blur to finalize
    const blurEvent = new Event('blur', { bubbles: true });
    priceEl.dispatchEvent(blurEvent);

    await delay(400);

    console.log('[Content] ✓ Price field value set to:', priceEl.value);
    console.log('[Content] Price formatted display:', priceEl.parentElement?.textContent?.substring(0, 20));

    // Fill category if provided and detected
    if (category && formFields.category) {
      console.log(`[Content] Selecting category: "${category}"`);
      try {
        await selectCategory(category, formFields.category);
        console.log('[Content] ✓ Category selected');
      } catch (err) {
        console.warn('[Content] ⚠ Category selection failed (optional):', err.message);
      }
      await delay(300);
    } else if (!formFields.category) {
      console.warn('[Content] ⚠ Category field was NOT detected in form');
    }

    // Fill additional fields if provided
    if (brand) {
      console.log(`[Content] Attempting to fill brand: "${brand}"`);
      await tryFillDropdown('brand', brand);
    }

    if (size) {
      console.log(`[Content] Attempting to fill size: "${size}"`);
      await tryFillDropdown('size', size);
    }

    if (condition) {
      console.log(`[Content] Attempting to fill condition: "${condition}"`);
      await tryFillDropdown('condition', condition);
    }

    if (color && Array.isArray(color) && color.length > 0) {
      console.log(`[Content] Attempting to fill colors: ${color.join(', ')}`);

      // For multi-select, select all colors then close dropdown once
      const colorElement = document.querySelector('[data-testid="color-select-dropdown-input"]');
      if (colorElement) {
        colorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(300);
        colorElement.click();
        await delay(600);

        // Select each color
        for (let i = 0; i < color.length; i++) {
          const col = color[i];
          const allOptions = Array.from(document.querySelectorAll(
            'div[role="button"][tabindex="0"]'
          )).filter(opt => {
            const style = window.getComputedStyle(opt);
            return style.display !== 'none' && style.visibility !== 'hidden';
          });

          const matching = allOptions.find(opt => {
            const titleEl = opt.querySelector('.web_ui__Cell__title');
            const text = (titleEl?.textContent || opt.textContent)?.toLowerCase().trim() || '';
            return text === col.toLowerCase().trim();
          });

          if (matching) {
            console.log(`[Content] ✓ Selecting color ${i + 1}/${color.length}: ${col}`);
            matching.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await delay(200);
            matching.click();
            await delay(400);

            // Check if there are checkboxes/indicators for selected state
            const checkbox = matching.querySelector('input[type="checkbox"], input[type="radio"]');
            if (checkbox) {
              console.log(`[Content] Found checkbox for color, checked:`, checkbox.checked);
            }
          } else {
            console.warn(`[Content] ⚠ Color not found: ${col}`);
          }
        }

        // Close dropdown after all colors selected
        const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
        document.dispatchEvent(escapeEvent);
        await delay(400);

        // Check the actual input value after closing
        console.log(`[Content] Color field value after closing:`, colorElement.value);
        console.log(`[Content] Color field data attributes:`, {
          dataTestId: colorElement.getAttribute('data-testid'),
          value: colorElement.value,
          placeholder: colorElement.placeholder
        });

        // Look for hidden inputs that might store the actual values
        const hiddenInputs = document.querySelectorAll('input[type="hidden"][name*="color"], input[style*="display:none"][name*="color"]');
        if (hiddenInputs.length > 0) {
          console.log(`[Content] Found ${hiddenInputs.length} hidden color inputs:`);
          hiddenInputs.forEach((inp, idx) => {
            console.log(`  Hidden[${idx}]:`, { name: inp.name, value: inp.value });
          });
        }

        console.log(`[Content] ✓ Colors selected and dropdown closed`);
      }
    }

    if (material && Array.isArray(material) && material.length > 0) {
      console.log(`[Content] Attempting to fill materials: ${material.join(', ')}`);

      // For multi-select, select all materials then close dropdown once
      const materialElement = document.querySelector('[data-testid="category-material-multi-list-input"]');
      if (materialElement) {
        materialElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(300);
        materialElement.click();
        await delay(600);

        // Select each material
        for (let i = 0; i < material.length; i++) {
          const mat = material[i];
          const allOptions = Array.from(document.querySelectorAll(
            'div[role="button"][tabindex="0"]'
          )).filter(opt => {
            const style = window.getComputedStyle(opt);
            return style.display !== 'none' && style.visibility !== 'hidden';
          });

          const matching = allOptions.find(opt => {
            const titleEl = opt.querySelector('.web_ui__Cell__title');
            const text = (titleEl?.textContent || opt.textContent)?.toLowerCase().trim() || '';
            return text === mat.toLowerCase().trim();
          });

          if (matching) {
            console.log(`[Content] ✓ Selecting material ${i + 1}/${material.length}: ${mat}`);
            matching.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await delay(200);
            matching.click();
            await delay(400);

            // Check if there are checkboxes/indicators for selected state
            const checkbox = matching.querySelector('input[type="checkbox"], input[type="radio"]');
            if (checkbox) {
              console.log(`[Content] Found checkbox for material, checked:`, checkbox.checked);
            }
          } else {
            console.warn(`[Content] ⚠ Material not found: ${mat}`);
          }
        }

        // Close dropdown after all materials selected
        const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
        document.dispatchEvent(escapeEvent);
        await delay(400);

        // Check the actual input value after closing
        console.log(`[Content] Material field value after closing:`, materialElement.value);
        console.log(`[Content] Material field data attributes:`, {
          dataTestId: materialElement.getAttribute('data-testid'),
          value: materialElement.value,
          placeholder: materialElement.placeholder
        });

        // Look for hidden inputs that might store the actual values
        const hiddenInputs = document.querySelectorAll('input[type="hidden"][name*="material"], input[style*="display:none"][name*="material"]');
        if (hiddenInputs.length > 0) {
          console.log(`[Content] Found ${hiddenInputs.length} hidden material inputs:`);
          hiddenInputs.forEach((inp, idx) => {
            console.log(`  Hidden[${idx}]:`, { name: inp.name, value: inp.value });
          });
        }

        console.log(`[Content] ✓ Materials selected and dropdown closed`);
      }
    }

    // Handle image uploads if provided
    if (photos_urls && photos_urls.length > 0 && formFields.imageUpload) {
      console.log(`[Content] Attempting to upload ${photos_urls.length} image(s)...`);
      try {
        await uploadImages(photos_urls, formFields.imageUpload);
        console.log('[Content] ✓ Images uploaded');
      } catch (err) {
        console.warn('[Content] ⚠ Image upload failed (optional):', err.message);
      }
      await delay(1000);
    } else if (!formFields.imageUpload) {
      console.warn('[Content] ⚠ No image upload field detected - will require manual upload');
    } else {
      console.warn('[Content] ⚠ No images provided in task payload');
    }

    // Look for Upload button
    await delay(500);
    const uploadButton = document.querySelector('button[data-testid="upload-form-save-button"]');
    if (!uploadButton) {
      console.error('[Content] Upload button not found!');
      console.log('[Content] Available buttons:', document.querySelectorAll('button').length);
      throw new Error('Upload button not found');
    }

    // Log current form state before submission
    console.log('[Content] ===== PRE-SUBMISSION STATE =====');
    const titleElCheck = document.querySelector(formFields.title);
    const descElCheck = document.querySelector(formFields.description);
    const priceElCheck = document.querySelector(formFields.price);
    const categoryElCheck = formFields.category ? document.querySelector(formFields.category) : null;

    console.log('[Content] Form values:');
    console.log(`  Title: "${titleElCheck?.value}"`);
    console.log(`  Description: "${descElCheck?.value?.substring(0, 50)}..."`);
    console.log(`  Price: "${priceElCheck?.value}"`);
    console.log(`  Category: "${categoryElCheck?.value}"`);
    console.log('[Content] =============================');

    console.log('[Content] Found upload button, clicking...');

    // Intercept API responses to catch errors
    const originalFetch = window.fetch;
    let submissionError = null;

    window.fetch = function(...args) {
      const result = originalFetch.apply(this, args);

      // Check if this is the item upload endpoint
      const url = args[0]?.toString() || '';
      if (url.includes('/api/v2/item_upload/items')) {
        console.log('[Content] Intercepted item upload request:', url);
        result.then(response => {
          console.log('[Content] Item upload response status:', response.status);
          if (!response.ok) {
            submissionError = `API rejected submission: ${response.status}`;
            console.error('[Content] ' + submissionError);
          }
          return response;
        }).catch(err => {
          submissionError = `API request failed: ${err.message}`;
          console.error('[Content] ' + submissionError);
        });
      }

      return result;
    };

    await click(uploadButton);

    // Wait for submission and error check
    await delay(1000);
    window.fetch = originalFetch; // Restore original

    if (submissionError) {
      console.warn(`[Content] ⚠ Submission had issues: ${submissionError}`);
    }

    await delay(2000); // Wait for confirmation/redirect

    // Try to extract listing ID from URL or success page
    const listing_id = await extractListingId();

    console.log(`[Content] Listing published successfully`);
    return {
      published: true,
      listing_id: listing_id || `vinted_${Date.now()}`,
      title,
      price,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(`Failed to publish listing: ${error.message}`);
  }
}

/**
 * TASK: bump_listing
 * Payload: { listing_id, catalog_id? }
 *
 * Bumps/refreshes a listing to move it to the top of the feed.
 */
async function executeBumpListing(payload) {
  console.log('[Content] bump_listing:', payload);
  const { listing_id, catalog_id } = payload;

  if (!listing_id) {
    throw new Error('Missing required field: listing_id');
  }

  try {
    // Navigate to listing page
    const listingUrl = `${window.location.origin}/items/${listing_id}`;

    if (!window.location.href.includes(`/items/${listing_id}`)) {
      console.log(`[Content] Navigating to listing: ${listingUrl}`);
      window.location.href = listingUrl;
      await delay(3000); // Wait for page load
    }

    // Wait for page to fully load
    await waitForPageLoad();

    // Find bump/refresh button - look for common button patterns
    let bumpButton = await waitForElement([
      '[data-testid*="bump"]',
      '[aria-label*="bump" i]',
      'button[class*="bump"]',
      'button[class*="refresh"]',
    ], 5000);

    // If still not found, search by text content
    if (!bumpButton) {
      bumpButton = findElementByText(['Bump', 'Refresh', 'Promote', 'Re-list'], 'button');
    }

    if (!bumpButton.enabled !== false) {
      throw new Error('Bump button is disabled (already bumped recently?)');
    }

    console.log('[Content] Found bump button, clicking...');
    await click(bumpButton);
    await delay(2000); // Wait for success message

    // Look for success toast/confirmation
    const successToast = document.querySelector('[class*="toast" i], [class*="notification" i]');
    if (!successToast) {
      console.log('[Content] Warning: Could not confirm bump success');
    }

    console.log(`[Content] Listing bumped successfully`);
    return {
      bumped: true,
      listing_id,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(`Failed to bump listing: ${error.message}`);
  }
}

/**
 * TASK: follow_user
 * Payload: { user_id, catalog_id? }
 *
 * Follow a user on Vinted.
 */
async function executeFollowUser(payload) {
  try {
    const { user_id } = payload;

    if (!user_id) {
      throw new Error('Missing required field: user_id');
    }

    // Navigate to user profile
    const profileUrl = `${window.location.origin}/user/${user_id}`;
    window.history.pushState({}, '', profileUrl);
    window.location.href = profileUrl;
    await delay(3000); // Wait for page load

    // Find and click follow button
    let followButton = await waitForElement([
      'button[aria-label*="follow" i]',
      '[class*="button"][aria-label*="follow"]',
      'button[class*="follow"]',
    ], 5000);

    // If still not found, search by text
    if (!followButton) {
      followButton = findElementByText(['Follow', 'Follow User'], 'button');
    }

    if (!followButton) {
      throw new Error('Follow button not found on user profile');
    }

    console.log('[Content] Found follow button, clicking...');
    await click(followButton);
    await delay(1000);

    console.log(`[Content] User ${user_id} followed successfully`);
    return {
      followed: true,
      user_id,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(`Failed to follow user: ${error.message}`);
  }
}

/**
 * TASK: search_listings
 * Payload: { search_query, filters? {category, price_min, price_max, condition}, max_results }
 *
 * Search Vinted listings and return listing IDs found.
 */
async function executeSearchListings(payload) {
  try {
    const { search_query, filters = {}, max_results = 50 } = payload;

    if (!search_query) {
      throw new Error('Missing required field: search_query');
    }

    // Navigate to search page
    const searchUrl = `${window.location.origin}/catalog?search_text=${encodeURIComponent(search_query)}`;
    window.history.pushState({}, '', searchUrl);
    window.location.href = searchUrl;
    await delay(3000); // Wait for results

    // Extract listing IDs from search results
    const listingElements = document.querySelectorAll('[class*="item"][class*="card"], a[href*="/items/"]');
    const listingIds = [];

    for (const element of listingElements) {
      if (listingIds.length >= max_results) break;

      const href = element.href || element.parentElement?.href;
      const match = href?.match(/\/items\/(\d+)/);
      if (match) {
        listingIds.push(match[1]);
      }
    }

    console.log(`[Content] Found ${listingIds.length} listings`);
    return {
      search_query,
      found_count: listingIds.length,
      listing_ids: listingIds.slice(0, max_results),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(`Failed to search listings: ${error.message}`);
  }
}

/**
 * TASK: scrape_data
 * Payload: { listing_id, data_fields: ['title', 'price', 'description', 'condition', 'size'] }
 *
 * Scrape listing details from a specific listing.
 */
async function executeScrapeData(payload) {
  try {
    const { listing_id, data_fields = ['title', 'price', 'description'] } = payload;

    if (!listing_id) {
      throw new Error('Missing required field: listing_id');
    }

    // Navigate to listing page
    const listingUrl = `${window.location.origin}/items/${listing_id}`;
    window.history.pushState({}, '', listingUrl);
    window.location.href = listingUrl;
    await delay(3000); // Wait for page load

    const scrapedData = { listing_id };

    // Extract data based on requested fields
    if (data_fields.includes('title')) {
      const titleEl = document.querySelector('h1, [class*="title"]');
      if (titleEl) scrapedData.title = titleEl.textContent.trim();
    }

    if (data_fields.includes('price')) {
      const priceEl = document.querySelector('[class*="price"], [data-test*="price"]');
      if (priceEl) scrapedData.price = priceEl.textContent.trim();
    }

    if (data_fields.includes('description')) {
      const descEl = document.querySelector('[class*="description"], [class*="details"]');
      if (descEl) scrapedData.description = descEl.textContent.trim().substring(0, 500);
    }

    if (data_fields.includes('condition')) {
      const conditionEl = document.querySelector('[class*="condition"], [aria-label*="condition" i]');
      if (conditionEl) scrapedData.condition = conditionEl.textContent.trim();
    }

    if (data_fields.includes('size')) {
      const sizeEl = document.querySelector('[class*="size"], [aria-label*="size" i]');
      if (sizeEl) scrapedData.size = sizeEl.textContent.trim();
    }

    console.log(`[Content] Scraped data from listing ${listing_id}`);
    return {
      ...scrapedData,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(`Failed to scrape listing: ${error.message}`);
  }
}

/**
 * Find element by CSS selector with fallback list
 */
async function findElementBySelector(selectors, timeout = 5000) {
  if (typeof selectors === 'string') {
    selectors = [selectors];
  }

  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        console.log(`[Content] Found element: ${selector}`);
        return el;
      }
    } catch (e) {
      // Invalid selector, try next
    }
  }

  return null;
}

/**
 * Find element by text content (for buttons, links, etc.)
 * @param {string|string[]} textPatterns - Text to search for (can be array of alternatives)
 * @param {string} tagName - Optional tag name to filter (e.g. "button", "a")
 * @returns {HTMLElement|null}
 */
function findElementByText(textPatterns, tagName = '*') {
  if (typeof textPatterns === 'string') {
    textPatterns = [textPatterns];
  }

  const elements = document.querySelectorAll(tagName);
  for (const el of elements) {
    const text = el.textContent.trim().toUpperCase();
    for (const pattern of textPatterns) {
      if (text.includes(pattern.toUpperCase())) {
        console.log(`[Content] Found element by text: "${pattern}"`);
        return el;
      }
    }
  }
  return null;
}

/**
 * Wait for element to appear (with fallback selectors)
 */
async function waitForElement(selectors, timeout = 5000) {
  if (typeof selectors === 'string') {
    selectors = [selectors];
  }

  const start = Date.now();

  while (Date.now() - start < timeout) {
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) { // Check if visible
          console.log(`[Content] Found element: ${selector}`);
          return el;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    await delay(200);
  }

  throw new Error(`Element not found after ${timeout}ms. Tried: ${selectors.join(', ')}`);
}

/**
 * Try to select a category from dropdown
 */
async function trySelectCategory(category) {
  try {
    // Find category dropdown/select
    const categorySelect = await findElementBySelector([
      'select[name*="category"]',
      '[data-testid*="category"]',
      'input[placeholder*="category" i]',
    ], 2000);

    if (!categorySelect) return;

    // If it's a select element
    if (categorySelect.tagName === 'SELECT') {
      const option = Array.from(categorySelect.options).find(
        (o) => o.textContent.toLowerCase().includes(category.toLowerCase())
      );
      if (option) {
        categorySelect.value = option.value;
        categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  } catch (e) {
    console.log(`[Content] Could not select category: ${e.message}`);
  }
}

/**
 * Extract listing ID from page (URL or success page)
 */
async function extractListingId() {
  // Try to get from URL
  const match = window.location.href.match(/items\/(\d+)/);
  if (match) return match[1];

  // Try to find in success message or result
  const successElement = document.querySelector('[class*="success"], [class*="confirm"]');
  if (successElement) {
    const idMatch = successElement.textContent.match(/(\d+)/);
    if (idMatch) return idMatch[1];
  }

  return null;
}

/**
 * Type text into input (simulating user typing)
 */
async function typeInto(input, text) {
  if (!input) throw new Error('Input element not found');

  input.focus();
  input.value = ''; // Clear first

  const charDelay = 30; // ms between keystrokes

  for (const char of text) {
    input.value += char;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await delay(charDelay);
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Click element (with scroll into view)
 */
async function click(element) {
  if (!element) throw new Error('Element not found');

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await delay(200);

  element.click();
  await delay(100);
}

/**
 * Wait for page to fully load
 */
async function waitForPageLoad() {
  if (document.readyState === 'complete') {
    return;
  }

  return new Promise((resolve) => {
    window.addEventListener('load', resolve, { once: true });
  });
}

/**
 * Sleep helper
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
