// ================================
// MEDTRACK BACKEND AUTHENTICATION
// ================================

function togglePassword(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    button.textContent = "🙈";
  } else {
    input.type = "password";
    button.textContent = "👁";
  }
}

function showAuthFeedback(elementId, message, isError = true) {
  const box = document.getElementById(elementId);
  if (!box) {
    console.warn(message);
    return;
  }
  box.textContent = message;
  box.style.display = "block";
  box.style.padding = "10px 14px";
  box.style.marginBottom = "14px";
  box.style.borderRadius = "8px";
  box.style.fontSize = "13px";
  box.style.fontWeight = "600";
  box.style.background = isError ? "#ffe8e8" : "#e8f8f0";
  box.style.color = isError ? "#b91c1c" : "#087f5b";
  box.style.border = isError ? "1px solid #fecaca" : "1px solid #bbf7d0";
}

// REGISTER
const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const firstName = document.getElementById("firstName").value.trim();
    const lastName = document.getElementById("lastName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const role = document.getElementById("userRole").value;
    const password = document.getElementById("registerPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
      showAuthFeedback("authFeedback", "Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      showAuthFeedback("authFeedback", "Password must contain at least 6 characters.");
      return;
    }

    try {
      const data = await window.medtrackApi.request("/auth/register", {
        method: "POST",
        body: JSON.stringify({ firstName, lastName, email, phone, role, password })
      });
      window.medtrackApi.setSession(data.token, data.user);
      showAuthFeedback("authFeedback", "Account created successfully! Redirecting...", false);
      setTimeout(() => {
        window.location.href = window.medtrackApi.getDashboardPath(data.user.role);
      }, 600);
    } catch (err) {
      showAuthFeedback("authFeedback", err.message || "Registration failed.");
    }
  });

  const toggleTerms = (e) => {
    e.preventDefault();
    const box = document.getElementById("termsInfoBox");
    if (box) {
      box.style.display = box.style.display === "none" ? "block" : "none";
    }
  };
  document.getElementById("openTermsLink")?.addEventListener("click", toggleTerms);
  document.getElementById("openPrivacyLink")?.addEventListener("click", toggleTerms);
}

// LOGIN & PASSWORD RESET
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
      const data = await window.medtrackApi.request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      window.medtrackApi.setSession(data.token, data.user);
      showAuthFeedback("authFeedback", `Welcome back, ${data.user.firstName}! Redirecting...`, false);
      setTimeout(() => {
        window.location.href = window.medtrackApi.getDashboardPath(data.user.role);
      }, 500);
    } catch (err) {
      showAuthFeedback("authFeedback", err.message || "Invalid email or password.");
    }
  });

  const resetPanel = document.getElementById("resetPasswordPanel");
  document.getElementById("forgotPassword")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!resetPanel) return;
    resetPanel.style.display = resetPanel.style.display === "none" ? "block" : "none";
    const loginEmail = document.getElementById("loginEmail")?.value.trim();
    if (loginEmail && document.getElementById("resetEmailInput")) {
      document.getElementById("resetEmailInput").value = loginEmail;
    }
  });
  document.getElementById("closeResetPanelBtn")?.addEventListener("click", () => {
    if (resetPanel) resetPanel.style.display = "none";
  });

  document.getElementById("requestResetForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("resetEmailInput").value.trim();
    try {
      const res = await window.medtrackApi.request("/auth/request-password-reset", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      if (res.simulationResetToken && document.getElementById("resetTokenInput")) {
        document.getElementById("resetTokenInput").value = res.simulationResetToken;
      }
      showAuthFeedback(
        "resetFeedback",
        res.simulationResetToken
          ? `${res.message} Dev preview token prefilled.`
          : res.message,
        false
      );
    } catch (err) {
      showAuthFeedback("resetFeedback", err.message || "Failed to request password reset.");
    }
  });

  document.getElementById("confirmResetForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (
      document.getElementById("resetEmailInput")?.value.trim() ||
      document.getElementById("loginEmail")?.value.trim() ||
      ""
    );
    const token = document.getElementById("resetTokenInput").value.trim();
    const newPassword = document.getElementById("resetNewPassword").value;
    if (!email) {
      showAuthFeedback("resetFeedback", "Please enter your account email above first.");
      return;
    }
    try {
      const res = await window.medtrackApi.request("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email, token, newPassword })
      });
      showAuthFeedback("resetFeedback", res.message || "Password updated! You can now sign in.", false);
    } catch (err) {
      showAuthFeedback("resetFeedback", err.message || "Password reset failed.");
    }
  });
}

function fillDemoLogin(email, password) {
  const emailEl = document.getElementById("loginEmail");
  const passEl = document.getElementById("loginPassword");
  if (emailEl) emailEl.value = email;
  if (passEl) passEl.value = password;
}

window.fillDemoLogin = fillDemoLogin;
window.togglePassword = togglePassword;