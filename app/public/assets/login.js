const err = document.getElementById('err');
async function post(url, body) {
  err.textContent = '';
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Gagal');
    return j;
  } catch (e) {
    err.textContent = e.message === 'Failed to fetch' ? 'Tidak bisa menghubungi server' : e.message;
    return null;
  }
}
document.getElementById('guest').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  const j = await post('/api/guest', { name: new FormData(e.target).get('name') });
  btn.disabled = false;
  if (j) {
    try { sessionStorage.setItem('ujiat-new-guest', '1'); } catch {}
    location.href = '/';
  }
});
document.getElementById('resume').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await post('/api/guest/resume', { code: new FormData(e.target).get('code') })) location.href = '/';
});
document.getElementById('admin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (await post('/api/login', { user: fd.get('user'), pass: fd.get('pass') })) location.href = '/';
});
