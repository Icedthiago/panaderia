// ---------- Variables globales ----------
let currentUser = null;
let badgeCarrito = null;

// ---------- Helper para fetch con cookies ----------
// Wrapper seguro para fetch que añade credentials para rutas internas y hace logging útil
(() => {
  if (typeof window === 'undefined' || !window.fetch) return;

  const _fetch = window.fetch.bind(window);

  window.fetch = async function(resource, init = {}) {
    // Normalize resource to string for la comprobación de URL
    let urlString = '';
    try {
      urlString = typeof resource === 'string' ? resource : (resource && resource.url) || '';
    } catch (e) {
      console.warn('fetch wrapper: no se pudo obtener urlString', e);
      urlString = '';
    }

    // Sólo añadir credentials para nuestras rutas internas (ajusta si necesitas más)
    const shouldAttachCredentials = urlString === '/me' ||
                                    urlString === '/misCompras' ||
                                    urlString.startsWith('/carrito') ||
                                    urlString.startsWith('/usuarios');

    // Crear un nuevo objeto init para no mutar el original
    const mergedInit = Object.assign({}, init);
    if (shouldAttachCredentials) {
      mergedInit.credentials = mergedInit.credentials || 'same-origin';
    }

    // Debugging: log cuando falle la petición para ayudar a identificar el problema
    try {
      return await _fetch(resource, mergedInit);
    } catch (err) {
      // Lanzamos error con más contexto
      const msg = [
        'fetch failed',
        `resource: ${urlString || String(resource)}`,
        `method: ${mergedInit.method || 'GET'}`,
        `credentials: ${mergedInit.credentials || 'none'}`,
        `error: ${err && err.message ? err.message : String(err)}`
      ].join(' | ');
      console.error(msg, err);
      // Re-lanzar para que el resto de tu código lo maneje (o lo veas en consola)
      throw new Error(msg);
    }
  };
})();


// Helper seguro para parsear JSON y mostrar el body cuando no sea JSON (evita 'Unexpected token <')
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!ct.includes('application/json')) {
    // incluir status para diagnóstico
    throw new Error(`Respuesta no es JSON (status ${res.status}): ${text.slice(0, 1000)}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON inválido: ${err.message} — body: ${text.slice(0, 1000)}`);
  }
}

