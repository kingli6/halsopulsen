const EMAIL_PROVIDER = String(process.env.BOOKING_EMAIL_PROVIDER || "").trim().toLowerCase();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function getEmailConfiguration() {
  const required = {
    resend: ["RESEND_API_KEY", "BOOKING_FROM_EMAIL", "BOOKING_ADMIN_EMAIL", "BOOKING_PUBLIC_URL"]
  };
  const provider = EMAIL_PROVIDER || "none";
  const missing = provider === "none"
    ? ["BOOKING_EMAIL_PROVIDER"]
    : (required[provider] || []).filter(key => !process.env[key]);
  return {
    provider,
    configured: provider !== "none" && missing.length === 0,
    missing,
    supported: Object.keys(required)
  };
}

function isTestFixtureEmail(email) {
  return /@(?:[^@\s]+\.)?test$/i.test(String(email || "").trim());
}

function publicUrl(path) {
  const base = String(process.env.BOOKING_PUBLIC_URL || "").replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(date));
}

function bookingDetails(booking) {
  return [
    `Tjänst: ${booking.serviceName}`,
    `Tid: ${formatDateTime(booking.startsAt)}`,
    `Längd: ${booking.durationMinutes} minuter`
  ].join("\n");
}

async function sendBookingEmail({ to, subject, text, html, suppress = false }) {
  if (suppress || isTestFixtureEmail(to)) {
    return { sent: false, reason: "test_fixture" };
  }

  const config = getEmailConfiguration();
  if (!config.configured) {
    console.warn(
      `Booking email skipped: provider is not configured (${config.missing.join(", ")}).`
    );
    return { sent: false, reason: "not_configured", missing: config.missing };
  }

  if (config.provider !== "resend") {
    console.warn(`Booking email skipped: unsupported provider "${config.provider}".`);
    return { sent: false, reason: "unsupported_provider" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.BOOKING_FROM_EMAIL,
      to: [to],
      subject,
      text,
      html
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Transactional email provider rejected the message (${response.status}): ${detail.slice(0, 300)}`);
  }
  return { sent: true };
}

async function sendRequestReceivedEmail({ booking, token, suppress }) {
  const manageLink = publicUrl(`/booking/manage/${encodeURIComponent(token)}`);
  const details = bookingDetails(booking);
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Din bokningsförfrågan har tagits emot · HälsoPulsen",
    suppress,
    text: [
      "Tack för din bokningsförfrågan till HälsoPulsen.",
      "",
      details,
      "",
      "The appointment is not confirmed yet.",
      "Du får en bekräftelse efter att förfrågan har granskats.",
      "",
      `Hantera förfrågan: ${manageLink}`
    ].join("\n"),
    html: `<p>Tack för din bokningsförfrågan till HälsoPulsen.</p><p>${escapeHtml(details).replace(/\n/g, "<br>")}</p><p><strong>The appointment is not confirmed yet.</strong></p><p>Du får en bekräftelse efter att förfrågan har granskats.</p><p><a href="${escapeHtml(manageLink)}">Hantera förfrågan</a></p>`
  });
}

async function sendNewRequestAdminEmail({ booking, suppress }) {
  const manageLink = publicUrl("/admin/booking");
  const details = bookingDetails(booking);
  return sendBookingEmail({
    to: process.env.BOOKING_ADMIN_EMAIL || "",
    subject: `Ny bokningsförfrågan · ${booking.clientName}`,
    suppress,
    text: [
      "En ny bokningsförfrågan väntar på granskning.",
      "",
      `Kund: ${booking.clientName}`,
      `E-post: ${booking.clientEmail}`,
      `Telefon: ${booking.clientPhone || "—"}`,
      details,
      "",
      `Öppna admin: ${manageLink}`
    ].join("\n"),
    html: `<p>En ny bokningsförfrågan väntar på granskning.</p><p><strong>Kund:</strong> ${escapeHtml(booking.clientName)}<br><strong>E-post:</strong> ${escapeHtml(booking.clientEmail)}<br><strong>Telefon:</strong> ${escapeHtml(booking.clientPhone || "—")}</p><p>${escapeHtml(details).replace(/\n/g, "<br>")}</p><p><a href="${escapeHtml(manageLink)}">Öppna admin</a></p>`
  });
}

async function sendConfirmedEmail({ booking, token, suppress }) {
  const manageLink = publicUrl(`/booking/manage/${encodeURIComponent(token)}`);
  const details = bookingDetails(booking);
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Din tid är bekräftad · HälsoPulsen",
    suppress,
    text: [
      "Din bokning är bekräftad.",
      "",
      details,
      "",
      `Hantera eller avboka: ${manageLink}`
    ].join("\n"),
    html: `<p>Din bokning är bekräftad.</p><p>${escapeHtml(details).replace(/\n/g, "<br>")}</p><p><a href="${escapeHtml(manageLink)}">Hantera eller avboka din tid</a></p>`
  });
}

async function sendAlternativeEmail({ booking, token, suppress }) {
  const manageLink = publicUrl(`/booking/manage/${encodeURIComponent(token)}`);
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Förslag på en annan tid · HälsoPulsen",
    suppress,
    text: [
      "Jag har ett förslag på en annan tid för din bokning.",
      "",
      `Ursprunglig tid: ${formatDateTime(booking.originalStartsAt)}`,
      `Föreslagen tid: ${formatDateTime(booking.alternativeStartsAt)}`,
      "",
      `Öppna för att acceptera eller tacka nej: ${manageLink}`
    ].join("\n"),
    html: `<p>Jag har ett förslag på en annan tid för din bokning.</p><p><strong>Ursprunglig tid:</strong> ${escapeHtml(formatDateTime(booking.originalStartsAt))}<br><strong>Föreslagen tid:</strong> ${escapeHtml(formatDateTime(booking.alternativeStartsAt))}</p><p><a href="${escapeHtml(manageLink)}">Acceptera eller tacka nej</a></p>`
  });
}

async function sendCancelledEmail({ booking, suppress }) {
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Bokningsförfrågan avslutad · HälsoPulsen",
    suppress,
    text: [
      "Din bokningsförfrågan har avslutats och tiden är inte längre reserverad.",
      "",
      bookingDetails(booking),
      "",
      "Kontakta HälsoPulsen om du vill hitta en annan tid."
    ].join("\n"),
    html: `<p>Din bokningsförfrågan har avslutats och tiden är inte längre reserverad.</p><p>${escapeHtml(bookingDetails(booking)).replace(/\n/g, "<br>")}</p><p>Kontakta HälsoPulsen om du vill hitta en annan tid.</p>`
  });
}

module.exports = {
  getEmailConfiguration,
  isTestFixtureEmail,
  sendAlternativeEmail,
  sendCancelledEmail,
  sendConfirmedEmail,
  sendNewRequestAdminEmail,
  sendRequestReceivedEmail
};