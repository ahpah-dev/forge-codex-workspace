document.documentElement.classList.add('js');
const menu = document.querySelector('.menu-toggle');
const links = document.querySelector('#nav-links');
function closeMenu() { menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', 'Open navigation'); links.classList.remove('open'); }
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  links.classList.toggle('open', open);
});
links.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
document.addEventListener('click', event => { if (!event.target.closest('.nav')) closeMenu(); });
window.addEventListener('resize', () => { if (window.innerWidth > 640) closeMenu(); });

const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
  }, { threshold: 0.08 });
  reveals.forEach(element => observer.observe(element));
} else reveals.forEach(element => element.classList.add('visible'));

// Keep native disclosure semantics while animating both opening and closing.
document.querySelectorAll('.faq details').forEach(details => {
  const summary = details.querySelector('summary');
  const answer = details.querySelector('p');
  let expanded = details.open;
  let heightAnimation = null;
  let answerAnimation = null;
  details.classList.add('faq-animated');
  details.dataset.expanded = String(expanded);

  summary.addEventListener('click', event => {
    event.preventDefault();
    const startHeight = details.getBoundingClientRect().height;
    const startOpacity = details.open ? Number(getComputedStyle(answer).opacity) : 0;
    heightAnimation?.cancel();
    answerAnimation?.cancel();
    expanded = !expanded;
    details.dataset.expanded = String(expanded);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !details.animate) {
      details.open = expanded;
      return;
    }

    details.open = true;
    const endHeight = summary.offsetHeight + (expanded ? answer.offsetHeight : 0) + 1;
    const timing = { duration: 300, easing: 'cubic-bezier(.22, .61, .36, 1)', fill: 'both' };
    heightAnimation = details.animate([
      { height: `${startHeight}px` },
      { height: `${endHeight}px` },
    ], timing);
    answerAnimation = answer.animate([
      { opacity: startOpacity, transform: `translateY(${expanded ? -4 : 0}px)` },
      { opacity: expanded ? 1 : 0, transform: `translateY(${expanded ? 0 : -4}px)` },
    ], timing);
    heightAnimation.onfinish = () => {
      details.open = expanded;
      heightAnimation.cancel();
      answerAnimation.cancel();
      heightAnimation = answerAnimation = null;
    };
  });
});

// Keep direct downloads current; the shipped Windows link remains a fallback.
fetch('https://api.github.com/repos/ahpah-dev/forge-codex-workspace/releases/latest', { signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5000) : undefined })
  .then(response => { if (!response.ok) throw new Error('Release lookup unavailable'); return response.json(); })
  .then(release => {
    const installer = release.assets?.find(asset => /^Forge-Setup-[\d.]+-x64\.exe$/.test(asset.name));
    const url = installer?.browser_download_url;
    if (url && url.startsWith('https://github.com/ahpah-dev/forge-codex-workspace/releases/download/')) {
      document.querySelectorAll('.download-link').forEach(link => { link.href = url; });
      if (/^v\d+\.\d+\.\d+$/.test(release.tag_name || '')) document.querySelectorAll('.release-version').forEach(label => { label.textContent = release.tag_name; });
    }
  }).catch(() => {});