// ---------- DOMContentLoaded ----------
document.addEventListener('DOMContentLoaded', () => {
  // Elementos auth
  const formRegister = document.getElementById('formRegister');
  const formLogin = document.getElementById('formLogin');
  const authOverlay = document.getElementById('authOverlay');
  const mainApp = document.getElementById('mainApp');
  const btnAgregarPan = document.getElementById('btnAgregarPan');
  badgeCarrito = document.getElementById('badgeCarrito');
  
  // Switch login/register
  document.getElementById('switchToLogin').addEventListener('click', e => { e.preventDefault(); showLogin(); });
  document.getElementById('switchToRegister').addEventListener('click', e => { e.preventDefault(); showRegister(); });

  // Form auth
  if (formRegister) formRegister.addEventListener('submit', handleRegister);
  if (formLogin) formLogin.addEventListener('submit', handleLogin);
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

  // Carrito
  document.getElementById('btnCarrito')?.addEventListener('click', () => {
    new bootstrap.Modal(document.getElementById('modalCarrito')).show();
    cargarCarrito();
  });

  // Productos
  document.getElementById('formProducto')?.addEventListener('submit', guardarProducto);
  document.getElementById('modalProducto')?.addEventListener('hidden.bs.modal', () => {
    document.getElementById('formProducto').reset();
    document.getElementById('id_producto').value = '';
    document.getElementById('mensajeError').classList.add('d-none');
  });

  // Inicializar sesión
  fetchJson('/me').then(data => {
    if (data && data.user) onLogin(data.user);
    else { showRegister(); cargarProductos(); }
    cargarGaleria?.();
    actualizarBadge();
  }).catch(err => {
    console.warn('No se pudo obtener /me:', err.message);
    // fallback: mostrar registro y cargar productos de todos modos
    showRegister();
    cargarProductos();
    actualizarBadge();
  });

  // Otros botones globales
  document.getElementById('btnCheckout')?.addEventListener('click', doCheckout);
  document.getElementById('btnFinalizarCompra')?.addEventListener('click', doCheckout);
  document.getElementById('btnVaciarCarrito')?.addEventListener('click', vaciarCarrito);
  document.getElementById('btnConocenos')?.addEventListener('click', () => {
    new bootstrap.Modal(document.getElementById('modalConocenos')).show();
  });

  // Usuarios
  document.getElementById("formNuevoUsuario")?.addEventListener("submit", async e => {
    e.preventDefault();
    const nombre = document.getElementById("nuevoNombre").value.trim();
    const email = document.getElementById('loginEmail').value.trim();
    const rol = document.getElementById("nuevoRol").value;
    if (!nombre || !email) return;

    try {
      const res = await fetchJson("/usuarios/agregar", { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify({ nombre, email, rol }) });
      if (res.error) showToast(res.error, "error");
      else { document.getElementById("formNuevoUsuario").reset(); cargarUsuarios(); }
    } catch (err) {
      console.error('usuarios/agregar error:', err.message);
      showToast(err.message, 'error');
    }
  });

  // Reset password
  document.getElementById("formResetPassword")?.addEventListener("submit", async e => {
    e.preventDefault();
    const nombre = document.getElementById("resetNombre").value.trim();
    const email = document.getElementById("resetEmail").value.trim();
    const newPassword = document.getElementById("resetPassword").value;

    try {
      try {
        const data = await fetchJson("/resetPassword", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre, email, newPassword }) });
        showToast("Contraseña cambiada correctamente. Ya puedes iniciar sesión.", "success");
      } catch (err) {
        console.error('resetPassword error:', err.message);
        showToast(err.message || "Error cambiando contraseña", "error");
      }
    } catch { showToast("Error al conectar con el servidor.", "error"); }
  });

  // Editar perfil
  const formEditarPerfil = document.getElementById('formEditarPerfil');
  if (formEditarPerfil) formEditarPerfil.addEventListener('submit', editarPerfilHandler);

  // Delegación para abrir modal editar desde ver perfil
  document.addEventListener('click', e => {
    if (e.target?.id === 'verPerfilEditarBtn') {
      e.preventDefault();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modalVerPerfil')).hide();
      const modalEditar = new bootstrap.Modal(document.getElementById('modalEditarPerfil'));
      document.getElementById('editarNombrePerfil').value = currentUser?.nombre || '';
      modalEditar.show();
    }
  });
});

// ---------- Funciones Auth ----------
function showLogin() {
  const authTitle = document.getElementById('authTitle');
  const formRegister = document.getElementById('formRegister');
  const formLogin = document.getElementById('formLogin');
  const authError = document.getElementById('authError');
  const loginError = document.getElementById('loginError');
  
  if (authTitle) authTitle.textContent = 'Iniciar sesión';
  if (formRegister) formRegister.classList.add('d-none');
  if (formLogin) formLogin.classList.remove('d-none');
  if (authError) authError.classList.add('d-none');
  if (loginError) loginError.classList.add('d-none');
}
function showRegister() {
  document.getElementById('authTitle').textContent = 'Crear cuenta';
  document.getElementById('formRegister').classList.remove('d-none');
  document.getElementById('formLogin').classList.add('d-none');
}

async function handleRegister(e) {
  e.preventDefault();
  const nombre = document.getElementById('regNombre').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const rol = document.getElementById('isAdmin')?.checked ? 'admin' : 'cliente';
  const resp = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, email, password, rol })
  }).then(r => r.json());

  if (resp.error) {
    const el = document.getElementById('authError');
    el.textContent = resp.error;
    el.classList.remove('d-none');
    return;
  }
  onLogin(resp.user);
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const resp = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }).then(r => r.json());

  if (resp.error) {
    const el = document.getElementById('loginError');
    el.textContent = resp.error;
    el.classList.remove('d-none');
    return;
  }
  onLogin(resp.user);
}

async function handleLogout(e) {
  e?.preventDefault();
  await fetch('/logout', { method: 'POST' }).then(r => r.json());
  document.getElementById('authOverlay').classList.remove('d-none');
  document.getElementById('mainApp').style.display = 'none';
  showRegister();
  actualizarBadge();
}

