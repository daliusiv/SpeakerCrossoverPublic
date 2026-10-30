// Persistence: autosave, user driver library, project files and share links.

const KEY_PROJECT = 'xover.project.v1';
const KEY_LIB = 'xover.library.v1';

const tryGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const trySet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

export const saveLocal = p => trySet(KEY_PROJECT, JSON.stringify(p));
export function loadLocal() {
  try { const s = tryGet(KEY_PROJECT); return s ? JSON.parse(s) : null; } catch { return null; }
}

export function userLibrary() {
  try { return JSON.parse(tryGet(KEY_LIB) || '[]'); } catch { return []; }
}
export function saveUserLibrary(list) {
  if (!trySet(KEY_LIB, JSON.stringify(list))) throw new Error('Browser storage is full or disabled');
}

export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

const b64url = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export async function encodeShare(project) {
  const json = new Blob([JSON.stringify(project)]);
  if (typeof CompressionStream === 'undefined') return 'j' + b64url(new Uint8Array(await json.arrayBuffer()));
  const buf = await new Response(json.stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return 'z' + b64url(new Uint8Array(buf));
}

export async function decodeShare(s) {
  const bytes = unb64url(s.slice(1));
  if (s[0] === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}
