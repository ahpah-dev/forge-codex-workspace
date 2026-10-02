// File references shared by the chat renderer and workspace API.
globalThis.ForgeFilePaths = {
  normalize(value) {
    let input = String(value || '').trim();
    if (!input || /[\u0000-\u001f\u007f]/.test(input)) throw new Error('Choose a valid file path.');
    if (/^file:/i.test(input)) {
      const url = new URL(input.replaceAll('\\', '/'));
      if (url.username || url.password || url.port || url.search) throw new Error('Choose a valid local file link.');
      input = url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}${url.pathname}` : url.pathname;
    } else if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[a-z]:[\\/]/i.test(input)) {
      throw new Error('This link is not a local file path.');
    }
    try { input = decodeURIComponent(input); } catch { /* Literal percent signs in filenames are valid. */ }
    if (/[\u0000-\u001f\u007f]/.test(input)) throw new Error('Choose a valid file path.');
    input = input.replaceAll('\\', '/').replace(/^\/+([a-z]:\/)/i, '$1');
    const unc = input.startsWith('//');
    input = input.replace(/\/+/g, '/');
    if (unc) input = '/' + input;
    input = input.replace(/:\d+(?::\d+)?$/, '');
    return /^(?:[a-z]:\/|\/)$/i.test(input) ? input : input.replace(/\/$/, '');
  },
  relativeToWorkspace(workspace, value) {
    const root = this.normalize(workspace).replace(/\/$/, '');
    const target = this.normalize(value);
    let relative = target;
    if (/^[a-z]:\//i.test(target) || target.startsWith('/')) {
      const windows = /^[a-z]:\//i.test(root) || root.startsWith('//');
      const compare = (text) => windows ? text.toLowerCase() : text;
      if (!compare(target).startsWith(compare(root) + '/')) throw new Error(`This file is outside the open workspace “${root}”.`);
      relative = target.slice(root.length + 1);
    }
    const segments = [];
    for (const segment of relative.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (!segments.length) throw new Error('This link points outside the open workspace.');
        segments.pop();
      } else {
        if (segment.includes(':')) throw new Error('Choose a valid file path.');
        segments.push(segment);
      }
    }
    if (!segments.length) throw new Error('Choose a file inside the open workspace.');
    return segments.join('/');
  },
  opensNatively(value) {
    return /\.(?:zip|7z|rar|tar|gz|bz2|xz|pdf|png|jpe?g|gif|webp|svg|bmp|ico|avif|mp3|wav|flac|ogg|m4a|mp4|mov|mkv|webm|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(this.normalize(value));
  },
};
