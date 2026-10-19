/**
 * The renderer's whole DOM layer.
 *
 * Both pages build elements and attach listeners through these four helpers so
 * that markup stays in one idiom and the CSP can forbid inline handlers. This
 * module is deliberately tiny: it knows nothing about the timer or settings.
 */

/**
 * Create an element.
 *
 * Supported props: `class`, `text`, `dataset` (object), `style` (object of CSS
 * property names), `html` (trusted static markup only) and any other attribute.
 *
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {Array<Node | string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [property, styleValue] of Object.entries(value)) {
        setStyle(node, property, styleValue);
      }
    } else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Attach a listener and return the function that removes it.
 *
 * @param {EventTarget | null} target
 * @param {string} type
 * @param {(event: any) => void} handler
 * @param {boolean | AddEventListenerOptions} [options]
 * @returns {() => void}
 */
export function on(target, type, handler, options) {
  if (!target) return () => {};
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/**
 * Set text content only when it changed, so a 1 Hz paint does not touch the
 * DOM for an unchanged value.
 *
 * @param {Element | null} node
 * @param {string} value
 */
export function text(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

/**
 * Set one CSS custom property or style property.
 *
 * @param {HTMLElement | SVGElement | null} node
 * @param {string} property
 * @param {string | number} value
 */
export function setStyle(node, property, value) {
  if (node && node.style) node.style.setProperty(property, String(value));
}
