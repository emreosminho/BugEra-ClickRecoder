// Helper utilities for selector and xpath generation

// Returns an XPath that uniquely identifies the element in the DOM.
function getElementXPath(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';

  // If element has an ID, prefer it for a short and stable XPath
  if (element.id) {
    return `//*[@id="${cssEscapeAttributeValue(element.id)}"]`;
  }

  const segments = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
    const tagName = current.tagName.toLowerCase();
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    const segment = `${tagName}[${index}]`;
    segments.unshift(segment);
    current = current.parentElement;
  }
  return `/${segments.join('/')}`;
}

// Returns a CSS selector that uniquely identifies the element.
function getElementCssSelector(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';

  // Prefer ID if available
  if (element.id) {
    return `#${cssEscapeIdentifier(element.id)}`;
  }

  // Prefer meaningful attributes when present
  const attributePriority = ['name', 'data-testid', 'data-test', 'aria-label', 'role'];
  for (const attr of attributePriority) {
    const value = element.getAttribute && element.getAttribute(attr);
    if (value) {
      return `${element.tagName.toLowerCase()}[${attr}="${cssEscapeAttributeValue(value)}"]`;
    }
  }

  // Build a robust path
  const path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const classList = Array.from(current.classList || [])
      .filter(cls => !!cls)
      .slice(0, 3); // limit to first 3 classes to avoid overly long selectors
    let selector = tag;
    if (classList.length > 0) {
      selector += classList.map(cls => `.${cssEscapeIdentifier(cls)}`).join('');
    }

    const parent = current.parentElement;
    if (parent) {
      // Ensure uniqueness within parent
      let localSelector = selector;
      let matches = Array.from(parent.querySelectorAll(localSelector));
      if (matches.length === 0) {
        // Fallback if class names cause no match (e.g., SVG or special elements)
        localSelector = tag;
        matches = Array.from(parent.querySelectorAll(localSelector));
      }
      if (matches.length > 1) {
        const index = Array.from(parent.children).indexOf(current) + 1; // nth-child is 1-based
        selector = `${localSelector}:nth-child(${index})`;
      } else {
        selector = localSelector;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  let finalSelector = path.join(' > ');
  if (!finalSelector) {
    // As a last resort, return tag name
    finalSelector = (element.tagName || 'div').toLowerCase();
  }
  return finalSelector;
}

function clipText(text, maxLength = 50) {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

// Basic CSS identifier escaper (not full CSS.escape polyfill, but adequate for ids/classes)
function cssEscapeIdentifier(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, match => `\\${match}`);
}

// Escape attribute values for XPath usage
function cssEscapeAttributeValue(value) {
  return String(value).replace(/"/g, '\\"');
}

// Expose in global scope for content script consumption
window.ClickUtils = {
  getElementXPath,
  getElementCssSelector,
  clipText
};