function onLogin(user) {
  currentUser = user;
  const authOverlay = document.getElementById('authOverlay');
  const mainApp = document.getElementById('mainApp');
  const btnAgregarPan = document.getElementById('btnAgregarPan');
  
  if (authOverlay) authOverlay.classList.add('d-none');
  if (mainApp) mainApp.style.display = 'block';
  if (btnAgregarPan) btnAgregarPan.style.display = (user.rol === 'admin') ? 'inline-block' : 'none';
  
  actualizarPerfilDropdown();
  actualizarBadge();
  cargarProductos();
  
  // Mostrar/ocultar elementos admin
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = user.rol === 'admin' ? 'block' : 'none';
  });
  
  // Actualizar nombre en dropdown
  const headerNombre = document.querySelector('#perfilDropdown .dropdown-header');
  if (headerNombre) headerNombre.textContent = user.nombre;
}

// ---------- Perfil ----------
async function editarPerfilHandler(e) {
  e.preventDefault();
  const nombre = document.getElementById('editarNombrePerfil').value.trim();
  const password = document.getElementById('editarPasswordPerfil').value;
  const passwordConfirm = document.getElementById('editarPasswordConfirm').value;
  const imagenInput = document.getElementById('editarImagenPerfil');

  if (password && password !== passwordConfirm) {
    return showToast('Las contraseñas no coinciden', 'warning');
  }

  const fd = new FormData();
  fd.append('nombre', nombre);
  if (password) fd.append('newPassword', password);
  if (imagenInput?.files?.[0]) fd.append('imagenPerfil', imagenInput.files[0]);

  try {
    const res = await fetch('/perfil', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error actualizando perfil');
    if (data.user) currentUser = data.user;
    actualizarPerfilDropdown();
    showToast('Perfil actualizado', 'success');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEditarPerfil')).hide();
    const headerName = document.querySelector('#perfilDropdown .dropdown-header');
    if (headerName) headerName.textContent = currentUser.nombre;
  } catch (err) { showToast(err.message || 'Error actualizando perfil', 'error'); }
}

function actualizarPerfilDropdown() {
  const menu = document.getElementById('perfilDropdown');
  if (!menu || !currentUser) return;
  menu.innerHTML = `
    <li><h6 class="dropdown-header">${escapeHtml(currentUser.nombre)}</h6></li>
    <li><a class="dropdown-item" href="#" id="verHistorial">Mis compras</a></li>
    <li><a class="dropdown-item" href="#" id="verPerfilBtn">Ver perfil</a></li>
    <li><a class="dropdown-item" href="#" id="editarPerfilBtn">Editar perfil</a></li>
  `;

  if (currentUser.rol === 'admin') {
    menu.innerHTML += `<li><a class="dropdown-item" href="#" id="gestionarUsuarios">Gestionar usuarios</a></li>`;
  }
  menu.innerHTML += `<li><hr class="dropdown-divider"><a class="dropdown-item" href="#" id="logoutBtn2">Cerrar sesión</a></li>`;

  // Listeners
  setTimeout(() => {
    document.getElementById('verHistorial')?.addEventListener('click', e => { e.preventDefault(); mostrarHistorial(); new bootstrap.Modal(document.getElementById('modalHistorial')).show(); });
    document.getElementById('verPerfilBtn')?.addEventListener('click', async e => { e.preventDefault(); mostrarPerfilModal(); });
    document.getElementById('editarPerfilBtn')?.addEventListener('click', e => { e.preventDefault(); abrirEditarPerfilModal(); });
    document.getElementById('gestionarUsuarios')?.addEventListener('click', e => { e.preventDefault(); cargarUsuarios(); new bootstrap.Modal(document.getElementById('modalUsuarios')).show(); });
    document.getElementById('logoutBtn2')?.addEventListener('click', handleLogout);
  }, 10);
}

// ---------- Productos ----------
async function cargarProductos() {
  let productos = [];
  try {
    productos = await fetchJson('/obtenerProductos');
  } catch (err) {
    console.error('Error cargando productos:', err.message);
    productos = [];
  }
  // #tablaProductos may be a <tbody> or a <div> depending on the page. Handle both.
  const tablaEl = document.getElementById('tablaProductos');
  if (!tablaEl) return;
  // If it's a table body (tbody), render rows. If it's a div, render cards.
  const isTbody = tablaEl.tagName.toLowerCase() === 'tbody' || tablaEl.tagName.toLowerCase() === 'table';
  if (isTbody) tablaEl.innerHTML = '';
  productos.forEach((prod, idx) => {
  const imgSrc = (prod.imagenBase64 && prod.tipoMime) ? `data:${prod.tipoMime};base64,${prod.imagenBase64}` : (prod.tieneImagen ? `/imagen/${prod.id_producto}` : 'https://via.placeholder.com/150?text=Sin+Imagen');
    let acciones = '';
    if (currentUser?.rol === 'admin') {
      acciones = `<button class="btn btn-sm btn-warning me-1 btn-editar" data-prod='${JSON.stringify(prod).replace(/'/g, "&#39;")}'>Editar</button>
                  <button class="btn btn-sm btn-danger btn-borrar" data-id="${prod.id_producto}">Borrar</button>`;
    } else {
      acciones = `<button class="btn btn-sm btn-primary btn-agregar" data-id="${prod.id_producto}" ${prod.stock<=0?'disabled':''}>Agregar al carrito</button>`;
    }
    if (isTbody) {
      tablaEl.innerHTML += `
      <tr>
        <td>${idx+1}</td>
        <td><img src="${imgSrc}" class="img-thumbnail" style="width:80px;height:80px;object-fit:cover;"></td>
        <td>${escapeHtml(prod.nombre)}</td>
        <td>${escapeHtml(prod.temporada||'')}</td>
        <td class="fw-semibold text-success">$${Number(prod.precio).toFixed(2)}</td>
        <td>${prod.stock}</td>
        <td>${acciones}</td>
      </tr>
    `;
    } else {
      // fallback: render simple card into a container
      tablaEl.insertAdjacentHTML('beforeend', `
        <div class="col-md-4">
          <div class="card shadow-sm mb-3">
            <img src="${imgSrc}" class="card-img-top" style="height:200px;object-fit:cover;">
            <div class="card-body">
              <h5 class="card-title">${escapeHtml(prod.nombre)}</h5>
              <p class="card-text">${escapeHtml(prod.descripcion||'')}</p>
              <div class="d-flex justify-content-between align-items-center">
                <small class="text-muted">$${Number(prod.precio).toFixed(2)}</small>
                ${acciones}
              </div>
            </div>
          </div>
        </div>
      `);
    }
  });

  // Delegación de eventos botones
  tablaEl.querySelectorAll('.btn-editar').forEach(btn => btn.addEventListener('click', () => editarProducto(btn.dataset.prod)));
  tablaEl.querySelectorAll('.btn-borrar').forEach(btn => btn.addEventListener('click', () => borrarProducto(btn.dataset.id)));
  tablaEl.querySelectorAll('.btn-agregar').forEach(btn => btn.addEventListener('click', () => agregarAlCarrito(btn.dataset.id)));
}

// ---------- Carrito ----------
async function agregarAlCarrito(id_producto) {
  if (!currentUser) return showToast('Debes iniciar sesión', "warning");
  let resp;
  try {
    resp = await fetchJson('/carrito/agregar', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id_producto, cantidad:1 }) });
  } catch (err) {
    console.error('agregarAlCarrito error:', err.message);
    showToast('Error al agregar al carrito: ' + err.message, 'error');
    return;
  }
  if (resp.error) showToast(resp.error, 'error'); else { showToast('Producto agregado', 'success'); actualizarBadge(); }
}

