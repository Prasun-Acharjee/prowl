/* Prowl admin dashboard — plain JS + supabase-js (UMD) + Leaflet.
   The anon key is public by design (it ships inside the mobile app);
   writes to adoption fields are guarded server-side by migration 00005. */

const SUPABASE_URL = 'https://bientnpwxpvsjtxetqhg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oMgEWKIZwiVkLXQnpbkm1g_ZTtA8eb9';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

const AVATAR_COLORS = ['#C9883A', '#5C6FA0', '#B85C3A', '#3A3C50', '#9E7E48', '#8FA889', '#C4728A'];
function idColor(id) {
  const hash = id.split('').reduce((n, c) => n + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function timeAgo(iso) {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

/* ── Auth ─────────────────────────────────────────────────────────── */

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showApp(); else showLogin();
}

function showLogin() {
  $('login-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
}

function showApp() {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  loadStats();
  loadPets();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-btn').disabled = true;
  $('login-error').classList.add('hidden');
  const { error } = await sb.auth.signInWithPassword({
    email: $('login-email').value.trim(),
    password: $('login-password').value,
  });
  $('login-btn').disabled = false;
  if (error) {
    $('login-error').textContent = error.message;
    $('login-error').classList.remove('hidden');
    return;
  }
  showApp();
});

$('signout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

/* ── Tabs ─────────────────────────────────────────────────────────── */

let mapInited = false;
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    const tab = btn.dataset.tab;
    $('tab-pets').classList.toggle('hidden', tab !== 'pets');
    $('tab-map').classList.toggle('hidden', tab !== 'map');
    if (tab === 'map' && !mapInited) initMap();
  });
});

/* ── Stats ────────────────────────────────────────────────────────── */

async function count(table, filter) {
  let q = sb.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: n, error } = await q;
  return error ? '?' : n;
}

async function loadStats() {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [total, adoptable, adopted, sightings] = await Promise.all([
    count('pets'),
    count('pets', (q) => q.eq('status', 'adoptable')),
    count('pets', (q) => q.eq('status', 'adopted')),
    count('sightings', (q) => q.gte('created_at', weekAgo)),
  ]);
  $('stat-total').textContent = total;
  $('stat-adoptable').textContent = adoptable;
  $('stat-adopted').textContent = adopted;
  $('stat-sightings').textContent = sightings;
}

/* ── Pets table ───────────────────────────────────────────────────── */

let pets = [];

async function loadPets() {
  const { data, error } = await sb
    .from('pets_geo')
    .select('*')
    .order('last_seen_at', { ascending: false });
  if (error) { toast(error.message, true); return; }
  pets = data ?? [];
  renderPets();
}

function renderPets() {
  const tbody = $('pets-tbody');
  tbody.innerHTML = '';
  if (!pets.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted">No pets yet.</td></tr>';
    return;
  }
  for (const p of pets) {
    const tr = document.createElement('tr');

    const thumb = p.thumbnail_small_url || p.thumbnail_url;
    const tdThumb = document.createElement('td');
    tdThumb.innerHTML = thumb
      ? `<img class="thumb" src="${thumb}" alt="" loading="lazy" />`
      : `<div class="thumb-initial" style="background:${idColor(p.id)}">${p.name.charAt(0).toUpperCase()}</div>`;

    const tdName = document.createElement('td');
    tdName.innerHTML = `<span class="pet-name">${escapeHtml(p.name)}</span>`;
    tdName.querySelector('.pet-name').addEventListener('click', () => openSightings(p));

    const tdSpecies = document.createElement('td');
    tdSpecies.textContent = p.species;
    tdSpecies.className = 'muted';

    const tdStatus = document.createElement('td');
    const sel = document.createElement('select');
    sel.className = `status ${p.status}`;
    for (const s of ['stray', 'adoptable', 'adopted']) {
      const opt = new Option(s, s, false, s === p.status);
      sel.add(opt);
    }
    sel.addEventListener('change', () => updatePet(p, { status: sel.value }, sel));
    tdStatus.appendChild(sel);

    const tdContact = document.createElement('td');
    const inp = document.createElement('input');
    inp.className = 'contact';
    inp.placeholder = 'email or +phone';
    inp.value = p.adoption_contact ?? '';
    inp.addEventListener('change', () =>
      updatePet(p, { adoption_contact: inp.value.trim() || null }, inp));
    tdContact.appendChild(inp);

    const tdCount = document.createElement('td');
    tdCount.textContent = p.sighting_count;

    const tdSeen = document.createElement('td');
    tdSeen.textContent = timeAgo(p.last_seen_at);
    tdSeen.className = 'muted';

    const tdDel = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '🗑';
    del.title = 'Delete pet and all sightings';
    del.addEventListener('click', () => deletePet(p));
    tdDel.appendChild(del);

    tr.append(tdThumb, tdName, tdSpecies, tdStatus, tdContact, tdCount, tdSeen, tdDel);
    tbody.appendChild(tr);
  }
}

