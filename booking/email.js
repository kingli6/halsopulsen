const EMAIL_PROVIDER = String(process.env.BOOKING_EMAIL_PROVIDER || "").trim().toLowerCase();
const CALENDAR_FILENAME = "halsopulsen-bokning.ics";
const CALENDAR_UID_DOMAIN = "halsopulsen.se";

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

function validPublicUrl() {
  const value = String(process.env.BOOKING_PUBLIC_URL || "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDateTime(date) {
  if (!date) return "Ingen tid tilldelad";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Ingen tid tilldelad";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function escapeICalendarText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldICalendarLine(line) {
  const folded = [];
  let current = "";
  for (const character of line) {
    const candidate = current + character;
    if (Buffer.byteLength(candidate, "utf8") > 75) {
      folded.push(current);
      current = ` ${character}`;
    } else {
      current = candidate;
    }
  }
  folded.push(current);
  return folded.join("\r\n");
}

function formatICalendarUtc(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("A valid appointment time is required for a calendar event.");
  }
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

function calendarUid(booking) {
  const id = String(booking?.id || "").trim();
  if (!id) throw new Error("A booking ID is required for a calendar event.");
  return `booking-${id}@${CALENDAR_UID_DOMAIN}`;
}

function normalizeBooking(booking = {}) {
  return {
    ...booking,
    clientEmail: booking.clientEmail || booking.email,
    clientPhone: booking.clientPhone ?? booking.phone,
    startsAt: booking.startsAt || booking.startAt,
    endsAt: booking.endsAt || booking.endAt
  };
}

function calendarSequence(booking, fallback = Date.now()) {
  const updatedAt = booking?.updatedAt ? new Date(booking.updatedAt).getTime() : NaN;
  if (Number.isFinite(updatedAt)) return Math.max(1, Math.floor(updatedAt));
  return Math.max(0, Math.floor(Number(fallback) || 0));
}

function createCalendarAttachment(
  booking,
  {
    method = "REQUEST",
    status = "CONFIRMED",
    sequence = 0,
    stamp = new Date()
  } = {}
) {
  booking = normalizeBooking(booking);
  if (!booking?.startsAt || !booking?.endsAt) return null;
  const normalizedMethod = String(method).toUpperCase();
  const normalizedStatus = String(status).toUpperCase();
  const description = [
    `Tjänst: ${booking.serviceName}`,
    `Kund: ${booking.clientName}`,
    `Boknings-ID: ${booking.id}`
  ].join("\n");
  const contentType = `text/calendar; method=${normalizedMethod}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HälsoPulsen//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${normalizedMethod}`,
    "BEGIN:VEVENT",
    `UID:${calendarUid(booking)}`,
    `DTSTAMP:${formatICalendarUtc(stamp)}`,
    `DTSTART:${formatICalendarUtc(booking.startsAt)}`,
    `DTEND:${formatICalendarUtc(booking.endsAt)}`,
    `SUMMARY:${escapeICalendarText(`HälsoPulsen – ${booking.serviceName}`)}`,
    `DESCRIPTION:${escapeICalendarText(description)}`,
    `STATUS:${normalizedStatus}`,
    `SEQUENCE:${Math.max(0, Math.floor(Number(sequence) || 0))}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  const icsContent = `${lines.map(foldICalendarLine).join("\r\n")}\r\n`;
  const base64Content = Buffer.from(icsContent, "utf8").toString("base64");
  return {
    filename: CALENDAR_FILENAME,
    content: base64Content,
    content_type: contentType,
    type: contentType
  };
}

function calendarAttachments(booking, options) {
  const attachment = createCalendarAttachment(booking, options);
  return attachment ? [attachment] : [];
}

function bookingDetails(booking, { requireCurrent = false } = {}) {
  booking = normalizeBooking(booking);
  const time = requireCurrent
    ? booking.startsAt
    : booking.originalStartsAt || booking.startsAt;
  if (requireCurrent && !time) {
    throw new Error("A confirmed booking email requires a scheduled appointment time.");
  }
  return [
    `Tjänst: ${booking.serviceName}`,
    `${requireCurrent ? "Tid" : "Efterfrågad tid"}: ${formatDateTime(time)}`,
    `Längd: ${booking.durationMinutes} minuter`
  ].join("\n");
}

async function sendBookingEmail({
  to,
  subject,
  text,
  html,
  attachments = [],
  label = "transactional booking email",
  suppress = false
}) {
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

  if (!validPublicUrl()) {
    console.warn("Booking email skipped: BOOKING_PUBLIC_URL must be an absolute HTTP(S) URL.");
    return { sent: false, reason: "invalid_public_url" };
  }

  if (config.provider !== "resend") {
    console.warn(`Booking email skipped: unsupported provider "${config.provider}".`);
    return { sent: false, reason: "unsupported_provider" };
  }

  const payload = {
    from: process.env.BOOKING_FROM_EMAIL,
    to: [to],
    subject,
    text,
    html
  };
  if (attachments.length > 0) payload.attachments = attachments;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Transactional email provider rejected the message (${response.status}): ${detail.slice(0, 300)}`);
  }
  console.info(`Booking email sent via Resend: ${label}.`);
  return { sent: true };
}