async function cargarCarrito() {
  let resp = { items: [] };
  try {
    resp = await fetchJson('/carrito');
  } catch (err) {
    console.error('Error cargando carrito:', err.message);
    resp = { items: [] };
  }
  // Support table-based modal (Ventas) or simple tbody container
  const tablaCarritoEl = document.getElementById('tablaCarrito');
  if (!tablaCarritoEl) return;
  // If this is a tbody, render rows; otherwise replace innerHTML
  const isTbody = tablaCarritoEl.tagName.toLowerCase() === 'tbody' || tablaCarritoEl.tagName.toLowerCase() === 'table';
  tablaCarritoEl.innerHTML = '';
  (resp.items || []).forEach((item, idx) => {
    if (isTbody) {
      tablaCarritoEl.innerHTML += `<tr>
      <td>${idx+1}</td>
      <td>${escapeHtml(item.nombre)}</td>
      <td>${item.cantidad}</td>
      <td>$${(item.precio*item.cantidad).toFixed(2)}</td>
    </tr>`;
    } else {
      tablaCarritoEl.insertAdjacentHTML('beforeend', `<div class="py-2">${escapeHtml(item.nombre)} x ${item.cantidad} - $${(item.precio*item.cantidad).toFixed(2)}</div>`);
    }
  });
}

