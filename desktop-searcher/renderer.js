const api = window.nightjarSearcher;
const $ = (selector) => document.querySelector(selector);
const form = $("#address-form");
const address = $("#address");
const provider = $("#provider");
const loading = $("#loading");
const notice = $("#notice");
const pageTitle = $("#page-title");
const back = $("#back");
const forward = $("#forward");

function showError(message) {
  notice.textContent = message;
  notice.classList.add("visible");
}

function rememberProvider() {
  localStorage.setItem("nightjar-search-provider", provider.value);
}

function go() {
  const value = address.value.trim();
  if (!value) return;
  rememberProvider();
  notice.classList.remove("visible");
  void api.navigate(value, provider.value).catch(showError);
}

try {
  const savedProvider = localStorage.getItem("nightjar-search-provider");
  if (savedProvider && [...provider.options].some((option) => option.value === savedProvider)) {
    provider.value = savedProvider;
  }
} catch {
  provider.value = "duckduckgo";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  go();
});

$("#back").addEventListener("click", () => api.back());
$("#forward").addEventListener("click", () => api.forward());
$("#reload").addEventListener("click", () => api.reload());
$("#home").addEventListener("click", () => {
  notice.classList.remove("visible");
  void api.home();
});
$(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  notice.classList.remove("visible");
  void api.home();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    address.focus();
    address.select();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
    event.preventDefault();
    void api.reload();
  }
});

api.onState((state) => {
  back.disabled = !state.canGoBack;
  forward.disabled = !state.canGoForward;
  if (state.url.startsWith("http")) address.value = state.url;
  pageTitle.textContent = state.title || "Nightjar Searcher";
});
api.onLoading((isLoading) => {
  loading.classList.toggle("active", isLoading);
  if (isLoading) {
    notice.classList.remove("visible");
    pageTitle.textContent = "Loading…";
  }
});
api.onError(showError);