async function sendRequestReceivedEmail({ booking, token, suppress }) {
  booking = normalizeBooking(booking);
  const manageLink = publicUrl(`/booking/manage/${encodeURIComponent(token)}`);
  const details = bookingDetails(booking);
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Din bokningsförfrågan har tagits emot · HälsoPulsen",
    label: "client request confirmation",
    suppress,
    text: [
      "Tack för din bokningsförfrågan till HälsoPulsen.",
      "",
      details,
      "",
      "Tiden är inte tilldelad eller bekräftad ännu.",
      "Du får en bekräftelse efter att förfrågan har granskats.",
      "",
      `Hantera förfrågan: ${manageLink}`
    ].join("\n"),
    html: `<p>Tack för din bokningsförfrågan till HälsoPulsen.</p><p>${escapeHtml(details).replace(/\n/g, "<br>")}</p><p><strong>Tiden är inte tilldelad eller bekräftad ännu.</strong></p><p>Du får en bekräftelse efter att förfrågan har granskats.</p><p><a href="${escapeHtml(manageLink)}">Hantera förfrågan</a></p>`
  });
}

async function sendNewRequestAdminEmail({ booking, suppress }) {
  booking = normalizeBooking(booking);
  const manageLink = publicUrl("/admin/booking");
  const details = bookingDetails(booking);
  return sendBookingEmail({
    to: process.env.BOOKING_ADMIN_EMAIL || "",
    subject: `Ny bokningsförfrågan · ${booking.clientName}`,
    label: "admin new-request notification",
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

async function sendConfirmedEmail({ booking, token, suppress, sequence = 0 }) {
  booking = normalizeBooking(booking);
  const manageLink = publicUrl(`/booking/manage/${encodeURIComponent(token)}`);
  const details = bookingDetails(booking, { requireCurrent: true });
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Din tid är bekräftad · HälsoPulsen",
    label: "client booking confirmation",
    suppress,
    attachments: calendarAttachments(booking, { sequence }),
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

async function sendAdminConfirmedEmail({ booking, suppress, sequence = 0 }) {
  booking = normalizeBooking(booking);
  const details = bookingDetails(booking, { requireCurrent: true });
  return sendBookingEmail({
    to: process.env.BOOKING_ADMIN_EMAIL || "",
    subject: `Bokning bekräftad · ${booking.clientName}`,
    label: "admin booking confirmation",
    suppress,
    attachments: calendarAttachments(booking, { sequence }),
    text: [
      "En bokning har bekräftats.",
      "",
      `Kund: ${booking.clientName}`,
      `E-post: ${booking.clientEmail}`,
      `Telefon: ${booking.clientPhone || "—"}`,
      details,
      `Boknings-ID: ${booking.id}`
    ].join("\n"),
    html: `<p>En bokning har bekräftats.</p><p><strong>Kund:</strong> ${escapeHtml(booking.clientName)}<br><strong>E-post:</strong> ${escapeHtml(booking.clientEmail)}<br><strong>Telefon:</strong> ${escapeHtml(booking.clientPhone || "—")}</p><p>${escapeHtml(details).replace(/\n/g, "<br>")}</p><p><strong>Boknings-ID:</strong> ${escapeHtml(booking.id)}</p>`
  });
}

async function sendRescheduledEmail({ booking, suppress, sequence }) {
  booking = normalizeBooking(booking);
  const details = bookingDetails(booking, { requireCurrent: true });
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Din bekräftade tid har ändrats · HälsoPulsen",
    label: "client booking reschedule",
    suppress,
    attachments: calendarAttachments(booking, { sequence }),
    text: [
      "Din bekräftade bokning har ändrats.",
      "",
      details,
      "",
      "Kalenderhändelsen i bilagan innehåller den uppdaterade tiden."
    ].join("\n"),
    html: `<p>Din bekräftade bokning har ändrats.</p><p>${escapeHtml(details).replace(/\n/g, "<br>")}</p><p>Kalenderhändelsen i bilagan innehåller den uppdaterade tiden.</p>`
  });
}

async function sendAdminRescheduledEmail({ booking, suppress, sequence }) {
  booking = normalizeBooking(booking);
  const details = bookingDetails(booking, { requireCurrent: true });
  return sendBookingEmail({
    to: process.env.BOOKING_ADMIN_EMAIL || "",
    subject: `Bokning ändrad · ${booking.clientName}`,
    label: "admin booking reschedule",
    suppress,
    attachments: calendarAttachments(booking, { sequence }),
    text: [
      "En bekräftad bokning har ändrats.",
      "",
      `Kund: ${booking.clientName}`,
      `E-post: ${booking.clientEmail}`,
      `Telefon: ${booking.clientPhone || "—"}`,
      details,
      `Boknings-ID: ${booking.id}`
    ].join("\n"),
    html: `<p>En bekräftad bokning har ändrats.</p><p><strong>Kund:</strong> ${escapeHtml(booking.clientName)}<br><strong>E-post:</strong> ${escapeHtml(booking.clientEmail)}<br><strong>Telefon:</strong> ${escapeHtml(booking.clientPhone || "—")}</p><p>${escapeHtml(details).replace(/\n/g, "<br>")}</p><p><strong>Boknings-ID:</strong> ${escapeHtml(booking.id)}</p>`
  });
}

async function sendAlternativeEmail({ booking, token, suppress }) {
  booking = normalizeBooking(booking);
  const manageLink = publicUrl(`/booking/manage/${encodeURIComponent(token)}`);
  const originalTime = formatDateTime(booking.originalStartsAt || booking.startsAt);
  const alternativeTime = formatDateTime(booking.alternativeStartsAt);
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Förslag på en annan tid · HälsoPulsen",
    label: "client alternative-time message",
    suppress,
    text: [
      "Jag har ett förslag på en annan tid för din bokning.",
      "",
      `Ursprunglig tid: ${originalTime}`,
      `Föreslagen tid: ${alternativeTime}`,
      "",
      `Öppna för att acceptera eller tacka nej: ${manageLink}`
    ].join("\n"),
    html: `<p>Jag har ett förslag på en annan tid för din bokning.</p><p><strong>Ursprunglig tid:</strong> ${escapeHtml(originalTime)}<br><strong>Föreslagen tid:</strong> ${escapeHtml(alternativeTime)}</p><p><a href="${escapeHtml(manageLink)}">Acceptera eller tacka nej</a></p>`
  });
}

