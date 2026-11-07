// Build elements without innerHTML: every text goes through textContent, so no service text can inject markup.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function line(text, cls) {
  return h("p", { class: cls, text });
}

export function select(options, current, onchange, props = {}) {
  const el = h("select", { ...props, onchange: (e) => onchange(e.target.value) });
  for (const [value, label] of options) el.append(h("option", { value, text: label, selected: value === current }));
  return el;
}
