const normalizeSelectSearch = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

function enableSelectSearch(select, label) {
  if (select.dataset.searchEnabled) return;
  select.dataset.searchEnabled = 'true';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'select-search';
  search.placeholder = 'Buscar por nombre o ID';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', `Buscar ${label}`);
  if (!select.hasAttribute('aria-label')) select.setAttribute('aria-label', label);
  const status = document.createElement('small');
  status.className = 'select-search-status';
  status.setAttribute('role', 'status');
  select.insertAdjacentElement('afterend', search);
  search.insertAdjacentElement('afterend', status);

  const originalHidden = new WeakMap();
  const filter = () => {
    const query = normalizeSelectSearch(search.value.trim());
    let matches = 0;
    for (const option of select.options) {
      if (!originalHidden.has(option)) originalHidden.set(option, option.hidden);
      const match = !query || normalizeSelectSearch(`${option.textContent} ${option.value}`).includes(query);
      if (option.value && match && !originalHidden.get(option)) matches += 1;
      option.hidden = originalHidden.get(option) || (Boolean(option.value) && !match && !option.selected);
    }
    search.disabled = select.disabled;
    status.textContent = query && !matches ? 'Sin coincidencias.' : '';
  };
  search.addEventListener('input', filter);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      select.focus();
    }
  });
  select.addEventListener('change', () => {
    search.value = '';
    filter();
  });
  const observer = new MutationObserver(filter);
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  filter();
}

let searchableSelectSequence = 0;

function enableSearchableSelect(select, label) {
  if (select.dataset.comboboxEnabled) return;
  select.dataset.comboboxEnabled = 'true';
  const wrapper = select.closest('label');
  const input = document.createElement('input');
  const list = document.createElement('div');
  const inputId = `searchable-select-${++searchableSelectSequence}`;
  const listId = `${inputId}-options`;
  const required = select.required;
  input.type = 'text';
  input.id = inputId;
  input.placeholder = 'Buscar por nombre o ID';
  input.autocomplete = 'off';
  input.required = select.required;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', label);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('aria-expanded', 'false');
  wrapper.htmlFor = input.id;
  list.id = listId;
  list.className = 'searchable-select-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  list.hidden = true;
  select.required = false;
  select.hidden = true;
  select.insertAdjacentElement('afterend', input);
  input.insertAdjacentElement('afterend', list);

  let matches = [];
  let activeIndex = -1;
  let editing = false;
  const optionLabel = (option) => /^\d+$/.test(option.value)
    ? `${option.textContent} · ID ${option.value}` : option.textContent;
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };
  const sync = () => {
    if (editing) return;
    const selected = select.selectedOptions[0];
    input.value = selected && (selected.value || !required) ? optionLabel(selected) : '';
    input.disabled = select.disabled;
    input.setCustomValidity('');
    close();
  };
  const activate = (index) => {
    if (activeIndex >= 0) list.children[activeIndex].setAttribute('aria-selected', 'false');
    activeIndex = index;
    const item = list.children[activeIndex];
    item.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', item.id);
    item.scrollIntoView({ block: 'nearest' });
  };
  const choose = (option) => {
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
    close();
  };
  const open = (query = '') => {
    if (input.disabled) return;
    const normalized = normalizeSelectSearch(query.trim());
    matches = Array.from(select.options).filter((option) => (option.value || !required) && !option.disabled && !option.hidden
      && normalizeSelectSearch(`${option.textContent} ${option.value}`).includes(normalized));
    const items = matches.map((option, index) => {
      const item = document.createElement('div');
      item.id = `${listId}-${index}`;
      item.className = 'searchable-select-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.textContent = optionLabel(option);
      item.addEventListener('pointerdown', (event) => event.preventDefault());
      item.addEventListener('click', (event) => {
        event.preventDefault();
        choose(option);
      });
      return item;
    });
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'searchable-select-empty';
      empty.setAttribute('role', 'status');
      empty.textContent = 'Sin coincidencias.';
      items.push(empty);
    }
    list.replaceChildren(...items);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };
  const selectCurrentText = () => {
    const selected = select.selectedOptions[0];
    if (selected && input.value === optionLabel(selected)) input.select();
  };
  input.addEventListener('focus', () => {
    open();
    selectCurrentText();
  });
  input.addEventListener('click', () => {
    if (list.hidden) open();
    selectCurrentText();
  });
  input.addEventListener('input', () => {
    editing = true;
    if (required) select.selectedIndex = -1;
    else select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    editing = false;
    input.setCustomValidity(input.value ? 'Selecciona una opción de la lista.' : '');
    open(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!list.hidden) {
        event.preventDefault();
        close();
      }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) open();
      if (matches.length) {
        const next = event.key === 'ArrowDown'
          ? Math.min(activeIndex + 1, matches.length - 1)
          : activeIndex < 0 ? matches.length - 1 : Math.max(activeIndex - 1, 0);
        activate(next);
      }
    } else if (event.key === 'Enter' && !list.hidden) {
      event.preventDefault();
      if (activeIndex >= 0) choose(matches[activeIndex]);
    }
  });
  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget)) close();
  });
  select.addEventListener('change', sync);
  sync();
}
