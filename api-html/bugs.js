let csrf = "";
const form = document.querySelector("#bug-form");
const authMessage = document.querySelector("#bug-auth");
const successMessage = document.querySelector("#bug-success");

try {
  const response = await fetch(apiUrl("/api/session"), { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Sign in to Luma to submit a private bug report.");
  const session = await response.json();
  csrf = session.csrf;
  form.hidden = false;
} catch (error) {
  authMessage.textContent = error.message;
  authMessage.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = $("button[type=submit]", form);
  button.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/feedback"), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-NJ-CSRF": csrf },
      body: JSON.stringify({
        kind: "bug",
        subject: form.elements.subject.value.trim(),
        message: form.elements.message.value.trim(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "The report could not be submitted.");
    form.reset();
    form.hidden = true;
    successMessage.textContent = "Your report was sent privately to the owner.";
    successMessage.hidden = false;
  } catch (error) {
    authMessage.textContent = error.message;
    authMessage.hidden = false;
  } finally { button.disabled = false; }
});

function $(selector, root = document) {
  return root.querySelector(selector);
}

function apiUrl(path) {
  const base = window.LUMA_CONFIG?.apiBaseUrl || location.origin;
  return new URL(path, base).toString();
}