async function sendCancelledEmail({ booking, suppress, sequence }) {
  booking = normalizeBooking(booking);
  return sendBookingEmail({
    to: booking.clientEmail,
    subject: "Bokningsförfrågan avslutad · HälsoPulsen",
    label: "client cancellation message",
    suppress,
    attachments: calendarAttachments(booking, {
      method: "CANCEL",
      status: "CANCELLED",
      sequence: calendarSequence(booking, sequence)
    }),
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

async function sendAdminCancelledEmail({ booking, suppress, sequence }) {
  booking = normalizeBooking(booking);
  const details = bookingDetails(booking);
  return sendBookingEmail({
    to: process.env.BOOKING_ADMIN_EMAIL || "",
    subject: `Bokning avslutad · ${booking.clientName}`,
    label: "admin cancellation message",
    suppress,
    attachments: calendarAttachments(booking, {
      method: "CANCEL",
      status: "CANCELLED",
      sequence: calendarSequence(booking, sequence)
    }),
    text: [
      "En bokning har avslutats.",
      "",
      `Kund: ${booking.clientName}`,
      `E-post: ${booking.clientEmail}`,
      `Telefon: ${booking.clientPhone || "—"}`,
      details,
      `Boknings-ID: ${booking.id}`
    ].join("\n"),
    html: `<p>En bokning har avslutats.</p><p><strong>Kund:</strong> ${escapeHtml(booking.clientName)}<br><strong>E-post:</strong> ${escapeHtml(booking.clientEmail)}<br><strong>Telefon:</strong> ${escapeHtml(booking.clientPhone || "—")}</p><p>${escapeHtml(details).replace(/\n/g, "<br>")}</p><p><strong>Boknings-ID:</strong> ${escapeHtml(booking.id)}</p>`
  });
}

module.exports = {
  bookingDetails,
  calendarSequence,
  createCalendarAttachment,
  getEmailConfiguration,
  isTestFixtureEmail,
  sendAdminCancelledEmail,
  sendAdminConfirmedEmail,
  sendAdminRescheduledEmail,
  sendAlternativeEmail,
  sendCancelledEmail,
  sendConfirmedEmail,
  sendNewRequestAdminEmail,
  sendRequestReceivedEmail,
  sendRescheduledEmail
};