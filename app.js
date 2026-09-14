(() => {
  'use strict';
  const menu = document.getElementById('mobile-nav');
  const toggle = document.querySelector('.menu-toggle');
  const setMenu = (open, returnFocus = false) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    if (returnFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => setMenu(menu.hidden));
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) setMenu(false, true); });
  document.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('.site-header')) setMenu(false); });
  const desktop = matchMedia('(min-width:821px)');
  desktop.addEventListener('change', event => { if (event.matches) setMenu(false); });

  const filters = [...document.querySelectorAll('[data-filter]')];
  const projects = [...document.querySelectorAll('[data-category]')];
  filters.forEach(button => button.addEventListener('click', () => {
    const category = button.dataset.filter;
    filters.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    let count = 0;
    projects.forEach(project => {
      project.hidden = category !== 'all' && project.dataset.category !== category;
      if (!project.hidden) count++;
    });
    document.getElementById('filter-status').textContent = `Showing ${count} ${category === 'all' ? '' : category === 'backend' ? 'backend ' : 'ML and research '}project${count === 1 ? '' : 's'}`;
  }));

  const palette = ['#243019','#3c5228','#5f7f37','#789c47','#9cc950','#bfec68','#d9f6a8'];
  document.querySelectorAll('.pixel-grid').forEach(grid => {
    const scrambled = grid.classList.contains('scrambled');
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const pixel = document.createElement('i');
      const distance = Math.hypot(x - 3, y - 3);
      const index = scrambled ? (x * 13 + y * 19 + x * y * 5) % palette.length : Math.max(0, 6 - Math.floor(distance * 1.8));
      pixel.style.setProperty('--pixel-color', palette[index]);
      grid.append(pixel);
    }
  });

  const copy = document.getElementById('copy-email');
  const copyStatus = document.getElementById('copy-status');
  let feedbackTimer;
  copy.addEventListener('click', async () => {
    const email = 'ritviksharmacse@gmail.com';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(email);
      copyStatus.textContent = 'Email address copied.';
      copy.textContent = 'Copied ✓';
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => { copy.textContent = 'Copy ⧉'; copyStatus.textContent = ''; }, 3500);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('.email-link'));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copyStatus.textContent = 'Email selected. Press Ctrl+C (or Cmd+C) to copy.';
    }
  });

  document.getElementById('year').textContent = new Date().getFullYear();
  const clock = document.getElementById('local-time');
  const updateTime = () => {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = new Intl.DateTimeFormat('en-IN', { timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true }).format(now).toUpperCase();
  };
  updateTime();
  setInterval(updateTime, 60000);
})();