async function updatePet(p, patch, control) {
  control.disabled = true;
  const { error } = await sb.from('pets').update(patch).eq('id', p.id);
  control.disabled = false;
  if (error) {
    toast(error.message, true);
    loadPets();
    return;
  }
  Object.assign(p, patch);
  if (patch.status && control.classList) control.className = `status ${patch.status}`;
  toast(`${p.name} updated`);
  loadStats();
}

async function deletePet(p) {
  if (!confirm(`Delete ${p.name} and all sightings? This cannot be undone.`)) return;
  const { error } = await sb.from('pets').delete().eq('id', p.id);
  if (error) { toast(error.message, true); return; }
  toast(`${p.name} deleted`);
  loadPets();
  loadStats();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Sightings modal ──────────────────────────────────────────────── */

async function openSightings(p) {
  $('modal-title').textContent = `${p.name} — sightings`;
  $('modal-body').innerHTML = '<p class="muted">Loading…</p>';
  $('modal-backdrop').classList.remove('hidden');

  const { data, error } = await sb
    .from('sightings_geo')
    .select('*')
    .eq('pet_id', p.id)
    .order('created_at', { ascending: false });
  if (error) { $('modal-body').innerHTML = `<p class="error">${error.message}</p>`; return; }

  const body = $('modal-body');
  body.innerHTML = '';
  if (!data.length) { body.innerHTML = '<p class="muted">No sightings.</p>'; return; }

  for (const s of data) {
    const row = document.createElement('div');
    row.className = 'sighting-row';

    if (s.photo_url) {
      const img = document.createElement('img');
      img.src = s.photo_url;
      img.loading = 'lazy';
      img.addEventListener('click', () => window.open(s.photo_url, '_blank'));
      row.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'sighting-info';
    info.innerHTML = `<div>${fmtDate(s.created_at)}</div>` +
      (s.note ? `<div class="sighting-note">${escapeHtml(s.note)}</div>` : '');
    row.appendChild(info);

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '🗑';
    del.title = 'Delete sighting';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this sighting?')) return;
      const { error: e } = await sb.from('sightings').delete().eq('id', s.id);
      if (e) { toast(e.message, true); return; }
      row.remove();
      toast('Sighting deleted');
      loadPets();
      loadStats();
    });
    row.appendChild(del);

    body.appendChild(row);
  }
}

$('modal-close').addEventListener('click', () => $('modal-backdrop').classList.add('hidden'));
$('modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('modal-backdrop')) $('modal-backdrop').classList.add('hidden');
});

/* ── Map ──────────────────────────────────────────────────────────── */

function pinColor(p) {
  if (p.status === 'adoptable') return '#C4728A';
  const hours = (Date.now() - new Date(p.last_seen_at).getTime()) / 3_600_000;
  if (hours < 24) return '#F5B93E';
  if (hours < 168) return '#C4728A';
  return '#6D6C78';
}

function initMap() {
  mapInited = true;
  const map = L.map('map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);

  const withCoords = pets.filter((p) => p.latitude != null && p.longitude != null);
  if (!withCoords.length) { map.setView([20, 0], 2); return; }

  const bounds = [];
  for (const p of withCoords) {
    const size = 22;
    const icon = L.divIcon({
      className: '',
      iconSize: [size, size],
      html: `<div class="pin-dot" style="background:${pinColor(p)}">${p.status === 'adoptable' ? '♥' : ''}</div>`,
    });
    L.marker([p.latitude, p.longitude], { icon })
      .addTo(map)
      .bindPopup(
        `<strong>${escapeHtml(p.name)}</strong><br/>` +
        `${p.species} · ${p.status}<br/>` +
        `${p.sighting_count} sightings · ${timeAgo(p.last_seen_at)}`,
      );
    bounds.push([p.latitude, p.longitude]);
  }
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
}

init();
