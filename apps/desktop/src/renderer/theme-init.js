(function () {
  try {
    var t = localStorage.getItem('domainOS:theme');
    if (t !== 'dark' && t !== 'light') t = null;
  } catch (e) {
    var t = null;
  }
  if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  if (t === 'light') document.documentElement.classList.add('light');
})();