async function actualizarBadge() {
  if (!badgeCarrito) return;
  try {
    if (!currentUser) { badgeCarrito.textContent = '0'; badgeCarrito.style.display = 'none'; return; }
  const resp = await fetchJson('/carrito');
  const count = (resp.items || []).reduce((s, it) => s + Number(it.cantidad || 0), 0);
    badgeCarrito.textContent = count;
    badgeCarrito.style.display = count > 0 ? 'inline-block' : 'none';
  } catch (err) {
    console.error('Error actualizando badge', err);
  }
}

async function doCheckout() {
  if (!currentUser) return showToast('Debes iniciar sesión', 'warning');
  try {
    const resp = await fetchJson('/carrito/checkout', { method: 'POST' });
    if (resp.error) showToast(resp.error, 'error'); else { showToast('Compra realizada', 'success'); cargarCarrito(); actualizarBadge(); }
  } catch (err) {
    console.error('doCheckout error:', err.message);
    showToast('Error al procesar la compra: ' + err.message, 'error');
  }
}

async function vaciarCarrito() {
  try {
    const resp = await fetch('/carrito').then(r => r.json());
    const items = resp.items || [];
    for (const it of items) {
      await fetch('/carrito/eliminar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id_carrito: it.id_carrito }) }).then(r=>r.json());
    }
    cargarCarrito();
    actualizarBadge();
  } catch (err) {
    console.error('Error vaciando carrito', err);
  }
}

// ---------- Historial de compras ----------
async function mostrarHistorial() {
  if (!currentUser) {
    showToast('Debes iniciar sesión primero', 'warning');
    return;
  }

  const historialBody = document.getElementById('historialBody');
  if (!historialBody) return;

  try {
    historialBody.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div></div>';
    const data = await fetchJson('/misCompras');
    const compras = data.compras || [];

    if (compras.length === 0) {
      historialBody.innerHTML = '<div class="text-center text-muted py-5"><i class="bi bi-receipt h1 d-block mb-3"></i>No tienes compras realizadas aún</div>';
      return;
    }

    // Render cada compra agrupada con sus detalles
    historialBody.innerHTML = compras.map(compra => `
      <div class="card mb-3 shadow-sm">
        <div class="card-header bg-light d-flex justify-content-between align-items-center">
          <strong>Compra #${compra.id_venta}</strong>
          <small class="text-muted">${new Date(compra.fecha).toLocaleString()}</small>
        </div>
        <div class="card-body">
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead class="table-light">
                <tr>
                  <th>Producto</th>
                  <th class="text-center">Cantidad</th>
                  <th class="text-end">Precio</th>
                  <th class="text-end">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${compra.detalles.map(d => `
                  <tr>
                    <td>${escapeHtml(d.nombre)}</td>
                    <td class="text-center">${d.cantidad}</td>
                    <td class="text-end">$${Number(d.precio).toFixed(2)}</td>
                    <td class="text-end">$${(d.cantidad * d.precio).toFixed(2)}</td>
                  </tr>
                `).join('')}
                <tr class="table-light fw-bold">
                  <td colspan="3" class="text-end">Total:</td>
                  <td class="text-end">$${compra.total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.error('Error cargando historial:', err);
    historialBody.innerHTML = `
      <div class="alert alert-danger">
        ${err.message || 'Error cargando el historial de compras'}
      </div>
    `;
  }
}

// ---------- Gestión de Usuarios ----------
async function mostrarPerfilModal() {
  if (!currentUser) return;
  const modal = new bootstrap.Modal(document.getElementById('modalVerPerfil'));
  const imgEl = document.getElementById('verImagenPerfil');
  const nombreEl = document.getElementById('verNombre');
  const emailEl = document.getElementById('verEmail');
  const rolEl = document.getElementById('verRol');

  if (imgEl) imgEl.src = `/perfil/imagen/${currentUser.id_usuario}`;
  if (nombreEl) nombreEl.textContent = currentUser.nombre;
  if (emailEl) emailEl.textContent = currentUser.email;
  if (rolEl) rolEl.textContent = currentUser.rol === 'admin' ? 'Administrador' : 'Cliente';

  modal.show();
}

function abrirEditarPerfilModal() {
  const modal = new bootstrap.Modal(document.getElementById('modalEditarPerfil'));
  document.getElementById('editarNombrePerfil').value = currentUser?.nombre || '';
  document.getElementById('editarPasswordPerfil').value = '';
  document.getElementById('editarPasswordConfirm').value = '';
  document.getElementById('editarImagenPerfil').value = '';
  modal.show();
}

async function cargarUsuarios() {
  if (!currentUser?.rol === 'admin') {
    showToast('Acceso denegado', 'error');
    return;
  }

  const tabla = document.getElementById('usuariosTabla');
  if (!tabla) return;

  try {
    tabla.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner-border text-primary"></div></td></tr>';
    const usuarios = await fetchJson('/usuarios');
    
    if (!usuarios || usuarios.length === 0) {
      tabla.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No hay usuarios registrados</td></tr>';
      return;
    }

    tabla.innerHTML = usuarios.map((u, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(u.nombre)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="badge ${u.rol === 'admin' ? 'bg-danger' : 'bg-primary'}">${u.rol}</span></td>
        <td class="text-center">
          <img src="/perfil/imagen/${u.id_usuario}" 
               alt="Perfil" 
               class="rounded-circle" 
               style="width:32px;height:32px;object-fit:cover;"
               onerror="this.src='https://via.placeholder.com/32?text=👤'">
        </td>
        <td>
          ${u.rol !== 'admin' || currentUser.id_usuario !== u.id_usuario ? `
            <button class="btn btn-sm btn-danger" onclick="eliminarUsuario(${u.id_usuario})">
              Eliminar
            </button>
          ` : '<small class="text-muted">No se puede eliminar</small>'}
        </td>
      </tr>
    `).join('');

  } catch (err) {
    console.error('Error cargando usuarios:', err);
    tabla.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="alert alert-danger mb-0">
            ${err.message || 'Error cargando usuarios'}
          </div>
        </td>
      </tr>
    `;
  }
}

async function eliminarUsuario(id) {
  if (!confirm('¿Estás seguro de eliminar este usuario?')) return;
  
  try {
    await fetchJson('/usuarios/eliminar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    showToast('Usuario eliminado correctamente', 'success');
    cargarUsuarios();
  } catch (err) {
    console.error('Error eliminando usuario:', err);
    showToast(err.message || 'Error eliminando usuario', 'error');
  }
}

// ---------- Utilidades ----------
function showToast(msg, tipo='info') {
  const toastEl = document.getElementById('toastMsg');
  if (!toastEl) return alert(msg);
  toastEl.className = `toast align-items-center text-bg-${tipo} border-0 show`;
  toastEl.querySelector('.me-auto').textContent = msg;
  setTimeout(() => toastEl.classList.remove('show'), 3000);
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe.replace(/[&<"'>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[m]);
}

async function guardarProducto(e) {
  e.preventDefault();

  // Use the form fields used in the HTML modal
  const id_producto = document.getElementById('id_producto')?.value || '';
  const nombre = document.getElementById('nombre')?.value.trim() || '';
  const descripcion = document.getElementById('descripcion')?.value.trim() || '';
  const precio = parseFloat(document.getElementById('precio')?.value || 0);
  const stock = parseInt(document.getElementById('stock')?.value || 0);
  const temporada = document.getElementById('temporada')?.value || '';
  const imagenInput = document.getElementById('imagen');

  if (!nombre || isNaN(precio) || isNaN(stock)) {
    const mensaje = document.getElementById('mensajeError');
    mensaje.textContent = 'Nombre, precio y stock son obligatorios';
    mensaje.classList.remove('d-none');
    return;
  }

  const fd = new FormData();
  fd.append('nombre', nombre);
  fd.append('descripcion', descripcion);
  fd.append('precio', precio);
  fd.append('stock', stock);
  fd.append('temporada', temporada);
  if (imagenInput?.files?.[0]) fd.append('imagen', imagenInput.files[0]);

  // Use server endpoints names in app.js
  // POST /productos/agregar  -> crear
  // POST /editarProducto/:id -> actualizar (existe también /productos/editar/:id on server)
  const url = id_producto ? `/editarProducto/${id_producto}` : '/productos/agregar';
  if (id_producto) fd.append('id_producto', id_producto);

  try {
    // Use fetchJson to get clear errors when server returns HTML
    const data = await fetchJson(url, { method: 'POST', body: fd });

    showToast('Producto guardado correctamente', 'success');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalProducto')).hide();
    document.getElementById('formProducto').reset();
    cargarProductos();
  } catch (err) {
    const mensaje = document.getElementById('mensajeError');
    if (mensaje) {
      mensaje.textContent = err.message;
      mensaje.classList.remove('d-none');
    } else {
      console.error('Error guardarProducto:', err);
    }
  }
}

// ---------- Usuarios / Administración ----------
async function cargarUsuarios() {
  try {
    const usuarios = await fetchJson('/usuarios');
    const tabla = document.getElementById('usuariosTabla');
    if (!tabla) return;
    tabla.innerHTML = '';
    usuarios.forEach((u, idx) => {
      tabla.innerHTML += `
        <tr>
          <td>${idx+1}</td>
          <td>${escapeHtml(u.nombre)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.rol)}</td>
          <td>
            <button class="btn btn-sm btn-danger btn-eliminar-usuario" data-id="${u.id_usuario}">Eliminar</button>
          </td>
        </tr>`;
    });

    // Listeners
    tabla.querySelectorAll('.btn-eliminar-usuario').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('Eliminar usuario?')) return;
      try {
        await fetchJson('/usuarios/eliminar', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ id }) });
        showToast('Usuario eliminado', 'success');
        cargarUsuarios();
      } catch (err) {
        console.error('Eliminar usuario error:', err.message);
        showToast(err.message || 'Error eliminando usuario', 'error');
      }
    }));
  } catch (err) {
    console.error('Error cargando usuarios:', err.message);
    showToast('No se pudieron cargar usuarios', 'error');
  }
}

// ---------- Helpers para editar/borrar producto desde la UI ----------
function editarProducto(prodData) {
  let prod = prodData;
  if (typeof prodData === 'string') {
    try { prod = JSON.parse(prodData); } catch (e) { prod = JSON.parse(prodData.replace(/&#39;/g, "'")); }
  }
  const modal = new bootstrap.Modal(document.getElementById('modalProducto'));
  document.getElementById('id_producto').value = prod.id_producto || '';
  document.getElementById('nombre').value = prod.nombre || '';
  document.getElementById('descripcion').value = prod.descripcion || '';
  document.getElementById('precio').value = prod.precio || 0;
  document.getElementById('stock').value = prod.stock || 0;
  if (document.getElementById('temporada')) document.getElementById('temporada').value = prod.temporada || '';
  modal.show();
}

async function borrarProducto(id) {
  if (!confirm('¿Borrar producto?')) return;
  try {
    const resp = await fetch(`/eliminarProducto/${id}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error borrando producto');
    showToast('Producto eliminado', 'success');
    cargarProductos();
  } catch (err) {
    console.error('Error borrarProducto:', err);
    showToast(err.message || 'Error borrando producto', 'error');
  }
}

function togglePasswordVisibility(inputId, toggleBtnId) {
  const passwordInput = document.getElementById(inputId);
  const toggleBtn = document.getElementById(toggleBtnId);

  // Guardas defensivamente si no existen los elementos
  if (!passwordInput || !toggleBtn) {
    // opcional: console.warn para debug
    console.warn(`togglePasswordVisibility: elemento no encontrado: ${inputId} o ${toggleBtnId}`);
    return;
  }

  const icon = toggleBtn.querySelector('i');

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';

    if (icon) {
      // Actualiza icono según estado
      icon.classList.toggle('bi-eye', !isPassword);
      icon.classList.toggle('bi-eye-slash', isPassword);
    }
  });
}

// Aplicar a ambos formularios
togglePasswordVisibility('loginPassword', 'toggleLoginPassword');
togglePasswordVisibility('regPassword', 'toggleRegisterPassword');
