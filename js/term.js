/* term — article tabs, view navigation, sidebar tree, search, toc, copy, theme */
(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;
  var CLOSE_LABEL = body.getAttribute('data-close-label') || 'Close';
  var STORE = 'term-tabs-v1';
  var MAX_TABS = 8;

  /* Only articles live in the tab strip. Views (home, folders, tags, friends,
     about) replace the content area in place and never become tabs. */
  var tabs = [];
  var currentPath = norm(location.pathname);

  /* ---------------- path helpers ---------------- */
  function norm(path) {
    var p = String(path || '/');
    try { p = decodeURIComponent(p); } catch (e) { /* keep as is */ }
    p = p.split('?')[0].split('#')[0].replace(/index\.html$/, '');
    if (p.charAt(0) !== '/') p = '/' + p;
    if (p.length > 1) p = p.replace(/\/+$/, '') + '/';
    return p || '/';
  }

  function find(path) {
    for (var i = 0; i < tabs.length; i += 1) {
      if (tabs[i].path === path) return tabs[i];
    }
    return null;
  }

  function paneEl() {
    return document.querySelector('[data-tab-pane]');
  }

  function paneTitle() {
    var pane = paneEl();
    return (pane && pane.getAttribute('data-tab-title')) || document.title;
  }

  function paneKind() {
    var pane = paneEl();
    return (pane && pane.getAttribute('data-page-kind')) || 'view';
  }

  function isPagePath(pathname) {
    return pathname === '/' || /\/$/.test(pathname) || /\.html?$/.test(pathname);
  }

  /* ---------------- state ---------------- */
  function load() {
    try {
      var raw = sessionStorage.getItem(STORE);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data.filter(function (t) { return t && typeof t.path === 'string'; }) : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify(tabs)); } catch (e) { /* ignore */ }
  }

  function saveScroll() {
    var tab = find(currentPath);
    if (tab) tab.scroll = window.scrollY;
  }

  /* ---------------- rendering ---------------- */
  function renderTabs() {
    var bar = document.querySelector('[data-tabbar]');
    var track = document.querySelector('[data-tabs]');
    if (!bar || !track) return;

    track.innerHTML = '';

    tabs.forEach(function (tab) {
      var el = document.createElement('div');
      el.className = 'tab' + (tab.path === currentPath ? ' is-active' : '');
      el.setAttribute('data-tab', '');
      el.setAttribute('data-tab-path', tab.path);

      var link = document.createElement('a');
      link.className = 'tab-link';
      link.href = tab.path;

      var dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.setAttribute('aria-hidden', 'true');

      var title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title || tab.path;

      link.appendChild(dot);
      link.appendChild(title);
      el.appendChild(link);

      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.setAttribute('data-tab-close', '');
      close.setAttribute('aria-label', CLOSE_LABEL + ' ' + (tab.title || ''));
      close.textContent = '×';
      el.appendChild(close);

      track.appendChild(el);
    });

    var empty = tabs.length === 0;
    bar.classList.toggle('is-empty', empty);
    body.classList.toggle('no-tabs', empty);

    save();
    revealActiveTab();
  }

  function revealActiveTab() {
    var bar = document.querySelector('[data-tabbar]');
    var active = document.querySelector('.tab.is-active');
    if (!bar || !active) return;
    var br = bar.getBoundingClientRect();
    var ar = active.getBoundingClientRect();
    if (ar.left < br.left) bar.scrollLeft -= br.left - ar.left + 12;
    else if (ar.right > br.right) bar.scrollLeft += ar.right - br.right + 12;
  }

  /* ---------------- chrome sync ---------------- */
  function syncNav(path) {
    var p = path || norm(location.pathname);
    var section = 'articles';
    if (p.indexOf('/friends') === 0) section = 'friends';
    else if (p.indexOf('/about') === 0) section = 'about';

    [].forEach.call(document.querySelectorAll('[data-nav-key]'), function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-nav-key') === section);
    });
  }

  function syncSidebar(kind) {
    var shell = document.querySelector('.app-body');
    if (!shell) return;
    var plain = kind === 'plain';
    shell.classList.toggle('no-sidebar', plain);
    body.classList.toggle('is-plain', plain);
    if (plain) setSidebar(false);
  }

  /* ---------------- navigation ---------------- */
  function navigate(path, opts) {
    opts = opts || {};
    var target = norm(path);

    if (target === currentPath && !opts.force) {
      renderTabs();
      return;
    }

    var pane = paneEl();
    if (!pane) { window.location.href = target; return; }

    saveScroll();

    fetch(target, { credentials: 'same-origin', headers: { 'X-Requested-With': 'term-nav' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var next = doc.querySelector('[data-tab-pane]');
        if (!next) throw new Error('no pane in response');

        pane.replaceWith(next);
        body.className = doc.body.className;
        document.title = doc.title;

        currentPath = target;

        var kind = next.getAttribute('data-page-kind') || 'view';
        if (kind === 'post') {
          var title = next.getAttribute('data-tab-title') || document.title;
          var tab = find(target);
          if (tab) tab.title = title;
          else {
            tabs.push({ path: target, title: title, scroll: 0 });
            trim();
          }
        }

        if (opts.push !== false) {
          try { history.pushState({ path: target }, '', target); } catch (e) { /* ignore */ }
        }

        renderTabs();
        syncNav(target);
        syncSidebar(kind);
        initPage();
        window.scrollTo(0, typeof opts.scroll === 'number' ? opts.scroll : 0);
      })
      .catch(function () {
        window.location.href = target;
      });
  }

  function closeTab(path) {
    var i = -1;
    for (var j = 0; j < tabs.length; j += 1) {
      if (tabs[j].path === path) { i = j; break; }
    }
    if (i < 0) return;

    var wasCurrent = tabs[i].path === currentPath;
    tabs.splice(i, 1);
    renderTabs();

    if (!wasCurrent) return;

    var next = tabs[Math.min(i, tabs.length - 1)];
    if (next) {
      navigate(next.path, { scroll: next.scroll || 0, force: true });
    } else {
      navigate('/articles/', { force: true });
    }
  }

  function trim() {
    while (tabs.length > MAX_TABS) {
      var idx = -1;
      for (var i = 0; i < tabs.length; i += 1) {
        if (tabs[i].path !== currentPath) { idx = i; break; }
      }
      if (idx < 0) break;
      tabs.splice(idx, 1);
    }
  }

  /* ---------------- clicks ---------------- */
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented) return;

    var toggle = event.target.closest('[data-tree-toggle]');
    if (toggle) {
      event.preventDefault();
      var node = toggle.closest('.tree-node');
      var isCollapsed = node.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      rememberExpanded(node.getAttribute('data-tree-key'), !isCollapsed);
      return;
    }

    var tabClose = event.target.closest('[data-tab-close]');
    if (tabClose) {
      event.preventDefault();
      var tabEl = tabClose.closest('[data-tab]');
      if (tabEl) closeTab(tabEl.getAttribute('data-tab-path'));
      return;
    }

    var tabHit = event.target.closest('[data-tab]');
    if (tabHit) {
      event.preventDefault();
      var tabPath = tabHit.getAttribute('data-tab-path');
      if (!tabPath) return;
      if (tabPath === currentPath) return;
      var target = find(tabPath);
      navigate(tabPath, { scroll: (target && target.scroll) || 0 });
      return;
    }

    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var link = event.target.closest('a[href]');
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;

    var href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;

    var url;
    try { url = new URL(href, location.href); } catch (e) { return; }
    if (url.origin !== location.origin) return;
    if (!isPagePath(url.pathname)) return;

    event.preventDefault();

    if (window.innerWidth <= 1024) setSidebar(false);

    navigate(url.pathname, { force: true });
  }, false);

  window.addEventListener('popstate', function () {
    var path = norm(location.pathname);
    // Same document, only the #hash changed (TOC links): let the browser scroll.
    if (path === currentPath) return;

    var tab = find(path);
    navigate(location.pathname, { push: false, force: true, scroll: (tab && tab.scroll) || 0 });
  });

  /* ---------------- per-page init ---------------- */
  function initPage() {
    initTOC();
    initCopy();
    initSearch();
    initSidebarActive();
    initShell();
  }

  function initSidebarActive() {
    var current = norm(location.pathname);
    var pane = paneEl();

    // the open article: highlight its row and reveal its folder
    [].forEach.call(document.querySelectorAll('.sidebar [data-post-path]'), function (el) {
      var active = norm(el.getAttribute('data-post-path')) === current;
      el.classList.toggle('is-active', active);
      if (active) expandFrom(el);
    });

    // section rows: 全部文章 / 按标签检索
    var links = [].slice.call(document.querySelectorAll('.sidebar [data-path]'));
    var best = null;
    var bestLen = -1;

    links.forEach(function (el) {
      el.classList.remove('is-active');
      var p = norm(el.getAttribute('data-path'));
      if (p === current) { best = el; bestLen = Infinity; }
    });

    if (!best) {
      links.forEach(function (el) {
        var p = norm(el.getAttribute('data-path'));
        if (p !== '/' && current.indexOf(p) === 0 && p.length > bestLen) {
          best = el;
          bestLen = p.length;
        }
      });
    }

    if (best) best.classList.add('is-active');

    // folder name highlight (current article's folder or current view)
    var folderKey = '';
    var crumbs = pane ? pane.querySelectorAll('.crumbs .crumb-current') : [];
    if (crumbs.length) folderKey = [].map.call(crumbs, function (c) { return c.textContent.trim(); }).join('/');
    [].forEach.call(document.querySelectorAll('.sidebar .tree-folder'), function (el) {
      var node = el.closest('.tree-node');
      var key = node ? node.getAttribute('data-tree-key') : '';
      el.classList.toggle('is-current', !!folderKey && key === folderKey);
    });
  }

  function expandFrom(el) {
    var node = el.closest('.tree-node');
    while (node) {
      node.classList.remove('is-collapsed');
      var btn = node.querySelector('[data-tree-toggle]');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      var parent = node.parentElement;
      node = parent ? parent.closest('.tree-node') : null;
    }
  }

  var EXPAND_KEY = 'term-expanded';
  var expandedKeys = readExpanded();

  function readExpanded() {
    try {
      var raw = localStorage.getItem(EXPAND_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function rememberExpanded(key, expanded) {
    if (!key) return;
    var i = expandedKeys.indexOf(key);
    if (expanded && i === -1) expandedKeys.push(key);
    else if (!expanded && i !== -1) expandedKeys.splice(i, 1);
    try { localStorage.setItem(EXPAND_KEY, JSON.stringify(expandedKeys)); } catch (e) { /* ignore */ }
  }

  // Folders start collapsed; only the ones the reader opened (or that contain
  // the current article) are expanded.
  function applyExpanded() {
    [].forEach.call(document.querySelectorAll('.sidebar .tree-node[data-tree-key]'), function (node) {
      var key = node.getAttribute('data-tree-key');
      var expanded = expandedKeys.indexOf(key) !== -1;
      node.classList.toggle('is-collapsed', !expanded);
      var btn = node.querySelector('[data-tree-toggle]');
      if (btn) btn.setAttribute('aria-expanded', String(expanded));
    });
  }

  function initSearch() {
    var input = document.querySelector('[data-search]');
    if (!input) return;

    if (!input.getAttribute('data-bound')) {
      input.setAttribute('data-bound', '1');
      input.addEventListener('input', applySearch);
      input.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        if (document.querySelector('.post-card')) return;
        event.preventDefault();
        navigate('/articles/');
      });
    }

    applySearch();
  }

  function applySearch() {
    var input = document.querySelector('[data-search]');
    var q = input ? input.value.trim().toLowerCase() : '';
    var cards = [].slice.call(document.querySelectorAll('.post-card, .folder-card'));
    var hits = 0;

    cards.forEach(function (card) {
      var hay = (card.getAttribute('data-search') || '') + ' ' + card.textContent.toLowerCase();
      var match = !q || hay.indexOf(q) !== -1;
      card.classList.toggle('is-hidden', !match);
      if (match) hits += 1;
    });

    ['.year-block', '.block'].forEach(function (selector) {
      [].slice.call(document.querySelectorAll(selector)).forEach(function (block) {
        var inner = [].slice.call(block.querySelectorAll('.post-card, .folder-card'));
        if (!inner.length) return;
        var any = inner.some(function (el) { return !el.classList.contains('is-hidden'); });
        block.classList.toggle('is-hidden', !any);
      });
    });

    var empty = document.querySelector('[data-search-empty]');
    if (empty) empty.classList.toggle('is-hidden', !(q && hits === 0));
  }

  var tocState = { entries: [], links: [] };
  var tocObserver = null;

  function initTOC() {
    var pane = paneEl();
    var content = pane ? pane.querySelector('#post-body') : null;
    var links = pane ? [].slice.call(pane.querySelectorAll('.toc-link')) : [];
    tocState = { entries: [], links: [] };
    if (!content || !links.length) return;

    var entries = [];
    links.forEach(function (link) {
      link.classList.remove('is-active', 'is-ancestor');
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) !== '#') return;
      var id = decodeURIComponent(href.slice(1));
      var el = document.getElementById(id);
      if (!el || !content.contains(el)) return;
      entries.push({ id: id, el: el, link: link });
    });

    tocState = { entries: entries, links: links };
    paintTOC();

    // A scroll listener is not enough inside some embedding contexts (and it
    // misses repaints when only the layout shifts), so also watch the reading
    // line: any heading crossing it triggers a repaint.
    if (tocObserver) tocObserver.disconnect();
    tocObserver = null;
    if ('IntersectionObserver' in window && entries.length) {
      var band = Math.max(0, window.innerHeight - 112);
      tocObserver = new IntersectionObserver(onTOCScroll, {
        rootMargin: '-112px 0px -' + band + 'px 0px',
        threshold: 0
      });
      entries.forEach(function (entry) { tocObserver.observe(entry.el); });
    }
  }

  /**
   * The current section is the last TOC heading above the reading line.
   * Using TOC headings (not every heading) means sub-sections that are not in
   * the TOC keep their parent marked instead of clearing the highlight, and
   * the plain text between an h1 and its first h2 counts as the h1.
   */
  function paintTOC() {
    var entries = tocState.entries;
    if (!entries.length) return;

    var line = 112;
    var active = entries[0];
    for (var i = 0; i < entries.length; i += 1) {
      if (entries[i].el.getBoundingClientRect().top <= line) active = entries[i];
    }

    tocState.links.forEach(function (link) {
      link.classList.remove('is-active', 'is-ancestor');
    });
    active.link.classList.add('is-active');

    var li = active.link.closest('li');
    while (li) {
      var parentLi = li.parentElement ? li.parentElement.closest('li') : null;
      if (!parentLi) break;
      var parentLink = parentLi.querySelector('.toc-link');
      if (parentLink) parentLink.classList.add('is-ancestor');
      li = parentLi;
    }

    revealActiveTOC();
  }

  function revealActiveTOC() {
    var rail = document.querySelector('.toc-rail');
    var active = document.querySelector('.toc-link.is-active');
    if (!rail || !active) return;
    var rr = rail.getBoundingClientRect();
    var ar = active.getBoundingClientRect();
    if (ar.top < rr.top + 4) rail.scrollTop -= (rr.top - ar.top) + 12;
    else if (ar.bottom > rr.bottom - 4) rail.scrollTop += (ar.bottom - rr.bottom) + 12;
  }

  var tocTimer = 0;
  function onTOCScroll() {
    if (tocTimer) return;
    tocTimer = window.setTimeout(function () {
      tocTimer = 0;
      paintTOC();
    }, 40);
  }
  window.addEventListener('scroll', onTOCScroll, { passive: true });
  window.addEventListener('resize', onTOCScroll);

  function initCopy() {
    var blocks = [].slice.call(document.querySelectorAll('.post-body figure.highlight, .post-body > pre'));
    blocks.forEach(function (block) {
      if (block.querySelector('.code-copy')) return;
      var pre = block.querySelector('.code pre') || block.querySelector('pre');
      if (!pre) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = 'copy';

      btn.addEventListener('click', function () {
        var text = pre.innerText.replace(/\n$/, '');
        var done = function () {
          btn.textContent = 'copied';
          window.setTimeout(function () { btn.textContent = 'copy'; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done);
        } else {
          var area = document.createElement('textarea');
          area.value = text;
          document.body.appendChild(area);
          area.select();
          try { document.execCommand('copy'); } catch (e) { /* ignore */ }
          document.body.removeChild(area);
          done();
        }
      });

      if (getComputedStyle(block).position === 'static') block.style.position = 'relative';
      block.appendChild(btn);
    });
  }

  /* ---------------- home shell ---------------- */
  function initShell() {
    var win = document.querySelector('[data-shell]');
    if (!win || win.getAttribute('data-ready')) return;
    win.setAttribute('data-ready', '1');

    var screen = win.querySelector('[data-shell-screen]');
    var out = win.querySelector('[data-shell-output]');
    var form = win.querySelector('[data-shell-form]');
    var input = win.querySelector('[data-shell-input]');
    var cwdEl = win.querySelector('[data-shell-cwd]');
    var author = win.getAttribute('data-author') || 'anonymous';

    var tree = [];
    var rootPosts = [];
    var dataEl = document.getElementById('term-data');
    if (dataEl) {
      try {
        var parsed = JSON.parse(dataEl.textContent) || {};
        tree = parsed.folders || [];
        rootPosts = parsed.posts || [];
      } catch (e) { tree = []; rootPosts = []; }
    }

    var cwd = [];
    var past = [];
    var pastPos = 0;

    function esc(value) {
      return String(value).replace(/[&<>"]/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
      });
    }

    function rootNode() { return { name: '~', children: tree, posts: rootPosts }; }

    function countPosts(node) {
      var n = (node.posts || []).length;
      (node.children || []).forEach(function (child) { n += countPosts(child); });
      return n;
    }

    function nodeAt(parts) {
      var node = rootNode();
      for (var i = 0; i < parts.length; i += 1) {
        var next = null;
        for (var j = 0; j < node.children.length; j += 1) {
          if (node.children[j].name === parts[i]) { next = node.children[j]; break; }
        }
        if (!next) return null;
        node = next;
      }
      return node;
    }

    function current() { return nodeAt(cwd) || rootNode(); }
    function promptPath() { return cwd.length ? '~/' + cwd.join('/') : '~'; }
    function scrollDown() { screen.scrollTop = screen.scrollHeight; }

    function write(html, cls) {
      var line = document.createElement('div');
      line.className = 'term-out' + (cls ? ' ' + cls : '');
      line.innerHTML = html;
      out.appendChild(line);
      scrollDown();
    }

    function echo(raw) {
      write('<span class="term-ps1">❯</span> <span class="term-cwd">' + esc(promptPath()) + '</span> ' + esc(raw), 'term-echo');
    }

    function resolve(arg) {
      var parts = cwd.slice();
      var segs = String(arg == null ? '' : arg).split('/').filter(Boolean);
      for (var i = 0; i < segs.length; i += 1) {
        if (segs[i] === '..') parts.pop();
        else if (segs[i] !== '.' && segs[i] !== '~') parts.push(segs[i]);
      }
      var node = nodeAt(parts);
      return node ? { parts: parts, node: node } : null;
    }

    function findPost(arg) {
      var posts = current().posts || [];
      var n = parseInt(arg, 10);
      if (!isNaN(n) && posts[n - 1]) return posts[n - 1];

      var q = String(arg || '').toLowerCase();
      var found = null;
      (function walk(node) {
        (node.posts || []).forEach(function (post) {
          if (!found && post.title.toLowerCase().indexOf(q) !== -1) found = post;
        });
        (node.children || []).forEach(walk);
      })(rootNode());
      return found;
    }

    function openPath(path) {
      var a = document.createElement('a');
      a.href = path;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    function setCwd(parts) {
      cwd = parts;
      if (cwdEl) cwdEl.textContent = promptPath();
    }

    var commands = {
      help: function () {
        write('可用命令：');
        write('  <span class="term-cmd">ls</span> [目录]      列出文件夹与文章');
        write('  <span class="term-cmd">cd</span> [目录]      切换目录，<span class="term-dim">..</span> 返回上一级');
        write('  <span class="term-cmd">cat</span> &lt;序号|标题&gt;  查看文章信息');
        write('  <span class="term-cmd">open</span> &lt;序号|标题&gt; 打开文章');
        write('  <span class="term-cmd">tree</span>          打印整棵树');
        write('  <span class="term-cmd">tags</span>          去标签页');
        write('  <span class="term-cmd">theme</span> [dark|light]');
        write('  <span class="term-cmd">pwd</span> <span class="term-cmd">whoami</span> <span class="term-cmd">date</span> <span class="term-cmd">clear</span>');
      },
      ls: function (args) {
        var target = args.length ? resolve(args[0]) : { node: current() };
        if (!target) { write('<span class="term-err">ls: no such directory: ' + esc(args[0]) + '</span>'); return; }
        var kids = target.node.children || [];
        var posts = target.node.posts || [];
        if (!kids.length && !posts.length) { write('<span class="term-dim">(empty)</span>'); return; }
        kids.forEach(function (child) {
          write('  <span class="term-dir">' + esc(child.name) + '/</span> <span class="term-dim">' + countPosts(child) + ' 篇</span>');
        });
        posts.forEach(function (post, i) {
          write('  <span class="term-dim">' + (i + 1) + '.</span> <span class="term-post">' + esc(post.title) + '</span> <span class="term-dim">' + esc(post.date) + '</span>');
        });
      },
      cd: function (args) {
        if (!args.length) { setCwd([]); return; }
        var target = resolve(args[0]);
        if (!target) { write('<span class="term-err">cd: no such directory: ' + esc(args[0]) + '</span>'); return; }
        setCwd(target.parts);
      },
      pwd: function () { write(esc(promptPath())); },
      cat: function (args) {
        if (!args.length) { write('<span class="term-dim">usage: cat &lt;number|title&gt;</span>'); return; }
        var post = findPost(args.join(' '));
        if (!post) { write('<span class="term-err">cat: no such post</span>'); return; }
        write('<span class="term-post">' + esc(post.title) + '</span>');
        write('  <span class="term-dim">' + esc(post.date) + '  ' + esc(post.path) + '</span>');
      },
      open: function (args) {
        if (!args.length) { write('<span class="term-dim">usage: open &lt;number|title&gt;</span>'); return; }
        var post = findPost(args.join(' '));
        if (!post) { write('<span class="term-err">open: no such post</span>'); return; }
        write('<span class="term-dim">opening</span> ' + esc(post.title));
        openPath(post.path);
      },
      tree: function (args) {
        var base = args.length ? resolve(args[0]) : { node: current() };
        if (!base) { write('<span class="term-err">tree: no such directory</span>'); return; }
        (function walk(node, prefix) {
          (node.children || []).forEach(function (child) {
            write('<span class="term-dim">' + esc(prefix) + '</span><span class="term-dir">' + esc(child.name) + '/</span>');
            walk(child, prefix + '  ');
          });
          (node.posts || []).forEach(function (post) {
            write('<span class="term-dim">' + esc(prefix) + '</span><span class="term-post">' + esc(post.title) + '</span>');
          });
        })(base.node, '');
      },
      tags: function () { write('<span class="term-dim">→ /tags/</span>'); openPath('/tags/'); },
      theme: function (args) {
        var next = args[0];
        if (next !== 'dark' && next !== 'light') next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('term-theme', next); } catch (e) { /* ignore */ }
        write('theme → ' + next);
      },
      whoami: function () { write(esc(author)); },
      date: function () { write(esc(new Date().toLocaleString())); },
      clear: function () { out.innerHTML = ''; }
    };

    function run(raw) {
      var line = String(raw || '').trim();
      if (!line) return;
      echo(line);
      var parts = line.split(/\s+/);
      var name = parts[0].toLowerCase();
      var args = parts.slice(1);
      var fn = commands[name];
      if (!fn) {
        write('<span class="term-err">zsh: command not found: ' + esc(name) + '</span>');
        return;
      }
      fn(args);
    }

    function complete() {
      var value = input.value;
      var parts = value.split(/\s+/);
      var last = parts[parts.length - 1] || '';
      var names = (current().children || []).map(function (child) { return child.name; });
      var hits = names.filter(function (name) { return name.indexOf(last) === 0; });
      if (hits.length === 1) {
        parts[parts.length - 1] = hits[0];
        input.value = parts.join(' ');
      } else if (hits.length > 1) {
        write('<span class="term-dim">' + hits.map(esc).join('   ') + '</span>');
      }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var raw = input.value;
      input.value = '';
      if (raw.trim()) { past.push(raw); pastPos = past.length; }
      run(raw);
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (pastPos > 0) { pastPos -= 1; input.value = past[pastPos] || ''; }
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (pastPos < past.length) { pastPos += 1; input.value = past[pastPos] || ''; }
      } else if (event.key === 'Tab') {
        event.preventDefault();
        complete();
      }
    });

    screen.addEventListener('click', function (event) {
      if (!event.target.closest('a')) input.focus();
    });

    setCwd([]);

    // Start with a little history in the scrollback (also recallable with ↑).
    ['whoami', 'date'].forEach(function (cmd) {
      past.push(cmd);
      run(cmd);
    });
    pastPos = past.length;
  }
  /* ---------------- top bar / sidebar chrome ---------------- */
  var themeToggle = document.querySelector('[data-theme-toggle]');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('term-theme', next); } catch (e) { /* ignore */ }
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'light' ? '#f6f7f5' : '#0a0c0f');
    });
  }

  var sidebar = document.querySelector('[data-sidebar]');
  var sidebarToggle = document.querySelector('[data-sidebar-toggle]');
  var backdrop = document.querySelector('[data-sidebar-backdrop]');

  function setSidebar(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('is-open', open);
    if (backdrop) backdrop.classList.toggle('is-open', open);
    if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', String(open));
    // stop the page behind the drawer from scrolling with it
    document.body.classList.toggle('has-drawer', open);
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function () {
      setSidebar(!sidebar.classList.contains('is-open'));
    });
  }
  if (backdrop) backdrop.addEventListener('click', function () { setSidebar(false); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setSidebar(false);
  });
  // a drawer left open while the window grows would keep the page locked
  window.addEventListener('resize', function () {
    if (window.innerWidth > 1024 && document.body.classList.contains('has-drawer')) setSidebar(false);
  });

  var toTop = document.querySelector('[data-to-top]');
  if (toTop) {
    toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  /* ---------------- boot ---------------- */
  (function boot() {
    tabs = load();

    if (paneKind() === 'post') {
      var tab = find(currentPath);
      if (tab) tab.title = paneTitle();
      else {
        tabs.push({ path: currentPath, title: paneTitle(), scroll: 0 });
        trim();
      }
    }

    renderTabs();
    syncNav(currentPath);
    syncSidebar(body.getAttribute('data-page-kind') || 'view');
    applyExpanded();
    initPage();
  })();
})();
