// Админка Picta — читает/пишет напрямую в Cloudflare Worker (/admin/*),
// который сам проверяет вход через Supabase и флаг profiles.is_admin.
// Здесь нет отдельной "защиты" — реальная проверка прав на сервере в
// worker.js, эта страница просто прячет свой UI, пока проверка не пройдена.
(function () {
  "use strict";

  const KEY_LABELS = {
    PIXABAY_KEY: "Pixabay",
    PEXELS_KEY: "Pexels",
    UNSPLASH_ACCESS_KEY: "Unsplash",
    FLICKR_API_KEY: "Flickr",
    SHUTTERSTOCK_CONSUMER_KEY: "Shutterstock — Consumer Key",
    SHUTTERSTOCK_CONSUMER_SECRET: "Shutterstock — Consumer Secret",
    PEXAFY_API_KEY: "Pexafy",
    COVERR_API_KEY: "Coverr",
  };

  const el = {
    gate: document.getElementById("adminGate"),
    gateMessage: document.getElementById("adminGateMessage"),
    googleBtn: document.getElementById("adminGoogleBtn"),
    content: document.getElementById("adminContent"),
    whoami: document.getElementById("adminWhoami"),
    statUsers: document.getElementById("statUsers"),
    statSearchesToday: document.getElementById("statSearchesToday"),
    keysTable: document.getElementById("keysTable"),
    toast: document.getElementById("adminToast"),
  };

  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add("is-visible"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove("is-visible");
      setTimeout(() => { el.toast.hidden = true; }, 200);
    }, 2600);
  }

  function base() {
    return window.APP_CONFIG && window.APP_CONFIG.WORKER_BASE_URL;
  }

  async function adminFetch(path, opts = {}) {
    const token = window.PhotoSeekAuth && window.PhotoSeekAuth.getAccessToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base()}${path}`, { ...opts, headers });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch { /* нет тела */ }
      const err = new Error(detail || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function renderKeys(keys) {
    el.keysTable.innerHTML = "";
    keys.forEach((k) => {
      const row = document.createElement("div");
      row.className = "admin-key-row";

      const label = document.createElement("div");
      label.className = "admin-key-label";
      label.innerHTML = `
        <strong>${KEY_LABELS[k.name] || k.name}</strong>
        <span class="admin-key-status ${k.configured ? "is-ok" : "is-missing"}">
          ${k.configured ? (k.preview || "задан") : "не задан"}
          ${k.configured ? `<span class="admin-key-source">(${k.source === "kv" ? "KV" : "secret"})</span>` : ""}
        </span>
      `;

      const form = document.createElement("form");
      form.className = "admin-key-form";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "новое значение";
      input.autocomplete = "off";
      input.spellcheck = false;
      const saveBtn = document.createElement("button");
      saveBtn.type = "submit";
      saveBtn.className = "btn btn-primary";
      saveBtn.textContent = "Сохранить";
      form.append(input, saveBtn);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        saveBtn.disabled = true;
        try {
          await adminFetch("/admin/keys", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: k.name, value }),
          });
          showToast(`${KEY_LABELS[k.name] || k.name}: сохранено`);
          input.value = "";
          await loadKeys();
        } catch (err) {
          showToast(`Ошибка сохранения: ${err.message}`);
        } finally {
          saveBtn.disabled = false;
        }
      });

      row.append(label, form);

      if (k.source === "kv") {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn btn-ghost admin-key-delete";
        delBtn.textContent = "Убрать из KV";
        delBtn.title = "Вернуться к значению из secrets воркера (если задано)";
        delBtn.addEventListener("click", async () => {
          try {
            await adminFetch(`/admin/keys?name=${encodeURIComponent(k.name)}`, { method: "DELETE" });
            showToast(`${KEY_LABELS[k.name] || k.name}: запись в KV удалена`);
            await loadKeys();
          } catch (err) {
            showToast(`Ошибка удаления: ${err.message}`);
          }
        });
        row.appendChild(delBtn);
      }

      el.keysTable.appendChild(row);
    });
  }

  async function loadKeys() {
    try {
      const data = await adminFetch("/admin/keys");
      renderKeys(data.keys || []);
    } catch (err) {
      el.keysTable.innerHTML = `<p class="admin-hint">Не удалось загрузить ключи: ${err.message}</p>`;
    }
  }

  async function loadStats() {
    try {
      const data = await adminFetch("/admin/stats");
      el.statUsers.textContent = data.userCount ?? "—";
      el.statSearchesToday.textContent = data.searchesToday ?? "—";
    } catch (err) {
      el.statUsers.textContent = "—";
      el.statSearchesToday.textContent = "—";
    }
  }

  async function enterAdmin(user) {
    el.whoami.textContent = user.email || "";
    try {
      await loadStats();
      await loadKeys();
      el.gate.hidden = true;
      el.content.hidden = false;
    } catch (err) {
      if (err.status === 403) {
        el.gateMessage.textContent = "Этот аккаунт не является администратором.";
      } else {
        el.gateMessage.textContent = `Не удалось проверить доступ: ${err.message}`;
      }
      el.gate.hidden = false;
      el.content.hidden = true;
    }
  }

  function showLoggedOutGate() {
    el.gateMessage.textContent = "Войдите, чтобы открыть админку.";
    el.googleBtn.hidden = false;
    el.gate.hidden = false;
    el.content.hidden = true;
    el.whoami.textContent = "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!base()) {
      el.gateMessage.textContent = "WORKER_BASE_URL не настроен в js/config.js.";
      return;
    }
    if (!window.PhotoSeekAuth || !window.PhotoSeekAuth.isConfigured()) {
      el.gateMessage.textContent = "Supabase не настроен в js/config.js.";
      return;
    }

    el.googleBtn.addEventListener("click", async () => {
      try {
        await window.PhotoSeekAuth.signInWithGoogle();
      } catch (err) {
        showToast(`Не удалось начать вход: ${err.message}`);
      }
    });

    window.PhotoSeekAuth.onChange((session) => {
      const user = session && session.user;
      if (user) {
        el.googleBtn.hidden = true;
        el.gateMessage.textContent = "Проверяем права администратора…";
        enterAdmin(user);
      } else {
        showLoggedOutGate();
      }
    });
  });
})();
